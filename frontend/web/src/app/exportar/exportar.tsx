import type { PaginaExportacao, Prontuario } from '@es/contrato/exportacao';
import { useState } from 'react';
import { montarZipCompleto, juntarPaginas } from '../../export/zip-completo.ts';
import { gerarPdfsPacientes } from '../../export/zip-pdfs.ts';
import { api, ehErroApi } from '../../lib/api.ts';
import { Alert, Button } from '../../ui';

// T175 / EXP-03: tela de exportação completa. O app pede as páginas de GET /api/exportacao, busca
// o prontuário de cada paciente, monta o .zip (dados.json + um PDF por paciente) e baixa.
// PREMISSA: todos os textos desta tela foram escritos pelo implementador; não há mockup da tela
// (.specs/mockup/ não existe), segue-se o padrão visual das Configurações.
// PREMISSA: 413 vem de qualquer pedido da exportação (ex.: borda recusando o tamanho); a API não
// emite 413 por conta própria, a tela só trata o status como "dados grandes demais".
// Nada sai da tela ao falhar: o botão volta e o usuário tenta de novo.

const NOME_ARQUIVO = 'evolucao-segura-exportacao.zip';

type Fase =
  | { tipo: 'parado' }
  | { tipo: 'dados'; paginas: number }
  | { tipo: 'pdfs'; feitos: number; total: number }
  | { tipo: 'zip' };

function mensagemDoErro(erro: unknown): string {
  if (ehErroApi(erro) && erro.status === 429) {
    const espera =
      erro.retryAfter !== undefined ? ` Tente de novo em ${erro.retryAfter} segundos.` : '';
    return `Você iniciou exportações demais em pouco tempo.${espera} Aguarde um minuto e tente outra vez.`;
  }
  if (ehErroApi(erro) && erro.status === 413)
    return 'Os dados são grandes demais para uma exportação só. Tente de novo; se continuar, fale com o suporte.';
  return 'Não foi possível exportar agora. Tente novamente.';
}

function baixar(zip: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = NOME_ARQUIVO;
  a.click();
  URL.revokeObjectURL(url);
}

const descricao = (f: Fase): string =>
  f.tipo === 'dados'
    ? `Baixando os dados: página ${f.paginas}`
    : f.tipo === 'pdfs'
      ? `Gerando os PDFs dos prontuários: ${f.feitos} de ${f.total}`
      : f.tipo === 'zip'
        ? 'Montando o arquivo .zip'
        : '';

export function ExportarPage() {
  const [fase, setFase] = useState<Fase>({ tipo: 'parado' });
  const [erro, setErro] = useState<string | null>(null);
  const [concluida, setConcluida] = useState(false);
  const ocupado = fase.tipo !== 'parado';

  async function exportar() {
    setErro(null);
    setConcluida(false);
    setFase({ tipo: 'dados', paginas: 0 });
    try {
      const dados = await juntarPaginas(
        (cursor) =>
          api.requisitar<PaginaExportacao>(
            cursor === null ? '/exportacao' : `/exportacao?cursor=${encodeURIComponent(cursor)}`,
          ),
        (paginas) => setFase({ tipo: 'dados', paginas }),
      );
      const total = dados.paciente.length;
      setFase({ tipo: 'pdfs', feitos: 0, total });
      const pdfs = await gerarPdfsPacientes(
        dados.paciente.map((p) => ({ id: String(p.id) })),
        (id) => api.requisitar<Prontuario>(`/pacientes/${id}/prontuario`),
        (feitos) => setFase({ tipo: 'pdfs', feitos, total }),
      );
      setFase({ tipo: 'zip' });
      baixar(await montarZipCompleto(dados, pdfs));
      setConcluida(true);
    } catch (e) {
      setErro(mensagemDoErro(e));
    } finally {
      setFase({ tipo: 'parado' });
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold">Exportar meus dados</h1>
        <p className="text-mut">
          Baixe um arquivo .zip com todos os seus dados (dados.json) e um PDF de prontuário por
          paciente. Senhas e sessões não entram no arquivo.
        </p>
      </header>

      <div>
        <Button type="button" onClick={() => void exportar()} disabled={ocupado}>
          {ocupado ? 'Exportando…' : 'Exportar meus dados'}
        </Button>
      </div>

      <div role="status" aria-live="polite" className="text-mut">
        {descricao(fase)}
      </div>
      {concluida && <Alert tone="ok">Exportação concluída. O arquivo foi baixado.</Alert>}
      {erro !== null && <Alert tone="err">{erro}</Alert>}
    </div>
  );
}
