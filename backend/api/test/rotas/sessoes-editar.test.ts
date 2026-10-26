import {
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_VERSAO_DIVERGENTE,
} from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearPerfil, semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T80 / AGE-11, AGE-04, AGE-06, AGE-12, AGE-17, ISO-02: PUT /api/sessoes/:id altera horário e
// dados com row_version. Versão divergente responde 409 sem gravar; mover a sessão reaplica as
// três checagens (paciente ativo, dia habilitado, conflito); a sessão nunca é apagada.
// Datas: terça 2026-11-10, quarta 2026-11-11 e sábado 2026-11-14 (America/Sao_Paulo).

const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const QUARTA = { inicio: '2026-11-11T10:00:00-03:00', fim: '2026-11-11T10:50:00-03:00' };
const SABADO = { inicio: '2026-11-14T10:00:00-03:00', fim: '2026-11-14T10:50:00-03:00' };
const utc = (instante: string) => new Date(instante).toISOString();

const editar = (sessao: Sessao | null, id: string, corpo: unknown) =>
  pedir('PUT', `/api/sessoes/${id}`, sessao, corpo);

async function cenario(dados: { status?: 'agendada' | 'cancelada' | 'realizada' } = {}) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const id = await semearSessao(sessao.usuarioId, pacienteId, { ...TERCA, ...dados });
  return { sessao, pacienteId, id };
}

