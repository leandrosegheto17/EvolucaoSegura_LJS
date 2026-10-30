import {
  BYTES_RASCUNHOS_MAXIMO_POR_PROFISSIONAL,
  PAYLOAD_RASCUNHO_MAXIMO,
  PROBLEMA_COTA_RASCUNHO,
  PROBLEMA_RASCUNHO_INVALIDO,
  PROBLEMA_TIPO_RASCUNHO,
  PROBLEMA_VERSAO_RASCUNHO,
  RASCUNHOS_MAXIMO_POR_PROFISSIONAL,
  type Rascunho,
} from '@es/contrato/clinico';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, USER_AGENT, app, pedir } from './pacientes-apoio.ts';

// T104 / RAS-01, RAS-02, ISO-02: PUT /api/rascunhos/:tipo/:ref e GET /api/rascunhos.
// - RAS-01: um rascunho por (profissional, tipo, ref), payload JSON até 512 KiB, por upsert, sem
//   apagar.
// - RAS-02: If-Match diferente da versão atual = 412; rascunho inexistente aceita If-Match
//   ausente ou "0".
// - ISO-02: B não lê nem sobrescreve o rascunho de A, mesmo com a mesma chave.
// Decisões do usuário (2026-10-26): rotas como no legado, ETag na resposta, GET ?tipo=&ref=
// devolvendo {items}; tipo e ref no formato [A-Za-z0-9._:-]{1,120}, ref UUID para evolucao e
// anamnese; 412 PRECONDITION_FAILED; payload acima de 512 KiB = 422 validacao; If-Match "3",
// W/"3" ou 3, e 400 se inválido; o rascunho fica depois de gravar a evolução (nada é apagado).

const LENTO = { timeout: 30_000 };
const SENTINELA = 'SENTINELA-CLINICA';

async function gravar(
  sessao: Sessao | null,
  caminho: string,
  corpo: unknown,
  ifMatch?: string,
): Promise<Response> {
  return app.request(
    `/api/rascunhos/${caminho}`,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': USER_AGENT,
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
        ...(ifMatch !== undefined ? { 'If-Match': ifMatch } : {}),
      },
      body: JSON.stringify(corpo),
    },
    env,
  );
}

const ler = async (sessao: Sessao, consulta: string) => {
  const resposta = await pedir('GET', `/api/rascunhos${consulta}`, sessao);
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as { items: Rascunho[] }).items;
};

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const rascunhosDe = (usuarioId: string) =>
  comoAdmin<{ tipo: string; ref: string; payload: unknown; row_version: number }>(
    'select tipo, ref, payload, row_version from rascunho where usuario_id = $1 order by tipo, ref',
    [usuarioId],
  );

const novaChave = () => `evolucao/${crypto.randomUUID()}`;

