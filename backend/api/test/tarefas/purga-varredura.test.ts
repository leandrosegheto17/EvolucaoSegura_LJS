import { env } from 'cloudflare:workers';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tarefaPurga } from '../../src/tarefas/purga.ts';
import { criarConta, sha256 } from '../apoio.ts';

// T182 / CONTA-05: varredura da purga pelo catálogo. Duas contas reais (A, que pediu a exclusão,
// e B, outro profissional) ganham uma linha em TODA tabela do schema public com coluna usuario_id
// (as de hoje e as que vierem), mais a tentativa de login do e-mail. A purga roda 30 dias depois
// do bloqueio de A. Depois dela, a varredura percorre TODAS as tabelas do schema public (catálogo,
// não lista fixa) e procura, no texto de cada linha, o id de A, o e-mail de A e o SHA-256 do
// e-mail de A: nenhuma linha pode trazê-los, auditoria inclusive, salvo a própria conta_excluida
// (só id, data do pedido e data da purga). As linhas de B ficam idênticas.
// A linha genérica é semeada pelo superusuário de teste com valores pelo tipo de cada coluna
// obrigatória (o mesmo método do harness de isolamento, T35), sem checar FKs (replica): a
// varredura testa o que a purga apaga, não as relações. Tabela nova que o valor genérico não
// atende faz o teste falhar e pede o valor em VALORES_POR_TABELA.
// Isolamento no banco compartilhado: bloqueio de A em 1985 e a tarefa roda nessa data, então as
// contas bloqueadas hoje pelos outros arquivos não são purgadas aqui.

const LENTO = { timeout: 60_000 };
const DIA = 24 * 60 * 60_000;
const BLOQUEIO = new Date('1985-04-01T12:00:00.000Z');
const PEDIDO = new Date(BLOQUEIO.getTime() - 15 * 60_000);
const AGORA = new Date(BLOQUEIO.getTime() + 30 * DIA);

// Expressões SQL fixas (escritas aqui, nunca vindas de entrada) por tabela e coluna.
const VALORES_POR_TABELA: Record<string, Record<string, string>> = {
  audit_log: { ator: "'sistema'", acao: "'auth.login_ok'", alvo_tipo: "'conta'" },
  // Datas longe de hoje: as tarefas do cron que outros arquivos rodam com o relógio de hoje (trial
  // vencido, avisos de sessão e de pendência) não mexem nas linhas de B durante a varredura.
  assinatura: { plano: "'pro'", status: "'trial'", periodo_fim: "'2999-01-01T00:00:00Z'" },
  webhook_evento: { event_id: 'gen_random_uuid()::text' },
  serie_recorrencia: { frequencia: "'semanal'", ocorrencias: '2' },
  sessao_atendimento: {
    inicio: "'1985-03-01T13:00:00Z'",
    fim: "'1985-03-01T13:50:00Z'",
  },
  modelo_anamnese: { especialidade: "'psicologia'" },
  modelo_anamnese_item: { tipo: "'campo'" },
  modelo_texto: { tipo: "'evolucao'" },
  pagamento: { meio: "'pix'" },
  push_subscription: { endpoint: "'https://push.exemplo.com/' || gen_random_uuid()" },
  notificacao_enviada: { tipo: "'sessao_proxima'" },
  // Identidade (sem RLS).
  credencial_senha: { hash: "'$2a$04$' || repeat('a', 53)" },
  token_email: {
    tipo: "'desistencia'",
    token_hash: 'sha256(gen_random_uuid()::text::bytea)',
    expira_em: "now() + interval '1 day'",
  },
  sessao: { token_hash: 'sha256(gen_random_uuid()::text::bytea)' },
  desafio_2fa: {
    codigo_hmac: 'sha256(gen_random_uuid()::text::bytea)',
    expira_em: "now() + interval '5 minutes'",
  },
  aceite_termos: { versao_termos: "'1.0'", versao_privacidade: "'1.0'" },
};

