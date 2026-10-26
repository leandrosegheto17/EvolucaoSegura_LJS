import {
  type ModeloTexto,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
  PROBLEMA_NOME_MODELO_EXISTENTE,
} from '@es/contrato/clinico';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { PROBLEMA_CONSULTA_INVALIDA } from '@es/contrato/pacientes';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, pedir } from './pacientes-apoio.ts';

// T105 / RAS-03, ISO-02: GET, POST e PUT /api/modelos-texto.
// - RAS-03: modelos do tipo evolucao, nome de 1 a 200 único sem diferenciar maiúsculas, corpo até
//   50.000, arquiváveis (arquivar em vez de apagar).
// - ISO-02: B não lê nem altera modelo de A (404 igual ao inexistente).
// Decisões do usuário (2026-10-26): tipo obrigatório e só evolucao (outro = 422); PUT {nome,
// corpo, arquivado} edita e arquiva ou desarquiva; nome duplicado = 409 TEMPLATE_NAME_EXISTS;
// nome único só entre os não arquivados; listagem com ?arquivados=.

const LENTO = { timeout: 30_000 };

const criar = (sessao: Sessao | null, corpo: Record<string, unknown>) =>
  pedir('POST', '/api/modelos-texto', sessao, { tipo: 'evolucao', corpo: 'c', ...corpo });
const editar = (sessao: Sessao, id: string, corpo: Record<string, unknown>) =>
  pedir('PUT', `/api/modelos-texto/${id}`, sessao, corpo);
const listar = async (sessao: Sessao, consulta = '') => {
  const resposta = await pedir('GET', `/api/modelos-texto${consulta}`, sessao);
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as { items: ModeloTexto[] }).items;
};

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const modelosDe = (usuarioId: string) =>
  comoAdmin<{ id: string; nome: string; arquivado: boolean }>(
    `select id, nome, arquivado_em is not null as arquivado from modelo_texto
     where usuario_id = $1 order by criado_em, id`,
    [usuarioId],
  );

async function comModelo(nome = 'Sessão inicial') {
  const sessao = await sessaoDeTeste();
  const resposta = await criar(sessao, { nome, corpo: 'Queixa: ' });
  expect(resposta.status).toBe(201);
  return { sessao, modelo: (await resposta.json()) as ModeloTexto };
}

describe('exige sessão', LENTO, () => {
  it('sem sessão, GET, POST e PUT respondem 401', async () => {
    for (const resposta of [
      await pedir('GET', '/api/modelos-texto', null),
      await criar(null, { nome: 'x' }),
      await pedir('PUT', `/api/modelos-texto/${crypto.randomUUID()}`, null, {}),
    ]) {
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });
});

describe('criar (RAS-03)', LENTO, () => {
  it('201 com o modelo: nome aparado, tipo evolucao, não arquivado', async () => {
    const sessao = await sessaoDeTeste();
    const resposta = await criar(sessao, { nome: '  Retorno ', corpo: 'Paciente relata' });
    expect(resposta.status).toBe(201);
    const modelo = (await resposta.json()) as ModeloTexto;
    expect(modelo).toEqual({
      id: expect.any(String),
      tipo: 'evolucao',
      nome: 'Retorno',
      corpo: 'Paciente relata',
      arquivado: false,
      row_version: 1,
    });
    expect(await listar(sessao)).toEqual([modelo]);
  });

  it('nome de 200 e corpo de 50.000 são aceitos', async () => {
    const sessao = await sessaoDeTeste();
    const resposta = await criar(sessao, { nome: 'n'.repeat(200), corpo: 'c'.repeat(50_000) });
    expect(resposta.status).toBe(201);
  });

  it.each([
    ['tipo relatorio', { tipo: 'relatorio', nome: 'x' }],
    ['sem tipo', { tipo: undefined, nome: 'x' }],
    ['nome vazio', { nome: '   ' }],
    ['nome de 201', { nome: 'n'.repeat(201) }],
    ['corpo de 50.001', { nome: 'x', corpo: 'c'.repeat(50_001) }],
    ['campo extra', { nome: 'x', usuario_id: crypto.randomUUID() }],
  ])('%s: 422 validacao e nada é criado', async (_rotulo, corpo) => {
    const sessao = await sessaoDeTeste();
    const resposta = await criar(sessao, corpo);
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao' });
    expect(await modelosDe(sessao.usuarioId)).toEqual([]);
  });

  it('nome duplicado sem diferenciar maiúsculas: 409 TEMPLATE_NAME_EXISTS', async () => {
    const { sessao } = await comModelo('Sessão inicial');
    for (const nome of ['SESSÃO INICIAL', 'sessão inicial', ' Sessão inicial '])
      await esperarProblema(await criar(sessao, { nome }), 409, PROBLEMA_NOME_MODELO_EXISTENTE);
    expect(await modelosDe(sessao.usuarioId)).toHaveLength(1);
  });
});

describe('arquivar em vez de apagar (RAS-03)', LENTO, () => {
  it('PUT com arquivado: some da lista padrão, aparece com arquivados=true e a linha fica', async () => {
    const { sessao, modelo } = await comModelo();
    const resposta = await editar(sessao, modelo.id, {
      nome: modelo.nome,
      corpo: modelo.corpo,
      arquivado: true,
    });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ id: modelo.id, arquivado: true, row_version: 2 });
    expect(await listar(sessao)).toEqual([]);
    expect(await listar(sessao, '?arquivados=true')).toEqual([
      expect.objectContaining({ id: modelo.id, arquivado: true }),
    ]);
    expect(await modelosDe(sessao.usuarioId)).toEqual([
      { id: modelo.id, nome: modelo.nome, arquivado: true },
    ]);
  });

  it('não existe rota DELETE: 404 e o modelo continua', async () => {
    const { sessao, modelo } = await comModelo();
    expect((await pedir('DELETE', `/api/modelos-texto/${modelo.id}`, sessao)).status).toBe(404);
    expect(await modelosDe(sessao.usuarioId)).toHaveLength(1);
  });

  it('arquivado libera o nome; desarquivar com o nome tomado: 409', async () => {
    const { sessao, modelo } = await comModelo('Inicial');
    await editar(sessao, modelo.id, { nome: 'Inicial', corpo: 'c', arquivado: true });
    const novo = await criar(sessao, { nome: 'INICIAL' });
    expect(novo.status).toBe(201);
    await esperarProblema(
      await editar(sessao, modelo.id, { nome: 'Inicial', corpo: 'c', arquivado: false }),
      409,
      PROBLEMA_NOME_MODELO_EXISTENTE,
    );
    expect((await modelosDe(sessao.usuarioId)).map((m) => m.arquivado)).toEqual([true, false]);
  });

  it('desarquivar (arquivado ausente = false) volta à lista padrão', async () => {
    const { sessao, modelo } = await comModelo();
    await editar(sessao, modelo.id, { nome: modelo.nome, corpo: modelo.corpo, arquivado: true });
    const resposta = await editar(sessao, modelo.id, { nome: modelo.nome, corpo: modelo.corpo });
    expect(resposta.status).toBe(200);
    expect(await listar(sessao)).toEqual([
      expect.objectContaining({ id: modelo.id, arquivado: false }),
    ]);
  });

  it('arquivados com valor inválido na consulta: 400', async () => {
    const sessao = await sessaoDeTeste();
    await esperarProblema(
      await pedir('GET', '/api/modelos-texto?arquivados=sim', sessao),
      400,
      PROBLEMA_CONSULTA_INVALIDA,
    );
  });
});

