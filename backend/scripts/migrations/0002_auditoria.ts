import type { MigrationBuilder } from 'node-pg-migrate';

// 0002_auditoria (T30; AUD-01, ISO-01, ISO-03, ISO-04). Adaptada das migrations 0002, 0004 e
// 0033 do legado. audit_log é só de inclusão: um trigger barra UPDATE, DELETE e TRUNCATE para
// qualquer role, inclusive owner e superusuário (SQLSTATE ES001). Nunca guarda conteúdo
// clínico: só ator, ação, alvo, nomes de campo, IP truncado e user-agent resumido.
// Ator: uuid do profissional, 'sistema' (cron e webhook) ou 'admin-cli' (scripts de operação).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE FUNCTION public.negar_alteracao() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é só de inclusão (% proibido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'ES001';
END $$;
ALTER FUNCTION public.negar_alteracao() OWNER TO "owner";

CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL,
  ator text NOT NULL CHECK (ator ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|sistema|admin-cli)$'),
  acao text NOT NULL CHECK (acao ~ '^[a-z_]+\\.[a-z_]+$' AND length(acao) <= 64),
  alvo_tipo text NOT NULL CHECK (alvo_tipo ~ '^[a-z_]+$' AND length(alvo_tipo) <= 32),
  alvo_id uuid,
  campos_alterados text[] NOT NULL DEFAULT '{}' CHECK (cardinality(campos_alterados) <= 50),
  origem_ip text CHECK (origem_ip IS NULL OR length(origem_ip) <= 45),
  origem_ua text CHECK (origem_ua IS NULL OR length(origem_ua) <= 80),
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log OWNER TO "owner";
CREATE INDEX audit_log_usuario_criado_idx ON public.audit_log (usuario_id, criado_em DESC);
CREATE INDEX audit_log_alvo_idx ON public.audit_log (usuario_id, alvo_tipo, alvo_id);

CREATE TRIGGER audit_log_so_inclusao BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.negar_alteracao();
CREATE TRIGGER audit_log_sem_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.negar_alteracao();

-- RLS forçada (vale também para owner): sem app.usuario_id, nenhuma linha.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_usuario ON public.audit_log
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
-- backup_ro (NOBYPASSRLS) lê todas as linhas para o pg_dump; não tem escrita.
CREATE POLICY audit_log_backup_ro ON public.audit_log FOR SELECT TO backup_ro USING (true);

REVOKE ALL ON public.audit_log FROM PUBLIC, app;
GRANT SELECT, INSERT ON public.audit_log TO app;
GRANT SELECT ON public.audit_log TO backup_ro;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP TABLE IF EXISTS public.audit_log;
DROP FUNCTION IF EXISTS public.negar_alteracao();
`);
};
