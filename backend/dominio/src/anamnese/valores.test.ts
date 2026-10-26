import { describe, expect, it } from 'vitest';
import {
  type ModeloDosValores,
  type Versao,
  LIMITES_VALORES,
  alertasVigentes,
  itensVisiveis,
  lerValores,
  versaoVigente,
} from './valores.ts';

// T91 / ANA-02, ANA-04, ANA-06, ANA-09: regras puras dos valores da anamnese, adaptadas de
// clinical/anamnesis/anamnesis-values.domain.ts do legado (testes de
// anamnesis-values.domain.spec.ts junto), sem o schema morto de 20.000 e 5.000 nem a conversão
// das colunas antigas do legado.
// - ANA-04: valores por id de item; texto de campo até 5.000 e observação de alerta até 500;
//   id de item desconhecido ou de revisão futura (incluído depois da revisão da anamnese) é
//   recusado. A recusa diz o motivo e o id, nunca o conteúdo.
// - ANA-02: "Frequência" só aceita semanal, quinzenal, mensal ou outra.
// - ANA-06, ANA-09: a versão vigente é a última retificação (ou a original) e os alertas
//   marcados nela, na ordem do modelo, são os que o app destaca.

const modelo: ModeloDosValores = {
  campos: [
    { id: 'c1', rotulo: 'Queixa', revisao_inclusao: 1 },
    { id: 'c2', rotulo: 'Frequência', especial: 'frequencia', revisao_inclusao: 1 },
    { id: 'c3', rotulo: 'Novo', revisao_inclusao: 2 },
  ],
  alertas: [
    { id: 'a1', rotulo: 'Risco de suicídio', revisao_inclusao: 1 },
    { id: 'a2', rotulo: 'Novo alerta', revisao_inclusao: 2 },
  ],
};
const SENTINELA = 'SENTINELA-CLINICA';

describe('limites (ANA-04)', () => {
  it('são 5.000 no texto do campo e 500 na observação do alerta', () => {
    expect(LIMITES_VALORES).toEqual({ textoMax: 5000, observacaoMax: 500 });
  });

  it('texto de 5.000 é aceito e de 5.001 é recusado', () => {
    expect(lerValores(modelo, { c1: 'a'.repeat(5000) }, 1)).toEqual({
      ok: true,
      valores: { c1: 'a'.repeat(5000) },
    });
    expect(lerValores(modelo, { c1: 'a'.repeat(5001) }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'texto_longo', item_id: 'c1' }],
    });
  });

  it('observação de 500 é aceita e de 501 é recusada', () => {
    expect(lerValores(modelo, { a1: { marcado: true, obs: 'o'.repeat(500) } }, 1)).toEqual({
      ok: true,
      valores: { a1: { marcado: true, obs: 'o'.repeat(500) } },
    });
    expect(lerValores(modelo, { a1: { marcado: true, obs: 'o'.repeat(501) } }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'observacao_longa', item_id: 'a1' }],
    });
  });
});

describe('ids dos itens (ANA-04)', () => {
  it('id que não existe no modelo é recusado, sem ecoar o id enviado', () => {
    expect(lerValores(modelo, { [SENTINELA]: 'a' }, 2)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'id_desconhecido' }],
    });
  });

  it('id de item incluído depois da revisão da anamnese é recusado', () => {
    expect(lerValores(modelo, { c3: 'a' }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'id_revisao_futura', item_id: 'c3' }],
    });
    expect(lerValores(modelo, { a2: { marcado: true, obs: null } }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'id_revisao_futura', item_id: 'a2' }],
    });
  });

  it('o mesmo item é aceito na revisão em que entrou', () => {
    expect(lerValores(modelo, { c3: 'a', a2: { marcado: true, obs: null } }, 2)).toEqual({
      ok: true,
      valores: { c3: 'a', a2: { marcado: true, obs: null } },
    });
  });
});

