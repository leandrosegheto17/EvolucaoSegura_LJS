import {
  type EventoTrilha,
  type PaginaAuditoria,
  PROBLEMA_AUDITORIA_NAO_ENCONTRADA,
  PROBLEMA_CONSULTA_AUDITORIA_INVALIDA,
} from '@es/contrato/auditoria';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, pedir, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao } from './sessoes-apoio.ts';

// T118 / AUD-03: GET /api/auditoria. "Trilha da minha conta" (sem paciente_id) ou "Histórico do
// paciente" (com paciente_id), em páginas de 50 com cursor (id do último evento da página, em
// ordem do mais novo para o mais antigo), sem `paciente.consultado`, com filtro Todos,
// Retificações e Exportações. Só eventos do profissional logado (ISO-02); paciente de outro
// profissional, inexistente ou id malformado = 404; parâmetro inválido ou desconhecido = 400.
// Adaptado de audit-account.spec.ts e patient-history.spec.ts do legado.

const LENTO = { timeout: 30_000 };

const CHAVES_DO_EVENTO = [
  'acao',
  'alvo_id',
  'alvo_tipo',
  'campos_alterados',
  'id',
  'ocorrido_em',
  'origem_ip',
  'origem_ua',
];

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

// Evento gravado direto pelo superusuário; os ids crescem na ordem de inclusão.
async function evento(
  usuarioId: string,
  acao: string,
  alvoTipo: string,
  alvoId: string | null = null,
): Promise<string> {
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id, campos_alterados)
     values ($1::uuid, $1::text, $2, $3, $4, '{texto}') returning id::text as id`,
    [usuarioId, acao, alvoTipo, alvoId],
  );
  return linha!.id;
}

// `quantos` eventos iguais de uma vez, em ordem de id.
const eventosEmLote = (usuarioId: string, quantos: number, acao = 'perfil.editado') =>
  comoAdmin(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo)
     select $1::uuid, $1::text, $2, 'perfil' from generate_series(1, $3::int)`,
    [usuarioId, acao, quantos],
  );

const pagina = async (sessao: Sessao, consulta = ''): Promise<PaginaAuditoria> => {
  const resposta = await pedir('GET', `/api/auditoria${consulta}`, sessao);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as PaginaAuditoria;
};

const acoes = (p: PaginaAuditoria) => p.items.map((i) => i.acao);

// Conta: eventos variados do profissional, com uma consulta de ficha que nunca aparece.
async function cenarioConta() {
  const prof = await sessaoDeTeste();
  const u = prof.usuarioId;
  const paciente = await semearPaciente(u, { nome: 'Ana' });
  await evento(u, 'auth.login_ok', 'auth');
  await evento(u, 'evolucao.retificada', 'evolucao', crypto.randomUUID());
  await evento(u, 'paciente.consultado', 'paciente', paciente);
  await evento(u, 'exportacao.concluida', 'exportacao');
  await evento(u, 'anamnese.retificada', 'anamnese', crypto.randomUUID());
  await evento(u, 'perfil.editado', 'perfil');
  return { prof, paciente };
}

