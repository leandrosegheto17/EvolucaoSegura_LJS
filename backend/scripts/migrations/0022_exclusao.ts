import type { MigrationBuilder } from 'node-pg-migrate';

// 0022_exclusao (T148; CONTA-03, CONTA-05). Exclusão de conta.
// - O bloqueio e os tokens já vêm da 0003: usuario.bloqueado_exclusao_em (a app grava e limpa;
//   preenchido, o login é recusado, AUTH-02) e token_email com os tipos 'exclusao' (link de
//   confirmação, CONTA-02) e 'desistencia' (link de desistência, CONTA-04). Esta migration não
//   repete nada disso; acrescenta só o índice com que a purga (T152) acha as contas bloqueadas.
// - public.conta_excluida (CONTA-05): o único rastro que fica depois da purga. Só o id da conta
//   apagada (sem chave estrangeira: a linha de usuario deixa de existir), a data do pedido e a data
//   da purga. Nenhum dado pessoal: sem e-mail, nome, IP ou qualquer texto. Sem usuario_id (não é
//   tabela do profissional: o harness de isolamento não a alcança e ela não entra na exportação).
// - Quem grava é a função de purga (T152, SECURITY DEFINER do owner): a app não tem privilégio
//   algum aqui; backup_ro só lê.
// Sem função nesta migration (e sem SET app.* na definição de função): roda no Neon com o
// neondb_owner sem superusuário.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.conta_excluida (
  id uuid PRIMARY KEY,
  pedido_em timestamptz NOT NULL,
  purgado_em timestamptz NOT NULL,
  CHECK (purgado_em >= pedido_em)
);
ALTER TABLE public.conta_excluida OWNER TO "owner";
REVOKE ALL ON public.conta_excluida FROM PUBLIC, app;
GRANT SELECT ON public.conta_excluida TO backup_ro;

-- Contas bloqueadas para exclusão, pela data da confirmação (a purga vem 30 dias depois).
CREATE INDEX usuario_bloqueado_exclusao_idx ON public.usuario (bloqueado_exclusao_em)
  WHERE bloqueado_exclusao_em IS NOT NULL;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP INDEX IF EXISTS public.usuario_bloqueado_exclusao_idx;
DROP TABLE IF EXISTS public.conta_excluida;
`);
};