describe('exige sessão e CSRF', () => {
  it('sem sessão responde 401', async () => {
    const { id } = await cenario();
    const resposta = await editar(null, id, { ...QUARTA, row_version: 1 });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem x-csrf-token responde 403 e nada muda', async () => {
    const { sessao, id } = await cenario();
    const antes = await linhaSessao(id);
    const resposta = await app.request(
      `/api/sessoes/${id}`,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({ ...QUARTA, row_version: 1 }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await linhaSessao(id)).toEqual(antes);
  });
});

describe('editar e mover (AGE-11)', () => {
  it('move para outro horário, sobe row_version e audita sessao.editada', async () => {
    const { sessao, pacienteId, id } = await cenario();
    const resposta = await editar(sessao, id, { ...QUARTA, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      id,
      paciente_id: pacienteId,
      inicio: utc(QUARTA.inicio),
      fim: utc(QUARTA.fim),
      status: 'agendada',
      row_version: 2,
    });
    expect(await linhaSessao(id)).toMatchObject({
      inicio: utc(QUARTA.inicio),
      fim: utc(QUARTA.fim),
      row_version: 2,
    });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([
      expect.objectContaining({
        ator: sessao.usuarioId,
        alvo_tipo: 'agendamento',
        alvo_id: id,
        campos_alterados: ['inicio', 'fim'],
      }),
    ]);
  });

  it('altera link e cobravel sem mover', async () => {
    const { sessao, id } = await cenario();
    const resposta = await editar(sessao, id, {
      ...TERCA,
      link: 'https://meet.exemplo.com/x',
      cobravel: true,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({
      link: 'https://meet.exemplo.com/x',
      cobravel: true,
      row_version: 2,
    });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([
      expect.objectContaining({ campos_alterados: ['link', 'cobravel'] }),
    ]);
  });

  it('link ausente apaga o link; cobravel ausente fica como está', async () => {
    const { sessao, id } = await cenario();
    await comoAdmin(
      "update sessao_atendimento set link = 'https://a.b/c', cobravel = true where id = $1",
      [id],
    );
    const resposta = await editar(sessao, id, { ...TERCA, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ link: null, cobravel: true, row_version: 2 });
  });

  it('sem mudança de fato responde 200 sem subir row_version nem auditar', async () => {
    const { sessao, id } = await cenario();
    const antes = await linhaSessao(id);
    const resposta = await editar(sessao, id, {
      inicio: '2026-11-10T13:00:00Z',
      fim: '2026-11-10T13:50:00Z',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ id, row_version: 1 });
    expect(await linhaSessao(id)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([]);
  });

  it('corpo inválido responde 422 e nada muda', async () => {
    const { sessao, id } = await cenario();
    const antes = await linhaSessao(id);
    for (const corpo of [
      QUARTA,
      { ...QUARTA, row_version: 1, status: 'realizada' },
      { inicio: QUARTA.fim, fim: QUARTA.inicio, row_version: 1 },
    ]) {
      const resposta = await editar(sessao, id, corpo);
      expect(resposta.status).toBe(422);
      expect(await resposta.json()).toMatchObject({ codigo: 'validacao' });
    }
    expect(await linhaSessao(id)).toEqual(antes);
  });
});

describe('versão divergente (AGE-11)', () => {
  it('row_version diferente do atual responde 409 sem gravar', async () => {
    const { sessao, id } = await cenario();
    expect((await editar(sessao, id, { ...QUARTA, row_version: 1 })).status).toBe(200);
    const antes = await linhaSessao(id);

    for (const row_version of [1, 3]) {
      const resposta = await editar(sessao, id, { ...TERCA, row_version });
      expect(resposta.status, String(row_version)).toBe(409);
      expect(await resposta.json()).toEqual(PROBLEMA_VERSAO_DIVERGENTE);
    }
    expect(await linhaSessao(id)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toHaveLength(1);
  });
});

describe('mover reaplica as três checagens (AGE-04, AGE-06, AGE-12)', () => {
  it('para sábado desligado responde 422 WEEKDAY_UNAVAILABLE sem gravar', async () => {
    const { sessao, id } = await cenario();
    await semearPerfil(sessao.usuarioId, { atende_sabado: false });
    const antes = await linhaSessao(id);
    const resposta = await editar(sessao, id, { ...SABADO, row_version: 1 });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_DIA_INDISPONIVEL);
    expect(await linhaSessao(id)).toEqual(antes);
  });

  it('para sábado ligado é aceito', async () => {
    const { sessao, id } = await cenario();
    await semearPerfil(sessao.usuarioId, { atende_sabado: true });
    expect((await editar(sessao, id, { ...SABADO, row_version: 1 })).status).toBe(200);
  });

  it('sobre outra sessão agendada responde 409 SCHEDULE_CONFLICT sem gravar', async () => {
    const { sessao, pacienteId, id } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    const antes = await linhaSessao(id);
    const resposta = await editar(sessao, id, { ...QUARTA, row_version: 1 });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(PROBLEMA_CONFLITO_HORARIO);
    expect(await linhaSessao(id)).toEqual(antes);
  });

  it('com confirmar_conflito grava sem alterar a outra e audita a confirmação', async () => {
    const { sessao, pacienteId, id } = await cenario();
    const outra = await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    const outraAntes = await linhaSessao(outra);
    const resposta = await editar(sessao, id, {
      ...QUARTA,
      confirmar_conflito: true,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(outra)).toEqual(outraAntes);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([
      expect.objectContaining({ campos_alterados: ['inicio', 'fim', 'conflito_confirmado'] }),
    ]);
  });

  it('a própria sessão não conta como conflito (esticar o fim)', async () => {
    const { sessao, id } = await cenario();
    const resposta = await editar(sessao, id, {
      inicio: TERCA.inicio,
      fim: '2026-11-10T11:30:00-03:00',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([
      expect.objectContaining({ campos_alterados: ['fim'] }),
    ]);
  });

  it('encostar na outra sessão não é conflito', async () => {
    const { sessao, pacienteId, id } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    const resposta = await editar(sessao, id, {
      inicio: '2026-11-11T09:10:00-03:00',
      fim: QUARTA.inicio,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
  });

  it('mover sessão de paciente inativo responde 422 PATIENT_INACTIVE sem gravar', async () => {
    const { sessao, pacienteId, id } = await cenario();
    await comoAdmin('update paciente set ativo = false where id = $1', [pacienteId]);
    const antes = await linhaSessao(id);
    const resposta = await editar(sessao, id, { ...QUARTA, row_version: 1 });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_INATIVO);
    expect(await linhaSessao(id)).toEqual(antes);
  });

  it('sem mover, paciente inativo e sábado desligado não impedem trocar o link', async () => {
    const sessao = await sessaoDeTeste();
    const pacienteId = await semearPaciente(sessao.usuarioId, { ativo: false });
    const id = await semearSessao(sessao.usuarioId, pacienteId, SABADO);
    const resposta = await editar(sessao, id, {
      ...SABADO,
      link: 'https://meet.exemplo.com/y',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
  });

  it('trocar para paciente inativo responde 422; de outro profissional, 404', async () => {
    const { sessao, id } = await cenario();
    const inativo = await semearPaciente(sessao.usuarioId, { ativo: false });
    const outro = await sessaoDeTeste();
    const deOutro = await semearPaciente(outro.usuarioId);
    const antes = await linhaSessao(id);

    const r1 = await editar(sessao, id, { ...TERCA, paciente_id: inativo, row_version: 1 });
    expect(r1.status).toBe(422);
    expect(await r1.json()).toEqual(PROBLEMA_PACIENTE_INATIVO);
    const r2 = await editar(sessao, id, { ...TERCA, paciente_id: deOutro, row_version: 1 });
    expect(r2.status).toBe(404);
    expect(await r2.json()).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    expect(await linhaSessao(id)).toEqual(antes);
  });

  it('trocar para outro paciente ativo grava e audita paciente_id', async () => {
    const { sessao, id } = await cenario();
    const outroPaciente = await semearPaciente(sessao.usuarioId, { nome: 'João' });
    const resposta = await editar(sessao, id, {
      ...TERCA,
      paciente_id: outroPaciente,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ paciente_id: outroPaciente, row_version: 2 });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([
      expect.objectContaining({ campos_alterados: ['paciente_id'] }),
    ]);
  });

  it('sessão cancelada não ocupa o horário: mover para cima de outra não conflita', async () => {
    const { sessao, pacienteId, id } = await cenario({ status: 'cancelada' });
    await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    expect((await editar(sessao, id, { ...QUARTA, row_version: 1 })).status).toBe(200);
  });

  it('sessão realizada ocupa o horário: mover para cima de outra conflita', async () => {
    const { sessao, pacienteId, id } = await cenario({ status: 'realizada' });
    await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    expect((await editar(sessao, id, { ...QUARTA, row_version: 1 })).status).toBe(409);
  });
});

describe('isolamento e não encontrada (ISO-02)', () => {
  it('sessão de outro profissional, inexistente ou id malformado: o mesmo 404, sem gravar', async () => {
    const a = await cenario();
    const b = await cenario();
    const antes = await linhaSessao(b.id);
    const respostas = await Promise.all(
      [b.id, crypto.randomUUID(), 'nao-e-uuid'].map((id) =>
        editar(a.sessao, id, { ...QUARTA, row_version: 1 }),
      ),
    );
    const corpos = await Promise.all(respostas.map((r) => r.json()));
    expect(respostas.map((r) => r.status)).toEqual([404, 404, 404]);
    for (const corpo of corpos) expect(corpo).toEqual(PROBLEMA_SESSAO_NAO_ENCONTRADA);
    expect(await linhaSessao(b.id)).toEqual(antes);
    expect(await auditoriaDe(a.sessao.usuarioId, 'sessao.editada')).toEqual([]);
  });
});

describe('nada é apagado (AGE-17)', () => {
  it('não existe DELETE /api/sessoes/:id e a sessão continua lá', async () => {
    const { sessao, id } = await cenario();
    const resposta = await pedir('DELETE', `/api/sessoes/${id}`, sessao);
    expect(resposta.status).toBe(404);
    expect((await sessoesDe(sessao.usuarioId)).map((s) => s.id)).toEqual([id]);
  });

  it('nenhum caminho de erro ou sucesso da edição apaga a sessão', async () => {
    const { sessao, pacienteId, id } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, QUARTA);
    await editar(sessao, id, { ...QUARTA, row_version: 1 }); // 409 conflito
    await editar(sessao, id, { ...SABADO, row_version: 1 }); // 422 dia
    await editar(sessao, id, { ...TERCA, row_version: 9 }); // 409 versão
    await editar(sessao, id, { ...QUARTA, confirmar_conflito: true, row_version: 1 }); // 200
    expect(await sessoesDe(sessao.usuarioId)).toHaveLength(2);
    expect(await linhaSessao(id)).toMatchObject({ status: 'agendada' });
  });
});
