import { env } from 'cloudflare:workers';
import { sql } from 'kysely';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comTransacao } from '../../src/db.ts';

// T35 / ISO-01, ISO-02: harness de isolamento. Varre o catálogo e, para TODA tabela do schema
// public com coluna usuario_id (as de hoje e as que vierem), exige RLS ativa e forçada e prova,
// pela transação real da API (comTransacao, role app), que o profissional B não lê, não altera,
// não apaga e não cria linha em nome de A. Roda no `pnpm test` e no `pnpm test:isolamento` do CI.
// A única saída é a lista EXCECOES_SEM_RLS, explícita e justificada tabela a tabela.
//
// A linha de A é semeada pelo superusuário de teste (HYPERDRIVE_ADMIN) com valores gerados pelo
// tipo de cada coluna obrigatória. Coluna com CHECK que o valor genérico não atende ganha um valor
// em VALORES_POR_TABELA; tabela nova que não puder ser semeada faz o teste falhar e pede o ajuste.

const SEM_PERMISSAO_OU_RLS = '42501';

// Exceções revisadas tabela a tabela (T40): tabelas de identidade com usuario_id que ficam SEM
// RLS, conforme o design, porque são lidas ou gravadas antes de existir usuário na transação
// (cadastro, confirmação, login, 2FA, recuperação e o próprio middleware de sessão). Em vez do
// RLS, a app tem grants mínimos por coluna, sem DELETE nem TRUNCATE. Os privilégios exatos da app
// ficam declarados aqui: mudar um grant, criar outra tabela sem RLS ou dar RLS a uma exceção faz
// o teste falhar e obriga a revisar a lista.
const EXCECOES_SEM_RLS: Record<string, { motivo: string; privilegiosApp: string[] }> = {
  aceite_termos: {
    motivo: 'gravado na confirmação do e-mail, rota pública que roda sem sessão',
    privilegiosApp: ['INSERT', 'SELECT'],
  },
  credencial_senha: {
    motivo:
      'hash da senha; a app não tem privilégio algum, só as funções definir_senha e conferir_senha',
    privilegiosApp: [],
  },
  desafio_2fa: {
    motivo: 'criado no login e conferido no 2FA, os dois antes de existir sessão',
    privilegiosApp: ['INSERT', 'SELECT', 'UPDATE'],
  },
  sessao: {
    motivo: 'achada pelo hash do cookie no middleware, antes de saber o usuário',
    privilegiosApp: ['INSERT', 'SELECT', 'UPDATE'],
  },
  token_email: {
    motivo:
      'achado pelo hash do link (confirmação, recuperação, exclusão, desistência), sem sessão',
    privilegiosApp: ['INSERT', 'SELECT', 'UPDATE'],
  },
};

// Expressões SQL fixas (escritas aqui, nunca vindas de entrada) por tabela e coluna.
const VALORES_POR_TABELA: Record<string, Record<string, string>> = {
  audit_log: { ator: "'sistema'", acao: "'auth.login_ok'", alvo_tipo: "'conta'" },
  assinatura: { plano: "'pro'", status: "'trial'" },
  // event_id é único e o banco de teste acumula linhas entre execuções.
  webhook_evento: { event_id: 'gen_random_uuid()::text' },
};

