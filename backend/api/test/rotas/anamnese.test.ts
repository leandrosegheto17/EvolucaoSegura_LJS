import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import {
  type Anamnese,
  type ModeloAnamnese,
  PROBLEMA_ANAMNESE_EXISTENTE,
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_JANELA_FECHADA,
  PROBLEMA_VALOR_INVALIDO,
} from '@es/contrato/anamnese';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { PROBLEMA_ESPECIALIDADE_COM_ANAMNESE } from '@es/contrato/perfil';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T95 / ANA-04, ANA-05, ANA-09, ISO-02: GET e POST /api/pacientes/:id/anamnese e PUT
// /api/anamneses/:id.
// - ANA-04: uma anamnese por paciente (a segunda = 409 ANAMNESIS_EXISTS); texto de campo até
//   5.000 e observação de alerta até 500; id de item desconhecido ou de revisão futura recusado
//   (422 ANAMNESIS_VALUE_INVALID, sem ecoar o conteúdo).
// - ANA-05: editável até a meia-noite de America/Sao_Paulo do dia do cadastro, pelo relógio do
//   banco; depois, 409 EDIT_WINDOW_CLOSED, auditando anamnese.edicao_recusada.
// - ISO-02: paciente ou anamnese de outro profissional = 404 igual ao inexistente, sem alterar.
// Decisões do usuário (2026-10-26): códigos do legado, row_version obrigatório na edição (409
// versao_divergente), paciente sem anamnese = 200 {anamnese: null}, paciente inativo pode ter
// anamnese, auditoria só com contagens.
// O "relógio simulado" é o do banco: os testes recuam a criação da anamnese (como os da sessão).

const SENTINELA = 'SENTINELA-CLINICA';

async function profissional(): Promise<{ sessao: Sessao; modelo: ModeloAnamnese }> {
  const sessao = await sessaoDeTeste();
  expect(
    (
      await pedir('PUT', '/api/perfil', sessao, {
        nome: 'Dra. Ana',
        especialidade: { tipo: 'psicologia', nome: null },
      })
    ).status,
  ).toBe(200);
  const modelo = (await (
    await pedir('GET', '/api/modelo-anamnese', sessao)
  ).json()) as ModeloAnamnese;
  return { sessao, modelo };
}

const registrar = (sessao: Sessao, pacienteId: string, corpo: Record<string, unknown> = {}) =>
  pedir('POST', `/api/pacientes/${pacienteId}/anamnese`, sessao, {
    data_sessao: '2026-10-26',
    modelo_revisao: 1,
    valores: {},
    ...corpo,
  });
const editar = (sessao: Sessao, id: string, corpo: Record<string, unknown>) =>
  pedir('PUT', `/api/anamneses/${id}`, sessao, corpo);
const ler = async (sessao: Sessao, pacienteId: string) => {
  const resposta = await pedir('GET', `/api/pacientes/${pacienteId}/anamnese`, sessao);
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as { anamnese: Anamnese | null }).anamnese;
};

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const linhasAnamnese = (usuarioId: string) =>
  comoAdmin<{ id: string; valores: unknown; modelo_revisao: number; row_version: number }>(
    'select id, valores, modelo_revisao, row_version from anamnese where usuario_id = $1 order by id',
    [usuarioId],
  );

// Muda a criação da anamnese no relógio do banco (sem o trigger da janela, que barra o próprio
// ajuste de uma anamnese de outro dia). `expressao` é SQL fixo deste arquivo.
async function criadaEm(anamneseId: string, expressao: string): Promise<void> {
  expect(anamneseId).toMatch(/^[0-9a-f-]{36}$/);
  await comoAdmin(
    `begin; set local session_replication_role = replica;
     update anamnese set criado_em = ${expressao} where id = '${anamneseId}'; commit;`,
  );
}
const MEIA_NOITE_HOJE = `((now() at time zone 'America/Sao_Paulo')::date::timestamp
  at time zone 'America/Sao_Paulo')`;

