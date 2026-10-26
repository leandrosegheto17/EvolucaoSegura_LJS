import { PROBLEMA_CONSULTA_SESSOES_INVALIDA, type PaginaSessoes } from '@es/contrato/agenda';
import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao } from './sessoes-apoio.ts';

// T79 / AGE-03, ISO-02: GET /api/sessoes lista as sessões com início em [de, ate), intervalo de
// no máximo 62 dias, limit padrão 50 e máximo 100, em ordem (início, id) com cursor keyset: a
// paginação não repete nem pula sessão, mesmo com sessão nova entre uma página e outra. Só as
// sessões do próprio profissional aparecem.

const listar = (sessao: Sessao | null, parametros: Record<string, string>) =>
  pedir('GET', `/api/sessoes?${new URLSearchParams(parametros).toString()}`, sessao);

async function pagina(sessao: Sessao, parametros: Record<string, string>): Promise<PaginaSessoes> {
  const resposta = await listar(sessao, parametros);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as PaginaSessoes;
}

// Todas as páginas, seguindo o cursor.
async function todasAsPaginas(sessao: Sessao, parametros: Record<string, string>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  let paginas = 0;
  do {
    const atual = await pagina(sessao, { ...parametros, ...(cursor ? { cursor } : {}) });
    ids.push(...atual.items.map((s) => s.id));
    cursor = atual.proximo_cursor;
    paginas += 1;
  } while (cursor !== null && paginas < 50);
  return { ids, paginas };
}

const NOVEMBRO = { de: '2026-11-01T00:00:00-03:00', ate: '2026-12-01T00:00:00-03:00' };

async function profissionalComPaciente() {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  return { sessao, pacienteId };
}

describe('exige sessão', () => {
  it('sem sessão responde 401', async () => {
    const resposta = await listar(null, NOVEMBRO);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('intervalo (AGE-03)', () => {
  it.each([
    ['acima de 62 dias', { de: '2026-11-01T00:00:00Z', ate: '2027-01-02T00:00:01Z' }],
    ['ate igual a de', { de: '2026-11-01T00:00:00Z', ate: '2026-11-01T00:00:00Z' }],
    ['ate antes de de', { de: '2026-11-02T00:00:00Z', ate: '2026-11-01T00:00:00Z' }],
    ['sem ate', { de: '2026-11-01T00:00:00Z' }],
    ['sem de', { ate: '2026-11-01T00:00:00Z' }],
    ['sem offset', { de: '2026-11-01T00:00:00', ate: '2026-11-08T00:00:00' }],
    ['limit 0', { ...NOVEMBRO, limit: '0' }],
    ['limit 101', { ...NOVEMBRO, limit: '101' }],
    ['limit não numérico', { ...NOVEMBRO, limit: 'dez' }],
    ['cursor malformado', { ...NOVEMBRO, cursor: 'xyz' }],
  ])('%s responde 400 consulta_invalida', async (_rotulo, parametros) => {
    const { sessao } = await profissionalComPaciente();
    const resposta = await listar(sessao, parametros as Record<string, string>);
    expect(resposta.status).toBe(400);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual(PROBLEMA_CONSULTA_SESSOES_INVALIDA);
  });

  it('exatamente 62 dias é aceito', async () => {
    const { sessao } = await profissionalComPaciente();
    const resposta = await listar(sessao, {
      de: '2026-11-01T00:00:00Z',
      ate: '2027-01-02T00:00:00Z',
    });
    expect(resposta.status).toBe(200);
  });

  it('[de, ate): início em de entra, início em ate fica de fora', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const naBorda = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-10T00:00:00-03:00',
      fim: '2026-11-10T00:50:00-03:00',
    });
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-17T00:00:00-03:00',
      fim: '2026-11-17T00:50:00-03:00',
    });
    // Começa antes de `de` e termina depois: o início manda.
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-09T23:30:00-03:00',
      fim: '2026-11-10T00:20:00-03:00',
    });
    const { items } = await pagina(sessao, {
      de: '2026-11-10T00:00:00-03:00',
      ate: '2026-11-17T00:00:00-03:00',
    });
    expect(items.map((s) => s.id)).toEqual([naBorda]);
  });

  it('traz a sessão no formato do contrato, em qualquer status', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const id = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-10T10:00:00-03:00',
      fim: '2026-11-10T10:50:00-03:00',
      status: 'cancelada',
    });
    const { items, proximo_cursor } = await pagina(sessao, NOVEMBRO);
    expect(proximo_cursor).toBeNull();
    expect(items).toEqual([
      {
        id,
        paciente_id: pacienteId,
        serie_id: null,
        inicio: '2026-11-10T13:00:00.000Z',
        fim: '2026-11-10T13:50:00.000Z',
        link: null,
        status: 'cancelada',
        cobravel: false,
        row_version: 1,
        criado_em: expect.any(String),
      },
    ]);
  });
});

