import { describe, expect, it } from 'vitest';
import {
  LIMITE_MAXIMO_SESSOES,
  LIMITE_PADRAO_SESSOES,
  PROBLEMA_CONFLITO_HORARIO,
  PROBLEMA_CONSULTA_SESSOES_INVALIDA,
  PROBLEMA_DIA_INDISPONIVEL,
  PROBLEMA_PACIENTE_INATIVO,
  PROBLEMA_SESSAO_COM_REGISTROS,
  PROBLEMA_SESSAO_NAO_ENCONTRADA,
  PROBLEMA_TRANSICAO_INVALIDA,
  PROBLEMA_VERSAO_DIVERGENTE,
  STATUS_SESSAO,
  codificarCursor,
  decodificarCursor,
  esquemaListagemSessoes,
  esquemaMudancaStatus,
  esquemaSessaoEdicao,
  esquemaSessaoEntrada,
} from './agenda.ts';
import { esquemaProblema } from './identidade.ts';

// T75 / AGE-01, AGE-03, AGE-07: contrato da agenda. Início e fim em ISO 8601 com offset, anos de
// 2000 a 2100 (no texto e em UTC), fim > início; link opcional com http:// ou https:// até 500;
// listagem do intervalo [de, ate) de no máximo 62 dias, limit padrão 50 e máximo 100, cursor
// keyset opaco. Corpo estrito: campo extra recusado. Casos do T-163 e do T-307 do legado
// (backend/src/scheduling/domain/session.spec.ts) vêm junto.

const PACIENTE = '11111111-1111-4111-8111-111111111111';
const SESSAO = '22222222-2222-4222-8222-222222222222';
const aceita = (esquema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  esquema.safeParse(v).success;

const sessao = (inicio: string, fim: string, extra: Record<string, unknown> = {}) => ({
  paciente_id: PACIENTE,
  inicio,
  fim,
  ...extra,
});
const criar = (inicio: string, fim: string, extra: Record<string, unknown> = {}) =>
  aceita(esquemaSessaoEntrada, sessao(inicio, fim, extra));

describe('início e fim (AGE-01)', () => {
  it('aceita Z e offset', () => {
    expect(criar('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')).toBe(true);
    expect(criar('2026-05-01T10:00:00-03:00', '2026-05-01T11:00:00-03:00')).toBe(true);
    expect(criar('2026-05-01T10:00-03:00', '2026-05-01T10:50-03:00')).toBe(true);
    expect(criar('2026-05-01T10:00:00.000Z', '2026-05-01T10:50:00.000Z')).toBe(true);
  });

  it('recusa sem offset, só data ou texto qualquer', () => {
    expect(criar('2026-05-01T10:00:00', '2026-05-01T11:00:00')).toBe(false);
    expect(criar('2026-05-01', '2026-05-02')).toBe(false);
    expect(criar('amanhã', '2026-05-01T11:00:00Z')).toBe(false);
    expect(criar('1777629600000', '2026-05-01T11:00:00Z')).toBe(false);
  });

  it('recusa data ou hora que não existem no calendário', () => {
    expect(criar('2026-02-30T10:00:00Z', '2026-02-30T11:00:00Z')).toBe(false);
    expect(criar('2026-13-01T10:00:00Z', '2026-13-01T11:00:00Z')).toBe(false);
    expect(criar('2026-05-01T24:00:00Z', '2026-05-02T01:00:00Z')).toBe(false);
    expect(criar('2026-05-01T10:60:00Z', '2026-05-01T11:00:00Z')).toBe(false);
    expect(criar('2028-02-29T10:00:00Z', '2028-02-29T11:00:00Z')).toBe(true);
  });

  it('anos de 2000 a 2100 aceitos nas bordas', () => {
    expect(criar('2000-01-01T00:00:00Z', '2000-01-01T00:50:00Z')).toBe(true);
    expect(criar('2100-12-31T22:00:00Z', '2100-12-31T23:00:00Z')).toBe(true);
  });

  it('anos fora de 2000 a 2100 recusados', () => {
    expect(criar('1999-12-31T10:00:00Z', '2026-05-01T11:00:00Z')).toBe(false);
    expect(criar('2026-05-01T10:00:00Z', '2101-01-01T00:00:00Z')).toBe(false);
    expect(criar('2026-05-01T10:00:00Z', '9999-12-31T23:59:59Z')).toBe(false);
    expect(criar('2026-05-01T10:00:00Z', '+275760-09-13T00:00:00Z')).toBe(false);
  });

  it('a borda do ano vale também em UTC', () => {
    // 2100-12-31T23:00-03:00 = 2101-01-01T02:00Z: fora da faixa.
    expect(criar('2026-05-01T10:00:00Z', '2100-12-31T23:00:00-03:00')).toBe(false);
    // 2000-01-01T01:00+03:00 = 1999-12-31T22:00Z: fora da faixa.
    expect(criar('2000-01-01T01:00:00+03:00', '2026-05-01T11:00:00Z')).toBe(false);
  });

  it('fim precisa ser posterior ao início, comparando o instante (offset incluído)', () => {
    expect(criar('2026-05-01T10:00:00Z', '2026-05-01T10:00:00Z')).toBe(false);
    expect(criar('2026-05-01T10:00:00Z', '2026-05-01T09:59:00Z')).toBe(false);
    // 10:00-03:00 = 13:00Z; 12:00Z é antes.
    expect(criar('2026-05-01T10:00:00-03:00', '2026-05-01T12:00:00Z')).toBe(false);
    expect(criar('2026-05-01T10:00:00-03:00', '2026-05-01T13:01:00Z')).toBe(true);
  });

  it('o erro de fim aponta o campo fim', () => {
    const r = esquemaSessaoEntrada.safeParse(
      sessao('2026-05-01T10:00:00Z', '2026-05-01T09:00:00Z'),
    );
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['fim']);
  });
});