describe('exige sessão', LENTO, () => {
  it('sem sessão, PUT e GET respondem 401', async () => {
    const put = await gravar(null, novaChave(), { payload: {} });
    expect(put.status).toBe(401);
    expect(await put.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    const get = await pedir('GET', '/api/rascunhos', null);
    expect(get.status).toBe(401);
  });
});

describe('upsert sem apagar (RAS-01)', LENTO, () => {
  it('cria com If-Match ausente (versão 1) e devolve o ETag', async () => {
    const sessao = await sessaoDeTeste();
    const ref = crypto.randomUUID();
    const resposta = await gravar(sessao, `evolucao/${ref}`, { payload: { texto: 'v1' } });
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('etag')).toBe('"1"');
    expect(await resposta.json()).toMatchObject({
      tipo: 'evolucao',
      ref,
      payload: { texto: 'v1' },
      row_version: 1,
    });
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([
      { tipo: 'evolucao', ref, payload: { texto: 'v1' }, row_version: 1 },
    ]);
  });

  it('cria com If-Match "0"', async () => {
    const sessao = await sessaoDeTeste();
    expect((await gravar(sessao, novaChave(), { payload: {} }, '"0"')).status).toBe(200);
    expect(await rascunhosDe(sessao.usuarioId)).toHaveLength(1);
  });

  it('com a versão atual, substitui o payload na mesma linha e sobe a versão', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { texto: 'v1' } });
    const resposta = await gravar(sessao, chave, { payload: { texto: 'v2' } }, '"1"');
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('etag')).toBe('"2"');
    const linhas = await rascunhosDe(sessao.usuarioId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ payload: { texto: 'v2' }, row_version: 2 });
  });

  it('If-Match W/"n" e n sem aspas também valem', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: {} });
    expect((await gravar(sessao, chave, { payload: { a: 1 } }, 'W/"1"')).status).toBe(200);
    expect((await gravar(sessao, chave, { payload: { a: 2 } }, '2')).status).toBe(200);
    expect((await rascunhosDe(sessao.usuarioId))[0]).toMatchObject({ row_version: 3 });
  });

  it('payload de até 512 KiB é aceito; acima, 422 validacao e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    // JSON.stringify({ t: '...' }) = 8 bytes de moldura + o texto.
    const limite = { t: 'x'.repeat(512 * 1024 - 8) };
    expect((await gravar(sessao, novaChave(), { payload: limite })).status).toBe(200);
    const acima = { t: `${SENTINELA}${'x'.repeat(512 * 1024 - 8 - SENTINELA.length + 1)}` };
    const resposta = await gravar(sessao, novaChave(), { payload: acima });
    expect(resposta.status).toBe(422);
    const corpo = await resposta.json();
    expect(corpo).toMatchObject({ codigo: 'validacao', campos: ['payload'] });
    expect(JSON.stringify(corpo)).not.toContain(SENTINELA);
    expect(await rascunhosDe(sessao.usuarioId)).toHaveLength(1);
  });

  it('payload que não é objeto ou campo extra: 422 validacao', async () => {
    const sessao = await sessaoDeTeste();
    expect((await gravar(sessao, novaChave(), { payload: 'x' })).status).toBe(422);
    expect(
      (await gravar(sessao, novaChave(), { payload: {}, usuario_id: crypto.randomUUID() })).status,
    ).toBe(422);
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([]);
  });

  it('nada é apagado: não existe rota DELETE e o rascunho continua', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { texto: 'fica' } });
    expect((await pedir('DELETE', `/api/rascunhos/${chave}`, sessao)).status).toBe(404);
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([
      expect.objectContaining({ payload: { texto: 'fica' } }),
    ]);
  });

  it('nada é apagado: gravar a evolução do paciente não mexe no rascunho', async () => {
    const sessao = await sessaoDeTeste();
    const [paciente] = await comoAdmin<{ id: string }>(
      `insert into paciente (usuario_id, nome) values ($1, 'Maria') returning id`,
      [sessao.usuarioId],
    );
    await gravar(sessao, `evolucao/${paciente!.id}`, { payload: { texto: 'em edição' } });
    expect(
      (await pedir('POST', '/api/evolucoes', sessao, { paciente_id: paciente!.id, texto: 'x' }))
        .status,
    ).toBe(201);
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([
      expect.objectContaining({ payload: { texto: 'em edição' }, row_version: 1 }),
    ]);
  });

  it('o conteúdo do rascunho não vai para a auditoria', async () => {
    const sessao = await sessaoDeTeste();
    await gravar(sessao, novaChave(), { payload: { texto: SENTINELA } });
    const auditoria = await comoAdmin('select * from audit_log where usuario_id = $1', [
      sessao.usuarioId,
    ]);
    expect(JSON.stringify(auditoria)).not.toContain(SENTINELA);
  });
});

describe('If-Match (RAS-02)', LENTO, () => {
  it('versão divergente: 412 PRECONDITION_FAILED e o rascunho não muda', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { texto: 'v1' } });
    await gravar(sessao, chave, { payload: { texto: 'v2' } }, '"1"');
    await esperarProblema(
      await gravar(sessao, chave, { payload: { texto: 'velho' } }, '"1"'),
      412,
      PROBLEMA_VERSAO_RASCUNHO,
    );
    expect((await rascunhosDe(sessao.usuarioId))[0]).toMatchObject({
      payload: { texto: 'v2' },
      row_version: 2,
    });
  });

  it('rascunho existente sem If-Match ou com "0": 412', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { texto: 'v1' } });
    await esperarProblema(
      await gravar(sessao, chave, { payload: {} }),
      412,
      PROBLEMA_VERSAO_RASCUNHO,
    );
    await esperarProblema(
      await gravar(sessao, chave, { payload: {} }, '"0"'),
      412,
      PROBLEMA_VERSAO_RASCUNHO,
    );
    expect((await rascunhosDe(sessao.usuarioId))[0]).toMatchObject({ row_version: 1 });
  });

  it('rascunho inexistente com outra versão no If-Match: 412 e nada é criado', async () => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await gravar(sessao, novaChave(), { payload: {} }, '"3"'),
      412,
      PROBLEMA_VERSAO_RASCUNHO,
    );
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([]);
  });

  it('If-Match em formato inválido: 400', async () => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await gravar(sessao, novaChave(), { payload: {} }, 'lixo'),
      400,
      PROBLEMA_RASCUNHO_INVALIDO,
    );
  });
});

