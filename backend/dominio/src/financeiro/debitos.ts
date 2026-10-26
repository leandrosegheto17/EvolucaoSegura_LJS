import type {
  ItemDebito,
  ListaDebitos,
  PendenciasPaciente,
  SessaoPendente,
  SituacaoDebito,
} from '@es/contrato/financeiro';

// FIN-03 a FIN-07: regras puras de débito, pagamento e preço, copiadas de debts.ts, payment.ts e
// price.ts do legado com dinheiro em centavos inteiros (ADR-007): sem toFixed(2) nem
// arredondamento por 100; a soma é de inteiros.

// FIN-06 (RN-07 do legado): realizada sem pagamento está em débito; faltou ou cancelada só se
// cobrável; agendada e remarcada nunca.
export function emDebito(sessao: { status: string; cobravel: boolean }, pago: boolean): boolean {
  if (pago) return false;
  if (sessao.status === 'realizada') return true;
  return (sessao.status === 'faltou' || sessao.status === 'cancelada') && sessao.cobravel;
}

// SPEC_DEVIATION: a FIN-03 diz que o pagamento sem valor usa o preço do paciente. Por decisão do
// usuário (2026-10-26), o ajuste de preço da sessão, quando existe, vale antes do preço do
// paciente, no débito e no valor padrão do pagamento (no legado o ajuste não entrava em conta).
export const valorDaSessao = (
  precoSessao: number | null,
  precoPaciente: number | null,
): number | null => precoSessao ?? precoPaciente;

// FIN-03, FIN-04: valor informado; senão o valor da sessão; sem nenhum, PRICE_REQUIRED.
export function valorDoPagamento(
  informado: number | undefined,
  precoSessao: number | null,
  precoPaciente: number | null,
): number | 'PRICE_REQUIRED' {
  if (informado !== undefined) return informado;
  return valorDaSessao(precoSessao, precoPaciente) ?? 'PRICE_REQUIRED';
}

// FIN-05: um pagamento por sessão; o segundo exige confirmar_duplicidade e então corrige.
export function decidirPagamento(
  existe: boolean,
  confirmarDuplicidade: boolean | undefined,
): 'criar' | 'corrigir' | 'PAYMENT_DUPLICATE' {
  if (!existe) return 'criar';
  return confirmarDuplicidade === true ? 'corrigir' : 'PAYMENT_DUPLICATE';
}

// Sessão sem preço conta 0 (como no legado).
export const somarPendentes = (sessoes: readonly { valor: number | null }[]): number =>
  sessoes.reduce((total, s) => total + (s.valor ?? 0), 0);

// Sessão candidata: sem pagamento, com o valor já resolvido (valorDaSessao).
export interface SessaoCandidata extends SessaoPendente {
  paciente_id: string;
  cobravel: boolean;
}

const pendentes = (sessoes: readonly SessaoCandidata[]): SessaoPendente[] =>
  sessoes
    .filter((s) => emDebito(s, false))
    .map(({ sessao_id, inicio, status, valor }) => ({ sessao_id, inicio, status, valor }));

// FIN-07: um item por paciente (na ordem recebida), filtrado pela situação, e o total da lista.
export function agruparDebitos(
  pacientes: readonly { id: string; nome: string }[],
  candidatas: readonly SessaoCandidata[],
  filtro: SituacaoDebito | undefined,
): ListaDebitos {
  const porPaciente = new Map<string, SessaoCandidata[]>();
  for (const s of candidatas)
    porPaciente.set(s.paciente_id, [...(porPaciente.get(s.paciente_id) ?? []), s]);
  const items = pacientes
    .map((p): ItemDebito => {
      const lista = pendentes(porPaciente.get(p.id) ?? []);
      return {
        paciente_id: p.id,
        nome: p.nome,
        status: lista.length > 0 ? 'em_debito' : 'em_dia',
        sessoes_pendentes: lista.length,
        valor_pendente: somarPendentes(lista),
      };
    })
    .filter((i) => filtro === undefined || i.status === filtro);
  return { items, total_pendente: items.reduce((t, i) => t + i.valor_pendente, 0) };
}

// Sessões pendentes de um paciente (GET /api/debitos/:pacienteId), como o pending do legado.
export function pendenciasDoPaciente(
  paciente: { id: string; nome: string },
  candidatas: readonly SessaoCandidata[],
): PendenciasPaciente {
  const sessoes = pendentes(candidatas.filter((s) => s.paciente_id === paciente.id));
  return {
    paciente_id: paciente.id,
    nome: paciente.nome,
    sessoes,
    total_sessoes: sessoes.length,
    valor_pendente: somarPendentes(sessoes),
  };
}
