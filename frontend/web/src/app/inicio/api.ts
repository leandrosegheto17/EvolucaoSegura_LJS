import type { ResumoInicio } from '@es/contrato/inicio';
import { api } from '../../lib/api.ts';

// INI-01, INI-02, INI-03: chamada do Início, portada de home/homeApi.ts do legado, para
// GET /api/inicio. A API já classifica evolução e pagamento; a tela só mostra.

export const lerResumoInicio = (sinal?: AbortSignal) =>
  api.requisitar<ResumoInicio>('/inicio', sinal !== undefined ? { sinal } : {});
