import { describe, expect, it } from 'vitest';
import {
  MEIOS_PAGAMENTO,
  PROBLEMA_CONSULTA_DEBITOS_INVALIDA,
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  PROBLEMA_PAGAMENTO_DUPLICADO,
  PROBLEMA_PRECO_OBRIGATORIO,
  PROBLEMA_VERSAO_PRECO,
  VALOR_MAXIMO_CENTAVOS,
  esquemaFiltroDebitos,
  esquemaPagamentoEntrada,
  esquemaPrecoEntrada,
} from './financeiro.ts';
import { esquemaProblema } from './identidade.ts';

// T108 / FIN-01, FIN-03: contrato do financeiro em centavos inteiros (ADR-007).
// - Valor inteiro de 0 a 9.999.999.999 centavos; decimal, texto e fora da faixa recusados.
// - Pagamento: data YYYY-MM-DD de calendário, meio da lista, valor opcional.
// - Corpo estrito; filtro de débitos em_debito, em_dia ou ausente (todos).

const aceita = (esquema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  esquema.safeParse(v).success;

describe('valor em centavos inteiros (FIN-01)', () => {
  const preco = (valor: unknown) => aceita(esquemaPrecoEntrada, { valor });

  it('aceita de 0 a 9.999.999.999', () => {
    expect(VALOR_MAXIMO_CENTAVOS).toBe(9_999_999_999);
    expect(preco(0)).toBe(true);
    expect(preco(15000)).toBe(true);
    expect(preco(9_999_999_999)).toBe(true);
  });

  it('decimal é recusado', () => {
    expect(preco(150.5)).toBe(false);
    expect(preco(0.01)).toBe(false);
  });

  it('negativo, acima do máximo, texto e ausente são recusados', () => {
    expect(preco(-1)).toBe(false);
    expect(preco(10_000_000_000)).toBe(false);
    expect(preco('15000')).toBe(false);
    expect(preco(null)).toBe(false);
    expect(aceita(esquemaPrecoEntrada, {})).toBe(false);
  });

  it('a mesma regra vale para o valor do pagamento', () => {
    const pagamento = (valor: unknown) =>
      aceita(esquemaPagamentoEntrada, { data: '2026-10-26', meio: 'pix', valor });
    expect(pagamento(9_999_999_999)).toBe(true);
    expect(pagamento(10.5)).toBe(false);
    expect(pagamento(10_000_000_000)).toBe(false);
  });
});

describe('preço: corpo (FIN-02)', () => {
  it('row_version opcional, inteiro positivo', () => {
    expect(esquemaPrecoEntrada.parse({ valor: 100 })).toEqual({ valor: 100 });
    expect(esquemaPrecoEntrada.parse({ valor: 100, row_version: 2 })).toEqual({
      valor: 100,
      row_version: 2,
    });
    expect(aceita(esquemaPrecoEntrada, { valor: 100, row_version: 0 })).toBe(false);
    expect(aceita(esquemaPrecoEntrada, { valor: 100, row_version: 1.5 })).toBe(false);
  });

  it('campo extra é recusado', () => {
    expect(aceita(esquemaPrecoEntrada, { valor: 100, moeda: 'BRL' })).toBe(false);
  });
});

describe('pagamento: data e meio (FIN-03)', () => {
  const pagamento = (extra: Record<string, unknown>) =>
    esquemaPagamentoEntrada.safeParse({ data: '2026-10-26', meio: 'pix', ...extra });

  it('valor é opcional (ausente usa o preço)', () => {
    expect(pagamento({}).data).toEqual({ data: '2026-10-26', meio: 'pix' });
  });

  it('data YYYY-MM-DD de calendário', () => {
    expect(pagamento({ data: '2024-02-29' }).success).toBe(true);
    expect(pagamento({ data: '2026-02-29' }).success).toBe(false);
    expect(pagamento({ data: '2026-13-01' }).success).toBe(false);
    expect(pagamento({ data: '26/10/2026' }).success).toBe(false);
    expect(pagamento({ data: '2026-10-26T10:00:00Z' }).success).toBe(false);
  });

  it('meio só da lista, gravado em minúsculas sem acento', () => {
    expect(MEIOS_PAGAMENTO).toEqual(['dinheiro', 'pix', 'cartao', 'transferencia', 'outro']);
    for (const meio of MEIOS_PAGAMENTO) expect(pagamento({ meio }).data?.meio).toBe(meio);
    expect(pagamento({ meio: ' Cartão ' }).data?.meio).toBe('cartao');
    expect(pagamento({ meio: 'TRANSFERÊNCIA' }).data?.meio).toBe('transferencia');
    expect(pagamento({ meio: 'cheque' }).success).toBe(false);
    expect(pagamento({ meio: '' }).success).toBe(false);
  });

  it('confirmar_duplicidade booleano e campo extra recusado', () => {
    expect(pagamento({ confirmar_duplicidade: true }).data?.confirmar_duplicidade).toBe(true);
    expect(pagamento({ confirmar_duplicidade: 'sim' }).success).toBe(false);
    expect(pagamento({ motivo: 'x' }).success).toBe(false);
  });
});

describe('filtro de débitos (FIN-07)', () => {
  it('em_debito, em_dia ou ausente (todos)', () => {
    expect(esquemaFiltroDebitos.parse({})).toEqual({});
    expect(esquemaFiltroDebitos.parse({ status: 'em_debito' })).toEqual({ status: 'em_debito' });
    expect(esquemaFiltroDebitos.parse({ status: 'em_dia' })).toEqual({ status: 'em_dia' });
    expect(aceita(esquemaFiltroDebitos, { status: 'todos' })).toBe(false);
    expect(aceita(esquemaFiltroDebitos, { pagina: '2' })).toBe(false);
  });
});

describe('erros do financeiro', () => {
  it.each([
    [PROBLEMA_FINANCEIRO_NAO_ENCONTRADO, 404, 'nao_encontrado'],
    [PROBLEMA_VERSAO_PRECO, 409, 'versao_divergente'],
    [PROBLEMA_PRECO_OBRIGATORIO, 422, 'PRICE_REQUIRED'],
    [PROBLEMA_PAGAMENTO_DUPLICADO, 422, 'PAYMENT_DUPLICATE'],
    [PROBLEMA_CONSULTA_DEBITOS_INVALIDA, 400, 'consulta_invalida'],
  ])('%o segue o problem+json do contrato', (p, status, codigo) => {
    expect(esquemaProblema.parse(p)).toEqual(p);
    expect(p.status).toBe(status);
    expect(p.codigo).toBe(codigo);
  });
});
