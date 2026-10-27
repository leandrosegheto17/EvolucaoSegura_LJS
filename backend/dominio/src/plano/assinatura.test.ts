import { describe, expect, it } from 'vitest';
import {
  avaliarTransicaoAssinatura,
  ESTADOS_ASSINATURA,
  type EstadoAssinatura,
  estadoPorTempo,
  limitePacientes,
  planoEfetivo,
  proLiberado,
  toleranciaEsgotada,
  transicaoAssinaturaPermitida,
} from './assinatura.ts';

// T125 / PLANO-01, 02, 03, 04, 10, 11: regras puras da assinatura, escritas a partir da spec
// (seção "Planos, trial e cobrança pelo Asaas") e de D-20/D-21. O tempo vem sempre por parâmetro.

const H = 60 * 60 * 1000;
const D = 24 * H;
const AGORA = new Date('2026-10-27T12:00:00.000Z');
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
const depois = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

// PLANO-01, copiada da spec.
const PERMITIDAS: Record<EstadoAssinatura, EstadoAssinatura[]> = {
  trial: ['ativa', 'free'],
  ativa: ['atrasada', 'cancelada'],
  atrasada: ['ativa', 'free'],
  cancelada: ['free'],
  free: ['ativa'],
};

const ESTADOS: EstadoAssinatura[] = ['trial', 'ativa', 'atrasada', 'cancelada', 'free'];
const pares = ESTADOS.flatMap((de) => ESTADOS.map((para) => [de, para] as const));

describe('estados (PLANO-01)', () => {
  it('são exatamente os cinco da spec', () => {
    expect([...ESTADOS_ASSINATURA].sort()).toEqual([...ESTADOS].sort());
  });
});

describe('matriz de transições 5x5 (PLANO-01)', () => {
  const aceitas = pares.filter(([de, para]) => PERMITIDAS[de].includes(para));
  const recusadas = pares.filter(([de, para]) => !PERMITIDAS[de].includes(para));

  it('cobre os 25 pares: 8 aceitas e 17 recusadas', () => {
    expect(aceitas).toHaveLength(8);
    expect(recusadas).toHaveLength(17);
  });

  it.each(aceitas)('%s -> %s é aceita', (de, para) => {
    expect(avaliarTransicaoAssinatura(de, para)).toBe('permitida');
    expect(transicaoAssinaturaPermitida(de, para)).toBe(true);
  });

  // Inclui o mesmo estado (diagonal): a spec lista só as transições acima.
  it.each(recusadas)('%s -> %s é recusada', (de, para) => {
    expect(avaliarTransicaoAssinatura(de, para)).toBe('transicao_invalida');
    expect(transicaoAssinaturaPermitida(de, para)).toBe(false);
  });
});

describe('tolerância de 7 dias em atrasada (PLANO-10, D-21)', () => {
  it('6 dias e 23 horas depois do vencimento ainda está na tolerância', () => {
    expect(toleranciaEsgotada(antes(6 * D + 23 * H), AGORA)).toBe(false);
  });

  it('um milissegundo antes de 7 dias ainda está na tolerância', () => {
    expect(toleranciaEsgotada(antes(7 * D - 1), AGORA)).toBe(false);
  });

  it('exatamente 7 dias depois do vencimento esgota a tolerância', () => {
    expect(toleranciaEsgotada(antes(7 * D), AGORA)).toBe(true);
  });

  it('depois de 7 dias está esgotada', () => {
    expect(toleranciaEsgotada(antes(7 * D + 1), AGORA)).toBe(true);
    expect(toleranciaEsgotada(antes(30 * D), AGORA)).toBe(true);
  });

  it('aceita Date ou string ISO', () => {
    expect(toleranciaEsgotada(new Date(antes(7 * D)), AGORA)).toBe(true);
  });

  it('atrasada com vencimento_atraso esgotado cai para free', () => {
    expect(
      estadoPorTempo(
        { status: 'atrasada', periodo_fim: antes(7 * D), vencimento_atraso: antes(7 * D) },
        AGORA,
      ),
    ).toBe('free');
  });

  it('atrasada dentro da tolerância continua atrasada', () => {
    expect(
      estadoPorTempo(
        {
          status: 'atrasada',
          periodo_fim: antes(6 * D + 23 * H),
          vencimento_atraso: antes(6 * D + 23 * H),
        },
        AGORA,
      ),
    ).toBe('atrasada');
  });

  it('atrasada sem vencimento_atraso conta a tolerância a partir de periodo_fim', () => {
    const base = { status: 'atrasada', vencimento_atraso: null } as const;
    expect(estadoPorTempo({ ...base, periodo_fim: antes(7 * D) }, AGORA)).toBe('free');
    expect(estadoPorTempo({ ...base, periodo_fim: antes(6 * D) }, AGORA)).toBe('atrasada');
  });
});

