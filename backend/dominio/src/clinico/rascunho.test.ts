import { describe, expect, it } from 'vitest';
import { cabeNaCotaDeBytes, decidirGravacao, lerChaveRascunho, lerIfMatch } from './rascunho.ts';

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

// RAS-05 (T219, SEC-007): teto de bytes somados dos rascunhos do profissional (25 MiB, decisão do
// usuário em 2026-10-30). Rascunho novo ou payload maior só entra se o total couber; trocar o
// payload de um rascunho existente por um menor ou igual sempre é aceito.
describe('cabeNaCotaDeBytes (RAS-05)', () => {
  const TETO = 1000;

  it('rascunho novo entra enquanto o total fica no teto, inclusive igual a ele', () => {
    expect(cabeNaCotaDeBytes({ total: 0, atuais: null, novos: 1000, teto: TETO })).toBe(true);
    expect(cabeNaCotaDeBytes({ total: 600, atuais: null, novos: 400, teto: TETO })).toBe(true);
  });

  it('rascunho novo que passaria do teto é recusado, mesmo com 1 byte a mais', () => {
    expect(cabeNaCotaDeBytes({ total: 600, atuais: null, novos: 401, teto: TETO })).toBe(false);
    expect(cabeNaCotaDeBytes({ total: 1000, atuais: null, novos: 2, teto: TETO })).toBe(false);
  });

  it('payload maior num rascunho existente: conta só a diferença', () => {
    // O total 900 já inclui os 300 do rascunho: 300 -> 400 fecha em 1000; 300 -> 401, em 1001.
    expect(cabeNaCotaDeBytes({ total: 900, atuais: 300, novos: 400, teto: TETO })).toBe(true);
    expect(cabeNaCotaDeBytes({ total: 900, atuais: 300, novos: 401, teto: TETO })).toBe(false);
  });

  it('payload menor ou igual num rascunho existente sempre é aceito, mesmo acima do teto', () => {
    expect(cabeNaCotaDeBytes({ total: 5000, atuais: 300, novos: 300, teto: TETO })).toBe(true);
    expect(cabeNaCotaDeBytes({ total: 5000, atuais: 300, novos: 2, teto: TETO })).toBe(true);
  });
});
