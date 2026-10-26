import { describe, expect, it } from 'vitest';
import { type DadosPerfil, camposAlterados, perfilCompleto, resolverPerfil } from './perfil.ts';

// T62 / PERF-01, PERF-02, PERF-03, PERF-09: o PUT substitui os textos, preserva fim de semana e
// especialidade quando ausentes (legado, RF-23d) e a auditoria recebe só os nomes dos campos que
// mudaram de fato. Casos do T-215 do legado (backend/test/profile.spec.ts) vêm junto.

const ATUAL: DadosPerfil = {
  nome: 'Dra. Ana',
  contato: '111',
  endereco: null,
  atende_sabado: true,
  atende_domingo: false,
  especialidade: 'psicologia',
  especialidade_nome: null,
  conselho: 'CRP',
  numero_registro: '06/1',
  regiao: 'SP',
};

const entrada = (extra: Partial<Parameters<typeof resolverPerfil>[1]> = {}) => ({
  nome: 'Dra. Ana',
  contato: '111',
  endereco: null,
  ...extra,
});

describe('resolverPerfil', () => {
  it('primeiro salvamento sem fim de semana nem especialidade: falso, falso e nula', () => {
    expect(resolverPerfil(null, entrada())).toEqual({
      nome: 'Dra. Ana',
      contato: '111',
      endereco: null,
      atende_sabado: false,
      atende_domingo: false,
      especialidade: null,
      especialidade_nome: null,
      conselho: null,
      numero_registro: null,
      regiao: null,
    });
  });

  it('fim de semana ausente preserva; só sábado não muda domingo (legado T-215)', () => {
    expect(resolverPerfil(ATUAL, entrada())).toMatchObject({
      atende_sabado: true,
      atende_domingo: false,
    });
    expect(resolverPerfil(ATUAL, entrada({ atende_domingo: true }))).toMatchObject({
      atende_sabado: true,
      atende_domingo: true,
    });
    expect(resolverPerfil(ATUAL, entrada({ atende_sabado: false }))).toMatchObject({
      atende_sabado: false,
      atende_domingo: false,
    });
  });

  it('especialidade ausente preserva a atual, com o registro', () => {
    expect(resolverPerfil(ATUAL, entrada())).toMatchObject({
      especialidade: 'psicologia',
      conselho: 'CRP',
      numero_registro: '06/1',
      regiao: 'SP',
    });
  });

  it('especialidade informada substitui a atual inteira, registro incluído', () => {
    expect(
      resolverPerfil(
        ATUAL,
        entrada({
          especialidade: {
            tipo: 'outra',
            nome: 'Arteterapia',
            conselho: null,
            numero_registro: null,
            regiao: null,
          },
        }),
      ),
    ).toMatchObject({
      especialidade: 'outra',
      especialidade_nome: 'Arteterapia',
      conselho: null,
      numero_registro: null,
      regiao: null,
    });
  });

  it('textos ausentes ou vazios (null) substituem os atuais', () => {
    expect(resolverPerfil(ATUAL, { nome: 'Ana', contato: null, endereco: null })).toMatchObject({
      nome: 'Ana',
      contato: null,
    });
  });
});

describe('camposAlterados (PERF-09)', () => {
  it('sem mudança, nenhum campo', () => {
    expect(camposAlterados(ATUAL, { ...ATUAL })).toEqual([]);
  });

  it('só os nomes dos campos que mudaram', () => {
    expect(
      camposAlterados(ATUAL, { ...ATUAL, nome: 'Dra. Ana Souza', atende_sabado: false }),
    ).toEqual(['nome', 'atende_sabado']);
    expect(
      camposAlterados(ATUAL, { ...ATUAL, especialidade: 'outra', especialidade_nome: 'Arte' }),
    ).toEqual(['especialidade', 'especialidade_nome']);
    expect(camposAlterados(ATUAL, { ...ATUAL, regiao: 'RJ' })).toEqual(['regiao']);
  });

  it('primeiro salvamento compara com o padrão: só o que foi preenchido', () => {
    expect(camposAlterados(null, resolverPerfil(null, entrada()))).toEqual(['nome', 'contato']);
  });
});

describe('perfilCompleto (PERF-01)', () => {
  it('completo só com nome e especialidade', () => {
    expect(perfilCompleto(ATUAL)).toBe(true);
    expect(perfilCompleto({ nome: 'Ana', especialidade: null })).toBe(false);
    expect(perfilCompleto(null)).toBe(false);
  });
});