describe('link (AGE-01)', () => {
  const base = ['2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'] as const;

  it('opcional: ausente, nulo ou vazio viram null', () => {
    for (const link of [undefined, null, '', '   ']) {
      const r = esquemaSessaoEntrada.parse(sessao(...base, link === undefined ? {} : { link }));
      expect(r.link, String(link)).toBeNull();
    }
  });

  it('aceita http:// e https://, aparado', () => {
    expect(esquemaSessaoEntrada.parse(sessao(...base, { link: ' https://meet.x/abc ' })).link).toBe(
      'https://meet.x/abc',
    );
    expect(criar(...base, { link: 'http://meet.x/abc' })).toBe(true);
    expect(criar(...base, { link: 'HTTPS://MEET.X' })).toBe(true);
  });

  it('recusa outro esquema, sem esquema ou com espaço', () => {
    expect(criar(...base, { link: 'ftp://x.y' })).toBe(false);
    expect(criar(...base, { link: 'meet.x/abc' })).toBe(false);
    expect(criar(...base, { link: 'javascript:alert(1)' })).toBe(false);
    expect(criar(...base, { link: 'https://' })).toBe(false);
    expect(criar(...base, { link: 'https://a b' })).toBe(false);
  });

  it('até 500 caracteres', () => {
    const quinhentos = `https://x.y/${'a'.repeat(488)}`;
    expect(quinhentos).toHaveLength(500);
    expect(criar(...base, { link: quinhentos })).toBe(true);
    expect(criar(...base, { link: `${quinhentos}a` })).toBe(false);
  });
});

describe('criar sessão', () => {
  const base = ['2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'] as const;

  it('paciente_id é um uuid obrigatório', () => {
    expect(aceita(esquemaSessaoEntrada, { inicio: base[0], fim: base[1] })).toBe(false);
    expect(criar(...base, { paciente_id: 'abc' })).toBe(false);
  });

  it('aceita cobravel e confirmar_conflito booleanos', () => {
    expect(criar(...base, { cobravel: true, confirmar_conflito: true })).toBe(true);
    expect(criar(...base, { confirmar_conflito: 'sim' })).toBe(false);
  });

  it('recusa campo extra (inclusive status e row_version)', () => {
    expect(criar(...base, { status: 'realizada' })).toBe(false);
    expect(criar(...base, { row_version: 1 })).toBe(false);
    expect(criar(...base, { usuario_id: PACIENTE })).toBe(false);
  });
});

