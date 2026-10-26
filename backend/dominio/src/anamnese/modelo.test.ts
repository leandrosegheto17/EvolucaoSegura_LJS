import { describe, expect, it } from 'vitest';
import {
  type ItemModelo,
  type ItemProposto,
  LIMITES_MODELO,
  type ModeloAtual,
  type ModeloProposto,
  validarModelo,
} from './modelo.ts';
import { PRESETS, presetDe } from './presets.ts';

// T90 / ANA-01, ANA-02, ANA-03, PERF-04: regras puras do modelo de anamnese, adaptadas de
// clinical/model/model.domain.ts e presets.ts do legado (testes de model.domain.spec.ts junto).
// - ANA-01: até 30 campos e 12 alertas; rótulo aparado de 1 a 60, único no modelo sem
//   diferenciar maiúsculas; a violação nunca ecoa o texto do rótulo.
// - ANA-02: campos só de texto livre e no máximo um campo especial "Frequência".
// - ANA-03: com anamnese registrada, nada de remover, renomear ou mudar a ordem relativa dos
//   itens existentes; incluir itens novos em qualquer posição é permitido.
// - PERF-04: modelo padrão de cada especialidade (presets do legado).

const item = (id: string, rotulo: string, especial?: 'frequencia'): ItemModelo => ({
  id,
  rotulo,
  ...(especial ? { especial } : {}),
});
const livre = (campos: ItemModelo[] = [], alertas: ItemModelo[] = []): ModeloAtual => ({
  bloqueado: false,
  campos,
  alertas,
});
const bloqueado = (campos: ItemModelo[], alertas: ItemModelo[] = []): ModeloAtual => ({
  bloqueado: true,
  campos,
  alertas,
});
const motivos = (r: ReturnType<typeof validarModelo>): string[] =>
  r.ok ? [] : r.violacoes.map((v) => v.motivo);
const categorias = (r: ReturnType<typeof validarModelo>): string[] =>
  r.ok ? [] : [...new Set(r.violacoes.map((v) => v.categoria))];
const novos = (n: number, prefixo = 'i'): ItemProposto[] =>
  Array.from({ length: n }, (_, i) => ({ rotulo: `${prefixo}${i}` }));

describe('limites (ANA-01)', () => {
  it('são 30 campos, 12 alertas e rótulo de 1 a 60', () => {
    expect(LIMITES_MODELO).toEqual({ maxCampos: 30, maxAlertas: 12, rotuloMin: 1, rotuloMax: 60 });
  });

  it('aceita exatamente 30 campos e 12 alertas', () => {
    expect(validarModelo(livre(), { campos: novos(30), alertas: novos(12, 'a') })).toEqual({
      ok: true,
    });
  });

  it('recusa 31 campos e 13 alertas', () => {
    const r = validarModelo(livre(), { campos: novos(31), alertas: novos(13, 'a') });
    expect(motivos(r)).toEqual(['limite_campos', 'limite_alertas']);
    expect(categorias(r)).toEqual(['invalido']);
  });

  it('com anamnese, o limite conta os itens já existentes', () => {
    const existentes = Array.from({ length: 30 }, (_, i) => item(`c${i}`, `C${i}`));
    const proposto = {
      campos: [...existentes.map((e) => ({ id: e.id, rotulo: e.rotulo })), { rotulo: 'Extra' }],
      alertas: [],
    };
    expect(motivos(validarModelo(bloqueado(existentes), proposto))).toEqual(['limite_campos']);
  });
});

