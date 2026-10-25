import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, criarBancoMigrado } from './banco.ts';

// T36 / ISO-03 (ADR-005): as tarefas agendadas e o webhook só tocam o banco por funções do schema
// tarefas. Toda função de tarefas é SECURITY DEFINER com search_path fixo; toda SECURITY DEFINER
// (em qualquer schema do projeto) tem search_path fixo; e a role app só executa as funções desta
// lista explícita. Função nova liberada para a app entra aqui de propósito, na mesma tarefa.

const EXECUTAVEIS_PELA_APP = [
  'public.app_usuario_id()',
  // T40 / AUTH-12: hash e conferência de senha no Postgres (migration 0003).
  'public.conferir_senha(p_email text, p_senha text)',
  'public.definir_senha(p_usuario_id uuid, p_senha text)',
];

// Funções criadas pelas migrations (fora do catálogo do sistema e das extensões, como o pgcrypto).
const FUNCOES_DO_PROJETO = `
  select n.nspname as schema, p.proname as nome,
         format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as assinatura,
         p.prosecdef as definer,
         exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as search_path_fixo,
         has_function_privilege('app', p.oid, 'EXECUTE') as app_executa
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'tarefas')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass
                    and d.objid = p.oid and d.deptype = 'e')
  order by 3`;

interface Funcao {
  schema: string;
  nome: string;
  assinatura: string;
  definer: boolean;
  search_path_fixo: boolean;
  app_executa: boolean;
}

interface Problemas {
  tarefasSemDefinerOuSearchPath: string[];
  definerSemSearchPath: string[];
  appExecuta: string[];
}

async function examinar(cliente: pg.Client): Promise<Problemas> {
  const funcoes = (await cliente.query<Funcao>(FUNCOES_DO_PROJETO)).rows;
  return {
    tarefasSemDefinerOuSearchPath: funcoes
      .filter((f) => f.schema === 'tarefas' && !(f.definer && f.search_path_fixo))
      .map((f) => f.assinatura),
    definerSemSearchPath: funcoes
      .filter((f) => f.definer && !f.search_path_fixo)
      .map((f) => f.assinatura),
    appExecuta: funcoes.filter((f) => f.app_executa).map((f) => f.assinatura),
  };
}

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('funcoes');
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

// Roda `fn` depois de criar objetos numa transação desfeita no fim.
async function comObjetos<T>(ddl: string, fn: () => Promise<T>): Promise<T> {
  await banco.cliente.query('begin');
  try {
    await banco.cliente.query(ddl);
    return await fn();
  } finally {
    await banco.cliente.query('rollback');
  }
}

describe('funções tarefas.* e SECURITY DEFINER', () => {
  it('toda função de tarefas é SECURITY DEFINER com search_path fixo', async () => {
    expect((await examinar(banco.cliente)).tarefasSemDefinerOuSearchPath).toEqual([]);
  });

  it('toda função SECURITY DEFINER tem search_path fixo', async () => {
    expect((await examinar(banco.cliente)).definerSemSearchPath).toEqual([]);
  });

  it('a app executa só as funções da lista explícita', async () => {
    expect((await examinar(banco.cliente)).appExecuta).toEqual(EXECUTAVEIS_PELA_APP);
  });
});

describe('a checagem acusa função fora da regra', () => {
  it('acusa função de tarefas sem SECURITY DEFINER', async () => {
    const problemas = await comObjetos(
      `create function tarefas.sem_definer() returns int language sql set search_path = pg_catalog as 'select 1'`,
      () => examinar(banco.cliente),
    );
    expect(problemas.tarefasSemDefinerOuSearchPath).toEqual(['tarefas.sem_definer()']);
  });

  it('acusa função de tarefas SECURITY DEFINER sem search_path fixo', async () => {
    const problemas = await comObjetos(
      `create function tarefas.sem_search_path(n int) returns int language sql security definer as 'select n'`,
      () => examinar(banco.cliente),
    );
    expect(problemas.tarefasSemDefinerOuSearchPath).toEqual(['tarefas.sem_search_path(n integer)']);
    expect(problemas.definerSemSearchPath).toEqual(['tarefas.sem_search_path(n integer)']);
  });

  it('acusa função SECURITY DEFINER fora de tarefas sem search_path fixo', async () => {
    const problemas = await comObjetos(
      `create function public.definer_solto() returns int language sql security definer as 'select 1'`,
      () => examinar(banco.cliente),
    );
    expect(problemas.definerSemSearchPath).toEqual(['public.definer_solto()']);
  });

  it('acusa função liberada para a app fora da lista', async () => {
    const problemas = await comObjetos(
      `create function tarefas.liberada() returns int language sql security definer
         set search_path = pg_catalog as 'select 1';
       grant execute on function tarefas.liberada() to app;`,
      () => examinar(banco.cliente),
    );
    expect(problemas.appExecuta).not.toEqual(EXECUTAVEIS_PELA_APP);
    expect(problemas.appExecuta).toContain('tarefas.liberada()');
  });

  it('função nova de tarefas não fica executável pela app sem GRANT explícito', async () => {
    const problemas = await comObjetos(
      `set local role "owner";
       create function tarefas.nova() returns int language sql security definer
         set search_path = pg_catalog as 'select 1';`,
      () => examinar(banco.cliente),
    );
    expect(problemas.appExecuta).toEqual(EXECUTAVEIS_PELA_APP);
  });
});
