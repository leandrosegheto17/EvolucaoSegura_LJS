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

// CAD-03, CAD-05: consome o token (uso único) se ele é do tipo pedido, não foi usado nem
// invalidado e ainda vale (no instante exato de expira_em já não vale). O UPDATE ... RETURNING é
// atômico: de dois pedidos simultâneos com o mesmo token, só um recebe o usuário.
export async function consumirToken(
  trx: Trx,
  hash: Buffer,
  tipo: TipoToken,
): Promise<string | null> {
  const linha = await trx
    .updateTable('token_email')
    .set({ usado_em: sql<Date>`now()` })
    .where('token_hash', '=', hash)
    .where('tipo', '=', tipo)
    .where('usado_em', 'is', null)
    .where('invalidado_em', 'is', null)
    .where('expira_em', '>', sql<Date>`now()`)
    .returning('usuario_id')
    .executeTakeFirst();
  return linha?.usuario_id ?? null;
}

// Marca a conta como confirmada; false se ela já estava confirmada.
export async function confirmarConta(trx: Trx, usuarioId: string): Promise<boolean> {
  const linha = await trx
    .updateTable('usuario')
    .set({ confirmado_em: sql<Date>`now()` })
    .where('id', '=', usuarioId)
    .where('confirmado_em', 'is', null)
    .returning('id')
    .executeTakeFirst();
  return linha !== undefined;
}

// AUTH-02, CAD-09: só entra conta confirmada e não bloqueada para exclusão.
export async function contaPodeEntrar(trx: Trx, usuarioId: string): Promise<boolean> {
  const linha = await trx
    .selectFrom('usuario')
    .select('id')
    .where('id', '=', usuarioId)
    .where('confirmado_em', 'is not', null)
    .where('bloqueado_exclusao_em', 'is', null)
    .executeTakeFirst();
  return linha !== undefined;
}

// AUTH-03: abre um desafio 2FA novo e invalida os anteriores ainda abertos (um código válido por
// vez). A validade conta pelo relógio do banco.
export async function abrirDesafio2fa(
  trx: Trx,
  entrada: { usuarioId: string; hmac: Buffer; validadeMinutos: number },
): Promise<void> {
  await trx
    .updateTable('desafio_2fa')
    .set({ invalidado_em: sql<Date>`now()` })
    .where('usuario_id', '=', entrada.usuarioId)
    .where('usado_em', 'is', null)
    .where('invalidado_em', 'is', null)
    .execute();
  await trx
    .insertInto('desafio_2fa')
    .values({
      usuario_id: entrada.usuarioId,
      codigo_hmac: entrada.hmac,
      expira_em: sql<Date>`now() + make_interval(mins => ${entrada.validadeMinutos})`,
    })
    .execute();
}

export async function registrarAceite(
  trx: Trx,
  entrada: { usuarioId: string; versaoTermos: string; versaoPrivacidade: string },
): Promise<void> {
  await trx
    .insertInto('aceite_termos')
    .values({
      usuario_id: entrada.usuarioId,
      versao_termos: entrada.versaoTermos,
      versao_privacidade: entrada.versaoPrivacidade,
    })
    .execute();
}

export async function usuarioIdPorEmail(trx: Trx, email: string): Promise<string | null> {
  const linha = await trx
    .selectFrom('usuario')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  return linha?.id ?? null;
}

export interface DesafioAberto {
  id: string;
  codigoHmac: Buffer;
  erros: number;
  criadoEm: Date;
}

// AUTH-03, AUTH-05: o desafio mais recente do usuário que ainda vale (não usado, não invalidado e
// dentro da validade pelo relógio do banco), travado até o fim da transação.
export async function travarDesafioAberto(
  trx: Trx,
  usuarioId: string,
): Promise<DesafioAberto | null> {
  const linha = await trx
    .selectFrom('desafio_2fa')
    .select(['id', 'codigo_hmac', 'erros', 'criado_em'])
    .where('usuario_id', '=', usuarioId)
    .where('usado_em', 'is', null)
    .where('invalidado_em', 'is', null)
    .where('expira_em', '>', sql<Date>`now()`)
    .orderBy('criado_em', 'desc')
    .limit(1)
    .forUpdate()
    .executeTakeFirst();
  if (!linha) return null;
  return {
    id: linha.id,
    codigoHmac: linha.codigo_hmac,
    erros: linha.erros,
    criadoEm: linha.criado_em,
  };
}

export async function registrarErro2fa(
  trx: Trx,
  desafioId: string,
  resultado: { erros: number; invalidado: boolean },
): Promise<void> {
  await trx
    .updateTable('desafio_2fa')
    .set({
      erros: resultado.erros,
      ...(resultado.invalidado ? { invalidado_em: sql<Date>`now()` } : {}),
    })
    .where('id', '=', desafioId)
    .execute();
}

export async function marcarDesafioUsado(trx: Trx, desafioId: string): Promise<void> {
  await trx
    .updateTable('desafio_2fa')
    .set({ usado_em: sql<Date>`now()` })
    .where('id', '=', desafioId)
    .execute();
}

// AUTH-09: a sessão guarda só o SHA-256 do id do cookie.
export async function criarSessao(trx: Trx, usuarioId: string, hash: Buffer): Promise<string> {
  const linha = await trx
    .insertInto('sessao')
    .values({ usuario_id: usuarioId, token_hash: hash })
    .returning('id')
    .executeTakeFirstOrThrow();
  return linha.id;
}

// Encerrar é UPDATE de data (a app não apaga). Sessão já encerrada fica como está.
export async function encerrarSessaoPorHash(trx: Trx, hash: Buffer): Promise<void> {
  await trx
    .updateTable('sessao')
    .set({ encerrada_em: sql<Date>`now()` })
    .where('token_hash', '=', hash)
    .where('encerrada_em', 'is', null)
    .execute();
}

// AUTH-14: encerra (UPDATE de data, sem DELETE) todas as sessões ainda abertas do profissional.
export async function encerrarSessoesDoUsuario(trx: Trx, usuarioId: string): Promise<void> {
  await trx
    .updateTable('sessao')
    .set({ encerrada_em: sql<Date>`now()` })
    .where('usuario_id', '=', usuarioId)
    .where('encerrada_em', 'is', null)
    .execute();
}
