// ANA-01, ANA-02, ANA-03: regras puras da edição do modelo de anamnese, adaptadas de
// clinical/model/model.domain.ts do legado. Sem banco. A violação diz só o tipo, a posição e o
// motivo, nunca o texto do rótulo (conteúdo clínico).
// Diferenças em relação ao legado, para seguir a spec:
// - Com anamnese registrada (ANA-03), TODO item existente fica travado (o legado travava só os
//   itens que existiam na primeira anamnese e deixava mexer nos incluídos depois).
// - Rótulo único no modelo inteiro, campos e alertas juntos (o índice do banco já é assim).
// - A violação traz a categoria ('invalido' para ANA-01 e ANA-02, 'bloqueado' para ANA-03), e a
//   rota escolhe o código HTTP; o legado já trazia o código no domínio.

export const LIMITES_MODELO = {
  maxCampos: 30,
  maxAlertas: 12,
  rotuloMin: 1,
  rotuloMax: 60,
} as const;

export type TipoItem = 'campo' | 'alerta';

export interface ItemModelo {
  id: string;
  rotulo: string;
  especial?: 'frequencia';
}

// Itens vigentes (não removidos), em ordem. `bloqueado` = existe anamnese registrada.
export interface ModeloAtual {
  bloqueado: boolean;
  campos: readonly ItemModelo[];
  alertas: readonly ItemModelo[];
}

// Item sem id = item novo.
export interface ItemProposto {
  id?: string;
  rotulo: string;
  especial?: 'frequencia';
}

export interface ModeloProposto {
  campos: readonly ItemProposto[];
  alertas: readonly ItemProposto[];
}

export type MotivoViolacao =
  | 'limite_campos'
  | 'limite_alertas'
  | 'rotulo_vazio'
  | 'rotulo_longo'
  | 'rotulo_repetido'
  | 'especial_invalido'
  | 'id_desconhecido'
  | 'remocao_bloqueada'
  | 'renomeacao_bloqueada'
  | 'ordem_bloqueada';

export interface Violacao {
  categoria: 'invalido' | 'bloqueado';
  motivo: MotivoViolacao;
  tipo: TipoItem;
  indice?: number;
}

export type ResultadoModelo = { ok: true } | { ok: false; violacoes: Violacao[] };

const chave = (rotulo: string): string => rotulo.trim().toLowerCase();

function validarLista(
  tipo: TipoItem,
  atuais: readonly ItemModelo[],
  propostos: readonly ItemProposto[],
  bloqueado: boolean,
  vistos: Set<string>,
  saida: Violacao[],
): void {
  const invalido = (motivo: MotivoViolacao, indice?: number) =>
    saida.push({
      categoria: 'invalido',
      motivo,
      tipo,
      ...(indice === undefined ? {} : { indice }),
    });
  const travado = (motivo: MotivoViolacao, indice?: number) =>
    saida.push({
      categoria: 'bloqueado',
      motivo,
      tipo,
      ...(indice === undefined ? {} : { indice }),
    });

  const maximo = tipo === 'campo' ? LIMITES_MODELO.maxCampos : LIMITES_MODELO.maxAlertas;
  if (propostos.length > maximo) invalido(tipo === 'campo' ? 'limite_campos' : 'limite_alertas');

  propostos.forEach((p, indice) => {
    const rotulo = p.rotulo.trim();
    if (rotulo.length < LIMITES_MODELO.rotuloMin) invalido('rotulo_vazio', indice);
    else if (rotulo.length > LIMITES_MODELO.rotuloMax) invalido('rotulo_longo', indice);
    else {
      if (vistos.has(chave(rotulo))) invalido('rotulo_repetido', indice);
      vistos.add(chave(rotulo));
    }
    // ANA-02: "Frequência" é o único especial, e só em campo.
    if (p.especial !== undefined && (tipo === 'alerta' || p.especial !== 'frequencia'))
      invalido('especial_invalido', indice);
  });
  if (tipo === 'campo' && propostos.filter((p) => p.especial === 'frequencia').length > 1)
    invalido('especial_invalido');

  const conhecidos = new Set(atuais.map((i) => i.id));
  const usados = new Set<string>();
  propostos.forEach((p, indice) => {
    if (p.id === undefined) return;
    if (!conhecidos.has(p.id) || usados.has(p.id)) invalido('id_desconhecido', indice);
    usados.add(p.id);
  });

  if (!bloqueado) return;
  // ANA-03: os existentes não somem, não mudam de texto nem de especial, nem de ordem relativa.
  for (const existente of atuais) {
    const indice = propostos.findIndex((p) => p.id === existente.id);
    if (indice < 0) travado('remocao_bloqueada');
    else if (
      propostos[indice]!.rotulo.trim() !== existente.rotulo ||
      propostos[indice]!.especial !== existente.especial
    )
      travado('renomeacao_bloqueada', indice);
  }
  const ordemProposta = propostos
    .map((p) => p.id)
    .filter((id): id is string => id !== undefined && conhecidos.has(id));
  const ordemAtual = atuais.map((i) => i.id).filter((id) => ordemProposta.includes(id));
  if (ordemProposta.some((id, i) => id !== ordemAtual[i])) travado('ordem_bloqueada');
}

// Valida a substituição do modelo pelo proposto (lista completa de campos e de alertas).
export function validarModelo(atual: ModeloAtual, proposto: ModeloProposto): ResultadoModelo {
  const violacoes: Violacao[] = [];
  const vistos = new Set<string>();
  validarLista('campo', atual.campos, proposto.campos, atual.bloqueado, vistos, violacoes);
  validarLista('alerta', atual.alertas, proposto.alertas, atual.bloqueado, vistos, violacoes);
  return violacoes.length === 0 ? { ok: true } : { ok: false, violacoes };
}
