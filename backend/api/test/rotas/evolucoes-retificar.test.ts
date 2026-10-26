import {
  PROBLEMA_JANELA_ABERTA,
  PROBLEMA_RETIFICACAO_CONCORRENTE,
  PROBLEMA_SEM_CONTEUDO_NOVO,
} from '@es/contrato/anamnese';
import {
  type Evolucao,
  type PaginaEvolucoes,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
} from '@es/contrato/clinico';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T103 / EVO-05, EVO-06, EVO-07, ISO-02: POST /api/evolucoes/:id/retificacoes.
// - EVO-05: depois do dia do cadastro, texto novo e motivo (até 100.000 cada) criam a
//   retificação e preservam a original; a versão vigente passa a ser a nova.
// - EVO-06: no dia do cadastro, 409 EDIT_WINDOW_OPEN.
// - EVO-07: não existe rota de exclusão da evolução.
// - ISO-02: evolução de outro profissional = 404 igual ao inexistente.
// Decisões do usuário (2026-10-26): o histórico de versões vem dentro da resposta da evolução
// (como na anamnese); retificar com o mesmo texto da versão vigente = 400 sem_conteudo_novo
// (simetria com o ANA-08); duas retificações ao mesmo tempo = 409 RECTIFICATION_CONFLICT, como na
// anamnese. Auditoria evolucao.retificada sem texto nem motivo (AUD-01).

const LENTO = { timeout: 30_000 };
const SENTINELA = 'SENTINELA-CLINICA';

const retificar = (sessao: Sessao | null, id: string, corpo: Record<string, unknown>) =>
  pedir('POST', `/api/evolucoes/${id}/retificacoes`, sessao, corpo);

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const linhaEvolucao = async (id: string) =>
  (
    await comoAdmin<{ texto: string; row_version: number }>(
      'select texto, row_version from evolucao where id = $1',
      [id],
    )
  )[0];
const retificacoesNoBanco = (id: string) =>
  comoAdmin<{ seq: number; texto: string; motivo: string }>(
    'select seq, texto, motivo from evolucao_retificacao where evolucao_id = $1 order by seq',
    [id],
  );

// Evolução registrada pela rota e recuada para ontem no relógio do banco (sem o trigger da
// janela, que barra o próprio ajuste).
async function comEvolucao(diasAtras = 1) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const resposta = await pedir('POST', '/api/evolucoes', sessao, {
    paciente_id: pacienteId,
    texto: 'original',
  });
  expect(resposta.status).toBe(201);
  const evolucao = (await resposta.json()) as Evolucao;
  if (diasAtras > 0)
    await comoAdmin(
      `begin; set local session_replication_role = replica;
       update evolucao set criado_em = now() - interval '${diasAtras} days' where id = '${evolucao.id}';
       commit;`,
    );
  return { sessao, pacienteId, evolucao };
}

