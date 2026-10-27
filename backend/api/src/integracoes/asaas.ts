// PLANO-05, PLANO-12: cliente do Asaas por fetch. Cria o cliente (nome e CPF/CNPJ) e a assinatura
// mensal do Pro de 1990 centavos por Pix, lista as cobranças da assinatura, busca o QR Code Pix de
// uma cobrança e cancela a assinatura. Formatos do spike S3 (.specs/spikes/asaas-sandbox):
// - autenticação pelo cabeçalho `access_token`; o `User-Agent` é obrigatório;
// - o valor vai em reais (19.9) e volta em reais; aqui tudo é centavos inteiros (ADR-007);
// - erro vem como HTTP 400 `{errors:[{code, description}]}`.
// O endpoint (sandbox ou produção) vem da variável ASAAS_BASE_URL. Falha HTTP, erro de rede,
// resposta fora do formato e tempo excedido viram ErroAsaas (erro tipado); quem chama responde
// 503 sem mudar o estado local (PLANO-12). O erro guarda só o status e os códigos do Asaas, nunca
// a descrição nem o corpo (podem ecoar nome ou CPF/CNPJ).
// PREMISSA: cancelar é DELETE /subscriptions/{id} (documentação do Asaas; o spike não o exercitou).

export const URLS_ASAAS = ['https://api-sandbox.asaas.com/v3', 'https://api.asaas.com/v3'] as const;
export type UrlAsaas = (typeof URLS_ASAAS)[number];

export const VALOR_PRO_CENTAVOS = 1990;
// PREMISSA: a spec pede tempo limite sem fixar o valor.
export const TEMPO_LIMITE_PADRAO_MS = 10_000;
const USER_AGENT = 'evolucao-segura/1.0';
const DESCRICAO_ASSINATURA = 'Evolução Segura Pro (mensal)';

export type TipoErroAsaas = 'falha' | 'rede' | 'tempo_excedido' | 'resposta_invalida';

export class ErroAsaas extends Error {
  readonly tipo: TipoErroAsaas;
  readonly status: number | null;
  readonly codigos: string[];
  constructor(tipo: TipoErroAsaas, status: number | null = null, codigos: string[] = []) {
    super(
      tipo === 'falha'
        ? `Asaas recusou a operação (HTTP ${status})`
        : tipo === 'tempo_excedido'
          ? 'Asaas excedeu o tempo limite'
          : tipo === 'rede'
            ? 'Asaas indisponível (erro de rede)'
            : 'Asaas respondeu fora do formato esperado',
    );
    this.name = 'ErroAsaas';
    this.tipo = tipo;
    this.status = status;
    this.codigos = codigos;
  }
}

export interface CobrancaAsaas {
  id: string;
  status: string;
  vencimento: string; // AAAA-MM-DD
  valorCentavos: number;
}

export interface QrPixAsaas {
  imagemPngBase64: string;
  copiaECola: string;
  expiraEm: string;
}

export interface ClienteAsaas {
  criarCliente(dados: { nome: string; cpfCnpj: string }): Promise<{ id: string }>;
  criarAssinatura(dados: {
    clienteId: string;
    primeiroVencimento: string; // AAAA-MM-DD
  }): Promise<{ id: string; proximoVencimento: string }>;
  listarCobrancas(assinaturaId: string): Promise<CobrancaAsaas[]>;
  buscarQrPix(cobrancaId: string): Promise<QrPixAsaas>;
  cancelarAssinatura(assinaturaId: string): Promise<void>;
}

export interface OpcoesAsaas {
  apiKey: string;
  baseUrl: string;
  fetch?: typeof fetch;
  tempoLimiteMs?: number;
}

type Json = Record<string, unknown>;

const texto = (valor: unknown): string => {
  if (typeof valor !== 'string' || valor === '') throw new ErroAsaas('resposta_invalida');
  return valor;
};

