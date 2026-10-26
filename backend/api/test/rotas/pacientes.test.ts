import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_CONSULTA_INVALIDA } from '@es/contrato/pacientes';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, linhaPaciente, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';

// T69 / PAC-01, PAC-02, PAC-07, ISO-02: POST e GET /api/pacientes. Criar aceita só o nome como
// obrigatório (vazio vira null, campo extra = 422); a listagem filtra por q (parte do nome, sem
// diferença de maiúsculas, curingas do LIKE tratados como texto) e por ativo (true/false; outro
// valor = 400), com limit de 1 a 100 (padrão 50) e offset >= 0. Não existe exclusão de paciente.
// O profissional B não vê os pacientes de A, e um id de A responde para B o mesmo 404 de um id
// inexistente. Casos do T-030 do legado (backend/test/patients.spec.ts) vêm junto.

const criar = (sessao: Sessao, corpo: unknown) => pedir('POST', '/api/pacientes', sessao, corpo);

async function nomes(sessao: Sessao, consulta = ''): Promise<string[]> {
  const resposta = await pedir('GET', `/api/pacientes${consulta}`, sessao);
  expect(resposta.status, consulta).toBe(200);
  return ((await resposta.json()) as { items: { nome: string }[] }).items.map((p) => p.nome);
}

describe('POST e GET /api/pacientes exigem sessão e CSRF', () => {
  it('sem sessão responde 401 nas duas', async () => {
    for (const metodo of ['GET', 'POST'] as const) {
      const resposta = await pedir(
        metodo,
        '/api/pacientes',
        null,
        metodo === 'POST' ? { nome: 'A' } : undefined,
      );
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });

  it('POST sem x-csrf-token responde 403 e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    const resposta = await app.request(
      '/api/pacientes',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify({ nome: 'Maria' }),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(
      await comoAdmin('select 1 from paciente where usuario_id = $1', [sessao.usuarioId]),
    ).toEqual([]);
  });
});

describe('criar paciente (PAC-01)', () => {
  it('só o nome é obrigatório: responde 201 com o paciente ativo', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await criar(sessao, { nome: 'Maria Silva' });

    expect(resposta.status).toBe(201);
    const corpo = (await resposta.json()) as Record<string, unknown>;
    expect(corpo).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      nome: 'Maria Silva',
      telefone: null,
      email: null,
      endereco: null,
      ativo: true,
      row_version: 1,
      criado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await linhaPaciente(corpo['id'] as string)).toMatchObject({
      usuario_id: sessao.usuarioId,
      nome: 'Maria Silva',
      ativo: true,
    });
  });

  it('apara os textos e grava vazio como null', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await criar(sessao, {
      nome: '  Ana  ',
      telefone: ' ',
      email: '',
      endereco: '  Rua A, 1 ',
    });

    const { id } = (await resposta.json()) as { id: string };
    expect(await linhaPaciente(id)).toMatchObject({
      nome: 'Ana',
      telefone: null,
      email: null,
      endereco: 'Rua A, 1',
    });
  });

  it('grava telefone, e-mail e endereço nos limites', async () => {
    const sessao = await sessaoDeTeste();
    const email = `${'x'.repeat(250)}@a.b`;

    const resposta = await criar(sessao, {
      nome: 'x'.repeat(200),
      telefone: 'x'.repeat(40),
      email,
      endereco: 'x'.repeat(500),
    });

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toMatchObject({ telefone: 'x'.repeat(40), email });
  });

  it.each([
    ['sem nome', { telefone: '11' }, ['nome']],
    ['nome só com espaços', { nome: '   ' }, ['nome']],
    ['nome com 201', { nome: 'x'.repeat(201) }, ['nome']],
    ['telefone com 41', { nome: 'A', telefone: 'x'.repeat(41) }, ['telefone']],
    ['e-mail sem arroba', { nome: 'A', email: 'x' }, ['email']],
    ['e-mail com espaço', { nome: 'A', email: 'a b@c' }, ['email']],
    ['endereço com 501', { nome: 'A', endereco: 'x'.repeat(501) }, ['endereco']],
    ['campo extra ativo', { nome: 'A', ativo: false }, ['ativo']],
    ['usuario_id no corpo', { nome: 'A', usuario_id: crypto.randomUUID() }, ['usuario_id']],
  ])('%s responde 422 validacao e nada é gravado', async (_caso, corpo, campos) => {
    const sessao = await sessaoDeTeste();

    const resposta = await criar(sessao, corpo);

    expect(resposta.status).toBe(422);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toMatchObject({ status: 422, codigo: 'validacao', campos });
    expect(
      await comoAdmin('select 1 from paciente where usuario_id = $1', [sessao.usuarioId]),
    ).toEqual([]);
  });
});

