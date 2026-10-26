import { describe, expect, it } from 'vitest';
import {
  MOTIVO_MAXIMO,
  PROBLEMA_ANAMNESE_EXISTENTE,
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_JANELA_ABERTA,
  PROBLEMA_JANELA_FECHADA,
  PROBLEMA_MODELO_BLOQUEADO,
  PROBLEMA_RETIFICACAO_CONCORRENTE,
  PROBLEMA_ROTULO_INVALIDO,
  PROBLEMA_SEM_CONTEUDO_NOVO,
  PROBLEMA_VALOR_INVALIDO,
  esquemaAnamneseEdicao,
  esquemaAnamneseEntrada,
  esquemaAnamneseGravacao,
  esquemaModeloEdicao,
  esquemaModeloGravacao,
  esquemaRetificacaoEntrada,
} from './anamnese.ts';
import { esquemaProblema } from './identidade.ts';

// T92 / ANA-01, ANA-04, ANA-06: contrato da anamnese. Corpo estrito (campo extra recusado).
// - Modelo: listas completas de campos e de alertas; item com id (existente) ou sem id (novo),
//   rótulo e, opcional, o especial "frequencia". Limites e unicidade do rótulo são do domínio
//   (backend/dominio/src/anamnese/modelo.ts), que responde 422 MODEL_LABEL_INVALID sem ecoar o
//   texto (ANA-01).
// - Anamnese: data da sessão (YYYY-MM-DD válida), revisão do modelo e valores por id de item; o
//   conteúdo dos valores é do domínio (valores.ts).
// - Retificação: nova versão completa (revisão e valores) com motivo de 1 a 5.000 (ANA-06).

