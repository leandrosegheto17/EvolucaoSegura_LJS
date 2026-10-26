import { PROBLEMA_SESSAO_COM_REGISTROS } from '@es/contrato/agenda';
import { esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearSessao } from './sessoes-apoio.ts';

// T113 / AGE-08: a guarda dos registros da sessão (evolução ou pagamento).
// - POST /api/sessoes/:id/status: realizada -> cancelada com evolução ou com pagamento responde
//   422 SESSION_HAS_RECORDS, sem mudar nada; sem registros, cancela.
// - PUT /api/sessoes/:id: trocar o paciente de sessão com evolução ou pagamento responde 422
//   SESSION_HAS_RECORDS (decisão do usuário de 2026-10-26: a evolução guarda o paciente e ficaria
//   ligada à pessoa errada); horário, link e cobravel continuam livres.

const LENTO = { timeout: 30_000 };
const TERCA = { inicio: '2026-11-10T10:00:00-03:00', fim: '2026-11-10T10:50:00-03:00' };
const QUARTA = { inicio: '2026-11-11T15:00:00-03:00', fim: '2026-11-11T15:50:00-03:00' };

type Registro = 'evolucao' | 'pagamento' | 'nenhum';

async function cenario(registro: Registro) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const id = await semearSessao(sessao.usuarioId, pacienteId, { ...TERCA, status: 'realizada' });
  if (registro === 'evolucao')
    await comoAdmin(
      `insert into evolucao (usuario_id, paciente_id, sessao_id, texto) values ($1, $2, $3, 'x')`,
      [sessao.usuarioId, pacienteId, id],
    );
  if (registro === 'pagamento')
    await comoAdmin(
      `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
       values ($1, $2, 100, '2026-11-10', 'pix')`,
      [sessao.usuarioId, id],
    );
  return { sessao, pacienteId, id };
}

async function esperarRegistros(resposta: Response) {
  expect(resposta.status).toBe(422);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(PROBLEMA_SESSAO_COM_REGISTROS);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

describe('cancelar sessão realizada (AGE-08)', LENTO, () => {
  it.each(['evolucao', 'pagamento'] as const)(
    'com %s: 422 SESSION_HAS_RECORDS e nada muda',
    async (registro) => {
      const { sessao, id } = await cenario(registro);
      await esperarRegistros(
        await pedir('POST', `/api/sessoes/${id}/status`, sessao, {
          status: 'cancelada',
          row_version: 1,
        }),
      );
      expect(await linhaSessao(id)).toMatchObject({ status: 'realizada', row_version: 1 });
      expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([]);
    },
  );

  it('sem registros, cancela', async () => {
    const { sessao, id } = await cenario('nenhum');
    const resposta = await pedir('POST', `/api/sessoes/${id}/status`, sessao, {
      status: 'cancelada',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ status: 'cancelada', row_version: 2 });
  });

  it('evolução do paciente sem ligação com a sessão não conta como registro da sessão', async () => {
    const { sessao, pacienteId, id } = await cenario('nenhum');
    await comoAdmin(
      `insert into evolucao (usuario_id, paciente_id, texto) values ($1, $2, 'avulsa')`,
      [sessao.usuarioId, pacienteId],
    );
    const resposta = await pedir('POST', `/api/sessoes/${id}/status`, sessao, {
      status: 'cancelada',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
  });

  it('com registros, as outras transições seguem livres (realizada -> faltou)', async () => {
    const { sessao, id } = await cenario('pagamento');
    const resposta = await pedir('POST', `/api/sessoes/${id}/status`, sessao, {
      status: 'faltou',
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ status: 'faltou' });
  });
});

describe('trocar o paciente de sessão com registros', LENTO, () => {
  const editar = (
    sessao: Awaited<ReturnType<typeof sessaoDeTeste>>,
    id: string,
    corpo: Record<string, unknown>,
  ) => pedir('PUT', `/api/sessoes/${id}`, sessao, { ...TERCA, row_version: 1, ...corpo });

  it.each(['evolucao', 'pagamento'] as const)(
    'com %s: 422 SESSION_HAS_RECORDS e nada muda',
    async (registro) => {
      const { sessao, pacienteId, id } = await cenario(registro);
      const outro = await semearPaciente(sessao.usuarioId, { nome: 'Outro Paciente' });
      await esperarRegistros(await editar(sessao, id, { paciente_id: outro }));
      expect(await linhaSessao(id)).toMatchObject({ paciente_id: pacienteId, row_version: 1 });
      expect(await auditoriaDe(sessao.usuarioId, 'sessao.editada')).toEqual([]);
    },
  );

  it('sem registros, troca o paciente', async () => {
    const { sessao, id } = await cenario('nenhum');
    const outro = await semearPaciente(sessao.usuarioId, { nome: 'Outro Paciente' });
    expect((await editar(sessao, id, { paciente_id: outro })).status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ paciente_id: outro, row_version: 2 });
  });

  it('com registros, o mesmo paciente no corpo não é troca', async () => {
    const { sessao, pacienteId, id } = await cenario('evolucao');
    const resposta = await editar(sessao, id, { paciente_id: pacienteId, link: 'https://x.y/z' });
    expect(resposta.status).toBe(200);
    expect(await linhaSessao(id)).toMatchObject({ link: 'https://x.y/z' });
  });

  it.each(['evolucao', 'pagamento'] as const)(
    'com %s, horário, link e cobravel continuam livres',
    async (registro) => {
      const { sessao, pacienteId, id } = await cenario(registro);
      const resposta = await editar(sessao, id, {
        ...QUARTA,
        link: 'https://exemplo.com/sala',
        cobravel: true,
      });
      expect(resposta.status).toBe(200);
      expect(await linhaSessao(id)).toMatchObject({
        paciente_id: pacienteId,
        inicio: new Date(QUARTA.inicio).toISOString(),
        link: 'https://exemplo.com/sala',
        cobravel: true,
        row_version: 2,
      });
    },
  );
});
