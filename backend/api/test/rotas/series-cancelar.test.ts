import { PROBLEMA_SESSAO_NAO_ENCONTRADA, PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, sessoesDe } from './sessoes-apoio.ts';

// T86 / AGE-16, AGE-17, AGE-10, ISO-02: POST /api/series/:id/cancelar marca a série como
// cancelada e as ocorrências `agendada` com início na data ou depois como `cancelada`, sem
// apagar nada e de forma idempotente. Ocorrências anteriores à data, realizadas e faltas ficam
// intactas; as canceladas ficam com cobravel = false (AGE-10).
// Decisões do usuário (2026-10-26), como no legado: a_partir_de opcional (padrão: agora);
// row_version da série opcional (divergente = 409 versao_divergente); cancelar série já
// cancelada = 200 sem mudar nada, mesmo com versão antiga.
// Série base: 5 terças às 10:00 (America/Sao_Paulo), de 2026-11-10 a 2026-12-08, cobráveis.

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };

interface RespostaSerie {
  serie: { id: string; row_version: number; cancelada: boolean };
  sessoes: { id: string; status: string }[];
}

const cancelar = (sessao: Sessao | null, id: string, corpo: unknown = {}) =>
  pedir('POST', `/api/series/${id}/cancelar`, sessao, corpo);

async function serieBase() {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const resposta = await pedir('POST', '/api/series', sessao, {
    paciente_id: pacienteId,
    ...TERCA,
    cobravel: true,
    frequencia: 'semanal',
    ocorrencias: 5,
  });
  expect(resposta.status).toBe(201);
  const corpo = (await resposta.json()) as RespostaSerie;
  return { sessao, serieId: corpo.serie.id, ids: corpo.sessoes.map((s) => s.id) };
}

const linhaSerie = async (id: string) =>
  (
    await comoAdmin<{ cancelada: boolean; row_version: number }>(
      'select cancelada, row_version from serie_recorrencia where id = $1',
      [id],
    )
  )[0];

const contarLinhas = async (usuarioId: string) =>
  (
    await comoAdmin<{ series: string; sessoes: string }>(
      `select (select count(*) from serie_recorrencia where usuario_id = $1) as series,
              (select count(*) from sessao_atendimento where usuario_id = $1) as sessoes`,
      [usuarioId],
    )
  )[0];

const A_PARTIR_DE_20_11 = { a_partir_de: '2026-11-20T00:00:00-03:00' };

describe('exige sessão', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await cancelar(null, crypto.randomUUID());
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('cancelar a partir da data (AGE-16)', () => {
  it('marca a série e as agendada a partir da data como canceladas; anteriores intactas', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const [o1, o2, o3, o4, o5] = ids as [string, string, string, string, string];
    await comoAdmin(`update sessao_atendimento set status = 'realizada' where id = $1`, [o4]);
    const intactas = await Promise.all([o1, o2, o4].map(linhaSessao));

    const resposta = await cancelar(sessao, serieId, A_PARTIR_DE_20_11);
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as RespostaSerie;
    expect(corpo.serie).toMatchObject({ id: serieId, cancelada: true, row_version: 2 });
    expect(corpo.sessoes.map((s) => [s.id, s.status])).toEqual([
      [o1, 'agendada'],
      [o2, 'agendada'],
      [o3, 'cancelada'],
      [o4, 'realizada'],
      [o5, 'cancelada'],
    ]);

    expect(await Promise.all([o1, o2, o4].map(linhaSessao))).toEqual(intactas);
    for (const id of [o3, o5])
      expect(await linhaSessao(id)).toMatchObject({
        status: 'cancelada',
        cobravel: false,
        row_version: 2,
      });
    expect(await linhaSerie(serieId)).toEqual({ cancelada: true, row_version: 2 });
  });

  it('sem a_partir_de, vale agora: ocorrências já passadas ficam intactas', async () => {
    const semana = 7 * 86_400_000;
    const primeira = new Date(Date.now() - 2 * semana - 3_600_000);
    primeira.setUTCSeconds(0, 0);
    const sessao = await sessaoDeTeste();
    await semearPerfil(sessao.usuarioId, { atende_sabado: true, atende_domingo: true });
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const criada = await pedir('POST', '/api/series', sessao, {
      paciente_id: pacienteId,
      inicio: primeira.toISOString(),
      fim: new Date(primeira.getTime() + 50 * 60_000).toISOString(),
      frequencia: 'semanal',
      ocorrencias: 4,
    });
    const { serie, sessoes } = (await criada.json()) as RespostaSerie;

    const resposta = await cancelar(sessao, serie.id);
    expect(resposta.status).toBe(200);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.status)).toEqual([
      'agendada',
      'agendada',
      'agendada',
      'cancelada',
    ]);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.id)).toEqual(sessoes.map((s) => s.id));
  });

  it('audita serie.cancelada uma vez, alvo a série', async () => {
    const { sessao, serieId } = await serieBase();
    await cancelar(sessao, serieId, A_PARTIR_DE_20_11);
    expect(await auditoriaDe(sessao.usuarioId, 'serie.cancelada')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: serieId,
        campos_alterados: ['cancelada', 'status'],
      }),
    ]);
  });
});

