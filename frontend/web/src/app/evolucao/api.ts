import type {
  Evolucao,
  EvolucaoEntrada,
  EvolucaoRetificacao,
  ModeloTexto,
  ModeloTextoEdicao,
  PaginaEvolucoes,
  Rascunho,
} from '@es/contrato/clinico';
import { api } from '../../lib/api.ts';

// EVO-01, EVO-04, EVO-05, RAS-01 a RAS-04: chamadas das telas de evolução, rascunho e modelos de
// texto, portadas de evolutionApi.ts e draftsApi.ts do legado para /api/evolucoes,
// /api/rascunhos e /api/modelos-texto. O row_version da evolução vai no corpo; o do rascunho vai
// no If-Match (RAS-02).

export const POR_PAGINA = 50;
export const chaveEvolucoes = (pacienteId: string) => ['evolucoes', pacienteId] as const;
export const CHAVE_MODELOS_TEXTO = ['modelos-texto'] as const;

const id = (v: string) => encodeURIComponent(v);
const comSinal = (sinal?: AbortSignal) => (sinal !== undefined ? { sinal } : {});

export const listarEvolucoes = (pacienteId: string, offset: number, sinal?: AbortSignal) =>
  api.requisitar<PaginaEvolucoes>(
    `/pacientes/${id(pacienteId)}/evolucoes?limit=${POR_PAGINA}&offset=${offset}`,
    comSinal(sinal),
  );

export const criarEvolucao = (corpo: EvolucaoEntrada) =>
  api.requisitar<Evolucao>('/evolucoes', { metodo: 'POST', corpo });

export const editarEvolucao = (evolucaoId: string, texto: string, rowVersion: number) =>
  api.requisitar<Evolucao>(`/evolucoes/${id(evolucaoId)}`, {
    metodo: 'PUT',
    corpo: { texto, row_version: rowVersion },
  });

export const retificarEvolucao = (evolucaoId: string, corpo: EvolucaoRetificacao) =>
  api.requisitar<Evolucao>(`/evolucoes/${id(evolucaoId)}/retificacoes`, {
    metodo: 'POST',
    corpo,
  });

export const lerRascunho = async (tipo: string, ref: string, sinal?: AbortSignal) =>
  (
    await api.requisitar<{ items: Rascunho[] }>(
      `/rascunhos?tipo=${id(tipo)}&ref=${id(ref)}`,
      comSinal(sinal),
    )
  ).items[0] ?? null;

export const gravarRascunho = (
  tipo: string,
  ref: string,
  payload: Record<string, unknown>,
  versao: number,
) =>
  api.requisitar<Rascunho>(`/rascunhos/${id(tipo)}/${id(ref)}`, {
    metodo: 'PUT',
    corpo: { payload },
    cabecalhos: { 'If-Match': String(versao) },
  });

export const listarModelosTexto = async (arquivados: boolean, sinal?: AbortSignal) =>
  (
    await api.requisitar<{ items: ModeloTexto[] }>(
      `/modelos-texto?arquivados=${arquivados}`,
      comSinal(sinal),
    )
  ).items;

export const criarModeloTexto = (nome: string, corpo: string) =>
  api.requisitar<ModeloTexto>('/modelos-texto', {
    metodo: 'POST',
    corpo: { tipo: 'evolucao', nome, corpo },
  });

export const editarModeloTexto = (modeloId: string, corpo: ModeloTextoEdicao) =>
  api.requisitar<ModeloTexto>(`/modelos-texto/${id(modeloId)}`, { metodo: 'PUT', corpo });
