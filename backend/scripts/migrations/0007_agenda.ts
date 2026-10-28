import type { MigrationBuilder } from 'node-pg-migrate';

// 0007_agenda (T74; AGE-01, AGE-10, AGE-13, AGE-17, ISO-01, ISO-02, ISO-03, ISO-04). Agenda,
// adaptada da migration 0008 do legado.
// - serie_recorrencia: série semanal ou quinzenal de 2 a 52 ocorrências (AGE-13; o legado só
//   pedia > 0). Cancelar a série é marcar `cancelada`, nunca apagar (AGE-16).
// - sessao_atendimento: [inicio, fim) com fim > inicio, link opcional até 500 começando com
//   http:// ou https:// (AGE-01), status da matriz do AGE-07 (nasce agendada) e `cobravel` com
//   padrão FALSO (AGE-10; no legado era verdadeiro). Conflito de horário é aviso confirmável
//   (AGE-04, AGE-05), não restrição: só um índice de apoio, sem EXCLUDE.
// - Nada é apagado (AGE-17): a app não tem DELETE nem TRUNCATE; cancelar e remarcar são status.
// - row_version e atualizado_em nas duas, subidos pela API a cada alteração (design).
// - FKs compostas com usuario_id: sessão e série só de paciente do mesmo profissional, e sessão
//   só de série do mesmo profissional (ISO-02).
// Sem a tabela sessao_revisao do legado: o design da agenda não a lista e a spec não pede o
// histórico; a auditoria (sessao.*) registra o que mudou.
// RLS forçada nas duas: a app só lê e escreve o que é do usuário da transação; evolucao_backup_ro lê tudo.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.serie_recorrencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  frequencia text NOT NULL CHECK (frequencia IN ('semanal', 'quinzenal')),
  ocorrencias integer NOT NULL CHECK (ocorrencias BETWEEN 2 AND 52),
  cancelada boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT serie_recorrencia_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id)
);
ALTER TABLE public.serie_recorrencia OWNER TO "evolucao_owner";

CREATE TABLE public.sessao_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  serie_id uuid,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  link text CHECK (char_length(link) <= 500 AND link ~* '^https?://[^[:space:]]+$'),
  status text NOT NULL DEFAULT 'agendada'
    CHECK (status IN ('agendada', 'realizada', 'faltou', 'cancelada', 'remarcada')),
  cobravel boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessao_atendimento_fim_depois_do_inicio CHECK (fim > inicio),
  CONSTRAINT sessao_atendimento_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id),
  FOREIGN KEY (serie_id, usuario_id) REFERENCES public.serie_recorrencia (id, usuario_id)
);
ALTER TABLE public.sessao_atendimento OWNER TO "evolucao_owner";
-- Listagem por intervalo com cursor keyset (inicio, id) (AGE-03).
CREATE INDEX sessao_atendimento_usuario_inicio_idx
  ON public.sessao_atendimento (usuario_id, inicio, id);
-- Conflito: sessões que ainda ocupam o horário (AGE-04).
CREATE INDEX sessao_atendimento_conflito_idx ON public.sessao_atendimento (usuario_id, inicio, fim)
  WHERE status IN ('agendada', 'realizada', 'faltou');
CREATE INDEX sessao_atendimento_paciente_idx ON public.sessao_atendimento (paciente_id, inicio);
CREATE INDEX sessao_atendimento_serie_idx ON public.sessao_atendimento (serie_id)
  WHERE serie_id IS NOT NULL;

ALTER TABLE public.serie_recorrencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.serie_recorrencia FORCE ROW LEVEL SECURITY;
CREATE POLICY serie_recorrencia_usuario ON public.serie_recorrencia
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY serie_recorrencia_backup_ro ON public.serie_recorrencia FOR SELECT
  TO evolucao_backup_ro USING (true);

ALTER TABLE public.sessao_atendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessao_atendimento FORCE ROW LEVEL SECURITY;
CREATE POLICY sessao_atendimento_usuario ON public.sessao_atendimento
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY sessao_atendimento_backup_ro ON public.sessao_atendimento FOR SELECT
  TO evolucao_backup_ro USING (true);

REVOKE ALL ON public.serie_recorrencia, public.sessao_atendimento FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.serie_recorrencia, public.sessao_atendimento TO evolucao_backup_ro;
GRANT SELECT ON public.serie_recorrencia, public.sessao_atendimento TO evolucao_app;
GRANT INSERT (usuario_id, paciente_id, frequencia, ocorrencias) ON public.serie_recorrencia TO evolucao_app;
GRANT UPDATE (cancelada, row_version, atualizado_em) ON public.serie_recorrencia TO evolucao_app;
GRANT INSERT (usuario_id, paciente_id, serie_id, inicio, fim, link, cobravel)
  ON public.sessao_atendimento TO evolucao_app;
GRANT UPDATE (paciente_id, inicio, fim, link, status, cobravel, row_version, atualizado_em)
  ON public.sessao_atendimento TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS public.sessao_atendimento, public.serie_recorrencia;`);
};
