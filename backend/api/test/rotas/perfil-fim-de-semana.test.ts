import { problemaFimDeSemanaComSessoes } from '@es/contrato/perfil';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao, sessoesDe } from './sessoes-apoio.ts';

// T82 / PERF-06, PERF-07: PUT /api/perfil desligando sábado ou domingo.
// - Sem `confirmar: true` e com sessões futuras não canceladas nesse dia: 409
//   WEEKEND_DAY_HAS_SESSIONS com a quantidade, e nada é salvo.
// - Com `confirmar: true`: salva e mantém as sessões.
// - Só contam sessões futuras e não canceladas, do próprio profissional, no dia desligado
//   (America/Sao_Paulo).
// Datas: sábado 2030-01-05, domingo 2030-01-06, terça 2030-01-08 (futuras) e sábado 2020-01-04
// (passada).

const em = (dia: string, hora = '10:00') => ({
  inicio: `${dia}T${hora}:00-03:00`,
  fim: `${dia}T${hora.slice(0, 2)}:50:00-03:00`,
});
const SABADO = '2030-01-05';
const DOMINGO = '2030-01-06';
const TERCA = '2030-01-08';
const SABADO_PASSADO = '2020-01-04';

const salvar = (sessao: Sessao, corpo: Record<string, unknown>) =>
  pedir('PUT', '/api/perfil', sessao, { nome: 'Dra. Ana', ...corpo });

const linhaPerfil = async (usuarioId: string) =>
  (
    await comoAdmin<{ atende_sabado: boolean; atende_domingo: boolean; row_version: number }>(
      'select atende_sabado, atende_domingo, row_version from perfil where usuario_id = $1',
      [usuarioId],
    )
  )[0];

// Profissional com sábado e domingo ligados (salvos pela própria rota) e um paciente.
async function cenario() {
  const sessao = await sessaoDeTeste();
  const resposta = await salvar(sessao, { atende_sabado: true, atende_domingo: true });
  expect(resposta.status).toBe(200);
  const pacienteId = await semearPaciente(sessao.usuarioId);
  return { sessao, pacienteId };
}

describe('desligar com sessões futuras, sem confirmar (PERF-06)', () => {
  it('responde 409 WEEKEND_DAY_HAS_SESSIONS com a quantidade e nada é salvo', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO, '09:00'));
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO, '11:00'));
    const antes = await linhaPerfil(sessao.usuarioId);

    const resposta = await salvar(sessao, {
      contato: 'novo contato',
      atende_sabado: false,
      atende_domingo: true,
    });
    expect(resposta.status).toBe(409);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(2));
    expect(await linhaPerfil(sessao.usuarioId)).toEqual(antes);
    expect(
      await comoAdmin('select contato from perfil where usuario_id = $1', [sessao.usuarioId]),
    ).toEqual([{ contato: null }]);
    expect(await auditoriaDe(sessao.usuarioId, 'perfil.editado')).toHaveLength(1);
  });

  it('confirmar: false também responde 409', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(DOMINGO));
    const resposta = await salvar(sessao, { atende_domingo: false, confirmar: false });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(1));
  });

  it('desligar os dois soma as sessões de sábado e de domingo', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO));
    await semearSessao(sessao.usuarioId, pacienteId, em(DOMINGO, '09:00'));
    await semearSessao(sessao.usuarioId, pacienteId, em(DOMINGO, '11:00'));
    const resposta = await salvar(sessao, { atende_sabado: false, atende_domingo: false });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(3));
  });

  it('desligar só o sábado não conta as sessões de domingo', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(DOMINGO));
    const resposta = await salvar(sessao, { atende_sabado: false });
    expect(resposta.status).toBe(200);
    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      atende_sabado: false,
      atende_domingo: true,
    });
  });

  it('o dia é o de São Paulo: sábado 23:30 (domingo em UTC) conta para o sábado', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: `${SABADO}T23:30:00-03:00`,
      fim: `${DOMINGO}T00:20:00-03:00`,
    });
    expect((await salvar(sessao, { atende_domingo: false })).status).toBe(200);
    const resposta = await salvar(sessao, { atende_sabado: false });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(1));
  });
});

