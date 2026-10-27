import { estadoPorTempo } from '@es/dominio/plano/assinatura';
import { type Trx, comTransacao, definirUsuarioDaTransacao } from '../db.ts';
import { type ClienteAsaas, ErroAsaas } from '../integracoes/asaas.ts';
import {
  type AssinaturaVencida,
  desvincularAssinaturaAsaas,
  listarAssinaturasVencidas,
  mudarEstadoAssinatura,
} from '../repositorios/assinatura.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import type { Tarefa } from './despachar.ts';

// PLANO-04, PLANO-10, PLANO-11 (T137): tarefa do cron que leva a free as assinaturas cujo tempo
// acabou, pelas regras da T125 (estadoPorTempo), sem apagar nem bloquear dado do profissional.
// - Lista as vencidas por tarefas.listar_assinaturas_vencidas (0015), até o lote da execução
//   (ADR-010); sem janela: o que sobrar fica para a execução seguinte.
// - Cada assinatura vai numa transação própria: erro numa (ex.: Asaas fora) vai ao Sentry e não
//   impede as outras.
// - Na transação, relê a linha pela RLS do profissional e confere de novo com estadoPorTempo; só
//   então muda para free por tarefas.mudar_estado_assinatura (linha travada). Se outra coisa mudou
//   o estado no meio (ex.: o webhook de pagamento levou a ativa), a transição não é permitida e
//   nada acontece.
// - Atrasada (PLANO-10): depois de mudar para free, cancela a assinatura no Asaas (DELETE
//   /subscriptions/{id}) e limpa o asaas_subscription_id (decisão do usuário, 2026-10-27), na
//   mesma transação. Falha do Asaas desfaz tudo: o estado fica atrasada, o id fica, e a execução
//   seguinte tenta de novo.
//   PREMISSA: 404 do Asaas = a assinatura já não existe lá (cancelada numa execução anterior cuja
//   transação não chegou a gravar); conta como cancelada.
// - Trial e cancelada não chamam o Asaas (a cancelada já foi cancelada lá pela rota, T132).
// - Reexecução: a assinatura já em free não aparece na lista; se aparecer de novo por corrida, a
//   mudança devolve 'mesmo_estado' e nada se repete (Asaas, id, auditoria).
// - Audita assinatura.free (ator sistema) só com os nomes dos campos.

export const NOME_TAREFA_ASSINATURAS = 'assinaturas';

export interface DependenciasAssinaturas {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
}

async function levarAFree(
  trx: Trx,
  vencida: AssinaturaVencida,
  agora: Date,
  asaas: () => ClienteAsaas,
): Promise<void> {
  const usuarioId = vencida.usuario_id;
  await definirUsuarioDaTransacao(trx, usuarioId);
  const atual = await trx
    .selectFrom('assinatura')
    .select(['status', 'periodo_fim', 'vencimento_atraso', 'asaas_subscription_id'])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!atual || atual.status === 'free' || estadoPorTempo(atual, agora) !== 'free') return;

  const { resultado, status_anterior } = await mudarEstadoAssinatura(trx, usuarioId, 'free');
  if (resultado !== 'permitida') return;

  const campos = ['status', 'plano'];
  if (status_anterior === 'atrasada') {
    campos.push('vencimento_atraso');
    if (atual.asaas_subscription_id !== null) {
      try {
        await asaas().cancelarAssinatura(atual.asaas_subscription_id);
      } catch (erro) {
        const jaNaoExiste =
          erro instanceof ErroAsaas && erro.tipo === 'falha' && erro.status === 404;
        if (!jaNaoExiste) throw erro;
      }
      if ((await desvincularAssinaturaAsaas(trx, usuarioId)) === 'desvinculada')
        campos.push('asaas_subscription_id');
    }
  }

  await registrarAuditoria(trx, {
    usuarioId,
    ator: 'sistema',
    acao: 'assinatura.free',
    alvoTipo: 'conta',
    alvoId: usuarioId,
    camposAlterados: campos,
  });
}

export function tarefaAssinaturas({ asaas }: DependenciasAssinaturas): Tarefa {
  return {
    nome: NOME_TAREFA_ASSINATURAS,
    janelaMs: null,
    async executar({ agora, limite, env, capturarErro }) {
      const vencidas = await comTransacao(env, null, (trx) =>
        listarAssinaturasVencidas(trx, agora, limite),
      );
      for (const vencida of vencidas) {
        try {
          await comTransacao(env, null, (trx) => levarAFree(trx, vencida, agora, () => asaas(env)));
        } catch (erro) {
          capturarErro(erro);
        }
      }
    },
  };
}
