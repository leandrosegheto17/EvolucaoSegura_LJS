import { z } from 'zod';

// PERF-08: contrato de GET e PUT /api/configuracoes, adaptado de settings.domain.ts do legado.
// Só privacidade_agenda: false (padrão) = a agenda mostra o nome completo; true = só as iniciais
// (PrivacyName e SettingsPage do legado). Sem inatividade (fixa em 15 min, AUTH-09) e sem IA.
// A ativação de push por dispositivo do PERF-08 fica na etapa de push. Corpo estrito: chave
// desconhecida, inclusive inatividade_min e ia_habilitada do legado, responde 422.

export const esquemaConfiguracoesEntrada = z.strictObject({
  privacidade_agenda: z.boolean(),
});
export type ConfiguracoesEntrada = z.output<typeof esquemaConfiguracoesEntrada>;

export interface Configuracoes {
  privacidade_agenda: boolean;
}

// Sem linha gravada, o GET devolve o padrão (como no legado).
export const CONFIGURACOES_PADRAO: Configuracoes = { privacidade_agenda: false };
