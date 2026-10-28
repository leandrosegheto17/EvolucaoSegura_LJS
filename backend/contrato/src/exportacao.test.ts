import { describe, expect, it } from 'vitest';
import {
  JANELA_LIMITE_EXPORTACAO_SEGUNDOS,
  LIMITE_EXPORTACOES,
  PROBLEMA_CURSOR_INVALIDO,
  PROBLEMA_LIMITE_EXPORTACAO,
  PROBLEMA_PAGINA_INVALIDA,
  PROBLEMA_PERIODO_INVALIDO,
  PROBLEMA_PRONTUARIO_NAO_ENCONTRADO,
  TABELAS_EXPORTACAO,
  TAMANHO_MAXIMO_PAGINA,
  esquemaConsultaExportacao,
  esquemaConsultaProntuario,
} from './exportacao.ts';

// T121 / EXP-01, EXP-07: período opcional do prontuário. `de` e `ate` em YYYY-MM-DD, datas de
// calendário reais, com de ≤ até; ausentes = sem limite daquele lado. Fora disso (ou parâmetro
// desconhecido), 400. Adaptado de validDate e da checagem de record-export.service.ts do legado.

const ler = (consulta: Record<string, string>) => esquemaConsultaProntuario.safeParse(consulta);

describe('período do prontuário (EXP-01)', () => {
  it('sem período: prontuário completo', () => {
    expect(ler({})).toEqual({ success: true, data: { de: null, ate: null } });
  });

  it('só de, só até, ou os dois', () => {
    expect(ler({ de: '2026-10-01' }).data).toEqual({ de: '2026-10-01', ate: null });
    expect(ler({ ate: '2026-10-31' }).data).toEqual({ de: null, ate: '2026-10-31' });
    expect(ler({ de: '2026-10-01', ate: '2026-10-31' }).data).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
    });
  });

  it('de igual a até vale (um dia só)', () => {
    expect(ler({ de: '2026-10-09', ate: '2026-10-09' }).success).toBe(true);
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(ler({ de: '2028-02-29' }).success).toBe(true);
  });
});

describe('período inválido (EXP-07)', () => {
  it('de depois de até', () => {
    expect(ler({ de: '2026-05-02', ate: '2026-05-01' }).success).toBe(false);
  });

  it.each([
    '2026-13-40',
    '2026-13-01',
    '2026-02-30',
    '2027-02-29',
    '2026-1-01',
    '26-10-01',
    '2026/10/01',
    '01/10/2026',
    'abc',
    '',
    ' 2026-10-01',
    '2026-10-01T00:00:00Z',
  ])('data fora do formato ou inexistente: %j', (data) => {
    expect(ler({ de: data }).success).toBe(false);
    expect(ler({ ate: data }).success).toBe(false);
  });

  it('parâmetro desconhecido é recusado', () => {
    expect(ler({ de: '2026-10-01', usuario_id: 'x' }).success).toBe(false);
    expect(ler({ até: '2026-10-01' }).success).toBe(false);
  });
});

describe('problemas', () => {
  it('período inválido = 400 e paciente não encontrado = 404', () => {
    expect(PROBLEMA_PERIODO_INVALIDO).toEqual({
      tipo: 'about:blank',
      titulo: 'Período inválido',
      status: 400,
      codigo: 'periodo_invalido',
    });
    expect(PROBLEMA_PRONTUARIO_NAO_ENCONTRADO).toEqual({
      tipo: 'about:blank',
      titulo: 'Não encontrado',
      status: 404,
      codigo: 'nao_encontrado',
    });
  });
});

