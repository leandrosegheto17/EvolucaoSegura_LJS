import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { esquemaAmbiente } from '../../api/src/ambiente.ts';

// OPS-11: o .env.example lista toda variável com obrigatoriedade, formato e se é segredo, e
// nenhum segredo fica em arquivo versionado. Roda em Node porque lê arquivo da raiz do repositório.

describe('.env.example', () => {
  const texto = readFileSync(resolve(import.meta.dirname, '../../../.env.example'), 'utf8');
  const linhas = texto.split(/\r?\n/);
  const entradas = linhas.flatMap((linha, indice) => {
    const atribuicao = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(linha);
    if (!atribuicao) return [];
    const nome = atribuicao[1] as string;
    const documentacao = linhas
      .slice(0, indice)
      .reverse()
      .find((anterior) => anterior.startsWith(`# ${nome} |`));
    return [{ nome, valor: atribuicao[2] as string, documentacao }];
  });

  it('lista toda variável do schema', () => {
    const nomes = entradas.map((entrada) => entrada.nome);

    for (const variavel of Object.keys(esquemaAmbiente.shape)) expect(nomes).toContain(variavel);
  });

  it('documenta cada variável com obrigatoriedade, formato e se é segredo', () => {
    expect(entradas.length).toBeGreaterThan(0);
    for (const entrada of entradas) {
      const partes = (entrada.documentacao ?? '').split(' | ');
      expect(partes, entrada.nome).toHaveLength(4);
      expect(partes[1], entrada.nome).toMatch(/^(obrigatória|opcional)/);
      expect(partes[2]?.trim().length, entrada.nome).toBeGreaterThan(0);
      expect(partes[3], entrada.nome).toMatch(/^(segredo|não é segredo)$/);
    }
  });

  it('não traz valor para variável marcada como segredo', () => {
    const segredos = entradas.filter((entrada) => entrada.documentacao?.endsWith('| segredo'));

    expect(segredos.length).toBeGreaterThan(0);
    for (const entrada of segredos) expect(entrada.valor, entrada.nome).toBe('');
  });
});
