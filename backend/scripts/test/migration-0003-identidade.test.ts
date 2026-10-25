import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T40 / AUTH-12, CAD-03, ISO-03: migration 0003 cria as tabelas de identidade (sem RLS, conforme
// o design: o acesso passa por grants mínimos e funções). Garantias:
// - hash e conferência de senha só no Postgres, com crypt() e gen_salt('bf', 12) e a senha como
//   parâmetro; a app nem lê a tabela de credenciais;
// - token de e-mail, sessão e código 2FA guardados só como hash (bytea de 32 bytes, SHA-256 ou
//   HMAC-SHA256), sem coluna para o valor em claro;
// - a app não apaga nem trunca nenhuma tabela de identidade.

const SEM_PERMISSAO = '42501';
const VIOLA_CHECK = '23514';
const TABELAS = [
  'aceite_termos',
  'credencial_senha',
  'desafio_2fa',
  'sessao',
  'tentativa_login',
  'token_email',
  'usuario',
];
const SENHA = 'cavalo-bateria-grampo-7';

let banco: BancoDeTeste;
let usuarioId: string;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0003');
  usuarioId = (
    await banco.cliente.query<{ id: string }>(
      "insert into usuario (email, nome) values ('ana@exemplo.com.br', 'Ana') returning id",
    )
  ).rows[0]!.id;
  await banco.cliente.query('select definir_senha($1, $2)', [usuarioId, SENHA]);
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const comoApp = <T>(fn: () => Promise<T>) => comoRole(banco.cliente, 'app', fn);

async function colunas(tabela: string): Promise<Record<string, string>> {
  const linhas = await consultar<{ coluna: string; tipo: string }>(
    `select column_name as coluna, data_type as tipo from information_schema.columns
     where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [tabela],
  );
  return Object.fromEntries(linhas.map((l) => [l.coluna, l.tipo]));
}

describe('migration 0003: tabelas de identidade', () => {
  it('cria as sete tabelas', async () => {
    const existentes = await consultar<{ tabela: string }>(
      `select table_name as tabela from information_schema.tables
       where table_schema = 'public' and table_name = any($1) order by 1`,
      [TABELAS],
    );
    expect(existentes.map((t) => t.tabela)).toEqual(TABELAS);
  });

  it('usuario guarda o e-mail em minúsculas e único', async () => {
    expect(
      await codigoDoErro(() =>
        banco.cliente.query("insert into usuario (email, nome) values ('Bia@exemplo.com', 'Bia')"),
      ),
    ).toBe(VIOLA_CHECK);
    expect(
      await codigoDoErro(() =>
        banco.cliente.query(
          "insert into usuario (email, nome) values ('ana@exemplo.com.br', 'Outra')",
        ),
      ),
    ).toBe('23505');
  });

  it('token_email aceita só os tipos confirmacao, recuperacao, exclusao e desistencia', async () => {
    const inserir = (tipo: string) =>
      comoApp(() =>
        banco.cliente.query(
          `insert into token_email (usuario_id, tipo, token_hash, expira_em)
           values ($1, $2, $3, now() + interval '30 minutes')`,
          [usuarioId, tipo, Buffer.alloc(32, tipo.length)],
        ),
      );
    for (const tipo of ['confirmacao', 'recuperacao', 'exclusao', 'desistencia'])
      expect(await codigoDoErro(() => inserir(tipo)), tipo).toBeNull();
    expect(await codigoDoErro(() => inserir('convite'))).toBe(VIOLA_CHECK);
  });
});

describe('senha: hash e conferência só no Postgres (AUTH-12)', () => {
  it('grava bcrypt de custo 12, nunca a senha', async () => {
    const [credencial] = await consultar<{ hash: string }>(
      'select hash from credencial_senha where usuario_id = $1',
      [usuarioId],
    );
    expect(credencial!.hash).toMatch(/^\$2a\$12\$.{53}$/);
    expect(credencial!.hash).not.toContain(SENHA);
    const [confere] = await consultar<{ ok: boolean }>(
      'select crypt($1, hash) = hash as ok from credencial_senha where usuario_id = $2',
      [SENHA, usuarioId],
    );
    expect(confere).toEqual({ ok: true });
  });

  it('a app confere a senha pela função, com a senha como parâmetro', async () => {
    const conferir = (email: string, senha: string) =>
      comoApp(async () => {
        const { rows } = await banco.cliente.query<{ id: string | null }>(
          'select conferir_senha($1, $2) as id',
          [email, senha],
        );
        return rows[0]!.id;
      });
    expect(await conferir('ana@exemplo.com.br', SENHA)).toBe(usuarioId);
    expect(await conferir('ana@exemplo.com.br', `${SENHA}x`)).toBeNull();
    expect(await conferir('ninguem@exemplo.com.br', SENHA)).toBeNull();
  });

  it('e-mail inexistente também calcula o hash (tempo equivalente)', async () => {
    const medir = async (email: string) => {
      const inicio = performance.now();
      await comoApp(() => banco.cliente.query('select conferir_senha($1, $2)', [email, SENHA]));
      return performance.now() - inicio;
    };
    await medir('ana@exemplo.com.br');
    const existente = await medir('ana@exemplo.com.br');
    const inexistente = await medir('ninguem@exemplo.com.br');
    expect(inexistente).toBeGreaterThan(existente * 0.5);
  });

  it('trocar a senha pela função gera hash novo e a antiga deixa de valer', async () => {
    const resultado = await comoApp(async () => {
      await banco.cliente.query('select definir_senha($1, $2)', [usuarioId, 'outra-senha-forte-9']);
      const { rows } = await banco.cliente.query<{ antiga: string | null; nova: string | null }>(
        `select conferir_senha('ana@exemplo.com.br', $1) as antiga,
                conferir_senha('ana@exemplo.com.br', 'outra-senha-forte-9') as nova`,
        [SENHA],
      );
      return rows[0];
    });
    expect(resultado).toEqual({ antiga: null, nova: usuarioId });
  });

  it('a app não lê nem grava a tabela de credenciais diretamente', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('app', 'credencial_senha', 'SELECT') as select,
              has_table_privilege('app', 'credencial_senha', 'INSERT') as insert,
              has_table_privilege('app', 'credencial_senha', 'UPDATE') as update`,
    );
    expect(privilegios).toEqual({ select: false, insert: false, update: false });
    expect(
      await comoApp(() =>
        codigoDoErro(() => banco.cliente.query('select * from credencial_senha')),
      ),
    ).toBe(SEM_PERMISSAO);
  });

  it('as funções de senha recebem a senha como parâmetro text', async () => {
    const assinaturas = await consultar<{ assinatura: string }>(
      `select format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) as assinatura
       from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname in ('definir_senha', 'conferir_senha') order by 1`,
    );
    expect(assinaturas.map((a) => a.assinatura)).toEqual([
      'conferir_senha(p_email text, p_senha text)',
      'definir_senha(p_usuario_id uuid, p_senha text)',
    ]);
  });
});

