// RAS-01, RAS-02: regras puras do rascunho, adaptadas de clinical/drafts/domain/draft.ts e do
// DraftsService do legado. A chave é (tipo, ref); o payload e o limite de 512 KiB ficam no
// contrato (backend/contrato/src/clinico.ts).
// Decisão do usuário (2026-10-26): tipo e ref no formato do legado; para `evolucao` e
// `anamnese` o ref é um UUID (sem o par paciente:especialidade do legado, porque aqui o
// profissional tem uma só especialidade, D-15).

const CHAVE = /^[A-Za-z0-9._:-]{1,120}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_COM_UUID = new Set(['anamnese', 'evolucao']);

export interface ChaveRascunho {
  tipo: string;
  ref: string;
}

// Chave válida ou null (a rota responde 400 sem ecoar a chave).
export function lerChaveRascunho(tipo: string, ref: string): ChaveRascunho | null {
  if (!CHAVE.test(tipo) || !CHAVE.test(ref)) return null;
  if (TIPOS_COM_UUID.has(tipo) && !UUID.test(ref)) return null;
  return { tipo, ref };
}

// If-Match: `"3"`, `W/"3"` ou `3` -> 3; ausente -> null; outro formato -> 'invalido'.
export function lerIfMatch(cabecalho: string | undefined): number | null | 'invalido' {
  if (cabecalho === undefined) return null;
  const achado = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(cabecalho);
  return achado ? Number(achado[1]) : 'invalido';
}

// RAS-02: sem rascunho, cria com If-Match ausente ou "0"; com rascunho, substitui só se o
// If-Match for a versão atual. O resto é conflito (412).
export function decidirGravacao(
  versaoAtual: number | null,
  ifMatch: number | null,
): 'criar' | 'substituir' | 'conflito' {
  if (versaoAtual === null) return ifMatch === null || ifMatch === 0 ? 'criar' : 'conflito';
  return ifMatch === versaoAtual ? 'substituir' : 'conflito';
}
