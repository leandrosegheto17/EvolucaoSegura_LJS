import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_TRANSICAO_INVALIDA,
  PROBLEMA_VERSAO_DIVERGENTE,
} from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T81 / AGE-07, AGE-09, AGE-10, AGE-11, AGE-17, ISO-02: POST /api/sessoes/:id/status aplica as
// transições da matriz (outras = 422), com mesmo status idempotente; cancelada ou remarcada
// voltando a agendada reaplica dia habilitado e conflito; falta e cancelamento gravam
// cobravel = false salvo "cobrar"; row_version divergente = 409 sem gravar. Nunca apaga.
// Datas: terça 2026-11-10 e sábado 2026-11-14 (America/Sao_Paulo).

type Status = 'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada';

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const SABADO = { inicio: '2026-11-14T10:00:00-03:00', fim: '2026-11-14T10:50:00-03:00' };

const mudar = (sessao: Sessao | null, id: string, corpo: unknown) =>
  pedir('POST', `/api/sessoes/${id}/status`, sessao, corpo);

async function cenario(
  status: Status = 'agendada',
  dados: { cobravel?: boolean; horario?: typeof TERCA } = {},
) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const id = await semearSessao(sessao.usuarioId, pacienteId, {
    ...(dados.horario ?? TERCA),
    status,
    ...(dados.cobravel === undefined ? {} : { cobravel: dados.cobravel }),
  });
  return { sessao, pacienteId, id };
}

describe('exige sessão e CSRF', () => {
  it('sem sessão responde 401', async () => {
    const { id } = await cenario();
    const resposta = await mudar(null, id, { status: 'realizada', row_version: 1 });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem x-csrf-token responde 403 e nada muda', async () => {
    const { sessao, id } = await cenario();
    const resposta = await app.request(
      `/api/sessoes/${id}/status`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({ status: 'realizada', row_version: 1 }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await linhaSessao(id)).toMatchObject({ status: 'agendada', row_version: 1 });
  });
});

describe('transições (AGE-07)', () => {
  it.each([
    ['agendada', 'realizada'],
    ['agendada', 'faltou'],
    ['agendada', 'cancelada'],
    ['agendada', 'remarcada'],
    ['realizada', 'agendada'],
    ['realizada', 'faltou'],
    ['realizada', 'cancelada'],
    ['faltou', 'agendada'],
    ['faltou', 'realizada'],
    ['cancelada', 'agendada'],
    ['remarcada', 'agendada'],
  ] as const)('%s -> %s responde 200 e sobe row_version', async (de, para) => {
    const { sessao, id } = await cenario(de);
    const resposta = await mudar(sessao, id, { status: para, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ id, status: para, row_version: 2 });
    expect(await linhaSessao(id)).toMatchObject({ status: para, row_version: 2 });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: id,
        campos_alterados: ['status'],
      }),
    ]);
  });

  it.each([
    ['realizada', 'remarcada'],
    ['faltou', 'cancelada'],
    ['faltou', 'remarcada'],
    ['cancelada', 'realizada'],
    ['cancelada', 'faltou'],
    ['cancelada', 'remarcada'],
    ['remarcada', 'realizada'],
    ['remarcada', 'faltou'],
    ['remarcada', 'cancelada'],
  ] as const)('%s -> %s responde 422 transicao_invalida sem gravar', async (de, para) => {
    const { sessao, id } = await cenario(de);
    const antes = await linhaSessao(id);
    const resposta = await mudar(sessao, id, { status: para, row_version: 1 });
    expect(resposta.status).toBe(422);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual(PROBLEMA_TRANSICAO_INVALIDA);
    expect(await linhaSessao(id)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([]);
  });

  it.each(['agendada', 'realizada', 'faltou', 'cancelada', 'remarcada'] as const)(
    'mesmo status (%s) responde 200 sem subir row_version nem auditar',
    async (status) => {
      const { sessao, id } = await cenario(status);
      const antes = await linhaSessao(id);
      const resposta = await mudar(sessao, id, { status, row_version: 1 });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ id, status, row_version: 1 });
      expect(await linhaSessao(id)).toEqual(antes);
      expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([]);
    },
  );

  it('status desconhecido ou sem row_version responde 422', async () => {
    const { sessao, id } = await cenario();
    for (const corpo of [{ status: 'apagada', row_version: 1 }, { status: 'realizada' }]) {
      const resposta = await mudar(sessao, id, corpo);
      expect(resposta.status).toBe(422);
      expect(await resposta.json()).toMatchObject({ codigo: 'validacao' });
    }
    expect(await linhaSessao(id)).toMatchObject({ status: 'agendada', row_version: 1 });
  });
});

describe('versão divergente (AGE-11)', () => {
  it('row_version diferente do atual responde 409 sem gravar', async () => {
    const { sessao, id } = await cenario();
    for (const row_version of [2, 7]) {
      const resposta = await mudar(sessao, id, { status: 'realizada', row_version });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual(PROBLEMA_VERSAO_DIVERGENTE);
    }
    expect(await linhaSessao(id)).toMatchObject({ status: 'agendada', row_version: 1 });
  });

  it('a versão vale também para transição inválida e mesmo status', async () => {
    const { sessao, id } = await cenario('cancelada');
    expect((await mudar(sessao, id, { status: 'realizada', row_version: 2 })).status).toBe(409);
    expect((await mudar(sessao, id, { status: 'cancelada', row_version: 2 })).status).toBe(409);
  });
});

