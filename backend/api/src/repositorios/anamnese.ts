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
