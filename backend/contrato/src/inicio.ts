import type { StatusSessao } from './agenda.ts';

// INI-01, INI-02, INI-03: resposta de GET /api/inicio, no formato do legado (home/summary).
// Só estados e contagens, nunca texto clínico.

export type EstadoEvolucaoInicio =
  'sem_registro' | 'editavel_hoje_sem_texto' | 'editavel_hoje' | 'registrada';
export type EstadoPagamentoInicio = 'nao_cobravel' | 'pendente' | 'pago';

export interface SessaoDeHoje {
  id: string;
  inicio: string;
  fim: string;
  status: StatusSessao;
  paciente: { id: string; nome: string };
  evolucao: EstadoEvolucaoInicio;
  pagamento: EstadoPagamentoInicio;
}

export interface ResumoInicio {
  // Segunda até o último dia habilitado (YYYY-MM-DD, America/Sao_Paulo).
  semana: {
    inicio: string;
    fim: string;
    total: number;
    realizadas: number;
    pendentes_evolucao: number;
    pendentes_pagamento: number;
  };
  // No máximo 6, sem canceladas nem remarcadas, em ordem de início.
  hoje: SessaoDeHoje[];
  hoje_total: number;
  alerta: { editavel_hoje_sem_texto: number };
}
