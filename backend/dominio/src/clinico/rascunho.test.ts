import { describe, expect, it } from 'vitest';
import { decidirGravacao, lerChaveRascunho, lerIfMatch } from './rascunho.ts';

// T99 / RAS-01, RAS-02: chave (tipo, ref), If-Match e a decisão do upsert. Testes trazidos de
// test/draft-key.spec.ts e do parseIfMatch de test/drafts.spec.ts do legado.

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

describe('lerChaveRascunho (legado: draft-key.spec.ts)', () => {
  it('exige UUID para anamnese e evolucao', () => {
    expect(lerChaveRascunho('evolucao', ID)).toEqual({ tipo: 'evolucao', ref: ID });
    expect(lerChaveRascunho('anamnese', ID)).toEqual({ tipo: 'anamnese', ref: ID });
    expect(lerChaveRascunho('evolucao', 'texto-livre')).toBeNull();
    expect(lerChaveRascunho('anamnese', 'p1')).toBeNull();
  });

  // Decisão do usuário (2026-10-26): para evolucao e anamnese o ref é um UUID. O par
  // paciente:especialidade do legado (T-248) não existe aqui: o profissional tem uma só
  // especialidade (D-15).
  it('recusa dois UUIDs e restos com dois-pontos em anamnese e evolucao', () => {
    for (const ref of [`${ID}:${ID2}`, `${ID}:livre`, `${ID}:`, `:${ID2}`, 'a:b']) {
      expect(lerChaveRascunho('anamnese', ref), ref).toBeNull();
      expect(lerChaveRascunho('evolucao', ref), ref).toBeNull();
    }
  });

  // SEC-007 (T218): teste alterado com aprovação do usuário (2026-10-30). Antes, qualquer tipo no
  // formato [A-Za-z0-9._:-]{1,120} era aceito; agora só evolucao e anamnese (RAS-05). Formato
  // inválido continua null (400); tipo bem formado fora da lista é 'tipo_desconhecido' (422).
  it('tipo bem formado fora da lista (evolucao, anamnese) é tipo_desconhecido', () => {
    expect(lerChaveRascunho('nota', 'r9')).toBe('tipo_desconhecido');
    expect(lerChaveRascunho('nota', ID)).toBe('tipo_desconhecido');
    expect(lerChaveRascunho('x'.repeat(120), 'a.b:c-d_e')).toBe('tipo_desconhecido');
    expect(lerChaveRascunho('Evolucao', ID)).toBe('tipo_desconhecido');
    expect(lerChaveRascunho('x'.repeat(121), 'r')).toBeNull();
    expect(lerChaveRascunho('ev x', 'r9')).toBeNull();
    expect(lerChaveRascunho('nota', '')).toBeNull();
  });
});

describe('lerIfMatch (legado: drafts.spec.ts)', () => {
  it('aceita "n", W/"n" e n; ausente é null; lixo é inválido', () => {
    expect(lerIfMatch('"3"')).toBe(3);
    expect(lerIfMatch('W/"3"')).toBe(3);
    expect(lerIfMatch('3')).toBe(3);
    expect(lerIfMatch(undefined)).toBeNull();
    expect(lerIfMatch('abc')).toBe('invalido');
  });
});

describe('decidirGravacao (RAS-01, RAS-02)', () => {
  it('rascunho inexistente aceita If-Match ausente ou "0" e cria', () => {
    expect(decidirGravacao(null, null)).toBe('criar');
    expect(decidirGravacao(null, 0)).toBe('criar');
  });

  it('rascunho inexistente com outra versão no If-Match: conflito (412)', () => {
    expect(decidirGravacao(null, 2)).toBe('conflito');
  });

  it('rascunho existente: If-Match igual à versão atual substitui', () => {
    expect(decidirGravacao(3, 3)).toBe('substituir');
  });

  it('rascunho existente: If-Match divergente ou ausente é conflito (412)', () => {
    expect(decidirGravacao(3, 2)).toBe('conflito');
    expect(decidirGravacao(3, 0)).toBe('conflito');
    expect(decidirGravacao(3, null)).toBe('conflito');
  });
});
