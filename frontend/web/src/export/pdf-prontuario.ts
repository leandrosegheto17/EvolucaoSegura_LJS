import type { CampoProntuario, Prontuario } from '@es/contrato/exportacao';

// EXP-02, ADR-008: PDF do prontuário montado no navegador. Porta de record-pdf.ts do legado (que
// rodava no servidor): a definição do documento é a mesma; o motor (pdfmake) e as fontes (vfs)
// entram por import dinâmico, num chunk separado que só baixa quando o usuário exporta.
// SPEC_DEVIATION: o legado usava Inter e Source Serif 4 (arquivos .woff do servidor). Aqui a fonte é
// a Roboto do vfs do próprio pdfmake, que cobre o latim com acentos e evita carregar fontes extras.

const FONTE = 'Roboto';

export const nomeArquivoProntuario = (pacienteId: string): string =>
  `prontuario-${pacienteId.slice(0, 8)}.pdf`;

const dataBr = (s: string): string => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const titulo = (text: string) => ({ text, bold: true, fontSize: 13, margin: [0, 14, 0, 4] });
const meta = (text: string, extra: object = {}) => ({
  text,
  fontSize: 9.5,
  margin: [0, 0, 0, 2],
  ...extra,
});
const tituloHist = (text: string) => ({
  text,
  fontSize: 9,
  bold: true,
  color: '#555555',
  margin: [12, 6, 0, 2],
});
const textoHist = (text: string) => ({
  text: text || ' ',
  fontSize: 10,
  color: '#333333',
  margin: [12, 0, 0, 4],
});

const linhaCampo = (c: CampoProntuario): [string, string] =>
  c.tipo === 'campo'
    ? [c.rotulo, c.texto]
    : [c.rotulo, c.marcado ? `Sim${c.obs ? ` — ${c.obs}` : ''}` : 'Não'];

const campos = (lista: CampoProntuario[], recuo = 0) =>
  lista
    .map(linhaCampo)
    .filter(([, v]) => v)
    .map(([k, v]) => ({ text: [{ text: `${k}: `, bold: true }, v], margin: [recuo, 0, 0, 3] }));

export function montarDefinicaoProntuario(p: Prontuario): object {
  const prof = p.profissional;
  const contato = [prof?.contato, prof?.endereco].filter(Boolean).join(' | ');
  const { de, ate } = p.periodo;
  const periodo =
    de || ate
      ? `Período: ${de ? dataBr(de) : '…'} a ${ate ? dataBr(ate) : '…'}`
      : 'Período: prontuário completo';

  const content: unknown[] = [
    { text: 'Prontuário', bold: true, fontSize: 16, margin: [0, 0, 0, 4] },
    meta(`Paciente: ${p.paciente.nome}`),
    meta(periodo),
    ...(prof?.registro ? [meta(`Registro profissional: ${prof.registro}`)] : []),
    titulo('Anamnese'),
  ];

  const an = p.anamnese;
  if (!an) content.push({ text: 'Sem anamnese registrada.' });
  else {
    content.push(
      meta(`Especialidade: ${prof?.especialidade_nome ?? an.especialidade}`, {
        bold: true,
        margin: [0, 8, 0, 2],
      }),
      meta(`Data da sessão: ${dataBr(an.data_sessao)}`),
      ...campos(an.vigente.campos),
    );
    for (const r of an.retificacoes) {
      content.push(
        tituloHist(`Retificação ${r.seq} — ${dataBr(r.dia)} — Motivo: ${r.motivo}`),
        ...campos(r.campos, 12),
      );
    }
    if (an.retificacoes.length) {
      content.push(
        meta('Os campos acima refletem a versão vigente (última retificação).', { italics: true }),
      );
    }
  }

  content.push(titulo('Evoluções'));
  if (!p.evolucoes.length) content.push({ text: 'Nenhuma evolução no período.' });
  for (const e of p.evolucoes) {
    const vig = e.retificacoes.at(-1);
    content.push(
      meta(
        `Evolução de ${dataBr(e.dia)}${vig ? ` (versão vigente: retificação ${vig.seq})` : ''}`,
        {
          bold: true,
          margin: [0, 8, 0, 2],
        },
      ),
      { text: e.texto_vigente || ' ' },
    );
    if (vig) {
      content.push(tituloHist(`Histórico — original (${dataBr(e.dia)})`), textoHist(e.texto));
      for (const r of e.retificacoes.slice(0, -1)) {
        content.push(
          tituloHist(`Retificação ${r.seq} — ${dataBr(r.dia)} — Motivo: ${r.motivo}`),
          textoHist(r.texto),
        );
      }
      content.push(
        tituloHist(`Retificação ${vig.seq} (vigente) — ${dataBr(vig.dia)} — Motivo: ${vig.motivo}`),
      );
    }
  }

  return {
    info: { title: 'Prontuário', author: prof?.nome ?? '', creator: 'EvolucaoSegura' },
    pageSize: 'A4',
    pageMargins: [56, 90, 56, 60],
    defaultStyle: { font: FONTE, fontSize: 11, lineHeight: 1.25 },
    header: () => ({
      margin: [56, 28, 56, 0],
      stack: [
        { text: prof?.nome ?? '', bold: true, fontSize: 11 },
        { text: contato, fontSize: 8.5, color: '#666666', margin: [0, 2, 0, 4] },
        {
          canvas: [
            { type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 0.7, lineColor: '#999999' },
          ],
        },
      ],
    }),
    footer: (pagina: number, total: number) => ({
      margin: [56, 0, 56, 0],
      columns: [
        { text: 'Prontuário — documento confidencial', fontSize: 8, color: '#666666' },
        { text: `Página ${pagina} de ${total}`, fontSize: 8, alignment: 'right', color: '#444444' },
      ],
    }),
    content,
  };
}

// Carrega o motor e as fontes só agora (chunk separado) e devolve o PDF pronto.
export async function gerarPdfProntuario(p: Prontuario): Promise<Blob> {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  });
  return pdfMake.createPdf(montarDefinicaoProntuario(p)).getBlob();
}

// Baixa o PDF no navegador com o nome do requisito EXP-02.
export async function baixarPdfProntuario(p: Prontuario): Promise<void> {
  const blob = await gerarPdfProntuario(p);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoProntuario(p.paciente.id);
  a.click();
  URL.revokeObjectURL(url);
}
