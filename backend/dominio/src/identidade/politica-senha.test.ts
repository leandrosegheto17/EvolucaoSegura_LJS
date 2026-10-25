import { describe, expect, it } from 'vitest';
import {
  SENHAS_COMUNS,
  SENHA_MAX_CARACTERES,
  SENHA_MIN_CARACTERES,
  avaliarSenha,
} from './politica-senha.ts';

// T38 / AUTH-11: menos de 12 caracteres = `curta`; mais de 128 = `longa`; senha da lista de
// comuns (comparada após NFKC, minúsculas e sem espaços) ou um único caractere repetido = `comum`.
// Os casos marcados "legado" vêm de password-policy.spec.ts e password.spec.ts do legado.

describe('limites de tamanho', () => {
  it('são 12 e 128 caracteres', () => {
    expect([SENHA_MIN_CARACTERES, SENHA_MAX_CARACTERES]).toEqual([12, 128]);
  });

  it('recusa 11 caracteres como curta e aceita 12', () => {
    expect(avaliarSenha('cavalo-bat7')).toBe('curta');
    expect(avaliarSenha('cavalo-bate7')).toBeNull();
  });

  it('aceita 128 caracteres e recusa 129 como longa', () => {
    const base = 'cavalo-bateria-grampo-7';
    const com = (n: number) => base.repeat(6).slice(0, n);
    expect(avaliarSenha(com(128))).toBeNull();
    expect(avaliarSenha(com(129))).toBe('longa');
  });

  it('recusa senha vazia como curta', () => {
    expect(avaliarSenha('')).toBe('curta');
  });

  it('legado: rejeita < 12 caracteres', () => expect(avaliarSenha('curta123')).toBe('curta'));
  it('legado: rejeita acima de 128', () => expect(avaliarSenha('x1'.repeat(65))).toBe('longa'));
});

describe('senhas comuns', () => {
  it('a lista tem as 124 senhas do legado, sem repetição', () => {
    expect(SENHAS_COMUNS).toHaveLength(124);
    expect(new Set(SENHAS_COMUNS).size).toBe(124);
  });

  it('recusa como comum cada senha da lista com 12 ou mais caracteres', () => {
    const recusadas = SENHAS_COMUNS.filter((s) => s.length >= 12).map(avaliarSenha);
    expect(new Set(recusadas)).toEqual(new Set(['comum']));
  });

  it('legado: rejeita senha comum, ignorando caixa e espaços', () => {
    expect(avaliarSenha('PassWord 12345')).toBe('comum');
    expect(avaliarSenha('aaaaaaaaaaaaaa')).toBe('comum');
  });

  it.each([
    'iloveyou12345',
    'qwerty123456',
    'abcd12345678',
    'password2024!',
    'senha@123456',
    'Brasil@123456',
    'mudar@123456',
    'trocar123456',
    'ninguem123456',
    'qwertyuiop123',
    '123456789abc',
    '12345678910111',
  ])('legado: rejeita comum ampliada: %s', (s) => expect(avaliarSenha(s)).toBe('comum'));

  it('legado: aplica NFKC (formas full-width equivalem a ASCII)', () => {
    expect(avaliarSenha('ｐａｓｓｗｏｒｄ１２３４')).toBe('comum');
  });

  it('legado: NFKC faz acentos compostos e decompostos equivalerem', () => {
    expect(avaliarSenha('evoluçãosegura')).toBe('comum');
    expect(avaliarSenha('evoluçãosegura')).toBe('comum');
  });

  it('compara sem espaços em qualquer posição, inclusive tabulação', () => {
    expect(avaliarSenha(' QWERTY 123456 ')).toBe('comum');
    expect(avaliarSenha('qwerty\t123456')).toBe('comum');
  });
});

describe('caractere repetido', () => {
  it.each(['aaaaaaaaaaaa', '111111111111111', 'ZZZZZZZZZZZZZZZZ', '€€€€€€€€€€€€'])(
    'recusa %s como comum',
    (s) => expect(avaliarSenha(s)).toBe('comum'),
  );

  it('recusa caractere repetido mesmo com caixa ou espaços diferentes', () => {
    expect(avaliarSenha('aAaAaAaAaAaAaA')).toBe('comum');
    expect(avaliarSenha('bbbb bbbb bbbb')).toBe('comum');
  });

  it('aceita dois caracteres alternados que não estão na lista', () => {
    expect(avaliarSenha('abababababab')).toBeNull();
  });
});

describe('senha forte', () => {
  it('legado: mantém o aceite de senha forte', () => {
    expect(avaliarSenha('cavalo-bateria-grampo-7')).toBeNull();
  });

  it('mede o tamanho antes de normalizar (12 com espaços é aceito se não for comum)', () => {
    expect(avaliarSenha('cavalo grampo')).toBeNull();
  });
});
