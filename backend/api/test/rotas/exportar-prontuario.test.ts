import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import {
  PROBLEMA_PERIODO_INVALIDO,
  PROBLEMA_PRONTUARIO_NAO_ENCONTRADO,
  type Prontuario,
} from '@es/contrato/exportacao';
import { beforeAll, describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, USER_AGENT, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T121 / EXP-01, EXP-06, EXP-07: GET /api/pacientes/:id/prontuario?de=&ate=, o JSON do
// prontuário que o app transforma em PDF (EXP-02, T123). Adaptado de record-export.service.ts
// e record-export.spec.ts do legado (lá a API devolvia o PDF pronto).
// - Anamnese com a versão original, as retificações (com motivo) e a vigente; cada versão traz só
//   os itens do modelo que existiam na revisão dela, com o rótulo do modelo (EXP-01).
// - Evoluções do período, com retificações e motivo; o dia é o de America/Sao_Paulo (EXP-01).
//   A anamnese vem sempre, com ou sem período (legado).
// - Período inválido: 400; paciente de outro profissional, inexistente ou id malformado: 404
//   (EXP-07); nenhum dos dois audita.
// - Exportação servida: audita exportacao.concluida com alvo paciente, sem conteúdo (EXP-06).

const LENTO = { timeout: 30_000 };
const SIGILO = 'conteudo-clinico-sigiloso';

async function esperarProblema(resposta: Response, status: number, problema: unknown) {
  expect(resposta.status).toBe(status);
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
}

const prontuario = async (
  sessao: Sessao,
  pacienteId: string,
  consulta = '',
): Promise<Prontuario> => {
  const resposta = await pedir('GET', `/api/pacientes/${pacienteId}/prontuario${consulta}`, sessao);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as Prontuario;
};

const um = async <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
  (await comoAdmin<T>(sql, p))[0]!;

async function evolucao(
  usuarioId: string,
  pacienteId: string,
  texto: string,
  criadoEm: string,
): Promise<string> {
  return (
    await um<{ id: string }>(
      `insert into evolucao (usuario_id, paciente_id, texto, criado_em)
       values ($1, $2, $3, $4) returning id`,
      [usuarioId, pacienteId, texto, criadoEm],
    )
  ).id;
}

const retificarEvolucao = (
  usuarioId: string,
  evolucaoId: string,
  seq: number,
  texto: string,
  motivo: string,
  criadoEm: string,
) =>
  comoAdmin(
    `insert into evolucao_retificacao (usuario_id, evolucao_id, seq, texto, motivo, criado_em)
     values ($1, $2, $3, $4, $5, $6)`,
    [usuarioId, evolucaoId, seq, texto, motivo, criadoEm],
  );

// Cenário completo: perfil com registro, modelo na revisão 2 (um campo incluído depois), anamnese
// com duas retificações e evoluções dos dois lados da meia-noite de Brasília.
async function cenario() {
  const prof = await sessaoDeTeste();
  const u = prof.usuarioId;
  await comoAdmin(
    `insert into perfil (usuario_id, nome, contato, endereco, especialidade, conselho,
                         numero_registro, regiao)
     values ($1, 'Dra. Simone Araújo', '(11) 99999-0000', 'Rua A, 1', 'psicologia', 'CRP',
             '06/123456', 'SP')`,
    [u],
  );
  const paciente = await semearPaciente(u, { nome: 'João Antônio Sá' });
  const outro = await semearPaciente(u, { nome: 'Outro Paciente' });
  const modelo = (
    await um<{ id: string }>(
      `insert into modelo_anamnese (usuario_id, especialidade, revisao)
       values ($1, 'psicologia', 2) returning id`,
      [u],
    )
  ).id;
  const item = async (tipo: string, rotulo: string, ordem: number, revisao: number) =>
    (
      await um<{ id: string }>(
        `insert into modelo_anamnese_item (usuario_id, modelo_id, tipo, rotulo, ordem,
                                           revisao_inclusao)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [u, modelo, tipo, rotulo, ordem, revisao],
      )
    ).id;
  const queixa = await item('campo', 'Queixa principal', 0, 1);
  const novo = await item('campo', 'Campo incluído depois', 1, 2);
  const risco = await item('alerta', 'Risco', 0, 1);
  // A original traz uma chave do item da revisão 2 (gravada direto no banco): ela não pode
  // aparecer, porque o item não existia na revisão 1.
  const anamnese = (
    await um<{ id: string }>(
      `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao,
                             valores, criado_em)
       values ($1, $2, $3, '2026-09-01', 1, $4, '2026-09-01T15:00:00Z') returning id`,
      [
        u,
        paciente,
        modelo,
        JSON.stringify({
          [queixa]: 'queixa-original',
          [novo]: 'nao-existia-na-revisao-1',
          [risco]: { marcado: false, obs: 'obs-original' },
        }),
      ],
    )
  ).id;
  await comoAdmin(
    `insert into anamnese_retificacao (usuario_id, anamnese_id, seq, motivo, modelo_revisao,
                                       valores, criado_em)
     values ($1, $2, 1, 'motivo-anamnese-um', 1, $3, '2026-09-11T02:30:00Z'),
            ($1, $2, 2, 'motivo-anamnese-dois', 2, $4, '2026-09-20T15:00:00Z')`,
    [
      u,
      anamnese,
      JSON.stringify({ [queixa]: 'queixa-ret-um', [risco]: { marcado: true, obs: 'obs-risco' } }),
      JSON.stringify({ [queixa]: 'queixa-ret-dois', [novo]: 'valor-do-campo-novo' }),
    ],
  );
  // 02:30 UTC = 23:30 do dia 9 em Brasília; 03:30 UTC = 00:30 do dia 10.
  const dia9 = await evolucao(u, paciente, 'evo-dia-09', '2026-10-10T02:30:00Z');
  const dia10 = await evolucao(u, paciente, 'evo-dia-10', '2026-10-10T03:30:00Z');
  await retificarEvolucao(u, dia10, 1, 'evo-10-ret-um', 'motivo-evo-um', '2026-10-12T12:00:00Z');
  await retificarEvolucao(
    u,
    dia10,
    2,
    'evo-10-ret-dois',
    'motivo-evo-dois',
    '2026-10-13T02:00:00Z',
  );
  const dia20 = await evolucao(u, paciente, `${SIGILO} `.repeat(50), '2026-10-20T12:00:00Z');
  await evolucao(u, outro, 'evo-de-outro-paciente', '2026-10-10T12:00:00Z');
  return { prof, u, paciente, outro, queixa, novo, risco, anamnese, dia9, dia10, dia20 };
}

let c: Awaited<ReturnType<typeof cenario>>;

beforeAll(async () => {
  c = await cenario();
}, 60_000);

const idsEvolucoes = (p: Prontuario) => p.evolucoes.map((e) => e.id);

describe('exige sessão', LENTO, () => {
  it('sem sessão responde 401 e não audita', async () => {
    const resposta = await pedir('GET', `/api/pacientes/${c.paciente}/prontuario`, null);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('prontuário completo (EXP-01)', LENTO, () => {
  it('traz paciente, período vazio e o profissional com o registro', async () => {
    const p = await prontuario(c.prof, c.paciente);
    expect(p.paciente).toEqual({ id: c.paciente, nome: 'João Antônio Sá' });
    expect(p.periodo).toEqual({ de: null, ate: null });
    expect(p.profissional).toEqual({
      nome: 'Dra. Simone Araújo',
      contato: '(11) 99999-0000',
      endereco: 'Rua A, 1',
      especialidade: 'psicologia',
      especialidade_nome: null,
      registro: 'CRP 06/123456 — SP',
    });
  });

  it('anamnese: original, retificações com motivo e vigente, cada uma com os itens da sua revisão', async () => {
    const { anamnese } = await prontuario(c.prof, c.paciente);
    expect(anamnese).toEqual({
      id: c.anamnese,
      especialidade: 'psicologia',
      data_sessao: '2026-09-01',
      criado_em: '2026-09-01T15:00:00.000Z',
      dia: '2026-09-01',
      original: {
        modelo_revisao: 1,
        campos: [
          {
            item_id: c.queixa,
            tipo: 'campo',
            rotulo: 'Queixa principal',
            texto: 'queixa-original',
          },
          {
            item_id: c.risco,
            tipo: 'alerta',
            rotulo: 'Risco',
            marcado: false,
            obs: 'obs-original',
          },
        ],
      },
      retificacoes: [
        {
          seq: 1,
          motivo: 'motivo-anamnese-um',
          criado_em: '2026-09-11T02:30:00.000Z',
          dia: '2026-09-10',
          modelo_revisao: 1,
          campos: [
            {
              item_id: c.queixa,
              tipo: 'campo',
              rotulo: 'Queixa principal',
              texto: 'queixa-ret-um',
            },
            { item_id: c.risco, tipo: 'alerta', rotulo: 'Risco', marcado: true, obs: 'obs-risco' },
          ],
        },
        {
          seq: 2,
          motivo: 'motivo-anamnese-dois',
          criado_em: '2026-09-20T15:00:00.000Z',
          dia: '2026-09-20',
          modelo_revisao: 2,
          campos: [
            {
              item_id: c.queixa,
              tipo: 'campo',
              rotulo: 'Queixa principal',
              texto: 'queixa-ret-dois',
            },
            {
              item_id: c.novo,
              tipo: 'campo',
              rotulo: 'Campo incluído depois',
              texto: 'valor-do-campo-novo',
            },
          ],
        },
      ],
      versao_vigente: 2,
      vigente: {
        modelo_revisao: 2,
        campos: [
          {
            item_id: c.queixa,
            tipo: 'campo',
            rotulo: 'Queixa principal',
            texto: 'queixa-ret-dois',
          },
          {
            item_id: c.novo,
            tipo: 'campo',
            rotulo: 'Campo incluído depois',
            texto: 'valor-do-campo-novo',
          },
        ],
      },
    });
    expect(JSON.stringify(anamnese)).not.toContain('nao-existia-na-revisao-1');
  });

  it('anamnese sem retificação: a vigente é a original', async () => {
    const paciente = await semearPaciente(c.u, { nome: 'Sem Retificação' });
    const modelo = await um<{ id: string }>(
      `select id from modelo_anamnese where usuario_id = $1`,
      [c.u],
    );
    await comoAdmin(
      `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao,
                             valores)
       values ($1, $2, $3, '2026-10-01', 2, $4)`,
      [c.u, paciente, modelo.id, JSON.stringify({ [c.novo]: 'so-original' })],
    );
    const { anamnese } = await prontuario(c.prof, paciente);
    expect(anamnese?.retificacoes).toEqual([]);
    expect(anamnese?.versao_vigente).toBe(0);
    expect(anamnese?.vigente).toEqual(anamnese?.original);
    expect(anamnese?.vigente.campos).toEqual([
      { item_id: c.novo, tipo: 'campo', rotulo: 'Campo incluído depois', texto: 'so-original' },
    ]);
  });

  it('evoluções do paciente em ordem de cadastro, com retificações e o dia em Brasília', async () => {
    const p = await prontuario(c.prof, c.paciente);
    expect(idsEvolucoes(p)).toEqual([c.dia9, c.dia10, c.dia20]);
    expect(p.evolucoes[0]).toEqual({
      id: c.dia9,
      sessao_id: null,
      criado_em: '2026-10-10T02:30:00.000Z',
      dia: '2026-10-09',
      texto: 'evo-dia-09',
      versao_vigente: 0,
      texto_vigente: 'evo-dia-09',
      retificacoes: [],
    });
    expect(p.evolucoes[1]).toEqual({
      id: c.dia10,
      sessao_id: null,
      criado_em: '2026-10-10T03:30:00.000Z',
      dia: '2026-10-10',
      texto: 'evo-dia-10',
      versao_vigente: 2,
      texto_vigente: 'evo-10-ret-dois',
      retificacoes: [
        {
          seq: 1,
          texto: 'evo-10-ret-um',
          motivo: 'motivo-evo-um',
          criado_em: '2026-10-12T12:00:00.000Z',
          dia: '2026-10-12',
        },
        {
          seq: 2,
          texto: 'evo-10-ret-dois',
          motivo: 'motivo-evo-dois',
          criado_em: '2026-10-13T02:00:00.000Z',
          dia: '2026-10-12',
        },
      ],
    });
  });

  it('não traz evolução de outro paciente', async () => {
    const p = await prontuario(c.prof, c.paciente);
    expect(JSON.stringify(p)).not.toContain('evo-de-outro-paciente');
  });

  it('paciente sem anamnese nem evolução: anamnese null e lista vazia', async () => {
    const vazio = await semearPaciente(c.u, { nome: 'Sem Registros' });
    const p = await prontuario(c.prof, vazio);
    expect(p.anamnese).toBeNull();
    expect(p.evolucoes).toEqual([]);
  });

  it('paciente inativo também é exportado', async () => {
    const inativo = await semearPaciente(c.u, { nome: 'Inativo', ativo: false });
    await evolucao(c.u, inativo, 'evo-inativo', '2026-10-01T12:00:00Z');
    const p = await prontuario(c.prof, inativo);
    expect(p.evolucoes.map((e) => e.texto)).toEqual(['evo-inativo']);
  });

  it('sem perfil, profissional null; registro null sem conselho e número', async () => {
    const semPerfil = await sessaoDeTeste();
    const paciente = await semearPaciente(semPerfil.usuarioId);
    expect((await prontuario(semPerfil, paciente)).profissional).toBeNull();

    const semRegistro = await sessaoDeTeste();
    await comoAdmin(
      `insert into perfil (usuario_id, nome, especialidade, especialidade_nome, regiao)
       values ($1, 'Dra. Bia', 'outra', 'Musicoterapia', 'RJ')`,
      [semRegistro.usuarioId],
    );
    const dela = await semearPaciente(semRegistro.usuarioId);
    expect((await prontuario(semRegistro, dela)).profissional).toEqual({
      nome: 'Dra. Bia',
      contato: null,
      endereco: null,
      especialidade: 'outra',
      especialidade_nome: 'Musicoterapia',
      registro: null,
    });
  });
});

describe('período, com o dia em Brasília (EXP-01)', LENTO, () => {
  it('o dia 9 em Brasília inclui 23:30 de Brasília (02:30 UTC do dia 10)', async () => {
    const p = await prontuario(c.prof, c.paciente, '?de=2026-10-09&ate=2026-10-09');
    expect(p.periodo).toEqual({ de: '2026-10-09', ate: '2026-10-09' });
    expect(idsEvolucoes(p)).toEqual([c.dia9]);
  });

  it('o dia 10 em Brasília começa à 00:30 de Brasília (03:30 UTC)', async () => {
    expect(
      idsEvolucoes(await prontuario(c.prof, c.paciente, '?de=2026-10-10&ate=2026-10-10')),
    ).toEqual([c.dia10]);
  });

  it('só de ou só até: limite de um lado só, com os dois extremos incluídos', async () => {
    expect(idsEvolucoes(await prontuario(c.prof, c.paciente, '?de=2026-10-10'))).toEqual([
      c.dia10,
      c.dia20,
    ]);
    expect(idsEvolucoes(await prontuario(c.prof, c.paciente, '?ate=2026-10-09'))).toEqual([c.dia9]);
    expect(idsEvolucoes(await prontuario(c.prof, c.paciente, '?ate=2026-10-20'))).toEqual([
      c.dia9,
      c.dia10,
      c.dia20,
    ]);
  });

  it('período sem evoluções: lista vazia, com a anamnese', async () => {
    const p = await prontuario(c.prof, c.paciente, '?de=2025-01-01&ate=2025-12-31');
    expect(p.evolucoes).toEqual([]);
    expect(p.anamnese?.id).toBe(c.anamnese);
  });

  it('o período vale pela evolução, não pela retificação', async () => {
    // A retificação da evolução do dia 10 é do dia 12; pedir só o dia 12 não a traz.
    expect(
      idsEvolucoes(await prontuario(c.prof, c.paciente, '?de=2026-10-12&ate=2026-10-12')),
    ).toEqual([]);
  });
});

describe('período inválido: 400 (EXP-07)', LENTO, () => {
  it.each([
    '?de=2026-13-40',
    '?ate=abc',
    '?de=2026-02-30',
    '?de=2026-05-02&ate=2026-05-01',
    '?de=',
    '?desconhecido=1',
  ])('%s responde 400 periodo_invalido e não audita', async (consulta) => {
    const prof = await sessaoDeTeste();
    const paciente = await semearPaciente(prof.usuarioId);
    await esperarProblema(
      await pedir('GET', `/api/pacientes/${paciente}/prontuario${consulta}`, prof),
      400,
      PROBLEMA_PERIODO_INVALIDO,
    );
    expect(await auditoriaDe(prof.usuarioId, 'exportacao.concluida')).toEqual([]);
  });
});

describe('paciente de outro profissional: 404 (EXP-07, ISO-02)', LENTO, () => {
  it('o mesmo 404 do inexistente e do id malformado, sem vazar nada e sem auditar', async () => {
    const intruso = await sessaoDeTeste();
    for (const id of [c.paciente, crypto.randomUUID(), 'nao-e-uuid', `${c.paciente}x`]) {
      const resposta = await pedir('GET', `/api/pacientes/${id}/prontuario`, intruso);
      expect(resposta.status, id).toBe(404);
      const corpo = await resposta.json();
      expect(corpo, id).toEqual(PROBLEMA_PRONTUARIO_NAO_ENCONTRADO);
      expect(JSON.stringify(corpo)).not.toContain('João');
    }
    expect(await auditoriaDe(intruso.usuarioId, 'exportacao.concluida')).toEqual([]);
  });

  it('com período válido, o paciente de outro profissional continua 404', async () => {
    const intruso = await sessaoDeTeste();
    await esperarProblema(
      await pedir('GET', `/api/pacientes/${c.paciente}/prontuario?de=2026-10-01`, intruso),
      404,
      PROBLEMA_PRONTUARIO_NAO_ENCONTRADO,
    );
  });
});

describe('auditoria exportacao.concluida (EXP-06)', LENTO, () => {
  it('cada exportação servida grava um evento com alvo paciente e sem conteúdo', async () => {
    const prof = await sessaoDeTeste();
    const paciente = await semearPaciente(prof.usuarioId, { nome: 'Nome Do Paciente' });
    await evolucao(prof.usuarioId, paciente, `${SIGILO} um`, '2026-10-01T12:00:00Z');
    await prontuario(prof, paciente);
    await prontuario(prof, paciente, '?de=2026-10-01&ate=2026-10-31');
    const eventos = await auditoriaDe(prof.usuarioId, 'exportacao.concluida');
    expect(eventos).toEqual([
      {
        usuario_id: prof.usuarioId,
        ator: prof.usuarioId,
        acao: 'exportacao.concluida',
        alvo_tipo: 'paciente',
        alvo_id: paciente,
        campos_alterados: [],
        origem_ua: 'Mozilla/5',
      },
      expect.objectContaining({ alvo_tipo: 'paciente', alvo_id: paciente }),
    ]);
    const tudo = JSON.stringify(
      await comoAdmin(`select * from audit_log where usuario_id = $1`, [prof.usuarioId]),
    );
    expect(tudo).not.toContain(SIGILO);
    expect(tudo).not.toContain('Nome Do Paciente');
    expect(tudo).not.toContain('2026-10-31');
    expect(USER_AGENT).toContain('Mozilla/5');
  });

  it('a exportação do prontuário não grava nada além do evento', async () => {
    const prof = await sessaoDeTeste();
    const paciente = await semearPaciente(prof.usuarioId);
    await prontuario(prof, paciente);
    expect(
      await comoAdmin(`select acao from audit_log where usuario_id = $1 order by id`, [
        prof.usuarioId,
      ]),
    ).toEqual([{ acao: 'exportacao.concluida' }]);
  });
});