describe('editar sessão (AGE-11)', () => {
  const edicao = (extra: Record<string, unknown> = {}) => ({
    inicio: '2026-05-01T10:00:00Z',
    fim: '2026-05-01T11:00:00Z',
    row_version: 3,
    ...extra,
  });

  it('row_version obrigatório, inteiro positivo', () => {
    expect(aceita(esquemaSessaoEdicao, edicao())).toBe(true);
    const semVersao: Record<string, unknown> = edicao();
    delete semVersao['row_version'];
    expect(aceita(esquemaSessaoEdicao, semVersao)).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ row_version: 0 }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ row_version: 1.5 }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ row_version: '3' }))).toBe(false);
  });

  it('paciente opcional; mesmas regras de horário e link', () => {
    expect(aceita(esquemaSessaoEdicao, edicao({ paciente_id: PACIENTE }))).toBe(true);
    expect(aceita(esquemaSessaoEdicao, edicao({ paciente_id: 'x' }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ fim: '2026-05-01T10:00:00Z' }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ inicio: '2026-05-01T10:00:00' }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ link: 'ftp://x' }))).toBe(false);
    expect(aceita(esquemaSessaoEdicao, edicao({ status: 'faltou' }))).toBe(false);
  });
});

describe('mudar status (AGE-07)', () => {
  it('aceita os cinco status com row_version', () => {
    for (const status of STATUS_SESSAO)
      expect(aceita(esquemaMudancaStatus, { status, row_version: 1 }), status).toBe(true);
    expect(STATUS_SESSAO).toEqual(['agendada', 'realizada', 'faltou', 'cancelada', 'remarcada']);
  });

  it('recusa status desconhecido, sem row_version e campo extra', () => {
    expect(aceita(esquemaMudancaStatus, { status: 'apagada', row_version: 1 })).toBe(false);
    expect(aceita(esquemaMudancaStatus, { status: 'faltou' })).toBe(false);
    expect(aceita(esquemaMudancaStatus, { status: 'faltou', row_version: 1, inicio: 'x' })).toBe(
      false,
    );
  });

  it('aceita cobrar (cobravel) e confirmar_conflito', () => {
    expect(
      aceita(esquemaMudancaStatus, {
        status: 'faltou',
        cobravel: true,
        confirmar_conflito: false,
        row_version: 2,
      }),
    ).toBe(true);
  });
});