describe('formato dos valores', () => {
  it('aceita e normaliza: texto aparado, vazio omitido, alerta desmarcado sem obs omitido', () => {
    expect(
      lerValores(
        modelo,
        {
          c1: ' dor ',
          c2: 'mensal',
          c3: '',
          a1: { marcado: true, obs: ' cuidado ' },
          a2: { marcado: false, obs: '  ' },
        },
        2,
      ),
    ).toEqual({
      ok: true,
      valores: { c1: 'dor', c2: 'mensal', a1: { marcado: true, obs: 'cuidado' } },
    });
  });

  it('valores que não são objeto, campo que não é texto e alerta sem marcado são recusados', () => {
    expect(lerValores(modelo, 'texto', 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'formato_invalido' }],
    });
    expect(lerValores(modelo, [], 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'formato_invalido' }],
    });
    expect(lerValores(modelo, { c1: 5 }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'tipo_invalido', item_id: 'c1' }],
    });
    expect(lerValores(modelo, { a1: 'sim' }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'tipo_invalido', item_id: 'a1' }],
    });
    expect(lerValores(modelo, { a1: { obs: 'x' } }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'tipo_invalido', item_id: 'a1' }],
    });
  });

  it('"Frequência" só aceita semanal, quinzenal, mensal ou outra (ANA-02)', () => {
    for (const opcao of ['semanal', 'quinzenal', 'mensal', 'outra'])
      expect(lerValores(modelo, { c2: opcao }, 1), opcao).toEqual({
        ok: true,
        valores: { c2: opcao },
      });
    expect(lerValores(modelo, { c2: 'diaria' }, 1)).toEqual({
      ok: false,
      violacoes: [{ motivo: 'frequencia_invalida', item_id: 'c2' }],
    });
  });

  it('a recusa nunca ecoa o conteúdo', () => {
    const r = lerValores(
      modelo,
      {
        c1: SENTINELA.repeat(1000),
        c2: SENTINELA,
        a1: { marcado: true, obs: SENTINELA.repeat(100) },
        [SENTINELA]: SENTINELA,
      },
      1,
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SENTINELA);
  });
});

describe('itens visíveis por revisão (ANA-04)', () => {
  it('item incluído depois não aparece numa anamnese de revisão anterior', () => {
    expect(itensVisiveis(modelo.campos, 1).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(itensVisiveis(modelo.alertas, 1).map((a) => a.id)).toEqual(['a1']);
    expect(itensVisiveis(modelo.campos, 2).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('versão vigente e alertas (ANA-06, ANA-09)', () => {
  const original: Versao = { modelo_revisao: 1, valores: { a1: { marcado: true, obs: null } } };
  const retificacao = {
    seq: 1,
    modelo_revisao: 2,
    valores: { a1: { marcado: false, obs: null }, a2: { marcado: true, obs: null } },
  };
  const segunda = { seq: 2, modelo_revisao: 2, valores: {} };

  it('sem retificação, a vigente é a original; com retificações, a de maior seq', () => {
    expect(versaoVigente(original, [])).toBe(original);
    expect(versaoVigente(original, [retificacao])).toBe(retificacao);
    expect(versaoVigente(original, [segunda, retificacao])).toBe(segunda);
  });

  it('alertas marcados da versão vigente, na ordem do modelo, com o rótulo', () => {
    expect(alertasVigentes(modelo, versaoVigente(original, []))).toEqual([
      { item_id: 'a1', rotulo: 'Risco de suicídio' },
    ]);
    expect(alertasVigentes(modelo, versaoVigente(original, [retificacao]))).toEqual([
      { item_id: 'a2', rotulo: 'Novo alerta' },
    ]);
  });

  it('sem alerta marcado, nenhum; alerta de revisão futura é ignorado', () => {
    expect(alertasVigentes(modelo, { modelo_revisao: 1, valores: {} })).toEqual([]);
    expect(
      alertasVigentes(modelo, { modelo_revisao: 1, valores: { a2: { marcado: true, obs: null } } }),
    ).toEqual([]);
  });
});
