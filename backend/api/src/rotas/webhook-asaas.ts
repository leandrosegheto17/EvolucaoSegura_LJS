import { Hono } from 'hono';
import { sql } from 'kysely';
import { type Trx, comTransacao } from '../db.ts';
import { responderProblema } from '../http.ts';
import type { ClienteAsaas } from '../integracoes/asaas.ts';
import { type EmailCobranca, mensagemDeCobranca } from '../integracoes/emails-cobranca.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';

// PLANO-06, PLANO-07: POST /api/webhooks/asaas, rota pública (sem sessão nem CSRF; limite próprio
// LIMITE_WEBHOOK). Formatos do spike S3.
// - O cabeçalho asaas-access-token é comparado em tempo constante com ASAAS_WEBHOOK_TOKEN. Sem o
//   cabeçalho, com outro valor ou sem o token configurado: 401, sem ler o corpo nem tocar o banco.
// - Numa transação só (decisão do usuário, 2026-10-27): grava o evento pela função
//   tarefas.gravar_webhook_evento (migration 0014), deduplicando pelo id inteiro do evento
//   (`evt_<hash>&<seq>`); repetido responde 200 sem efeito. Evento novo vai ao processador do
//   tipo (`event`, nunca o `status` do pagamento) e é marcado como processado com o profissional
//   achado. Tipo sem processador só é gravado e marcado (ex.: PAYMENT_CREATED).
// - Erro no processamento desfaz tudo, inclusive o registro do evento, e responde 500 (onError do
//   app, com Sentry) para o Asaas reenviar; o reenvio chega como evento novo.
// - PREMISSA: corpo sem `id` ou `event` em texto responde 422 `validacao` sem gravar nada.
// - PLANO-13 (T138): o processador pode pedir o e-mail de cobrança do evento (só quando mudou algo).
//   O destinatário é lido na mesma transação; o envio sai depois do COMMIT, em segundo plano, e a
//   falha vai ao Sentry sem desfazer nada. Evento repetido e erro (500) não enviam.
// - O reforço por payment.id + event sugerido no spike não é necessário: os processadores levam a
//   assinatura a um estado, e o mesmo estado de novo não muda nada (tarefas.mudar_estado_assinatura).

export interface EventoAsaas {
  id: string;
  event: string;
  payment?: { id?: unknown; subscription?: unknown; customer?: unknown; dueDate?: unknown };
  [chave: string]: unknown;
}

export interface ContextoWebhook {
  trx: Trx;
  evento: EventoAsaas;
  asaas: ClienteAsaas;
  // Registro do que foi ignorado (ex.: transição inválida), sem dado pessoal; vai ao Sentry.
  registrar: (aviso: AvisoWebhook) => void;
}

export class AvisoWebhook extends Error {
  readonly motivo: string;
  readonly detalhes: Readonly<Record<string, string>>;
  constructor(motivo: string, detalhes: Record<string, string>) {
    super(`Webhook do Asaas: ${motivo}`);
    this.name = 'AvisoWebhook';
    this.motivo = motivo;
    this.detalhes = detalhes;
  }
}

// Decisão do usuário (2026-10-27): assinatura não achada é erro (500) para o Asaas reenviar; cobre
// o webhook que chega antes de a criação gravar os ids (edge case da spec).
export class AssinaturaNaoAchada extends Error {
  constructor() {
    super('Webhook do Asaas: assinatura não achada');
    this.name = 'AssinaturaNaoAchada';
  }
}

// Devolve o profissional a quem o evento pertence (null quando não há um).
export type ProcessadorWebhook = (
  ctx: ContextoWebhook,
) => Promise<{ usuarioId: string | null; email?: EmailCobranca | null }>;

export interface OpcoesWebhookAsaas {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
  capturarErro: (erro: unknown) => void;
  processadores: Readonly<Record<string, ProcessadorWebhook>>;
  // null = e-mails de cobrança desligados (sem Resend configurado).
  email: (env: Cloudflare.Env) => ClienteEmail | null;
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
}

async function tokenConfere(recebido: string | undefined, esperado: string | undefined) {
  if (!recebido || !esperado) return false;
  // Resumo dos dois para comparar tamanhos iguais; a comparação em si é a do WebCrypto.
  const resumo = async (texto: string) =>
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  const [a, b] = await Promise.all([resumo(recebido), resumo(esperado)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function lerEvento(corpo: unknown): EventoAsaas | null {
  if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return null;
  const { id, event } = corpo as Record<string, unknown>;
  if (typeof id !== 'string' || id === '' || id.length > 100) return null;
  if (typeof event !== 'string' || event === '' || event.length > 100) return null;
  return corpo as EventoAsaas;
}

export const rotasWebhookAsaas = ({
  asaas,
  capturarErro,
  processadores,
  email,
  emSegundoPlano,
}: OpcoesWebhookAsaas) =>
  new Hono<{ Bindings: Cloudflare.Env }>().post('/webhooks/asaas', async (c) => {
    if (!(await tokenConfere(c.req.header('asaas-access-token'), c.env.ASAAS_WEBHOOK_TOKEN)))
      return responderProblema(c, 'credenciais_invalidas', 'Não autorizado');

    const evento = lerEvento(await c.req.json().catch(() => null));
    if (evento === null) return responderProblema(c, 'validacao', 'Dados inválidos');

    const resultado = await comTransacao(c.env, null, async (trx) => {
      const { rows } = await sql<{ r: 'novo' | 'repetido' }>`
        select tarefas.gravar_webhook_evento(${evento.id}, ${evento.event},
                                             ${JSON.stringify(evento)}::jsonb) as r`.execute(trx);
      if (rows[0]!.r === 'repetido') return { status: 'repetido' as const, mensagem: null };
      const processador = processadores[evento.event];
      const { usuarioId, email: pedido = null } = processador
        ? await processador({ trx, evento, asaas: asaas(c.env), registrar: capturarErro })
        : { usuarioId: null };
      await sql`select tarefas.marcar_webhook_processado(${evento.id}, ${usuarioId}::uuid)`.execute(
        trx,
      );
      let mensagem: MensagemEmail | null = null;
      if (pedido !== null && usuarioId !== null) {
        const usuario = await trx
          .selectFrom('usuario')
          .select('email')
          .where('id', '=', usuarioId)
          .executeTakeFirst();
        if (usuario) mensagem = mensagemDeCobranca(pedido, usuario.email, c.env.URL_PUBLICA);
      }
      return { status: 'processado' as const, mensagem };
    });

    const { mensagem } = resultado;
    if (mensagem !== null) {
      const envio = (async () => {
        try {
          const cliente = email(c.env);
          if (cliente !== null) await cliente.enviar(mensagem);
        } catch (erro) {
          capturarErro(erro);
        }
      })();
      emSegundoPlano(envio);
    }
    return c.json({ status: resultado.status });
  });
