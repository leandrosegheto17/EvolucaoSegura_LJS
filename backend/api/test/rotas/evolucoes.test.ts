import { PROBLEMA_CONSULTA_INVALIDA } from '@es/contrato/pacientes';
import {
  type Evolucao,
  type PaginaEvolucoes,
  PROBLEMA_EVOLUCAO_EXISTENTE,
  PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
} from '@es/contrato/clinico';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';
import { linhaSessao, semearSessao } from './sessoes-apoio.ts';

// T101 / EVO-01, EVO-02, EVO-03, ISO-02: POST /api/evolucoes e GET /api/pacientes/:id/evolucoes.
// - EVO-01: texto não vazio depois de aparar, até 100.000; sessao_id opcional.
// - EVO-02: segunda evolução da mesma sessão = 409 EVOLUTION_EXISTS.
// - EVO-03: evolução de sessão `agendada` muda a sessão para `realizada` na mesma transação.
// - ISO-02: paciente ou sessão de outro profissional = 404 igual ao inexistente, sem criar nada.
// Decisões do usuário (2026-10-26): listagem paginada (limit até 100); sessão em outro status
// (realizada, faltou, cancelada, remarcada) aceita a evolução e não muda; paciente inativo pode
// ter evolução; sessão de outro paciente = 404; auditoria só com ids, nunca o texto.

// Cada caso cria o profissional pela API e semeia paciente e sessão; com a máquina carregada
// passa dos 5 s padrão (mesmo padrão LENTO dos testes da anamnese).
const LENTO = { timeout: 30_000 };
const SENTINELA = 'SENTINELA-CLINICA';
const INICIO = '2026-10-20T13:00:00.000Z';
const FIM = '2026-10-20T13:50:00.000Z';

const registrar = (sessao: Sessao, corpo: Record<string, unknown>) =>
  pedir('POST', '/api/evolucoes', sessao, corpo);

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

const evolucoesDe = (usuarioId: string) =>
  comoAdmin<{ id: string; paciente_id: string; sessao_id: string | null; texto: string }>(
    'select id, paciente_id, sessao_id, texto from evolucao where usuario_id = $1 order by criado_em, id',
    [usuarioId],
  );

async function comPaciente(dados: { ativo?: boolean } = {}) {
  const sessao = await sessaoDeTeste();
  const pacienteId = await semearPaciente(sessao.usuarioId, dados);
  return { sessao, pacienteId };
}