describe('idempotente (AGE-16)', () => {
  it('a segunda chamada responde 200 e não muda nada, nem com outra data', async () => {
    const { sessao, serieId, ids } = await serieBase();
    await cancelar(sessao, serieId, A_PARTIR_DE_20_11);
    const depoisDaPrimeira = await Promise.all(ids.map(linhaSessao));

    const resposta = await cancelar(sessao, serieId, { a_partir_de: '2026-11-01T00:00:00-03:00' });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as RespostaSerie;
    expect(corpo.serie).toMatchObject({ cancelada: true, row_version: 2 });
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(depoisDaPrimeira);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: true, row_version: 2 });
    expect(await auditoriaDe(sessao.usuarioId, 'serie.cancelada')).toHaveLength(1);
  });

  it('série já cancelada responde 200 sem mudar nada mesmo com row_version antigo', async () => {
    const { sessao, serieId, ids } = await serieBase();
    await cancelar(sessao, serieId, A_PARTIR_DE_20_11);
    const depoisDaPrimeira = await Promise.all(ids.map(linhaSessao));
    const resposta = await cancelar(sessao, serieId, { row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(depoisDaPrimeira);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: true, row_version: 2 });
  });
});

describe('nada é apagado (AGE-17)', () => {
  it('cancelar, cancelar de novo e os erros não apagam nenhuma linha', async () => {
    const { sessao, serieId } = await serieBase();
    const antes = await contarLinhas(sessao.usuarioId);
    expect(antes).toEqual({ series: '1', sessoes: '5' });
    await cancelar(sessao, serieId, { row_version: 9 }); // 409 versão
    await cancelar(sessao, serieId, { status: 'x' }); // 422 corpo
    await cancelar(sessao, serieId, A_PARTIR_DE_20_11); // 200
    await cancelar(sessao, serieId); // 200 idempotente
    expect(await contarLinhas(sessao.usuarioId)).toEqual(antes);
  });

  it('não existe DELETE /api/series/:id e a série continua lá', async () => {
    const { sessao, serieId } = await serieBase();
    const resposta = await pedir('DELETE', `/api/series/${serieId}`, sessao);
    expect(resposta.status).toBe(404);
    expect(await contarLinhas(sessao.usuarioId)).toEqual({ series: '1', sessoes: '5' });
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });
});

describe('versão, corpo e isolamento (ISO-02)', () => {
  it('row_version divergente responde 409 versao_divergente e nada muda', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await cancelar(sessao, serieId, { row_version: 2 });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(PROBLEMA_VERSAO_DIVERGENTE);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });

  it('row_version igual ao atual é aceito', async () => {
    const { sessao, serieId } = await serieBase();
    const resposta = await cancelar(sessao, serieId, { row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: true, row_version: 2 });
  });

  it('campo extra responde 422 validacao e nada muda', async () => {
    const { sessao, serieId } = await serieBase();
    const resposta = await cancelar(sessao, serieId, { status: 'cancelada' });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['status'] });
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });

  it('série de outro profissional, inexistente ou id malformado: 404 e nada muda', async () => {
    const { serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const outro = await sessaoDeTeste();
    for (const id of [serieId, crypto.randomUUID(), 'nao-e-uuid']) {
      const resposta = await cancelar(outro, id);
      expect(resposta.status, id).toBe(404);
      expect(await resposta.json()).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    }
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });
});
