import {
  type Anamnese,
  type ModeloAnamnese,
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_JANELA_ABERTA,
  PROBLEMA_RETIFICACAO_CONCORRENTE,
  PROBLEMA_SEM_CONTEUDO_NOVO,
  PROBLEMA_VALOR_INVALIDO,
} from '@es/contrato/anamnese';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T96 / ANA-06, ANA-07, ANA-08, ANA-09, ISO-02: POST /api/anamneses/:id/retificacoes.
// - ANA-06: depois do dia do cadastro, com motivo de 1 a 5.000, cria uma nova versão completa
//   e preserva a original; a versão vigente passa a ser a nova (e os alertas são os dela).
// - ANA-07: no dia do cadastro, 409 EDIT_WINDOW_OPEN.
// - ANA-08: sem conteúdo novo em relação à versão vigente, 400.
// - ISO-02: anamnese de outro profissional = 404 igual ao inexistente, sem gravar.
// Decisões do usuário (2026-10-26): 409 RECTIFICATION_CONFLICT para duas retificações ao mesmo
// tempo; 201 com a anamnese; auditoria só com contagens (nunca motivo nem valores).

const SENTINELA = 'SENTINELA-CLINICA';
// Cada caso registra perfil, modelo e anamnese pela API antes de retificar: com a máquina
// carregada passa dos 5 s padrão (mesmo padrão LENTO dos testes de autenticação).
const LENTO = { timeout: 30_000 };

const retificar = (sessao: Sessao, id: string, corpo: Record<string, unknown>) =>
  pedir('POST', `/api/anamneses/${id}/retificacoes`, sessao, corpo);

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const retificacoesNoBanco = (anamneseId: string) =>
  comoAdmin<{ seq: number; motivo: string; modelo_revisao: number; valores: unknown }>(
    `select seq, motivo, modelo_revisao, valores from anamnese_retificacao
     where anamnese_id = $1 order by seq`,
    [anamneseId],
  );
const anamneseNoBanco = async (id: string) =>
  (
    await comoAdmin<{ valores: unknown; modelo_revisao: number; row_version: number }>(
      'select valores, modelo_revisao, row_version from anamnese where id = $1',
      [id],
    )
  )[0];

// Anamnese registrada pela rota (alerta "Risco de suicídio" marcado) e, se `ontem`, com a criação
// recuada para o dia anterior no relógio do banco.
async function comAnamnese(ontem = true) {
  const sessao = await sessaoDeTeste();
  await pedir('PUT', '/api/perfil', sessao, {
    nome: 'Dra. Ana',
    especialidade: { tipo: 'psicologia', nome: null },
  });
  const modelo = (await (
    await pedir('GET', '/api/modelo-anamnese', sessao)
  ).json()) as ModeloAnamnese;
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const [queixa] = modelo.campos;
  const [suicidio] = modelo.alertas;
  const resposta = await pedir('POST', `/api/pacientes/${pacienteId}/anamnese`, sessao, {
    data_sessao: '2026-10-25',
    modelo_revisao: 1,
    valores: { [queixa!.id]: 'dor', [suicidio!.id]: { marcado: true, obs: null } },
  });
  expect(resposta.status).toBe(201);
  const anamnese = (await resposta.json()) as Anamnese;
  if (ontem) {
    expect(anamnese.id).toMatch(/^[0-9a-f-]{36}$/);
    await comoAdmin(
      `begin; set local session_replication_role = replica;
       update anamnese set criado_em = now() - interval '1 day' where id = '${anamnese.id}'; commit;`,
    );
  }
  return { sessao, modelo, pacienteId, anamnese };
}

