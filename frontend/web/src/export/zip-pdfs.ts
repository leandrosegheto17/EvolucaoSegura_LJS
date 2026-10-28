import type { Prontuario } from '@es/contrato/exportacao';
import { gerarPdfProntuario, nomeArquivoProntuario } from './pdf-prontuario.ts';

// EXP-02, EXP-03 (T174): um PDF de prontuário por paciente para dentro do zip. Reusa o motor da
// T123 (gerarPdfProntuario, o mesmo que baixarPdfProntuario usa; este só dispara o download, então
// aqui se pega o Blob). Um paciente por vez, para não segurar vários PDFs em construção.
// `buscar` traz o prontuário completo (GET /api/pacientes/:id/prontuario, sem período).

export async function gerarPdfsPacientes(
  pacientes: { id: string }[],
  buscar: (pacienteId: string) => Promise<Prontuario>,
  aoPdf?: (feitos: number) => void,
): Promise<Record<string, Uint8Array>> {
  const pdfs: Record<string, Uint8Array> = {};
  let feitos = 0;
  for (const { id } of pacientes) {
    const blob = await gerarPdfProntuario(await buscar(id));
    pdfs[`prontuarios/${nomeArquivoProntuario(id)}`] = new Uint8Array(await blob.arrayBuffer());
    feitos += 1;
    aoPdf?.(feitos);
  }
  return pdfs;
}
