import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_PERFIL_NAO_ENCONTRADO } from '@es/contrato/perfil';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';

// T62 / PERF-01, PERF-02, PERF-03, PERF-09, ISO-02: GET e PUT /api/perfil. Chave desconhecida
// responde 422 e vazio vira null; uma especialidade só, "outra" com nome de 1 a 60; a auditoria
// perfil.editado leva só os nomes dos campos e só quando algo mudou; outro profissional não
// enxerga o perfil (o mesmo 404 de perfil inexistente). Casos do T-028 e do T-215 do legado
// (backend/test/profile.spec.ts) vêm junto, sem o histórico, que não está na spec.

type Sessao = Awaited<ReturnType<typeof sessaoDeTeste>>;

const app = criarApp({ capturarErro: () => {} });

function pedir(metodo: 'GET' | 'PUT', caminho: string, sessao: Sessao | null, corpo?: unknown) {
  return app.request(
    caminho,
    {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    },
    env,
  );
}

const salvar = (sessao: Sessao, corpo: unknown) => pedir('PUT', '/api/perfil', sessao, corpo);
const ler = (sessao: Sessao) => pedir('GET', '/api/perfil', sessao);

const linhaPerfil = async (usuarioId: string) =>
  (
    await comoAdmin<Record<string, unknown>>(
      `select id, nome, contato, endereco, atende_sabado, atende_domingo, especialidade,
              especialidade_nome, conselho, numero_registro, regiao, row_version, atualizado_em
       from perfil where usuario_id = $1`,
      [usuarioId],
    )
  )[0];

const auditoria = (usuarioId: string) =>
  comoAdmin<{
    ator: string;
    acao: string;
    alvo_tipo: string;
    alvo_id: string;
    campos_alterados: string[];
  }>(
    `select ator, acao, alvo_tipo, alvo_id, campos_alterados from audit_log
     where usuario_id = $1 and acao = 'perfil.editado' order by id`,
    [usuarioId],
  );

const PSICOLOGIA = {
  tipo: 'psicologia',
  nome: null,
  conselho: 'CRP',
  numero_registro: '06/123',
  regiao: 'SP',
};

describe('GET e PUT /api/perfil exigem sessão e CSRF', () => {
  it('sem sessão responde 401 nas duas', async () => {
    for (const metodo of ['GET', 'PUT'] as const) {
      const resposta = await pedir(
        metodo,
        '/api/perfil',
        null,
        metodo === 'PUT' ? { nome: 'A' } : undefined,
      );
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });

  it('PUT sem x-csrf-token responde 403 e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    const resposta = await app.request(
      '/api/perfil',
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({ nome: 'Dra. Ana' }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await linhaPerfil(sessao.usuarioId)).toBeUndefined();
  });
});

describe('ler e salvar o perfil (PERF-02)', () => {
  it('GET antes do primeiro salvamento responde 404; PUT cria; GET devolve', async () => {
    const sessao = await sessaoDeTeste();

    const antes = await ler(sessao);
    expect(antes.status).toBe(404);
    expect(antes.headers.get('content-type')).toContain('application/problem+json');
    expect(await antes.json()).toEqual(PROBLEMA_PERFIL_NAO_ENCONTRADO);

    const criado = await salvar(sessao, { nome: 'Dra. Ana', contato: '111' });
    const esperado = {
      nome: 'Dra. Ana',
      contato: '111',
      endereco: null,
      atende_sabado: false,
      atende_domingo: false,
      especialidade: null,
    };
    expect(criado.status).toBe(200);
    expect(await criado.json()).toEqual(esperado);

    const depois = await ler(sessao);
    expect(depois.status).toBe(200);
    expect(await depois.json()).toEqual(esperado);
  });

  it('apara os textos e grava vazio como null', async () => {
    const sessao = await sessaoDeTeste();

    await salvar(sessao, { nome: '  Dra. Ana  ', contato: '   ', endereco: '' });

    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      nome: 'Dra. Ana',
      contato: null,
      endereco: null,
    });
  });

  it.each([
    ['chave desconhecida', { nome: 'Dra. Ana', crp: '06/1' }, ['crp']],
    ['usuario_id no corpo', { nome: 'Dra. Ana', usuario_id: crypto.randomUUID() }, ['usuario_id']],
    [
      'chave desconhecida na especialidade',
      { nome: 'A', especialidade: { tipo: 'nutricao', ordem: 1 } },
      // A chave desconhecida é nomeada, como no nível de cima (lerCorpo, http.ts).
      ['ordem'],
    ],
    ['sem nome', { contato: '111' }, ['nome']],
    ['nome com 201', { nome: 'x'.repeat(201) }, ['nome']],
    ['contato com 201', { nome: 'A', contato: 'x'.repeat(201) }, ['contato']],
    ['endereço com 301', { nome: 'A', endereco: 'x'.repeat(301) }, ['endereco']],
    ['flag que não é booleano', { nome: 'A', atende_sabado: 'sim' }, ['atende_sabado']],
  ])('%s responde 422 validacao e nada é gravado', async (_caso, corpo, campos) => {
    const sessao = await sessaoDeTeste();

    const resposta = await salvar(sessao, corpo);

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ status: 422, codigo: 'validacao', campos });
    expect(await linhaPerfil(sessao.usuarioId)).toBeUndefined();
    expect(await auditoria(sessao.usuarioId)).toEqual([]);
  });

  it('flags ausentes preservam o valor; só sábado não muda domingo (legado T-215)', async () => {
    const sessao = await sessaoDeTeste();
    const flags = async () => {
      const corpo = (await (await ler(sessao)).json()) as Record<string, boolean>;
      return [corpo['atende_sabado'], corpo['atende_domingo']];
    };

    await salvar(sessao, { nome: 'C', atende_sabado: true });
    expect(await flags()).toEqual([true, false]);
    await salvar(sessao, { nome: 'C', atende_domingo: true });
    expect(await flags()).toEqual([true, true]);
    await salvar(sessao, { nome: 'C2' });
    expect(await flags()).toEqual([true, true]);
    await salvar(sessao, { nome: 'C2', atende_sabado: false });
    expect(await flags()).toEqual([false, true]);
  });
});

