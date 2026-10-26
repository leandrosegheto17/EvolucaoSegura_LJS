import { describe, expect, it } from 'vitest';
import {
  PAYLOAD_RASCUNHO_MAXIMO,
  PROBLEMA_EVOLUCAO_EXISTENTE,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
  PROBLEMA_NOME_MODELO_EXISTENTE,
  PROBLEMA_RASCUNHO_INVALIDO,
  PROBLEMA_VERSAO_RASCUNHO,
  TEXTO_EVOLUCAO_MAXIMO,
  esquemaEvolucaoEntrada,
  esquemaEvolucaoGravacao,
  esquemaEvolucaoRetificacao,
  esquemaListagemEvolucoes,
  esquemaListagemModelosTexto,
  esquemaModeloTextoEdicao,
  esquemaModeloTextoEntrada,
  esquemaRascunhoEntrada,
} from './clinico.ts';
import { esquemaProblema } from './identidade.ts';

// T100 / EVO-01, EVO-04, EVO-05, RAS-01, RAS-02, RAS-03: contrato da evolução, da retificação,
// do rascunho e do modelo de texto. Corpo estrito (campo extra recusado).
// - Evolução: texto não vazio depois de aparar, até 100.000; sessao_id opcional (EVO-01).
// - Edição no dia: texto e row_version obrigatório (EVO-04).
// - Retificação: texto novo e motivo, até 100.000 cada (EVO-05).
// - Rascunho: payload JSON (objeto) até 512 KiB (RAS-01).
// - Modelo de texto: tipo evolucao, nome de 1 a 200, corpo até 50.000, arquivável (RAS-03).