const aceita = (esquema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  esquema.safeParse(v).success;
const ITEM = '11111111-1111-4111-8111-111111111111';

describe('retificação (ANA-06)', () => {
  const retificar = (extra: Record<string, unknown>) =>
    aceita(esquemaRetificacaoEntrada, { modelo_revisao: 1, valores: { [ITEM]: 'x' }, ...extra });

  it('motivo de 1 a 5.000', () => {
    expect(MOTIVO_MAXIMO).toBe(5000);
    expect(retificar({ motivo: 'x' })).toBe(true);
    expect(retificar({ motivo: 'x'.repeat(5000) })).toBe(true);
    expect(retificar({ motivo: 'x'.repeat(5001) })).toBe(false);
    expect(retificar({ motivo: '' })).toBe(false);
  });

  it('motivo aparado: só espaços é vazio; espaços em volta não contam no limite', () => {
    expect(retificar({ motivo: '   ' })).toBe(false);
    expect(retificar({ motivo: `  ${'x'.repeat(5000)}  ` })).toBe(true);
    expect(esquemaRetificacaoEntrada.parse({ modelo_revisao: 1, motivo: ' erro ' }).motivo).toBe(
      'erro',
    );
  });

  it('motivo é obrigatório', () => {
    expect(aceita(esquemaRetificacaoEntrada, { modelo_revisao: 1, valores: {} })).toBe(false);
  });

  it('a versão nova leva a revisão do modelo e os valores por id', () => {
    expect(retificar({ motivo: 'x', modelo_revisao: 0 })).toBe(false);
    expect(retificar({ motivo: 'x', modelo_revisao: 1.5 })).toBe(false);
    expect(retificar({ motivo: 'x', valores: [] })).toBe(false);
    expect(retificar({ motivo: 'x', extra: true })).toBe(false);
  });
});

describe('anamnese (ANA-04)', () => {
  const registrar = (extra: Record<string, unknown> = {}) =>
    aceita(esquemaAnamneseEntrada, {
      data_sessao: '2026-10-26',
      modelo_revisao: 1,
      valores: { [ITEM]: 'dor lombar' },
      ...extra,
    });

  it('aceita data, revisão e valores por id', () => {
    expect(registrar()).toBe(true);
    expect(registrar({ valores: undefined })).toBe(true);
  });

  it('data da sessão YYYY-MM-DD de calendário', () => {
    expect(registrar({ data_sessao: '2024-02-29' })).toBe(true);
    expect(registrar({ data_sessao: '2026-02-30' })).toBe(false);
    expect(registrar({ data_sessao: '26/10/2026' })).toBe(false);
    expect(registrar({ data_sessao: undefined })).toBe(false);
  });

  it('revisão inteira a partir de 1; valores é objeto; campo extra recusado', () => {
    expect(registrar({ modelo_revisao: 0 })).toBe(false);
    expect(registrar({ valores: 'texto' })).toBe(false);
    expect(registrar({ paciente_id: ITEM })).toBe(false);
  });

  it('edição no dia: revisão e valores, sem trocar a data', () => {
    expect(aceita(esquemaAnamneseEdicao, { modelo_revisao: 2, valores: {} })).toBe(true);
    expect(aceita(esquemaAnamneseEdicao, { modelo_revisao: 2 })).toBe(false);
    expect(
      aceita(esquemaAnamneseEdicao, { modelo_revisao: 2, valores: {}, data_sessao: '2026-10-26' }),
    ).toBe(false);
  });
});

describe('modelo (ANA-01, ANA-02)', () => {
  it('aceita item existente (com id) e novo (sem id), com o especial "frequencia"', () => {
    expect(
      aceita(esquemaModeloEdicao, {
        campos: [
          { id: ITEM, rotulo: 'Queixa' },
          { rotulo: 'Frequência', especial: 'frequencia' },
        ],
        alertas: [{ rotulo: 'Risco' }],
      }),
    ).toBe(true);
  });

  it('o rótulo fora de 1 a 60 passa pelo contrato e vai ao domínio (MODEL_LABEL_INVALID)', () => {
    expect(
      aceita(esquemaModeloEdicao, {
        campos: [{ rotulo: '' }, { rotulo: 'x'.repeat(61) }],
        alertas: [],
      }),
    ).toBe(true);
  });

  it('recusa especial de outro tipo, id malformado, chave extra e lista ausente', () => {
    expect(
      aceita(esquemaModeloEdicao, { campos: [{ rotulo: 'A', especial: 'escala' }], alertas: [] }),
    ).toBe(false);
    expect(aceita(esquemaModeloEdicao, { campos: [{ id: 'x', rotulo: 'A' }], alertas: [] })).toBe(
      false,
    );
    expect(
      aceita(esquemaModeloEdicao, { campos: [{ rotulo: 'A', tipo: 'campo' }], alertas: [] }),
    ).toBe(false);
    expect(aceita(esquemaModeloEdicao, { campos: [] })).toBe(false);
  });
});

describe('MODEL_LABEL_INVALID (ANA-01)', () => {
  it('422 problem+json do projeto, sem campo que carregue o texto do rótulo', () => {
    expect(esquemaProblema.parse(PROBLEMA_ROTULO_INVALIDO)).toEqual(PROBLEMA_ROTULO_INVALIDO);
    expect(PROBLEMA_ROTULO_INVALIDO).toEqual({
      tipo: 'about:blank',
      titulo: 'Rótulo inválido no modelo',
      status: 422,
      codigo: 'MODEL_LABEL_INVALID',
    });
  });
});

describe('gravação do modelo (T94, decisão do usuário: row_version obrigatório)', () => {
  const listas = { campos: [{ rotulo: 'Queixa' }], alertas: [] };

  it('exige row_version inteiro positivo', () => {
    expect(aceita(esquemaModeloGravacao, { ...listas, row_version: 1 })).toBe(true);
    expect(aceita(esquemaModeloGravacao, listas)).toBe(false);
    expect(aceita(esquemaModeloGravacao, { ...listas, row_version: 0 })).toBe(false);
    expect(aceita(esquemaModeloGravacao, { ...listas, row_version: 1, extra: 1 })).toBe(false);
  });

  it('409 MODEL_LOCKED (ANA-03) e 404 nao_encontrado no formato problem+json', () => {
    expect(esquemaProblema.parse(PROBLEMA_MODELO_BLOQUEADO)).toEqual(PROBLEMA_MODELO_BLOQUEADO);
    expect(PROBLEMA_MODELO_BLOQUEADO).toMatchObject({ status: 409, codigo: 'MODEL_LOCKED' });
    expect(PROBLEMA_ANAMNESE_NAO_ENCONTRADA).toMatchObject({
      status: 404,
      codigo: 'nao_encontrado',
    });
  });
});

describe('gravação da anamnese (T95, decisões do usuário)', () => {
  it('edição no dia exige row_version', () => {
    expect(
      aceita(esquemaAnamneseGravacao, { modelo_revisao: 1, valores: {}, row_version: 1 }),
    ).toBe(true);
    expect(aceita(esquemaAnamneseGravacao, { modelo_revisao: 1, valores: {} })).toBe(false);
  });

  it('409 ANAMNESIS_EXISTS, 409 EDIT_WINDOW_CLOSED e 422 ANAMNESIS_VALUE_INVALID', () => {
    for (const [problema, status, codigo] of [
      [PROBLEMA_ANAMNESE_EXISTENTE, 409, 'ANAMNESIS_EXISTS'],
      [PROBLEMA_JANELA_FECHADA, 409, 'EDIT_WINDOW_CLOSED'],
      [PROBLEMA_VALOR_INVALIDO, 422, 'ANAMNESIS_VALUE_INVALID'],
    ] as const) {
      expect(esquemaProblema.parse(problema), codigo).toEqual(problema);
      expect(problema, codigo).toMatchObject({ status, codigo });
    }
  });
});

describe('retificação: erros (T96; ANA-07, ANA-08)', () => {
  it('409 EDIT_WINDOW_OPEN, 400 sem conteúdo novo e 409 RECTIFICATION_CONFLICT', () => {
    for (const [problema, status, codigo] of [
      [PROBLEMA_JANELA_ABERTA, 409, 'EDIT_WINDOW_OPEN'],
      [PROBLEMA_SEM_CONTEUDO_NOVO, 400, 'sem_conteudo_novo'],
      [PROBLEMA_RETIFICACAO_CONCORRENTE, 409, 'RECTIFICATION_CONFLICT'],
    ] as const) {
      expect(esquemaProblema.parse(problema), codigo).toEqual(problema);
      expect(problema, codigo).toMatchObject({ status, codigo });
    }
  });
});
