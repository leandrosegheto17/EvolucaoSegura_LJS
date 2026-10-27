import {
  PROBLEMA_ASSINATURA_ESTADO,
  PROBLEMA_COBRANCA_INDISPONIVEL,
  type RespostaCancelar,
} from '@es/contrato/plano';
import { Hono } from 'hono';
import type { ClienteAsaas } from '../integracoes/asaas.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { mudarEstadoAssinatura } from '../repositorios/assinatura.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// PLANO-11, PLANO-12: POST /api/plano/cancelar, rota autenticada. Sem equivalente no legado.
// - Só em ativa (decisão do usuário, 2026-10-27); os demais estados respondem 409. PREMISSA: 409
//   também em ativa sem assinatura no Asaas (não acontece pelo fluxo de assinar).
// - Cancela no Asaas primeiro. Asaas fora, lento ou sem configuração: 503 `cobranca_indisponivel`
//   sem mudar o estado local (PLANO-12); o erro vai ao Sentry.
// - Depois muda para cancelada por tarefas.mudar_estado_assinatura (mantém periodo_fim: o Pro
//   segue até lá, PLANO-02, e o cron leva a free depois dele, T137). Se a assinatura mudou de
//   estado entre a leitura e a mudança (webhook simultâneo), responde 409.
// - Audita assinatura.cancelada só com o nome do campo; responde 200 com o estado e periodo_fim.

export interface OpcoesPlanoCancelar {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
  capturarErro: (erro: unknown) => void;
}

export const rotasPlanoCancelar = ({ asaas, capturarErro }: OpcoesPlanoCancelar) =>
  new Hono<AmbienteAutenticado>().post('/plano/cancelar', ...autenticada, async (c) => {
    const { trx, usuarioId } = c.var;
    const conflito = () =>
      c.json(PROBLEMA_ASSINATURA_ESTADO, 409, { 'Content-Type': 'application/problem+json' });

    const atual = await trx
      .selectFrom('assinatura')
      .select(['status', 'asaas_subscription_id', 'periodo_fim'])
      .where('usuario_id', '=', usuarioId)
      .executeTakeFirst();
    if (atual?.status !== 'ativa' || atual.asaas_subscription_id === null) return conflito();

    try {
      await asaas(c.env).cancelarAssinatura(atual.asaas_subscription_id);
    } catch (erro) {
      capturarErro(erro);
      return c.json(PROBLEMA_COBRANCA_INDISPONIVEL, 503, {
        'Content-Type': 'application/problem+json',
      });
    }

    const { resultado } = await mudarEstadoAssinatura(trx, usuarioId, 'cancelada');
    if (resultado !== 'permitida') return conflito();
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'assinatura.cancelada',
      alvoTipo: 'conta',
      alvoId: usuarioId,
      camposAlterados: ['status'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    const resposta: RespostaCancelar = {
      status: 'cancelada',
      periodo_fim: atual.periodo_fim.toISOString(),
    };
    return c.json(resposta);
  });