describe('listagem (AGE-03)', () => {
  const listar = (q: Record<string, string>) => esquemaListagemSessoes.safeParse(q);
  const de = '2026-05-01T03:00:00Z';

  it('limit padrão 50, mínimo 1 e máximo 100', () => {
    expect(listar({ de, ate: '2026-05-08T03:00:00Z' }).data?.limit).toBe(LIMITE_PADRAO_SESSOES);
    expect(LIMITE_PADRAO_SESSOES).toBe(50);
    expect(listar({ de, ate: '2026-05-08T03:00:00Z', limit: '1' }).data?.limit).toBe(1);
    expect(listar({ de, ate: '2026-05-08T03:00:00Z', limit: '100' }).data?.limit).toBe(
      LIMITE_MAXIMO_SESSOES,
    );
    for (const limit of ['0', '101', '-1', '1.5', 'abc', ''])
      expect(listar({ de, ate: '2026-05-08T03:00:00Z', limit }).success, limit).toBe(false);
  });

  it('intervalo de até 62 dias, inclusive; 62 dias e um milissegundo recusado', () => {
    expect(listar({ de, ate: '2026-07-02T03:00:00Z' }).success).toBe(true); // 62 dias
    expect(listar({ de, ate: '2026-07-02T03:00:00.001Z' }).success).toBe(false);
    expect(listar({ de, ate: '2026-07-03T03:00:00Z' }).success).toBe(false);
  });

  it('ate precisa ser posterior a de', () => {
    expect(listar({ de, ate: de }).success).toBe(false);
    expect(listar({ de, ate: '2026-04-30T03:00:00Z' }).success).toBe(false);
  });

  it('de e ate obrigatórios, ISO 8601 com offset e na faixa de anos', () => {
    expect(listar({ de }).success).toBe(false);
    expect(listar({ ate: de }).success).toBe(false);
    expect(listar({ de: '2026-05-01', ate: '2026-05-08' }).success).toBe(false);
    expect(listar({ de: '1999-12-01T00:00:00Z', ate: '2000-01-01T00:00:00Z' }).success).toBe(false);
  });

  it('normaliza de e ate para UTC', () => {
    expect(
      listar({ de: '2026-05-01T00:00:00-03:00', ate: '2026-05-08T00:00:00-03:00' }).data,
    ).toMatchObject({ de: '2026-05-01T03:00:00.000Z', ate: '2026-05-08T03:00:00.000Z' });
  });

  it('cursor opaco: o que a API devolve volta igual', () => {
    const cursor = codificarCursor({ inicio: '2026-05-02T13:00:00.000Z', id: SESSAO });
    expect(cursor).toMatch(/^[0-9a-f]+$/);
    expect(decodificarCursor(cursor)).toEqual({ inicio: '2026-05-02T13:00:00.000Z', id: SESSAO });
    expect(listar({ de, ate: '2026-05-08T03:00:00Z', cursor }).data?.cursor).toEqual({
      inicio: '2026-05-02T13:00:00.000Z',
      id: SESSAO,
    });
    expect(listar({ de, ate: '2026-05-08T03:00:00Z' }).data?.cursor).toBeNull();
  });

  it('cursor malformado é recusado', () => {
    const hex = (t: string) =>
      Array.from(t, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    for (const cursor of [
      '',
      'não-hex!',
      'abc',
      'ABCD',
      hex('lixo'),
      hex(`2026-05-02T13:00:00.000Z|nao-uuid`),
      hex(`ontem|${SESSAO}`),
      hex(`2026-05-02T13:00:00.000Z|${SESSAO}|extra`),
      hex(`1999-05-02T13:00:00.000Z|${SESSAO}`),
    ])
      expect(listar({ de, ate: '2026-05-08T03:00:00Z', cursor }).success, cursor).toBe(false);
  });

  it('parâmetro desconhecido é ignorado', () => {
    expect(listar({ de, ate: '2026-05-08T03:00:00Z', q: 'x' }).success).toBe(true);
  });
});

describe('erros da agenda', () => {
  it('códigos e status da spec, no formato problem+json do projeto', () => {
    const problemas = [
      [PROBLEMA_CONFLITO_HORARIO, 'SCHEDULE_CONFLICT', 409],
      [PROBLEMA_DIA_INDISPONIVEL, 'WEEKDAY_UNAVAILABLE', 422],
      [PROBLEMA_PACIENTE_INATIVO, 'PATIENT_INACTIVE', 422],
      [PROBLEMA_SESSAO_COM_REGISTROS, 'SESSION_HAS_RECORDS', 422],
      [PROBLEMA_TRANSICAO_INVALIDA, 'transicao_invalida', 422],
      [PROBLEMA_VERSAO_DIVERGENTE, 'versao_divergente', 409],
      [PROBLEMA_SESSAO_NAO_ENCONTRADA, 'nao_encontrado', 404],
      [PROBLEMA_CONSULTA_SESSOES_INVALIDA, 'consulta_invalida', 400],
    ] as const;
    for (const [problema, codigo, status] of problemas) {
      expect(esquemaProblema.parse(problema), codigo).toEqual(problema);
      expect(problema, codigo).toMatchObject({ codigo, status });
    }
  });
});
