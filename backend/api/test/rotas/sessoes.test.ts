import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
} from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T78 / AGE-01, AGE-04, AGE-05, AGE-06, AGE-12, ISO-02: POST /api/sessoes cria sessão avulsa.
// - Início e fim ISO 8601 com offset, fim > início, link http(s) opcional: fora disso, 422.
// - Sobreposição [início, fim) com outra agendada, realizada ou faltou sem confirmar_conflito:
//   409 SCHEDULE_CONFLICT; sessões que só se encostam não conflitam; com confirmar_conflito:
//   true grava sem alterar a existente.
// - Sábado ou domingo desligado no perfil: 422 WEEKDAY_UNAVAILABLE.
// - Paciente inativo: 422 PATIENT_INACTIVE; de outro profissional: 404 igual ao inexistente.
// Datas futuras: terça 2026-11-10, sábado 2026-11-14 e domingo 2026-11-15 (America/Sao_Paulo).

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const SABADO = { inicio: '2026-11-14T10:00:00-03:00', fim: '2026-11-14T10:50:00-03:00' };
const DOMINGO = { inicio: '2026-11-15T10:00:00-03:00', fim: '2026-11-15T10:50:00-03:00' };
const utc = (instante: string) => new Date(instante).toISOString();

const criar = (sessao: Sessao | null, corpo: unknown) =>
  pedir('POST', '/api/sessoes', sessao, corpo);

async function profissionalComPaciente(ativo = true) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId, { ativo });
  return { sessao, pacienteId };
}

describe('exige sessão e CSRF', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await criar(null, { paciente_id: crypto.randomUUID(), ...TERCA });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem x-csrf-token responde 403 e nada é criado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await app.request(
      '/api/sessoes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({ paciente_id: pacienteId, ...TERCA }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });
});

describe('criar sessão (AGE-01)', () => {
  it('responde 201 com a sessão agendada, não cobrável, e grava no banco', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      link: 'https://meet.exemplo.com/abc',
    });
    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as Record<string, unknown>;
    expect(corpo).toEqual({
      id: expect.any(String),
      paciente_id: pacienteId,
      serie_id: null,
      inicio: utc(TERCA.inicio),
      fim: utc(TERCA.fim),
      link: 'https://meet.exemplo.com/abc',
      status: 'agendada',
      cobravel: false,
      row_version: 1,
      criado_em: expect.any(String),
    });
    expect(await linhaSessao(corpo['id'] as string)).toMatchObject({
      usuario_id: sessao.usuarioId,
      paciente_id: pacienteId,
      inicio: utc(TERCA.inicio),
      fim: utc(TERCA.fim),
      status: 'agendada',
      cobravel: false,
    });
  });

  it('aceita cobravel e link ausente (null)', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, { paciente_id: pacienteId, ...TERCA, cobravel: true });
    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toMatchObject({ link: null, cobravel: true });
  });

  it('audita sessao.criada, alvo agendamento, sem conteúdo', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, { paciente_id: pacienteId, ...TERCA });
    const { id } = (await resposta.json()) as { id: string };
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.criada')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: id,
        campos_alterados: [],
      }),
    ]);
  });

  it.each([
    ['fim igual ao início', { inicio: TERCA.inicio, fim: TERCA.inicio }, 'fim'],
    ['fim antes do início', { inicio: TERCA.fim, fim: TERCA.inicio }, 'fim'],
    ['sem offset', { inicio: '2026-11-10T10:00:00', fim: TERCA.fim }, 'inicio'],
    ['ano fora de 2000 a 2100', { inicio: TERCA.inicio, fim: '2101-01-01T00:00:00Z' }, 'fim'],
    ['link sem http(s)', { ...TERCA, link: 'ftp://exemplo.com' }, 'link'],
    ['link acima de 500', { ...TERCA, link: `https://x.y/${'a'.repeat(489)}` }, 'link'],
    ['campo extra', { ...TERCA, status: 'realizada' }, 'status'],
  ])('%s responde 422 validacao e nada é criado', async (_rotulo, dados, campo) => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, { paciente_id: pacienteId, ...dados });
    expect(resposta.status).toBe(422);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: [campo] });
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('corpo que não é JSON responde 422', async () => {
    const { sessao } = await profissionalComPaciente();
    const resposta = await app.request(
      '/api/sessoes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
          'x-csrf-token': sessao.csrf,
        },
        body: '{',
      },
      env,
    );
    expect(resposta.status).toBe(422);
  });
});

describe('paciente (AGE-12, ISO-02)', () => {
  it('paciente inativo responde 422 PATIENT_INACTIVE e nada é criado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente(false);
    const resposta = await criar(sessao, { paciente_id: pacienteId, ...TERCA });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_INATIVO);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('paciente de outro profissional responde 404 idêntico ao inexistente', async () => {
    const { sessao } = await profissionalComPaciente();
    const outro = await profissionalComPaciente();
    const deOutro = await criar(sessao, { paciente_id: outro.pacienteId, ...TERCA });
    const inexistente = await criar(sessao, { paciente_id: crypto.randomUUID(), ...TERCA });
    expect(deOutro.status).toBe(404);
    expect(inexistente.status).toBe(404);
    const corpo = await deOutro.json();
    expect(corpo).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    expect(await inexistente.json()).toEqual(corpo);
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
    expect(await sessoesDe(outro.sessao.usuarioId)).toEqual([]);
  });

  it('paciente inativo de outro profissional também responde 404', async () => {
    const { sessao } = await profissionalComPaciente();
    const outro = await profissionalComPaciente(false);
    const resposta = await criar(sessao, { paciente_id: outro.pacienteId, ...TERCA });
    expect(resposta.status).toBe(404);
  });
});

