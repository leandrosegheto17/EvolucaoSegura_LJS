import { describe, expect, it } from 'vitest';
import {
  JANELA_PENDENCIA_MS,
  chaveEventoCobranca,
  chaveEvolucaoPendente,
  chaveSessaoProxima,
  chaveTrialTerminando,
  diaEmBrasilia,
  emJanelaPendencia,
  emJanelaSessaoProxima,
  emJanelaTrialTerminando,
  intervaloSessaoProxima,
} from './janelas.ts';

// T141 / PUSH-02, PUSH-03, PUSH-04 (D-22, D-23): janelas de envio do push, regras puras com o
// tempo por parâmetro (o cron passa o horário agendado, ADR-010).
// - Sessão próxima: "faltam 15 minutos" (PUSH-02, D-22), com o cron de 5 em 5 minutos: o aviso
//   sai quando faltam de 15 a 10 minutos (design, ADR-010), os dois limites inclusive. Sessão às
//   14:00 entra nas execuções de 13:45 e 13:50 e em nenhuma outra.
// - Pendência: 20:00 em America/Sao_Paulo (PUSH-03, D-23), com compensação de execução perdida
//   até 21:00 (exclusivo; PREMISSA, ADR-010: cada tarefa declara a janela).
// - Trial: termina em 3 dias (PUSH-04): de periodo_fim - 72 h (inclusive) até periodo_fim
//   (exclusivo; no fim o trial já acabou).
// - Uma vez por sessão, por dia e por evento: a chave (tipo, ref) de notificacao_enviada.

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

// 14:00 de 10/11/2026 em Brasília = 17:00Z (UTC-3, sem horário de verão desde 2019).
const SESSAO_14H = new Date('2026-11-10T17:00:00.000Z');
const emBrasilia = (dia: string, hora: string) => new Date(`${dia}T${hora}-03:00`);

describe('sessão próxima: de 15 a 10 minutos antes (PUSH-02, D-22)', () => {
  it('sessão às 14:00 está na janela às 13:45 e às 13:50', () => {
    expect(emJanelaSessaoProxima(SESSAO_14H, emBrasilia('2026-11-10', '13:45:00'))).toBe(true);
    expect(emJanelaSessaoProxima(SESSAO_14H, emBrasilia('2026-11-10', '13:50:00'))).toBe(true);
  });

  it('e em nenhuma outra execução do cron (13:40, 13:55, 14:00)', () => {
    for (const hora of ['13:30:00', '13:35:00', '13:40:00', '13:55:00', '14:00:00', '14:05:00'])
      expect(emJanelaSessaoProxima(SESSAO_14H, emBrasilia('2026-11-10', hora)), hora).toBe(false);
  });

  it('limites exatos: 15 min inclusive e 10 min inclusive; 1 ms fora de cada lado não', () => {
    const t = SESSAO_14H.getTime();
    expect(emJanelaSessaoProxima(SESSAO_14H, new Date(t - 15 * MIN))).toBe(true);
    expect(emJanelaSessaoProxima(SESSAO_14H, new Date(t - 15 * MIN - 1))).toBe(false);
    expect(emJanelaSessaoProxima(SESSAO_14H, new Date(t - 10 * MIN))).toBe(true);
    expect(emJanelaSessaoProxima(SESSAO_14H, new Date(t - 10 * MIN + 1))).toBe(false);
  });

  it('o intervalo de início procurado numa execução é [agora + 10 min, agora + 15 min]', () => {
    const agora = emBrasilia('2026-11-10', '13:45:00');
    expect(intervaloSessaoProxima(agora)).toEqual({
      de: new Date(agora.getTime() + 10 * MIN),
      ate: new Date(agora.getTime() + 15 * MIN),
    });
  });

  it('o intervalo e a janela concordam: toda sessão do intervalo está na janela', () => {
    const agora = emBrasilia('2026-11-10', '13:45:00');
    const { de, ate } = intervaloSessaoProxima(agora);
    expect(emJanelaSessaoProxima(de, agora)).toBe(true);
    expect(emJanelaSessaoProxima(ate, agora)).toBe(true);
    expect(emJanelaSessaoProxima(new Date(de.getTime() - 1), agora)).toBe(false);
    expect(emJanelaSessaoProxima(new Date(ate.getTime() + 1), agora)).toBe(false);
  });

  it('com o cron de 5 em 5 min, toda sessão cai em pelo menos uma execução', () => {
    // Sessões de minuto em minuto entre 14:00 e 14:05: cada uma tem execução na janela.
    const execucoes = Array.from(
      { length: 12 },
      (_, i) => new Date(emBrasilia('2026-11-10', '13:30:00').getTime() + i * 5 * MIN),
    );
    for (let m = 0; m <= 5; m++) {
      const inicio = new Date(SESSAO_14H.getTime() + m * MIN);
      expect(
        execucoes.filter((agora) => emJanelaSessaoProxima(inicio, agora)).length,
        `14:0${m}`,
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('evolução pendente: 20:00 de Brasília (PUSH-03, D-23)', () => {
  it('às 20:00 de Brasília (23:00Z) está na janela', () => {
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '20:00:00'))).toBe(true);
    expect(emJanelaPendencia(new Date('2026-11-10T23:00:00.000Z'))).toBe(true);
  });

  it('às 20:00 UTC (17:00 de Brasília) não está: o fuso é o de Brasília', () => {
    expect(emJanelaPendencia(new Date('2026-11-10T20:00:00.000Z'))).toBe(false);
  });

  it('limites exatos: 19:59:59.999 fora, 20:00 dentro, até 21:00 exclusivo', () => {
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '19:59:59.999'))).toBe(false);
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '20:00:00'))).toBe(true);
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '20:55:00'))).toBe(true);
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '20:59:59.999'))).toBe(true);
    expect(emJanelaPendencia(emBrasilia('2026-11-10', '21:00:00'))).toBe(false);
    expect(JANELA_PENDENCIA_MS).toBe(HORA);
  });

  it('fora da noite não está (manhã, meia-noite, 23:59)', () => {
    for (const hora of ['00:00:00', '08:00:00', '12:00:00', '23:59:00'])
      expect(emJanelaPendencia(emBrasilia('2026-11-10', hora)), hora).toBe(false);
  });
});

