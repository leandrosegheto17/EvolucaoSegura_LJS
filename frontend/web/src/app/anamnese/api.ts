import type {
  Anamnese,
  AnamneseEntrada,
  AnamneseGravacao,
  ModeloAnamnese,
  ModeloGravacao,
  RetificacaoEntrada,
} from '@es/contrato/anamnese';
import { api } from '../../lib/api.ts';

// ANA-01, ANA-04 a ANA-09: chamadas das telas de anamnese, portadas de anamnesisApi.ts do
// legado para /api/modelo-anamnese, /api/pacientes/:id/anamnese, /api/anamneses/:id e
// /api/anamneses/:id/retificacoes. O row_version vai no corpo (não há If-Match como no legado).

export const CHAVE_MODELO = ['modelo-anamnese'] as const;
export const chaveAnamnese = (pacienteId: string) => ['anamnese', pacienteId] as const;

const id = (v: string) => encodeURIComponent(v);
const comSinal = (sinal?: AbortSignal) => (sinal !== undefined ? { sinal } : {});

export const lerModelo = (sinal?: AbortSignal) =>
  api.requisitar<ModeloAnamnese>('/modelo-anamnese', comSinal(sinal));

export const gravarModelo = (corpo: ModeloGravacao) =>
  api.requisitar<ModeloAnamnese>('/modelo-anamnese', { metodo: 'PUT', corpo });

export const lerAnamnese = async (pacienteId: string, sinal?: AbortSignal) =>
  (
    await api.requisitar<{ anamnese: Anamnese | null }>(
      `/pacientes/${id(pacienteId)}/anamnese`,
      comSinal(sinal),
    )
  ).anamnese;

export const criarAnamnese = (pacienteId: string, corpo: AnamneseEntrada) =>
  api.requisitar<Anamnese>(`/pacientes/${id(pacienteId)}/anamnese`, { metodo: 'POST', corpo });

export const editarAnamnese = (anamneseId: string, corpo: AnamneseGravacao) =>
  api.requisitar<Anamnese>(`/anamneses/${id(anamneseId)}`, { metodo: 'PUT', corpo });

export const retificarAnamnese = (anamneseId: string, corpo: RetificacaoEntrada) =>
  api.requisitar<Anamnese>(`/anamneses/${id(anamneseId)}/retificacoes`, {
    metodo: 'POST',
    corpo,
  });