describe('chave (tipo, ref)', LENTO, () => {
  it.each([
    ['ref de evolucao que não é UUID', 'evolucao/texto-livre'],
    ['ref de anamnese que não é UUID', 'anamnese/p1'],
    ['tipo com espaço', 'ev%20x/r9'],
    ['tipo acima de 120', `${'x'.repeat(121)}/r9`],
  ])('%s: 400 e nada é gravado', async (_rotulo, caminho) => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await gravar(sessao, caminho, { payload: {} }),
      400,
      PROBLEMA_RASCUNHO_INVALIDO,
    );
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([]);
  });

  // SEC-007 (T218): teste alterado com aprovação do usuário (2026-10-30). Antes, `nota` no formato
  // do legado era aceito (200); agora só os tipos que o app usa, evolucao e anamnese (RAS-05).
  it.each([
    ['tipo fora da lista no formato do legado', 'nota/a.b:c-d_e'],
    ['tipo fora da lista com ref UUID', `nota/${crypto.randomUUID()}`],
    ['tipo com maiúscula', `Evolucao/${crypto.randomUUID()}`],
  ])('%s: 422 validacao em tipo e nada é gravado', async (_rotulo, caminho) => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await gravar(sessao, caminho, { payload: { texto: SENTINELA } }),
      422,
      PROBLEMA_TIPO_RASCUNHO,
    );
    expect(await rascunhosDe(sessao.usuarioId)).toEqual([]);
  });
});

// RAS-05 (T218, SEC-007): até 2.000 rascunhos por profissional (decisão do usuário, 2026-10-30,
// sem purga: rascunho nunca é apagado). Os rascunhos de enchimento entram direto no banco.
describe('teto de quantidade (RAS-05)', LENTO, () => {
  const encher = (usuarioId: string, quantos: number) =>
    comoAdmin(
      `insert into rascunho (usuario_id, tipo, ref, payload)
       select $1, 'evolucao', gen_random_uuid()::text, '{}'::jsonb from generate_series(1, $2)`,
      [usuarioId, quantos],
    );

  it('o teto é 2.000', () => {
    expect(RASCUNHOS_MAXIMO_POR_PROFISSIONAL).toBe(2000);
  });

  it('com 1.999 rascunhos, o 2.000º é aceito; o seguinte, 409 DRAFT_QUOTA e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    await encher(sessao.usuarioId, RASCUNHOS_MAXIMO_POR_PROFISSIONAL - 1);

    expect((await gravar(sessao, novaChave(), { payload: { texto: 'último' } })).status).toBe(200);
    await esperarProblema(
      await gravar(sessao, novaChave(), { payload: { texto: SENTINELA } }),
      409,
      PROBLEMA_COTA_RASCUNHO,
    );
    await esperarProblema(
      await gravar(sessao, `anamnese/${crypto.randomUUID()}`, { payload: {} }, '"0"'),
      409,
      PROBLEMA_COTA_RASCUNHO,
    );
    const [{ total }] = (await comoAdmin<{ total: number }>(
      'select count(*)::int as total from rascunho where usuario_id = $1',
      [sessao.usuarioId],
    )) as [{ total: number }];
    expect(total).toBe(RASCUNHOS_MAXIMO_POR_PROFISSIONAL);
  });

  it('com o teto cheio, atualizar um rascunho existente continua 200', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { texto: 'v1' } });
    await encher(sessao.usuarioId, RASCUNHOS_MAXIMO_POR_PROFISSIONAL - 1);

    const resposta = await gravar(sessao, chave, { payload: { texto: 'v2' } }, '"1"');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ payload: { texto: 'v2' }, row_version: 2 });
  });

  it('a cota é por profissional: o teto cheio de A não afeta B', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    await encher(a.usuarioId, RASCUNHOS_MAXIMO_POR_PROFISSIONAL);

    expect((await gravar(a, novaChave(), { payload: {} })).status).toBe(409);
    expect((await gravar(b, novaChave(), { payload: {} })).status).toBe(200);
  });

  it('a conferência de versão vem antes da cota: If-Match errado em chave nova continua 412', async () => {
    const sessao = await sessaoDeTeste();
    await encher(sessao.usuarioId, RASCUNHOS_MAXIMO_POR_PROFISSIONAL);

    await esperarProblema(
      await gravar(sessao, novaChave(), { payload: {} }, '"3"'),
      412,
      PROBLEMA_VERSAO_RASCUNHO,
    );
  });
});

