import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BancoDeTeste, codigoDoErro, comoRole, criarBancoMigrado } from './banco.ts';

// T140 / PUSH-01, PUSH-02, ISO-01, ISO-03, ISO-04: migration 0017 cria as tabelas do push.
// - push_subscription: a assinatura de push de cada dispositivo (PUSH-01), com endpoint único
//   (design: "endpoint único, chaves"). Desativar remove a linha, então a app apaga (ISO-03 só
//   proíbe DELETE em dado clínico, financeiro e de auditoria).
// - notificacao_enviada: registro do que já foi enviado, único por tipo e referência (design) do
//   profissional; é o que garante "uma única vez" (PUSH-02 a PUSH-04): duplicar o envio viola a
//   restrição. A app só grava e lê; não apaga nem altera (apagar abriria um reenvio).
// - As duas têm usuario_id e RLS forçada (entram no harness de isolamento); evolucao_backup_ro lê tudo.

const SEM_PERMISSAO_OU_RLS = '42501';
const VIOLA_UNICIDADE = '23505';
const VIOLA_CHECK = '23514';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

let banco: BancoDeTeste;

beforeAll(async () => {
  banco = await criarBancoMigrado('m0017');
  await banco.cliente.query(
    `insert into usuario (id, email, nome) values ($1, 'a@exemplo.com', 'A'), ($2, 'b@exemplo.com', 'B')`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth)
     values ($1, 'https://push.exemplo.com/a', 'chaveA', 'authA'),
            ($2, 'https://push.exemplo.com/b', 'chaveB', 'authB')`,
    [A, B],
  );
  await banco.cliente.query(
    `insert into notificacao_enviada (usuario_id, tipo, ref)
     values ($1, 'sessao_proxima', 'semente'), ($2, 'sessao_proxima', 'semente')`,
    [A, B],
  );
}, 60_000);

afterAll(async () => {
  await banco?.apagar();
});

const consultar = async <T>(sql: string, parametros: unknown[] = []): Promise<T[]> =>
  (await banco.cliente.query(sql, parametros)).rows as T[];

const comoApp = <T>(usuario: string | undefined, fn: () => Promise<T>) =>
  comoRole(banco.cliente, 'evolucao_app', fn, usuario);

const registrarEnvio = (usuario: string, tipo: string, ref: string) =>
  banco.cliente.query(
    `insert into notificacao_enviada (usuario_id, tipo, ref) values ($1, $2, $3)`,
    [usuario, tipo, ref],
  );

const inscrever = (usuario: string, endpoint: string, p256dh = 'chave', auth = 'auth') =>
  banco.cliente.query(
    `insert into push_subscription (usuario_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)`,
    [usuario, endpoint, p256dh, auth],
  );

describe('notificacao_enviada: uma vez por tipo e referência (PUSH-02 a PUSH-04)', () => {
  it('duplicar o envio (mesmo profissional, tipo e referência) viola a restrição', async () => {
    const codigo = await comoApp(A, async () => {
      await registrarEnvio(A, 'sessao_proxima', 'sessao-1');
      return codigoDoErro(() => registrarEnvio(A, 'sessao_proxima', 'sessao-1'));
    });
    expect(codigo).toBe(VIOLA_UNICIDADE);
  });

  it('a duplicata não grava segunda linha', async () => {
    await banco.cliente.query('begin');
    try {
      await banco.cliente.query("select set_config('app.usuario_id', $1, true)", [A]);
      await banco.cliente.query('set local role evolucao_app');
      await registrarEnvio(A, 'evolucao_pendente', '2026-11-10');
      await banco.cliente.query('savepoint duplicata');
      expect(await codigoDoErro(() => registrarEnvio(A, 'evolucao_pendente', '2026-11-10'))).toBe(
        VIOLA_UNICIDADE,
      );
      await banco.cliente.query('rollback to savepoint duplicata');
      expect(
        await consultar(
          `select count(*)::int as n from notificacao_enviada
           where tipo = 'evolucao_pendente' and ref = '2026-11-10'`,
        ),
      ).toEqual([{ n: 1 }]);
    } finally {
      await banco.cliente.query('rollback');
    }
  });

  it('outro tipo com a mesma referência é outro envio', async () => {
    const codigo = await comoApp(A, async () => {
      await registrarEnvio(A, 'cobranca_gerada', 'pay_1');
      return codigoDoErro(() => registrarEnvio(A, 'pagamento_confirmado', 'pay_1'));
    });
    expect(codigo).toBeNull();
  });

  it('a mesma referência de outro profissional é outro envio (ex.: o mesmo dia)', async () => {
    await registrarEnvio(A, 'evolucao_pendente', '2026-11-11');
    try {
      expect(
        await comoApp(B, () =>
          codigoDoErro(() => registrarEnvio(B, 'evolucao_pendente', '2026-11-11')),
        ),
      ).toBeNull();
    } finally {
      await banco.cliente.query(`delete from notificacao_enviada where ref = '2026-11-11'`);
    }
  });

  it('aceita só os tipos de push da spec e referência de 1 a 200 caracteres', async () => {
    for (const tipo of [
      'sessao_proxima',
      'evolucao_pendente',
      'cobranca_gerada',
      'pagamento_confirmado',
      'cobranca_vencida',
      'trial_terminando',
    ])
      expect(
        await comoApp(A, () => codigoDoErro(() => registrarEnvio(A, tipo, 'ref-tipo'))),
        tipo,
      ).toBeNull();
    expect(await comoApp(A, () => codigoDoErro(() => registrarEnvio(A, 'outro', 'ref')))).toBe(
      VIOLA_CHECK,
    );
    for (const ref of ['', 'x'.repeat(201)])
      expect(
        await comoApp(A, () => codigoDoErro(() => registrarEnvio(A, 'sessao_proxima', ref))),
        `ref de ${ref.length}`,
      ).toBe(VIOLA_CHECK);
  });

  it('a app só grava e lê: sem UPDATE, DELETE nem TRUNCATE (não reabre um envio)', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', 'notificacao_enviada', 'SELECT') as select,
              has_table_privilege('evolucao_app', 'notificacao_enviada', 'INSERT') as insert,
              has_any_column_privilege('evolucao_app', 'notificacao_enviada', 'UPDATE') as update,
              has_table_privilege('evolucao_app', 'notificacao_enviada', 'DELETE') as delete,
              has_table_privilege('evolucao_app', 'notificacao_enviada', 'TRUNCATE') as truncate`,
    );
    expect(privilegios).toEqual({
      select: true,
      insert: true,
      update: false,
      delete: false,
      truncate: false,
    });
    expect(
      await comoApp(A, () =>
        codigoDoErro(() =>
          banco.cliente.query(`delete from notificacao_enviada where usuario_id = $1`, [A]),
        ),
      ),
    ).toBe(SEM_PERMISSAO_OU_RLS);
  });
});

