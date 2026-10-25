import { env } from 'cloudflare:workers';
import pg from 'pg';
import type { ClienteEmail, MensagemEmail } from '../src/integracoes/resend.ts';

// Apoio dos testes das rotas: consultas como superusuário (HYPERDRIVE_ADMIN, só nos testes, para
// semear e conferir o que a app não vê), e-mail simulado e IP novo por requisição (o limite por
// IP da T43 vale também nos testes).

const admin = (env as unknown as { HYPERDRIVE_ADMIN: Hyperdrive }).HYPERDRIVE_ADMIN;

export async function comoAdmin<T extends pg.QueryResultRow>(
  consulta: string,
  parametros: unknown[] = [],
): Promise<T[]> {
  const cliente = new pg.Client({ connectionString: admin.connectionString });
  cliente.on('error', () => {});
  await cliente.connect();
  try {
    return (await cliente.query<T>(consulta, parametros)).rows;
  } finally {
    await cliente.end();
  }
}

let ipSequencial = 0;
export function novoIp(): string {
  ipSequencial += 1;
  return `203.0.${Math.floor(ipSequencial / 250)}.${(ipSequencial % 250) + 1}`;
}

export const emailUnico = (prefixo = 'pessoa'): string =>
  `${prefixo}-${crypto.randomUUID().slice(0, 8)}@exemplo.com.br`;

// Guarda as mensagens "enviadas"; `falhar` faz o próximo envio lançar o erro dado.
export function emailSimulado() {
  const enviadas: MensagemEmail[] = [];
  let erro: unknown = null;
  const cliente: ClienteEmail = {
    async enviar(mensagem) {
      if (erro !== null) throw erro;
      enviadas.push(mensagem);
    },
  };
  return {
    cliente,
    enviadas,
    falhar: (e: unknown) => {
      erro = e;
    },
  };
}

export async function sha256(texto: string): Promise<Buffer> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

// IP que nunca se repete entre execuções: o bloqueio por falhas (tentativa_login) fica no banco
// de teste, que não é zerado, e novoIp() recomeça a sequência em cada arquivo.
export function ipUnico(): string {
  const grupos = Array.from(crypto.getRandomValues(new Uint16Array(6)), (g) => g.toString(16));
  return `fd00:${grupos.join(':')}:1`;
}

export const SENHA_DE_TESTE = 'cavalo-bateria-grampo-7';

// Conta semeada pelo superusuário, com a senha gravada pela função do banco (bcrypt 12).
export async function criarConta(
  opcoes: { email?: string; senha?: string; confirmada?: boolean; bloqueada?: boolean } = {},
): Promise<{ id: string; email: string; senha: string }> {
  const email = opcoes.email ?? emailUnico();
  const senha = opcoes.senha ?? SENHA_DE_TESTE;
  const [linha] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em, bloqueado_exclusao_em)
     values ($1, 'Ana Souza', case when $2 then now() end, case when $3 then now() end)
     returning id`,
    [email, opcoes.confirmada ?? true, opcoes.bloqueada ?? false],
  );
  await comoAdmin('select definir_senha($1, $2)', [linha!.id, senha]);
  return { id: linha!.id, email, senha };
}
