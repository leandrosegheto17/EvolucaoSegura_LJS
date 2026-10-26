import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SERIE_CANCELADA,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_VERSAO_DIVERGENTE,
} from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T85 / AGE-15, AGE-04, AGE-05, AGE-06, AGE-11, AGE-12, AGE-17, ISO-02: PUT /api/series/:id
// desloca "a partir de" uma data só as ocorrências `agendada` com início nela ou depois.
// - A primeira dessas vai para o novo início e fim; as demais andam a mesma diferença, com a
//   nova duração, o novo link (ausente = sem link) e o cobravel pedido.
// - Anteriores à data, realizadas, faltas e canceladas ficam intocadas.
// - Dia habilitado e paciente ativo reaplicados em toda ocorrência cujo início muda; conflito
//   reaplicado ignorando só as ocorrências que estão sendo movidas (409 SCHEDULE_CONFLICT com as
//   colisões, ou grava com confirmar_conflito: true). Tudo ou nada.
// Decisões do usuário (2026-10-26): a_partir_de opcional (padrão: agora); row_version da série
// opcional (divergente = 409 versao_divergente); série cancelada = 422 SERIES_CANCELLED; nenhuma
// agendada a partir da data = 200 sem mudar nada, sem subir versão e sem auditar.
// Série base: 5 terças às 10:00 (America/Sao_Paulo), de 2026-11-10 a 2026-12-08.

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const utc = (instante: string) => new Date(instante).toISOString();

interface RespostaSerie {
  serie: { id: string; row_version: number; cancelada: boolean };
  sessoes: { id: string; inicio: string; fim: string; status: string }[];
}

const alterar = (sessao: Sessao | null, id: string, corpo: unknown) =>
  pedir('PUT', `/api/series/${id}`, sessao, corpo);

async function serieBase(
  opcoes: { horario?: { inicio: string; fim: string }; ocorrencias?: number; link?: string } = {},
) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const resposta = await pedir('POST', '/api/series', sessao, {
    paciente_id: pacienteId,
    ...(opcoes.horario ?? TERCA),
    link: opcoes.link ?? 'https://meet.exemplo.com/serie',
    frequencia: 'semanal',
    ocorrencias: opcoes.ocorrencias ?? 5,
  });
  expect(resposta.status).toBe(201);
  const corpo = (await resposta.json()) as RespostaSerie;
  return { sessao, pacienteId, serieId: corpo.serie.id, ids: corpo.sessoes.map((s) => s.id) };
}

const mudarStatus = (id: string, status: string) =>
  comoAdmin('update sessao_atendimento set status = $2 where id = $1', [id, status]);

const linhaSerie = async (id: string) =>
  (
    await comoAdmin<{ cancelada: boolean; row_version: number }>(
      'select cancelada, row_version from serie_recorrencia where id = $1',
      [id],
    )
  )[0];

