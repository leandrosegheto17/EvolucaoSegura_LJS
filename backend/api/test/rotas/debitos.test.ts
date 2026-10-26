import {
  type ListaDebitos,
  PROBLEMA_CONSULTA_DEBITOS_INVALIDA,
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  type PendenciasPaciente,
} from '@es/contrato/financeiro';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { pedir, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao } from './sessoes-apoio.ts';

// T112 / FIN-06, FIN-07, ISO-02: GET /api/debitos e GET /api/debitos/:pacienteId.
// - FIN-06: em débito a sessão realizada sem pagamento e a faltou ou cancelada cobrável sem
//   pagamento; agendada e remarcada nunca.
// - FIN-07: filtro em_debito, em_dia ou ausente (todos); total pendente em centavos inteiros.
// - Decisões do usuário (2026-10-26): todos os pacientes (ativos e inativos), em ordem de nome,
//   sem paginação; o valor da sessão é o ajuste da sessão ou o preço do paciente; sessão sem preço
//   vem com valor null e conta 0. Filtro inválido = 400 consulta_invalida.
// - ISO-02: só dados do profissional; paciente de outro = 404 igual ao inexistente.

const LENTO = { timeout: 30_000 };

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

type Status = 'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada';
let minuto = 0;

async function sessao(
  usuarioId: string,
  pacienteId: string,
  status: Status,
  opcoes: { cobravel?: boolean; pago?: boolean; ajuste?: number } = {},
): Promise<string> {
  minuto += 60;
  const inicio = new Date(Date.UTC(2026, 9, 1, 12) + minuto * 60_000);
  const id = await semearSessao(usuarioId, pacienteId, {
    inicio: inicio.toISOString(),
    fim: new Date(inicio.getTime() + 50 * 60_000).toISOString(),
    status,
    cobravel: opcoes.cobravel ?? false,
  });
  if (opcoes.pago)
    await comoAdmin(
      `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
       values ($1, $2, 1, '2026-10-01', 'pix')`,
      [usuarioId, id],
    );
  if (opcoes.ajuste !== undefined)
    await comoAdmin(
      'insert into preco_sessao (usuario_id, sessao_id, valor_centavos) values ($1, $2, $3)',
      [usuarioId, id, opcoes.ajuste],
    );
  return id;
}

const definirPreco = (usuarioId: string, pacienteId: string, valor: number) =>
  comoAdmin(
    'insert into preco_paciente (usuario_id, paciente_id, valor_centavos) values ($1, $2, $3)',
    [usuarioId, pacienteId, valor],
  );

// Ana: preço 15000; realizada (15000), faltou cobrável com ajuste 12000, e sessões que não contam.
// Bruno: tudo pago ou sem cobrança. Carla (inativa, sem preço): realizada sem pagamento.
async function cenario() {
  const prof = await sessaoDeTeste();
  const u = prof.usuarioId;
  const ana = await semearPaciente(u, { nome: 'ana Lima' });
  const bruno = await semearPaciente(u, { nome: 'Bruno Reis' });
  const carla = await semearPaciente(u, { nome: 'Carla Dias', ativo: false });
  await definirPreco(u, ana, 15000);
  await definirPreco(u, bruno, 20000);
  const s = {
    anaRealizada: await sessao(u, ana, 'realizada'),
    anaFaltouCobravel: await sessao(u, ana, 'faltou', { cobravel: true, ajuste: 12000 }),
    anaFaltouSemCobrar: await sessao(u, ana, 'faltou', { cobravel: false }),
    anaCanceladaPaga: await sessao(u, ana, 'cancelada', { cobravel: true, pago: true }),
    anaAgendada: await sessao(u, ana, 'agendada', { cobravel: true }),
    anaRemarcada: await sessao(u, ana, 'remarcada', { cobravel: true }),
    brunoRealizadaPaga: await sessao(u, bruno, 'realizada', { pago: true }),
    brunoCanceladaSemCobrar: await sessao(u, bruno, 'cancelada'),
    carlaRealizada: await sessao(u, carla, 'realizada'),
  };
  return { prof, ana, bruno, carla, s };
}

