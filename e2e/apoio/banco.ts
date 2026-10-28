import pg from 'pg';
import { URL_BANCO_ADMIN } from './config.ts';

// OPS-05: leitura direta do banco do e2e (como superusuário, sem RLS), só para o que a interface
// não mostra, como o id da assinatura no Asaas que o webhook simulado precisa citar.
export async function consultar<T extends Record<string, unknown>>(
  texto: string,
  valores: unknown[] = [],
): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: URL_BANCO_ADMIN });
  await cliente.connect();
  try {
    return (await cliente.query<T>(texto, valores)).rows;
  } finally {
    await cliente.end();
  }
}

export async function idsAsaasDaConta(
  email: string,
): Promise<{ assinatura: string; cliente: string }> {
  const [linha] = await consultar<{ assinatura: string | null; cliente: string | null }>(
    `select a.asaas_subscription_id as assinatura, a.asaas_customer_id as cliente
       from assinatura a join usuario u on u.id = a.usuario_id
      where u.email = $1`,
    [email],
  );
  if (!linha?.assinatura || !linha.cliente) throw new Error('conta sem assinatura no Asaas');
  return { assinatura: linha.assinatura, cliente: linha.cliente };
}
