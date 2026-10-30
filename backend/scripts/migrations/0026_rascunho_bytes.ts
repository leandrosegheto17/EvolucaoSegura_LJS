import type { MigrationBuilder } from 'node-pg-migrate';

// 0026_rascunho_bytes (T219; RAS-05, SEC-007). Teto de 25 MiB somados nos rascunhos de cada
// profissional (decisão do usuário, 2026-10-30). A API mede o payload como no limite de 512 KiB
// (bytes UTF-8 do JSON enviado) e grava a medida em `rascunho.bytes`, para somar sem ler os
// payloads e sem a diferença do texto do jsonb (que acrescenta espaços).
// - bytes: inteiro >= 0. As linhas que já existiam recebem octet_length(payload::text), que é
//   um pouco maior que a medida da API (a troca por um payload igual fica aceita, por ser menor
//   ou igual). Fica sem NOT NULL: linha gravada sem a coluna (só em teste, como superusuário)
//   conta pelo mesmo octet_length na soma da API.
// - A app grava a coluna no INSERT e no UPDATE (os privilégios por coluna da 0009 não a cobrem).
// - Quem migra no Neon (neondb_owner) não é dono da tabela e não herda os privilégios do
//   evolucao_owner (só SET, pela 0001): a alteração roda como o owner (SET LOCAL ROLE). O owner
//   está sob a RLS forçada da tabela, que esconderia as linhas no preenchimento: a RLS forçada é
//   desligada só durante o UPDATE, na mesma transação, e religada logo depois.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
SET LOCAL ROLE "evolucao_owner";
ALTER TABLE public.rascunho ADD COLUMN bytes integer CHECK (bytes >= 0);
ALTER TABLE public.rascunho NO FORCE ROW LEVEL SECURITY;
UPDATE public.rascunho SET bytes = octet_length(payload::text);
ALTER TABLE public.rascunho FORCE ROW LEVEL SECURITY;
GRANT INSERT (bytes), UPDATE (bytes) ON public.rascunho TO evolucao_app;
RESET ROLE;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
SET LOCAL ROLE "evolucao_owner";
ALTER TABLE public.rascunho DROP COLUMN IF EXISTS bytes;
RESET ROLE;
`);
};
