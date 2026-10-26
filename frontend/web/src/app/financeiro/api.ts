import type {
  ListaDebitos,
  Pagamento,
  PagamentoEntrada,
  PendenciasPaciente,
  PrecoEntrada,
  PrecoPaciente,
  PrecoSessao,
  SituacaoDebito,
} from '@es/contrato/financeiro';
import { api } from '../../lib/api.ts';

// FIN-07: chamadas da tela de financeiro, portadas de billing/debts/debtsApi.ts do legado, para
// /api/debitos. Valores em centavos inteiros (ADR-007); a tela formata em reais.

export type FiltroDebitos = 'todos' | SituacaoDebito;

const comSinal = (sinal?: AbortSignal) => (sinal !== undefined ? { sinal } : {});

/** GET /api/debitos: `status` ausente = todos. */
export const listarDebitos = (filtro: FiltroDebitos, sinal?: AbortSignal) =>
  api.requisitar<ListaDebitos>(
    filtro === 'todos' ? '/debitos' : `/debitos?status=${filtro}`,
    comSinal(sinal),
  );

/** GET /api/debitos/:pacienteId: sessões pendentes do paciente. */
export const lerPendencias = (pacienteId: string, sinal?: AbortSignal) =>
  api.requisitar<PendenciasPaciente>(`/debitos/${encodeURIComponent(pacienteId)}`, comSinal(sinal));

// FIN-09: preço do paciente ou da sessão e pagamento da sessão.
export type EscopoPreco = 'paciente' | 'sessao';
export type PrecoLido = PrecoPaciente | PrecoSessao;

const caminhoPreco = (escopo: EscopoPreco, id: string) =>
  `/${escopo === 'paciente' ? 'pacientes' : 'sessoes'}/${encodeURIComponent(id)}/preco`;

/** GET do preço; 404 = ainda sem preço (a tela cria sem row_version). */
export const lerPreco = (escopo: EscopoPreco, id: string, sinal?: AbortSignal) =>
  api.requisitar<PrecoLido>(caminhoPreco(escopo, id), comSinal(sinal));

/** PUT do preço: sem `row_version` cria; com ele edita (409 `versao_divergente` se mudou). */
export const salvarPreco = (escopo: EscopoPreco, id: string, corpo: PrecoEntrada) =>
  api.requisitar<PrecoLido>(caminhoPreco(escopo, id), { metodo: 'PUT', corpo });

/** PUT /api/sessoes/:id/pagamento (201 cria, 200 corrige). */
export const registrarPagamento = (sessaoId: string, corpo: PagamentoEntrada) =>
  api.requisitar<Pagamento>(`/sessoes/${encodeURIComponent(sessaoId)}/pagamento`, {
    metodo: 'PUT',
    corpo,
  });
