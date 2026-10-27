import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaLimpeza } from '../../src/tarefas/limpeza.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, emailUnico } from '../apoio.ts';

// T139 / CAD-03, AUTH-09: a tarefa do cron marca como vencidos os tokens de e-mail e as sessões
// antigos pela função tarefas.vencer_tokens_e_sessoes (migration 0016), sem DELETE pela app.
// Critérios: registros vencidos deixam de valer; registros válidos intactos; reexecução é
// inofensiva.
// Isolamento no banco de teste compartilhado: os registros daqui são de 1999 e a tarefa roda com
// `agora` em 1999; os dos outros arquivos (datas de hoje) nunca são vencidos por ela.

const AGORA = new Date('1999-07-01T12:00:00.000Z');
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const antes = (ms: number) => new Date(AGORA.getTime() - ms);
const depois = (ms: number) => new Date(AGORA.getTime() + ms);

const ctx = (agora = AGORA): ContextoTarefa => ({
  agora,
  desde: null,
  limite: 10,
  env,
  emSegundoPlano: () => {},
  capturarErro: () => {},
});

const rodar = (agora = AGORA) => tarefaLimpeza().executar(ctx(agora));

const hashAleatorio = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32)));

async function usuario(): Promise<string> {
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [emailUnico('limpeza')],
  );
  return u!.id;
}

async function token(usuarioId: string, expira: Date): Promise<string> {
  const [t] = await comoAdmin<{ id: string }>(
    `insert into token_email (usuario_id, tipo, token_hash, criado_em, expira_em)
     values ($1, 'recuperacao', $2, $3, $4) returning id`,
    [usuarioId, hashAleatorio(), antes(HORA), expira],
  );
  return t!.id;
}

async function sessao(usuarioId: string, criada: Date, uso: Date): Promise<string> {
  const [s] = await comoAdmin<{ id: string }>(
    `insert into sessao (usuario_id, token_hash, criada_em, ultimo_uso_em)
     values ($1, $2, $3, $4) returning id`,
    [usuarioId, hashAleatorio(), criada, uso],
  );
  return s!.id;
}

const linhaToken = async (id: string) =>
  (await comoAdmin('select usado_em, invalidado_em from token_email where id = $1', [id]))[0];
const linhaSessao = async (id: string) =>
  (await comoAdmin('select ultimo_uso_em, encerrada_em from sessao where id = $1', [id]))[0];

describe('limpeza de tokens e sessões vencidos (CAD-03, AUTH-09)', () => {
  it('registros vencidos deixam de valer (marcados, não apagados)', async () => {
    const u = await usuario();
    const t = await token(u, antes(1));
    const ociosa = await sessao(u, antes(HORA), antes(15 * MINUTO));
    const longa = await sessao(u, antes(12 * HORA), antes(MINUTO));

    await rodar();

    expect(await linhaToken(t)).toEqual({ usado_em: null, invalidado_em: AGORA });
    expect(await linhaSessao(ociosa)).toMatchObject({ encerrada_em: AGORA });
    expect(await linhaSessao(longa)).toMatchObject({ encerrada_em: AGORA });
  });

  it('registros válidos ficam intactos', async () => {
    const u = await usuario();
    const t = await token(u, depois(1));
    const s = await sessao(u, antes(HORA), antes(15 * MINUTO - 1));
    const antesDe = [await linhaToken(t), await linhaSessao(s)];

    await rodar();

    expect([await linhaToken(t), await linhaSessao(s)]).toEqual(antesDe);
    expect(antesDe[0]).toEqual({ usado_em: null, invalidado_em: null });
    expect(antesDe[1]).toMatchObject({ encerrada_em: null });
  });

  it('reexecução é inofensiva: nada muda na segunda vez', async () => {
    const u = await usuario();
    const t = await token(u, antes(1));
    const s = await sessao(u, antes(HORA), antes(20 * MINUTO));
    await rodar();
    const depoisDaPrimeira = [await linhaToken(t), await linhaSessao(s)];

    await rodar(depois(MINUTO));

    expect([await linhaToken(t), await linhaSessao(s)]).toEqual(depoisDaPrimeira);
  });

  it('está registrada no despachante por último, sem janela', () => {
    expect(TAREFAS.at(-1)?.nome).toBe('limpeza');
    expect(TAREFAS.at(-1)?.janelaMs).toBeNull();
  });
});
