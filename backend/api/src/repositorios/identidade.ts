import { sql } from 'kysely';
import type { Banco, Trx } from '../db.ts';

// Acesso às tabelas de identidade (migration 0003) pela role app. Hash e conferência de senha só
// pelas funções do banco, com a senha como parâmetro (AUTH-12, OPS-14). Datas pelo relógio do
// banco (now()).

export type TipoToken = Banco['token_email']['tipo'];

export interface UsuarioEncontrado {
  id: string;
  nome: string;
  confirmado: boolean;
}

// Cria o usuário pendente se o e-mail é novo; se já existe, devolve a linha travada (FOR UPDATE),
// para dois cadastros simultâneos do mesmo e-mail não se atropelarem.
export async function criarOuTravarUsuario(
  trx: Trx,
  email: string,
  nome: string,
): Promise<{ novo: boolean; usuario: UsuarioEncontrado }> {
  const criado = await trx
    .insertInto('usuario')
    .values({ email, nome })
    .onConflict((oc) => oc.column('email').doNothing())
    .returning(['id', 'nome'])
    .executeTakeFirst();
  if (criado) return { novo: true, usuario: { ...criado, confirmado: false } };
  const existente = await trx
    .selectFrom('usuario')
    .select(['id', 'nome', 'confirmado_em'])
    .where('email', '=', email)
    .forUpdate()
    .executeTakeFirstOrThrow();
  return {
    novo: false,
    usuario: {
      id: existente.id,
      nome: existente.nome,
      confirmado: existente.confirmado_em !== null,
    },
  };
}

export async function trocarNome(trx: Trx, usuarioId: string, nome: string): Promise<void> {
  await trx.updateTable('usuario').set({ nome }).where('id', '=', usuarioId).execute();
}

export async function definirSenha(trx: Trx, usuarioId: string, senha: string): Promise<void> {
  await sql`select definir_senha(${usuarioId}, ${senha})`.execute(trx);
}

// AUTH-02: devolve o id se a senha confere; sem conta, o banco calcula um hash de mesmo custo.
export async function conferirSenha(
  trx: Trx,
  email: string,
  senha: string,
): Promise<string | null> {
  const { rows } = await sql<{ id: string | null }>`
    select conferir_senha(${email}, ${senha}) as id`.execute(trx);
  return rows[0]?.id ?? null;
}

// Invalida os tokens ainda abertos (não usados nem invalidados) do tipo.
export async function invalidarTokens(trx: Trx, usuarioId: string, tipo: TipoToken): Promise<void> {
  await trx
    .updateTable('token_email')
    .set({ invalidado_em: sql<Date>`now()` })
    .where('usuario_id', '=', usuarioId)
    .where('tipo', '=', tipo)
    .where('usado_em', 'is', null)
    .where('invalidado_em', 'is', null)
    .execute();
}

export async function criarTokenEmail(
  trx: Trx,
  entrada: { usuarioId: string; tipo: TipoToken; hash: Buffer; validadeMinutos: number },
): Promise<void> {
  await trx
    .insertInto('token_email')
    .values({
      usuario_id: entrada.usuarioId,
      tipo: entrada.tipo,
      token_hash: entrada.hash,
      expira_em: sql<Date>`now() + make_interval(mins => ${entrada.validadeMinutos})`,
    })
    .execute();
}