describe('tokens, sessão e código 2FA só como hash (CAD-03, AUTH-03, AUTH-09)', () => {
  it('as colunas são exatamente estas, sem valor em claro', async () => {
    expect(await colunas('sessao')).toEqual({
      id: 'uuid',
      usuario_id: 'uuid',
      token_hash: 'bytea',
      criada_em: 'timestamp with time zone',
      ultimo_uso_em: 'timestamp with time zone',
      encerrada_em: 'timestamp with time zone',
    });
    expect(await colunas('desafio_2fa')).toEqual({
      id: 'uuid',
      usuario_id: 'uuid',
      codigo_hmac: 'bytea',
      criado_em: 'timestamp with time zone',
      expira_em: 'timestamp with time zone',
      erros: 'integer',
      usado_em: 'timestamp with time zone',
      invalidado_em: 'timestamp with time zone',
    });
    expect(await colunas('token_email')).toEqual({
      id: 'uuid',
      usuario_id: 'uuid',
      tipo: 'text',
      token_hash: 'bytea',
      criado_em: 'timestamp with time zone',
      expira_em: 'timestamp with time zone',
      usado_em: 'timestamp with time zone',
      invalidado_em: 'timestamp with time zone',
    });
  });

  it.each([
    ['sessao', 'token_hash', '(usuario_id, token_hash) values ($1, $2)'],
    [
      'desafio_2fa',
      'codigo_hmac',
      "(usuario_id, codigo_hmac, expira_em) values ($1, $2, now() + interval '10 minutes')",
    ],
    [
      'token_email',
      'token_hash',
      "(usuario_id, tipo, token_hash, expira_em) values ($1, 'confirmacao', $2, now())",
    ],
  ])('%s.%s aceita só 32 bytes', async (tabela, _coluna, valores) => {
    const inserir = (bytes: Buffer) =>
      comoApp(() => banco.cliente.query(`insert into ${tabela} ${valores}`, [usuarioId, bytes]));
    expect(await codigoDoErro(() => inserir(Buffer.alloc(32, 1)))).toBeNull();
    expect(await codigoDoErro(() => inserir(Buffer.alloc(31, 1)))).toBe(VIOLA_CHECK);
    expect(await codigoDoErro(() => inserir(Buffer.from('a'.repeat(43))))).toBe(VIOLA_CHECK);
  });

  it('o mesmo hash de token não se repete', async () => {
    const hash = Buffer.alloc(32, 7);
    const codigo = await comoApp(async () => {
      await banco.cliente.query('insert into sessao (usuario_id, token_hash) values ($1, $2)', [
        usuarioId,
        hash,
      ]);
      return codigoDoErro(() =>
        banco.cliente.query('insert into sessao (usuario_id, token_hash) values ($1, $2)', [
          usuarioId,
          hash,
        ]),
      );
    });
    expect(codigo).toBe('23505');
  });

  it('o desafio 2FA não passa de 5 erros', async () => {
    const codigo = await comoApp(async () => {
      const { rows } = await banco.cliente.query<{ id: string }>(
        `insert into desafio_2fa (usuario_id, codigo_hmac, expira_em)
         values ($1, $2, now() + interval '10 minutes') returning id`,
        [usuarioId, Buffer.alloc(32, 2)],
      );
      await banco.cliente.query('update desafio_2fa set erros = 5 where id = $1', [rows[0]!.id]);
      return codigoDoErro(() =>
        banco.cliente.query('update desafio_2fa set erros = 6 where id = $1', [rows[0]!.id]),
      );
    });
    expect(codigo).toBe(VIOLA_CHECK);
  });
});

