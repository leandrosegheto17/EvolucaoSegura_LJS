import type { MotivoSenha, Problema } from '@es/contrato/identidade';
import { QueryClient } from '@tanstack/react-query';

// AUTH-17, PUB-02: cliente da API, portado do lib/api do legado (frontend/src/lib/api) para o
// prefixo /api do Worker (mesma origem do app, cookie __Host-sid enviado pelo navegador).
// - Escrita autenticada (tudo que não é GET, HEAD ou OPTIONS) leva o x-csrf-token. O token vem do
//   login (2FA) ou de GET /api/eu; sem ele na memória, o cliente busca antes de escrever.
// - Rota pública (cadastro, entrar, 2FA, recuperação) não leva o token e o 401 dela é só erro de
//   senha ou código.
// - 401 de rota autenticada = sessão encerrada no servidor: esquece o token, avisa quem escuta
//   (EVENTO_NAO_AUTORIZADO) e leva a /sessao-expirada.

export const API_BASE = '/api';
export const CABECALHO_CSRF = 'x-csrf-token';
export const CAMINHO_SESSAO_EXPIRADA = '/sessao-expirada';
export const EVENTO_NAO_AUTORIZADO = 'api:nao-autorizado';

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Erro tipado a partir do application/problem+json do contrato.
export class ErroApi extends Error {
  readonly status: number;
  readonly codigo: string;
  motivo?: MotivoSenha;
  campos?: string[];
  // Segundos do Retry-After (429), quando vier.
  retryAfter?: number;

  constructor(status: number, codigo: string, titulo?: string) {
    super(titulo ?? codigo);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
  }
}

export const ehErroApi = (erro: unknown): erro is ErroApi => erro instanceof ErroApi;

async function paraErroApi(resposta: Response): Promise<ErroApi> {
  let corpo: Partial<Problema> = {};
  try {
    const lido: unknown = await resposta.json();
    if (lido !== null && typeof lido === 'object') corpo = lido as Partial<Problema>;
  } catch {
    // corpo ausente ou que não é JSON
  }
  const erro = new ErroApi(
    resposta.status,
    typeof corpo.codigo === 'string' ? corpo.codigo : 'erro',
    typeof corpo.titulo === 'string' ? corpo.titulo : undefined,
  );
  if (corpo.motivo !== undefined) erro.motivo = corpo.motivo;
  if (Array.isArray(corpo.campos)) erro.campos = corpo.campos;
  const espera = Number(resposta.headers.get('Retry-After'));
  if (Number.isFinite(espera) && espera > 0) erro.retryAfter = espera;
  return erro;
}

// Token CSRF da sessão: só na memória (nunca em storage).
let csrf: string | null = null;
export const definirCsrf = (token: string | null): void => {
  csrf = token;
};
export const lerCsrf = (): string | null => csrf;

export interface OpcoesRequisicao {
  metodo?: string;
  corpo?: unknown;
  // Rota pública, antes da sessão: sem x-csrf-token e sem ir a /sessao-expirada no 401.
  publica?: boolean;
  sinal?: AbortSignal;
}

export interface OpcoesCliente {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  // Chamado no 401 de rota autenticada (padrão: evento e navegação para /sessao-expirada).
  aoExpirar?: () => void;
}

function expirarPadrao(): void {
  window.dispatchEvent(new Event(EVENTO_NAO_AUTORIZADO));
  if (window.location.pathname !== CAMINHO_SESSAO_EXPIRADA)
    window.location.assign(CAMINHO_SESSAO_EXPIRADA);
}

export function criarClienteApi(opcoes: OpcoesCliente = {}) {
  const buscar = (url: string, init: RequestInit) =>
    (opcoes.fetch ?? ((u: string, i?: RequestInit) => fetch(u, i)))(url, init);
  const expirar = () => {
    definirCsrf(null);
    (opcoes.aoExpirar ?? expirarPadrao)();
  };

  async function enviar(caminho: string, o: OpcoesRequisicao): Promise<Response> {
    const metodo = (o.metodo ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
    };
    if (!SEGUROS.has(metodo) && !o.publica) {
      if (csrf === null) await carregarCsrf(o.sinal);
      if (csrf !== null) headers[CABECALHO_CSRF] = csrf;
    }
    if (o.corpo !== undefined) headers['Content-Type'] = 'application/json';
    const resposta = await buscar(`${API_BASE}${caminho}`, {
      method: metodo,
      headers,
      credentials: 'same-origin',
      ...(o.corpo !== undefined ? { body: JSON.stringify(o.corpo) } : {}),
      ...(o.sinal !== undefined ? { signal: o.sinal } : {}),
    });
    if (resposta.ok) return resposta;
    const erro = await paraErroApi(resposta);
    if (erro.status === 401 && !o.publica) expirar();
    throw erro;
  }

  // GET /api/eu devolve o csrf_token da sessão (e, como toda requisição autenticada, renova o
  // último uso).
  async function carregarCsrf(sinal?: AbortSignal): Promise<void> {
    const resposta = await enviar('/eu', sinal !== undefined ? { sinal } : {});
    const corpo = (await resposta.json()) as { csrf_token?: unknown };
    if (typeof corpo.csrf_token === 'string') definirCsrf(corpo.csrf_token);
  }

  async function requisitar<T = unknown>(caminho: string, o: OpcoesRequisicao = {}): Promise<T> {
    const resposta = await enviar(caminho, o);
    const texto = await resposta.text();
    return (texto === '' ? undefined : JSON.parse(texto)) as T;
  }

  return { requisitar, carregarCsrf };
}

export type ClienteApi = ReturnType<typeof criarClienteApi>;

export const api = criarClienteApi();

// Sem repetição em 4xx (inclui 401 e 422); até 2 repetições em falha de rede ou 5xx.
export function podeRepetir(tentativas: number, erro: unknown): boolean {
  if (ehErroApi(erro) && erro.status >= 400 && erro.status < 500) return false;
  return tentativas < 2;
}

export function criarQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: podeRepetir, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
