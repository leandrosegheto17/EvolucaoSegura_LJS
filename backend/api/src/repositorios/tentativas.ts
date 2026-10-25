import { type EstadoFalhas, ESTADO_SEM_FALHAS } from '@es/dominio/identidade/regras-acesso';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { hashDoToken } from '../tokens.ts';

// AUTH-07: estado das falhas de login em tentativa_login, uma linha por e-mail e uma por IP,
// achadas pelo SHA-256 da chave (o e-mail nunca é gravado). As regras ficam no domínio
// (regras-acesso.ts); aqui só ler com trava e gravar.

export type TipoTentativa = 'email' | 'ip';

export interface ChaveTentativa {
  tipo: TipoTentativa;
  hash: Buffer;
}

export async function chaveTentativa(tipo: TipoTentativa, valor: string): Promise<ChaveTentativa> {
  return { tipo, hash: await hashDoToken(valor) };
}

// Relógio do banco: o mesmo now() da transação, que grava as datas.
export async function agoraDoBanco(trx: Trx): Promise<Date> {
  const { rows } = await sql<{ agora: Date }>`select now() as agora`.execute(trx);
  return rows[0]!.agora;
}

// Garante a linha e a trava (FOR UPDATE) até o fim da transação: duas falhas simultâneas da mesma
// chave contam as duas. Chamar sempre na mesma ordem (e-mail, depois IP) evita deadlock.
export async function travarTentativa(trx: Trx, chave: ChaveTentativa): Promise<EstadoFalhas> {
  await trx
    .insertInto('tentativa_login')
    .values({ tipo: chave.tipo, chave_hash: chave.hash })
    .onConflict((oc) => oc.columns(['tipo', 'chave_hash']).doNothing())
    .execute();
  const linha = await trx
    .selectFrom('tentativa_login')
    .select(['falhas', 'janela_inicio', 'bloqueado_ate'])
    .where('tipo', '=', chave.tipo)
    .where('chave_hash', '=', chave.hash)
    .forUpdate()
    .executeTakeFirst();
  if (!linha) return ESTADO_SEM_FALHAS;
  return {
    falhas: linha.falhas,
    janelaInicio: linha.janela_inicio,
    bloqueadoAte: linha.bloqueado_ate,
  };
}

export async function gravarTentativa(
  trx: Trx,
  chave: ChaveTentativa,
  estado: EstadoFalhas,
): Promise<void> {
  await trx
    .updateTable('tentativa_login')
    .set({
      falhas: estado.falhas,
      janela_inicio: estado.janelaInicio,
      bloqueado_ate: estado.bloqueadoAte,
    })
    .where('tipo', '=', chave.tipo)
    .where('chave_hash', '=', chave.hash)
    .execute();
}