const centavos = (valor: unknown): number => {
  if (typeof valor !== 'number' || !Number.isFinite(valor))
    throw new ErroAsaas('resposta_invalida');
  return Math.round(valor * 100);
};

const objeto = (valor: unknown): Json => {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor))
    throw new ErroAsaas('resposta_invalida');
  return valor as Json;
};

function codigosDoErro(corpo: unknown): string[] {
  const erros = (corpo as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(erros)) return [];
  return erros
    .map((e) => (e as { code?: unknown } | null)?.code)
    .filter((c): c is string => typeof c === 'string');
}

export function criarClienteAsaas(opcoes: OpcoesAsaas): ClienteAsaas {
  if (!opcoes.apiKey) throw new Error('Asaas: chave ausente');
  if (!(URLS_ASAAS as readonly string[]).includes(opcoes.baseUrl))
    throw new Error('Asaas: endpoint fora do sandbox e da produção');
  const fetchFn = opcoes.fetch ?? fetch;
  const tempoLimite = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;

  async function chamar(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: Json) {
    const controle = new AbortController();
    let excedeu = false;
    const relogio = setTimeout(() => {
      excedeu = true;
      controle.abort();
    }, tempoLimite);
    try {
      let resposta: Response;
      let dados: unknown;
      try {
        resposta = await fetchFn(`${opcoes.baseUrl}${caminho}`, {
          method: metodo,
          headers: {
            access_token: opcoes.apiKey,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
          },
          ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
          signal: controle.signal,
        });
        dados = await resposta.json().catch(() => null);
      } catch {
        // A exceção original pode trazer a URL ou o corpo: não vai como causa.
        throw new ErroAsaas(excedeu ? 'tempo_excedido' : 'rede');
      }
      if (excedeu) throw new ErroAsaas('tempo_excedido');
      if (!resposta.ok) throw new ErroAsaas('falha', resposta.status, codigosDoErro(dados));
      return objeto(dados);
    } finally {
      clearTimeout(relogio);
    }
  }

  return {
    async criarCliente({ nome, cpfCnpj }) {
      const r = await chamar('POST', '/customers', { name: nome, cpfCnpj });
      return { id: texto(r['id']) };
    },

    async criarAssinatura({ clienteId, primeiroVencimento }) {
      const r = await chamar('POST', '/subscriptions', {
        customer: clienteId,
        billingType: 'PIX',
        value: VALOR_PRO_CENTAVOS / 100,
        cycle: 'MONTHLY',
        nextDueDate: primeiroVencimento,
        description: DESCRICAO_ASSINATURA,
      });
      // A resposta traz em nextDueDate o vencimento do ciclo seguinte (spike S3).
      return { id: texto(r['id']), proximoVencimento: texto(r['nextDueDate']) };
    },

    async listarCobrancas(assinaturaId) {
      const r = await chamar('GET', `/subscriptions/${encodeURIComponent(assinaturaId)}/payments`);
      const lista = r['data'];
      if (!Array.isArray(lista)) throw new ErroAsaas('resposta_invalida');
      return lista.map((item) => {
        const c = objeto(item);
        return {
          id: texto(c['id']),
          status: texto(c['status']),
          vencimento: texto(c['dueDate']),
          valorCentavos: centavos(c['value']),
        };
      });
    },

    async buscarQrPix(cobrancaId) {
      const r = await chamar('GET', `/payments/${encodeURIComponent(cobrancaId)}/pixQrCode`);
      return {
        imagemPngBase64: texto(r['encodedImage']),
        copiaECola: texto(r['payload']),
        expiraEm: texto(r['expirationDate']),
      };
    },

    async cancelarAssinatura(assinaturaId) {
      const r = await chamar('DELETE', `/subscriptions/${encodeURIComponent(assinaturaId)}`);
      if (r['deleted'] !== true) throw new ErroAsaas('resposta_invalida');
    },
  };
}
