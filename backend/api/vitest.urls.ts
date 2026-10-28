// URLs do Postgres dos testes da API. Local: docker-compose (5433 no host). CI: DATABASE_URL
// aponta para o serviço (5432). DATABASE_URL só diz qual servidor usar: os testes rodam num banco
// TEMPORÁRIO, criado pelo globalSetup (test/preparar-banco.ts) e apagado no fim da execução.
// A URL da role app troca só usuário e senha (ver test/preparar-banco.ts).
export const urlServidorTeste =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';

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
url.username = 'app';
url.password = 'app';
export const urlBancoApp = url.toString();