// Paciente: um evento de cada tipo de alvo ligado a ele, mais ruído de outro paciente e da conta.
async function cenarioPaciente() {
  const prof = await sessaoDeTeste();
  const u = prof.usuarioId;
  const ana = await semearPaciente(u, { nome: 'Ana' });
  const bia = await semearPaciente(u, { nome: 'Bia' });
  const [modelo] = await comoAdmin<{ id: string }>(
    `insert into modelo_anamnese (usuario_id, especialidade) values ($1, 'psicologia')
     returning id`,
    [u],
  );
  const [anamnese] = await comoAdmin<{ id: string }>(
    `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao)
     values ($1, $2, $3, '2026-10-26', 1) returning id`,
    [u, ana, modelo!.id],
  );
  const [evolucaoAna] = await comoAdmin<{ id: string }>(
    `insert into evolucao (usuario_id, paciente_id, texto)
     values ($1, $2, 'TEXTO CLINICO SECRETO') returning id`,
    [u, ana],
  );
  const [evolucaoBia] = await comoAdmin<{ id: string }>(
    `insert into evolucao (usuario_id, paciente_id, texto) values ($1, $2, 'outro') returning id`,
    [u, bia],
  );
  const [serie] = await comoAdmin<{ id: string }>(
    `insert into serie_recorrencia (usuario_id, paciente_id, frequencia, ocorrencias)
     values ($1, $2, 'semanal', 2) returning id`,
    [u, ana],
  );
  const sessao = await semearSessao(u, ana, {
    inicio: '2026-10-01T12:00:00.000Z',
    fim: '2026-10-01T12:50:00.000Z',
    status: 'realizada',
  });
  const [pagamento] = await comoAdmin<{ id: string }>(
    `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
     values ($1, $2, 15000, '2026-10-01', 'pix') returning id`,
    [u, sessao],
  );

  await evento(u, 'paciente.inativado', 'paciente', ana);
  await evento(u, 'paciente.consultado', 'paciente', ana);
  await evento(u, 'anamnese.criada', 'anamnese', anamnese!.id);
  await evento(u, 'evolucao.criada', 'evolucao', evolucaoAna!.id);
  await evento(u, 'evolucao.retificada', 'evolucao', evolucaoAna!.id);
  await evento(u, 'evolucao.retificada', 'evolucao', evolucaoBia!.id);
  await evento(u, 'serie.criada', 'agendamento', serie!.id);
  await evento(u, 'sessao.status_alterado', 'agendamento', sessao);
  await evento(u, 'preco_sessao.ajustado', 'agendamento', sessao);
  await evento(u, 'pagamento.registrado', 'pagamento', pagamento!.id);
  await evento(u, 'preco_paciente.definido', 'paciente', ana);
  await evento(u, 'paciente.reativado', 'paciente', bia);
  await evento(u, 'exportacao.concluida', 'exportacao');
  await evento(u, 'perfil.editado', 'perfil');
  return { prof, ana, bia };
}

const HISTORICO_ANA = [
  'preco_paciente.definido',
  'pagamento.registrado',
  'preco_sessao.ajustado',
  'sessao.status_alterado',
  'serie.criada',
  'evolucao.retificada',
  'evolucao.criada',
  'anamnese.criada',
  'paciente.inativado',
];

describe('exige sessão', LENTO, () => {
  it('sem sessão, a trilha e o histórico respondem 401', async () => {
    const conta = await pedir('GET', '/api/auditoria', null);
    expect(conta.status).toBe(401);
    expect(await conta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    const historico = await pedir('GET', `/api/auditoria?paciente_id=${crypto.randomUUID()}`, null);
    expect(historico.status).toBe(401);
  });
});

describe('trilha da minha conta (AUD-03)', LENTO, () => {
  it('lista os eventos do mais novo ao mais antigo, sem paciente.consultado', async () => {
    const { prof } = await cenarioConta();
    const resposta = await pedir('GET', '/api/auditoria', prof);
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('content-type')).toContain('application/json');
    const corpo = (await resposta.json()) as PaginaAuditoria;
    expect(acoes(corpo)).toEqual([
      'perfil.editado',
      'anamnese.retificada',
      'exportacao.concluida',
      'evolucao.retificada',
      'auth.login_ok',
    ]);
    expect(corpo.proximo_cursor).toBeNull();
  });

  it('cada evento traz só metadados: ação, alvo, nomes de campo, origem e instante', async () => {
    const { prof } = await cenarioConta();
    const { items } = await pagina(prof);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(CHAVES_DO_EVENTO);
    const editado = items[0] as EventoTrilha;
    expect(editado).toMatchObject({
      acao: 'perfil.editado',
      alvo_tipo: 'perfil',
      alvo_id: null,
      campos_alterados: ['texto'],
      origem_ip: null,
      origem_ua: null,
    });
    expect(editado.id).toMatch(/^\d+$/);
    expect(new Date(editado.ocorrido_em).toISOString()).toBe(editado.ocorrido_em);
  });

  it('filtro todos é o mesmo que sem filtro', async () => {
    const { prof } = await cenarioConta();
    expect(acoes(await pagina(prof, '?filtro=todos'))).toEqual(acoes(await pagina(prof)));
  });

  it('filtro Retificações: só evolução e anamnese retificadas', async () => {
    const { prof } = await cenarioConta();
    const p = await pagina(prof, '?filtro=retificacoes');
    expect(acoes(p)).toEqual(['anamnese.retificada', 'evolucao.retificada']);
    expect(p.proximo_cursor).toBeNull();
  });

  it('filtro Exportações: só exportações', async () => {
    const { prof } = await cenarioConta();
    expect(acoes(await pagina(prof, '?filtro=exportacoes'))).toEqual(['exportacao.concluida']);
  });

  it('sem eventos: página vazia sem cursor', async () => {
    const prof = await sessaoDeTeste();
    expect(await pagina(prof)).toEqual({ items: [], proximo_cursor: null });
  });

  it('nunca devolve conteúdo clínico', async () => {
    const { prof } = await cenarioPaciente();
    const resposta = await pedir('GET', '/api/auditoria', prof);
    expect(await resposta.text()).not.toContain('SECRETO');
  });
});

