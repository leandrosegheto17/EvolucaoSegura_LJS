import type {
  Anamnese,
  ItemDoModelo,
  ModeloAnamnese,
  ValoresAnamnese,
} from '@es/contrato/anamnese';
import type { Especialidade } from '@es/contrato/perfil';
import { presetDe } from '@es/dominio/anamnese/presets';
import {
  type ModeloDosValores,
  alertasVigentes,
  versaoVigente,
} from '@es/dominio/anamnese/valores';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';

// Repositório da anamnese configurável (migration 0008). Tudo na transação do profissional:
// o RLS só mostra e só deixa gravar as linhas dele.

// PERF-05: existe anamnese registrada do profissional da transação.
export async function existeAnamnese(trx: Trx): Promise<boolean> {
  const linha = await trx.selectFrom('anamnese').select('id').limit(1).executeTakeFirst();
  return linha !== undefined;
}

// PERF-04: cria o modelo padrão da especialidade (preset do legado), na revisão 1, se o
// profissional ainda não tem modelo dela. Já existindo (ex.: voltou a uma especialidade
// anterior), fica como está.
export async function criarModeloPadrao(
  trx: Trx,
  usuarioId: string,
  especialidade: Especialidade,
): Promise<void> {
  const criado = await trx
    .insertInto('modelo_anamnese')
    .values({ usuario_id: usuarioId, especialidade })
    .onConflict((oc) => oc.columns(['usuario_id', 'especialidade']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!criado) return;
  const preset = presetDe(especialidade);
  const itens = [
    ...preset.campos.map((item, ordem) => ({ tipo: 'campo' as const, item, ordem })),
    ...preset.alertas.map((item, ordem) => ({ tipo: 'alerta' as const, item, ordem })),
  ];
  if (itens.length === 0) return;
  await trx
    .insertInto('modelo_anamnese_item')
    .values(
      itens.map(({ tipo, item, ordem }) => ({
        usuario_id: usuarioId,
        modelo_id: criado.id,
        tipo,
        especial: item.especial === 'frequencia',
        rotulo: item.rotulo,
        ordem,
        revisao_inclusao: 1,
      })),
    )
    .execute();
}

export interface ItemDoBanco {
  id: string;
  tipo: 'campo' | 'alerta';
  especial: boolean;
  rotulo: string;
  ordem: number;
  revisao_inclusao: number;
}

export interface ModeloDoBanco {
  id: string;
  especialidade: Especialidade;
  revisao: number;
  row_version: number;
  itens: ItemDoBanco[];
}

// Itens vigentes (não removidos) do modelo, campos e alertas cada um na sua ordem.
export async function itensDoModelo(trx: Trx, modeloId: string): Promise<ItemDoBanco[]> {
  return trx
    .selectFrom('modelo_anamnese_item')
    .select(['id', 'tipo', 'especial', 'rotulo', 'ordem', 'revisao_inclusao'])
    .where('modelo_id', '=', modeloId)
    .where('removido', '=', false)
    .orderBy('tipo')
    .orderBy('ordem')
    .execute();
}

// Modelo da especialidade do perfil, criado com o padrão se ainda não existe (PERF-04: perfil
// salvo antes do modelo existir). Sem especialidade no perfil, null. `travar` = FOR UPDATE, que
// serializa a edição do modelo com o registro da anamnese (ANA-03).
export async function modeloDoPerfil(
  trx: Trx,
  usuarioId: string,
  travar: boolean,
): Promise<ModeloDoBanco | null> {
  const perfil = await trx
    .selectFrom('perfil')
    .select('especialidade')
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!perfil?.especialidade) return null;
  await criarModeloPadrao(trx, usuarioId, perfil.especialidade);
  let consulta = trx
    .selectFrom('modelo_anamnese')
    .select(['id', 'especialidade', 'revisao', 'row_version'])
    .where('usuario_id', '=', usuarioId)
    .where('especialidade', '=', perfil.especialidade);
  if (travar) consulta = consulta.forUpdate();
  const modelo = await consulta.executeTakeFirstOrThrow();
  return { ...modelo, itens: await itensDoModelo(trx, modelo.id) };
}

const paraItem = (i: ItemDoBanco): ItemDoModelo => ({
  id: i.id,
  rotulo: i.rotulo,
  ...(i.especial ? { especial: 'frequencia' as const } : {}),
});

