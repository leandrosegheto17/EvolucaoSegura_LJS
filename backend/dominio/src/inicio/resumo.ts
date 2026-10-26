import { emDebito } from '../financeiro/debitos.ts';

// INI-01, INI-02, INI-03: regras puras do resumo do Início, copiadas de
// backend/src/home/domain/summary.ts do legado (legado:summary.ts:115-124). Só estados, nunca
// texto clínico. "Hoje" vem do relógio do banco em America/Sao_Paulo (a API passa a data).

export type EstadoEvolucao =
  'sem_registro' | 'editavel_hoje_sem_texto' | 'editavel_hoje' | 'registrada';
export type EstadoPagamento = 'nao_cobravel' | 'pendente' | 'pago';

// INI-02: a lista de hoje mostra no máximo 6 sessões.
export const LIMITE_HOJE = 6;

// Estado de evolução de uma sessão de hoje. Sem evolução ligada: sessão realizada (janela do dia
// ainda aberta) = 'editavel_hoje_sem_texto' (alerta); demais = 'sem_registro'. Com evolução:
// criada hoje = 'editavel_hoje'; antes = 'registrada'.
export function estadoEvolucao(
  status: string,
  temEvolucao: boolean,
  evolucaoDeHoje: boolean,
): EstadoEvolucao {
  if (!temEvolucao) return status === 'realizada' ? 'editavel_hoje_sem_texto' : 'sem_registro';
  return evolucaoDeHoje ? 'editavel_hoje' : 'registrada';
}

// A mesma regra do débito (FIN-06): pago, pendente ou não cobrável.
export function estadoPagamento(status: string, cobravel: boolean, pago: boolean): EstadoPagamento {
  if (pago) return 'pago';
  return emDebito({ status, cobravel }, false) ? 'pendente' : 'nao_cobravel';
}

// Último dia ISO (1 = segunda ... 7 = domingo) da semana de atendimento: segunda a sexta, mais
// sábado e domingo habilitados no perfil.
export function ultimoDiaHabilitado(dias: { sabado: boolean; domingo: boolean }): 5 | 6 | 7 {
  return dias.domingo ? 7 : dias.sabado ? 6 : 5;
}

const somarDias = (data: Date, dias: number): Date => new Date(data.getTime() + dias * 86_400_000);
const formatar = (data: Date): string => data.toISOString().slice(0, 10);

// INI-01: a semana de `hoje` (YYYY-MM-DD) vai da segunda até o último dia habilitado.
export function semanaDeAtendimento(
  hoje: string,
  dias: { sabado: boolean; domingo: boolean },
): { inicio: string; fim: string } {
  const data = new Date(`${hoje}T00:00:00Z`);
  const diaIso = data.getUTCDay() === 0 ? 7 : data.getUTCDay();
  const segunda = somarDias(data, 1 - diaIso);
  return {
    inicio: formatar(segunda),
    fim: formatar(somarDias(segunda, ultimoDiaHabilitado(dias) - 1)),
  };
}