describe('paginação por cursor (AUD-03)', LENTO, () => {
  it('páginas de 50: o cursor é o id do último evento e a última página vem sem cursor', async () => {
    const prof = await sessaoDeTeste();
    await eventosEmLote(prof.usuarioId, 51);
    const p1 = await pagina(prof);
    expect(p1.items).toHaveLength(50);
    expect(p1.proximo_cursor).toBe(p1.items[49]!.id);
    const p2 = await pagina(prof, `?cursor=${p1.proximo_cursor}`);
    expect(p2.items).toHaveLength(1);
    expect(p2.proximo_cursor).toBeNull();
    expect(Number(p2.items[0]!.id)).toBeLessThan(Number(p1.items[49]!.id));
    const ids = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(51);
  });

  it('exatamente 50 eventos: uma página só, sem cursor', async () => {
    const prof = await sessaoDeTeste();
    await eventosEmLote(prof.usuarioId, 50);
    const p = await pagina(prof);
    expect(p.items).toHaveLength(50);
    expect(p.proximo_cursor).toBeNull();
  });

  it('paciente.consultado não ocupa lugar na página', async () => {
    const prof = await sessaoDeTeste();
    await eventosEmLote(prof.usuarioId, 50);
    await eventosEmLote(prof.usuarioId, 10, 'paciente.consultado');
    const p = await pagina(prof);
    expect(p.items).toHaveLength(50);
    expect(p.proximo_cursor).toBeNull();
  });

  it('limit menor pagina do mesmo jeito (legado)', async () => {
    const { prof } = await cenarioConta();
    const p1 = await pagina(prof, '?limit=3');
    expect(acoes(p1)).toEqual(['perfil.editado', 'anamnese.retificada', 'exportacao.concluida']);
    expect(p1.proximo_cursor).toBe(p1.items[2]!.id);
    const p2 = await pagina(prof, `?limit=3&cursor=${p1.proximo_cursor}`);
    expect(acoes(p2)).toEqual(['evolucao.retificada', 'auth.login_ok']);
    expect(p2.proximo_cursor).toBeNull();
  });

  it('o filtro vale em todas as páginas', async () => {
    const prof = await sessaoDeTeste();
    const u = prof.usuarioId;
    await evento(u, 'evolucao.retificada', 'evolucao', crypto.randomUUID());
    await eventosEmLote(u, 60);
    await evento(u, 'anamnese.retificada', 'anamnese', crypto.randomUUID());
    const p1 = await pagina(prof, '?filtro=retificacoes&limit=1');
    expect(acoes(p1)).toEqual(['anamnese.retificada']);
    const p2 = await pagina(prof, `?filtro=retificacoes&limit=1&cursor=${p1.proximo_cursor}`);
    expect(acoes(p2)).toEqual(['evolucao.retificada']);
    expect(p2.proximo_cursor).toBeNull();
  });
});

