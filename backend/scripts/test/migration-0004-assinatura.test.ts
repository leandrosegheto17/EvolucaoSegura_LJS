import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T41 / PLANO-01, ISO-01, ISO-03, ISO-04: migration 0004 cria assinatura e webhook_evento com RLS
// forçada. Os estados da assinatura (trial, ativa, atrasada, cancelada, free) são garantidos por
// restrição; o event_id do webhook é único (PLANO-07 depende disso). A app não apaga nada.

const VIOLA_CHECK = '23514';
const DUPLICADO = '23505';
const SEM_PERMISSAO_OU_RLS = '42501';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0004');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into assinatura (usuario_id, plano, status, periodo_fim)
     values ($1, 'pro', 'trial', now() + interval '14 days'), ($2, 'free', 'free', now())`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into webhook_evento (event_id, usuario_id, tipo, payload)
     values ('evt_a', $1, 'PAYMENT_RECEIVED', '{}'), ('evt_b', $2, 'PAYMENT_RECEIVED', '{}')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

// Insere a assinatura de um usuário novo (superusuário) numa transação desfeita.
async function erroAoCriar(plano: string, status: string): Promise<string | null> {
  return comoRole(banco.cliente, null, async () => {
    const { rows } = await banco.cliente.query<{ id: string }>(
      "insert into usuario (email, nome) values ('novo@exemplo.com', 'N') returning id",
    );
    return codigoDoErro(() =>
      banco.cliente.query(
        'insert into assinatura (usuario_id, plano, status, periodo_fim) values ($1, $2, $3, now())',
        [rows[0]!.id, plano, status],
      ),
    );
  });
}

describe('assinatura: estados por restrição (PLANO-01)', () => {
  it.each(['trial', 'ativa', 'atrasada', 'cancelada'])('aceita %s no plano pro', async (status) => {
    expect(await erroAoCriar('pro', status)).toBeNull();
  });

  it('aceita free no plano free', async () => {
    expect(await erroAoCriar('free', 'free')).toBeNull();
  });

  it.each(['pendente', 'expirada', 'TRIAL', ''])('recusa o estado %j', async (status) => {
    expect(await erroAoCriar('pro', status)).toBe(VIOLA_CHECK);
  });

  it('recusa plano fora de pro e free', async () => {
    expect(await erroAoCriar('premium', 'ativa')).toBe(VIOLA_CHECK);
  });

  it('o plano free anda só com o estado free, e o pro com os outros quatro', async () => {
    expect(await erroAoCriar('free', 'trial')).toBe(VIOLA_CHECK);
    expect(await erroAoCriar('pro', 'free')).toBe(VIOLA_CHECK);
  });

  it('uma assinatura por profissional', async () => {
    const codigo = await comoRole(banco.cliente, null, () =>
      codigoDoErro(() =>
        banco.cliente.query(
          "insert into assinatura (usuario_id, plano, status, periodo_fim) values ($1, 'pro', 'ativa', now())",
          [A],
        ),
      ),
    );
    expect(codigo).toBe(DUPLICADO);
  });
});

describe('webhook_evento', () => {
  it('event_id é único', async () => {
    const codigo = await comoRole(banco.cliente, null, () =>
      codigoDoErro(() =>
        banco.cliente.query(
          "insert into webhook_evento (event_id, tipo, payload) values ('evt_a', 'PAYMENT_RECEIVED', '{}')",
        ),
      ),
    );
    expect(codigo).toBe(DUPLICADO);
  });

  it('a app não grava nem altera eventos (só as funções de tarefa, depois)', async () => {
    const inserir = await comoRole(
      banco.cliente,
      'evolucao_app',
      () =>
        codigoDoErro(() =>
          banco.cliente.query(
            "insert into webhook_evento (event_id, usuario_id, tipo, payload) values ('evt_x', $1, 'X', '{}')",
            [A],
          ),
        ),
      A,
    );
    const alterar = await comoRole(
      banco.cliente,
      'evolucao_app',
      () =>
        codigoDoErro(() => banco.cliente.query('update webhook_evento set processado_em = now()')),
      A,
    );
    expect([inserir, alterar]).toEqual([SEM_PERMISSAO_OU_RLS, SEM_PERMISSAO_OU_RLS]);
  });
});

describe.each(['assinatura', 'webhook_evento'])(
  '%s: RLS forçada e isolamento (ISO-01)',
  (tabela) => {
    const visiveis = async () =>
      (await consultar<{ usuario_id: string }>(`select usuario_id from ${tabela} order by 1`)).map(
        (l) => l.usuario_id,
      );

    it('tem RLS ativa e FORCE', async () => {
      expect(
        await consultar(
          'select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass',
          [`public.${tabela}`],
        ),
      ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    });

    it('o profissional só enxerga as próprias linhas', async () => {
      expect(await comoRole(banco.cliente, 'evolucao_app', visiveis, A)).toEqual([A]);
      expect(await comoRole(banco.cliente, 'evolucao_app', visiveis, B)).toEqual([B]);
    });

    it('sem usuário na transação, nenhuma linha (nem para owner)', async () => {
      expect(await comoRole(banco.cliente, 'evolucao_app', visiveis)).toEqual([]);
      expect(await comoRole(banco.cliente, 'evolucao_owner', visiveis)).toEqual([]);
    });

    it('evolucao_backup_ro lê todas as linhas e não escreve', async () => {
      expect(await comoRole(banco.cliente, 'evolucao_backup_ro', visiveis)).toEqual([A, B]);
      const [privilegios] = await consultar<Record<string, boolean>>(
        `select has_table_privilege('evolucao_backup_ro', $1, 'INSERT') as insert,
              has_table_privilege('evolucao_backup_ro', $1, 'UPDATE') as update`,
        [tabela],
      );
      expect(privilegios).toEqual({ insert: false, update: false });
    });

    it('a app não tem DELETE nem TRUNCATE', async () => {
      const [privilegios] = await consultar<Record<string, boolean>>(
        `select has_table_privilege('evolucao_app', $1, 'DELETE') as delete,
              has_table_privilege('evolucao_app', $1, 'TRUNCATE') as truncate`,
        [tabela],
      );
      expect(privilegios).toEqual({ delete: false, truncate: false });
    });
  },
);

describe('assinatura: o profissional cria só a própria', () => {
  it('a app grava a assinatura do usuário da transação e não a de outro', async () => {
    const C = '33333333-3333-4333-8333-333333333333';
    await banco.cliente.query(
      "insert into usuario (id, email, nome) values ($1, 'c@exemplo.com', 'C')",
      [C],
    );
    const inserir = (dono: string, usuarioDaTransacao: string) =>
      comoRole(
        banco.cliente,
        'evolucao_app',
        () =>
          codigoDoErro(() =>
            banco.cliente.query(
              "insert into assinatura (usuario_id, plano, status, periodo_fim) values ($1, 'pro', 'trial', now())",
              [dono],
            ),
          ),
        usuarioDaTransacao,
      );
    expect(await inserir(C, C)).toBeNull();
    expect(await inserir(C, A)).toBe(SEM_PERMISSAO_OU_RLS);
  });
});
