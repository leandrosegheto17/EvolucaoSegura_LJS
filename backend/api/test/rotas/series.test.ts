import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
} from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T84 / AGE-13, AGE-14, AGE-04, AGE-06, AGE-12, ISO-02: POST /api/series cria a série inteira ou
// nenhuma ocorrência.
// - 2 a 52 ocorrências (a primeira incluída), semanais ou quinzenais, todas com a duração da
//   primeira; fora disso, 422 e nada criado.
// - Alguma ocorrência sobrepõe outra agendada, realizada ou faltou sem confirmar_conflito: 409
//   SCHEDULE_CONFLICT listando todas as colisões, sem criar nenhuma; com a confirmação, cria
//   todas sem alterar as existentes.
// - Dia desligado no perfil: 422 WEEKDAY_UNAVAILABLE; paciente inativo: 422 PATIENT_INACTIVE;
//   de outro profissional: 404. Nada criado em nenhum desses casos.
// Datas futuras: terças a partir de 2026-11-10 (America/Sao_Paulo); sábado 2026-11-14.

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const SABADO = { inicio: '2026-11-14T10:00:00-03:00', fim: '2026-11-14T10:50:00-03:00' };
const utc = (instante: string) => new Date(instante).toISOString();

const criar = (sessao: Sessao | null, corpo: unknown) =>
  pedir('POST', '/api/series', sessao, corpo);

async function profissionalComPaciente(ativo = true) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId, { ativo });
  return { sessao, pacienteId };
}

const seriesDe = (usuarioId: string) =>
  comoAdmin<{ id: string; frequencia: string; ocorrencias: number; cancelada: boolean }>(
    'select id, frequencia, ocorrencias, cancelada from serie_recorrencia where usuario_id = $1',
    [usuarioId],
  );

interface SessaoResposta {
  id: string;
  serie_id: string;
  inicio: string;
  fim: string;
  status: string;
  cobravel: boolean;
  link: string | null;
}
interface RespostaSerie {
  serie: Record<string, unknown> & { id: string };
  sessoes: SessaoResposta[];
}

describe('exige sessão e CSRF', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await criar(null, {
      paciente_id: crypto.randomUUID(),
      ...TERCA,
      frequencia: 'semanal',
      ocorrencias: 4,
    });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem x-csrf-token responde 403 e nada é criado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await app.request(
      '/api/series',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({
          paciente_id: pacienteId,
          ...TERCA,
          frequencia: 'semanal',
          ocorrencias: 4,
        }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });
});

