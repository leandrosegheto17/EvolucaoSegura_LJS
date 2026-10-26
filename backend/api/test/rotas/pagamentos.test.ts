import {
  type Pagamento,
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  PROBLEMA_PAGAMENTO_DUPLICADO,
  PROBLEMA_PRECO_OBRIGATORIO,
} from '@es/contrato/financeiro';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao } from './sessoes-apoio.ts';

// T111 / FIN-03, FIN-04, FIN-05, FIN-08, ISO-02: PUT /api/sessoes/:id/pagamento.
// - FIN-03: data YYYY-MM-DD, meio da lista e valor opcional em centavos; sem valor, usa o ajuste
//   de preço da sessão e, sem ele, o preço do paciente (decisão do usuário de 2026-10-26).
// - FIN-04: sem valor e sem preço, 422 PRICE_REQUIRED.
// - FIN-05: já existe pagamento e não há confirmar_duplicidade, 422 PAYMENT_DUPLICATE; com ele,
//   corrige gerando revisão (sem row_version; valor ausente mantém o anterior; 201 ao criar e 200
//   ao corrigir, como o legado).
// - FIN-08: sem exclusão; audita pagamento.registrado e pagamento.corrigido, só nomes de campo.
// - Pagamento aceito em qualquer status da sessão (decisão do usuário).
// - ISO-02: sessão de outro profissional = 404 idêntico ao inexistente.

const LENTO = { timeout: 30_000 };

const pagar = (sessao: Sessao | null, sessaoId: string, corpo: unknown) =>
  pedir('PUT', `/api/sessoes/${sessaoId}/pagamento`, sessao, corpo);

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

const pagamentosDa = (sessaoId: string) =>
  comoAdmin<{ valor_centavos: string; data: string; meio: string; row_version: number }>(
    `select valor_centavos, to_char(data_pagamento, 'YYYY-MM-DD') as data, meio, row_version
     from pagamento where sessao_id = $1`,
    [sessaoId],
  );
const revisoesDa = (sessaoId: string) =>
  comoAdmin<{ antes: Record<string, unknown>; depois: Record<string, unknown> }>(
    `select r.antes, r.depois from pagamento_revisao r join pagamento p on p.id = r.pagamento_id
     where p.sessao_id = $1 order by r.id`,
    [sessaoId],
  );

type Status = 'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada';

// Profissional com paciente e uma sessão; preços opcionais semeados direto no banco.
async function cenario(
  opcoes: { precoPaciente?: number; precoSessao?: number; status?: Status } = {},
) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const sessaoId = await semearSessao(sessao.usuarioId, pacienteId, {
    inicio: '2026-10-20T13:00:00Z',
    fim: '2026-10-20T13:50:00Z',
    status: opcoes.status ?? 'realizada',
  });
  if (opcoes.precoPaciente !== undefined)
    await comoAdmin(
      'insert into preco_paciente (usuario_id, paciente_id, valor_centavos) values ($1, $2, $3)',
      [sessao.usuarioId, pacienteId, opcoes.precoPaciente],
    );
  if (opcoes.precoSessao !== undefined)
    await comoAdmin(
      'insert into preco_sessao (usuario_id, sessao_id, valor_centavos) values ($1, $2, $3)',
      [sessao.usuarioId, sessaoId, opcoes.precoSessao],
    );
  return { sessao, pacienteId, sessaoId };
}

describe('exige sessão e CSRF', LENTO, () => {
  it('sem sessão responde 401', async () => {
    const resposta = await pagar(null, crypto.randomUUID(), { data: '2026-10-20', meio: 'pix' });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem o x-csrf-token certo responde 403 e nada é gravado', async () => {
    const { sessao, sessaoId } = await cenario();
    const resposta = await pagar({ ...sessao, csrf: 'x' }, sessaoId, {
      data: '2026-10-20',
      meio: 'pix',
      valor: 100,
    });
    expect(resposta.status).toBe(403);
    expect(await pagamentosDa(sessaoId)).toEqual([]);
  });
});

