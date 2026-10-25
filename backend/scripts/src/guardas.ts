import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Detectores das guardas de código (OPS-10 e OPS-14). Ficam fora do arquivo de teste para que o
// teste possa provar, com uma árvore de exemplo, que cada guarda realmente falha.

const PASTAS_IGNORADAS = new Set(['node_modules', 'dist', '.wrangler', 'coverage']);
const EXTENSOES = /\.(ts|tsx|js|mjs|cjs|sql|html|css)$/;
const ARQUIVO_DE_TESTE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// OPS-10: URL absoluta do app (com protocolo). Endereço de e-mail do domínio não conta.
const URL_DO_APP = /https?:\/\/([a-z0-9-]+\.)*evolucaosegura\.com\.br/i;

export function temUrlAbsolutaDoApp(texto: string): boolean {
  return URL_DO_APP.test(texto);
}

// OPS-14: o Worker não calcula hash de senha nem gera PDF.
export const BIBLIOTECAS_PROIBIDAS_NA_API = [
  'bcrypt',
  'bcryptjs',
  'bcrypt-ts',
  '@node-rs/bcrypt',
  'argon2',
  '@node-rs/argon2',
  'pdfmake',
  'pdfkit',
  'jspdf',
  'pdf-lib',
  '@react-pdf/renderer',
  'puppeteer',
];

interface PacoteJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function dependenciasProibidas(pacote: PacoteJson): string[] {
  const declaradas = [
    pacote.dependencies,
    pacote.devDependencies,
    pacote.optionalDependencies,
    pacote.peerDependencies,
  ].flatMap((grupo) => Object.keys(grupo ?? {}));
  return declaradas.filter((nome) => BIBLIOTECAS_PROIBIDAS_NA_API.includes(nome));
}

export function importacoesProibidas(texto: string): string[] {
  return BIBLIOTECAS_PROIBIDAS_NA_API.filter((nome) => {
    const escapado = nome.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`(from\\s+|require\\(\\s*|import\\(\\s*)['"]${escapado}(/[^'"]*)?['"]`).test(
      texto,
    );
  });
}

// Arquivos de código e de migration sob `raiz`, sem testes, dependências e saídas de build.
export function listarArquivosDeCodigo(raiz: string): string[] {
  const achados: string[] = [];
  const visitar = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) {
        if (!PASTAS_IGNORADAS.has(entrada.name) && entrada.name !== 'test') visitar(caminho);
      } else if (EXTENSOES.test(entrada.name) && !ARQUIVO_DE_TESTE.test(entrada.name)) {
        achados.push(caminho);
      }
    }
  };
  visitar(raiz);
  return achados;
}

export function arquivosComUrlDoApp(raiz: string): string[] {
  return listarArquivosDeCodigo(raiz)
    .filter((arquivo) => temUrlAbsolutaDoApp(readFileSync(arquivo, 'utf8')))
    .map((arquivo) => relative(raiz, arquivo).split(sep).join('/'));
}

export function arquivosComImportacaoProibida(raiz: string): string[] {
  return listarArquivosDeCodigo(raiz)
    .filter((arquivo) => importacoesProibidas(readFileSync(arquivo, 'utf8')).length > 0)
    .map((arquivo) => relative(raiz, arquivo).split(sep).join('/'));
}