describe('editar (RAS-03)', LENTO, () => {
  it('troca nome e corpo e sobe a versão', async () => {
    const { sessao, modelo } = await comModelo();
    const resposta = await editar(sessao, modelo.id, { nome: 'Alta', corpo: 'Novo corpo' });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      ...modelo,
      nome: 'Alta',
      corpo: 'Novo corpo',
      row_version: 2,
    });
  });

  it('renomear para o nome de outro modelo: 409; trocar só a caixa do próprio é aceito', async () => {
    const { sessao, modelo } = await comModelo('Inicial');
    await criar(sessao, { nome: 'Retorno' });
    await esperarProblema(
      await editar(sessao, modelo.id, { nome: 'retorno', corpo: 'c' }),
      409,
      PROBLEMA_NOME_MODELO_EXISTENTE,
    );
    expect((await editar(sessao, modelo.id, { nome: 'INICIAL', corpo: 'c' })).status).toBe(200);
  });

  it('tipo no corpo da edição: 422 (não muda)', async () => {
    const { sessao, modelo } = await comModelo();
    const resposta = await editar(sessao, modelo.id, { nome: 'x', corpo: 'c', tipo: 'relatorio' });
    expect(resposta.status).toBe(422);
  });

  it('lista em ordem de nome sem diferenciar maiúsculas', async () => {
    const sessao = await sessaoDeTeste();
    for (const nome of ['beta', 'Alfa', 'gama']) await criar(sessao, { nome });
    expect((await listar(sessao)).map((m) => m.nome)).toEqual(['Alfa', 'beta', 'gama']);
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('B não lista nem altera modelo de A; id inexistente ou malformado: o mesmo 404', async () => {
    const a = await comModelo('Inicial');
    const b = await sessaoDeTeste();
    expect(await listar(b, '?arquivados=true')).toEqual([]);
    for (const id of [a.modelo.id, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await editar(b, id, { nome: 'Tomado', corpo: 'c', arquivado: true }),
        404,
        PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
    expect(await modelosDe(a.sessao.usuarioId)).toEqual([
      { id: a.modelo.id, nome: 'Inicial', arquivado: false },
    ]);
  });

  it('o mesmo nome em profissionais diferentes não conflita', async () => {
    await comModelo('Inicial');
    const b = await sessaoDeTeste();
    expect((await criar(b, { nome: 'Inicial' })).status).toBe(201);
  });
});