describe('exige sessão', LENTO, () => {
  it('sem sessão: 401', async () => {
    const resposta = await pedir(
      'POST',
      `/api/anamneses/${crypto.randomUUID()}/retificacoes`,
      null,
      {},
    );
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('retificar depois do dia do cadastro (ANA-06)', LENTO, () => {
  it('201: nova versão vigente com os alertas dela; a original fica intacta', async () => {
    const { sessao, modelo, pacienteId, anamnese } = await comAnamnese();
    const [queixa] = modelo.campos;
    const [suicidio, automutilacao] = modelo.alertas;
    const novaVersao = {
      [queixa!.id]: SENTINELA,
      [suicidio!.id]: { marcado: false, obs: null },
      [automutilacao!.id]: { marcado: true, obs: null },
    };
    const resposta = await retificar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: novaVersao,
      motivo: `  ${SENTINELA} motivo  `,
    });
    expect(resposta.status).toBe(201);
    const retificada = (await resposta.json()) as Anamnese;
    expect(retificada).toMatchObject({
      id: anamnese.id,
      valores: anamnese.valores,
      modelo_revisao: 1,
      estado: 'registrada',
      versao_vigente: 1,
      alerta_clinico: true,
      alertas: [{ item_id: automutilacao!.id, rotulo: 'Automutilação' }],
    });
    expect(retificada.retificacoes).toEqual([
      {
        seq: 1,
        motivo: `${SENTINELA} motivo`,
        modelo_revisao: 1,
        valores: { [queixa!.id]: SENTINELA, [automutilacao!.id]: { marcado: true, obs: null } },
        criado_em: expect.any(String),
      },
    ]);
    const lida = (await (
      await pedir('GET', `/api/pacientes/${pacienteId}/anamnese`, sessao)
    ).json()) as {
      anamnese: Anamnese;
    };
    expect(lida.anamnese).toEqual(retificada);
    expect(await anamneseNoBanco(anamnese.id)).toEqual({
      valores: anamnese.valores,
      modelo_revisao: 1,
      row_version: 1,
    });

    const eventos = await auditoriaDe(sessao.usuarioId, 'anamnese.retificada');
    expect(eventos).toEqual([
      expect.objectContaining({
        alvo_tipo: 'anamnese',
        alvo_id: anamnese.id,
        campos_alterados: ['itens_alterados_3', 'revisao_1'],
      }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('segunda retificação: seq 2 vira a vigente e as anteriores ficam', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const queixa = modelo.campos[0]!.id;
    expect(
      (
        await retificar(sessao, anamnese.id, {
          modelo_revisao: 1,
          valores: { [queixa]: 'a' },
          motivo: 'm1',
        })
      ).status,
    ).toBe(201);
    const resposta = await retificar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: { [queixa]: 'b' },
      motivo: 'm2',
    });
    expect(resposta.status).toBe(201);
    const retificada = (await resposta.json()) as Anamnese;
    expect(retificada.versao_vigente).toBe(2);
    expect(retificada.alerta_clinico).toBe(false);
    expect(await retificacoesNoBanco(anamnese.id)).toEqual([
      { seq: 1, motivo: 'm1', modelo_revisao: 1, valores: { [queixa]: 'a' } },
      { seq: 2, motivo: 'm2', modelo_revisao: 1, valores: { [queixa]: 'b' } },
    ]);
  });

  it('pode preencher item incluído no modelo depois do cadastro (revisão nova)', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const novo = (await (
      await pedir('PUT', '/api/modelo-anamnese', sessao, {
        campos: [...modelo.campos, { rotulo: 'Sono' }],
        alertas: modelo.alertas,
        row_version: modelo.row_version,
      })
    ).json()) as ModeloAnamnese;
    const sono = novo.campos.at(-1)!.id;
    const resposta = await retificar(sessao, anamnese.id, {
      modelo_revisao: 2,
      valores: { ...anamnese.valores, [sono]: 'insônia' },
      motivo: 'Faltou o sono',
    });
    expect(resposta.status).toBe(201);
    expect(((await resposta.json()) as Anamnese).retificacoes[0]).toMatchObject({
      modelo_revisao: 2,
    });
  });
});

describe('recusas', LENTO, () => {
  it('no dia do cadastro: 409 EDIT_WINDOW_OPEN e nada é gravado (ANA-07)', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese(false);
    await esperarProblema(
      await retificar(sessao, anamnese.id, {
        modelo_revisao: 1,
        valores: { [modelo.campos[0]!.id]: 'outra' },
        motivo: 'Correção',
      }),
      409,
      PROBLEMA_JANELA_ABERTA,
    );
    expect(await retificacoesNoBanco(anamnese.id)).toEqual([]);
  });

  it('sem conteúdo novo em relação à vigente: 400 e nada é gravado (ANA-08)', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const [queixa] = modelo.campos;
    const [suicidio] = modelo.alertas;
    await esperarProblema(
      await retificar(sessao, anamnese.id, {
        modelo_revisao: 1,
        valores: { [suicidio!.id]: { obs: null, marcado: true }, [queixa!.id]: '  dor  ' },
        motivo: 'Nada muda',
      }),
      400,
      PROBLEMA_SEM_CONTEUDO_NOVO,
    );
    // Depois de uma retificação, a comparação é com ela (a vigente).
    await retificar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: { [queixa!.id]: 'x' },
      motivo: 'm',
    });
    await esperarProblema(
      await retificar(sessao, anamnese.id, {
        modelo_revisao: 1,
        valores: { [queixa!.id]: 'x' },
        motivo: 'm',
      }),
      400,
      PROBLEMA_SEM_CONTEUDO_NOVO,
    );
    expect(await retificacoesNoBanco(anamnese.id)).toHaveLength(1);
  });

  it('motivo vazio, só espaços, ausente ou com 5.001: 422 validacao (ANA-06)', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const valores = { [modelo.campos[0]!.id]: 'nova' };
    for (const motivo of ['', '   ', undefined, 'x'.repeat(5001)]) {
      const resposta = await retificar(sessao, anamnese.id, { modelo_revisao: 1, valores, motivo });
      expect(resposta.status, String(motivo?.length)).toBe(422);
      expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['motivo'] });
    }
    expect(
      (
        await retificar(sessao, anamnese.id, {
          modelo_revisao: 1,
          valores,
          motivo: 'x'.repeat(5000),
        })
      ).status,
    ).toBe(201);
  });

  it('valores inválidos ou revisão do modelo que não existe: 422 ANAMNESIS_VALUE_INVALID', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    for (const corpo of [
      { modelo_revisao: 1, valores: { [modelo.campos[0]!.id]: SENTINELA.repeat(295) } },
      { modelo_revisao: 1, valores: { [crypto.randomUUID()]: 'x' } },
      { modelo_revisao: 2, valores: { [modelo.campos[0]!.id]: 'x' } },
    ]) {
      const problema = await esperarProblema(
        await retificar(sessao, anamnese.id, { ...corpo, motivo: 'Correção' }),
        422,
        PROBLEMA_VALOR_INVALIDO,
      );
      expect(JSON.stringify(problema)).not.toContain(SENTINELA);
    }
    expect(await retificacoesNoBanco(anamnese.id)).toEqual([]);
  });

  it('anamnese de outro profissional, inexistente ou id malformado: 404 (ISO-02)', async () => {
    const outro = await comAnamnese();
    const sessao = await sessaoDeTeste();
    for (const id of [outro.anamnese.id, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await retificar(sessao, id, { modelo_revisao: 1, valores: {}, motivo: 'x' }),
        404,
        PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
      );
    expect(await retificacoesNoBanco(outro.anamnese.id)).toEqual([]);
  });
});

