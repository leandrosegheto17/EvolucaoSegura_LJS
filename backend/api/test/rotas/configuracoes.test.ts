import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';

// T63 / PERF-08, PERF-09, ISO-02: GET e PUT /api/configuracoes. privacidade_agenda nasce falsa
// (comportamento do legado: falso = agenda com o nome completo, verdadeiro = iniciais), sem opção
// de inatividade. A alteração audita configuracao.alterada só com o nome do campo; sem mudança,
// nada é gravado nem auditado. Outro profissional não vê nem altera a configuração. Casos do
// T-068 do legado (backend/test/settings.spec.ts) vêm junto, sem IA e sem inatividade.

type Sessao = Awaited<ReturnType<typeof sessaoDeTeste>>;

const app = criarApp({ capturarErro: () => {} });

function pedir(metodo: 'GET' | 'PUT', sessao: Sessao | null, corpo?: unknown) {
  return app.request(
    '/api/configuracoes',
    {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    },
    env,
  );
}

const ler = async (sessao: Sessao) => (await pedir('GET', sessao)).json();

const linhas = (usuarioId: string) =>
  comoAdmin<{ id: string; privacidade_agenda: boolean; row_version: number }>(
    'select id, privacidade_agenda, row_version from configuracao_usuario where usuario_id = $1',
    [usuarioId],
  );

const auditoria = (usuarioId: string) =>
  comoAdmin<{
    ator: string;
    alvo_tipo: string;
    alvo_id: string;
    campos_alterados: string[];
  }>(
    `select ator, alvo_tipo, alvo_id, campos_alterados from audit_log
     where usuario_id = $1 and acao = 'configuracao.alterada' order by id`,
    [usuarioId],
  );

describe('GET e PUT /api/configuracoes exigem sessão', () => {
  it('sem sessão responde 401 nas duas', async () => {
    for (const resposta of [
      await pedir('GET', null),
      await pedir('PUT', null, { privacidade_agenda: true }),
    ]) {
      expect(resposta.status).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });
});

describe('privacidade da agenda (PERF-08)', () => {
  it('padrão: privacidade_agenda falsa, sem opção de inatividade', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await pedir('GET', sessao);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ privacidade_agenda: false });
  });

  it('PUT liga e desliga; o GET devolve o valor salvo', async () => {
    const sessao = await sessaoDeTeste();

    const ligada = await pedir('PUT', sessao, { privacidade_agenda: true });
    expect(ligada.status).toBe(200);
    expect(await ligada.json()).toEqual({ privacidade_agenda: true });
    expect(await ler(sessao)).toEqual({ privacidade_agenda: true });

    await pedir('PUT', sessao, { privacidade_agenda: false });
    expect(await ler(sessao)).toEqual({ privacidade_agenda: false });
    expect(await linhas(sessao.usuarioId)).toMatchObject([{ privacidade_agenda: false }]);
  });

  it.each([
    ['inatividade', { privacidade_agenda: true, inatividade_min: 5 }, ['inatividade_min']],
    ['IA', { privacidade_agenda: true, ia_habilitada: true }, ['ia_habilitada']],
    [
      'usuario_id no corpo',
      { privacidade_agenda: true, usuario_id: crypto.randomUUID() },
      ['usuario_id'],
    ],
    ['corpo vazio', {}, ['privacidade_agenda']],
    ['tipo errado', { privacidade_agenda: 1 }, ['privacidade_agenda']],
  ])('%s responde 422 validacao e nada é gravado', async (_caso, corpo, campos) => {
    const sessao = await sessaoDeTeste();

    const resposta = await pedir('PUT', sessao, corpo);

    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos });
    expect(await linhas(sessao.usuarioId)).toEqual([]);
    expect(await auditoria(sessao.usuarioId)).toEqual([]);
  });
});

describe('auditoria configuracao.alterada (PERF-09)', () => {
  it('a mudança audita só o nome do campo, com a configuração como alvo', async () => {
    const sessao = await sessaoDeTeste();

    await pedir('PUT', sessao, { privacidade_agenda: true });
    await pedir('PUT', sessao, { privacidade_agenda: false });

    const [linha] = await linhas(sessao.usuarioId);
    const campo = {
      ator: sessao.usuarioId,
      alvo_tipo: 'configuracao',
      alvo_id: linha!.id,
      campos_alterados: ['privacidade_agenda'],
    };
    expect(await auditoria(sessao.usuarioId)).toEqual([campo, campo]);
    expect(linha!.row_version).toBe(2);
  });

  it('sem mudança, nada é gravado nem auditado', async () => {
    const sessao = await sessaoDeTeste();
    await pedir('PUT', sessao, { privacidade_agenda: true });

    const resposta = await pedir('PUT', sessao, { privacidade_agenda: true });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ privacidade_agenda: true });
    expect(await linhas(sessao.usuarioId)).toMatchObject([{ row_version: 1 }]);
    expect(await auditoria(sessao.usuarioId)).toHaveLength(1);
  });

  it('o primeiro PUT igual ao padrão não cria a linha nem audita', async () => {
    const sessao = await sessaoDeTeste();

    const resposta = await pedir('PUT', sessao, { privacidade_agenda: false });

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ privacidade_agenda: false });
    expect(await linhas(sessao.usuarioId)).toEqual([]);
    expect(await auditoria(sessao.usuarioId)).toEqual([]);
  });
});

describe('isolamento (ISO-02)', () => {
  it('B não vê nem altera a configuração de A', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    await pedir('PUT', a, { privacidade_agenda: true });

    expect(await ler(b)).toEqual({ privacidade_agenda: false });
    await pedir('PUT', b, { privacidade_agenda: true });
    await pedir('PUT', b, { privacidade_agenda: false });

    expect(await ler(a)).toEqual({ privacidade_agenda: true });
    expect(await linhas(a.usuarioId)).toMatchObject([{ privacidade_agenda: true, row_version: 1 }]);
    expect(await auditoria(a.usuarioId)).toHaveLength(1);
    expect(await auditoria(b.usuarioId)).toHaveLength(2);
  });
});