describe('exige sessão', LENTO, () => {
  it('sem sessão, POST e GET respondem 401', async () => {
    const id = crypto.randomUUID();
    for (const [metodo, caminho] of [
      ['POST', '/api/evolucoes'],
      ['GET', `/api/pacientes/${id}/evolucoes`],
    ] as const) {
      const resposta = await pedir(metodo, caminho, null, metodo === 'GET' ? undefined : {});
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });
});

describe('registrar (EVO-01)', LENTO, () => {
  it('evolução sem sessão: 201, texto como veio, editável hoje até a meia-noite de Brasília', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const texto = `  ${SENTINELA}\nsegunda linha `;
    const resposta = await registrar(sessao, { paciente_id: pacienteId, texto });
    expect(resposta.status).toBe(201);
    const evolucao = (await resposta.json()) as Evolucao;
    const [limite] = await comoAdmin<{ ate: string }>(
      `select to_char((((now() at time zone 'America/Sao_Paulo')::date + 1)::timestamp
         at time zone 'America/Sao_Paulo') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as ate`,
    );
    expect(evolucao).toMatchObject({
      paciente_id: pacienteId,
      sessao_id: null,
      texto,
      estado: 'editavel_hoje',
      editavel_ate: limite!.ate,
      row_version: 1,
      versao_vigente: 0,
      retificacoes: [],
    });
    expect(await evolucoesDe(sessao.usuarioId)).toEqual([
      { id: evolucao.id, paciente_id: pacienteId, sessao_id: null, texto },
    ]);
  });

  it('várias evoluções sem sessão do mesmo paciente convivem', async () => {
    const { sessao, pacienteId } = await comPaciente();
    expect((await registrar(sessao, { paciente_id: pacienteId, texto: 'a' })).status).toBe(201);
    expect((await registrar(sessao, { paciente_id: pacienteId, texto: 'b' })).status).toBe(201);
    expect(await evolucoesDe(sessao.usuarioId)).toHaveLength(2);
  });

  it('audita evolucao.criada só com o id, nunca o texto', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const evolucao = (await (
      await registrar(sessao, { paciente_id: pacienteId, texto: SENTINELA })
    ).json()) as Evolucao;
    const eventos = await auditoriaDe(sessao.usuarioId, 'evolucao.criada');
    expect(eventos).toEqual([
      expect.objectContaining({ alvo_tipo: 'evolucao', alvo_id: evolucao.id }),
    ]);
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('texto de 100.000 é aceito', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const resposta = await registrar(sessao, {
      paciente_id: pacienteId,
      texto: 'x'.repeat(100_000),
    });
    expect(resposta.status).toBe(201);
  });

  it.each([
    ['vazio depois de aparar', ' \n '],
    ['acima de 100.000', SENTINELA.repeat(5883)],
  ])('texto %s: 422 validacao sem ecoar e nada é criado', async (_rotulo, texto) => {
    const { sessao, pacienteId } = await comPaciente();
    const resposta = await registrar(sessao, { paciente_id: pacienteId, texto });
    expect(resposta.status).toBe(422);
    const corpo = await resposta.json();
    expect(corpo).toMatchObject({ codigo: 'validacao', campos: ['texto'] });
    expect(JSON.stringify(corpo)).not.toContain(SENTINELA);
    expect(await evolucoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('paciente inativo pode ter evolução', async () => {
    const { sessao, pacienteId } = await comPaciente({ ativo: false });
    expect((await registrar(sessao, { paciente_id: pacienteId, texto: 'x' })).status).toBe(201);
  });
});

describe('evolução da sessão (EVO-02, EVO-03)', LENTO, () => {
  it('sessão agendada vira realizada na mesma gravação, com auditoria da sessão', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const sessaoId = await semearSessao(sessao.usuarioId, pacienteId, {
      inicio: INICIO,
      fim: FIM,
      cobravel: true,
    });
    const resposta = await registrar(sessao, {
      paciente_id: pacienteId,
      sessao_id: sessaoId,
      texto: 'x',
    });
    expect(resposta.status).toBe(201);
    expect(((await resposta.json()) as Evolucao).sessao_id).toBe(sessaoId);
    expect(await linhaSessao(sessaoId)).toMatchObject({
      status: 'realizada',
      cobravel: true,
      row_version: 2,
    });
    expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([
      expect.objectContaining({
        alvo_tipo: 'agendamento',
        alvo_id: sessaoId,
        campos_alterados: ['status'],
      }),
    ]);
  });

  it.each(['realizada', 'faltou', 'cancelada', 'remarcada'] as const)(
    'sessão %s aceita a evolução e não muda',
    async (status) => {
      const { sessao, pacienteId } = await comPaciente();
      const sessaoId = await semearSessao(sessao.usuarioId, pacienteId, {
        inicio: INICIO,
        fim: FIM,
        status,
      });
      const resposta = await registrar(sessao, {
        paciente_id: pacienteId,
        sessao_id: sessaoId,
        texto: 'x',
      });
      expect(resposta.status).toBe(201);
      expect(await linhaSessao(sessaoId)).toMatchObject({ status, row_version: 1 });
      expect(await auditoriaDe(sessao.usuarioId, 'sessao.status_alterado')).toEqual([]);
    },
  );

  it('segunda evolução da sessão: 409 EVOLUTION_EXISTS e nada muda', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const sessaoId = await semearSessao(sessao.usuarioId, pacienteId, { inicio: INICIO, fim: FIM });
    const corpo = { paciente_id: pacienteId, sessao_id: sessaoId, texto: 'x' };
    expect((await registrar(sessao, corpo)).status).toBe(201);
    await esperarProblema(await registrar(sessao, corpo), 409, PROBLEMA_EVOLUCAO_EXISTENTE);
    expect(await evolucoesDe(sessao.usuarioId)).toHaveLength(1);
  });

  it('atômico: com a evolução recusada, a sessão agendada continua agendada', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const sessaoId = await semearSessao(sessao.usuarioId, pacienteId, { inicio: INICIO, fim: FIM });
    // Evolução gravada direto no banco com a sessão ainda agendada.
    await comoAdmin(
      `insert into evolucao (usuario_id, paciente_id, sessao_id, texto) values ($1, $2, $3, 'y')`,
      [sessao.usuarioId, pacienteId, sessaoId],
    );
    await esperarProblema(
      await registrar(sessao, { paciente_id: pacienteId, sessao_id: sessaoId, texto: 'x' }),
      409,
      PROBLEMA_EVOLUCAO_EXISTENTE,
    );
    expect(await linhaSessao(sessaoId)).toMatchObject({ status: 'agendada', row_version: 1 });
    expect(await auditoriaDe(sessao.usuarioId, 'evolucao.criada')).toEqual([]);
  });

  it('sessão de outro paciente do mesmo profissional: 404 e nada muda', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const outroPaciente = await semearPaciente(sessao.usuarioId);
    const sessaoId = await semearSessao(sessao.usuarioId, outroPaciente, {
      inicio: INICIO,
      fim: FIM,
    });
    await esperarProblema(
      await registrar(sessao, { paciente_id: pacienteId, sessao_id: sessaoId, texto: 'x' }),
      404,
      PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
    );
    expect(await evolucoesDe(sessao.usuarioId)).toEqual([]);
    expect(await linhaSessao(sessaoId)).toMatchObject({ status: 'agendada' });
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('paciente de outro profissional, inexistente ou id malformado: o mesmo 404', async () => {
    const outro = await comPaciente();
    const { sessao } = await comPaciente();
    for (const id of [outro.pacienteId, crypto.randomUUID(), 'nao-e-uuid']) {
      await esperarProblema(
        await registrar(sessao, { paciente_id: id, texto: 'x' }),
        id === 'nao-e-uuid' ? 422 : 404,
        id === 'nao-e-uuid'
          ? expect.objectContaining({ codigo: 'validacao' })
          : PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
      await esperarProblema(
        await pedir('GET', `/api/pacientes/${id}/evolucoes`, sessao),
        404,
        PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
    }
    expect(await evolucoesDe(outro.sessao.usuarioId)).toEqual([]);
    expect(await evolucoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('sessão de outro profissional ou inexistente: 404, sem mudar a sessão dele', async () => {
    const outro = await comPaciente();
    const sessaoDoOutro = await semearSessao(outro.sessao.usuarioId, outro.pacienteId, {
      inicio: INICIO,
      fim: FIM,
    });
    const { sessao, pacienteId } = await comPaciente();
    for (const sessaoId of [sessaoDoOutro, crypto.randomUUID()])
      await esperarProblema(
        await registrar(sessao, { paciente_id: pacienteId, sessao_id: sessaoId, texto: 'x' }),
        404,
        PROBLEMA_EVOLUCAO_NAO_ENCONTRADA,
      );
    expect(await linhaSessao(sessaoDoOutro)).toMatchObject({ status: 'agendada', row_version: 1 });
    expect(await evolucoesDe(sessao.usuarioId)).toEqual([]);
  });

  it('B não vê as evoluções de A pela listagem', async () => {
    const a = await comPaciente();
    await registrar(a.sessao, { paciente_id: a.pacienteId, texto: SENTINELA });
    const b = await sessaoDeTeste();
    const resposta = await pedir('GET', `/api/pacientes/${a.pacienteId}/evolucoes`, b);
    expect(resposta.status).toBe(404);
    expect(await resposta.text()).not.toContain(SENTINELA);
  });
});

describe('listar as evoluções do paciente', LENTO, () => {
  it('mais recentes primeiro, paginadas por limit e offset', async () => {
    const { sessao, pacienteId } = await comPaciente();
    const ids: string[] = [];
    for (const texto of ['primeira', 'segunda', 'terceira'])
      ids.push(
        ((await (await registrar(sessao, { paciente_id: pacienteId, texto })).json()) as Evolucao)
          .id,
      );
    // Outro paciente do mesmo profissional não entra.
    await registrar(sessao, { paciente_id: await semearPaciente(sessao.usuarioId), texto: 'z' });

    const tudo = await pedir('GET', `/api/pacientes/${pacienteId}/evolucoes`, sessao);
    expect(tudo.status).toBe(200);
    const pagina = (await tudo.json()) as PaginaEvolucoes;
    expect(pagina.limit).toBe(50);
    expect(pagina.offset).toBe(0);
    expect(pagina.items.map((e) => e.texto)).toEqual(['terceira', 'segunda', 'primeira']);
    expect(pagina.items[0]).toMatchObject({ estado: 'editavel_hoje', retificacoes: [] });

    const segunda = (await (
      await pedir('GET', `/api/pacientes/${pacienteId}/evolucoes?limit=1&offset=1`, sessao)
    ).json()) as PaginaEvolucoes;
    expect(segunda).toMatchObject({ limit: 1, offset: 1 });
    expect(segunda.items.map((e) => e.id)).toEqual([ids[1]]);
  });

  it.each(['limit=0', 'limit=101', 'offset=-1', 'limit=abc'])(
    '%s: 400 consulta_invalida',
    async (consulta) => {
      const { sessao, pacienteId } = await comPaciente();
      await esperarProblema(
        await pedir('GET', `/api/pacientes/${pacienteId}/evolucoes?${consulta}`, sessao),
        400,
        PROBLEMA_CONSULTA_INVALIDA,
      );
    },
  );
});