describe('exige sessão', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await alterar(null, crypto.randomUUID(), TERCA);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('deslocar a partir da data (AGE-15)', () => {
  it('move só as agendada a partir da data; anteriores, realizadas e canceladas intocadas', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const [o1, o2, o3, o4, o5] = ids as [string, string, string, string, string];
    await mudarStatus(o2, 'realizada');
    await mudarStatus(o4, 'cancelada');
    const intocadas = await Promise.all([o1, o2, o4].map(linhaSessao));

    // A partir de 11/11: abertas são a 3ª (24/11) e a 5ª (08/12); vão para quarta 14:00-15:00.
    const resposta = await alterar(sessao, serieId, {
      a_partir_de: '2026-11-11T00:00:00-03:00',
      inicio: '2026-11-25T14:00:00-03:00',
      fim: '2026-11-25T15:00:00-03:00',
      cobravel: true,
    });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as RespostaSerie;
    expect(corpo.serie).toMatchObject({ id: serieId, row_version: 2, cancelada: false });
    expect(corpo.sessoes.map((s) => s.id)).toEqual([o1, o2, o3, o4, o5]);

    expect(await Promise.all([o1, o2, o4].map(linhaSessao))).toEqual(intocadas);
    expect(await linhaSessao(o3)).toMatchObject({
      inicio: utc('2026-11-25T14:00:00-03:00'),
      fim: utc('2026-11-25T15:00:00-03:00'),
      status: 'agendada',
      link: null,
      cobravel: true,
      row_version: 2,
    });
    expect(await linhaSessao(o5)).toMatchObject({
      inicio: utc('2026-12-09T14:00:00-03:00'),
      fim: utc('2026-12-09T15:00:00-03:00'),
      status: 'agendada',
      link: null,
      cobravel: true,
      row_version: 2,
    });
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 2 });
  });

  it('sem a_partir_de, vale agora: ocorrências já passadas ficam intocadas', async () => {
    const hora = 3_600_000;
    const semana = 7 * 24 * hora;
    const primeira = new Date(Date.now() - 2 * semana - hora);
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
    const passadas = await Promise.all(sessoes.slice(0, 3).map((s) => linhaSessao(s.id)));
    const quarta = new Date(primeira.getTime() + 3 * semana);

    const resposta = await alterar(sessao, serie.id, {
      inicio: new Date(quarta.getTime() + hora).toISOString(),
      fim: new Date(quarta.getTime() + 2 * hora).toISOString(),
    });
    expect(resposta.status).toBe(200);
    expect(await Promise.all(sessoes.slice(0, 3).map((s) => linhaSessao(s.id)))).toEqual(passadas);
    expect(await linhaSessao(sessoes[3]!.id)).toMatchObject({
      inicio: new Date(quarta.getTime() + hora).toISOString(),
      row_version: 2,
    });
  });

  it('audita serie.editada, alvo a série, com os campos alterados', async () => {
    const { sessao, serieId } = await serieBase();
    await alterar(sessao, serieId, {
      inicio: '2026-11-10T11:00:00-03:00',
      fim: '2026-11-10T12:00:00-03:00',
      link: 'https://meet.exemplo.com/serie',
    });
    expect(await auditoriaDe(sessao.usuarioId, 'serie.editada')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: serieId,
        campos_alterados: ['inicio', 'fim'],
      }),
    ]);
  });

  it('nenhuma agendada a partir da data: 200 com tudo como está, sem subir versão nem auditar', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, {
      a_partir_de: '2026-12-09T00:00:00-03:00',
      inicio: '2026-12-09T14:00:00-03:00',
      fim: '2026-12-09T15:00:00-03:00',
    });
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as RespostaSerie;
    expect(corpo.serie).toMatchObject({ id: serieId, row_version: 1 });
    expect(corpo.sessoes.map((s) => s.id)).toEqual(ids);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
    expect(await auditoriaDe(sessao.usuarioId, 'serie.editada')).toEqual([]);
  });
});

describe('dia habilitado e paciente reaplicados (AGE-06, AGE-12)', () => {
  it('mover para sábado desligado responde 422 WEEKDAY_UNAVAILABLE e nada muda', async () => {
    const { sessao, serieId, ids } = await serieBase();
    await semearPerfil(sessao.usuarioId, { atende_sabado: false });
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, {
      inicio: '2026-11-14T10:00:00-03:00',
      fim: '2026-11-14T10:50:00-03:00',
    });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });

  it('o dia só é conferido quando o início muda: esticar o fim num sábado já desligado é aceito', async () => {
    const sabado = { inicio: '2026-11-14T10:00:00-03:00', fim: '2026-11-14T10:50:00-03:00' };
    const sessao = await sessaoDeTeste();
    await semearPerfil(sessao.usuarioId, { atende_sabado: true });
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const criada = await pedir('POST', '/api/series', sessao, {
      paciente_id: pacienteId,
      ...sabado,
      frequencia: 'semanal',
      ocorrencias: 3,
    });
    const { serie } = (await criada.json()) as RespostaSerie;
    await comoAdmin('update perfil set atende_sabado = false where usuario_id = $1', [
      sessao.usuarioId,
    ]);
    const resposta = await alterar(sessao, serie.id, {
      inicio: sabado.inicio,
      fim: '2026-11-14T11:00:00-03:00',
    });
    expect(resposta.status).toBe(200);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.fim)).toEqual([
      utc('2026-11-14T11:00:00-03:00'),
      utc('2026-11-21T11:00:00-03:00'),
      utc('2026-11-28T11:00:00-03:00'),
    ]);
  });

  it('paciente inativo responde 422 PATIENT_INACTIVE e nada muda', async () => {
    const { sessao, pacienteId, serieId, ids } = await serieBase();
    await comoAdmin('update paciente set ativo = false where id = $1', [pacienteId]);
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, {
      inicio: '2026-11-11T10:00:00-03:00',
      fim: '2026-11-11T10:50:00-03:00',
    });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_INATIVO);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
  });
});