describe('exige sessão', LENTO, () => {
  it('sem sessão, POST responde 401', async () => {
    const resposta = await retificar(null, crypto.randomUUID(), {});
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('retificar depois do dia (EVO-05)', LENTO, () => {
  it('201: cria a retificação, preserva a original e a vigente passa a ser a nova', async () => {
    const { sessao, pacienteId, evolucao } = await comEvolucao();
    const resposta = await retificar(sessao, evolucao.id, {
      texto: SENTINELA,
      motivo: 'Erro de digitação',
    });
    expect(resposta.status).toBe(201);
    const retificada = (await resposta.json()) as Evolucao;
    expect(retificada).toMatchObject({
      id: evolucao.id,
      texto: 'original',
      estado: 'registrada',
      row_version: 1,
      versao_vigente: 1,
      retificacoes: [{ seq: 1, texto: SENTINELA, motivo: 'Erro de digitação' }],
    });
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
    expect(await retificacoesNoBanco(evolucao.id)).toEqual([
      { seq: 1, texto: SENTINELA, motivo: 'Erro de digitação' },
    ]);
    const lista = (await (
      await pedir('GET', `/api/pacientes/${pacienteId}/evolucoes`, sessao)
    ).json()) as PaginaEvolucoes;
    expect(lista.items).toEqual([retificada]);
  });

  it('segunda retificação: seq 2, histórico completo e a original intacta', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await retificar(sessao, evolucao.id, { texto: 'v1', motivo: 'm1' });
    const resposta = await retificar(sessao, evolucao.id, { texto: 'v2', motivo: 'm2' });
    expect(resposta.status).toBe(201);
    const retificada = (await resposta.json()) as Evolucao;
    expect(retificada.versao_vigente).toBe(2);
    expect(retificada.retificacoes.map((r) => [r.seq, r.texto, r.motivo])).toEqual([
      [1, 'v1', 'm1'],
      [2, 'v2', 'm2'],
    ]);
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
  });

  it('audita evolucao.retificada só com nomes de campo, sem texto nem motivo', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await retificar(sessao, evolucao.id, { texto: SENTINELA, motivo: `${SENTINELA}-motivo` });
    const eventos = await auditoriaDe(sessao.usuarioId, 'evolucao.retificada');
    expect(eventos).toEqual([
      expect.objectContaining({
        alvo_tipo: 'evolucao',
        alvo_id: evolucao.id,
        campos_alterados: ['texto', 'motivo'],
      }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('texto e motivo de 100.000 são aceitos', async () => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await retificar(sessao, evolucao.id, {
      texto: 'x'.repeat(100_000),
      motivo: 'y'.repeat(100_000),
    });
    expect(resposta.status).toBe(201);
  });

  it.each([
    ['texto acima de 100.000', { texto: SENTINELA.repeat(5883), motivo: 'm' }],
    ['motivo acima de 100.000', { texto: 'novo', motivo: SENTINELA.repeat(5883) }],
    ['motivo vazio', { texto: 'novo', motivo: '  ' }],
    ['sem motivo', { texto: 'novo' }],
  ])('%s: 422 validacao sem ecoar e nada é criado', async (_rotulo, corpo) => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await retificar(sessao, evolucao.id, corpo);
    expect(resposta.status).toBe(422);
    const problema = await resposta.json();
    expect(problema).toMatchObject({ codigo: 'validacao' });
    expect(JSON.stringify(problema)).not.toContain(SENTINELA);
    expect(await retificacoesNoBanco(evolucao.id)).toEqual([]);
  });

  it('mesmo texto da versão vigente: 400 sem_conteudo_novo e nada é criado', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await esperarProblema(
      await retificar(sessao, evolucao.id, { texto: 'original', motivo: 'm' }),
      400,
      PROBLEMA_SEM_CONTEUDO_NOVO,
    );
    await retificar(sessao, evolucao.id, { texto: 'v1', motivo: 'm' });
    await esperarProblema(
      await retificar(sessao, evolucao.id, { texto: 'v1', motivo: 'outro' }),
      400,
      PROBLEMA_SEM_CONTEUDO_NOVO,
    );
    // Voltar ao texto da original é conteúdo novo em relação à vigente.
    expect((await retificar(sessao, evolucao.id, { texto: 'original', motivo: 'm' })).status).toBe(
      201,
    );
    expect((await retificacoesNoBanco(evolucao.id)).map((r) => r.texto)).toEqual([
      'v1',
      'original',
    ]);
  });
});

describe('duas retificações ao mesmo tempo (padrão da anamnese)', LENTO, () => {
  it('a que esbarra no seq da outra responde 409 RECTIFICATION_CONFLICT', async () => {
    const { sessao, evolucao } = await comEvolucao();
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
        `insert into evolucao_retificacao (usuario_id, evolucao_id, seq, texto, motivo)
         values ($1, $2, 1, 'Outra aba', 'm')`,
        [sessao.usuarioId, evolucao.id],
      );
      const pedido = retificar(sessao, evolucao.id, { texto: 'Esta aba', motivo: 'm' });
      // Espera a requisição ficar presa no índice único, esperando a outra transação.
      const limite = Date.now() + 20_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 250));
        const { rows } = await admin.query<{ total: string }>(
          `select count(*)::text as total from pg_locks l join pg_stat_activity a on a.pid = l.pid
           where not l.granted and a.usename = 'app' and a.query ilike '%evolucao_retificacao%'`,
        );
        if (rows[0]!.total !== '0') break;
        if (Date.now() > limite) throw new Error('a requisição não chegou a esperar o índice');
      }
      await admin.query('commit');
      await esperarProblema(await pedido, 409, PROBLEMA_RETIFICACAO_CONCORRENTE);
    } finally {
      await admin.end();
    }
    expect((await retificacoesNoBanco(evolucao.id)).map((r) => r.texto)).toEqual(['Outra aba']);
    expect(await auditoriaDe(sessao.usuarioId, 'evolucao.retificada')).toEqual([]);
  });
});

describe('no dia do cadastro (EVO-06)', LENTO, () => {
  it('409 EDIT_WINDOW_OPEN e nada é criado', async () => {
    const { sessao, evolucao } = await comEvolucao(0);
    await esperarProblema(
      await retificar(sessao, evolucao.id, { texto: 'novo', motivo: 'm' }),
      409,
      PROBLEMA_JANELA_ABERTA,
    );
    expect(await retificacoesNoBanco(evolucao.id)).toEqual([]);
  });
});

describe('sem exclusão (EVO-07)', LENTO, () => {
  it('não existe rota DELETE: a evolução e as retificações continuam', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await retificar(sessao, evolucao.id, { texto: 'v1', motivo: 'm' });
    for (const caminho of [
      `/api/evolucoes/${evolucao.id}`,
      `/api/evolucoes/${evolucao.id}/retificacoes`,
    ]) {
      const resposta = await pedir('DELETE', caminho, sessao);
      expect(resposta.status, caminho).toBe(404);
    }
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
    expect(await retificacoesNoBanco(evolucao.id)).toHaveLength(1);
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('evolução de outro profissional, inexistente ou id malformado: o mesmo 404', async () => {
    const outro = await comEvolucao();
    const sessao = await sessaoDeTeste();
    for (const id of [outro.evolucao.id, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await retificar(sessao, id, { texto: SENTINELA, motivo: 'm' }),
        404,
        PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
    expect(await retificacoesNoBanco(outro.evolucao.id)).toEqual([]);
  });
});