describe('push_subscription: assinatura por dispositivo (PUSH-01)', () => {
  it('o profissional guarda a assinatura do dispositivo', async () => {
    const linhas = await comoApp(A, async () => {
      await inscrever(A, 'https://fcm.googleapis.com/fcm/send/abc', 'BNcR-p256dh_x', 'a1B2_c3-');
      return consultar(
        `select usuario_id, endpoint, p256dh, auth from push_subscription
         where endpoint = 'https://fcm.googleapis.com/fcm/send/abc'`,
      );
    });
    expect(linhas).toEqual([
      {
        usuario_id: A,
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        p256dh: 'BNcR-p256dh_x',
        auth: 'a1B2_c3-',
      },
    ]);
  });

  it('o endpoint é único: o mesmo endpoint não entra duas vezes', async () => {
    expect(
      await comoApp(A, async () => {
        await inscrever(A, 'https://push.exemplo.com/repetido');
        return codigoDoErro(() => inscrever(A, 'https://push.exemplo.com/repetido'));
      }),
    ).toBe(VIOLA_UNICIDADE);
    // Nem para outro profissional (o superusuário vê a linha de A; B não a vê).
    await inscrever(A, 'https://push.exemplo.com/de-a');
    try {
      expect(
        await comoApp(B, () => codigoDoErro(() => inscrever(B, 'https://push.exemplo.com/de-a'))),
      ).toBe(VIOLA_UNICIDADE);
    } finally {
      await banco.cliente.query(
        `delete from push_subscription where endpoint = 'https://push.exemplo.com/de-a'`,
      );
    }
  });

  it('desativar remove: a app apaga a própria assinatura', async () => {
    const restantes = await comoApp(A, async () => {
      await inscrever(A, 'https://push.exemplo.com/remover');
      const { rowCount } = await banco.cliente.query(
        `delete from push_subscription where endpoint = 'https://push.exemplo.com/remover'`,
      );
      expect(rowCount).toBe(1);
      return consultar(
        `select 1 from push_subscription where endpoint = 'https://push.exemplo.com/remover'`,
      );
    });
    expect(restantes).toEqual([]);
  });

  it('a app só atualiza as chaves, nunca o dono nem o endpoint; sem TRUNCATE', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_app', 'push_subscription', 'SELECT') as select,
              has_table_privilege('evolucao_app', 'push_subscription', 'INSERT') as insert,
              has_table_privilege('evolucao_app', 'push_subscription', 'DELETE') as delete,
              has_table_privilege('evolucao_app', 'push_subscription', 'TRUNCATE') as truncate,
              has_column_privilege('evolucao_app', 'push_subscription', 'p256dh', 'UPDATE') as p256dh,
              has_column_privilege('evolucao_app', 'push_subscription', 'auth', 'UPDATE') as auth,
              has_column_privilege('evolucao_app', 'push_subscription', 'usuario_id', 'UPDATE') as dono,
              has_column_privilege('evolucao_app', 'push_subscription', 'endpoint', 'UPDATE') as endpoint`,
    );
    expect(privilegios).toEqual({
      select: true,
      insert: true,
      delete: true,
      truncate: false,
      p256dh: true,
      auth: true,
      dono: false,
      endpoint: false,
    });
  });

  it('recusa endpoint que não é https e chaves fora de base64url', async () => {
    for (const endpoint of ['http://push.exemplo.com/x', 'push.exemplo.com', '', 'https://']) {
      expect(await comoApp(A, () => codigoDoErro(() => inscrever(A, endpoint))), endpoint).toBe(
        VIOLA_CHECK,
      );
    }
    expect(
      await comoApp(A, () =>
        codigoDoErro(() => inscrever(A, `https://push.exemplo.com/${'x'.repeat(2048)}`)),
      ),
    ).toBe(VIOLA_CHECK);
    for (const [p256dh, auth] of [
      ['', 'auth'],
      ['chave', ''],
      ['com espaço', 'auth'],
      ['chave', 'a+b/'],
    ])
      expect(
        await comoApp(A, () =>
          codigoDoErro(() => inscrever(A, 'https://push.exemplo.com/chaves', p256dh, auth)),
        ),
        `${p256dh}|${auth}`,
      ).toBe(VIOLA_CHECK);
  });
});

