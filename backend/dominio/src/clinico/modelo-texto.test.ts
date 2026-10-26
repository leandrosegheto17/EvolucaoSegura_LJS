import { describe, expect, it } from 'vitest';
import { TIPOS_MODELO_TEXTO, nomeEmUso } from './modelo-texto.ts';

// T99 / RAS-03: modelos de texto só do tipo `evolucao`, nome único sem diferenciar maiúsculas
// entre os não arquivados (como o índice do legado, modelo_texto_nome_ativo_uq).

const EXISTENTES = [
  { id: 'm1', nome: 'Sessão inicial', arquivado: false },
  { id: 'm2', nome: 'Retorno', arquivado: true },
];

describe('tipos de modelo de texto (RAS-03)', () => {
  it('só evolucao (relatorio saiu com D-01)', () => {
    expect(TIPOS_MODELO_TEXTO).toEqual(['evolucao']);
  });
});

describe('nomeEmUso (RAS-03)', () => {
  it('o mesmo nome com outra caixa já está em uso', () => {
    expect(nomeEmUso('SESSÃO INICIAL', EXISTENTES)).toBe(true);
    expect(nomeEmUso('sessão inicial', EXISTENTES)).toBe(true);
  });

  it('compara o nome aparado', () => {
    expect(nomeEmUso('  Sessão inicial ', EXISTENTES)).toBe(true);
  });

  it('nome de modelo arquivado fica livre', () => {
    expect(nomeEmUso('retorno', EXISTENTES)).toBe(false);
  });

  it('nome novo está livre', () => {
    expect(nomeEmUso('Alta', EXISTENTES)).toBe(false);
  });

  it('o próprio modelo não conta (renomear trocando só a caixa)', () => {
    expect(nomeEmUso('SESSÃO INICIAL', EXISTENTES, 'm1')).toBe(false);
  });
});
