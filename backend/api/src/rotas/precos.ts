import {
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  PROBLEMA_VERSAO_PRECO,
  type PrecoPaciente,
  type PrecoSessao,
  esquemaPrecoEntrada,
} from '@es/contrato/financeiro';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { centavos, pacienteExiste, sessaoExiste } from '../repositorios/financeiro.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// FIN-01, FIN-02, FIN-08, ISO-02: preço por paciente e ajuste por sessão, rotas autenticadas.
// Adaptado de PriceService e price.repository.ts do legado, em centavos (ADR-007).
// - GET /api/pacientes/:id/preco e /api/sessoes/:id/preco: o preço vigente; sem preço, 404.
// - PUT: sem preço, cria (row_version ausente); com preço, edita com o row_version lido. Criar
//   com versão, editar sem ela ou com versão divergente = 409 versao_divergente, sem gravar
//   (decisão do usuário de 2026-10-26; o legado aceitava editar sem versão).
// - O mesmo valor: 200 sem subir a versão nem auditar. Mudança de fato: o trigger da migration
//   0010 grava a revisão antes/depois e a rota audita preco_paciente.definido (alvo paciente) ou
//   preco_sessao.ajustado (alvo agendamento) só com o nome do campo (FIN-08).
// - Paciente ou sessão inexistente, de outro profissional ou com id malformado: 404 (ISO-02).
// - PREMISSA: paciente inativo também tem preço editável (D-20). Não há rota de exclusão.

interface Escopo {
  tabela: 'preco_paciente' | 'preco_sessao';
  existe: (trx: Trx, usuarioId: string, id: string) => Promise<boolean>;
  acao: 'preco_paciente.definido' | 'preco_sessao.ajustado';
  alvo: 'paciente' | 'agendamento';
  resposta: (id: string, linha: LinhaPreco) => PrecoPaciente | PrecoSessao;
}

interface LinhaPreco {
  valor_centavos: string;
  row_version: number;
  criado_em: Date;
}

const corpo = (linha: LinhaPreco) => ({
  valor: centavos(linha.valor_centavos),
  row_version: linha.row_version,
  criado_em: linha.criado_em.toISOString(),
});

const PACIENTE: Escopo = {
  tabela: 'preco_paciente',
  existe: pacienteExiste,
  acao: 'preco_paciente.definido',
  alvo: 'paciente',
  resposta: (id, linha) => ({ paciente_id: id, ...corpo(linha) }),
};

const SESSAO: Escopo = {
  tabela: 'preco_sessao',
  existe: sessaoExiste,
  acao: 'preco_sessao.ajustado',
  alvo: 'agendamento',
  resposta: (id, linha) => ({ sessao_id: id, ...corpo(linha) }),
};

const COLUNAS = ['valor_centavos', 'row_version', 'criado_em'] as const;

// Preço do dono; o filtro pela chave fica num where cru porque a coluna muda com a tabela.
function lerPreco(trx: Trx, escopo: Escopo, usuarioId: string, id: string, travar = false) {
  const chave = escopo.tabela === 'preco_paciente' ? 'paciente_id' : 'sessao_id';
  const consulta = trx
    .selectFrom(escopo.tabela)
    .select(COLUNAS)
    .where('usuario_id', '=', usuarioId)
    .where(sql.ref(chave), '=', id);
  return (travar ? consulta.forUpdate() : consulta).executeTakeFirst();
}

async function ler(c: Context<AmbienteAutenticado>, escopo: Escopo): Promise<Response> {
  const { trx, usuarioId } = c.var;
  const id = c.req.param('id')!;
  if (!idValido(id)) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
  const linha = await lerPreco(trx, escopo, usuarioId, id);
  if (!linha) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
  return c.json(escopo.resposta(id, linha));
}

async function definir(c: Context<AmbienteAutenticado>, escopo: Escopo): Promise<Response> {
  const { trx, usuarioId } = c.var;
  const id = c.req.param('id')!;
  if (!idValido(id)) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
  const leitura = await lerCorpo(c, esquemaPrecoEntrada);
  if (!leitura.ok) return leitura.resposta;
  const dados = leitura.dados;
  if (!(await escopo.existe(trx, usuarioId, id)))
    return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);

  const atual = await lerPreco(trx, escopo, usuarioId, id, true);
  let gravado: LinhaPreco | undefined;
  if (!atual) {
    if (dados.row_version !== undefined) return responderProblema(c, PROBLEMA_VERSAO_PRECO);
    const chave = escopo.tabela === 'preco_paciente' ? { paciente_id: id } : { sessao_id: id };
    gravado = await trx
      .insertInto(escopo.tabela)
      .values({ usuario_id: usuarioId, valor_centavos: dados.valor, ...chave } as never)
      .onConflict((oc) => oc.doNothing())
      .returning(COLUNAS)
      .executeTakeFirst();
    // Outra requisição criou no meio do caminho: a versão lida já não vale.
    if (!gravado) return responderProblema(c, PROBLEMA_VERSAO_PRECO);
  } else {
    if (dados.row_version !== atual.row_version) return responderProblema(c, PROBLEMA_VERSAO_PRECO);
    if (centavos(atual.valor_centavos) === dados.valor) return c.json(escopo.resposta(id, atual));
    const chave = escopo.tabela === 'preco_paciente' ? 'paciente_id' : 'sessao_id';
    gravado = await trx
      .updateTable(escopo.tabela)
      .set({
        valor_centavos: dados.valor,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('usuario_id', '=', usuarioId)
      .where(sql.ref(chave), '=', id)
      .returning(COLUNAS)
      .executeTakeFirstOrThrow();
  }
  await registrarAuditoria(trx, {
    usuarioId,
    ator: usuarioId,
    acao: escopo.acao,
    alvoTipo: escopo.alvo,
    alvoId: id,
    camposAlterados: ['valor'],
    ip: c.req.header('CF-Connecting-IP') ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
  });
  return c.json(escopo.resposta(id, gravado));
}

export const rotasPrecos = new Hono<AmbienteAutenticado>()
  .get('/pacientes/:id/preco', ...autenticada, (c) => ler(c, PACIENTE))
  .put('/pacientes/:id/preco', ...autenticada, (c) => definir(c, PACIENTE))
  .get('/sessoes/:id/preco', ...autenticada, (c) => ler(c, SESSAO))
  .put('/sessoes/:id/preco', ...autenticada, (c) => definir(c, SESSAO));
