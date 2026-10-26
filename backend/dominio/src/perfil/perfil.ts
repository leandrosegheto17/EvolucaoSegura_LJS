import type { Especialidade, PerfilEntrada } from '@es/contrato/perfil';

// PERF-02, PERF-03, PERF-09: regras puras do salvamento do perfil, adaptadas de
// backend/src/profile/domain/profile.ts do legado. O perfil é guardado plano, uma coluna por
// campo; os nomes aqui são os nomes das colunas, que é o que a auditoria grava.

export const CAMPOS_PERFIL = [
  'nome',
  'contato',
  'endereco',
  'atende_sabado',
  'atende_domingo',
  'especialidade',
  'especialidade_nome',
  'conselho',
  'numero_registro',
  'regiao',
] as const;
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];

export interface DadosPerfil {
  nome: string;
  contato: string | null;
  endereco: string | null;
  atende_sabado: boolean;
  atende_domingo: boolean;
  especialidade: Especialidade | null;
  especialidade_nome: string | null;
  conselho: string | null;
  numero_registro: string | null;
  regiao: string | null;
}

const SEM_PERFIL: Omit<DadosPerfil, 'nome'> & { nome: string | null } = {
  nome: null,
  contato: null,
  endereco: null,
  atende_sabado: false,
  atende_domingo: false,
  especialidade: null,
  especialidade_nome: null,
  conselho: null,
  numero_registro: null,
  regiao: null,
};

// Textos substituem os atuais; fim de semana e especialidade ausentes preservam o valor atual
// (ou o padrão, falso e nula, quando ainda não há perfil).
export function resolverPerfil(atual: DadosPerfil | null, entrada: PerfilEntrada): DadosPerfil {
  const base = atual ?? SEM_PERFIL;
  const especialidade =
    entrada.especialidade === undefined
      ? {
          especialidade: base.especialidade,
          especialidade_nome: base.especialidade_nome,
          conselho: base.conselho,
          numero_registro: base.numero_registro,
          regiao: base.regiao,
        }
      : {
          especialidade: entrada.especialidade.tipo,
          especialidade_nome: entrada.especialidade.nome,
          conselho: entrada.especialidade.conselho,
          numero_registro: entrada.especialidade.numero_registro,
          regiao: entrada.especialidade.regiao,
        };
  return {
    nome: entrada.nome,
    contato: entrada.contato,
    endereco: entrada.endereco,
    atende_sabado: entrada.atende_sabado ?? base.atende_sabado,
    atende_domingo: entrada.atende_domingo ?? base.atende_domingo,
    ...especialidade,
  };
}

// Nomes dos campos que mudam de fato; sem perfil, compara com o padrão (vazio, falso, nula).
export function camposAlterados(antes: DadosPerfil | null, depois: DadosPerfil): CampoPerfil[] {
  const base = antes ?? SEM_PERFIL;
  return CAMPOS_PERFIL.filter((campo) => base[campo] !== depois[campo]);
}

// PERF-01: completo com nome e especialidade.
export const perfilCompleto = (perfil: Pick<DadosPerfil, 'nome' | 'especialidade'> | null) =>
  perfil !== null && perfil.nome !== '' && perfil.especialidade !== null;