describe('conflito reaplicado, tudo ou nada (AGE-04, AGE-05, AGE-15)', () => {
  // Deslocar um dia (quarta 14:00-15:00): só a 5ª ocorrência (09/12) colide com a existente.
  const quarta = { inicio: '2026-11-11T14:00:00-03:00', fim: '2026-11-11T15:00:00-03:00' };

  it('colisão só na última: 409 com a colisão e nenhuma ocorrência muda', async () => {
    const { sessao, pacienteId, serieId, ids } = await serieBase();
    const existente = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-12-09T14:30:00-03:00',
      fim: '2026-12-09T15:30:00-03:00',
    });
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, quarta);
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      ...PROBLEMA_CONFLITO_HORARIO,
      colisoes: [{ ocorrencia: 5, inicio: utc('2026-12-09T14:00:00-03:00'), sessao_id: existente }],
    });
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });

  it('com confirmar_conflito: true move todas sem alterar a existente e audita a confirmação', async () => {
    const { sessao, pacienteId, serieId, ids } = await serieBase();
    const existente = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-12-09T14:30:00-03:00',
      fim: '2026-12-09T15:30:00-03:00',
    });
    const linhaExistente = await linhaSessao(existente);
    const resposta = await alterar(sessao, serieId, { ...quarta, confirmar_conflito: true });
    expect(resposta.status).toBe(200);
    expect((await Promise.all(ids.map(linhaSessao))).map((s) => s!.inicio)).toEqual([
      utc('2026-11-11T14:00:00-03:00'),
      utc('2026-11-18T14:00:00-03:00'),
      utc('2026-11-25T14:00:00-03:00'),
      utc('2026-12-02T14:00:00-03:00'),
      utc('2026-12-09T14:00:00-03:00'),
    ]);
    expect(await linhaSessao(existente)).toEqual(linhaExistente);
    expect(await auditoriaDe(sessao.usuarioId, 'serie.editada')).toEqual([
      expect.objectContaining({
        campos_alterados: ['inicio', 'fim', 'link', 'conflito_confirmado'],
      }),
    ]);
  });

  it('as ocorrências que estão sendo movidas não conflitam entre si (deslocar uma semana)', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const resposta = await alterar(sessao, serieId, {
      inicio: '2026-11-17T10:00:00-03:00',
      fim: '2026-11-17T10:50:00-03:00',
      link: 'https://meet.exemplo.com/serie',
    });
    expect(resposta.status).toBe(200);
    expect((await Promise.all(ids.map(linhaSessao))).map((s) => s!.inicio)).toEqual([
      utc('2026-11-17T10:00:00-03:00'),
      utc('2026-11-24T10:00:00-03:00'),
      utc('2026-12-01T10:00:00-03:00'),
      utc('2026-12-08T10:00:00-03:00'),
      utc('2026-12-15T10:00:00-03:00'),
    ]);
  });

  it('ocorrência da série que não se move (realizada) conflita como qualquer outra', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const [o1] = ids as [string];
    await mudarStatus(o1, 'realizada');
    // Abertas: 2ª a 5ª; voltar uma semana põe a 2ª sobre a 1ª, realizada.
    const resposta = await alterar(sessao, serieId, TERCA);
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({
      ...PROBLEMA_CONFLITO_HORARIO,
      colisoes: [{ ocorrencia: 2, inicio: utc(TERCA.inicio), sessao_id: o1 }],
    });
  });
});

describe('versão, série cancelada e isolamento (AGE-11, ISO-02)', () => {
  const novo = { inicio: '2026-11-10T11:00:00-03:00', fim: '2026-11-10T11:50:00-03:00' };

  it('row_version divergente responde 409 versao_divergente e nada muda', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, { ...novo, row_version: 2 });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(PROBLEMA_VERSAO_DIVERGENTE);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 1 });
  });

  it('row_version igual ao atual é aceito', async () => {
    const { sessao, serieId } = await serieBase();
    const resposta = await alterar(sessao, serieId, { ...novo, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await linhaSerie(serieId)).toEqual({ cancelada: false, row_version: 2 });
  });

  it('série cancelada responde 422 SERIES_CANCELLED e nada muda', async () => {
    const { sessao, serieId, ids } = await serieBase();
    await comoAdmin('update serie_recorrencia set cancelada = true where id = $1', [serieId]);
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, novo);
    expect(resposta.status).toBe(422);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual(PROBLEMA_SERIE_CANCELADA);
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
  });

  it('série de outro profissional, inexistente ou id malformado: 404 e nada muda', async () => {
    const { serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const outro = await sessaoDeTeste();
    for (const id of [serieId, crypto.randomUUID(), 'nao-e-uuid']) {
      const resposta = await alterar(outro, id, novo);
      expect(resposta.status, id).toBe(404);
      expect(await resposta.json()).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    }
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
  });

  it('corpo inválido responde 422 validacao e nada muda', async () => {
    const { sessao, serieId, ids } = await serieBase();
    const antes = await Promise.all(ids.map(linhaSessao));
    const resposta = await alterar(sessao, serieId, { ...novo, fim: novo.inicio });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['fim'] });
    expect(await Promise.all(ids.map(linhaSessao))).toEqual(antes);
  });
});