describe('trial termina em 3 dias (PUSH-04)', () => {
  const FIM = new Date('2026-11-20T15:00:00.000Z');

  it('limites exatos: de fim - 3 dias (inclusive) até o fim (exclusivo)', () => {
    expect(emJanelaTrialTerminando(FIM, new Date(FIM.getTime() - 3 * DIA - 1))).toBe(false);
    expect(emJanelaTrialTerminando(FIM, new Date(FIM.getTime() - 3 * DIA))).toBe(true);
    expect(emJanelaTrialTerminando(FIM, new Date(FIM.getTime() - DIA))).toBe(true);
    expect(emJanelaTrialTerminando(FIM, new Date(FIM.getTime() - 1))).toBe(true);
    expect(emJanelaTrialTerminando(FIM, FIM)).toBe(false);
  });

  it('aceita periodo_fim como texto ISO, como vem do banco', () => {
    expect(emJanelaTrialTerminando(FIM.toISOString(), new Date(FIM.getTime() - DIA))).toBe(true);
  });
});

describe('fuso de Brasília', () => {
  it('o dia é o de Brasília, não o de UTC', () => {
    // 23:30 de 09/11 em Brasília = 02:30Z de 10/11.
    expect(diaEmBrasilia(new Date('2026-11-10T02:30:00.000Z'))).toBe('2026-11-09');
    expect(diaEmBrasilia(new Date('2026-11-10T03:00:00.000Z'))).toBe('2026-11-10');
    expect(diaEmBrasilia(new Date('2026-11-10T02:59:59.999Z'))).toBe('2026-11-09');
  });
});

describe('uma vez por sessão, por dia e por evento (chave de notificacao_enviada)', () => {
  it('por sessão: a chave é o id da sessão, a mesma em toda execução', () => {
    expect(chaveSessaoProxima('5b0c3f0e-0000-4000-8000-000000000001')).toEqual({
      tipo: 'sessao_proxima',
      ref: '5b0c3f0e-0000-4000-8000-000000000001',
    });
    expect(chaveSessaoProxima('s1')).toEqual(chaveSessaoProxima('s1'));
    expect(chaveSessaoProxima('s1')).not.toEqual(chaveSessaoProxima('s2'));
  });

  it('por dia: a chave é o dia de Brasília; 20:00 e 20:55 do mesmo dia dão a mesma', () => {
    const as20 = chaveEvolucaoPendente(emBrasilia('2026-11-10', '20:00:00'));
    expect(as20).toEqual({ tipo: 'evolucao_pendente', ref: '2026-11-10' });
    expect(chaveEvolucaoPendente(emBrasilia('2026-11-10', '20:55:00'))).toEqual(as20);
    expect(chaveEvolucaoPendente(emBrasilia('2026-11-11', '20:00:00'))).toEqual({
      tipo: 'evolucao_pendente',
      ref: '2026-11-11',
    });
  });

  it('por evento: o trial que termina é identificado pelo fim', () => {
    const fim = new Date('2026-11-20T15:00:00.000Z');
    expect(chaveTrialTerminando(fim)).toEqual({
      tipo: 'trial_terminando',
      ref: '2026-11-20T15:00:00.000Z',
    });
    expect(chaveTrialTerminando('2026-11-20T15:00:00.000Z')).toEqual(chaveTrialTerminando(fim));
  });

  it('por evento: cada evento de cobrança tem tipo e id próprios', () => {
    expect(chaveEventoCobranca('cobranca_gerada', 'pay_1')).toEqual({
      tipo: 'cobranca_gerada',
      ref: 'pay_1',
    });
    expect(chaveEventoCobranca('pagamento_confirmado', 'pay_1')).not.toEqual(
      chaveEventoCobranca('cobranca_gerada', 'pay_1'),
    );
    expect(chaveEventoCobranca('cobranca_vencida', 'pay_2')).toEqual({
      tipo: 'cobranca_vencida',
      ref: 'pay_2',
    });
  });
});