describe('com confirmar: true (PERF-07)', () => {
  it('salva e mantém as sessões existentes nesse dia', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO));
    await semearSessao(sessao.usuarioId, pacienteId, em(DOMINGO));
    const sessoesAntes = await sessoesDe(sessao.usuarioId);

    const resposta = await salvar(sessao, {
      atende_sabado: false,
      atende_domingo: false,
      confirmar: true,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ atende_sabado: false, atende_domingo: false });
    expect(await linhaPerfil(sessao.usuarioId)).toMatchObject({
      atende_sabado: false,
      atende_domingo: false,
    });
    expect(await sessoesDe(sessao.usuarioId)).toEqual(sessoesAntes);
    expect(await auditoriaDe(sessao.usuarioId, 'perfil.editado')).toEqual([
      expect.anything(),
      expect.objectContaining({ campos_alterados: ['atende_sabado', 'atende_domingo'] }),
    ]);
  });
});

describe('só conta sessões futuras não canceladas (PERF-06)', () => {
  it('sessão passada no sábado não conta', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO_PASSADO));
    expect((await salvar(sessao, { atende_sabado: false })).status).toBe(200);
  });

  it('sessão futura cancelada no sábado não conta', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, { ...em(SABADO), status: 'cancelada' });
    expect((await salvar(sessao, { atende_sabado: false })).status).toBe(200);
  });

  it.each(['agendada', 'realizada', 'faltou', 'remarcada'] as const)(
    'sessão futura %s no sábado conta',
    async (status) => {
      const { sessao, pacienteId } = await cenario();
      await semearSessao(sessao.usuarioId, pacienteId, { ...em(SABADO), status });
      const resposta = await salvar(sessao, { atende_sabado: false });
      expect(resposta.status).toBe(409);
      expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(1));
    },
  );

  it('conta só as futuras não canceladas quando há de todo tipo', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO, '08:00'));
    await semearSessao(sessao.usuarioId, pacienteId, {
      ...em(SABADO, '09:00'),
      status: 'cancelada',
    });
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO_PASSADO));
    await semearSessao(sessao.usuarioId, pacienteId, em(TERCA));
    const resposta = await salvar(sessao, { atende_sabado: false });
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(problemaFimDeSemanaComSessoes(1));
  });

  it('sessões de outro profissional no sábado não contam', async () => {
    const { sessao } = await cenario();
    const outro = await sessaoDeTeste();
    const pacienteDoOutro = await semearPaciente(outro.usuarioId);
    await semearSessao(outro.usuarioId, pacienteDoOutro, em(SABADO));
    expect((await salvar(sessao, { atende_sabado: false })).status).toBe(200);
  });

  it('sem sessões futuras no dia, desliga sem pedir confirmação', async () => {
    const { sessao, pacienteId } = await cenario();
    await semearSessao(sessao.usuarioId, pacienteId, em(TERCA));
    expect((await salvar(sessao, { atende_sabado: false, atende_domingo: false })).status).toBe(
      200,
    );
  });

  it('o dia já desligado não é checado de novo (só ligado para desligado)', async () => {
    const sessao = await sessaoDeTeste();
    expect((await salvar(sessao, { atende_sabado: false })).status).toBe(200);
    const pacienteId = await semearPaciente(sessao.usuarioId);
    // Sessão no sábado desligado (ex.: mantida por um confirmar anterior).
    await semearSessao(sessao.usuarioId, pacienteId, em(SABADO));
    const resposta = await salvar(sessao, { contato: 'outro', atende_sabado: false });
    expect(resposta.status).toBe(200);
  });
});