describe('criar série (AGE-13)', () => {
  it('semanal de 4: responde 201 com a série e as 4 ocorrências agendadas a cada 7 dias', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      link: 'https://meet.exemplo.com/abc',
      frequencia: 'semanal',
      ocorrencias: 4,
    });
    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as RespostaSerie;
    expect(corpo.serie).toEqual({
      id: expect.any(String),
      paciente_id: pacienteId,
      frequencia: 'semanal',
      ocorrencias: 4,
      cancelada: false,
      row_version: 1,
      criado_em: expect.any(String),
    });
    expect(corpo.sessoes.map((s) => [s.inicio, s.fim])).toEqual([
      [utc('2026-11-10T10:00:00-03:00'), utc('2026-11-10T10:50:00-03:00')],
      [utc('2026-11-17T10:00:00-03:00'), utc('2026-11-17T10:50:00-03:00')],
      [utc('2026-11-24T10:00:00-03:00'), utc('2026-11-24T10:50:00-03:00')],
      [utc('2026-12-01T10:00:00-03:00'), utc('2026-12-01T10:50:00-03:00')],
    ]);
    for (const s of corpo.sessoes)
      expect(s).toMatchObject({
        serie_id: corpo.serie.id,
        status: 'agendada',
        cobravel: false,
        link: 'https://meet.exemplo.com/abc',
      });

    const gravadas = await sessoesDe(sessao.usuarioId);
    expect(gravadas).toHaveLength(4);
    expect(gravadas.map((s) => s.serie_id)).toEqual(Array(4).fill(corpo.serie.id));
    expect(gravadas.map((s) => s.paciente_id)).toEqual(Array(4).fill(pacienteId));
    expect(await seriesDe(sessao.usuarioId)).toEqual([
      { id: corpo.serie.id, frequencia: 'semanal', ocorrencias: 4, cancelada: false },
    ]);
  });

  it('quinzenal pula uma semana', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      frequencia: 'quinzenal',
      ocorrencias: 3,
    });
    expect(resposta.status).toBe(201);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.inicio)).toEqual([
      utc('2026-11-10T10:00:00.000-03:00'),
      utc('2026-11-24T10:00:00.000-03:00'),
      utc('2026-12-08T10:00:00.000-03:00'),
    ]);
  });

  it('mesma duração em todas as ocorrências (90 minutos)', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      inicio: '2026-11-10T10:00:00-03:00',
      fim: '2026-11-10T11:30:00-03:00',
      frequencia: 'semanal',
      ocorrencias: 6,
    });
    expect(resposta.status).toBe(201);
    const duracoes = (await sessoesDe(sessao.usuarioId)).map(
      (s) => Date.parse(s.fim) - Date.parse(s.inicio),
    );
    expect(duracoes).toEqual(Array(6).fill(90 * 60_000));
  });

  it('2 e 52 ocorrências são aceitas e criam exatamente essa quantidade', async () => {
    for (const ocorrencias of [2, 52]) {
      const { sessao, pacienteId } = await profissionalComPaciente();
      const resposta = await criar(sessao, {
        paciente_id: pacienteId,
        ...TERCA,
        frequencia: 'semanal',
        ocorrencias,
      });
      expect(resposta.status, String(ocorrencias)).toBe(201);
      expect(await sessoesDe(sessao.usuarioId)).toHaveLength(ocorrencias);
    }
  });

  it.each([1, 53])('%i ocorrências responde 422 validacao e nada é criado', async (ocorrencias) => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      frequencia: 'semanal',
      ocorrencias,
    });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['ocorrencias'] });
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('audita serie.criada, alvo agendamento', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      frequencia: 'semanal',
      ocorrencias: 2,
    });
    const { serie } = (await resposta.json()) as RespostaSerie;
    expect(await auditoriaDe(sessao.usuarioId, 'serie.criada')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: serie.id,
        campos_alterados: [],
      }),
    ]);
  });
});

