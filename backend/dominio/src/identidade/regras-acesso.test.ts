import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type EstadoFalhas,
  ESTADO_SEM_FALHAS,
  aposErro2fa,
  aposFalhaLogin,
  bloqueioLogin,
  desafio2faInvalidado,
  expiracaoSessao,
  podeReenviarCodigo,
  sessaoExpirada,
} from './regras-acesso.ts';

// T39 / AUTH-05, AUTH-06, AUTH-07, AUTH-09: regras puras de acesso, testadas nos extremos.
// - Sessão: encerra após 15 min sem requisição autenticada ou 12 h desde o login, o que vier
//   primeiro (aos 15:00 e às 12:00:00 já está encerrada; 14:59 e 11:59:59 ainda valem).
// - Bloqueio: 5 falhas em 15 min bloqueiam por 15 min, com Retry-After em segundos.
// - 2FA: o 5º código errado invalida o desafio.
// - Reenvio: só com mais de 60 s desde o último envio.
// O "agora" é sempre parâmetro: o relógio do processo não influi (o da API vem do banco).

const T0 = new Date('2026-10-25T12:00:00.000Z');
const mais = (base: Date, ms: number) => new Date(base.getTime() + ms);
const s = 1000;
const min = 60 * s;
const h = 60 * min;

afterEach(() => {
  vi.useRealTimers();
});

describe('sessão (AUTH-09)', () => {
  const sessao = { criadaEm: T0, ultimoUsoEm: T0 };

  it('vale aos 14:59 sem uso e encerra aos 15:00', () => {
    expect(sessaoExpirada(sessao, mais(T0, 14 * min + 59 * s))).toBe(false);
    expect(sessaoExpirada(sessao, mais(T0, 15 * min))).toBe(true);
  });

  it('cada uso renova a inatividade de 15 minutos', () => {
    const usada = { criadaEm: T0, ultimoUsoEm: mais(T0, 10 * min) };
    expect(sessaoExpirada(usada, mais(T0, 24 * min + 59 * s))).toBe(false);
    expect(sessaoExpirada(usada, mais(T0, 25 * min))).toBe(true);
  });

  it('encerra às 12 h do login mesmo com uso contínuo', () => {
    const ativa = { criadaEm: T0, ultimoUsoEm: mais(T0, 11 * h + 59 * min) };
    expect(sessaoExpirada(ativa, mais(T0, 12 * h - s))).toBe(false);
    expect(sessaoExpirada(ativa, mais(T0, 12 * h))).toBe(true);
  });

  it('a expiração é o que vier primeiro: inatividade ou 12 h', () => {
    expect(expiracaoSessao(sessao)).toEqual(mais(T0, 15 * min));
    expect(expiracaoSessao({ criadaEm: T0, ultimoUsoEm: mais(T0, 11 * h + 50 * min) })).toEqual(
      mais(T0, 12 * h),
    );
  });
});

describe('bloqueio por falhas de login (AUTH-07)', () => {
  const falhasEm = (...instantes: number[]): EstadoFalhas =>
    instantes.reduce<EstadoFalhas>(
      (estado, ms) => aposFalhaLogin(estado, mais(T0, ms)),
      ESTADO_SEM_FALHAS,
    );

  it('4 falhas em 15 minutos não bloqueiam', () => {
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min);
    expect(bloqueioLogin(estado, mais(T0, 3 * min))).toEqual({ bloqueado: false });
  });

  it('a 5ª falha em 15 minutos bloqueia por 15 minutos, com Retry-After em segundos', () => {
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min, 4 * min);
    expect(bloqueioLogin(estado, mais(T0, 4 * min))).toEqual({
      bloqueado: true,
      retryAfterSegundos: 900,
    });
  });

  it('a 5ª falha aos 14:59 da primeira ainda bloqueia', () => {
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min, 14 * min + 59 * s);
    expect(bloqueioLogin(estado, mais(T0, 14 * min + 59 * s)).bloqueado).toBe(true);
  });

  it('a 5ª falha aos 15:00 da primeira já é de outra janela e não bloqueia', () => {
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min, 15 * min);
    expect(bloqueioLogin(estado, mais(T0, 15 * min))).toEqual({ bloqueado: false });
  });

  it('o bloqueio vale até 14:59 depois da 5ª falha e acaba aos 15:00', () => {
    const quinta = 4 * min;
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min, quinta);
    expect(bloqueioLogin(estado, mais(T0, quinta + 14 * min + 59 * s))).toEqual({
      bloqueado: true,
      retryAfterSegundos: 1,
    });
    expect(bloqueioLogin(estado, mais(T0, quinta + 15 * min))).toEqual({ bloqueado: false });
  });

  it('arredonda o Retry-After para cima (nunca 0 enquanto bloqueado)', () => {
    const estado = falhasEm(0, 1, 2, 3, 4);
    expect(bloqueioLogin(estado, mais(T0, 4 + 15 * min - 1))).toEqual({
      bloqueado: true,
      retryAfterSegundos: 1,
    });
  });

  it('depois do bloqueio, uma nova falha recomeça a contagem', () => {
    const estado = falhasEm(0, 1 * min, 2 * min, 3 * min, 4 * min, 19 * min);
    expect(estado.falhas).toBe(1);
    expect(bloqueioLogin(estado, mais(T0, 19 * min))).toEqual({ bloqueado: false });
  });

  it('sem falhas não há bloqueio', () => {
    expect(bloqueioLogin(ESTADO_SEM_FALHAS, T0)).toEqual({ bloqueado: false });
  });
});

describe('tentativas de 2FA (AUTH-05)', () => {
  it('o 4º erro mantém o desafio e o 5º o invalida', () => {
    expect(aposErro2fa(3)).toEqual({ erros: 4, invalidado: false });
    expect(aposErro2fa(4)).toEqual({ erros: 5, invalidado: true });
  });

  it('desafio com 5 erros ou mais recusa novos códigos', () => {
    expect(desafio2faInvalidado(4)).toBe(false);
    expect(desafio2faInvalidado(5)).toBe(true);
    expect(desafio2faInvalidado(6)).toBe(true);
  });
});

describe('reenvio do código (AUTH-06)', () => {
  it('não reenvia aos 59 s nem aos 60 s; reenvia aos 61 s', () => {
    expect(podeReenviarCodigo(T0, mais(T0, 59 * s))).toBe(false);
    expect(podeReenviarCodigo(T0, mais(T0, 60 * s))).toBe(false);
    expect(podeReenviarCodigo(T0, mais(T0, 61 * s))).toBe(true);
  });

  it('reenvia logo depois de 60 s (60,001 s)', () => {
    expect(podeReenviarCodigo(T0, mais(T0, 60 * s + 1))).toBe(true);
  });
});

describe('tempo sempre por parâmetro', () => {
  it('o relógio do processo não muda nenhum resultado', () => {
    const avaliar = () => [
      sessaoExpirada({ criadaEm: T0, ultimoUsoEm: T0 }, mais(T0, 14 * min)),
      bloqueioLogin(aposFalhaLogin(ESTADO_SEM_FALHAS, T0), T0),
      podeReenviarCodigo(T0, mais(T0, 30 * s)),
    ];
    const antes = avaliar();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    expect(avaliar()).toEqual(antes);
    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
    expect(avaliar()).toEqual(antes);
  });
});
