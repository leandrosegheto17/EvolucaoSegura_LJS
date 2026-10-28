import type { MigrationBuilder } from 'node-pg-migrate';

// 0001_base (T29; ISO-03, ISO-04). Base adaptada das migrations 0001 e 0002 do legado.
// - owner: dono do schema e das tabelas; único que faz DDL.
// - app: role do Worker; DML mínimo por tabela, concedido na migration de cada tabela; nunca
//   DELETE nem TRUNCATE por padrão; sem BYPASSRLS.
// - evolucao_backup_ro: só SELECT, para o pg_dump.
// As roles nascem NOLOGIN e sem senha. Senha e LOGIN são definidos fora do repositório, no
// provisionamento do banco (segredo nunca entra em migration). Roles são do cluster: se já
// existirem (outro banco do mesmo cluster ou criadas no provisionamento), ficam como estão.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DO $$
DECLARE
  definicao text[];
BEGIN
  FOREACH definicao SLICE 1 IN ARRAY ARRAY[
    ARRAY['evolucao_owner', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
    ARRAY['evolucao_app', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'],
    ARRAY['evolucao_backup_ro', 'NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS']
  ] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = definicao[1]) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I %s', definicao[1], definicao[2]);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL; -- outra migration criou a role ao mesmo tempo, em outro banco do cluster
      END;
    END IF;
  END LOOP;
END $$;

-- Quem roda a migration precisa poder assumir owner (ALTER DEFAULT PRIVILEGES FOR ROLE e
-- ALTER ... OWNER TO). No Neon o usuário da migration não é superusuário e, a partir do PG 16, o vínculo
-- que CREATE ROLE cria vem sem SET. Superusuário e o próprio owner já atendem: vira no-op.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'evolucao_owner', 'SET') THEN
    EXECUTE format('GRANT "evolucao_owner" TO %I WITH SET TRUE', current_user);
  END IF;
END $$;

-- Nada por padrão para PUBLIC.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO "evolucao_owner", evolucao_app, evolucao_backup_ro', current_database());
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO evolucao_app, evolucao_backup_ro;
GRANT USAGE, CREATE ON SCHEMA public TO "evolucao_owner";

-- Padrões para tabelas futuras, criadas pelo owner ou por quem roda a migration: nada para
-- PUBLIC nem para app (o GRANT de DML é por tabela) e SELECT para evolucao_backup_ro.
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, evolucao_app;
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" IN SCHEMA public GRANT SELECT ON TABLES TO evolucao_backup_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, evolucao_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO evolucao_backup_ro;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Schema das funções SECURITY DEFINER das tarefas (cron, webhook). app só executa as que cada
-- migration liberar explicitamente; ninguém além do owner cria objetos nele.
CREATE SCHEMA tarefas AUTHORIZATION "evolucao_owner";
REVOKE ALL ON SCHEMA tarefas FROM PUBLIC;
GRANT USAGE ON SCHEMA tarefas TO evolucao_app;

-- Usuário da requisição, definido pela API com set_config('app.usuario_id', $1, true) dentro da
-- transação. Fora dela o valor sobra como '' (spike set-local-hyperdrive): vazio = ausente.
CREATE FUNCTION public.app_usuario_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.usuario_id', true), '')::uuid $$;
ALTER FUNCTION public.app_usuario_id() OWNER TO "evolucao_owner";
REVOKE ALL ON FUNCTION public.app_usuario_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_usuario_id() TO evolucao_app, evolucao_backup_ro;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS public.app_usuario_id();
DROP SCHEMA IF EXISTS tarefas;
DROP EXTENSION IF EXISTS pgcrypto;
ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM evolucao_backup_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" IN SCHEMA public REVOKE SELECT ON TABLES FROM evolucao_backup_ro;
REVOKE ALL ON SCHEMA public FROM evolucao_app, evolucao_backup_ro, "evolucao_owner";
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM "evolucao_owner", evolucao_app, evolucao_backup_ro', current_database());
  EXECUTE format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO PUBLIC', current_database());
END $$;
-- As roles são do cluster e podem servir a outros bancos: o down não as apaga.
`);
};