describe('cobravel na falta e no cancelamento (AGE-10)', () => {
  it.each(['faltou', 'cancelada'] as const)(
    'virar %s grava cobravel = false, mesmo se antes era true',
    async (para) => {
      const { sessao, id } = await cenario('agendada', { cobravel: true });
      const resposta = await mudar(sessao, id, { status: para, row_version: 1 });
      expect(resposta.status).toBe(200);
      expect(await linhaSessao(id)).toMatchObject({ status: para, cobravel: false });
      expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([
        expect.objectContaining({ campos_alterados: ['status', 'cobravel'] }),
      ]);
    },
  );

  it.each(['faltou', 'cancelada'] as const)(
    'virar %s com "cobrar" grava cobravel = true',
    async (para) => {
      const { sessao, id } = await cenario('agendada');
      const resposta = await mudar(sessao, id, { status: para, cobravel: true, row_version: 1 });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ status: para, cobravel: true });
      expect(await linhaSessao(id)).toMatchObject({ status: para, cobravel: true });
    },
  );

  it('realizada -> faltou também zera o cobravel salvo "cobrar"', async () => {
    const { sessao, id } = await cenario('realizada', { cobravel: true });
    await mudar(sessao, id, { status: 'faltou', row_version: 1 });
    expect(await linhaSessao(id)).toMatchObject({ status: 'faltou', cobravel: false });
  });

  it('no mesmo status, "cobrar" troca só o cobravel', async () => {
    const { sessao, id } = await cenario('faltou');
    const resposta = await mudar(sessao, id, { status: 'faltou', cobravel: true, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({
      status: 'faltou',
      cobravel: true,
      row_version: 2,
    });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([
      expect.objectContaining({ campos_alterados: ['cobravel'] }),
    ]);
  });
});

describe('voltar para agendada reaplica as checagens (AGE-09)', () => {
  it.each(['cancelada', 'remarcada'] as const)(
    '%s -> agendada em sábado desligado responde 422 WEEKDAY_UNAVAILABLE',
    async (de) => {
      const { sessao, id } = await cenario(de, { horario: SABADO });
      await semearPerfil(sessao.usuarioId, { atende_sabado: false });
      const antes = await linhaSessao(id);
      const resposta = await mudar(sessao, id, { status: 'agendada', row_version: 1 });
      expect(resposta.status).toBe(422);
      expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
      expect(await linhaSessao(id)).toEqual(antes);
    },
  );

  it.each(['cancelada', 'remarcada'] as const)(
    '%s -> agendada sobre outra sessão agendada responde 409 SCHEDULE_CONFLICT',
    async (de) => {
      const { sessao, pacienteId, id } = await cenario(de);
      await semearSessao(sessao.usuarioId, pacienteId, TERCA);
      const antes = await linhaSessao(id);
      const resposta = await mudar(sessao, id, { status: 'agendada', row_version: 1 });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual(PROBLEMA_CONFLITO_HORARIO);
      expect(await linhaSessao(id)).toEqual(antes);
    },
  );

  it('com confirmar_conflito reabre sem tocar na outra e audita a confirmação', async () => {
    const { sessao, pacienteId, id } = await cenario('cancelada');
    const outra = await semearSessao(sessao.usuarioId, pacienteId, TERCA);
    const outraAntes = await linhaSessao(outra);
    const resposta = await mudar(sessao, id, {
      status: 'agendada',
      confirmar_conflito: true,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(outra)).toEqual(outraAntes);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([
      expect.objectContaining({ campos_alterados: ['status', 'conflito_confirmado'] }),
    ]);
  });

  it('sábado ligado e horário livre: reabre', async () => {
    const { sessao, id } = await cenario('cancelada', { horario: SABADO });
    await semearPerfil(sessao.usuarioId, { atende_sabado: true });
    expect((await mudar(sessao, id, { status: 'agendada', row_version: 1 })).status).toBe(200);
  });

  it('outra sessão cancelada no mesmo horário não impede reabrir', async () => {
    const { sessao, pacienteId, id } = await cenario('cancelada');
    await semearSessao(sessao.usuarioId, pacienteId, { ...TERCA, status: 'cancelada' });
    expect((await mudar(sessao, id, { status: 'agendada', row_version: 1 })).status).toBe(200);
  });

  it('faltou -> agendada não reaplica as checagens (já ocupava o horário)', async () => {
    const { sessao, pacienteId, id } = await cenario('faltou', { horario: SABADO });
    await semearSessao(sessao.usuarioId, pacienteId, SABADO);
    expect((await mudar(sessao, id, { status: 'agendada', row_version: 1 })).status).toBe(200);
  });
});

describe('isolamento e não encontrada (ISO-02)', () => {
  it('sessão de outro profissional, inexistente ou id malformado: o mesmo 404, sem gravar', async () => {
    const a = await cenario();
    const b = await cenario();
    const respostas = await Promise.all(
      [b.id, crypto.randomUUID(), 'nao-e-uuid'].map((id) =>
        mudar(a.sessao, id, { status: 'cancelada', row_version: 1 }),
      ),
    );
    expect(respostas.map((r) => r.status)).toEqual([404, 404, 404]);
    for (const r of respostas) expect(await r.json()).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    expect(await linhaSessao(b.id)).toMatchObject({ status: 'agendada', row_version: 1 });
  });
});

describe('nada é apagado (AGE-17)', () => {
  it('cancelar e remarcar só mudam o status; a sessão continua lá', async () => {
    const { sessao, id } = await cenario();
    await mudar(sessao, id, { status: 'cancelada', row_version: 1 });
    await mudar(sessao, id, { status: 'agendada', row_version: 2 });
    await mudar(sessao, id, { status: 'remarcada', row_version: 3 });
    expect(await sessoesDe(sessao.usuarioId)).toEqual([
      expect.objectContaining({ id, status: 'remarcada', row_version: 4 }),
    ]);
  });
});
