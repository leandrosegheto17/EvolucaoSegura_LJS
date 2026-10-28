import type { MigrationBuilder } from 'node-pg-migrate';

// 0024_roles_padronizadas (padrão Neon, 2026-10-28). As roles passam a ter o nome do projeto:
// owner -> evolucao_owner, app -> evolucao_app, backup_ro -> evolucao_backup_ro. A 0001 a 0023 já
// usam os nomes novos, então um banco novo nasce com eles e esta migration só confere. Num banco
// que aplicou as migrations com os nomes antigos, ela renomeia (ALTER ROLE ... RENAME TO mantém
// OID, privilégios, policies e donos; senha SCRAM continua valendo). Se o nome antigo e o novo
// existirem juntos (roles são do cluster: outro banco do mesmo servidor), não mexe em nada.
//
// Depois confere que as três existem e que nenhuma tem SUPERUSER nem BYPASSRLS: com qualquer um
// dos dois o RLS deixaria de valer para a role, e a migration falha em vez de seguir.

export const RENOMEACOES: readonly (readonly [string, string])[] = [
  ['owner', 'evolucao_owner'],
  ['app', 'evolucao_app'],
  ['backup_ro', 'evolucao_backup_ro'],
];

const NOME_VALIDO = /^[a-z_][a-z0-9_]*$/;

function literal(nome: string): string {
  if (!NOME_VALIDO.test(nome)) throw new Error(`Nome de role inválido: ${nome}`);
  return `'${nome}'`;
}

export function sqlRenomearRoles(pares: readonly (readonly [string, string])[]): string {
  const matriz = pares.map(([antiga, nova]) => `ARRAY[${literal(antiga)}, ${literal(nova)}]`);
  return `
DO $$
DECLARE
  par text[];
BEGIN
  FOREACH par SLICE 1 IN ARRAY ARRAY[${matriz.join(', ')}] LOOP
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = par[1])
       AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname = par[2]) THEN
      EXECUTE format('ALTER ROLE %I RENAME TO %I', par[1], par[2]);
    END IF;
  END LOOP;
END $$;
`;
}

export function sqlExigirRolesSemBypass(roles: readonly string[]): string {
  const lista = `ARRAY[${roles.map(literal).join(', ')}]::text[]`;
  return `
DO $$
DECLARE
  achadas integer;
  perigosa text;
BEGIN
  SELECT count(*) INTO achadas FROM pg_roles WHERE rolname = ANY (${lista});
  IF achadas <> ${roles.length} THEN
    RAISE EXCEPTION 'roles padronizadas ausentes: esperadas %, achadas %', ${lista}, achadas;
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO perigosa
  FROM pg_roles WHERE rolname = ANY (${lista}) AND (rolsuper OR rolbypassrls);
  IF perigosa IS NOT NULL THEN
    RAISE EXCEPTION 'role com SUPERUSER ou BYPASSRLS (o RLS deixaria de valer): %', perigosa;
  END IF;
END $$;
`;
}

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(sqlRenomearRoles(RENOMEACOES));
  pgm.sql(sqlExigirRolesSemBypass(RENOMEACOES.map(([, nova]) => nova)));
};

// Não desfaz: voltar aos nomes antigos deixaria o banco diferente do que a 0001 cria.
export const down = (): void => {};
