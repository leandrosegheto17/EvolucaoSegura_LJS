import type { MigrationBuilder } from 'node-pg-migrate';

// 0025_backup_leitura (T200; OPS-01, OPS-02). O pg_dump pela evolucao_backup_ro falhava porque
// ela não lia tudo o que o dump lê:
// - a tabela pgmigrations (do node-pg-migrate, criada por quem roda a migration, fora da 0001);
// - as sequences (as das colunas IDENTITY e a pgmigrations_id_seq): os privilégios padrão da 0001
//   cobrem só TABLES.
// Esta migration concede SELECT (só SELECT: sem USAGE nem UPDATE, então a role não avança
// sequence) e o privilégio padrão para as sequences futuras, do owner e de quem roda a migration,
// como a 0001 faz para as tabelas. A terceira causa (o pg_dump sem --enable-row-security) fica no
// backup.yml e no deploy.yml.
//
// No Neon quem migra (neondb_owner) não é superusuário e o vínculo com evolucao_owner vem sem
// INHERIT (só SET, pela 0001): ele não tem privilégio nenhum nas sequences do owner. Por isso a
// concessão é por sequence, como o dono dela, e no fim uma conferência falha a migration se alguma
// sequence ou a pgmigrations continuar sem SELECT, em vez de deixar o backup quebrar só na hora
// do dump.
// evolucao_owner continua NOLOGIN: nada aqui mexe em atributo de role.

export const ROLE_BACKUP = 'evolucao_backup_ro';

// Schemas que o pg_dump não leva (do sistema). Todo o resto entra na conferência.
const SCHEMAS_DO_SISTEMA = `('pg_catalog', 'information_schema', 'pg_toast')`;

function exigirNome(role: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Nome de role inválido: ${role}`);
}

// Concede (ou revoga, no down) SELECT em cada sequence fora dos schemas do sistema. Quem migra concede direto o que é
// dele (ou o que herda; superusuário herda tudo); o que é de outra role em que ele pode SET ROLE
// (o evolucao_owner, pela 0001) é concedido assumindo essa role. GRANT ON ALL SEQUENCES não serve:
// falha inteiro na primeira sequence sobre a qual a role não tem privilégio nenhum.
export function sqlConcederSequences(role: string, acao: 'GRANT' | 'REVOKE' = 'GRANT'): string {
  exigirNome(role);
  const comando =
    acao === 'GRANT'
      ? `format('GRANT SELECT ON SEQUENCE %I.%I TO %I', seq.esquema, seq.nome, '${role}')`
      : `format('REVOKE SELECT ON SEQUENCE %I.%I FROM %I', seq.esquema, seq.nome, '${role}')`;
  return `
DO $$
DECLARE
  seq record;
BEGIN
  FOR seq IN
    SELECT n.nspname AS esquema, c.relname AS nome, pg_get_userbyid(c.relowner) AS dono
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S' AND n.nspname NOT IN ${SCHEMAS_DO_SISTEMA}
      AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
  LOOP
    IF pg_has_role(current_user, seq.dono, 'USAGE') THEN
      EXECUTE ${comando};
    ELSIF pg_has_role(current_user, seq.dono, 'SET') THEN
      EXECUTE format('SET LOCAL ROLE %I', seq.dono);
      EXECUTE ${comando};
      RESET ROLE;
    END IF;
    -- Sem nenhum dos dois, a sequence fica sem SELECT e a conferência abaixo falha.
  END LOOP;
END $$;
`;
}

export function sqlConferirLeituraDoBackup(role: string): string {
  exigirNome(role);
  return `
DO $$
DECLARE
  faltando text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ' ORDER BY n.nspname, c.relname)
    INTO faltando
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname NOT IN ${SCHEMAS_DO_SISTEMA}
    AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
    AND (
      (c.relkind = 'S' AND NOT has_sequence_privilege('${role}', c.oid, 'SELECT'))
      OR (c.oid = to_regclass('public.pgmigrations')
          AND NOT has_table_privilege('${role}', c.oid, 'SELECT'))
    );
  IF faltando IS NOT NULL THEN
    RAISE EXCEPTION 'o backup (%) não lê: %', '${role}', faltando;
  END IF;
END $$;
`;
}

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
GRANT SELECT ON public.pgmigrations TO ${ROLE_BACKUP};
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${ROLE_BACKUP};
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${ROLE_BACKUP};
`);
  pgm.sql(sqlConcederSequences(ROLE_BACKUP));
  pgm.sql(sqlConferirLeituraDoBackup(ROLE_BACKUP));
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
ALTER DEFAULT PRIVILEGES FOR ROLE "evolucao_owner" IN SCHEMA public REVOKE SELECT ON SEQUENCES FROM ${ROLE_BACKUP};
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON SEQUENCES FROM ${ROLE_BACKUP};
REVOKE SELECT ON public.pgmigrations FROM ${ROLE_BACKUP};
`);
  pgm.sql(sqlConcederSequences(ROLE_BACKUP, 'REVOKE'));
};
