import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import { PROBLEMA_JANELA_FECHADA } from '@es/contrato/anamnese';
import { type Evolucao, PROBLEMA_EVOLUCAO_NAO_ENCONTRADA } from '@es/contrato/clinico';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T102 / EVO-04, ISO-02: PUT /api/evolucoes/:id.
// - EVO-04: editável no dia do cadastro (até a meia-noite de America/Sao_Paulo, pelo relógio do
//   banco) com row_version obrigatório; divergência = 409 (versao_divergente, decisão do usuário
//   no lote 11). Depois da meia-noite: 409 EDIT_WINDOW_CLOSED, auditando
//   evolucao.edicao_recusada (como no legado e na anamnese), e o app oferece retificar.
// - Edge case da spec: duas abas editam a mesma evolução; a segunda gravação recebe 409.
// - ISO-02: evolução de outro profissional = 404 igual ao inexistente, sem alterar.
// O "relógio simulado" é o do banco: os testes recuam a criação da evolução.

const LENTO = { timeout: 30_000 };
const SENTINELA = 'SENTINELA-CLINICA';

const editar = (sessao: Sessao | null, id: string, corpo: Record<string, unknown>) =>
  pedir('PUT', `/api/evolucoes/${id}`, sessao, corpo);

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const linhaEvolucao = async (id: string) =>
  (
    await comoAdmin<{ texto: string; row_version: number }>(
      'select texto, row_version from evolucao where id = $1',
      [id],
    )
  )[0];

async function comEvolucao() {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId);
  const resposta = await pedir('POST', '/api/evolucoes', sessao, {
    paciente_id: pacienteId,
    texto: 'original',
  });
  expect(resposta.status).toBe(201);
  return { sessao, pacienteId, evolucao: (await resposta.json()) as Evolucao };
}

// Muda a criação da evolução no relógio do banco (sem o trigger da janela, que barra o próprio
// ajuste de uma evolução de outro dia). `expressao` é SQL fixo deste arquivo.
async function criadaEm(evolucaoId: string, expressao: string): Promise<void> {
  expect(evolucaoId).toMatch(/^[0-9a-f-]{36}$/);
  await comoAdmin(
    `begin; set local session_replication_role = replica;
     update evolucao set criado_em = ${expressao} where id = '${evolucaoId}'; commit;`,
  );
}
const MEIA_NOITE_HOJE = `((now() at time zone 'America/Sao_Paulo')::date::timestamp
  at time zone 'America/Sao_Paulo')`;

describe('exige sessão', LENTO, () => {
  it('sem sessão, PUT responde 401', async () => {
    const resposta = await editar(null, crypto.randomUUID(), {});
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('editar no dia (EVO-04)', LENTO, () => {
  it('no dia: 200, grava o texto, sobe a versão e audita sem o texto', async () => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await editar(sessao, evolucao.id, { texto: SENTINELA, row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      id: evolucao.id,
      texto: SENTINELA,
      row_version: 2,
      estado: 'editavel_hoje',
    });
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: SENTINELA, row_version: 2 });
    const eventos = await auditoriaDe(sessao.usuarioId, 'evolucao.editada_no_dia');
    expect(eventos).toEqual([
      expect.objectContaining({
        alvo_tipo: 'evolucao',
        alvo_id: evolucao.id,
        campos_alterados: ['texto'],
      }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('criada à meia-noite de hoje (Brasília): ainda é o dia, edição aceita', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await criadaEm(evolucao.id, MEIA_NOITE_HOJE);
    const resposta = await editar(sessao, evolucao.id, { texto: 'novo', row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'novo', row_version: 2 });
  });

  it('criada às 23:59:59 de ontem (Brasília): depois da meia-noite, 409 EDIT_WINDOW_CLOSED', async () => {
    const { sessao, pacienteId, evolucao } = await comEvolucao();
    await criadaEm(evolucao.id, `${MEIA_NOITE_HOJE} - interval '1 microsecond'`);
    const resposta = await editar(sessao, evolucao.id, { texto: SENTINELA, row_version: 1 });
    const problema = await esperarProblema(resposta, 409, PROBLEMA_JANELA_FECHADA);
    expect(JSON.stringify(problema)).not.toContain(SENTINELA);

    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
    expect(await auditoriaDe(sessao.usuarioId, 'evolucao.edicao_recusada')).toEqual([
      expect.objectContaining({
        alvo_tipo: 'evolucao',
        alvo_id: evolucao.id,
        campos_alterados: [],
      }),
    ]);
    expect(await auditoriaDe(sessao.usuarioId, 'evolucao.editada_no_dia')).toEqual([]);
    const lista = await (
      await pedir('GET', `/api/pacientes/${pacienteId}/evolucoes`, sessao)
    ).json();
    expect((lista as { items: Evolucao[] }).items[0]!.estado).toBe('registrada');
  });

  it('janela fechada vem antes do row_version (como na anamnese)', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await criadaEm(evolucao.id, `now() - interval '2 days'`);
    await esperarProblema(
      await editar(sessao, evolucao.id, { texto: 'x', row_version: 7 }),
      409,
      PROBLEMA_JANELA_FECHADA,
    );
  });

  it('row_version divergente: 409 versao_divergente sem gravar', async () => {
    const { sessao, evolucao } = await comEvolucao();
    await esperarProblema(
      await editar(sessao, evolucao.id, { texto: 'x', row_version: 2 }),
      409,
      PROBLEMA_VERSAO_DIVERGENTE,
    );
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
  });

  it('duas abas: a segunda gravação com a mesma versão recebe 409', async () => {
    const { sessao, evolucao } = await comEvolucao();
    expect((await editar(sessao, evolucao.id, { texto: 'aba 1', row_version: 1 })).status).toBe(
      200,
    );
    await esperarProblema(
      await editar(sessao, evolucao.id, { texto: 'aba 2', row_version: 1 }),
      409,
      PROBLEMA_VERSAO_DIVERGENTE,
    );
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'aba 1', row_version: 2 });
  });

  it('row_version ausente: 422 validacao (obrigatório)', async () => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await editar(sessao, evolucao.id, { texto: 'x' });
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['row_version'] });
  });

  it('texto vazio depois de aparar: 422 validacao sem gravar', async () => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await editar(sessao, evolucao.id, { texto: '  ', row_version: 1 });
    expect(resposta.status).toBe(422);
    expect(await linhaEvolucao(evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
  });

  it('sem mudança: 200 sem subir row_version nem auditar', async () => {
    const { sessao, evolucao } = await comEvolucao();
    const resposta = await editar(sessao, evolucao.id, { texto: 'original', row_version: 1 });
    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as Evolucao).row_version).toBe(1);
    expect(await auditoriaDe(sessao.usuarioId, 'evolucao.editada_no_dia')).toEqual([]);
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('evolução de outro profissional, inexistente ou id malformado: o mesmo 404', async () => {
    const outro = await comEvolucao();
    const sessao = await sessaoDeTeste();
    for (const id of [outro.evolucao.id, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await editar(sessao, id, { texto: SENTINELA, row_version: 1 }),
        404,
        PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
    expect(await linhaEvolucao(outro.evolucao.id)).toEqual({ texto: 'original', row_version: 1 });
  });
});