describe('exige sessão', () => {
  it('sem sessão, GET, POST e PUT respondem 401', async () => {
    const id = crypto.randomUUID();
    for (const [metodo, caminho] of [
      ['GET', `/api/pacientes/${id}/anamnese`],
      ['POST', `/api/pacientes/${id}/anamnese`],
      ['PUT', `/api/anamneses/${id}`],
    ] as const) {
      const resposta = await pedir(metodo, caminho, null, metodo === 'GET' ? undefined : {});
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });
});

describe('registrar (ANA-04)', () => {
  it('201 com a anamnese: valores aparados, editável hoje até a meia-noite de Brasília', async () => {
    const { sessao, modelo } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const [queixa] = modelo.campos;
    const [suicidio, automutilacao] = modelo.alertas;
    const resposta = await registrar(sessao, pacienteId, {
      valores: {
        [queixa!.id]: `  ${SENTINELA}  `,
        [suicidio!.id]: { marcado: true, obs: ' acompanhar ' },
        [automutilacao!.id]: { marcado: false, obs: null },
      },
    });
    expect(resposta.status).toBe(201);
    const anamnese = (await resposta.json()) as Anamnese;
    const [limite] = await comoAdmin<{ ate: string }>(
      `select to_char((((now() at time zone 'America/Sao_Paulo')::date + 1)::timestamp
         at time zone 'America/Sao_Paulo') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ate`,
    );
    expect(anamnese).toMatchObject({
      paciente_id: pacienteId,
      data_sessao: '2026-10-26',
      modelo_revisao: 1,
      valores: { [queixa!.id]: SENTINELA, [suicidio!.id]: { marcado: true, obs: 'acompanhar' } },
      estado: 'editavel_hoje',
      editavel_ate: limite!.ate,
      row_version: 1,
      versao_vigente: 0,
      retificacoes: [],
      alerta_clinico: true,
      alertas: [{ item_id: suicidio!.id, rotulo: 'Risco de suicídio' }],
    });
    expect(await ler(sessao, pacienteId)).toEqual(anamnese);

    const eventos = await auditoriaDe(sessao.usuarioId, 'anamnese.criada');
    expect(eventos).toEqual([
      expect.objectContaining({
        alvo_tipo: 'anamnese',
        alvo_id: anamnese.id,
        campos_alterados: [],
      }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('paciente sem anamnese: 200 {anamnese: null}', async () => {
    const { sessao } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    expect(await ler(sessao, pacienteId)).toBeNull();
  });

  it('sem alerta marcado: alerta_clinico falso', async () => {
    const { sessao } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const anamnese = (await (await registrar(sessao, pacienteId)).json()) as Anamnese;
    expect([anamnese.alerta_clinico, anamnese.alertas]).toEqual([false, []]);
  });

  it('segunda anamnese do paciente: 409 ANAMNESIS_EXISTS e nada é criado', async () => {
    const { sessao } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    expect((await registrar(sessao, pacienteId)).status).toBe(201);
    await esperarProblema(await registrar(sessao, pacienteId), 409, PROBLEMA_ANAMNESE_EXISTENTE);
    expect(await linhasAnamnese(sessao.usuarioId)).toHaveLength(1);
  });

  it('paciente inativo pode ter anamnese', async () => {
    const { sessao } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId, { ativo: false });
    expect((await registrar(sessao, pacienteId)).status).toBe(201);
  });

  it('texto de 5.000 e observação de 500 no limite são aceitos', async () => {
    const { sessao, modelo } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const resposta = await registrar(sessao, pacienteId, {
      valores: {
        [modelo.campos[0]!.id]: 'x'.repeat(5000),
        [modelo.alertas[0]!.id]: { marcado: true, obs: 'o'.repeat(500) },
      },
    });
    expect(resposta.status).toBe(201);
  });

  it.each([
    [
      'texto de 5.001',
      (m: ModeloAnamnese) => ({ valores: { [m.campos[0]!.id]: SENTINELA.repeat(295) } }),
    ],
    [
      'observação de 501',
      (m: ModeloAnamnese) => ({
        valores: { [m.alertas[0]!.id]: { marcado: true, obs: `${SENTINELA}${'o'.repeat(484)}` } },
      }),
    ],
    ['id de item desconhecido', () => ({ valores: { [crypto.randomUUID()]: SENTINELA } })],
    [
      '"Frequência" fora das opções',
      (m: ModeloAnamnese) => ({ valores: { [m.campos[3]!.id]: SENTINELA } }),
    ],
    ['revisão do modelo que não existe', () => ({ modelo_revisao: 2 })],
  ])('%s: 422 ANAMNESIS_VALUE_INVALID sem ecoar e nada é criado', async (_rotulo, corpo) => {
    const { sessao, modelo } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const resposta = await registrar(sessao, pacienteId, corpo(modelo));
    const problema = await esperarProblema(resposta, 422, PROBLEMA_VALOR_INVALIDO);
    expect(JSON.stringify(problema)).not.toContain(SENTINELA);
    expect(await linhasAnamnese(sessao.usuarioId)).toEqual([]);
  });

  it('item de revisão futura (incluído depois da revisão pedida) é recusado', async () => {
    const { sessao, modelo } = await profissional();
    const gravado = await pedir('PUT', '/api/modelo-anamnese', sessao, {
      campos: [...modelo.campos, { rotulo: 'Sono' }],
      alertas: modelo.alertas,
      row_version: modelo.row_version,
    });
    const novo = (await gravado.json()) as ModeloAnamnese;
    const sono = novo.campos.at(-1)!;
    const pacienteId = await semearPaciente(sessao.usuarioId);
    await esperarProblema(
      await registrar(sessao, pacienteId, { modelo_revisao: 1, valores: { [sono.id]: 'ruim' } }),
      422,
      PROBLEMA_VALOR_INVALIDO,
    );
    expect(
      (await registrar(sessao, pacienteId, { modelo_revisao: 2, valores: { [sono.id]: 'ruim' } }))
        .status,
    ).toBe(201);
  });

  it('com a anamnese registrada pela rota, a troca de especialidade é recusada (PERF-05)', async () => {
    const { sessao } = await profissional();
    await registrar(sessao, await semearPaciente(sessao.usuarioId));
    const resposta = await pedir('PUT', '/api/perfil', sessao, {
      nome: 'Dra. Ana',
      especialidade: { tipo: 'nutricao', nome: null },
    });
    await esperarProblema(resposta, 409, PROBLEMA_ESPECIALIDADE_COM_ANAMNESE);
  });
});

describe('isolamento (ISO-02)', () => {
  it('paciente de outro profissional, inexistente ou id malformado: o mesmo 404', async () => {
    const outro = await profissional();
    const pacienteDoOutro = await semearPaciente(outro.sessao.usuarioId);
    const { sessao } = await profissional();
    for (const id of [pacienteDoOutro, crypto.randomUUID(), 'nao-e-uuid']) {
      await esperarProblema(
        await pedir('GET', `/api/pacientes/${id}/anamnese`, sessao),
        404,
        PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
      );
      await esperarProblema(await registrar(sessao, id), 404, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
    }
    expect(await linhasAnamnese(outro.sessao.usuarioId)).toEqual([]);
    expect(await linhasAnamnese(sessao.usuarioId)).toEqual([]);
  });

  it('anamnese de outro profissional não é editada: 404 e nada muda', async () => {
    const outro = await profissional();
    const pacienteDoOutro = await semearPaciente(outro.sessao.usuarioId);
    const anamnese = (await (await registrar(outro.sessao, pacienteDoOutro)).json()) as Anamnese;
    const { sessao } = await profissional();
    for (const id of [anamnese.id, crypto.randomUUID(), 'nao-e-uuid'])
      await esperarProblema(
        await editar(sessao, id, { modelo_revisao: 1, valores: {}, row_version: 1 }),
        404,
        PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
      );
    expect(await linhasAnamnese(outro.sessao.usuarioId)).toEqual([
      expect.objectContaining({ id: anamnese.id, valores: {}, row_version: 1 }),
    ]);
  });
});

describe('editar no dia (ANA-05)', () => {
  async function comAnamnese() {
    const { sessao, modelo } = await profissional();
    const pacienteId = await semearPaciente(sessao.usuarioId);
    const anamnese = (await (
      await registrar(sessao, pacienteId, { valores: { [modelo.campos[0]!.id]: 'dor' } })
    ).json()) as Anamnese;
    return { sessao, modelo, pacienteId, anamnese };
  }

  it('no dia: 200, grava a nova versão e audita só a contagem de itens', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    const resposta = await editar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: { [modelo.campos[0]!.id]: SENTINELA, [modelo.campos[2]!.id]: 'TCC' },
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    const nova = (await resposta.json()) as Anamnese;
    expect(nova).toMatchObject({
      valores: { [modelo.campos[0]!.id]: SENTINELA, [modelo.campos[2]!.id]: 'TCC' },
      row_version: 2,
      estado: 'editavel_hoje',
    });
    const eventos = await auditoriaDe(sessao.usuarioId, 'anamnese.editada_no_dia');
    expect(eventos).toEqual([
      expect.objectContaining({ alvo_id: anamnese.id, campos_alterados: ['campos_2'] }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('criada à meia-noite de hoje (Brasília): ainda é o dia, edição aceita', async () => {
    const { sessao, anamnese } = await comAnamnese();
    await criadaEm(anamnese.id, MEIA_NOITE_HOJE);
    const resposta = await editar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: {},
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as Anamnese).valores).toEqual({});
  });

  it('criada às 23:59:59 de ontem (Brasília): passou da meia-noite, 409 EDIT_WINDOW_CLOSED', async () => {
    const { sessao, pacienteId, anamnese } = await comAnamnese();
    await criadaEm(anamnese.id, `${MEIA_NOITE_HOJE} - interval '1 microsecond'`);
    const resposta = await editar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: {},
      row_version: 1,
    });
    await esperarProblema(resposta, 409, PROBLEMA_JANELA_FECHADA);

    const [linha] = await linhasAnamnese(sessao.usuarioId);
    expect(linha).toMatchObject({ row_version: 1, valores: anamnese.valores });
    expect(await auditoriaDe(sessao.usuarioId, 'anamnese.edicao_recusada')).toEqual([
      expect.objectContaining({
        alvo_tipo: 'anamnese',
        alvo_id: anamnese.id,
        campos_alterados: [],
      }),
    ]);
    expect(await auditoriaDe(sessao.usuarioId, 'anamnese.editada_no_dia')).toEqual([]);
    expect((await ler(sessao, pacienteId))!.estado).toBe('registrada');
  });

  it('row_version diferente: 409 versao_divergente sem gravar', async () => {
    const { sessao, anamnese } = await comAnamnese();
    await esperarProblema(
      await editar(sessao, anamnese.id, { modelo_revisao: 1, valores: {}, row_version: 2 }),
      409,
      PROBLEMA_VERSAO_DIVERGENTE,
    );
    expect((await linhasAnamnese(sessao.usuarioId))[0]).toMatchObject({ row_version: 1 });
  });

  it('valores inválidos na edição: 422 ANAMNESIS_VALUE_INVALID sem gravar', async () => {
    const { sessao, modelo, anamnese } = await comAnamnese();
    await esperarProblema(
      await editar(sessao, anamnese.id, {
        modelo_revisao: 1,
        valores: { [modelo.campos[0]!.id]: 'x'.repeat(5001) },
        row_version: 1,
      }),
      422,
      PROBLEMA_VALOR_INVALIDO,
    );
    expect((await linhasAnamnese(sessao.usuarioId))[0]).toMatchObject({ row_version: 1 });
  });

  it('sem mudança: 200 sem subir row_version nem auditar', async () => {
    const { sessao, anamnese } = await comAnamnese();
    const resposta = await editar(sessao, anamnese.id, {
      modelo_revisao: 1,
      valores: anamnese.valores,
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as Anamnese).row_version).toBe(1);
    expect(await auditoriaDe(sessao.usuarioId, 'anamnese.editada_no_dia')).toEqual([]);
  });
});
