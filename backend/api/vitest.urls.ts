// URLs do Postgres dos testes da API. Local: docker-compose (5433 no host, ou PG_PORTA). CI: DATABASE_URL
// aponta para o serviço (5432). DATABASE_URL só diz qual servidor usar: os testes rodam num banco
// TEMPORÁRIO, criado pelo globalSetup (test/preparar-banco.ts) e apagado no fim da execução.
// A URL da role evolucao_app troca só usuário e senha (ver test/preparar-banco.ts).
// O padrão usa 127.0.0.1, não localhost: no Windows o localhost resolve primeiro para IPv6 e a
// conexão ao Postgres do docker-compose expira sem mensagem (T207). PG_PORTA troca só a porta.
export function portaPg(env: Record<string, string | undefined>): string {
  const porta = env['PG_PORTA'] || '5433';
  const n = Number(porta);
  if (!/^\d+$/.test(porta) || n < 1 || n > 65535)
    throw new Error(`PG_PORTA inválida: ${JSON.stringify(porta)} (use um número de 1 a 65535)`);
  return porta;
}

export function urlServidorDe(env: Record<string, string | undefined>): string {
  return (
    env['DATABASE_URL'] ?? `postgres://postgres:postgres@127.0.0.1:${portaPg(env)}/evolucao_segura`
  );
}

export const urlServidorTeste = urlServidorDe(process.env);

// Um nome por execução. O config do Vitest e o globalSetup rodam no mesmo processo, mas cada um
// pode carregar este módulo de novo: o nome fica no process.env para os dois verem o mesmo.
const CHAVE_NOME = 'ES_API_BANCO_TEMPORARIO';
export const nomeBancoTemporario =
  process.env[CHAVE_NOME] ?? `es_api_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
process.env[CHAVE_NOME] = nomeBancoTemporario;

export function urlComBanco(url: string, banco: string): string {
  const copia = new URL(url);
  copia.pathname = `/${banco}`;
  return copia.toString();
}

export const urlBancoAdmin = urlComBanco(urlServidorTeste, nomeBancoTemporario);

const url = new URL(urlBancoAdmin);
url.username = 'evolucao_app';
url.password = 'evolucao_app';
export const urlBancoApp = url.toString();
