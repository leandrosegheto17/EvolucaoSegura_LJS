import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  RENOMEACOES,
  sqlExigirRolesSemBypass,
  sqlRenomearRoles,
} from '../migrations/0024_roles_padronizadas.ts';
import { type BancoDeTeste, comoRole, criarBancoMigrado } from './banco.ts';

// Padrão Neon (2026-10-28): roles evolucao_owner, evolucao_app e evolucao_backup_ro. Um banco novo
// já nasce com elas (0001); a 0024 renomeia as antigas num banco existente e falha se alguma tiver
// SUPERUSER ou BYPASSRLS. Os casos de renomear e de role perigosa usam roles descartáveis com nome
// próprio do teste, porque as roles reais são do cluster e servem aos outros testes.

let banco: BancoDeTeste;
const criadas: string[] = [];
const sufixo = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const nome = (base: string): string => `es_t24_${base}_${sufixo}`;

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

async function criarRole(role: string, atributos = 'NOLOGIN'): Promise<void> {
  await banco.cliente.query(`create role "${role}" ${atributos}`);
  criadas.push(role);
}

async function existe(role: string): Promise<boolean> {
  const linhas = await consultar('select 1 from pg_roles where rolname = $1', [role]);
  return linhas.length === 1;
}

beforeAll(async () => {
  banco = await criarBancoMigrado('m0024');
}, 60_000);

afterAll(async () => {
  for (const role of criadas) await banco.cliente.query(`drop role if exists "${role}"`);
  await banco?.apagar();
});

describe('migration 0024: roles padronizadas', () => {
  it('as três roles têm o nome do projeto e as antigas não são criadas', async () => {
    expect(RENOMEACOES).toEqual([
      ['owner', 'evolucao_owner'],
      ['app', 'evolucao_app'],
      ['backup_ro', 'evolucao_backup_ro'],
    ]);
    const roles = await consultar<{ rolname: string }>(
      `select rolname from pg_roles
       where rolname in ('evolucao_owner', 'evolucao_app', 'evolucao_backup_ro') order by 1`,
    );
    expect(roles.map((r) => r.rolname)).toEqual([
      'evolucao_app',
      'evolucao_backup_ro',
      'evolucao_owner',
    ]);
  });

  it('evolucao_app e evolucao_backup_ro são NOSUPERUSER e NOBYPASSRLS', async () => {
    const roles = await consultar<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolname, rolsuper, rolbypassrls from pg_roles
       where rolname in ('evolucao_app', 'evolucao_backup_ro') order by 1`,
    );
    expect(roles).toEqual([
      { rolname: 'evolucao_app', rolsuper: false, rolbypassrls: false },
      { rolname: 'evolucao_backup_ro', rolsuper: false, rolbypassrls: false },
    ]);
  });

  // Prova pelo comportamento: tabela com RLS forçada e sem policy nenhuma, com SELECT concedido.
  // Sem BYPASSRLS a role não vê a linha que existe; com BYPASSRLS veria. (A evolucao_backup_ro lê
  // tudo nas tabelas reais por policies próprias, não por BYPASSRLS.)
  it.each(['evolucao_app', 'evolucao_backup_ro'])(
    '%s não atravessa o RLS: numa tabela sem policy para ela, não vê a linha que existe',
    async (role) => {
      await comoRole(banco.cliente, null, async () => {
        await banco.cliente.query('create table public.prova_rls (id int primary key)');
        await banco.cliente.query('alter table public.prova_rls enable row level security');
        await banco.cliente.query('alter table public.prova_rls force row level security');
        await banco.cliente.query(`grant select on public.prova_rls to "${role}"`);
        await banco.cliente.query('insert into public.prova_rls values (1)');
        const total = async (): Promise<number> =>
          (await banco.cliente.query('select id from public.prova_rls')).rowCount ?? -1;
        await banco.cliente.query('alter table public.prova_rls no force row level security');
        expect(await total()).toBe(1);
        await banco.cliente.query(`set local role "${role}"`);
        expect(await total()).toBe(0);
      });
    },
  );

  it('renomeia a role antiga para a nova, mantendo os privilégios', async () => {
    const antiga = nome('antiga');
    const nova = nome('nova');
    await criarRole(antiga);
    criadas.push(nova);
    await banco.cliente.query(`grant select on public.usuario to "${antiga}"`);

    await banco.cliente.query(sqlRenomearRoles([[antiga, nova]]));

    expect(await existe(antiga)).toBe(false);
    expect(await existe(nova)).toBe(true);
    const [privilegio] = await consultar<{ pode: boolean }>(
      `select has_table_privilege($1, 'public.usuario', 'SELECT') as pode`,
      [nova],
    );
    expect(privilegio?.pode).toBe(true);
    await banco.cliente.query(`revoke select on public.usuario from "${nova}"`);
  });

  it('não mexe em nada quando a antiga e a nova existem juntas', async () => {
    const antiga = nome('dupla_antiga');
    const nova = nome('dupla_nova');
    await criarRole(antiga);
    await criarRole(nova);

    await banco.cliente.query(sqlRenomearRoles([[antiga, nova]]));

    expect(await existe(antiga)).toBe(true);
    expect(await existe(nova)).toBe(true);
  });

  it('não faz nada quando a antiga não existe', async () => {
    const nova = nome('so_nova');
    await criarRole(nova);

    await banco.cliente.query(sqlRenomearRoles([[nome('inexistente'), nova]]));

    expect(await existe(nova)).toBe(true);
  });

  it('a conferência passa com as roles reais (é o que a migration roda)', async () => {
    await expect(
      banco.cliente.query(sqlExigirRolesSemBypass(RENOMEACOES.map(([, nova]) => nova))),
    ).resolves.toBeDefined();
  });

  it.each([
    ['BYPASSRLS', 'NOLOGIN BYPASSRLS'],
    ['SUPERUSER', 'NOLOGIN SUPERUSER'],
  ])('a conferência falha se uma role tiver %s', async (rotulo, atributos) => {
    const perigosa = nome(`perigosa_${rotulo.toLowerCase()}`);
    await criarRole(perigosa, atributos);

    await expect(
      banco.cliente.query(sqlExigirRolesSemBypass(['evolucao_app', perigosa])),
    ).rejects.toThrow(/SUPERUSER ou BYPASSRLS/);
  });

  it('a conferência falha se uma role estiver ausente', async () => {
    await expect(
      banco.cliente.query(sqlExigirRolesSemBypass(['evolucao_app', nome('ausente')])),
    ).rejects.toThrow(/ausentes/);
  });

  it('recusa nome de role fora do padrão ao montar o SQL', () => {
    expect(() => sqlRenomearRoles([["x'; drop role postgres; --", 'y']])).toThrow(/inválido/);
    expect(() => sqlExigirRolesSemBypass(['Maiuscula'])).toThrow(/inválido/);
  });
});
