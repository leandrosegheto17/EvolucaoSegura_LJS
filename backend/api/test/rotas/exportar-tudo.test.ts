import {
  PROBLEMA_CURSOR_INVALIDO,
  PROBLEMA_PAGINA_INVALIDA,
  type PaginaExportacao,
  TABELAS_EXPORTACAO,
  TAMANHO_MAXIMO_PAGINA,
} from '@es/contrato/exportacao';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { beforeAll, describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, pedir } from './pacientes-apoio.ts';

// T171 / EXP-03, EXP-04, ISO-02 (D-32): GET /api/exportacao?cursor=&limite=, a exportação
// completa em páginas por tabela, com cursor e tamanho máximo de 25 linhas (T122).
// - Seguindo `proximo_cursor` desde a primeira página (sem cursor) até null, cada tabela da lista
//   chega inteira, sem repetir nem perder linha, cada página com uma tabela só e no máximo o
//   limite pedido (EXP-03).
// - Página acima do máximo (ou limite fora do formato) e cursor inválido respondem 400 sem
//   auditar (EXP-04).
// - Só os dados do próprio profissional (ISO-02).

const LENTO = { timeout: 60_000 };

const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
  (await comoAdmin<T>(sql, p))[0]!;

// Uma ou mais linhas em cada tabela da lista; 26 pacientes para passar de uma página cheia.
async function semear(u: string) {
  await comoAdmin(
    `insert into perfil (usuario_id, nome, especialidade) values ($1, 'Dra. Exporta', 'psicologia')`,
    [u],
  );
  await comoAdmin(`insert into configuracao_usuario (usuario_id) values ($1)`, [u]);
  const modelo = (
    await um<{ id: string }>(
      `insert into modelo_anamnese (usuario_id, especialidade) values ($1, 'psicologia') returning id`,
      [u],
    )
  ).id;
  await comoAdmin(
    `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, rotulo, ordem, revisao_inclusao)
     values ($1, $2, 'campo', 'Queixa', 0, 1), ($1, $2, 'alerta', 'Risco', 0, 1)`,
    [u, modelo],
  );
  const pacientes = (
    await comoAdmin<{ id: string }>(
      `insert into paciente (usuario_id, nome)
       select $1, 'Paciente ' || g from generate_series(1, 26) g returning id`,
      [u],
    )
  ).map((p) => p.id);
  const [p1, p2] = pacientes as [string, string];
  await comoAdmin(
    `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento,
                                     versao_termo)
     values ($1, $2, 'Atendimento', '2026-10-01', 'v1'), ($1, $3, 'Atendimento', '2026-10-02', 'v1')`,
    [u, p1, p2],
  );
  await comoAdmin(
    `insert into serie_recorrencia (usuario_id, paciente_id, frequencia, ocorrencias)
     values ($1, $2, 'semanal', 4)`,
    [u, p1],
  );
  const sessoes = (
    await comoAdmin<{ id: string }>(
      `insert into sessao_atendimento (usuario_id, paciente_id, inicio, fim)
       select $1, $2, now() + (g || ' days')::interval, now() + (g || ' days')::interval + interval '50 min'
       from generate_series(1, 4) g returning id`,
      [u, p1],
    )
  ).map((s) => s.id);
  const [s1, s2, s3] = sessoes as [string, string, string];
  const anamnese = (
    await um<{ id: string }>(
      `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao, valores)
       values ($1, $2, $3, '2026-09-01', 1, '{}') returning id`,
      [u, p1, modelo],
    )
  ).id;
  await comoAdmin(
    `insert into anamnese_retificacao (usuario_id, anamnese_id, seq, motivo, modelo_revisao, valores)
     values ($1, $2, 1, 'motivo', 1, '{}')`,
    [u, anamnese],
  );
  const evolucoes = (
    await comoAdmin<{ id: string }>(
      `insert into evolucao (usuario_id, paciente_id, sessao_id, texto)
       values ($1, $2, $3, 'evolução um'), ($1, $2, $4, 'evolução dois'), ($1, $2, null, 'evolução três')
       returning id`,
      [u, p1, s1, s2],
    )
  ).map((e) => e.id);
  await comoAdmin(
    `insert into evolucao_retificacao (usuario_id, evolucao_id, seq, texto, motivo)
     values ($1, $2, 1, 'texto retificado', 'motivo')`,
    [u, evolucoes[0]],
  );
  await comoAdmin(
    `insert into rascunho (usuario_id, tipo, ref, payload) values ($1, 'evolucao', 'sessao-1', '{"texto":"r"}')`,
    [u],
  );
  await comoAdmin(
    `insert into modelo_texto (usuario_id, tipo, nome, corpo) values ($1, 'evolucao', 'Padrão', 'corpo')`,
    [u],
  );
  await comoAdmin(
    `insert into preco_paciente (usuario_id, paciente_id, valor_centavos) values ($1, $2, 10000), ($1, $3, 12000)`,
    [u, p1, p2],
  );
  await comoAdmin(
    `insert into preco_sessao (usuario_id, sessao_id, valor_centavos) values ($1, $2, 9000), ($1, $3, 9500)`,
    [u, s1, s2],
  );
  await comoAdmin(
    `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
     values ($1, $2, 10000, '2026-10-05', 'pix'), ($1, $3, 10000, '2026-10-06', 'dinheiro'),
            ($1, $4, 10000, '2026-10-07', 'cartao')`,
    [u, s1, s2, s3],
  );
  // Cada alteração grava uma revisão antes/depois (trigger da 0010), que passa pelo RLS forçado
  // das revisões: o usuário da transação precisa estar definido. `u` é um uuid do próprio banco.
  await comoAdmin(`begin;
    select set_config('app.usuario_id', '${u}', true);
    update preco_paciente set valor_centavos = valor_centavos + 1 where usuario_id = '${u}';
    update preco_sessao set valor_centavos = valor_centavos + 1 where usuario_id = '${u}';
    update pagamento set valor_centavos = 11000 where usuario_id = '${u}';
    commit;`);
}

