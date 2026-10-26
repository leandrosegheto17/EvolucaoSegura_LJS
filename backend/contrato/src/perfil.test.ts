import { describe, expect, it } from 'vitest';
import { esquemaProblema } from './identidade.ts';
import {
  ESPECIALIDADES,
  PROBLEMA_PERFIL_NAO_ENCONTRADO,
  esquemaEspecialidade,
  esquemaPerfilEntrada,
} from './perfil.ts';

// T62 / PERF-02, PERF-03: limites do perfil nos dois lados. nome de 1 a 200 (obrigatório),
// contato até 200, endereço até 300, fim de semana booleano opcional, chave desconhecida recusada e
// vazio gravado como null. Uma especialidade: psicologia, nutricao, fisioterapia ou outra (com nome
// de 1 a 60), registro opcional (conselho até 40, número até 40, região até 100). Os casos do
// parseProfileInput do legado (backend/test/profile.spec.ts) vêm junto.

const aceita = (corpo: unknown) => esquemaPerfilEntrada.safeParse(corpo).success;
const especialidade = (corpo: unknown) => esquemaEspecialidade.safeParse(corpo).success;

describe('perfil (PERF-02)', () => {
  it('apara o nome e grava vazio como null (legado)', () => {
    expect(esquemaPerfilEntrada.parse({ nome: '  Ana ', contato: ' ', endereco: '' })).toEqual({
      nome: 'Ana',
      contato: null,
      endereco: null,
    });
  });

  it('contato e endereço ausentes também viram null', () => {
    expect(esquemaPerfilEntrada.parse({ nome: 'A' })).toEqual({
      nome: 'A',
      contato: null,
      endereco: null,
    });
  });

  it('nome obrigatório, de 1 a 200 depois de aparado', () => {
    expect(aceita({ nome: 'x' })).toBe(true);
    expect(aceita({ nome: 'x'.repeat(200) })).toBe(true);
    expect(aceita({ nome: 'x'.repeat(201) })).toBe(false);
    expect(aceita({ nome: '   ' })).toBe(false);
    expect(aceita({})).toBe(false);
    expect(aceita({ nome: null })).toBe(false);
  });

  it('contato até 200 e endereço até 300', () => {
    expect(aceita({ nome: 'A', contato: 'x'.repeat(200), endereco: 'x'.repeat(300) })).toBe(true);
    expect(aceita({ nome: 'A', contato: 'x'.repeat(201) })).toBe(false);
    expect(aceita({ nome: 'A', endereco: 'x'.repeat(301) })).toBe(false);
    expect(aceita({ nome: 'A', contato: 5 })).toBe(false);
  });

  it('atende_sabado e atende_domingo são booleanos opcionais; ausentes não aparecem', () => {
    expect(esquemaPerfilEntrada.parse({ nome: 'A', atende_sabado: true })).toMatchObject({
      atende_sabado: true,
    });
    expect(esquemaPerfilEntrada.parse({ nome: 'A' })).not.toHaveProperty('atende_sabado');
    expect(aceita({ nome: 'A', atende_sabado: 'sim' })).toBe(false);
    expect(aceita({ nome: 'A', atende_domingo: null })).toBe(false);
  });

  it('recusa chave desconhecida, inclusive as do legado (crp, regiao) e usuario_id', () => {
    for (const extra of ['extra', 'crp', 'regiao', 'usuario_id', 'privacidade_agenda'])
      expect(aceita({ nome: 'A', [extra]: '1' }), extra).toBe(false);
    expect(aceita(null)).toBe(false);
  });
});

describe('especialidade única (PERF-03)', () => {
  it('aceita os quatro tipos da spec', () => {
    expect(ESPECIALIDADES).toEqual(['psicologia', 'nutricao', 'fisioterapia', 'outra']);
    for (const tipo of ['psicologia', 'nutricao', 'fisioterapia'])
      expect(especialidade({ tipo }), tipo).toBe(true);
    expect(especialidade({ tipo: 'medicina' })).toBe(false);
  });

  it('é um objeto só, não uma lista', () => {
    expect(aceita({ nome: 'A', especialidade: [{ tipo: 'psicologia' }] })).toBe(false);
    expect(aceita({ nome: 'A', especialidade: { tipo: 'psicologia' } })).toBe(true);
  });

  it('outra exige nome de 1 a 60, aparado', () => {
    expect(esquemaEspecialidade.parse({ tipo: 'outra', nome: ' Arteterapia ' })).toMatchObject({
      tipo: 'outra',
      nome: 'Arteterapia',
    });
    expect(especialidade({ tipo: 'outra', nome: 'x'.repeat(60) })).toBe(true);
    expect(especialidade({ tipo: 'outra', nome: 'x'.repeat(61) })).toBe(false);
    expect(especialidade({ tipo: 'outra', nome: '  ' })).toBe(false);
    expect(especialidade({ tipo: 'outra' })).toBe(false);
  });

  it('o nome só vale para outra', () => {
    expect(especialidade({ tipo: 'psicologia', nome: 'Clínica' })).toBe(false);
    expect(esquemaEspecialidade.parse({ tipo: 'psicologia', nome: '' })).toMatchObject({
      nome: null,
    });
  });

  it('registro opcional: conselho até 40, número até 40, região até 100; vazio vira null', () => {
    expect(
      especialidade({
        tipo: 'psicologia',
        conselho: 'x'.repeat(40),
        numero_registro: 'x'.repeat(40),
        regiao: 'x'.repeat(100),
      }),
    ).toBe(true);
    expect(especialidade({ tipo: 'psicologia', conselho: 'x'.repeat(41) })).toBe(false);
    expect(especialidade({ tipo: 'psicologia', numero_registro: 'x'.repeat(41) })).toBe(false);
    expect(especialidade({ tipo: 'psicologia', regiao: 'x'.repeat(101) })).toBe(false);
    expect(esquemaEspecialidade.parse({ tipo: 'nutricao', conselho: ' ' })).toEqual({
      tipo: 'nutricao',
      nome: null,
      conselho: null,
      numero_registro: null,
      regiao: null,
    });
  });

  it('recusa chave desconhecida na especialidade', () => {
    expect(especialidade({ tipo: 'psicologia', ordem: 1 })).toBe(false);
    expect(especialidade({ tipo: 'psicologia', ativa: true })).toBe(false);
  });
});

describe('perfil não encontrado', () => {
  it('é um problema 404 válido do projeto', () => {
    expect(esquemaProblema.parse(PROBLEMA_PERFIL_NAO_ENCONTRADO)).toEqual({
      tipo: 'about:blank',
      titulo: 'Não encontrado',
      status: 404,
      codigo: 'nao_encontrado',
    });
  });
});