describe('exige sessão', LENTO, () => {
  it('sem sessão, as duas rotas respondem 401', async () => {
    const lista = await pedir('GET', '/api/debitos', null);
    expect(lista.status).toBe(401);
    expect(await lista.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect((await pedir('GET', `/api/debitos/${crypto.randomUUID()}`, null)).status).toBe(401);
  });
});

describe('lista de débitos (FIN-06, FIN-07)', LENTO, () => {
  it('todos: cada paciente com situação, contagem e valor; total em centavos', async () => {
    const { prof, ana, bruno, carla } = await cenario();
    const resposta = await pedir('GET', '/api/debitos', prof);
    expect(resposta.status).toBe(200);
    expect((await resposta.json()) as ListaDebitos).toEqual({
      items: [
        {
          paciente_id: ana,
          nome: 'ana Lima',
          status: 'em_debito',
          sessoes_pendentes: 2,
          valor_pendente: 27000,
        },
        {
          paciente_id: bruno,
          nome: 'Bruno Reis',
          status: 'em_dia',
          sessoes_pendentes: 0,
          valor_pendente: 0,
        },
        {
          paciente_id: carla,
          nome: 'Carla Dias',
          status: 'em_debito',
          sessoes_pendentes: 1,
          valor_pendente: 0,
        },
      ],
      total_pendente: 27000,
    });
  });

  it('filtro em_debito', async () => {
    const { prof, ana, carla } = await cenario();
    const lista = (await (
      await pedir('GET', '/api/debitos?status=em_debito', prof)
    ).json()) as ListaDebitos;
    expect(lista.items.map((i) => i.paciente_id)).toEqual([ana, carla]);
    expect(lista.total_pendente).toBe(27000);
  });

  it('filtro em_dia', async () => {
    const { prof, bruno } = await cenario();
    const lista = (await (
      await pedir('GET', '/api/debitos?status=em_dia', prof)
    ).json()) as ListaDebitos;
    expect(lista.items.map((i) => i.paciente_id)).toEqual([bruno]);
    expect(lista.total_pendente).toBe(0);
  });

  it('o pagamento tira a sessão do débito', async () => {
    const { prof, ana, s } = await cenario();
    await comoAdmin(
      `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
       values ($1, $2, 15000, '2026-10-02', 'pix')`,
      [prof.usuarioId, s.anaRealizada],
    );
    const lista = (await (await pedir('GET', '/api/debitos', prof)).json()) as ListaDebitos;
    expect(lista.items.find((i) => i.paciente_id === ana)).toMatchObject({
      sessoes_pendentes: 1,
      valor_pendente: 12000,
    });
    expect(lista.total_pendente).toBe(12000);
  });

  it('filtro inválido ou parâmetro desconhecido: 400 consulta_invalida', async () => {
    const prof = await sessaoDeTeste();
    for (const consulta of ['status=todos', 'status=', 'pagina=2'])
      await esperarProblema(
        await pedir('GET', `/api/debitos?${consulta}`, prof),
        400,
        PROBLEMA_CONSULTA_DEBITOS_INVALIDA,
      );
  });

  it('sem pacientes: lista vazia e total 0', async () => {
    const prof = await sessaoDeTeste();
    expect(await (await pedir('GET', '/api/debitos', prof)).json()).toEqual({
      items: [],
      total_pendente: 0,
    });
  });
});

describe('pendências de um paciente', LENTO, () => {
  it('só as sessões em débito, em ordem de início, com o valor de cada uma', async () => {
    const { prof, ana, s } = await cenario();
    const resposta = await pedir('GET', `/api/debitos/${ana}`, prof);
    expect(resposta.status).toBe(200);
    const corpo = (await resposta.json()) as PendenciasPaciente;
    expect(corpo).toEqual({
      paciente_id: ana,
      nome: 'ana Lima',
      sessoes: [
        {
          sessao_id: s.anaRealizada,
          inicio: expect.any(String),
          status: 'realizada',
          valor: 15000,
        },
        {
          sessao_id: s.anaFaltouCobravel,
          inicio: expect.any(String),
          status: 'faltou',
          valor: 12000,
        },
      ],
      total_sessoes: 2,
      valor_pendente: 27000,
    });
    expect(Date.parse(corpo.sessoes[0]!.inicio)).toBeLessThan(Date.parse(corpo.sessoes[1]!.inicio));
  });

  it('sessão sem preço vem com valor null e conta 0', async () => {
    const { prof, carla, s } = await cenario();
    const corpo = (await (
      await pedir('GET', `/api/debitos/${carla}`, prof)
    ).json()) as PendenciasPaciente;
    expect(corpo.sessoes).toEqual([
      { sessao_id: s.carlaRealizada, inicio: expect.any(String), status: 'realizada', valor: null },
    ]);
    expect(corpo.valor_pendente).toBe(0);
  });

  it('paciente em dia: lista vazia', async () => {
    const { prof, bruno } = await cenario();
    expect(await (await pedir('GET', `/api/debitos/${bruno}`, prof)).json()).toMatchObject({
      sessoes: [],
      total_sessoes: 0,
      valor_pendente: 0,
    });
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('a lista só traz pacientes do profissional', async () => {
    await cenario();
    const outra = await sessaoDeTeste();
    const proprio = await semearPaciente(outra.usuarioId, { nome: 'Davi' });
    const lista = (await (await pedir('GET', '/api/debitos', outra)).json()) as ListaDebitos;
    expect(lista.items.map((i) => i.paciente_id)).toEqual([proprio]);
    expect(lista.total_pendente).toBe(0);
  });

  it('paciente de outro profissional: o mesmo 404 do inexistente e do id malformado', async () => {
    const { ana } = await cenario();
    const intrusa = await sessaoDeTeste();
    for (const alvo of [ana, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await pedir('GET', `/api/debitos/${alvo}`, intrusa),
        404,
        PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
      );
  });
});