// Linhas de cada tabela da lista no banco, vistas pelo superusuário.
async function noBanco(u: string): Promise<Record<string, Record<string, unknown>[]>> {
  const resultado: Record<string, Record<string, unknown>[]> = {};
  for (const tabela of TABELAS_EXPORTACAO)
    resultado[tabela] = (
      await comoAdmin<{ linha: Record<string, unknown> }>(
        `select to_jsonb(t) as linha from ${tabela} t where usuario_id = $1`,
        [u],
      )
    ).map((r) => r.linha);
  return resultado;
}

const caminho = (consulta: Record<string, string>) => {
  const q = new URLSearchParams(consulta).toString();
  return `/api/exportacao${q ? `?${q}` : ''}`;
};

async function pagina(sessao: Sessao, consulta: Record<string, string> = {}) {
  const resposta = await pedir('GET', caminho(consulta), sessao);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as PaginaExportacao;
}

// Segue os cursores desde a primeira página até proximo_cursor null.
async function exportarTudo(sessao: Sessao, limite?: number) {
  const paginas: PaginaExportacao[] = [];
  let cursor: string | null = null;
  do {
    const consulta: Record<string, string> = {};
    if (cursor !== null) consulta['cursor'] = cursor;
    if (limite !== undefined) consulta['limite'] = String(limite);
    const atual = await pagina(sessao, consulta);
    paginas.push(atual);
    cursor = atual.proximo_cursor;
    expect(paginas.length).toBeLessThan(500);
  } while (cursor !== null);
  return paginas;
}

const porTabela = (paginas: PaginaExportacao[]) => {
  const linhas: Record<string, Record<string, unknown>[]> = {};
  for (const p of paginas) (linhas[p.tabela] ??= []).push(...p.linhas);
  return linhas;
};

const ids = (linhas: Record<string, unknown>[] = []) => linhas.map((l) => String(l['id'])).sort();