describe('rótulo (ANA-01)', () => {
  it('aparado: 60 caracteres com espaços em volta é aceito', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: `  ${'x'.repeat(60)}  ` }],
      alertas: [],
    });
    expect(r).toEqual({ ok: true });
  });

  it('vazio (só espaços) e com 61 caracteres são recusados', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: '   ' }, { rotulo: 'x'.repeat(61) }],
      alertas: [{ rotulo: '' }],
    });
    expect(motivos(r)).toEqual(['rotulo_vazio', 'rotulo_longo', 'rotulo_vazio']);
    expect(categorias(r)).toEqual(['invalido']);
  });

  it('único sem diferenciar maiúsculas, também depois de aparar', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: 'Sono' }, { rotulo: ' SONO ' }],
      alertas: [],
    });
    expect(motivos(r)).toEqual(['rotulo_repetido']);
    expect(r.ok ? null : r.violacoes[0]).toEqual({
      categoria: 'invalido',
      motivo: 'rotulo_repetido',
      tipo: 'campo',
      indice: 1,
    });
  });

  it('único no modelo inteiro: campo e alerta não repetem rótulo', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: 'Risco' }],
      alertas: [{ rotulo: 'risco' }],
    });
    expect(motivos(r)).toEqual(['rotulo_repetido']);
  });

  it('a violação nunca ecoa o texto do rótulo', () => {
    const SENTINELA = 'SENTINELA-CLINICA';
    const r = validarModelo(bloqueado([item('a', 'Queixa')]), {
      campos: [
        { id: 'a', rotulo: SENTINELA },
        { rotulo: `${SENTINELA}${'x'.repeat(60)}` },
        { rotulo: SENTINELA.toLowerCase() },
      ],
      alertas: [],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SENTINELA');
    expect(JSON.stringify(r).toLowerCase()).not.toContain('sentinela');
  });
});

describe('campo especial "Frequência" (ANA-02)', () => {
  it('um campo especial é aceito', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: 'Frequência', especial: 'frequencia' }, { rotulo: 'Queixa' }],
      alertas: [],
    });
    expect(r).toEqual({ ok: true });
  });

  it('dois campos especiais são recusados', () => {
    const r = validarModelo(livre(), {
      campos: [
        { rotulo: 'Frequência', especial: 'frequencia' },
        { rotulo: 'Outra frequência', especial: 'frequencia' },
      ],
      alertas: [],
    });
    expect(motivos(r)).toEqual(['especial_invalido']);
    expect(categorias(r)).toEqual(['invalido']);
  });

  it('especial em alerta ou de outro tipo é recusado', () => {
    const r = validarModelo(livre(), {
      campos: [{ rotulo: 'Escala', especial: 'escala' as never }],
      alertas: [{ rotulo: 'Frequência', especial: 'frequencia' }],
    });
    expect(motivos(r)).toEqual(['especial_invalido', 'especial_invalido']);
  });
});

describe('ids dos itens', () => {
  it('id que não existe no modelo, ou repetido, é recusado', () => {
    const atual = livre([item('a', 'Queixa')], [item('x', 'Risco')]);
    const r = validarModelo(atual, {
      campos: [
        { id: 'zz', rotulo: 'A' },
        { id: 'a', rotulo: 'B' },
        { id: 'a', rotulo: 'C' },
      ],
      // id de campo usado como alerta também é desconhecido (o tipo do item não muda).
      alertas: [{ id: 'a', rotulo: 'D' }],
    });
    expect(motivos(r)).toEqual(['id_desconhecido', 'id_desconhecido', 'id_desconhecido']);
    expect(categorias(r)).toEqual(['invalido']);
  });
});

describe('sem anamnese registrada: o modelo é livre (ANA-03)', () => {
  const atual = livre(
    [item('a', 'Queixa'), item('b', 'Sono'), item('f', 'Frequência', 'frequencia')],
    [item('x', 'Risco')],
  );

  it('aceita remover, renomear, trocar o especial e reordenar', () => {
    expect(
      validarModelo(atual, {
        campos: [
          { id: 'b', rotulo: 'Sono e repouso' },
          { id: 'a', rotulo: 'QUEIXA' },
          { id: 'f', rotulo: 'Ritmo' },
        ],
        alertas: [],
      }),
    ).toEqual({ ok: true });
  });
});