describe('uma especialidade por profissional (PERF-03)', () => {
  it('salva psicologia com o registro profissional', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await salvar(sessao, { nome: 'Dra. Ana', especialidade: PSICOLOGIA });

    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as { especialidade: unknown }).especialidade).toEqual(
      PSICOLOGIA,
    );
    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      especialidade: 'psicologia',
      especialidade_nome: null,
      conselho: 'CRP',
      numero_registro: '06/123',
      regiao: 'SP',
    });
  });

  it('outra exige nome de 1 a 60', async () => {
    const sessao = await sessaoDeTeste();
    const outra = (nome?: string) =>
      salvar(sessao, {
        nome: 'Dra. Ana',
        especialidade: { tipo: 'outra', ...(nome !== undefined ? { nome } : {}) },
      });

    for (const invalido of [undefined, '', '   ', 'x'.repeat(61)]) {
      const resposta = await outra(invalido);
      expect(resposta.status, String(invalido)).toBe(422);
      expect(await resposta.json()).toMatchObject({
        codigo: 'validacao',
        campos: ['especialidade'],
      });
    }
    expect(await linhaPerfil(sessao.usuarioId)).toBeUndefined();

    expect((await outra('x'.repeat(60))).status).toBe(200);
    const resposta = await outra(' Arteterapia ');
    expect(resposta.status).toBe(200);
    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      especialidade: 'outra',
      especialidade_nome: 'Arteterapia',
    });
  });

  it('o nome da especialidade só vale para outra', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await salvar(sessao, {
      nome: 'Dra. Ana',
      especialidade: { tipo: 'nutricao', nome: 'Esportiva' },
    });

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ campos: ['especialidade'] });
  });

  it('recusa uma lista de especialidades', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await salvar(sessao, { nome: 'Dra. Ana', especialidade: [PSICOLOGIA] });

    expect(resposta.status).toBe(422);
  });

  it('trocar a especialidade substitui a anterior, sem acumular', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, { nome: 'Dra. Ana', especialidade: PSICOLOGIA });

    await salvar(sessao, { nome: 'Dra. Ana', especialidade: { tipo: 'fisioterapia' } });

    const linhas = await comoAdmin(
      'select especialidade, conselho from perfil where usuario_id = $1',
      [sessao.usuarioId],
    );
    expect(linhas).toEqual([{ especialidade: 'fisioterapia', conselho: null }]);
  });

  it('PUT sem especialidade preserva a atual', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, { nome: 'Dra. Ana', especialidade: PSICOLOGIA });

    await salvar(sessao, { nome: 'Dra. Ana Souza' });

    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      nome: 'Dra. Ana Souza',
      especialidade: 'psicologia',
      conselho: 'CRP',
    });
  });
});