// T171 / EXP-03, EXP-04 (D-32): consulta da exportação completa paginada,
// GET /api/exportacao?cursor=&limite=. Tamanho máximo de página fixado na T122: 25 linhas.
// Sem limite, a página tem o máximo; acima do máximo, zero, fração, texto ou parâmetro
// desconhecido é recusado (400). O cursor é opaco: aqui só se exige texto não vazio; quem o
// decodifica é a API.
describe('consulta da exportação completa (EXP-03, EXP-04)', () => {
  const lerPagina = (consulta: Record<string, string>) =>
    esquemaConsultaExportacao.safeParse(consulta);

  it('o tamanho máximo de página é 25 linhas (T122)', () => {
    expect(TAMANHO_MAXIMO_PAGINA).toBe(25);
  });

  it('sem cursor nem limite: primeira página com o tamanho máximo', () => {
    expect(lerPagina({})).toEqual({ success: true, data: { cursor: null, limite: 25 } });
  });

  it('limite de 1 até o máximo vale', () => {
    expect(lerPagina({ limite: '1' }).data).toEqual({ cursor: null, limite: 1 });
    expect(lerPagina({ limite: '25' }).data).toEqual({ cursor: null, limite: 25 });
    expect(lerPagina({ cursor: 'abc', limite: '10' }).data).toEqual({ cursor: 'abc', limite: 10 });
  });

  it.each(['26', '100', '0', '-1', '1.5', '1e1', 'abc', '', ' 5', '05'])(
    'limite fora de 1 a 25 ou fora do formato: %j',
    (limite) => {
      expect(lerPagina({ limite }).success).toBe(false);
    },
  );

  it('cursor vazio é recusado', () => {
    expect(lerPagina({ cursor: '' }).success).toBe(false);
  });

  it('parâmetro desconhecido é recusado', () => {
    expect(lerPagina({ tabela: 'paciente' }).success).toBe(false);
  });
});

describe('tabelas da exportação completa (EXP-03)', () => {
  it('lista do legado que existe aqui, com os preços e as revisões de preço, na ordem', () => {
    expect(TABELAS_EXPORTACAO).toEqual([
      'perfil',
      'modelo_anamnese',
      'modelo_anamnese_item',
      'paciente',
      'consentimento_tcle',
      'serie_recorrencia',
      'sessao_atendimento',
      'anamnese',
      'anamnese_retificacao',
      'evolucao',
      'evolucao_retificacao',
      'rascunho',
      'modelo_texto',
      'preco_paciente',
      'preco_paciente_revisao',
      'preco_sessao',
      'preco_sessao_revisao',
      'pagamento',
      'pagamento_revisao',
      'configuracao_usuario',
    ]);
  });

  it('nenhuma tabela de credencial ou sessão entra', () => {
    for (const proibida of ['usuario', 'credencial_senha', 'sessao', 'desafio_2fa', 'token_email'])
      expect(TABELAS_EXPORTACAO).not.toContain(proibida);
  });
});

describe('problemas da exportação completa (EXP-04)', () => {
  it('página e cursor inválidos respondem 400', () => {
    expect(PROBLEMA_PAGINA_INVALIDA).toEqual({
      tipo: 'about:blank',
      titulo: 'Página inválida',
      status: 400,
      codigo: 'pagina_invalida',
    });
    expect(PROBLEMA_CURSOR_INVALIDO).toEqual({
      tipo: 'about:blank',
      titulo: 'Cursor inválido',
      status: 400,
      codigo: 'cursor_invalido',
    });
  });
});

// T172 / EXP-05: mais de 5 exportações iniciadas em 60 segundos responde 429.
describe('limite de exportações (EXP-05)', () => {
  it('5 exportações por janela de 60 s', () => {
    expect(LIMITE_EXPORTACOES).toBe(5);
    expect(JANELA_LIMITE_EXPORTACAO_SEGUNDOS).toBe(60);
  });

  it('acima do limite responde 429', () => {
    expect(PROBLEMA_LIMITE_EXPORTACAO).toEqual({
      tipo: 'about:blank',
      titulo: 'Muitas exportações',
      status: 429,
      codigo: 'limite_exportacao',
    });
  });
});