describe('dia habilitado (AGE-06)', () => {
  it('sábado e domingo desligados no perfil respondem 422 WEEKDAY_UNAVAILABLE', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearPerfil(sessao.usuarioId, { atende_sabado: false, atende_domingo: false });
    for (const dia of [SABADO, DOMINGO]) {
      const resposta = await criar(sessao, { paciente_id: pacienteId, ...dia });
      expect(resposta.status, dia.inicio).toBe(422);
      expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
    }
    expect(await sessoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('sem perfil, sábado e domingo ficam desligados', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, { paciente_id: pacienteId, ...SABADO });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
  });

  it('cada dia vale pelo seu flag', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearPerfil(sessao.usuarioId, { atende_sabado: true, atende_domingo: false });
    expect((await criar(sessao, { paciente_id: pacienteId, ...SABADO })).status).toBe(201);
    expect((await criar(sessao, { paciente_id: pacienteId, ...DOMINGO })).status).toBe(422);
  });

  it('o dia é o de São Paulo: sábado 23:30 (domingo em UTC) segue o flag do sábado', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearPerfil(sessao.usuarioId, { atende_sabado: false, atende_domingo: true });
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      inicio: '2026-11-14T23:30:00-03:00',
      fim: '2026-11-15T00:20:00-03:00',
    });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
  });

  it('dia útil não depende do perfil', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    expect((await criar(sessao, { paciente_id: pacienteId, ...TERCA })).status).toBe(201);
  });
});

describe('conflito de horário (AGE-04, AGE-05)', () => {
  it.each(['agendada', 'realizada', 'faltou'] as const)(
    'sobrepor uma sessão %s responde 409 SCHEDULE_CONFLICT sem gravar',
    async (status) => {
      const { sessao, pacienteId } = await profissionalComPaciente();
      const existente = await semearSessao(sessao.usuarioId, pacienteId, {
        inicio: '2026-11-10T10:30:00-03:00',
        fim: '2026-11-10T11:20:00-03:00',
        status,
      });
      const resposta = await criar(sessao, { paciente_id: pacienteId, ...TERCA });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual(PROBLEMA_CONFLITO_HORARIO);
      expect((await sessoesDe(sessao.usuarioId)).map((s) => s.id)).toEqual([existente]);
    },
  );

  it('confirmar_conflito: false também responde 409', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearSessao(sessao.usuarioId, pacienteId, TERCA);
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      confirmar_conflito: false,
    });
    expect(resposta.status).toBe(409);
  });

  it.each(['cancelada', 'remarcada'] as const)(
    'sessão %s no mesmo horário não conflita',
    async (status) => {
      const { sessao, pacienteId } = await profissionalComPaciente();
      await semearSessao(sessao.usuarioId, pacienteId, { ...TERCA, status });
      expect((await criar(sessao, { paciente_id: pacienteId, ...TERCA })).status).toBe(201);
    },
  );

  it('sessões que só se encostam não conflitam (antes e depois)', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-10T09:10:00-03:00',
      fim: TERCA.inicio,
    });
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: TERCA.fim,
      fim: '2026-11-10T11:40:00-03:00',
    });
    expect((await criar(sessao, { paciente_id: pacienteId, ...TERCA })).status).toBe(201);
  });

  it('sessão de outro profissional no mesmo horário não conflita', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const outro = await profissionalComPaciente();
    await semearSessao(outro.sessao.usuarioId, outro.pacienteId, TERCA);
    expect((await criar(sessao, { paciente_id: pacienteId, ...TERCA })).status).toBe(201);
  });

  it('com confirmar_conflito: true grava sem alterar a existente e audita a confirmação', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const existente = await semearSessao(sessao.usuarioId, pacienteId, TERCA);
    const antes = await linhaSessao(existente);

    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      confirmar_conflito: true,
    });
    expect(resposta.status).toBe(201);
    const { id } = (await resposta.json()) as { id: string };
    expect(await linhaSessao(existente)).toEqual(antes);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.id).sort()).toEqual(
      [existente, id].sort(),
    );
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.criada')).toEqual([
      expect.objectContaining({ alvo_id: id, campos_alterados: ['conflito_confirmado'] }),
    ]);
  });

  it('confirmar_conflito sem conflito real grava sem marcar a confirmação', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const resposta = await criar(sessao, {
      paciente_id: pacienteId,
      ...TERCA,
      confirmar_conflito: true,
    });
    expect(resposta.status).toBe(201);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.criada')).toEqual([
      expect.objectContaining({ campos_alterados: [] }),
    ]);
  });
});
