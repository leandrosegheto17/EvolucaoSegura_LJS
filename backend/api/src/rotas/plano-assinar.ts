import {
  PROBLEMA_ASSINATURA_ESTADO,
  PROBLEMA_COBRANCA_INDISPONIVEL,
  RESPOSTA_ASSINAR,
  esquemaAssinarEntrada,
} from '@es/contrato/plano';
import { Hono } from 'hono';
import { sql } from 'kysely';
import { lerCorpo } from '../http.ts';
import type { ClienteAsaas } from '../integracoes/asaas.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';

// PLANO-05, PLANO-12: POST /api/plano/assinar, rota autenticada. Sem equivalente no legado.
// - Corpo: nome e CPF/CNPJ (validado pelo dígito verificador no contrato); inválido = 422
//   `validacao`, sem chamar o Asaas.
// - Só em trial e free (decisão do usuário, 2026-10-27); ativa, atrasada e cancelada = 409.
//   PREMISSA: 409 também sem assinatura e em trial que já tem assinatura no Asaas.
// - Cria no Asaas o cliente e a assinatura mensal de 1990 centavos por Pix, com o primeiro
//   vencimento hoje em America/Sao_Paulo (relógio do banco; decisão do usuário). PREMISSA: o
//   cliente é criado a cada assinatura, com o nome e o CPF/CNPJ informados agora.
// - Asaas fora, lento ou sem configuração: 503 `cobranca_indisponivel`, sem gravar nada (PLANO-12);
//   o erro vai ao Sentry (só tipo e status, sem dado do profissional).
// - Depois grava os ids pela função public.gravar_ids_asaas (migration 0013) e audita
//   assinatura.solicitada só com os nomes dos campos. O estado não muda: o webhook de pagamento
//   leva a ativa (PLANO-08). Responde 201 e o Pix aparece em "Meu plano" (T134).

const PODE_ASSINAR = ['trial', 'free'] as const;

export interface OpcoesPlanoAssinar {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
  capturarErro: (erro: unknown) => void;
}

export const rotasPlanoAssinar = ({ asaas, capturarErro }: OpcoesPlanoAssinar) =>
  new Hono<AmbienteAutenticado>().post('/plano/assinar', ...autenticada, async (c) => {
    const leitura = await lerCorpo(c, esquemaAssinarEntrada);
    if (!leitura.ok) return leitura.resposta;
    const { nome, cpf_cnpj } = leitura.dados;
    const { trx, usuarioId } = c.var;

    const atual = await trx
      .selectFrom('assinatura')
      .select(['status', 'asaas_subscription_id'])
      .where('usuario_id', '=', usuarioId)
      .executeTakeFirst();
    const permitido =
      atual !== undefined &&
      (PODE_ASSINAR as readonly string[]).includes(atual.status) &&
      !(atual.status === 'trial' && atual.asaas_subscription_id !== null);
    if (!permitido)
      return c.json(PROBLEMA_ASSINATURA_ESTADO, 409, {
        'Content-Type': 'application/problem+json',
      });

    const { hoje } = await sql<{ hoje: string }>`
      select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as hoje`
      .execute(trx)
      .then((r) => r.rows[0]!);

    let ids: { cliente: string; assinatura: string };
    try {
      const cliente = asaas(c.env);
      const criado = await cliente.criarCliente({ nome, cpfCnpj: cpf_cnpj });
      const assinatura = await cliente.criarAssinatura({
        clienteId: criado.id,
        primeiroVencimento: hoje,
      });
      ids = { cliente: criado.id, assinatura: assinatura.id };
    } catch (erro) {
      capturarErro(erro);
      return c.json(PROBLEMA_COBRANCA_INDISPONIVEL, 503, {
        'Content-Type': 'application/problem+json',
      });
    }

    await sql`select public.gravar_ids_asaas(${ids.cliente}, ${ids.assinatura})`.execute(trx);
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'assinatura.solicitada',
      alvoTipo: 'conta',
      alvoId: usuarioId,
      camposAlterados: ['asaas_customer_id', 'asaas_subscription_id'],
      ip: c.req.header('CF-Connecting-IP') ?? null,
      userAgent: c.req.header('User-Agent') ?? null,
    });
    return c.json(RESPOSTA_ASSINAR, 201);
  });
