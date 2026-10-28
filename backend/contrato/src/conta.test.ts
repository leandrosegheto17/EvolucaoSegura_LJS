import { describe, expect, it } from 'vitest';
import {
  REQUISITOS_EXCLUSAO,
  esquemaPedirExclusao,
  esquemaTokenExclusao,
  problemaRequisitosExclusao,
} from './conta.ts';
import { esquemaProblema } from './identidade.ts';

// T149 / CONTA-01: contrato do pedido de exclusão. Campo ausente é requisito que falta (a rota
// responde 422 requisitos_exclusao), não erro de formato; tipo errado ou chave extra é recusado.

describe('pedido de exclusão (CONTA-01)', () => {
  it('aceita senha e declaração, e também o corpo vazio', () => {
    expect(esquemaPedirExclusao.parse({ senha: 's', declaracao_guarda: true })).toEqual({
      senha: 's',
      declaracao_guarda: true,
    });
    expect(esquemaPedirExclusao.parse({})).toEqual({});
  });

  it('recusa tipo errado e chave desconhecida', () => {
    expect(esquemaPedirExclusao.safeParse({ declaracao_guarda: 'true' }).success).toBe(false);
    expect(esquemaPedirExclusao.safeParse({ senha: 1 }).success).toBe(false);
    expect(esquemaPedirExclusao.safeParse({ outra: 1 }).success).toBe(false);
  });

  it('o 422 lista os requisitos que faltam e segue o corpo de problema do projeto', () => {
    const corpo = problemaRequisitosExclusao([...REQUISITOS_EXCLUSAO]);
    expect(esquemaProblema.parse(corpo)).toEqual({
      tipo: 'about:blank',
      titulo: 'Faltam requisitos para excluir a conta',
      status: 422,
      codigo: 'requisitos_exclusao',
      requisitos: ['exportacao', 'declaracao_guarda', 'senha'],
    });
  });

  it('o link de confirmação e o de desistência levam só o token', () => {
    expect(esquemaTokenExclusao.parse({ token: 'abc' })).toEqual({ token: 'abc' });
    expect(esquemaTokenExclusao.safeParse({ token: 'abc', outra: 1 }).success).toBe(false);
  });
});