const aceita = (esquema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  esquema.safeParse(v).success;
const PACIENTE = '11111111-1111-4111-8111-111111111111';
const SESSAO = '22222222-2222-4222-8222-222222222222';

describe('evolução (EVO-01)', () => {
  const evolucao = (extra: Record<string, unknown>) =>
    aceita(esquemaEvolucaoEntrada, { paciente_id: PACIENTE, texto: 'Sessão boa', ...extra });

  it('texto não vazio depois de aparar, até 100.000', () => {
    expect(TEXTO_EVOLUCAO_MAXIMO).toBe(100_000);
    expect(evolucao({ texto: 'x'.repeat(100_000) })).toBe(true);
    expect(evolucao({ texto: 'x'.repeat(100_001) })).toBe(false);
    expect(evolucao({ texto: '' })).toBe(false);
    expect(evolucao({ texto: ' \n\t ' })).toBe(false);
    expect(evolucao({ texto: ' a ' })).toBe(true);
  });

  it('guarda o texto como veio (aparar só decide se está vazio)', () => {
    const r = esquemaEvolucaoEntrada.parse({ paciente_id: PACIENTE, texto: '  linha\n' });
    expect(r.texto).toBe('  linha\n');
  });

  it('sessao_id opcional (ausente ou null = sem sessão)', () => {
    expect(esquemaEvolucaoEntrada.parse({ paciente_id: PACIENTE, texto: 'x' }).sessao_id).toBe(
      null,
    );
    expect(
      esquemaEvolucaoEntrada.parse({ paciente_id: PACIENTE, texto: 'x', sessao_id: null })
        .sessao_id,
    ).toBe(null);
    expect(evolucao({ sessao_id: SESSAO })).toBe(true);
    expect(evolucao({ sessao_id: 'sessao' })).toBe(false);
  });

  it('paciente_id obrigatório e campo extra recusado', () => {
    expect(aceita(esquemaEvolucaoEntrada, { texto: 'x' })).toBe(false);
    expect(evolucao({ usuario_id: PACIENTE })).toBe(false);
  });
});

describe('edição no dia (EVO-04)', () => {
  it('texto e row_version obrigatórios', () => {
    expect(aceita(esquemaEvolucaoGravacao, { texto: 'x', row_version: 1 })).toBe(true);
    expect(aceita(esquemaEvolucaoGravacao, { texto: 'x' })).toBe(false);
    expect(aceita(esquemaEvolucaoGravacao, { texto: ' ', row_version: 1 })).toBe(false);
    expect(aceita(esquemaEvolucaoGravacao, { texto: 'x', row_version: 0 })).toBe(false);
  });
});

describe('retificação (EVO-05)', () => {
  const retificar = (extra: Record<string, unknown>) =>
    aceita(esquemaEvolucaoRetificacao, { texto: 'Novo', motivo: 'Erro de digitação', ...extra });

  it('texto novo e motivo até 100.000 cada, não vazios depois de aparar', () => {
    expect(retificar({ texto: 'x'.repeat(100_000), motivo: 'y'.repeat(100_000) })).toBe(true);
    expect(retificar({ texto: 'x'.repeat(100_001) })).toBe(false);
    expect(retificar({ motivo: 'y'.repeat(100_001) })).toBe(false);
    expect(retificar({ texto: '  ' })).toBe(false);
    expect(retificar({ motivo: '  ' })).toBe(false);
    expect(aceita(esquemaEvolucaoRetificacao, { texto: 'x' })).toBe(false);
    expect(retificar({ row_version: 1 })).toBe(false);
  });
});

describe('rascunho (RAS-01)', () => {
  const KIB = 1024;
  // JSON.stringify({ t: '...' }) = 8 bytes de moldura + o texto.
  const payloadDeBytes = (bytes: number) => ({ t: 'x'.repeat(bytes - 8) });

  it('payload até 512 KiB (bytes do JSON)', () => {
    expect(PAYLOAD_RASCUNHO_MAXIMO).toBe(512 * KIB);
    expect(JSON.stringify(payloadDeBytes(512 * KIB)).length).toBe(512 * KIB);
    expect(aceita(esquemaRascunhoEntrada, { payload: payloadDeBytes(512 * KIB) })).toBe(true);
    expect(aceita(esquemaRascunhoEntrada, { payload: payloadDeBytes(512 * KIB + 1) })).toBe(false);
  });

  it('conta bytes em UTF-8, não caracteres', () => {
    // "é" ocupa 2 bytes: 262.140 deles + a moldura de 8 dão 512 KiB exatos; um a mais passa,
    // embora o JSON tenha só 262.149 caracteres.
    expect(aceita(esquemaRascunhoEntrada, { payload: { t: 'é'.repeat(262_140) } })).toBe(true);
    expect(aceita(esquemaRascunhoEntrada, { payload: { t: 'é'.repeat(262_141) } })).toBe(false);
  });

  it('payload é um objeto JSON; campo extra recusado', () => {
    expect(aceita(esquemaRascunhoEntrada, { payload: {} })).toBe(true);
    expect(aceita(esquemaRascunhoEntrada, { payload: 'x' })).toBe(false);
    expect(aceita(esquemaRascunhoEntrada, { payload: [1] })).toBe(false);
    expect(aceita(esquemaRascunhoEntrada, { payload: null })).toBe(false);
    expect(aceita(esquemaRascunhoEntrada, { payload: {}, usuario_id: PACIENTE })).toBe(false);
  });
});

describe('modelo de texto (RAS-03)', () => {
  const criar = (extra: Record<string, unknown>) =>
    aceita(esquemaModeloTextoEntrada, { tipo: 'evolucao', nome: 'Inicial', corpo: 'c', ...extra });

  it('tipo obrigatório e só evolucao', () => {
    expect(criar({})).toBe(true);
    expect(criar({ tipo: 'relatorio' })).toBe(false);
    expect(criar({ tipo: 'anamnese' })).toBe(false);
    expect(aceita(esquemaModeloTextoEntrada, { nome: 'x', corpo: 'c' })).toBe(false);
  });

  it('nome aparado de 1 a 200', () => {
    expect(esquemaModeloTextoEntrada.parse({ tipo: 'evolucao', nome: ' X ', corpo: '' })).toEqual({
      tipo: 'evolucao',
      nome: 'X',
      corpo: '',
    });
    expect(criar({ nome: 'x'.repeat(200) })).toBe(true);
    expect(criar({ nome: 'x'.repeat(201) })).toBe(false);
    expect(criar({ nome: '   ' })).toBe(false);
  });

  it('corpo até 50.000', () => {
    expect(criar({ corpo: 'x'.repeat(50_000) })).toBe(true);
    expect(criar({ corpo: 'x'.repeat(50_001) })).toBe(false);
  });

  it('campo extra recusado', () => {
    expect(criar({ usuario_id: PACIENTE })).toBe(false);
  });

  it('edição troca nome e corpo e arquiva ou desarquiva; tipo não muda', () => {
    expect(esquemaModeloTextoEdicao.parse({ nome: 'X', corpo: 'c', arquivado: true })).toEqual({
      nome: 'X',
      corpo: 'c',
      arquivado: true,
    });
    expect(esquemaModeloTextoEdicao.parse({ nome: 'X', corpo: 'c' }).arquivado).toBe(false);
    expect(aceita(esquemaModeloTextoEdicao, { nome: 'X', corpo: 'c', arquivado: 'sim' })).toBe(
      false,
    );
    expect(aceita(esquemaModeloTextoEdicao, { nome: 'X', corpo: 'c', tipo: 'relatorio' })).toBe(
      false,
    );
    expect(aceita(esquemaModeloTextoEdicao, { nome: 'x'.repeat(201), corpo: 'c' })).toBe(false);
    expect(aceita(esquemaModeloTextoEdicao, { nome: 'X', corpo: 'x'.repeat(50_001) })).toBe(false);
  });

  it('listagem: arquivados true ou false (padrão false)', () => {
    expect(esquemaListagemModelosTexto.parse({}).arquivados).toBe(false);
    expect(esquemaListagemModelosTexto.parse({ arquivados: 'true' }).arquivados).toBe(true);
    expect(aceita(esquemaListagemModelosTexto, { arquivados: 'sim' })).toBe(false);
  });
});

describe('listagem de evoluções do paciente', () => {
  it('limit de 1 a 100 (padrão 50) e offset a partir de 0', () => {
    expect(esquemaListagemEvolucoes.parse({})).toEqual({ limit: 50, offset: 0 });
    expect(esquemaListagemEvolucoes.parse({ limit: '100', offset: '3' })).toEqual({
      limit: 100,
      offset: 3,
    });
    expect(aceita(esquemaListagemEvolucoes, { limit: '101' })).toBe(false);
    expect(aceita(esquemaListagemEvolucoes, { limit: '0' })).toBe(false);
    expect(aceita(esquemaListagemEvolucoes, { offset: '-1' })).toBe(false);
  });
});

describe('problemas', () => {
  it('EVO-02: 409 EVOLUTION_EXISTS', () => {
    expect(PROBLEMA_EVOLUCAO_EXISTENTE).toMatchObject({ status: 409, codigo: 'EVOLUTION_EXISTS' });
  });

  it('RAS-02: 412 PRECONDITION_FAILED (decisão do usuário, como no legado)', () => {
    expect(PROBLEMA_VERSAO_RASCUNHO).toMatchObject({ status: 412, codigo: 'PRECONDITION_FAILED' });
  });

  it('RAS-03: nome duplicado = 409 TEMPLATE_NAME_EXISTS (decisão do usuário)', () => {
    expect(PROBLEMA_NOME_MODELO_EXISTENTE).toMatchObject({
      status: 409,
      codigo: 'TEMPLATE_NAME_EXISTS',
    });
  });

  it('não encontrado = 404 e chave ou If-Match inválido = 400', () => {
    expect(PROBLEMA_EVOLUCAO_NAO_ENCONTRADA).toMatchObject({
      status: 404,
      codigo: 'nao_encontrado',
    });
    expect(PROBLEMA_RASCUNHO_INVALIDO).toMatchObject({ status: 400 });
  });

  it('todos seguem o formato problem+json do contrato', () => {
    for (const p of [
      PROBLEMA_EVOLUCAO_EXISTENTE,
      PROBLEMA_VERSAO_RASCUNHO,
      PROBLEMA_NOME_MODELO_EXISTENTE,
      PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      PROBLEMA_RASCUNHO_INVALIDO,
    ])
      expect(esquemaProblema.safeParse(p).success, p.codigo).toBe(true);
  });
});
