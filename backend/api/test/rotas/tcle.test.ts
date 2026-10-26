import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_PACIENTE_NAO_ENCONTRADO } from '@es/contrato/pacientes';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import { app, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';

// T71 / PAC-05, ISO-02: GET e POST /api/pacientes/:id/tcle. O TCLE é registrado só por inclusão
// (finalidade de 1 a 500, versão de 1 a 50, data YYYY-MM-DD de calendário), sem rota de edição
// nem de exclusão. Paciente de outro profissional, inexistente ou com id malformado: o mesmo
// 404, sem gravar nada. Adaptado do ConsentsController do legado.

const VALIDO = { finalidade: 'Atendimento psicológico', data: '2026-10-01', versao: 'v1' };

const registrar = (sessao: Sessao, pacienteId: string, corpo: unknown) =>
  pedir('POST', `/api/pacientes/${pacienteId}/tcle`, sessao, corpo);

const tclesNoBanco = (pacienteId: string) =>
  comoAdmin<Record<string, unknown>>(
    `select usuario_id, finalidade, to_char(data_consentimento, 'YYYY-MM-DD') as data,
            versao_termo from consentimento_tcle where paciente_id = $1 order by criado_em`,
    [pacienteId],
  );

describe('exigem sessão e CSRF', () => {
  it('sem sessão responde 401 nas duas', async () => {
    const dono = await sessaoDeTeste();
    const id = await semearPaciente(dono.usuarioId);
    for (const metodo of ['GET', 'POST'] as const) {
      const resposta = await pedir(
        metodo,
        `/api/pacientes/${id}/tcle`,
        null,
        metodo === 'POST' ? VALIDO : undefined,
      );
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
    expect(await tclesNoBanco(id)).toEqual([]);
  });

  it('POST sem x-csrf-token responde 403 e nada é gravado', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    const resposta = await app.request(
      `/api/pacientes/${id}/tcle`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'CF-Connecting-IP': ipUnico(),
          cookie: sessao.cookie,
        },
        body: JSON.stringify(VALIDO),
      },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await tclesNoBanco(id)).toEqual([]);
  });
});

describe('registrar TCLE (PAC-05)', () => {
  it('responde 201 com o registro e grava finalidade, data e versão', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    const resposta = await registrar(sessao, id, {
      finalidade: '  Atendimento psicológico ',
      data: '2026-10-01',
      versao: ' v1 ',
    });

    expect(resposta.status).toBe(201);
    expect(await resposta.json()).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      finalidade: 'Atendimento psicológico',
      data: '2026-10-01',
      versao: 'v1',
      registrado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await tclesNoBanco(id)).toEqual([
      {
        usuario_id: sessao.usuarioId,
        finalidade: 'Atendimento psicológico',
        data: '2026-10-01',
        versao_termo: 'v1',
      },
    ]);
  });

  it('aceita os limites: finalidade com 500, versão com 50, 29 de fevereiro bissexto', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    const resposta = await registrar(sessao, id, {
      finalidade: 'x'.repeat(500),
      data: '2024-02-29',
      versao: 'x'.repeat(50),
    });

    expect(resposta.status).toBe(201);
  });

  it('um novo registro não substitui o anterior: a lista traz os dois, o mais recente primeiro', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    await registrar(sessao, id, { ...VALIDO, data: '2026-01-10', versao: 'v1' });
    await registrar(sessao, id, { ...VALIDO, data: '2026-06-10', versao: 'v2' });

    const resposta = await pedir('GET', `/api/pacientes/${id}/tcle`, sessao);

    expect(resposta.status).toBe(200);
    const { items } = (await resposta.json()) as { items: { data: string; versao: string }[] };
    expect(items.map((t) => [t.data, t.versao])).toEqual([
      ['2026-06-10', 'v2'],
      ['2026-01-10', 'v1'],
    ]);
  });

  it('paciente sem TCLE: lista vazia', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    const resposta = await pedir('GET', `/api/pacientes/${id}/tcle`, sessao);

    expect(await resposta.json()).toEqual({ items: [] });
  });

  it.each([
    ['finalidade vazia', { ...VALIDO, finalidade: '  ' }, ['finalidade']],
    ['finalidade com 501', { ...VALIDO, finalidade: 'x'.repeat(501) }, ['finalidade']],
    ['versão vazia', { ...VALIDO, versao: '' }, ['versao']],
    ['versão com 51', { ...VALIDO, versao: 'x'.repeat(51) }, ['versao']],
    ['data inexistente', { ...VALIDO, data: '2026-02-30' }, ['data']],
    ['data fora do formato', { ...VALIDO, data: '01/10/2026' }, ['data']],
    ['sem data', { finalidade: 'x', versao: 'v1' }, ['data']],
    ['campo extra', { ...VALIDO, paciente_id: crypto.randomUUID() }, ['paciente_id']],
  ])('%s responde 422 validacao e nada é gravado', async (_caso, corpo, campos) => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    const resposta = await registrar(sessao, id, corpo);

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ status: 422, codigo: 'validacao', campos });
    expect(await tclesNoBanco(id)).toEqual([]);
  });
});

describe('sem edição nem exclusão (PAC-05)', () => {
  it('PUT, PATCH e DELETE do TCLE não existem: 404 e o registro fica igual', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    const { id: tcleId } = (await (await registrar(sessao, id, VALIDO)).json()) as { id: string };

    for (const metodo of ['PUT', 'PATCH', 'DELETE'] as const) {
      for (const caminho of [`/api/pacientes/${id}/tcle/${tcleId}`, `/api/pacientes/${id}/tcle`]) {
        const resposta = await pedir(
          metodo,
          caminho,
          sessao,
          metodo === 'DELETE' ? undefined : VALIDO,
        );
        expect(resposta.status, `${metodo} ${caminho}`).toBe(404);
      }
    }
    expect(await tclesNoBanco(id)).toEqual([
      expect.objectContaining({ finalidade: VALIDO.finalidade, versao_termo: 'v1' }),
    ]);
  });
});

describe('isolamento (ISO-02)', () => {
  it('B não registra nem lê TCLE de paciente de A: o mesmo 404 do inexistente', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const id = await semearPaciente(a.usuarioId);
    await registrar(a, id, VALIDO);

    for (const alvo of [id, crypto.randomUUID(), 'nao-e-uuid']) {
      for (const metodo of ['GET', 'POST'] as const) {
        const resposta = await pedir(
          metodo,
          `/api/pacientes/${alvo}/tcle`,
          b,
          metodo === 'POST' ? VALIDO : undefined,
        );
        expect(resposta.status, `${metodo} ${alvo}`).toBe(404);
        expect(resposta.headers.get('content-type')).toContain('application/problem+json');
        expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_NAO_ENCONTRADO);
      }
    }
    expect(await tclesNoBanco(id)).toEqual([expect.objectContaining({ usuario_id: a.usuarioId })]);
    expect(
      await comoAdmin('select 1 from consentimento_tcle where usuario_id = $1', [b.usuarioId]),
    ).toEqual([]);
  });
});
