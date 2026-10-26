import { PROBLEMA_FINANCEIRO_NAO_ENCONTRADO, PROBLEMA_VERSAO_PRECO } from '@es/contrato/financeiro';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';
import { semearSessao } from './sessoes-apoio.ts';

// T110 / FIN-01, FIN-02, FIN-08, ISO-02: preço por paciente e ajuste por sessão.
// - PUT /api/pacientes/:id/preco e /api/sessoes/:id/preco: valor em centavos inteiros; cria sem
//   row_version e edita com o row_version lido. Criar com versão, editar sem versão ou com versão
//   divergente = 409 versao_divergente, sem gravar (decisão do usuário de 2026-10-26).
// - Cada mudança gera revisão antes/depois e audita preco_paciente.definido (alvo paciente) ou
//   preco_sessao.ajustado (alvo agendamento) só quando a versão muda, só com o nome do campo.
// - GET devolve o preço; sem preço, 404 (como o legado).
// - Paciente ou sessão de outro profissional: 404 idêntico ao inexistente, nada muda.

const LENTO = { timeout: 30_000 };

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

interface Escopo {
  nome: 'paciente' | 'sessao';
  caminho: (id: string) => string;
  tabela: 'preco_paciente' | 'preco_sessao';
  chave: 'paciente_id' | 'sessao_id';
  acao: string;
  alvo: string;
  // Cria o dono do preço (paciente ou sessão) do profissional.
  dono: (usuarioId: string) => Promise<string>;
}

const ESCOPOS: Escopo[] = [
  {
    nome: 'paciente',
    caminho: (id) => `/api/pacientes/${id}/preco`,
    tabela: 'preco_paciente',
    chave: 'paciente_id',
    acao: 'preco_paciente.definido',
    alvo: 'paciente',
    dono: (usuarioId) => semearPaciente(usuarioId),
  },
  {
    nome: 'sessao',
    caminho: (id) => `/api/sessoes/${id}/preco`,
    tabela: 'preco_sessao',
    chave: 'sessao_id',
    acao: 'preco_sessao.ajustado',
    alvo: 'agendamento',
    dono: async (usuarioId) =>
      semearSessao(usuarioId, await semearPaciente(usuarioId), {
        inicio: '2026-10-20T13:00:00Z',
        fim: '2026-10-20T13:50:00Z',
      }),
  },
];

