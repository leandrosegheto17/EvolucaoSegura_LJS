import type { ItemDoModelo, ModeloAnamnese } from '@es/contrato/anamnese';
import type { Especialidade } from '@es/contrato/perfil';
import { presetDe } from '@es/dominio/anamnese/presets';
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