describe('histórico do paciente (AUD-03)', LENTO, () => {
  it('só os eventos do paciente e dos registros dele, sem paciente.consultado', async () => {
    const { prof, ana } = await cenarioPaciente();
    const resposta = await pedir('GET', `/api/auditoria?paciente_id=${ana}`, prof);
    expect(resposta.status).toBe(200);
    const texto = await resposta.text();
    expect(texto).not.toContain('SECRETO');
    const corpo = JSON.parse(texto) as PaginaAuditoria;
    expect(acoes(corpo)).toEqual(HISTORICO_ANA);
    expect(corpo.proximo_cursor).toBeNull();
    for (const item of corpo.items) expect(Object.keys(item).sort()).toEqual(CHAVES_DO_EVENTO);
  });

  it('o histórico de outro paciente não traz os eventos da Ana', async () => {
    const { prof, bia } = await cenarioPaciente();
    expect(acoes(await pagina(prof, `?paciente_id=${bia}`))).toEqual([
      'paciente.reativado',
      'evolucao.retificada',
    ]);
  });

  it('filtros Retificações e Exportações no histórico', async () => {
    const { prof, ana } = await cenarioPaciente();
    expect(acoes(await pagina(prof, `?paciente_id=${ana}&filtro=retificacoes`))).toEqual([
      'evolucao.retificada',
    ]);
    expect(await pagina(prof, `?paciente_id=${ana}&filtro=exportacoes`)).toEqual({
      items: [],
      proximo_cursor: null,
    });
  });

  it('paginação por cursor no histórico', async () => {
    const { prof, ana } = await cenarioPaciente();
    const p1 = await pagina(prof, `?paciente_id=${ana}&limit=4`);
    expect(acoes(p1)).toEqual(HISTORICO_ANA.slice(0, 4));
    expect(p1.proximo_cursor).toBe(p1.items[3]!.id);
    const p2 = await pagina(prof, `?paciente_id=${ana}&limit=4&cursor=${p1.proximo_cursor}`);
    expect(acoes(p2)).toEqual(HISTORICO_ANA.slice(4, 8));
    const p3 = await pagina(prof, `?paciente_id=${ana}&limit=4&cursor=${p2.proximo_cursor}`);
    expect(acoes(p3)).toEqual(HISTORICO_ANA.slice(8));
    expect(p3.proximo_cursor).toBeNull();
  });

  it('paciente sem eventos: página vazia', async () => {
    const prof = await sessaoDeTeste();
    const paciente = await semearPaciente(prof.usuarioId);
    expect(await pagina(prof, `?paciente_id=${paciente}`)).toEqual({
      items: [],
      proximo_cursor: null,
    });
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('a trilha só traz eventos do profissional logado', async () => {
    await cenarioConta();
    const outra = await sessaoDeTeste();
    await evento(outra.usuarioId, 'perfil.editado', 'perfil');
    const p = await pagina(outra);
    expect(acoes(p)).toEqual(['perfil.editado']);
  });

  it('paciente de outro profissional: o mesmo 404 do inexistente e do id malformado', async () => {
    const { ana } = await cenarioPaciente();
    const intrusa = await sessaoDeTeste();
    for (const alvo of [ana, crypto.randomUUID(), 'nao-e-uuid', ''])
      await esperarProblema(
        await pedir('GET', `/api/auditoria?paciente_id=${alvo}`, intrusa),
        404,
        PROBLEMA_AUDITORIA_NAO_ENCONTRADA,
      );
  });

  it('pedir a trilha de outro usuário pela query é recusado, sem vazar nada', async () => {
    const { prof } = await cenarioConta();
    const intrusa = await sessaoDeTeste();
    const resposta = await pedir('GET', `/api/auditoria?usuario_id=${prof.usuarioId}`, intrusa);
    expect(resposta.status).toBe(400);
    expect(await resposta.text()).not.toContain(prof.usuarioId);
  });
});

describe('parâmetros inválidos', LENTO, () => {
  it('filtro, cursor, limit ou parâmetro desconhecido inválidos: 400 consulta_invalida', async () => {
    const prof = await sessaoDeTeste();
    for (const consulta of [
      'filtro=pagamentos',
      'filtro=',
      'cursor=x',
      'cursor=-1',
      'cursor=',
      'limit=0',
      'limit=101',
      'limit=abc',
      'pagina=2',
    ])
      await esperarProblema(
        await pedir('GET', `/api/auditoria?${consulta}`, prof),
        400,
        PROBLEMA_CONSULTA_AUDITORIA_INVALIDA,
      );
  });

  it('a trilha é só de leitura: não há escrita na rota', async () => {
    const prof = await sessaoDeTeste();
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE'] as const)
      expect((await pedir(metodo, '/api/auditoria', prof, {})).status).toBe(404);
  });
});
