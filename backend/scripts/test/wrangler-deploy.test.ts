import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// OPS-04: o deploy do Worker aparece só no .github/workflows/deploy.yml. O comando é montado em
// partes para este arquivo não ser acusado por ele mesmo.
const COMANDO = /wrangler\s+deploy/;
const ARQUIVO_PERMITIDO = '.github/workflows/deploy.yml';

// Documentação (.md, .specs, docs), dependências e saídas de build ficam de fora: citar o comando
// em texto não publica nada.
const PASTAS_IGNORADAS = new Set([
  'node_modules',
  '.git',
  '.specs',
  '.md',
  '.rascunho',
  '.claude',
  '.claude_legado',
  'docs',
  'dist',
  '.wrangler',
  'coverage',
]);
const LIMITE_DE_TAMANHO = 1_000_000;

function arquivosComDeploy(raiz: string): string[] {
  const achados: string[] = [];
  const visitar = (pasta: string): void => {
    for (const entrada of readdirSync(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) {
        if (!PASTAS_IGNORADAS.has(entrada.name)) visitar(caminho);
        continue;
      }
      if (entrada.name.endsWith('.md') || statSync(caminho).size > LIMITE_DE_TAMANHO) continue;
      if (COMANDO.test(readFileSync(caminho, 'utf8'))) {
        achados.push(relative(raiz, caminho).split(sep).join('/'));
      }
    }
  };
  visitar(raiz);
  return achados.sort();
}

const raizDoRepositorio = resolve(import.meta.dirname, '../../..');
const temporarios: string[] = [];

function arvoreDeExemplo(arquivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), 'deploy-'));
  temporarios.push(raiz);
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(join(raiz, caminho, '..'), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  return raiz;
}

afterAll(() => {
  for (const pasta of temporarios) rmSync(pasta, { recursive: true, force: true });
});

const deploy = ['wrangler', 'deploy'].join(' ');

describe('único deploy do Worker (OPS-04)', () => {
  it('o repositório só tem o comando no deploy.yml', () => {
    expect(arquivosComDeploy(raizDoRepositorio)).toEqual([ARQUIVO_PERMITIDO]);
  });

  it('falha se o comando aparecer em outro arquivo (árvore de exemplo)', () => {
    const raiz = arvoreDeExemplo({
      '.github/workflows/deploy.yml': `run: ${deploy}`,
      '.github/workflows/ci.yml': `run: npx ${deploy} --dry-run`,
      'package.json': `{"scripts":{"publicar":"${['wrangler', 'deploy'].join('  ')}"}}`,
      'scripts/publicar.sh': `#!/bin/sh\n${deploy}`,
    });

    expect(arquivosComDeploy(raiz)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/deploy.yml',
      'package.json',
      'scripts/publicar.sh',
    ]);
  });

  it('ignora documentação, .specs, docs e node_modules', () => {
    const raiz = arvoreDeExemplo({
      'README.md': deploy,
      '.specs/tasks.md': deploy,
      '.md/GUARDRAILS.md': deploy,
      'docs/runbook.txt': deploy,
      'node_modules/x/index.js': deploy,
    });

    expect(arquivosComDeploy(raiz)).toEqual([]);
  });
});
