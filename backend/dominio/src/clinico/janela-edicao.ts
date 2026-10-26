// EVO-04, ANA-05: janela de edição do dia do cadastro, copiada de clinical/domain/edit-window.ts
// do legado. A fronteira do dia é sempre calculada pelo banco (relógio do banco, America/Sao_Paulo);
// o app só serializa o que veio do SQL. `estadoPorRelogio` serve a testes e checagens.

// Fragmentos SQL sobre a coluna `criado_em` da linha.
export const JANELA_SQL = {
  editavelAte: `(((criado_em AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`,
  editavelHoje: `((criado_em AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)`,
} as const;

export type EstadoDocumento = 'editavel_hoje' | 'registrada';

export interface LinhaJanela {
  editavel_ate: Date | string;
  editavel_hoje: boolean;
}

export interface JanelaSerializada {
  estado: EstadoDocumento;
  editavel_ate: string;
}

// Estado e `editavel_ate` (ISO UTC) a partir das colunas calculadas no SQL.
export function serializarJanela(linha: LinhaJanela): JanelaSerializada {
  return {
    estado: linha.editavel_hoje ? 'editavel_hoje' : 'registrada',
    editavel_ate: new Date(linha.editavel_ate).toISOString(),
  };
}

// Estado só pelo relógio dado: editável até o instante `editavelAte` (exclusivo).
export function estadoPorRelogio(editavelAte: Date | string, agora: Date): EstadoDocumento {
  return agora.getTime() < new Date(editavelAte).getTime() ? 'editavel_hoje' : 'registrada';
}