describe.each(ESCOPOS)('preço por $nome', (escopo) => {
  const definir = (sessao: Sessao | null, id: string, corpo: unknown) =>
    pedir('PUT', escopo.caminho(id), sessao, corpo);
  const precoNoBanco = async (id: string) =>
    comoAdmin<{ valor_centavos: string; row_version: number }>(
      `select valor_centavos, row_version from ${escopo.tabela} where ${escopo.chave} = $1`,
      [id],
    );
  const revisoes = (id: string) =>
    comoAdmin<{ antes: { valor_centavos: number }; depois: { valor_centavos: number } }>(
      `select r.antes, r.depois from ${escopo.tabela}_revisao r
       join ${escopo.tabela} p on p.id = r.${escopo.tabela}_id
       where p.${escopo.chave} = $1 order by r.id`,
      [id],
    );

  async function comPreco(valor = 15000) {
    const sessao = await sessaoDeTeste();
    const id = await escopo.dono(sessao.usuarioId);
    const resposta = await definir(sessao, id, { valor });
    expect(resposta.status).toBe(200);
    return { sessao, id };
  }

  describe('exige sessão e CSRF', LENTO, () => {
    it('sem sessão, PUT e GET respondem 401', async () => {
      const id = crypto.randomUUID();
      const put = await definir(null, id, { valor: 1 });
      expect(put.status).toBe(401);
      expect(await put.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
      expect((await pedir('GET', escopo.caminho(id), null)).status).toBe(401);
    });

    it('PUT sem x-csrf-token responde 403 e nada é gravado', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      const resposta = await pedir(
        'PUT',
        escopo.caminho(id),
        { ...sessao, csrf: 'x' },
        {
          valor: 100,
        },
      );
      expect(resposta.status).toBe(403);
      expect(await precoNoBanco(id)).toEqual([]);
    });
  });

  describe('criar (FIN-01, FIN-02, FIN-08)', LENTO, () => {
    it('sem row_version cria com versão 1, em centavos, e audita só o nome do campo', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      const resposta = await definir(sessao, id, { valor: 15050 });
      expect(resposta.status).toBe(200);
      const corpo = (await resposta.json()) as Record<string, unknown>;
      expect(corpo).toEqual({
        [escopo.chave]: id,
        valor: 15050,
        row_version: 1,
        criado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      expect(await precoNoBanco(id)).toEqual([{ valor_centavos: '15050', row_version: 1 }]);
      const auditoria = await auditoriaDe(sessao.usuarioId, escopo.acao);
      expect(auditoria).toHaveLength(1);
      expect(auditoria[0]).toMatchObject({
        ator: sessao.usuarioId,
        alvo_tipo: escopo.alvo,
        alvo_id: id,
        campos_alterados: ['valor'],
      });
    });

    it('aceita 0 e 9.999.999.999 centavos', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      expect((await definir(sessao, id, { valor: 0 })).status).toBe(200);
      const outro = await escopo.dono(sessao.usuarioId);
      const resposta = await definir(sessao, outro, { valor: 9_999_999_999 });
      expect(resposta.status).toBe(200);
      expect(((await resposta.json()) as { valor: number }).valor).toBe(9_999_999_999);
    });

    it('com row_version informado responde 409 versao_divergente e nada é criado', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      await esperarProblema(
        await definir(sessao, id, { valor: 100, row_version: 1 }),
        409,
        PROBLEMA_VERSAO_PRECO,
      );
      expect(await precoNoBanco(id)).toEqual([]);
      expect(await auditoriaDe(sessao.usuarioId, escopo.acao)).toEqual([]);
    });

    it('decimal, negativo ou acima do máximo respondem 422 validacao sem gravar', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      for (const valor of [150.5, -1, 10_000_000_000, '15000']) {
        const resposta = await definir(sessao, id, { valor });
        expect(resposta.status, String(valor)).toBe(422);
        expect((await resposta.json()) as { codigo: string; campos: string[] }).toMatchObject({
          codigo: 'validacao',
          campos: ['valor'],
        });
      }
      expect(await precoNoBanco(id)).toEqual([]);
    });
  });

  describe('editar (FIN-02, FIN-08)', LENTO, () => {
    it('com o row_version lido muda o valor, sobe a versão, grava revisão e audita', async () => {
      const { sessao, id } = await comPreco(15000);
      const resposta = await definir(sessao, id, { valor: 18000, row_version: 1 });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ valor: 18000, row_version: 2 });
      expect(await precoNoBanco(id)).toEqual([{ valor_centavos: '18000', row_version: 2 }]);
      const lista = await revisoes(id);
      expect(lista).toHaveLength(1);
      expect(lista[0]!.antes.valor_centavos).toBe(15000);
      expect(lista[0]!.depois.valor_centavos).toBe(18000);
      expect(await auditoriaDe(sessao.usuarioId, escopo.acao)).toHaveLength(2);
    });

    it('sem row_version responde 409 versao_divergente sem gravar nem auditar', async () => {
      const { sessao, id } = await comPreco(15000);
      await esperarProblema(
        await definir(sessao, id, { valor: 18000 }),
        409,
        PROBLEMA_VERSAO_PRECO,
      );
      expect(await precoNoBanco(id)).toEqual([{ valor_centavos: '15000', row_version: 1 }]);
      expect(await auditoriaDe(sessao.usuarioId, escopo.acao)).toHaveLength(1);
    });

    it('com row_version divergente responde 409 sem gravar nem auditar', async () => {
      const { sessao, id } = await comPreco(15000);
      await esperarProblema(
        await definir(sessao, id, { valor: 18000, row_version: 7 }),
        409,
        PROBLEMA_VERSAO_PRECO,
      );
      expect(await precoNoBanco(id)).toEqual([{ valor_centavos: '15000', row_version: 1 }]);
      expect(await revisoes(id)).toEqual([]);
      expect(await auditoriaDe(sessao.usuarioId, escopo.acao)).toHaveLength(1);
    });

    it('o mesmo valor responde 200 sem subir a versão, sem revisão e sem auditar', async () => {
      const { sessao, id } = await comPreco(15000);
      const resposta = await definir(sessao, id, { valor: 15000, row_version: 1 });
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ valor: 15000, row_version: 1 });
      expect(await revisoes(id)).toEqual([]);
      expect(await auditoriaDe(sessao.usuarioId, escopo.acao)).toHaveLength(1);
    });
  });

  describe('ler', LENTO, () => {
    it('GET devolve o preço vigente', async () => {
      const { sessao, id } = await comPreco(12345);
      const resposta = await pedir('GET', escopo.caminho(id), sessao);
      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({
        [escopo.chave]: id,
        valor: 12345,
        row_version: 1,
      });
    });

    it('sem preço definido, GET responde 404 nao_encontrado', async () => {
      const sessao = await sessaoDeTeste();
      const id = await escopo.dono(sessao.usuarioId);
      await esperarProblema(
        await pedir('GET', escopo.caminho(id), sessao),
        404,
        PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
      );
    });
  });

  describe('isolamento (ISO-02)', LENTO, () => {
    it('de outro profissional: o mesmo 404 do inexistente e do id malformado; nada muda', async () => {
      const { id } = await comPreco(15000);
      const intrusa = await sessaoDeTeste();
      for (const alvo of [id, crypto.randomUUID(), 'nao-e-uuid']) {
        await esperarProblema(
          await definir(intrusa, alvo, { valor: 1 }),
          404,
          PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
        );
        await esperarProblema(
          await definir(intrusa, alvo, { valor: 1, row_version: 1 }),
          404,
          PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
        );
        await esperarProblema(
          await pedir('GET', escopo.caminho(alvo), intrusa),
          404,
          PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
        );
      }
      expect(await precoNoBanco(id)).toEqual([{ valor_centavos: '15000', row_version: 1 }]);
      expect(await auditoriaDe(intrusa.usuarioId, escopo.acao)).toEqual([]);
    });

    it('de outro profissional sem preço: 404 e nada é criado', async () => {
      const dona = await sessaoDeTeste();
      const id = await escopo.dono(dona.usuarioId);
      const intrusa = await sessaoDeTeste();
      await esperarProblema(
        await definir(intrusa, id, { valor: 1 }),
        404,
        PROBLEMA_FINANCEIRO_NAO_ENCONTRADO,
      );
      expect(await precoNoBanco(id)).toEqual([]);
    });
  });
});

describe('sem rota de exclusão (FIN-08)', LENTO, () => {
  it('DELETE do preço não existe', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    expect((await pedir('DELETE', `/api/pacientes/${id}/preco`, sessao)).status).toBe(404);
  });
});