const admin = new pg.Client({
  connectionString: (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN
    .connectionString,
});
admin.on('error', () => {});

const A = crypto.randomUUID();
const B = crypto.randomUUID();

interface TabelaComUsuario {
  tabela: string;
  rls: boolean;
  forcada: boolean;
}

const CONSULTA_TABELAS = `
  select c.relname as tabela, c.relrowsecurity as rls, c.relforcerowsecurity as forcada
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'usuario_id' and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  order by 1`;

async function tabelasComUsuario(cliente: pg.Client): Promise<TabelaComUsuario[]> {
  return (await cliente.query<TabelaComUsuario>(CONSULTA_TABELAS)).rows;
}

interface Coluna {
  coluna: string;
  tipo: string;
  categoria: string;
  rotulo_enum: string | null;
}

function valorGenerico(tabela: string, { coluna, tipo, categoria, rotulo_enum }: Coluna): string {
  const definido = VALORES_POR_TABELA[tabela]?.[coluna];
  if (definido !== undefined) return definido;
  if (rotulo_enum !== null) return `${pg.escapeLiteral(rotulo_enum)}::${tipo}`;
  if (categoria === 'A') return `'{}'::${tipo}`;
  if (tipo === 'uuid') return 'gen_random_uuid()';
  if (tipo === 'jsonb' || tipo === 'json') return `'{}'::${tipo}`;
  if (categoria === 'S') return "'x'";
  if (categoria === 'N') return '1';
  if (categoria === 'B') return 'false';
  if (categoria === 'D') return 'now()';
  throw new Error(
    `isolamento: sem valor genérico para ${tabela}.${coluna} (${tipo}); acrescente em VALORES_POR_TABELA`,
  );
}

// Insere uma linha de `usuarioId` em `tabela` como superusuário, sem checar FKs nem triggers
// (session_replication_role = replica): o harness testa o RLS, não as relações.
async function semearLinha(tabela: string, usuarioId: string): Promise<void> {
  const colunas = (
    await admin.query<Coluna>(
      `select a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo,
              t.typcategory as categoria,
              (select e.enumlabel from pg_enum e where e.enumtypid = a.atttypid
               order by e.enumsortorder limit 1) as rotulo_enum
       from pg_attribute a join pg_type t on t.oid = a.atttypid
       where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
         and a.attnotnull and not a.atthasdef and a.attidentity = '' and a.attgenerated = ''
         and a.attname <> 'usuario_id'
       order by a.attnum`,
      [`public.${tabela}`],
    )
  ).rows;
  const nomes = ['usuario_id', ...colunas.map((c) => pg.escapeIdentifier(c.coluna))];
  const valores = ['$1', ...colunas.map((c) => valorGenerico(tabela, c))];
  await admin.query('begin');
  try {
    await admin.query('set local session_replication_role = replica');
    await admin.query(
      `insert into public.${pg.escapeIdentifier(tabela)} (${nomes.join(', ')}) values (${valores.join(', ')})`,
      [usuarioId],
    );
    await admin.query('commit');
  } catch (erro) {
    await admin.query('rollback');
    throw new Error(
      `isolamento: não consegui semear ${tabela} (${(erro as Error).message}); acrescente em VALORES_POR_TABELA`,
      { cause: erro },
    );
  }
}

async function codigoDoErro(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (erro) {
    return (erro as { code?: string }).code ?? 'sem-codigo';
  }
}

// Linhas afetadas por um comando de B, ou o código do erro se o banco recusar.
async function resultadoComoB(comando: ReturnType<typeof sql>): Promise<string | number> {
  let afetadas = 0;
  const codigo = await codigoDoErro(() =>
    comTransacao(env, B, async (trx) => {
      afetadas = Number((await comando.execute(trx)).numAffectedRows ?? 0);
    }),
  );
  return codigo ?? afetadas;
}

const contarDeA = (usuarioId: string, tabela: string) =>
  comTransacao(env, usuarioId, async (trx) => {
    const { rows } = await sql<{ total: string }>`
      select count(*)::text as total from ${sql.table(`public.${tabela}`)}
      where usuario_id = ${A}`.execute(trx);
    return Number(rows[0]?.total);
  });

// Privilégios da app na tabela, contando também os concedidos só em algumas colunas.
const CONSULTA_PRIVILEGIOS_APP = `
  select p as privilegio from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
    'REFERENCES', 'TRIGGER']) p
  where has_table_privilege('app', $1::regclass, p)
     or (p in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
         and has_any_column_privilege('app', $1::regclass, p))
  order by 1`;

const semRlsForcada = (lista: TabelaComUsuario[]): string[] =>
  lista.filter((t) => !t.rls || !t.forcada).map((t) => t.tabela);

let todas: TabelaComUsuario[] = [];
// Tabelas com usuario_id e RLS: todas menos as exceções declaradas.
let tabelas: TabelaComUsuario[] = [];

beforeAll(async () => {
  await admin.connect();
  todas = await tabelasComUsuario(admin);
  tabelas = todas.filter((t) => !(t.tabela in EXCECOES_SEM_RLS));
  for (const { tabela } of tabelas) await semearLinha(tabela, A);
}, 60_000);

afterAll(async () => {
  await admin.end();
});

describe('harness de isolamento', () => {
  it('encontra as tabelas com usuario_id pelo catálogo (inclui audit_log)', () => {
    expect(tabelas.map((t) => t.tabela)).toContain('audit_log');
  });

  it('cobre as tabelas de cobrança (T41: assinatura e webhook_evento)', () => {
    expect(tabelas.map((t) => t.tabela)).toEqual(
      expect.arrayContaining(['assinatura', 'webhook_evento']),
    );
  });

  it('cobre as tabelas de perfil (T61: perfil e configuracao_usuario)', () => {
    expect(tabelas.map((t) => t.tabela)).toEqual(
      expect.arrayContaining(['perfil', 'configuracao_usuario']),
    );
  });

  it('toda tabela com usuario_id tem RLS ativa e forçada, fora as exceções declaradas', () => {
    expect(semRlsForcada(todas)).toEqual(Object.keys(EXCECOES_SEM_RLS).sort());
  });

  it('cada exceção existe, tem motivo e a app tem só os privilégios declarados', async () => {
    for (const [tabela, { motivo, privilegiosApp }] of Object.entries(EXCECOES_SEM_RLS)) {
      expect(
        todas.map((t) => t.tabela),
        tabela,
      ).toContain(tabela);
      expect(motivo.length, tabela).toBeGreaterThan(20);
      const { rows } = await admin.query<{ privilegio: string }>(CONSULTA_PRIVILEGIOS_APP, [
        `public.${tabela}`,
      ]);
      expect(
        rows.map((r) => r.privilegio),
        tabela,
      ).toEqual(privilegiosApp);
    }
  });

  it('nenhuma exceção dá DELETE ou TRUNCATE à app', () => {
    for (const { privilegiosApp } of Object.values(EXCECOES_SEM_RLS)) {
      expect(privilegiosApp).not.toContain('DELETE');
      expect(privilegiosApp).not.toContain('TRUNCATE');
    }
  });

  it('acusa uma tabela nova com usuario_id criada sem RLS forçada', async () => {
    await admin.query('begin');
    try {
      await admin.query('create table public.isolamento_sem_rls (usuario_id uuid not null)');
      await admin.query('alter table public.isolamento_sem_rls enable row level security');
      const encontradas = await tabelasComUsuario(admin);
      const novas = semRlsForcada(encontradas).filter((t) => !(t in EXCECOES_SEM_RLS));
      expect(novas).toEqual(['isolamento_sem_rls']);
      expect(semRlsForcada(encontradas)).not.toEqual(Object.keys(EXCECOES_SEM_RLS).sort());
    } finally {
      await admin.query('rollback');
    }
  });

  it('cada tabela semeada mostra a linha de A para A (o seed vale)', async () => {
    for (const { tabela } of tabelas) expect(await contarDeA(A, tabela), tabela).toBe(1);
  });

  it('B não lê nenhuma linha de A', async () => {
    for (const { tabela } of tabelas) expect(await contarDeA(B, tabela), tabela).toBe(0);
  });

  it('B não altera linha de A (zero linhas afetadas ou recusa do banco)', async () => {
    for (const { tabela } of tabelas) {
      const resultado = await resultadoComoB(
        sql`update ${sql.table(`public.${tabela}`)} set usuario_id = usuario_id
            where usuario_id = ${A}`,
      );
      expect([0, SEM_PERMISSAO_OU_RLS], tabela).toContain(resultado);
    }
    for (const { tabela } of tabelas) expect(await contarDeA(A, tabela), tabela).toBe(1);
  });

  it('B não apaga linha de A (zero linhas afetadas ou recusa do banco)', async () => {
    for (const { tabela } of tabelas) {
      const resultado = await resultadoComoB(
        sql`delete from ${sql.table(`public.${tabela}`)} where usuario_id = ${A}`,
      );
      expect([0, SEM_PERMISSAO_OU_RLS], tabela).toContain(resultado);
    }
    for (const { tabela } of tabelas) expect(await contarDeA(A, tabela), tabela).toBe(1);
  });

  it('B não cria linha em nome de A', async () => {
    for (const { tabela } of tabelas) {
      const resultado = await resultadoComoB(
        sql`insert into ${sql.table(`public.${tabela}`)} (usuario_id) values (${A})`,
      );
      expect(resultado, tabela).toBe(SEM_PERMISSAO_OU_RLS);
    }
    for (const { tabela } of tabelas) expect(await contarDeA(A, tabela), tabela).toBe(1);
  });
});
