import {
  PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
  PROBLEMA_PAGAMENTO_DUPLICADO,
  PROBLEMA_PRECO_OBRIGATORIO,
  type Pagamento,
  esquemaPagamentoEntrada,
} from '@es/contrato/financeiro';
import { decidirPagamento, valorDoPagamento } from '@es/dominio/financeiro/debitos';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { centavos, precosDaSessao, sessaoExiste } from '../repositorios/financeiro.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// FIN-03, FIN-04, FIN-05, FIN-08, ISO-02: PUT /api/sessoes/:id/pagamento, rota autenticada.
// Adaptado de PaymentsService e payments.repository.ts do legado, em centavos (ADR-007).
// - Sem pagamento: cria (201). Valor ausente usa o ajuste de preço da sessão e, sem ele, o preço
//   do paciente; sem nenhum, 422 PRICE_REQUIRED (FIN-04).
//   SPEC_DEVIATION: a FIN-03 fala só do preço do paciente; o ajuste da sessão vem antes por decisão
//   do usuário (2026-10-26).
// - Com pagamento: sem confirmar_duplicidade, 422 PAYMENT_DUPLICATE; com ele, corrige (200), como
//   o legado: sem row_version, valor ausente mantém o anterior e a versão só sobe se algo mudou
//   (decisão do usuário de 2026-10-26). O trigger da migration 0010 grava a revisão.
// - Aceito em qualquer status da sessão (decisão do usuário: pagamento adiantado).
// - Auditoria pagamento.registrado e pagamento.corrigido (alvo pagamento), só com nomes de campo.
// - Sessão inexistente, de outro profissional ou com id malformado: 404 (ISO-02). Sem exclusão.

const COLUNAS = [
  'id',
  'sessao_id',
  'valor_centavos',
  sql<string>`to_char(data_pagamento, 'YYYY-MM-DD')`.as('data'),
  'meio',
  'row_version',
  'criado_em',
] as const;

interface LinhaPagamento {
  id: string;
  sessao_id: string;
  valor_centavos: string;
  data: string;
  meio: Pagamento['meio'];
  row_version: number;
  criado_em: Date;
}

const paraPagamento = (l: LinhaPagamento): Pagamento => ({
  id: l.id,
  sessao_id: l.sessao_id,
  valor: centavos(l.valor_centavos),
  data: l.data,
  meio: l.meio,
  row_version: l.row_version,
  criado_em: l.criado_em.toISOString(),
});

export const rotasPagamentos = new Hono<AmbienteAutenticado>().put(
  '/sessoes/:id/pagamento',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const sessaoId = c.req.param('id');
    if (!idValido(sessaoId)) return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);
    const leitura = await lerCorpo(c, esquemaPagamentoEntrada);
    if (!leitura.ok) return leitura.resposta;
    const dados = leitura.dados;
    if (!(await sessaoExiste(trx, usuarioId, sessaoId)))
      return responderProblema(c, PROBLEMA_FINANCEIRO_NAO_ENCONTRADO);

    const origem = {
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    };
    const atual = await trx
      .selectFrom('pagamento')
      .select(COLUNAS)
      .where('usuario_id', '=', usuarioId)
      .where('sessao_id', '=', sessaoId)
      .forUpdate()
      .executeTakeFirst();

    const decisao = decidirPagamento(atual !== undefined, dados.confirmar_duplicidade);
    if (decisao === 'PAYMENT_DUPLICATE') return responderProblema(c, PROBLEMA_PAGAMENTO_DUPLICADO);

    if (decisao === 'criar') {
      const { precoSessao, precoPaciente } = await precosDaSessao(trx, usuarioId, sessaoId);
      const valor = valorDoPagamento(dados.valor, precoSessao, precoPaciente);
      if (valor === 'PRICE_REQUIRED') return responderProblema(c, PROBLEMA_PRECO_OBRIGATORIO);
      const criado = await trx
        .insertInto('pagamento')
        .values({
          usuario_id: usuarioId,
          sessao_id: sessaoId,
          valor_centavos: valor,
          data_pagamento: dados.data,
          meio: dados.meio,
        })
        .onConflict((oc) => oc.doNothing())
        .returning(COLUNAS)
        .executeTakeFirst();
      // Outra requisição registrou o pagamento ao mesmo tempo: é o duplicado do FIN-05.
      if (!criado) return responderProblema(c, PROBLEMA_PAGAMENTO_DUPLICADO);
      await registrarAuditoria(trx, {
        usuarioId,
        ator: usuarioId,
        acao: 'pagamento.registrado',
        alvoTipo: 'pagamento',
        alvoId: criado.id,
        ...origem,
      });
      return c.json(paraPagamento(criado), 201);
    }

    const anterior = atual!;
    const valor = dados.valor ?? centavos(anterior.valor_centavos);
    const campos = [
      ...(valor !== centavos(anterior.valor_centavos) ? ['valor'] : []),
      ...(dados.data !== anterior.data ? ['data'] : []),
      ...(dados.meio !== anterior.meio ? ['meio'] : []),
    ];
    if (campos.length === 0) return c.json(paraPagamento(anterior));
    const corrigido = await trx
      .updateTable('pagamento')
      .set({
        valor_centavos: valor,
        data_pagamento: dados.data,
        meio: dados.meio,
        row_version: sql<number>`row_version + 1`,
        atualizado_em: sql<Date>`now()`,
      })
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', anterior.id)
      .returning(COLUNAS)
      .executeTakeFirstOrThrow();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'pagamento.corrigido',
      alvoTipo: 'pagamento',
      alvoId: corrigido.id,
      camposAlterados: campos,
      ...origem,
    });
    return c.json(paraPagamento(corrigido));
  },
);
