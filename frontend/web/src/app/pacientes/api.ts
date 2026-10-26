import type {
  PaginaPacientes,
  Paciente,
  PacienteEntrada,
  Tcle,
  TcleEntrada,
} from '@es/contrato/pacientes';
import { api } from '../../lib/api.ts';

// PAC-01, PAC-02, PAC-03, PAC-05, PAC-06: chamadas das telas de pacientes, portadas de
// patients/list/patientsApi.ts, patients/status/patientStatusApi.ts, patients/ficha/fichaApi.ts e
// features/patients/form/patientsApi.ts do legado, para /api/pacientes. Sem edição dos dados
// (a spec não pede), sem ciência de IA (fora do escopo) e sem exclusão (PAC-07).

export type FiltroAtivos = 'ativos' | 'inativos' | 'todos';

const caminho = (id: string) => `/pacientes/${encodeURIComponent(id)}`;
const comSinal = (sinal?: AbortSignal) => (sinal !== undefined ? { sinal } : {});

/** GET /api/pacientes: `ativo` ausente = todos; até 100 por página, como no legado. */
export async function listarPacientes(
  p: { q: string; filtro: FiltroAtivos },
  sinal?: AbortSignal,
): Promise<Paciente[]> {
  const qs = new URLSearchParams();
  if (p.q) qs.set('q', p.q);
  if (p.filtro !== 'todos') qs.set('ativo', p.filtro === 'ativos' ? 'true' : 'false');
  qs.set('limit', '100');
  const pagina = await api.requisitar<PaginaPacientes>(`/pacientes?${qs}`, comSinal(sinal));
  return pagina.items;
}

export const criarPaciente = (corpo: PacienteEntrada) =>
  api.requisitar<Paciente>('/pacientes', { metodo: 'POST', corpo });

/** GET /api/pacientes/:id: abrir a ficha audita paciente.consultado (PAC-06). */
export const lerPaciente = (id: string, sinal?: AbortSignal) =>
  api.requisitar<Paciente>(caminho(id), comSinal(sinal));

/** POST /api/pacientes/:id/inativar | reativar. Não existe exclusão de paciente. */
export const definirAtivo = (id: string, ativo: boolean) =>
  api.requisitar<Paciente>(`${caminho(id)}/${ativo ? 'reativar' : 'inativar'}`, {
    metodo: 'POST',
  });

export const listarTcles = async (id: string, sinal?: AbortSignal) =>
  (await api.requisitar<{ items: Tcle[] }>(`${caminho(id)}/tcle`, comSinal(sinal))).items;

export const registrarTcle = (id: string, corpo: TcleEntrada) =>
  api.requisitar<Tcle>(`${caminho(id)}/tcle`, { metodo: 'POST', corpo });
