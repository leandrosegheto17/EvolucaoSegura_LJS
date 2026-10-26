// RAS-03: modelos de texto, adaptados de clinical/templates/templates.domain.ts do legado, só do
// tipo `evolucao` (os de `relatorio` saíram com D-01). Os limites de nome e corpo ficam no
// contrato; aqui fica a unicidade do nome, que o banco também garante (modelo_texto_nome_uq).

export const TIPOS_MODELO_TEXTO = ['evolucao'] as const;
export type TipoModeloTexto = (typeof TIPOS_MODELO_TEXTO)[number];

export interface ModeloTextoExistente {
  id: string;
  nome: string;
  arquivado: boolean;
}

const chave = (nome: string): string => nome.trim().toLowerCase();

// O nome (aparado, sem diferenciar maiúsculas) já é de outro modelo não arquivado.
export function nomeEmUso(
  nome: string,
  existentes: readonly ModeloTextoExistente[],
  ignorarId?: string,
): boolean {
  return existentes.some(
    (m) => !m.arquivado && m.id !== ignorarId && chave(m.nome) === chave(nome),
  );
}