describe('a app não apaga linhas (ISO-03)', () => {
  it('sem DELETE nem TRUNCATE em nenhuma tabela de identidade', async () => {
    const privilegios = await consultar<{ tabela: string; delete: boolean; truncate: boolean }>(
      `select t as tabela, has_table_privilege('app', t, 'DELETE') as delete,
              has_table_privilege('app', t, 'TRUNCATE') as truncate
       from unnest($1::text[]) t order by 1`,
      [TABELAS],
    );
    expect(privilegios).toEqual(
      TABELAS.map((tabela) => ({ tabela, delete: false, truncate: false })),
    );
  });

  it.each(TABELAS)('DELETE em %s como app é recusado', async (tabela) => {
    expect(
      await comoApp(() => codigoDoErro(() => banco.cliente.query(`delete from ${tabela}`))),
    ).toBe(SEM_PERMISSAO);
  });

  it('a app não troca o hash de uma sessão nem o dono de um token', async () => {
    expect(
      await comoApp(() =>
        codigoDoErro(() => banco.cliente.query("update sessao set token_hash = '\\x00'")),
      ),
    ).toBe(SEM_PERMISSAO);
    expect(
      await comoApp(() =>
        codigoDoErro(() =>
          banco.cliente.query('update token_email set usuario_id = gen_random_uuid()'),
        ),
      ),
    ).toBe(SEM_PERMISSAO);
  });

  it('backup_ro lê todas as tabelas de identidade e não escreve', async () => {
    const privilegios = await consultar<{ select: boolean; insert: boolean }>(
      `select bool_and(has_table_privilege('backup_ro', t, 'SELECT')) as select,
              bool_or(has_table_privilege('backup_ro', t, 'INSERT')) as insert
       from unnest($1::text[]) t`,
      [TABELAS],
    );
    expect(privilegios).toEqual([{ select: true, insert: false }]);
  });
});
