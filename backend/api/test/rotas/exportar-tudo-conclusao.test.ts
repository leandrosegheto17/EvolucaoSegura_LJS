import { type PaginaExportacao, TABELAS_EXPORTACAO } from '@es/contrato/exportacao';
import { describe, expect, it } from 'vitest';
import { SENHA_DE_TESTE, comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T173 / EXP-03, EXP-06: a exportação completa não traz credenciais nem sessões, e a conclusão
// é auditada como exportacao.concluida (alvo exportação, sem conteúdo) só ao servir a última
// página, a que vem com proximo_cursor null.

const LENTO = { timeout: 60_000 };

async function proxima(sessao: Sessao, cursor: string | null) {
  const consulta = new URLSearchParams({ limite: '5' });
  if (cursor !== null) consulta.set('cursor', cursor);
  const resposta = await pedir('GET', `/api/exportacao?${consulta}`, sessao);
  expect(resposta.status).toBe(200);
  const texto = await resposta.text();
  return { texto, pagina: JSON.parse(texto) as PaginaExportacao };
}

const concluidas = (usuarioId: string) => auditoriaDe(usuarioId, 'exportacao.concluida');

describe('sem credenciais nem sessões no corpo (EXP-03)', LENTO, () => {
  it('nenhuma página traz o hash da senha, a sessão, o 2FA ou os tokens de e-mail', async () => {
    const s = await sessaoDeTeste();
    const u = s.usuarioId;
    await semearPaciente(u);
    await comoAdmin('select definir_senha($1, $2)', [u, SENHA_DE_TESTE]);
    await comoAdmin(
      `insert into desafio_2fa (usuario_id, codigo_hmac, expira_em)
       values ($1, gen_random_bytes(32), now() + interval '10 minutes')`,
      [u],
    );
    await comoAdmin(
      `insert into token_email (usuario_id, tipo, token_hash, expira_em)
       values ($1, 'recuperacao', gen_random_bytes(32), now() + interval '1 hour')`,
      [u],
    );
    const segredos = (
      await comoAdmin<{ valor: string }>(
        `select hash as valor from credencial_senha where usuario_id = $1
         union all select encode(token_hash, 'hex') from sessao where usuario_id = $1
         union all select id::text from sessao where usuario_id = $1
         union all select encode(codigo_hmac, 'hex') from desafio_2fa where usuario_id = $1
         union all select encode(token_hash, 'hex') from token_email where usuario_id = $1`,
        [u],
      )
    ).map((r) => r.valor);
    expect(segredos).toHaveLength(5);

    let corpo = '';
    const tabelas = new Set<string>();
    let cursor: string | null = null;
    do {
      const { texto, pagina } = await proxima(s, cursor);
      corpo += texto;
      tabelas.add(pagina.tabela);
      cursor = pagina.proximo_cursor;
    } while (cursor !== null);

    expect([...tabelas]).toEqual([...TABELAS_EXPORTACAO]);
    for (const proibida of ['usuario', 'credencial_senha', 'sessao', 'desafio_2fa', 'token_email'])
      expect(tabelas.has(proibida)).toBe(false);
    for (const segredo of segredos) expect(corpo).not.toContain(segredo);
    expect(corpo).not.toContain(SENHA_DE_TESTE);
    expect(corpo).not.toContain(s.cookie.split('=')[1]!);
    for (const campo of ['"hash"', '"token_hash"', '"codigo_hmac"'])
      expect(corpo).not.toContain(campo);
  });
});

describe('auditoria da conclusão (EXP-06)', LENTO, () => {
  it('audita exportacao.concluida só ao servir a última página, alvo exportação e sem conteúdo', async () => {
    const s = await sessaoDeTeste();
    await semearPaciente(s.usuarioId, { nome: 'Nome Sigiloso Do Paciente' });
    let cursor: string | null = null;
    let paginas = 0;
    do {
      expect(await concluidas(s.usuarioId)).toEqual([]);
      const { pagina } = await proxima(s, cursor);
      cursor = pagina.proximo_cursor;
      paginas += 1;
    } while (cursor !== null);
    expect(paginas).toBeGreaterThan(1);
    expect(await concluidas(s.usuarioId)).toEqual([
      {
        usuario_id: s.usuarioId,
        ator: s.usuarioId,
        acao: 'exportacao.concluida',
        alvo_tipo: 'exportacao',
        alvo_id: null,
        campos_alterados: [],
        origem_ua: 'Mozilla/5',
      },
    ]);
  });

  it('cada exportação concluída gera um evento próprio', async () => {
    const s = await sessaoDeTeste();
    for (let vez = 0; vez < 2; vez++) {
      let cursor: string | null = null;
      do cursor = (await proxima(s, cursor)).pagina.proximo_cursor;
      while (cursor !== null);
    }
    expect(await concluidas(s.usuarioId)).toHaveLength(2);
  });
});