const admin = new pg.Client({
  connectionString: (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN
    .connectionString,
});
admin.on('error', () => {});

interface Conta {
  id: string;
  email: string;
  hashEmail: string;
}

let A: Conta;
let B: Conta;
let tabelasComUsuario: string[] = [];

interface Coluna {
  coluna: string;
  tipo: string;
  categoria: string;
}

function valorGenerico(tabela: string, { coluna, tipo, categoria }: Coluna): string {
  const definido = VALORES_POR_TABELA[tabela]?.[coluna];
  if (definido !== undefined) return definido;
  if (categoria === 'A') return `'{}'::${tipo}`;
  if (tipo === 'uuid') return 'gen_random_uuid()';
  if (tipo === 'jsonb' || tipo === 'json') return `'{}'::${tipo}`;
  if (categoria === 'S') return "'x'";
  if (categoria === 'N') return '1';
  if (categoria === 'B') return 'false';
  if (categoria === 'D') return 'now()';
  throw new Error(
    `varredura: sem valor genérico para ${tabela}.${coluna} (${tipo}); acrescente em VALORES_POR_TABELA`,
  );
}

async function semearLinha(tabela: string, usuarioId: string): Promise<void> {
  const colunas = (
    await admin.query<Coluna>(
      `select a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo,
              t.typcategory as categoria
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
      `insert into public.${pg.escapeIdentifier(tabela)} (${nomes.join(', ')})
       values (${valores.join(', ')}) on conflict do nothing`,
      [usuarioId],
    );
    await admin.query('commit');
  } catch (erro) {
    await admin.query('rollback');
    throw new Error(
      `varredura: não consegui semear ${tabela} (${(erro as Error).message}); acrescente em VALORES_POR_TABELA`,
      { cause: erro },
    );
  }
}

async function contaSemeada(): Promise<Conta> {
  const conta = await criarConta();
  const hash = await sha256(conta.email);
  await admin.query(
    `insert into tentativa_login (tipo, chave_hash, falhas) values ('email', $1, 1)
     on conflict do nothing`,
    [hash],
  );
  for (const tabela of tabelasComUsuario) await semearLinha(tabela, conta.id);
  return { id: conta.id, email: conta.email, hashEmail: hash.toString('hex') };
}

// Todas as tabelas do schema public, pelo catálogo (menos o controle das migrations).
async function todasAsTabelas(): Promise<string[]> {
  const { rows } = await admin.query<{ tabela: string }>(
    `select c.relname as tabela from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'pgmigrations'
     order by 1`,
  );
  return rows.map((r) => r.tabela);
}

// Por tabela, quantas linhas trazem no texto o id, o e-mail ou o SHA-256 do e-mail da conta
// (bytea aparece como \x<hex> no JSON). Superusuário: ignora o RLS.
async function varrer(conta: Conta): Promise<Record<string, number>> {
  const resultado: Record<string, number> = {};
  for (const tabela of await todasAsTabelas()) {
    const { rows } = await admin.query<{ n: number }>(
      `select count(*)::int as n from public.${pg.escapeIdentifier(tabela)} t
       where strpos(row_to_json(t)::text, $1) > 0 or strpos(lower(row_to_json(t)::text), $2) > 0
          or strpos(row_to_json(t)::text, $3) > 0`,
      [conta.id, conta.email.toLowerCase(), conta.hashEmail],
    );
    if (rows[0]!.n > 0) resultado[tabela] = rows[0]!.n;
  }
  return resultado;
}

// Retrato das linhas da conta em cada tabela (texto completo, em ordem): igual = intactas.
async function retrato(conta: Conta): Promise<Record<string, string[]>> {
  const resultado: Record<string, string[]> = {};
  for (const tabela of await todasAsTabelas()) {
    const { rows } = await admin.query<{ texto: string }>(
      `select row_to_json(t)::text as texto from public.${pg.escapeIdentifier(tabela)} t
       where strpos(row_to_json(t)::text, $1) > 0 or strpos(row_to_json(t)::text, $2) > 0
       order by 1`,
      [conta.id, conta.hashEmail],
    );
    if (rows.length > 0) resultado[tabela] = rows.map((r) => r.texto);
  }
  return resultado;
}

let antesA: Record<string, number> = {};
let retratoB: Record<string, string[]> = {};

beforeAll(async () => {
  await admin.connect();
  const { rows } = await admin.query<{ tabela: string }>(
    `select c.relname as tabela from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'usuario_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
  );
  tabelasComUsuario = rows.map((r) => r.tabela);
  A = await contaSemeada();
  B = await contaSemeada();
  await admin.query(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id, criado_em)
     values ($1::uuid, $1::text, 'conta.exclusao_pedida', 'conta', $1::uuid, $2)`,
    [A.id, PEDIDO],
  );
  antesA = await varrer(A);
  retratoB = await retrato(B);
  // O bloqueio vem por último, depois de semear tudo (como na confirmação).
  await admin.query('update usuario set bloqueado_exclusao_em = $2 where id = $1', [
    A.id,
    BLOQUEIO,
  ]);
  await tarefaPurga().executar({
    agora: AGORA,
    desde: null,
    limite: 1000,
    env,
    emSegundoPlano: () => {},
    capturarErro: () => {},
  });
}, 120_000);

afterAll(async () => {
  await admin.end();
});

describe('varredura da purga pelo catálogo (CONTA-05)', LENTO, () => {
  it('antes da purga, a varredura acha a conta em toda tabela com usuario_id e no e-mail', () => {
    const esperadas = [...tabelasComUsuario, 'tentativa_login', 'usuario'].sort();
    expect(Object.keys(antesA).sort()).toEqual(esperadas);
    expect(tabelasComUsuario).toEqual(expect.arrayContaining(['audit_log', 'token_email']));
  });

  it('após 30 dias nenhuma tabela tem linha do profissional, auditoria inclusive', async () => {
    expect(await varrer(A)).toEqual({ conta_excluida: 1 });
  });

  it('conta_excluida guarda só id, data do pedido e data da purga', async () => {
    const { rows } = await admin.query<{ id: string; pedido_em: Date; purgado_em: Date }>(
      'select * from conta_excluida where id = $1',
      [A.id],
    );
    expect(rows).toEqual([{ id: A.id, pedido_em: PEDIDO, purgado_em: expect.any(Date) }]);
    // Outro arquivo de teste pode rodar a purga com um `agora` mais tardio no banco compartilhado;
    // a data exata da purga é provada na T152 (purga.test.ts e migration-0023).
    expect(rows[0]!.purgado_em.getTime()).toBeGreaterThanOrEqual(AGORA.getTime());
  });

  it('dados de outro profissional intactos', async () => {
    expect(Object.keys(retratoB).length).toBeGreaterThan(tabelasComUsuario.length);
    expect(await retrato(B)).toEqual(retratoB);
  });
});