describe('conflito em alguma ocorrência (AGE-14, AGE-05)', () => {
  // Colisões com a 2ª ocorrência (17/11) e duas com a 4ª (01/12); uma sessão só encosta na 3ª e
  // uma cancelada sobrepõe a 1ª: nenhuma dessas duas conflita.
  async function cenario() {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const u = sessao.usuarioId;
    const naSegunda = await semearSessao(u, pacienteId, {
      inicio: '2026-11-17T10:30:00-03:00',
      fim: '2026-11-17T11:00:00-03:00',
    });
    const naQuartaA = await semearSessao(u, pacienteId, {
      inicio: '2026-12-01T09:30:00-03:00',
      fim: '2026-12-01T10:10:00-03:00',
      status: 'realizada',
    });
    const naQuartaB = await semearSessao(u, pacienteId, {
      inicio: '2026-12-01T10:40:00-03:00',
      fim: '2026-12-01T11:30:00-03:00',
      status: 'faltou',
    });
    await semearSessao(u, pacienteId, {
      inicio: '2026-11-24T10:50:00-03:00',
      fim: '2026-11-24T11:40:00-03:00',
    });
    await semearSessao(u, pacienteId, { ...TERCA, status: 'cancelada' });
    return { sessao, pacienteId, naSegunda, naQuartaA, naQuartaB };
  }
  const corpo = (pacienteId: string, extra: Record<string, unknown> = {}) => ({
    paciente_id: pacienteId,
    ...TERCA,
    frequencia: 'semanal',
    ocorrencias: 4,
    ...extra,
  });

  it('sem confirmar_conflito responde 409 listando todas as colisões e nada é criado', async () => {
    const { sessao, pacienteId, naSegunda, naQuartaA, naQuartaB } = await cenario();
    const antes = await sessoesDe(sessao.usuarioId);
    const resposta = await criar(sessao, corpo(pacienteId));
    expect(resposta.status).toBe(409);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual({
      ...PROBLEMA_CONFLITO_HORARIO,
      colisoes: [
        { ocorrencia: 2, inicio: utc('2026-11-17T10:00:00-03:00'), sessao_id: naSegunda },
        { ocorrencia: 4, inicio: utc('2026-12-01T10:00:00-03:00'), sessao_id: naQuartaA },
        { ocorrencia: 4, inicio: utc('2026-12-01T10:00:00-03:00'), sessao_id: naQuartaB },
      ],
    });
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(sessao.usuarioId)).toEqual(antes);
  });

  it('confirmar_conflito: false também responde 409', async () => {
    const { sessao, pacienteId } = await cenario();
    const resposta = await criar(sessao, corpo(pacienteId, { confirmar_conflito: false }));
    expect(resposta.status).toBe(409);
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
  });

  it('com confirmar_conflito: true cria todas, sem alterar as existentes, e audita a confirmação', async () => {
    const { sessao, pacienteId, naSegunda, naQuartaA, naQuartaB } = await cenario();
    const existentes = await Promise.all([naSegunda, naQuartaA, naQuartaB].map(linhaSessao));
    const resposta = await criar(sessao, corpo(pacienteId, { confirmar_conflito: true }));
    expect(resposta.status).toBe(201);
    const { serie, sessoes } = (await resposta.json()) as RespostaSerie;
    expect(sessoes).toHaveLength(4);
    const daSerie = (await sessoesDe(sessao.usuarioId)).filter((s) => s.serie_id === serie.id);
    expect(daSerie).toHaveLength(4);
    expect(await Promise.all([naSegunda, naQuartaA, naQuartaB].map(linhaSessao))).toEqual(
      existentes,
    );
    expect(await auditoriaDe(sessao.usuarioId, 'serie.criada')).toEqual([
      expect.objectContaining({ alvo_id: serie.id, campos_alterados: ['conflito_confirmado'] }),
    ]);
  });
});

describe('dia habilitado e paciente (AGE-06, AGE-12, ISO-02)', () => {
  const corpo = (pacienteId: string, horario = TERCA) => ({
    paciente_id: pacienteId,
    ...horario,
    frequencia: 'semanal',
    ocorrencias: 3,
  });

  it('sábado desligado no perfil responde 422 WEEKDAY_UNAVAILABLE e nada é criado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearPerfil(sessao.usuarioId, { atende_sabado: false });
    const resposta = await criar(sessao, corpo(pacienteId, SABADO));
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('sábado ligado no perfil aceita a série', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearPerfil(sessao.usuarioId, { atende_sabado: true });
    const resposta = await criar(sessao, corpo(pacienteId, SABADO));
    expect(resposta.status).toBe(201);
    expect(await sessoesDe(sessao.usuarioId)).toHaveLength(3);
  });

  it('paciente inativo responde 422 PATIENT_INACTIVE e nada é criado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente(false);
    const resposta = await criar(sessao, corpo(pacienteId));
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_INATIVO);
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('paciente de outro profissional responde 404, igual ao inexistente, e nada é criado', async () => {
    const { sessao } = await profissionalComPaciente();
    const outro = await sessaoDeTeste();
    const pacienteDoOutro = await semearPaciente(outro.usuarioId);
    for (const pacienteId of [pacienteDoOutro, crypto.randomUUID()]) {
      const resposta = await criar(sessao, corpo(pacienteId));
      expect(resposta.status).toBe(404);
      expect(await resposta.json()).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    }
    expect(await seriesDe(sessao.usuarioId)).toEqual([]);
    expect(await seriesDe(outro.usuarioId)).toEqual([]);
    expect(await sessoesDe(outro.usuarioId)).toEqual([]);
  });
});