describe('registrar (FIN-03, FIN-04, FIN-08)', LENTO, () => {
  it('com valor: 201 com o pagamento em centavos e auditoria pagamento.registrado', async () => {
    const { sessao, sessaoId } = await cenario();
    const resposta = await pagar(sessao, sessaoId, {
      data: '2026-10-20',
      meio: 'pix',
      valor: 15050,
    });
    expect(resposta.status).toBe(201);
    const pagamento = (await resposta.json()) as Pagamento;
    expect(pagamento).toEqual({
      id: expect.any(String),
      sessao_id: sessaoId,
      valor: 15050,
      data: '2026-10-20',
      meio: 'pix',
      row_version: 1,
      criado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '15050', data: '2026-10-20', meio: 'pix', row_version: 1 },
    ]);
    const auditoria = await auditoriaDe(sessao.usuarioId, 'pagamento.registrado');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      ator: sessao.usuarioId,
      alvo_tipo: 'pagamento',
      alvo_id: pagamento.id,
    });
  });

  it('sem valor usa o preço do paciente', async () => {
    const { sessao, sessaoId } = await cenario({ precoPaciente: 15000 });
    const resposta = await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'dinheiro' });
    expect(resposta.status).toBe(201);
    expect(((await resposta.json()) as Pagamento).valor).toBe(15000);
  });

  it('sem valor usa o ajuste da sessão antes do preço do paciente', async () => {
    const { sessao, sessaoId } = await cenario({ precoPaciente: 15000, precoSessao: 12000 });
    const resposta = await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'dinheiro' });
    expect(resposta.status).toBe(201);
    expect(((await resposta.json()) as Pagamento).valor).toBe(12000);
  });

  it('sem valor e sem preço: 422 PRICE_REQUIRED, nada gravado nem auditado', async () => {
    const { sessao, sessaoId } = await cenario();
    await esperarProblema(
      await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'pix' }),
      422,
      PROBLEMA_PRECO_OBRIGATORIO,
    );
    expect(await pagamentosDa(sessaoId)).toEqual([]);
    expect(await auditoriaDe(sessao.usuarioId, 'pagamento.registrado')).toEqual([]);
  });

  it('valor 0 informado é aceito mesmo sem preço', async () => {
    const { sessao, sessaoId } = await cenario();
    const resposta = await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'outro', valor: 0 });
    expect(resposta.status).toBe(201);
    expect(((await resposta.json()) as Pagamento).valor).toBe(0);
  });

  it('meio com maiúscula e acento é gravado da lista', async () => {
    const { sessao, sessaoId } = await cenario();
    const resposta = await pagar(sessao, sessaoId, {
      data: '2026-10-20',
      meio: 'Cartão',
      valor: 100,
    });
    expect(resposta.status).toBe(201);
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '100', data: '2026-10-20', meio: 'cartao', row_version: 1 },
    ]);
  });

  it('data inválida, meio fora da lista ou valor decimal: 422 validacao sem gravar', async () => {
    const { sessao, sessaoId } = await cenario({ precoPaciente: 100 });
    for (const [corpo, campo] of [
      [{ data: '2026-02-30', meio: 'pix' }, 'data'],
      [{ data: '2026-10-20', meio: 'cheque' }, 'meio'],
      [{ data: '2026-10-20', meio: 'pix', valor: 10.5 }, 'valor'],
    ] as const) {
      const resposta = await pagar(sessao, sessaoId, corpo);
      expect(resposta.status, campo).toBe(422);
      expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: [campo] });
    }
    expect(await pagamentosDa(sessaoId)).toEqual([]);
  });

  it.each(['agendada', 'faltou', 'cancelada', 'remarcada'] as const)(
    'aceita pagamento de sessão %s',
    async (status) => {
      const { sessao, sessaoId } = await cenario({ status });
      const resposta = await pagar(sessao, sessaoId, {
        data: '2026-10-20',
        meio: 'pix',
        valor: 100,
      });
      expect(resposta.status).toBe(201);
    },
  );
});