describe('paginação com cursor (AGE-03)', () => {
  it('limit padrão 50: 51 sessões dão 50 na primeira página e 1 na segunda', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    await comoAdmin(
      `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim)
       select $1, $2, t, t + interval '50 minutes'
       from generate_series('2026-11-02T11:00:00Z'::timestamptz, '2026-11-02T11:00:00Z'::timestamptz
         + interval '50 hours', interval '1 hour') t`,
      [sessao.usuarioId, pacienteId],
    );
    const primeira = await pagina(sessao, NOVEMBRO);
    expect(primeira.items).toHaveLength(50);
    expect(primeira.proximo_cursor).not.toBeNull();
    const segunda = await pagina(sessao, { ...NOVEMBRO, cursor: primeira.proximo_cursor! });
    expect(segunda.items).toHaveLength(1);
    expect(segunda.proximo_cursor).toBeNull();
  });

  it('limit 100 é aceito e a lista vem em ordem (início, id)', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const mesmoInicio = { inicio: '2026-11-11T10:00:00-03:00', fim: '2026-11-11T10:50:00-03:00' };
    const ids = [
      await semearSessao(sessao.usuarioId, pacienteId, mesmoInicio),
      await semearSessao(sessao.usuarioId, pacienteId, mesmoInicio),
      await semearSessao(sessao.usuarioId, pacienteId, mesmoInicio),
    ].sort();
    const antes = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-10T10:00:00-03:00',
      fim: '2026-11-10T10:50:00-03:00',
    });
    const { items } = await pagina(sessao, { ...NOVEMBRO, limit: '100' });
    expect(items.map((s) => s.id)).toEqual([antes, ...ids]);
  });

  it('páginas de 2 cobrem todas as sessões, sem repetir, inclusive com início igual', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    const criadas: string[] = [];
    for (const dia of ['10', '10', '10', '11', '12', '12', '13']) {
      criadas.push(
        await semearSessao(sessao.usuarioId, pacienteId, {
          inicio: `2026-11-${dia}T10:00:00-03:00`,
          fim: `2026-11-${dia}T10:50:00-03:00`,
        }),
      );
    }
    const esperado = (await pagina(sessao, NOVEMBRO)).items.map((s) => s.id);
    expect(new Set(esperado)).toEqual(new Set(criadas));

    const { ids, paginas } = await todasAsPaginas(sessao, { ...NOVEMBRO, limit: '2' });
    expect(ids).toEqual(esperado);
    expect(paginas).toBe(4);
  });

  it('sessão criada antes do cursor entre uma página e outra não repete nem pula', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    for (const dia of ['10', '11', '12', '13'])
      await semearSessao(sessao.usuarioId, pacienteId, {
        inicio: `2026-11-${dia}T10:00:00-03:00`,
        fim: `2026-11-${dia}T10:50:00-03:00`,
      });
    const primeira = await pagina(sessao, { ...NOVEMBRO, limit: '2' });
    await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: '2026-11-09T10:00:00-03:00',
      fim: '2026-11-09T10:50:00-03:00',
    });
    const segunda = await pagina(sessao, {
      ...NOVEMBRO,
      limit: '2',
      cursor: primeira.proximo_cursor!,
    });
    const dias = (p: PaginaSessoes) => p.items.map((s) => s.inicio.slice(0, 10));
    expect(dias(primeira)).toEqual(['2026-11-10', '2026-11-11']);
    expect(dias(segunda)).toEqual(['2026-11-12', '2026-11-13']);
    expect(segunda.proximo_cursor).toBeNull();
  });

  it('início com microssegundos (gravado pelo banco) não volta na página seguinte', async () => {
    const { sessao, pacienteId } = await profissionalComPaciente();
    for (const micro of ['000100', '000200', '000300'])
      await semearSessao(sessao.usuarioId, pacienteId, {
        inicio: `2026-11-10T13:00:00.${micro}Z`,
        fim: '2026-11-10T13:50:00Z',
      });
    const { ids, paginas } = await todasAsPaginas(sessao, { ...NOVEMBRO, limit: '1' });
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(paginas).toBe(3);
  });
});

describe('isolamento (ISO-02)', () => {
  it('só as sessões do profissional aparecem', async () => {
    const a = await profissionalComPaciente();
    const b = await profissionalComPaciente();
    const deA = await semearSessao(a.sessao.usuarioId, a.pacienteId, {
      inicio: '2026-11-10T10:00:00-03:00',
      fim: '2026-11-10T10:50:00-03:00',
    });
    await semearSessao(b.sessao.usuarioId, b.pacienteId, {
      inicio: '2026-11-10T10:00:00-03:00',
      fim: '2026-11-10T10:50:00-03:00',
    });
    expect((await pagina(a.sessao, NOVEMBRO)).items.map((s) => s.id)).toEqual([deA]);
  });

  it('o cursor de outro profissional não revela as sessões dele', async () => {
    const a = await profissionalComPaciente();
    const b = await profissionalComPaciente();
    for (const dia of ['10', '11'])
      await semearSessao(b.sessao.usuarioId, b.pacienteId, {
        inicio: `2026-11-${dia}T10:00:00-03:00`,
        fim: `2026-11-${dia}T10:50:00-03:00`,
      });
    const deB = await pagina(b.sessao, { ...NOVEMBRO, limit: '1' });
    const comCursorDeB = await pagina(a.sessao, { ...NOVEMBRO, cursor: deB.proximo_cursor! });
    expect(comCursorDeB.items).toEqual([]);
  });
});