async function esperarProblema(resposta: Response, problema: unknown) {
  expect(resposta.status).toBe(400);
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

const auditoriaTotal = async (u: string) =>
  Number(
    (await um<{ n: string }>(`select count(*) as n from audit_log where usuario_id = $1`, [u])).n,
  );

let a: Sessao;
let b: Sessao;
let bancoA: Record<string, Record<string, unknown>[]>;

beforeAll(async () => {
  a = await sessaoDeTeste();
  b = await sessaoDeTeste();
  await semear(a.usuarioId);
  await semear(b.usuarioId);
  bancoA = await noBanco(a.usuarioId);
}, 120_000);

describe('exige sessão', LENTO, () => {
  it('sem sessão responde 401', async () => {
    const resposta = await pedir('GET', '/api/exportacao', null);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('páginas por tabela com cursor (EXP-03)', LENTO, () => {
  it('com o tamanho máximo: todas as tabelas na ordem, cada uma inteira, sem repetir linha', async () => {
    const paginas = await exportarTudo(a);
    const tabelasNaOrdem = [...new Set(paginas.map((p) => p.tabela))];
    expect(tabelasNaOrdem).toEqual([...TABELAS_EXPORTACAO]);
    for (const p of paginas) expect(p.linhas.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_PAGINA);
    const exportado = porTabela(paginas);
    for (const tabela of TABELAS_EXPORTACAO) {
      expect(bancoA[tabela]!.length).toBeGreaterThan(0);
      expect(ids(exportado[tabela]), tabela).toEqual(ids(bancoA[tabela]));
    }
    // 26 pacientes: uma página cheia de 25 e outra com 1.
    expect(paginas.filter((p) => p.tabela === 'paciente').map((p) => p.linhas.length)).toEqual([
      25, 1,
    ]);
  });

  it('com limite menor, o cursor anda dentro de cada tabela sem repetir nem perder linha', async () => {
    const paginas = await exportarTudo(a, 2);
    for (const p of paginas) expect(p.linhas.length).toBeLessThanOrEqual(2);
    const exportado = porTabela(paginas);
    for (const tabela of TABELAS_EXPORTACAO) {
      const lista = ids(exportado[tabela]);
      expect(new Set(lista).size, tabela).toBe(lista.length);
      expect(lista, tabela).toEqual(ids(bancoA[tabela]));
    }
    expect(paginas.filter((p) => p.tabela === 'paciente')).toHaveLength(13);
  });

  it('cada linha traz todas as colunas da tabela, com os valores do banco', async () => {
    const exportado = porTabela(await exportarTudo(a));
    for (const tabela of TABELAS_EXPORTACAO) {
      const doBanco = new Map(bancoA[tabela]!.map((l) => [String(l['id']), l]));
      for (const linha of exportado[tabela]!)
        expect(linha, tabela).toEqual(doBanco.get(String(linha['id'])));
    }
  });

  it('a última página da exportação vem com proximo_cursor null', async () => {
    const paginas = await exportarTudo(a);
    expect(paginas.at(-1)!.proximo_cursor).toBeNull();
    expect(paginas.at(-1)!.tabela).toBe('configuracao_usuario');
    expect(paginas.slice(0, -1).every((p) => typeof p.proximo_cursor === 'string')).toBe(true);
  });
});

describe('página acima do máximo ou cursor inválido: 400 sem auditar (EXP-04)', LENTO, () => {
  // Cursor que a API emitiu no meio da exportação, para montar variações inválidas.
  const cursorDe = (conteudo: unknown) =>
    btoa(JSON.stringify(conteudo)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('limite acima do máximo responde 400 pagina_invalida', async () => {
    const antes = await auditoriaTotal(a.usuarioId);
    await esperarProblema(
      await pedir('GET', caminho({ limite: String(TAMANHO_MAXIMO_PAGINA + 1) }), a),
      PROBLEMA_PAGINA_INVALIDA,
    );
    expect(await auditoriaTotal(a.usuarioId)).toBe(antes);
  });

  it.each(['0', '-1', 'abc', '2.5'])('limite fora do formato (%j) responde 400', async (limite) => {
    await esperarProblema(await pedir('GET', caminho({ limite }), a), PROBLEMA_PAGINA_INVALIDA);
  });

  it('limite acima do máximo com um cursor válido também responde 400', async () => {
    const primeira = await pagina(a, { limite: '1' });
    await esperarProblema(
      await pedir('GET', caminho({ cursor: primeira.proximo_cursor!, limite: '26' }), a),
      PROBLEMA_PAGINA_INVALIDA,
    );
  });

  it.each([
    ['texto que não é base64url', 'não-é-cursor!'],
    ['base64 de algo que não é JSON', btoa('isto não é json')],
    ['tabela fora da lista', cursorDe({ t: 'credencial_senha', d: null })],
    ['tabela de sessão', cursorDe({ t: 'sessao', d: null })],
    ['chave que não é uuid', cursorDe({ t: 'paciente', d: 'abc' })],
    ['chave de revisão que não é número', cursorDe({ t: 'pagamento_revisao', d: 'abc' })],
    [
      'chave uuid em tabela de revisão',
      cursorDe({ t: 'pagamento_revisao', d: crypto.randomUUID() }),
    ],
    ['campo a mais', cursorDe({ t: 'paciente', d: null, u: 'x' })],
    ['JSON que não é objeto', cursorDe(['paciente', null])],
  ])('cursor inválido (%s) responde 400 cursor_invalido sem auditar', async (_caso, cursor) => {
    const antes = await auditoriaTotal(a.usuarioId);
    await esperarProblema(await pedir('GET', caminho({ cursor }), a), PROBLEMA_CURSOR_INVALIDO);
    expect(await auditoriaTotal(a.usuarioId)).toBe(antes);
  });
});

describe('isolamento: só os dados do próprio profissional (ISO-02)', LENTO, () => {
  it('a exportação de B não traz nenhuma linha de A, só as de B', async () => {
    const exportado = porTabela(await exportarTudo(b));
    // Chave por tabela: as revisões têm ids bigint de sequências próprias, que se repetem entre tabelas.
    const idsDeA = new Set(
      TABELAS_EXPORTACAO.flatMap((t) => ids(bancoA[t]).map((id) => `${t}:${id}`)),
    );
    for (const tabela of TABELAS_EXPORTACAO)
      for (const linha of exportado[tabela] ?? []) {
        expect(linha['usuario_id'], tabela).toBe(b.usuarioId);
        expect(idsDeA.has(`${tabela}:${String(linha['id'])}`), tabela).toBe(false);
      }
  });

  it('B seguindo um cursor emitido para A só recebe linhas de B', async () => {
    // O cursor de A no meio dos pacientes: B continua a partir da mesma chave, mas só no que é seu.
    const paginasA = await exportarTudo(a, 25);
    const meioPacientes = paginasA.find((p) => p.tabela === 'paciente' && p.proximo_cursor)!;
    const deB = await pagina(b, { cursor: meioPacientes.proximo_cursor! });
    for (const linha of deB.linhas) expect(linha['usuario_id']).toBe(b.usuarioId);
  });
});