describe('duplicado e correção (FIN-05, FIN-08)', LENTO, () => {
  async function comPagamento() {
    const dados = await cenario({ precoPaciente: 15000 });
    const resposta = await pagar(dados.sessao, dados.sessaoId, {
      data: '2026-10-20',
      meio: 'pix',
    });
    expect(resposta.status).toBe(201);
    return dados;
  }

  it('sem confirmar_duplicidade: 422 PAYMENT_DUPLICATE e nada muda', async () => {
    const { sessao, sessaoId } = await comPagamento();
    for (const confirmar of [undefined, false]) {
      await esperarProblema(
        await pagar(sessao, sessaoId, {
          data: '2026-10-21',
          meio: 'dinheiro',
          valor: 1,
          ...(confirmar === undefined ? {} : { confirmar_duplicidade: confirmar }),
        }),
        422,
        PROBLEMA_PAGAMENTO_DUPLICADO,
      );
    }
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '15000', data: '2026-10-20', meio: 'pix', row_version: 1 },
    ]);
    expect(await revisoesDa(sessaoId)).toEqual([]);
    expect(await auditoriaDe(sessao.usuarioId, 'pagamento.corrigido')).toEqual([]);
  });

  it('com confirmar_duplicidade: 200, corrige, gera revisão e audita os campos mudados', async () => {
    const { sessao, sessaoId } = await comPagamento();
    const resposta = await pagar(sessao, sessaoId, {
      data: '2026-10-21',
      meio: 'dinheiro',
      valor: 14000,
      confirmar_duplicidade: true,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      sessao_id: sessaoId,
      valor: 14000,
      data: '2026-10-21',
      meio: 'dinheiro',
      row_version: 2,
    });
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '14000', data: '2026-10-21', meio: 'dinheiro', row_version: 2 },
    ]);
    const revisoes = await revisoesDa(sessaoId);
    expect(revisoes).toHaveLength(1);
    expect(revisoes[0]!.antes).toMatchObject({ valor_centavos: 15000, meio: 'pix' });
    expect(revisoes[0]!.depois).toMatchObject({ valor_centavos: 14000, meio: 'dinheiro' });
    const auditoria = await auditoriaDe(sessao.usuarioId, 'pagamento.corrigido');
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ alvo_tipo: 'pagamento' });
    expect([...auditoria[0]!.campos_alterados].sort()).toEqual(['data', 'meio', 'valor']);
  });

  it('correção sem valor mantém o valor anterior e audita só o que mudou', async () => {
    const { sessao, sessaoId } = await comPagamento();
    const resposta = await pagar(sessao, sessaoId, {
      data: '2026-10-20',
      meio: 'transferencia',
      confirmar_duplicidade: true,
    });
    expect(resposta.status).toBe(200);
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '15000', data: '2026-10-20', meio: 'transferencia', row_version: 2 },
    ]);
    const auditoria = await auditoriaDe(sessao.usuarioId, 'pagamento.corrigido');
    expect(auditoria.map((a) => a.campos_alterados)).toEqual([['meio']]);
  });

  it('correção sem mudança: 200 sem subir a versão, sem revisão e sem auditar', async () => {
    const { sessao, sessaoId } = await comPagamento();
    const resposta = await pagar(sessao, sessaoId, {
      data: '2026-10-20',
      meio: 'pix',
      valor: 15000,
      confirmar_duplicidade: true,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ row_version: 1 });
    expect(await revisoesDa(sessaoId)).toEqual([]);
    expect(await auditoriaDe(sessao.usuarioId, 'pagamento.corrigido')).toEqual([]);
  });
});

describe('sem exclusão (FIN-08)', LENTO, () => {
  it('DELETE do pagamento não existe e o pagamento fica', async () => {
    const { sessao, sessaoId } = await cenario();
    expect(
      (await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'pix', valor: 1 })).status,
    ).toBe(201);
    expect((await pedir('DELETE', `/api/sessoes/${sessaoId}/pagamento`, sessao)).status).toBe(404);
    expect(await pagamentosDa(sessaoId)).toHaveLength(1);
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('sessão de outro profissional: o mesmo 404 do inexistente e do id malformado', async () => {
    const { sessaoId } = await cenario({ precoPaciente: 100 });
    const intrusa = await sessaoDeTeste();
    for (const alvo of [sessaoId, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await pagar(intrusa, alvo, {
          data: '2026-10-20',
          meio: 'pix',
          valor: 1,
          confirmar_duplicidade: true,
        }),
        404,
        PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
      );
    expect(await pagamentosDa(sessaoId)).toEqual([]);
    expect(await auditoriaDe(intrusa.usuarioId, 'pagamento.registrado')).toEqual([]);
  });

  it('não corrige o pagamento de outro profissional', async () => {
    const { sessao, sessaoId } = await cenario();
    expect(
      (await pagar(sessao, sessaoId, { data: '2026-10-20', meio: 'pix', valor: 500 })).status,
    ).toBe(201);
    const intrusa = await sessaoDeTeste();
    await esperarProblema(
      await pagar(intrusa, sessaoId, {
        data: '2026-10-21',
        meio: 'outro',
        valor: 1,
        confirmar_duplicidade: true,
      }),
      404,
      PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
    );
    expect(await pagamentosDa(sessaoId)).toEqual([
      { valor_centavos: '500', data: '2026-10-20', meio: 'pix', row_version: 1 },
    ]);
  });
});
