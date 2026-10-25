// URLs do Postgres dos testes da API. Local: docker-compose (5433 no host). CI: DATABASE_URL
// aponta para o serviço (5432). A URL da role app troca só usuário e senha (ver test/preparar-banco.ts).
export const urlBancoAdmin =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/evolucao_segura';

const url = new URL(urlBancoAdmin);
url.username = 'app';
url.password = 'app';
export const urlBancoApp = url.toString();