// RAS-05 (T219, SEC-007): até 25 MiB somados por profissional (decisão do usuário, 2026-10-30),
// medidos como no limite de 512 KiB (bytes UTF-8 do JSON enviado). Rascunhos de enchimento entram
// direto no banco com a coluna bytes preenchida; o payload deles não importa para a soma.
describe('teto de bytes (RAS-05)', LENTO, () => {
  // JSON.stringify({ t: '...' }) = 8 bytes de moldura + o texto: exatamente 512 KiB.
  const CHEIO = { t: 'x'.repeat(PAYLOAD_RASCUNHO_MAXIMO - 8) };
  const encherBytes = (usuarioId: string, quantos: number, bytes: number) =>
    comoAdmin(
      `insert into rascunho (usuario_id, tipo, ref, payload, bytes)
       select $1, 'evolucao', gen_random_uuid()::text, '{}'::jsonb, $3 from generate_series(1, $2)`,
      [usuarioId, quantos, bytes],
    );
  const bytesGravados = async (usuarioId: string) =>
    (
      await comoAdmin<{ bytes: number | null }>(
        'select bytes from rascunho where usuario_id = $1 and payload <> $2::jsonb order by bytes',
        [usuarioId, '{}'],
      )
    ).map((l) => l.bytes);

  it('o teto é 25 MiB, 50 rascunhos de 512 KiB', () => {
    expect(BYTES_RASCUNHOS_MAXIMO_POR_PROFISSIONAL).toBe(25 * 1024 * 1024);
    expect(BYTES_RASCUNHOS_MAXIMO_POR_PROFISSIONAL / PAYLOAD_RASCUNHO_MAXIMO).toBe(50);
  });

  it('a rota grava os bytes do payload com a medida do contrato', async () => {
    const sessao = await sessaoDeTeste();
    await gravar(sessao, novaChave(), { payload: CHEIO });
    await gravar(sessao, novaChave(), { payload: { texto: 'ção' } });

    // {"texto":"ção"}: 12 bytes de moldura + "ção" em UTF-8 (ç e ã com 2 bytes cada, o com 1).
    expect(await bytesGravados(sessao.usuarioId)).toEqual([17, PAYLOAD_RASCUNHO_MAXIMO]);
  });

  it('rascunhos de 512 KiB passam até o teto e o seguinte responde 409 DRAFT_QUOTA', async () => {
    const sessao = await sessaoDeTeste();
    await encherBytes(sessao.usuarioId, 47, PAYLOAD_RASCUNHO_MAXIMO);

    for (let i = 0; i < 3; i += 1)
      expect((await gravar(sessao, novaChave(), { payload: CHEIO })).status).toBe(200);
    await esperarProblema(
      await gravar(sessao, novaChave(), { payload: { t: 'x' } }),
      409,
      PROBLEMA_COTA_RASCUNHO,
    );
    const [{ soma }] = (await comoAdmin<{ soma: number }>(
      'select sum(bytes)::int as soma from rascunho where usuario_id = $1',
      [sessao.usuarioId],
    )) as [{ soma: number }];
    expect(soma).toBe(BYTES_RASCUNHOS_MAXIMO_POR_PROFISSIONAL);
  });

  it('vale em bytes mesmo com poucos rascunhos grandes, bem abaixo do teto de quantidade', async () => {
    const sessao = await sessaoDeTeste();
    await encherBytes(sessao.usuarioId, 2, BYTES_RASCUNHOS_MAXIMO_POR_PROFISSIONAL / 2);

    expect((await gravar(sessao, novaChave(), { payload: {} })).status).toBe(409);
  });

  it('com o teto cheio, trocar o payload de um rascunho existente por um menor ou igual é aceito', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: CHEIO });
    await encherBytes(sessao.usuarioId, 49, PAYLOAD_RASCUNHO_MAXIMO);

    expect((await gravar(sessao, chave, { payload: CHEIO }, '"1"')).status).toBe(200);
    expect((await gravar(sessao, chave, { payload: { t: 'menor' } }, '"2"')).status).toBe(200);
    expect(await bytesGravados(sessao.usuarioId)).toEqual([JSON.stringify({ t: 'menor' }).length]);
  });

  it('com o teto cheio, trocar por um payload maior responde 409 e o rascunho não muda', async () => {
    const sessao = await sessaoDeTeste();
    const chave = novaChave();
    await gravar(sessao, chave, { payload: { t: 'pequeno' } });
    await encherBytes(sessao.usuarioId, 50, PAYLOAD_RASCUNHO_MAXIMO);

    await esperarProblema(
      await gravar(sessao, chave, { payload: { t: 'pequeno, mas maior' } }, '"1"'),
      409,
      PROBLEMA_COTA_RASCUNHO,
    );
    const [linha] = await comoAdmin<{ payload: unknown; row_version: number }>(
      'select payload, row_version from rascunho where usuario_id = $1 and ref = $2',
      [sessao.usuarioId, chave.split('/')[1]],
    );
    expect(linha).toEqual({ payload: { t: 'pequeno' }, row_version: 1 });
  });

  it('linha antiga sem bytes conta pelo tamanho do payload no banco', async () => {
    const sessao = await sessaoDeTeste();
    await comoAdmin(
      `insert into rascunho (usuario_id, tipo, ref, payload)
       select $1, 'evolucao', gen_random_uuid()::text, jsonb_build_object('t', repeat('x', $2))
       from generate_series(1, 50)`,
      [sessao.usuarioId, PAYLOAD_RASCUNHO_MAXIMO - 8],
    );

    expect((await gravar(sessao, novaChave(), { payload: {} })).status).toBe(409);
  });

  it('a cota de bytes é por profissional', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    await encherBytes(a.usuarioId, 50, PAYLOAD_RASCUNHO_MAXIMO);

    expect((await gravar(a, novaChave(), { payload: {} })).status).toBe(409);
    expect((await gravar(b, novaChave(), { payload: CHEIO })).status).toBe(200);
  });
});

