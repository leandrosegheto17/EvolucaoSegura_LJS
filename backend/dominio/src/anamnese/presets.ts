import type { Especialidade } from '@es/contrato/perfil';

// PERF-04: modelo padrão de anamnese de cada especialidade, copiado de
// clinical/model/presets.ts do legado. É dado em código: o nome do preset nunca é gravado.

export interface ItemPreset {
  readonly rotulo: string;
  readonly especial?: 'frequencia';
}

export interface Preset {
  readonly campos: readonly ItemPreset[];
  readonly alertas: readonly ItemPreset[];
}

// ANA-02: opções do campo especial "Frequência".
export const OPCOES_FREQUENCIA = ['semanal', 'quinzenal', 'mensal', 'outra'] as const;

const t = (rotulo: string): ItemPreset => ({ rotulo });

export const PRESETS: Readonly<Record<Especialidade, Preset>> = Object.freeze({
  psicologia: {
    campos: [
      t('Queixa principal'),
      t('Hipótese diagnóstica/CID'),
      t('Abordagem'),
      { rotulo: 'Frequência', especial: 'frequencia' },
      t('Medicações/psiquiatra'),
      t('Comorbidades'),
      t('Histórico de internações e crises'),
    ],
    alertas: [
      t('Risco de suicídio'),
      t('Automutilação'),
      t('Uso de substâncias'),
      t('Violência doméstica'),
    ],
  },
  // Conteúdo de nutrição e fisioterapia é proposta do legado, sem validação profissional.
  nutricao: {
    campos: [
      t('Queixa principal e expectativa/objetivo'),
      t('Histórico de saúde (comorbidades, cirurgias)'),
      t('Medicações e suplementos'),
      t('Antecedentes familiares'),
      t('Hábitos alimentares (refeições, horários, mastigação)'),
      t('Hábito intestinal e hidratação'),
      t('Sono'),
      t('Atividade física'),
      t('Histórico de dietas e adesão'),
      t('Alergias, intolerâncias e restrições'),
      t('Contexto socioeconômico e cultural da alimentação'),
    ],
    alertas: [
      t('Alergia alimentar grave'),
      t('Suspeita ou diagnóstico de transtorno alimentar'),
      t('Gestação ou lactação'),
      t('Diabetes com uso de insulina'),
    ],
  },
  fisioterapia: {
    campos: [
      t('Queixa principal'),
      t('História da doença atual (início, evolução, sintomas)'),
      t('Histórico pregresso (doenças, cirurgias, fraturas, alergias)'),
      t('Medicamentos em uso'),
      t('Exames complementares'),
      t('Hábitos e contexto (atividade física, sono, ocupação)'),
    ],
    alertas: [
      t('Uso de anticoagulante'),
      t('Uso de corticoide'),
      t('Histórico de quedas/risco de queda'),
      t('Cirurgia recente'),
      t('Implante eletrônico/marca-passo'),
      t('Gestação'),
    ],
  },
  // "Outra" nunca inventa conteúdo: só a queixa principal, nenhum alerta.
  outra: { campos: [t('Queixa principal')], alertas: [] },
});

export const presetDe = (especialidade: Especialidade): Preset => PRESETS[especialidade];