describe('auditoria perfil.editado (PERF-09)', () => {
  it('registra só os nomes dos campos, sem os valores, com o perfil como alvo', async () => {
    const sessao = await sessaoDeTeste();

    await salvar(sessao, { nome: 'Dra. Ana', contato: '111' });
    await salvar(sessao, { nome: 'Dra. Ana Souza', contato: '111', especialidade: PSICOLOGIA });

    const perfil = await linhaPerfil(sessao.usuarioId);
    const eventos = await auditoria(sessao.usuarioId);
    expect(eventos).toEqual([
      {
        ator: sessao.usuarioId,
        acao: 'perfil.editado',
        alvo_tipo: 'perfil',
        alvo_id: perfil!['id'],
        campos_alterados: ['nome', 'contato'],
      },
      {
        ator: sessao.usuarioId,
        acao: 'perfil.editado',
        alvo_tipo: 'perfil',
        alvo_id: perfil!['id'],
        campos_alterados: ['nome', 'especialidade', 'conselho', 'numero_registro', 'regiao'],
      },
    ]);
    const tudo = JSON.stringify(
      await comoAdmin('select * from audit_log where usuario_id = $1', [sessao.usuarioId]),
    );
    for (const valor of ['Dra. Ana', 'Souza', '111', 'CRP', '06/123', 'psicologia'])
      expect(tudo).not.toContain(valor);
  });

  it('só a flag que mudou entra na auditoria', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, { nome: 'C', atende_sabado: true });

    await salvar(sessao, { nome: 'C', atende_sabado: false });

    expect((await auditoria(sessao.usuarioId)).map((e) => e.campos_alterados)).toEqual([
      ['nome', 'atende_sabado'],
      ['atende_sabado'],
    ]);
  });

  it('sem mudança, nada é gravado nem auditado', async () => {
    const sessao = await sessaoDeTeste();
    const corpo = { nome: 'Dra. Ana', contato: '111', especialidade: PSICOLOGIA };
    await salvar(sessao, corpo);
    const antes = await linhaPerfil(sessao.usuarioId);

    const resposta = await salvar(sessao, { ...corpo, nome: ' Dra. Ana ', endereco: '' });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ nome: 'Dra. Ana', contato: '111' });
    const depois = await linhaPerfil(sessao.usuarioId);
    expect(depois!['row_version']).toBe(antes!['row_version']);
    expect(depois!['atualizado_em']).toEqual(antes!['atualizado_em']);
    expect(await auditoria(sessao.usuarioId)).toHaveLength(1);
  });

  it('com mudança, a linha é alterada (row_version sobe)', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, { nome: 'Dra. Ana' });

    await salvar(sessao, { nome: 'Dra. Ana Souza' });

    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      nome: 'Dra. Ana Souza',
      row_version: 2,
    });
  });
});

describe('outro profissional não enxerga o perfil (ISO-02)', () => {
  it('B recebe o mesmo 404 de perfil inexistente; o PUT de B não toca A', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    await salvar(a, { nome: 'Dra. Ana', contato: '111', especialidade: PSICOLOGIA });

    const deB = await ler(b);
    expect(deB.status).toBe(404);
    expect(await deB.json()).toEqual(PROBLEMA_PERFIL_NAO_ENCONTRADO);

    expect((await salvar(b, { nome: 'Dr. Bruno' })).status).toBe(200);
    const corpoDeB = await (await ler(b)).text();
    expect(corpoDeB).not.toContain('Ana');
    expect(corpoDeB).not.toContain('111');
    expect(await linhaPerfil(a.usuarioId)).toMatchObject({ nome: 'Dra. Ana', contato: '111' });
    expect(await auditoria(b.usuarioId)).toHaveLength(1);
    expect(await auditoria(a.usuarioId)).toHaveLength(1);
  });
});

describe('GET /api/eu: perfil completo com nome e especialidade (PERF-01)', () => {
  const completo = async (sessao: Sessao) =>
    ((await (await pedir('GET', '/api/eu', sessao)).json()) as { perfil: { completo: boolean } })
      .perfil.completo;

  it('incompleto sem perfil e só com nome; completo com nome e especialidade', async () => {
    const sessao = await sessaoDeTeste();
    expect(await completo(sessao)).toBe(false);

    await salvar(sessao, { nome: 'Dra. Ana' });
    expect(await completo(sessao)).toBe(false);

    await salvar(sessao, { nome: 'Dra. Ana', especialidade: { tipo: 'nutricao' } });
    expect(await completo(sessao)).toBe(true);
  });
});