describe('com anamnese registrada: só inclusão (ANA-03)', () => {
  const atual = bloqueado(
    [item('a', 'Queixa'), item('f', 'Frequência', 'frequencia'), item('n', 'Sono')],
    [item('x', 'Risco')],
  );
  const base = (): { campos: ItemProposto[]; alertas: ItemProposto[] } => ({
    campos: [
      { id: 'a', rotulo: 'Queixa' },
      { id: 'f', rotulo: 'Frequência', especial: 'frequencia' },
      { id: 'n', rotulo: 'Sono' },
    ],
    alertas: [{ id: 'x', rotulo: 'Risco' }],
  });

  it('manter tudo como está é aceito', () => {
    expect(validarModelo(atual, base())).toEqual({ ok: true });
  });

  it('incluir itens novos no início, no meio e no fim é aceito', () => {
    const p = base();
    p.campos = [
      { rotulo: 'Primeiro' },
      p.campos[0]!,
      { rotulo: 'Meio' },
      p.campos[1]!,
      p.campos[2]!,
      { rotulo: 'Último' },
    ];
    p.alertas = [{ rotulo: 'Novo alerta' }, ...p.alertas];
    expect(validarModelo(atual, p)).toEqual({ ok: true });
  });

  it('remover item existente (campo ou alerta) é recusado', () => {
    const p = base();
    p.campos.splice(2, 1);
    p.alertas = [];
    const r = validarModelo(atual, p);
    expect(motivos(r)).toEqual(['remocao_bloqueada', 'remocao_bloqueada']);
    expect(categorias(r)).toEqual(['bloqueado']);
  });

  it('renomear, inclusive só nas maiúsculas, é recusado', () => {
    const p = base();
    p.campos[0] = { id: 'a', rotulo: 'QUEIXA' };
    p.campos[2] = { id: 'n', rotulo: 'Sono e repouso' };
    const r = validarModelo(atual, p);
    expect(motivos(r)).toEqual(['renomeacao_bloqueada', 'renomeacao_bloqueada']);
    expect(categorias(r)).toEqual(['bloqueado']);
  });

  it('espaços em volta não contam como renomear (rótulo aparado)', () => {
    const p = base();
    p.campos[0] = { id: 'a', rotulo: '  Queixa  ' };
    expect(validarModelo(atual, p)).toEqual({ ok: true });
  });

  it('tirar ou pôr o especial "Frequência" num item existente é recusado', () => {
    const p = base();
    p.campos[1] = { id: 'f', rotulo: 'Frequência' };
    expect(motivos(validarModelo(atual, p))).toEqual(['renomeacao_bloqueada']);
  });

  it('mudar a ordem relativa dos itens existentes é recusado', () => {
    const p = base();
    [p.campos[0], p.campos[2]] = [p.campos[2]!, p.campos[0]!];
    const r = validarModelo(atual, p);
    expect(motivos(r)).toEqual(['ordem_bloqueada']);
    expect(categorias(r)).toEqual(['bloqueado']);
  });

  it('item novo entre os existentes não muda a ordem relativa deles', () => {
    const p = base();
    p.campos.splice(1, 0, { rotulo: 'Entre' });
    expect(validarModelo(atual, p)).toEqual({ ok: true });
  });
});

describe('presets (PERF-04)', () => {
  it('psicologia: 7 campos, com "Frequência" especial, e 4 alertas', () => {
    const p = PRESETS.psicologia;
    expect(p.campos.map((c) => c.rotulo)).toEqual([
      'Queixa principal',
      'Hipótese diagnóstica/CID',
      'Abordagem',
      'Frequência',
      'Medicações/psiquiatra',
      'Comorbidades',
      'Histórico de internações e crises',
    ]);
    expect(p.campos.filter((c) => c.especial === 'frequencia').map((c) => c.rotulo)).toEqual([
      'Frequência',
    ]);
    expect(p.alertas.map((a) => a.rotulo)).toEqual([
      'Risco de suicídio',
      'Automutilação',
      'Uso de substâncias',
      'Violência doméstica',
    ]);
  });

  it('nutrição com 11 campos e 4 alertas; fisioterapia com 6 e 6; sem "Frequência"', () => {
    expect([PRESETS.nutricao.campos.length, PRESETS.nutricao.alertas.length]).toEqual([11, 4]);
    expect([PRESETS.fisioterapia.campos.length, PRESETS.fisioterapia.alertas.length]).toEqual([
      6, 6,
    ]);
    for (const tipo of ['nutricao', 'fisioterapia', 'outra'] as const)
      expect(
        PRESETS[tipo].campos.some((c) => c.especial !== undefined),
        tipo,
      ).toBe(false);
  });

  it('outra: só "Queixa principal" e nenhum alerta', () => {
    expect(presetDe('outra')).toEqual({ campos: [{ rotulo: 'Queixa principal' }], alertas: [] });
  });

  it('todo preset respeita as regras do modelo', () => {
    for (const [tipo, preset] of Object.entries(PRESETS)) {
      const proposto: ModeloProposto = {
        campos: preset.campos.map((c) => ({ ...c })),
        alertas: preset.alertas.map((a) => ({ ...a })),
      };
      expect(validarModelo(livre(), proposto), tipo).toEqual({ ok: true });
    }
  });
});