describe('RLS forçada e isolamento (ISO-01, ISO-04)', () => {
  it.each([['push_subscription'], ['notificacao_enviada']])(
    '%s tem RLS ativa e FORCE',
    async (tabela) => {
      expect(
        await consultar(
          `select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`,
          [`public.${tabela}`],
        ),
      ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    },
  );

  it.each([['push_subscription'], ['notificacao_enviada']])(
    '%s: cada profissional só enxerga as próprias linhas',
    async (tabela) => {
      const coluna = tabela === 'push_subscription' ? 'endpoint' : 'ref';
      const visiveis = async () =>
        (
          await consultar<{ usuario_id: string }>(
            `select usuario_id from ${tabela} where ${coluna} in
               ('https://push.exemplo.com/a', 'https://push.exemplo.com/b', 'semente')
             order by 1`,
          )
        ).map((l) => l.usuario_id);
      expect(await comoApp(A, visiveis)).toEqual([A]);
      expect(await comoApp(B, visiveis)).toEqual([B]);
      expect(await comoApp(undefined, visiveis)).toEqual([]);
      expect(await comoRole(banco.cliente, 'evolucao_owner', visiveis)).toEqual([]);
      expect(await comoRole(banco.cliente, 'evolucao_backup_ro', visiveis)).toEqual([A, B]);
    },
  );

  it('B não apaga a assinatura de A (zero linhas)', async () => {
    const apagadas = await comoApp(B, async () => {
      const { rowCount } = await banco.cliente.query(
        `delete from push_subscription where usuario_id = $1`,
        [A],
      );
      return rowCount;
    });
    expect(apagadas).toBe(0);
    expect(
      await consultar(`select count(*)::int as n from push_subscription where usuario_id = $1`, [
        A,
      ]),
    ).toEqual([{ n: 1 }]);
  });

  it.each([
    [
      'push_subscription',
      `insert into push_subscription (usuario_id, endpoint, p256dh, auth)
       values ($1, 'https://push.exemplo.com/forjada', 'c', 'a')`,
    ],
    [
      'notificacao_enviada',
      `insert into notificacao_enviada (usuario_id, tipo, ref) values ($1, 'sessao_proxima', 'forjada')`,
    ],
  ])('B não grava em %s em nome de A', async (_tabela, comando) => {
    expect(await comoApp(B, () => codigoDoErro(() => banco.cliente.query(comando, [A])))).toBe(
      SEM_PERMISSAO_OU_RLS,
    );
  });

  it('evolucao_backup_ro só lê', async () => {
    const [privilegios] = await consultar<Record<string, boolean>>(
      `select has_table_privilege('evolucao_backup_ro', 'push_subscription', 'INSERT, UPDATE, DELETE') as push,
              has_table_privilege('evolucao_backup_ro', 'notificacao_enviada', 'INSERT, UPDATE, DELETE') as notif`,
    );
    expect(privilegios).toEqual({ push: false, notif: false });
  });
});
