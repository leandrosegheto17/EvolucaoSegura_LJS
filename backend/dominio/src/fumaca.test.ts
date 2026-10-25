import { describe, expect, it, vi } from 'vitest';

// Teste de fumaça (T3, OPS-05): só prova que o runner encontra e executa testes.
describe('infraestrutura de testes', () => {
  it('executa um teste com a API do Vitest disponível', () => {
    const espiao = vi.fn((x: number) => x * 2);

    expect(espiao(21)).toBe(42);
    expect(vi.isMockFunction(espiao)).toBe(true);
  });
});
