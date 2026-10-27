import { env } from 'cloudflare:workers';
import { criarApp } from '../../src/app.ts';
import {
  type ClienteAsaas,
  type CobrancaAsaas,
  ErroAsaas,
  type QrPixAsaas,
} from '../../src/integracoes/asaas.ts';
import { comoAdmin, ipUnico, type sessaoDeTeste } from '../apoio.ts';

// Apoio dos testes das rotas do plano (T128, T132, T134): Asaas simulado que guarda as chamadas e pode
// falhar numa operação, assinatura semeada pelo superusuário e leitura da linha e da auditoria.

export type Sessao = Awaited<ReturnType<typeof sessaoDeTeste>>;
type Operacao = keyof ClienteAsaas;

export function asaasSimulado(
  opcoes: { proximoVencimento?: string; cobrancas?: CobrancaAsaas[]; qr?: QrPixAsaas } = {},
) {
  const chamadas: { operacao: Operacao; dados: unknown }[] = [];
  let falha: { operacao: Operacao; erro: unknown } | null = null;
  const sufixo = () => crypto.randomUUID().slice(0, 12);
  const registrar = (operacao: Operacao, dados: unknown) => {
    chamadas.push({ operacao, dados });
    if (falha?.operacao === operacao) throw falha.erro;
  };
  const cliente: ClienteAsaas = {
    async criarCliente(dados) {
      registrar('criarCliente', dados);
      return { id: `cus_${sufixo()}` };
    },
    async criarAssinatura(dados) {
      registrar('criarAssinatura', dados);
      return { id: `sub_${sufixo()}`, proximoVencimento: '2026-11-30' };
    },
    async obterAssinatura(assinaturaId) {
      registrar('obterAssinatura', assinaturaId);
      return { id: assinaturaId, proximoVencimento: opcoes.proximoVencimento ?? '2026-11-30' };
    },
    async listarCobrancas(assinaturaId) {
      registrar('listarCobrancas', assinaturaId);
      return opcoes.cobrancas ?? [];
    },
    async buscarQrPix(cobrancaId) {
      registrar('buscarQrPix', cobrancaId);
      return opcoes.qr ?? { imagemPngBase64: 'x', copiaECola: 'y', expiraEm: 'z' };
    },
    async cancelarAssinatura(assinaturaId) {
      registrar('cancelarAssinatura', assinaturaId);
    },
  };
  return {
    cliente,
    chamadas,
    falharEm: (operacao: Operacao, erro: unknown = new ErroAsaas('falha', 500)) => {
      falha = { operacao, erro };
    },
  };
}

export function appComAsaas(asaas: ClienteAsaas) {
  return criarApp({ capturarErro: () => {}, asaas: () => asaas });
}

export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0';

export function pedirPlano(
  app: ReturnType<typeof criarApp>,
  caminho: string,
  sessao: Sessao | null,
  corpo?: unknown,
) {
  return app.request(
    caminho,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': USER_AGENT,
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    },
    env,
  );
}

export type Estado = 'trial' | 'ativa' | 'atrasada' | 'cancelada' | 'free';

// Assinatura semeada pelo superusuário; ids do Asaas únicos quando pedidos.
export async function semearAssinatura(
  usuarioId: string,
  status: Estado,
  opcoes: { comAsaas?: boolean; periodoFim?: string; vencimentoAtraso?: string | null } = {},
): Promise<{ cliente: string | null; assinatura: string | null }> {
  const sufixo = crypto.randomUUID().slice(0, 12);
  const cliente = opcoes.comAsaas ? `cus_${sufixo}` : null;
  const assinatura = opcoes.comAsaas ? `sub_${sufixo}` : null;
  await comoAdmin(
    `insert into assinatura (usuario_id, plano, status, asaas_customer_id, asaas_subscription_id,
                             periodo_fim, vencimento_atraso, atualizado_em)
     values ($1, $2, $3, $4, $5, $6, $7, '2026-01-01T00:00:00Z')`,
    [
      usuarioId,
      status === 'free' ? 'free' : 'pro',
      status,
      cliente,
      assinatura,
      opcoes.periodoFim ?? '2026-11-10T03:00:00.000Z',
      opcoes.vencimentoAtraso ?? (status === 'atrasada' ? '2026-10-20T03:00:00.000Z' : null),
    ],
  );
  return { cliente, assinatura };
}

export const linhaAssinatura = async (usuarioId: string) =>
  (
    await comoAdmin<{
      plano: string;
      status: string;
      asaas_customer_id: string | null;
      asaas_subscription_id: string | null;
      periodo_fim: Date;
      vencimento_atraso: Date | null;
      atualizado_em: Date;
    }>(
      `select plano, status, asaas_customer_id, asaas_subscription_id, periodo_fim,
              vencimento_atraso, atualizado_em
       from assinatura where usuario_id = $1`,
      [usuarioId],
    )
  )[0];

export const auditoriaDe = (usuarioId: string, prefixo = 'assinatura.') =>
  comoAdmin<{
    ator: string;
    acao: string;
    alvo_tipo: string;
    alvo_id: string | null;
    campos_alterados: string[];
  }>(
    `select ator, acao, alvo_tipo, alvo_id, campos_alterados
     from audit_log where usuario_id = $1 and acao like $2 || '%' order by id`,
    [usuarioId, prefixo],
  );

// Hoje em America/Sao_Paulo (AAAA-MM-DD).
export const hojeEmSaoPaulo = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