export function paraModelo(modelo: ModeloDoBanco, bloqueado: boolean): ModeloAnamnese {
  return {
    especialidade: modelo.especialidade,
    revisao: modelo.revisao,
    row_version: modelo.row_version,
    bloqueado,
    campos: modelo.itens.filter((i) => i.tipo === 'campo').map(paraItem),
    alertas: modelo.itens.filter((i) => i.tipo === 'alerta').map(paraItem),
  };
}

// Campos e alertas vigentes no formato do domínio dos valores (com a revisão de inclusão).
export function modeloDosValores(itens: ItemDoBanco[]): ModeloDosValores {
  const item = (i: ItemDoBanco) => ({
    id: i.id,
    rotulo: i.rotulo,
    revisao_inclusao: i.revisao_inclusao,
    ...(i.especial ? { especial: 'frequencia' as const } : {}),
  });
  return {
    campos: itens.filter((i) => i.tipo === 'campo').map(item),
    alertas: itens.filter((i) => i.tipo === 'alerta').map(item),
  };
}

// ANA-05: o dia do cadastro e o fim dele em America/Sao_Paulo, pelo relógio do banco (now() é o
// instante da transação, o mesmo que o trigger da janela usa).
const EDITAVEL_HOJE = sql<boolean>`(criado_em at time zone 'America/Sao_Paulo')::date
  = (now() at time zone 'America/Sao_Paulo')::date`;
const EDITAVEL_ATE = sql<Date>`(((criado_em at time zone 'America/Sao_Paulo')::date + 1)::timestamp
  at time zone 'America/Sao_Paulo')`;

export interface LinhaAnamnese {
  id: string;
  paciente_id: string;
  modelo_id: string;
  data_sessao: string;
  modelo_revisao: number;
  valores: unknown;
  row_version: number;
  criado_em: Date;
  editavel_hoje: boolean;
  editavel_ate: Date;
}

// Anamnese por id ou pelo paciente; `travar` = FOR UPDATE (edição e retificação).
export async function linhaAnamnese(
  trx: Trx,
  filtro: { id: string } | { pacienteId: string },
  travar = false,
): Promise<LinhaAnamnese | undefined> {
  let consulta = trx
    .selectFrom('anamnese')
    .select([
      'id',
      'paciente_id',
      'modelo_id',
      sql<string>`data_sessao::text`.as('data_sessao'),
      'modelo_revisao',
      'valores',
      'row_version',
      'criado_em',
      EDITAVEL_HOJE.as('editavel_hoje'),
      EDITAVEL_ATE.as('editavel_ate'),
    ]);
  consulta =
    'id' in filtro
      ? consulta.where('id', '=', filtro.id)
      : consulta.where('paciente_id', '=', filtro.pacienteId);
  if (travar) consulta = consulta.forUpdate();
  return consulta.executeTakeFirst();
}

// Monta a resposta: original, retificações em ordem, versão vigente e alertas dela (ANA-09).
export async function paraAnamnese(trx: Trx, linha: LinhaAnamnese): Promise<Anamnese> {
  const retificacoes = await trx
    .selectFrom('anamnese_retificacao')
    .select(['seq', 'motivo', 'modelo_revisao', 'valores', 'criado_em'])
    .where('anamnese_id', '=', linha.id)
    .orderBy('seq')
    .execute();
  const original = { modelo_revisao: linha.modelo_revisao, valores: linha.valores };
  const vigente = versaoVigente(original, retificacoes);
  const modelo = modeloDosValores(await itensDoModelo(trx, linha.modelo_id));
  const alertas = alertasVigentes(modelo, vigente);
  return {
    id: linha.id,
    paciente_id: linha.paciente_id,
    data_sessao: linha.data_sessao,
    modelo_revisao: linha.modelo_revisao,
    valores: linha.valores as ValoresAnamnese,
    estado: linha.editavel_hoje ? 'editavel_hoje' : 'registrada',
    editavel_ate: new Date(linha.editavel_ate).toISOString(),
    row_version: linha.row_version,
    criado_em: new Date(linha.criado_em).toISOString(),
    versao_vigente: retificacoes.reduce((maior, r) => Math.max(maior, r.seq), 0),
    retificacoes: retificacoes.map((r) => ({
      seq: r.seq,
      motivo: r.motivo,
      modelo_revisao: r.modelo_revisao,
      valores: r.valores as ValoresAnamnese,
      criado_em: new Date(r.criado_em).toISOString(),
    })),
    alerta_clinico: alertas.length > 0,
    alertas,
  };
}
