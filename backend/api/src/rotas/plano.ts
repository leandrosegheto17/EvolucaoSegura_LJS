import {
  PROBLEMA_COBRANCA_INDISPONIVEL,
  type PixPendente,
  type RespostaPlano,
} from '@es/contrato/plano';
import { TOLERANCIA_ATRASO_MS, estadoPorTempo } from '@es/dominio/plano/assinatura';
import { Hono } from 'hono';
import type { ClienteAsaas } from '../integracoes/asaas.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { type PlanoAtual, lerPlano } from '../middleware/plano.ts';

// PLANO-14, PLANO-05: GET /api/plano ("Meu plano"), rota autenticada. Sem equivalente no legado.
// - Plano e estado efetivos agora pelas regras da T125 (lerPlano do middleware de plano, com o
//   relógio do banco). Data: renovação em ativa (periodo_fim); fim em trial e cancelada
//   (periodo_fim) e em atrasada (vencimento + 7 dias, D-21); free sem data.
// - Pix: só com assinatura no Asaas e fora de cancelada (o cancelamento já encerrou a assinatura
//   lá, PLANO-11). Lista as cobranças da assinatura; a em aberto (PENDING ou OVERDUE; decisão do
//   usuário, 2026-10-27: a vencida também, para pagar na tolerância da D-21) de vencimento mais
//   antigo tem o QR buscado na hora. Nada do Asaas é gravado: a rota
//   não escreve no banco e a resposta sai com no-store (cabeçalhos do app).
// - Asaas fora, lento ou sem configuração: 503 `cobranca_indisponivel` e o erro vai ao Sentry.

const STATUS_EM_ABERTO: readonly string[] = ['PENDING', 'OVERDUE'];

export interface OpcoesPlano {
  asaas: (env: Cloudflare.Env) => ClienteAsaas;
  capturarErro: (erro: unknown) => void;
}

function dataDoPlano({ assinatura, agora }: PlanoAtual): RespostaPlano['data'] {
  if (!assinatura) return null;
  switch (estadoPorTempo(assinatura, agora)) {
    case 'ativa':
      return { tipo: 'renovacao', em: assinatura.periodo_fim.toISOString() };
    case 'trial':
    case 'cancelada':
      return { tipo: 'fim', em: assinatura.periodo_fim.toISOString() };
    case 'atrasada': {
      const vencimento = assinatura.vencimento_atraso ?? assinatura.periodo_fim;
      return {
        tipo: 'fim',
        em: new Date(vencimento.getTime() + TOLERANCIA_ATRASO_MS).toISOString(),
      };
    }
    default:
      return null;
  }
}

async function pixPendente(
  cliente: ClienteAsaas,
  assinaturaId: string,
): Promise<PixPendente | null> {
  const pendentes = (await cliente.listarCobrancas(assinaturaId))
    .filter((c) => STATUS_EM_ABERTO.includes(c.status))
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));
  const cobranca = pendentes[0];
  if (!cobranca) return null;
  const qr = await cliente.buscarQrPix(cobranca.id);
  return {
    valor_centavos: cobranca.valorCentavos,
    vencimento: cobranca.vencimento,
    copia_e_cola: qr.copiaECola,
    qr_code_png_base64: qr.imagemPngBase64,
    expira_em: qr.expiraEm,
  };
}

export const rotasPlano = ({ asaas, capturarErro }: OpcoesPlano) =>
  new Hono<AmbienteAutenticado>().get('/plano', ...autenticada, async (c) => {
    const atual = await lerPlano(c.var.trx, c.var.usuarioId);
    const status = atual.assinatura ? estadoPorTempo(atual.assinatura, atual.agora) : 'free';

    let pix: PixPendente | null = null;
    const assinaturaId = atual.assinatura?.asaas_subscription_id ?? null;
    if (assinaturaId !== null && status !== 'cancelada') {
      try {
        pix = await pixPendente(asaas(c.env), assinaturaId);
      } catch (erro) {
        capturarErro(erro);
        return c.json(PROBLEMA_COBRANCA_INDISPONIVEL, 503, {
          'Content-Type': 'application/problem+json',
        });
      }
    }

    const resposta: RespostaPlano = { plano: atual.plano, status, data: dataDoPlano(atual), pix };
    return c.json(resposta);
  });
