import { describe, expect, it } from 'vitest';
import { CONFIGURACOES_PADRAO, esquemaConfiguracoesEntrada } from './configuracoes.ts';

// T63 / PERF-08: configurações com privacidade_agenda (padrão falso) e sem opção de inatividade.
// Casos do parseSettingsInput do legado (backend/test/settings.spec.ts), sem IA nem inatividade.

const aceita = (corpo: unknown) => esquemaConfiguracoesEntrada.safeParse(corpo).success;

describe('configurações (PERF-08)', () => {
  it('privacidade_agenda tem padrão falso', () => {
    expect(CONFIGURACOES_PADRAO).toEqual({ privacidade_agenda: false });
  });

  it('aceita privacidade_agenda booleana', () => {
    expect(esquemaConfiguracoesEntrada.parse({ privacidade_agenda: true })).toEqual({
      privacidade_agenda: true,
    });
    expect(aceita({ privacidade_agenda: false })).toBe(true);
  });

  it('recusa tipo errado, corpo vazio e corpo que não é objeto (legado)', () => {
    for (const ruim of [null, [], {}, { privacidade_agenda: 1 }, { privacidade_agenda: 'sim' }])
      expect(aceita(ruim), JSON.stringify(ruim)).toBe(false);
  });

  it('sem opção de inatividade nem de IA: as chaves do legado são desconhecidas', () => {
    expect(aceita({ privacidade_agenda: true, inatividade_min: 15 })).toBe(false);
    expect(aceita({ privacidade_agenda: true, ia_habilitada: false })).toBe(false);
    expect(aceita({ privacidade_agenda: true, usuario_id: 'x' })).toBe(false);
  });
});
