import type { ItemModelo } from './modelo.ts';
import { OPCOES_FREQUENCIA } from './presets.ts';

// ANA-02, ANA-04, ANA-06, ANA-09: regras puras dos valores da anamnese, adaptadas de
// clinical/anamnesis/anamnesis-values.domain.ts do legado, sem o schema morto de 20.000 e 5.000
// (anamnesis.domain.ts) e sem a conversão das colunas antigas (a base é nova). Sem banco. A
// recusa diz o motivo e o id do item, nunca o conteúdo (dado clínico).

export const LIMITES_VALORES = { textoMax: 5000, observacaoMax: 500 } as const;

// Item do modelo com a revisão em que entrou (ANA-04: revisão futura).
export interface ItemDosValores extends ItemModelo {
  revisao_inclusao: number;
}

export interface ModeloDosValores {
  campos: readonly ItemDosValores[];
  alertas: readonly ItemDosValores[];
}

export interface ValorAlerta {
  marcado: boolean;
  obs: string | null;
}
export type Valor = string | ValorAlerta;
export type Valores = Record<string, Valor>;

export type MotivoValor =
  | 'formato_invalido'
  | 'id_desconhecido'
  | 'id_revisao_futura'
  | 'texto_longo'
  | 'observacao_longa'
  | 'tipo_invalido'
  | 'frequencia_invalida';

// Só o motivo e o id do item do modelo; id desconhecido não é ecoado.
export interface ViolacaoValor {
  motivo: MotivoValor;
  item_id?: string;
}

export type ResultadoValores =
  { ok: true; valores: Valores } | { ok: false; violacoes: ViolacaoValor[] };

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const FREQUENCIAS = new Set<string>(OPCOES_FREQUENCIA);

// Itens que existiam na revisão dada: item incluído depois não aparece em anamnese antiga.
export function itensVisiveis<T extends ItemDosValores>(itens: readonly T[], revisao: number): T[] {
  return itens.filter((i) => i.revisao_inclusao <= revisao);
}

// Valida e normaliza os valores por id. Campo vazio ou nulo é omitido; alerta desmarcado e sem
// observação é omitido; textos são aparados.
export function lerValores(
  modelo: ModeloDosValores,
  valores: unknown,
  revisao: number,
): ResultadoValores {
  if (!ehObjeto(valores)) return { ok: false, violacoes: [{ motivo: 'formato_invalido' }] };
  const porId = new Map<string, { item: ItemDosValores; tipo: 'campo' | 'alerta' }>();
  for (const item of modelo.campos) porId.set(item.id, { item, tipo: 'campo' });
  for (const item of modelo.alertas) porId.set(item.id, { item, tipo: 'alerta' });

  const violacoes: ViolacaoValor[] = [];
  const saida: Valores = {};
  const recusar = (motivo: MotivoValor, item_id?: string) =>
    violacoes.push({ motivo, ...(item_id === undefined ? {} : { item_id }) });

  for (const [id, bruto] of Object.entries(valores)) {
    const entrada = porId.get(id);
    if (!entrada) {
      recusar('id_desconhecido');
      continue;
    }
    if (entrada.item.revisao_inclusao > revisao) {
      recusar('id_revisao_futura', id);
      continue;
    }
    if (entrada.tipo === 'campo') {
      if (bruto === null || bruto === undefined) continue;
      if (typeof bruto !== 'string') {
        recusar('tipo_invalido', id);
        continue;
      }
      const texto = bruto.trim();
      if (texto.length > LIMITES_VALORES.textoMax) recusar('texto_longo', id);
      else if (entrada.item.especial === 'frequencia' && texto !== '' && !FREQUENCIAS.has(texto))
        recusar('frequencia_invalida', id);
      else if (texto !== '') saida[id] = texto;
      continue;
    }
    if (
      !ehObjeto(bruto) ||
      typeof bruto['marcado'] !== 'boolean' ||
      (bruto['obs'] !== null && bruto['obs'] !== undefined && typeof bruto['obs'] !== 'string')
    ) {
      recusar('tipo_invalido', id);
      continue;
    }
    const obs = typeof bruto['obs'] === 'string' ? bruto['obs'].trim() : '';
    if (obs.length > LIMITES_VALORES.observacaoMax) {
      recusar('observacao_longa', id);
      continue;
    }
    if (bruto['marcado'] || obs !== '')
      saida[id] = { marcado: bruto['marcado'], obs: obs === '' ? null : obs };
  }
  return violacoes.length === 0 ? { ok: true, valores: saida } : { ok: false, violacoes };
}

export interface Versao {
  modelo_revisao: number;
  valores: unknown;
}

// ANA-06: a versão vigente é a retificação de maior seq, ou a original.
export function versaoVigente<T extends Versao>(
  original: T,
  retificacoes: readonly (T & { seq: number })[],
): T {
  return (
    retificacoes.reduce<(T & { seq: number }) | null>(
      (maior, r) => (maior === null || r.seq > maior.seq ? r : maior),
      null,
    ) ?? original
  );
}

export interface AlertaVigente {
  item_id: string;
  rotulo: string;
}

// ANA-09: alertas marcados da versão dada, na ordem do modelo, só os visíveis na revisão dela.
export function alertasVigentes(modelo: ModeloDosValores, versao: Versao): AlertaVigente[] {
  if (!ehObjeto(versao.valores)) return [];
  const valores = versao.valores;
  return itensVisiveis(modelo.alertas, versao.modelo_revisao)
    .filter((a) => {
      const v = valores[a.id];
      return ehObjeto(v) && v['marcado'] === true;
    })
    .map((a) => ({ item_id: a.id, rotulo: a.rotulo }));
}