describe('trial vencido sem pagamento vira free (PLANO-04)', () => {
  const trial = (periodo_fim: string) =>
    ({ status: 'trial', periodo_fim, vencimento_atraso: null }) as const;

  it('periodo_fim no passado: free', () => {
    expect(estadoPorTempo(trial(antes(1)), AGORA)).toBe('free');
  });

  it('periodo_fim igual a agora: free (não está mais no futuro)', () => {
    expect(estadoPorTempo(trial(AGORA.toISOString()), AGORA)).toBe('free');
  });

  it('periodo_fim no futuro: continua trial', () => {
    expect(estadoPorTempo(trial(depois(1)), AGORA)).toBe('trial');
  });
});

describe('cancelada mantém o Pro até periodo_fim (PLANO-11)', () => {
  const cancelada = (periodo_fim: string) =>
    ({ status: 'cancelada', periodo_fim, vencimento_atraso: null }) as const;

  it('periodo_fim no passado: free', () => {
    expect(estadoPorTempo(cancelada(antes(1)), AGORA)).toBe('free');
  });

  it('periodo_fim igual a agora: free', () => {
    expect(estadoPorTempo(cancelada(AGORA.toISOString()), AGORA)).toBe('free');
  });

  it('periodo_fim no futuro: continua cancelada', () => {
    expect(estadoPorTempo(cancelada(depois(1)), AGORA)).toBe('cancelada');
  });
});

describe('estados que o tempo não muda', () => {
  it.each(['ativa', 'free'] as const)('%s fica como está, com periodo_fim no passado', (status) => {
    expect(
      estadoPorTempo({ status, periodo_fim: antes(60 * D), vencimento_atraso: null }, AGORA),
    ).toBe(status);
  });

  it('toda mudança por tempo é uma transição permitida', () => {
    for (const status of ESTADOS) {
      for (const periodo_fim of [antes(60 * D), AGORA.toISOString(), depois(60 * D)]) {
        const para = estadoPorTempo({ status, periodo_fim, vencimento_atraso: periodo_fim }, AGORA);
        if (para !== status) expect(transicaoAssinaturaPermitida(status, para)).toBe(true);
      }
    }
  });
});

describe('quando o Pro está liberado (PLANO-02)', () => {
  const com = (
    status: EstadoAssinatura,
    periodo_fim: string,
    vencimento_atraso: string | null = null,
  ) => proLiberado({ status, periodo_fim, vencimento_atraso }, AGORA);

  it.each(['trial', 'cancelada'] as const)('%s: libera só com periodo_fim no futuro', (status) => {
    expect(com(status, depois(1))).toBe(true);
    expect(com(status, AGORA.toISOString())).toBe(false);
    expect(com(status, antes(1))).toBe(false);
  });

  it('ativa: libera com periodo_fim no futuro, igual a agora ou no passado', () => {
    expect(com('ativa', depois(1))).toBe(true);
    expect(com('ativa', AGORA.toISOString())).toBe(true);
    expect(com('ativa', antes(1))).toBe(true);
  });

  it('atrasada: libera durante a tolerância de 7 dias e não depois', () => {
    expect(com('atrasada', antes(6 * D + 23 * H), antes(6 * D + 23 * H))).toBe(true);
    expect(com('atrasada', antes(7 * D), antes(7 * D))).toBe(false);
    expect(com('atrasada', antes(8 * D), antes(8 * D))).toBe(false);
  });

  it('free: nunca libera', () => {
    expect(com('free', depois(30 * D))).toBe(false);
    expect(com('free', antes(1))).toBe(false);
  });

  it('planoEfetivo segue proLiberado', () => {
    expect(
      planoEfetivo({ status: 'trial', periodo_fim: depois(1), vencimento_atraso: null }, AGORA),
    ).toBe('pro');
    expect(
      planoEfetivo({ status: 'trial', periodo_fim: antes(1), vencimento_atraso: null }, AGORA),
    ).toBe('free');
    expect(
      planoEfetivo({ status: 'free', periodo_fim: depois(1), vencimento_atraso: null }, AGORA),
    ).toBe('free');
  });
});

describe('limite de pacientes do Free (PLANO-03, D-20)', () => {
  it('Free com 4 ativos: ok', () => {
    expect(limitePacientes('free', 4)).toBe('ok');
  });

  it('Free com 0 ativos: ok', () => {
    expect(limitePacientes('free', 0)).toBe('ok');
  });

  it('Free com 5 ativos: LIMITE_PLANO', () => {
    expect(limitePacientes('free', 5)).toBe('LIMITE_PLANO');
  });

  it('Free com 6 ativos: LIMITE_PLANO', () => {
    expect(limitePacientes('free', 6)).toBe('LIMITE_PLANO');
  });

  it.each([0, 4, 5, 6, 500])('Pro com %i ativos: ok, sem limite', (ativos) => {
    expect(limitePacientes('pro', ativos)).toBe('ok');
  });
});