describe('ler (GET /api/rascunhos)', LENTO, () => {
  it('filtra por tipo e ref e devolve {items}', async () => {
    const sessao = await sessaoDeTeste();
    const ref = crypto.randomUUID();
    await gravar(sessao, `evolucao/${ref}`, { payload: { texto: 'a' } });
    await gravar(sessao, `anamnese/${ref}`, { payload: { texto: 'b' } });
    expect(await ler(sessao, `?tipo=evolucao&ref=${ref}`)).toEqual([
      expect.objectContaining({ tipo: 'evolucao', ref, payload: { texto: 'a' }, row_version: 1 }),
    ]);
    expect(await ler(sessao, '?tipo=anamnese')).toEqual([
      expect.objectContaining({ tipo: 'anamnese', ref }),
    ]);
    expect(await ler(sessao, '')).toHaveLength(2);
    expect(await ler(sessao, `?tipo=evolucao&ref=${crypto.randomUUID()}`)).toEqual([]);
  });

  it('chave inválida na consulta: 400', async () => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await pedir('GET', '/api/rascunhos?tipo=evolucao&ref=texto-livre', sessao),
      400,
      PROBLEMA_RASCUNHO_INVALIDO,
    );
    await esperarProblema(
      await pedir('GET', '/api/rascunhos?tipo=ev%20x', sessao),
      400,
      PROBLEMA_RASCUNHO_INVALIDO,
    );
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('B não vê nem sobrescreve o rascunho de A com a mesma chave', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const ref = crypto.randomUUID();
    await gravar(a, `evolucao/${ref}`, { payload: { texto: SENTINELA } });

    const leitura = await pedir('GET', `/api/rascunhos?tipo=evolucao&ref=${ref}`, b);
    expect(await leitura.text()).not.toContain(SENTINELA);
    // Para B a chave não existe: "0" cria o rascunho dele, versão 1.
    const resposta = await gravar(b, `evolucao/${ref}`, { payload: { texto: 'de B' } }, '"0"');
    expect(resposta.status).toBe(200);
    expect(await rascunhosDe(a.usuarioId)).toEqual([
      expect.objectContaining({ payload: { texto: SENTINELA }, row_version: 1 }),
    ]);
    expect(await rascunhosDe(b.usuarioId)).toEqual([
      expect.objectContaining({ payload: { texto: 'de B' }, row_version: 1 }),
    ]);
  });
});