describe('duas retificações ao mesmo tempo (decisão do usuário)', LENTO, () => {
  it('a que esbarra na outra responde 409 RECTIFICATION_CONFLICT', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const queixa = modelo.campos[0]!.id;
    const admin = new pg.Client({
      connectionString: (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN
        .connectionString,
    });
    admin.on('error', () => {});
    await admin.connect();
    try {
      // Outra retificação (seq 1) ainda não confirmada segura o seq no índice único.
      await admin.query('begin');
      await admin.query(
        `insert into anamnese_retificacao (usuario_id, anamnese_id, seq, motivo, modelo_revisao, valores)
         values ($1, $2, 1, 'Outra aba', 1, '{}')`,
        [sessao.usuarioId, anamnese.id],
      );
      const pedido = retificar(sessao, anamnese.id, {
        modelo_revisao: 1,
        valores: { [queixa]: 'nova' },
        motivo: 'Esta aba',
      });
      // Espera a requisição ficar presa no índice único, esperando a outra transação.
      const limite = Date.now() + 20_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 250));
        const { rows } = await admin.query<{ total: string }>(
          `select count(*)::text as total from pg_locks l join pg_stat_activity a on a.pid = l.pid
           where not l.granted and a.usename = 'app' and a.query ilike '%anamnese_retificacao%'`,
        );
        if (rows[0]!.total !== '0') break;
        if (Date.now() > limite) throw new Error('a requisição não chegou a esperar o índice');
      }
      await admin.query('commit');
      await esperarProblema(await pedido, 409, PROBLEMA_RETIFICACAO_CONCORRENTE);
    } finally {
      await admin.end();
    }
    expect((await retificacoesNoBanco(anamnese.id)).map((r) => r.motivo)).toEqual(['Outra aba']);
  });
});
