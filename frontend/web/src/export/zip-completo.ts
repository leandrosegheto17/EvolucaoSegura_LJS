import {
  type PaginaExportacao,
  TABELAS_EXPORTACAO,
  type TabelaExportacao,
} from '@es/contrato/exportacao';

// EXP-03 (T124): junta no navegador as páginas de GET /api/exportacao e monta o .zip com
// dados.json. O fflate entra por import dinâmico, num chunk que só baixa ao exportar (design.md:
// export/ carregado sob demanda).

export type DadosExportacao = Record<TabelaExportacao, Record<string, unknown>[]>;

// Anda pelos cursores na ordem recebida até proximo_cursor null; `aoPagina` recebe quantas
// páginas já vieram. Toda tabela da lista aparece no resultado, vazia se não teve linha.
export async function juntarPaginas(
  buscar: (cursor: string | null) => Promise<PaginaExportacao>,
  aoPagina?: (paginas: number) => void,
): Promise<DadosExportacao> {
  const dados = Object.fromEntries(
    TABELAS_EXPORTACAO.map((t) => [t, []]),
  ) as unknown as DadosExportacao;
  let cursor: string | null = null;
  let paginas = 0;
  do {
    const pagina: PaginaExportacao = await buscar(cursor);
    dados[pagina.tabela].push(...pagina.linhas);
    paginas += 1;
    aoPagina?.(paginas);
    cursor = pagina.proximo_cursor;
  } while (cursor !== null);
  return dados;
}

// `extras`: arquivos a mais no zip (ex.: PDFs dos prontuários, T174), caminho -> bytes.
export async function montarZipCompleto(
  dados: DadosExportacao,
  extras: Record<string, Uint8Array> = {},
): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import('fflate');
  return zipSync({ 'dados.json': strToU8(JSON.stringify(dados, null, 2)), ...extras });
}