describe('listar e buscar (PAC-02)', () => {
  it('lista todos, em ordem de nome sem diferença de maiúsculas, com limit e offset', async () => {
    const sessao = await sessaoDeTeste();
    for (const nome of ['Maria Silva', 'joao Pereira', '100% Teste']) await criar(sessao, { nome });
    await semearPaciente(sessao.usuarioId, { nome: 'Zé Inativo', ativo: false });

    expect(await nomes(sessao)).toEqual([
      '100% Teste',
      'joao Pereira',
      'Maria Silva',
      'Zé Inativo',
    ]);
    expect(await nomes(sessao, '?limit=1&offset=1')).toEqual(['joao Pereira']);
    expect(await nomes(sessao, '?limit=2&offset=3')).toEqual(['Zé Inativo']);
    expect(await nomes(sessao, '?offset=4')).toEqual([]);
  });

  it('devolve limit e offset aplicados; padrão 50 e 0', async () => {
    const sessao = await sessaoDeTeste();

    const padrao = await (await pedir('GET', '/api/pacientes', sessao)).json();
    const pedido = await (await pedir('GET', '/api/pacientes?limit=100&offset=7', sessao)).json();

    expect(padrao).toEqual({ items: [], limit: 50, offset: 0 });
    expect(pedido).toEqual({ items: [], limit: 100, offset: 7 });
  });

  it('o padrão devolve no máximo 50', async () => {
    const sessao = await sessaoDeTeste();
    await comoAdmin(
      `insert into paciente (usuario_id, nome)
       select $1, 'Paciente ' || lpad(n::text, 3, '0') from generate_series(1, 51) n`,
      [sessao.usuarioId],
    );

    const lista = await nomes(sessao);

    expect(lista).toHaveLength(50);
    expect(lista.at(-1)).toBe('Paciente 050');
  });

  it('q busca parte do nome, sem diferença de maiúsculas', async () => {
    const sessao = await sessaoDeTeste();
    for (const nome of ['Maria Silva', 'joao Pereira']) await criar(sessao, { nome });

    expect(await nomes(sessao, '?q=JOAO')).toEqual(['joao Pereira']);
    expect(await nomes(sessao, '?q=pereira')).toEqual(['joao Pereira']);
    expect(await nomes(sessao, '?q=%20%20')).toEqual(['joao Pereira', 'Maria Silva']);
  });

  it('curingas escapados: % e _ e \\ na busca são texto, não padrão', async () => {
    const sessao = await sessaoDeTeste();
    for (const nome of ['100% Teste', 'Ana_Maria', 'Barra\\Nome', 'Ana Maria', 'Bianca'])
      await criar(sessao, { nome });

    expect(await nomes(sessao, '?q=%25')).toEqual(['100% Teste']);
    expect(await nomes(sessao, '?q=_')).toEqual(['Ana_Maria']);
    expect(await nomes(sessao, `?q=${encodeURIComponent('\\')}`)).toEqual(['Barra\\Nome']);
    expect(await nomes(sessao, '?q=a%25a')).toEqual([]);
  });

  it('ativo=true e ativo=false filtram', async () => {
    const sessao = await sessaoDeTeste();
    await criar(sessao, { nome: 'Ativa' });
    await semearPaciente(sessao.usuarioId, { nome: 'Inativa', ativo: false });

    expect(await nomes(sessao, '?ativo=true')).toEqual(['Ativa']);
    expect(await nomes(sessao, '?ativo=false')).toEqual(['Inativa']);
    expect(await nomes(sessao, '?ativo=true&q=Inat')).toEqual([]);
  });

  it.each([
    ['ativo=x'],
    ['ativo=1'],
    ['ativo='],
    ['limit=0'],
    ['limit=101'],
    ['limit=abc'],
    ['limit=1.5'],
    ['offset=-1'],
    ['offset=abc'],
  ])('%s responde 400', async (consulta) => {
    const sessao = await sessaoDeTeste();

    const resposta = await pedir('GET', `/api/pacientes?${consulta}`, sessao);

    expect(resposta.status).toBe(400);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    expect(await resposta.json()).toEqual(PROBLEMA_CONSULTA_INVALIDA);
  });
});

describe('isolamento (ISO-02)', () => {
  it('B não vê os pacientes de A na lista nem na busca', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const nome = `Privada ${crypto.randomUUID()}`;
    await criar(a, { nome });

    expect(await nomes(b)).toEqual([]);
    expect(await nomes(b, `?q=${encodeURIComponent(nome)}`)).toEqual([]);
    expect(await nomes(a, `?q=${encodeURIComponent(nome)}`)).toEqual([nome]);
  });

  it('um id de A responde para B o mesmo 404 de um id inexistente', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const id = await semearPaciente(a.usuarioId);

    for (const metodo of ['GET', 'PUT', 'DELETE'] as const) {
      const deA = await pedir(metodo, `/api/pacientes/${id}`, b, metodo === 'PUT' ? {} : undefined);
      const inexistente = await pedir(
        metodo,
        `/api/pacientes/${crypto.randomUUID()}`,
        b,
        metodo === 'PUT' ? {} : undefined,
      );
      expect(deA.status, metodo).toBe(404);
      expect(inexistente.status, metodo).toBe(404);
      expect(await deA.text(), metodo).toBe(await inexistente.text());
    }
    expect(await linhaPaciente(id)).toMatchObject({ usuario_id: a.usuarioId, nome: 'Maria Silva' });
  });
});

describe('sem exclusão de paciente (PAC-07)', () => {
  it('DELETE não existe: responde 404 e o paciente continua lá', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    for (const caminho of [`/api/pacientes/${id}`, '/api/pacientes']) {
      const resposta = await pedir('DELETE', caminho, sessao);
      expect(resposta.status, caminho).toBe(404);
    }
    expect(await linhaPaciente(id)).toMatchObject({ ativo: true });
  });
});
