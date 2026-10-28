import type { MigrationBuilder } from 'node-pg-migrate';

// 0005_perfil (T61; PERF-02, PERF-03, PERF-08, ISO-01, ISO-03, ISO-04). Perfil e configurações,
// adaptados das migrations 0005, 0014, 0026 e 0027 do legado.
// - perfil: uma linha por profissional, com UMA especialidade nas próprias colunas (o legado tinha
//   a tabela perfil_especialidade, de 1 a N). Especialidade nula = perfil incompleto (PERF-01).
//   "outra" exige nome de 1 a 60; nos demais tipos o nome fica nulo. Registro profissional é
//   opcional e só existe com especialidade. Texto vazio não é gravado: a API converte em null.
//   Fim de semana nasce desligado (fail-closed, como no legado).
// - configuracao_usuario: só privacidade_agenda (padrão falso = agenda com o nome completo, como
//   no legado). Sem inatividade (fixa em 15 min, AUTH-09) e sem IA (fora do escopo).
// - row_version sobe a cada alteração feita pela API (design: tabelas editáveis têm row_version).
// Sem tabela de revisão: o histórico do perfil do legado não está na spec.
// A app lê, cria e altera só a própria linha (RLS forçada) e nunca troca o dono, apaga ou trunca.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL UNIQUE REFERENCES public.usuario (id),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 200),
  contato text CHECK (btrim(contato) <> '' AND char_length(contato) <= 200),
  endereco text CHECK (btrim(endereco) <> '' AND char_length(endereco) <= 300),
  atende_sabado boolean NOT NULL DEFAULT false,
  atende_domingo boolean NOT NULL DEFAULT false,
  especialidade text CHECK (especialidade IN ('psicologia', 'nutricao', 'fisioterapia', 'outra')),
  especialidade_nome text,
  conselho text CHECK (btrim(conselho) <> '' AND char_length(conselho) <= 40),
  numero_registro text CHECK (btrim(numero_registro) <> '' AND char_length(numero_registro) <= 40),
  regiao text CHECK (btrim(regiao) <> '' AND char_length(regiao) <= 100),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT perfil_especialidade_nome CHECK (
    (especialidade IS NOT DISTINCT FROM 'outra' AND especialidade_nome IS NOT NULL
      AND char_length(btrim(especialidade_nome)) BETWEEN 1 AND 60
      AND char_length(especialidade_nome) <= 60)
    OR (especialidade IS DISTINCT FROM 'outra' AND especialidade_nome IS NULL)),
  CONSTRAINT perfil_registro_com_especialidade CHECK (
    especialidade IS NOT NULL OR (conselho IS NULL AND numero_registro IS NULL AND regiao IS NULL))
);
ALTER TABLE public.perfil OWNER TO "evolucao_owner";

CREATE TABLE public.configuracao_usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL UNIQUE REFERENCES public.usuario (id),
  privacidade_agenda boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.configuracao_usuario OWNER TO "evolucao_owner";

ALTER TABLE public.perfil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfil FORCE ROW LEVEL SECURITY;
CREATE POLICY perfil_usuario ON public.perfil
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY perfil_backup_ro ON public.perfil FOR SELECT TO evolucao_backup_ro USING (true);

ALTER TABLE public.configuracao_usuario ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracao_usuario FORCE ROW LEVEL SECURITY;
CREATE POLICY configuracao_usuario_usuario ON public.configuracao_usuario
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY configuracao_usuario_backup_ro ON public.configuracao_usuario FOR SELECT
  TO evolucao_backup_ro USING (true);

REVOKE ALL ON public.perfil, public.configuracao_usuario FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.perfil, public.configuracao_usuario TO evolucao_backup_ro;
GRANT SELECT ON public.perfil, public.configuracao_usuario TO evolucao_app;
GRANT INSERT (usuario_id, nome, contato, endereco, atende_sabado, atende_domingo, especialidade,
  especialidade_nome, conselho, numero_registro, regiao) ON public.perfil TO evolucao_app;
GRANT UPDATE (nome, contato, endereco, atende_sabado, atende_domingo, especialidade,
  especialidade_nome, conselho, numero_registro, regiao, row_version, atualizado_em)
  ON public.perfil TO evolucao_app;
GRANT INSERT (usuario_id, privacidade_agenda) ON public.configuracao_usuario TO evolucao_app;
GRANT UPDATE (privacidade_agenda, row_version, atualizado_em) ON public.configuracao_usuario
  TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS public.configuracao_usuario, public.perfil;`);
};
