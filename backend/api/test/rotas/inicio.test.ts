import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import type { ResumoInicio } from '@es/contrato/inicio';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { pedir, semearPaciente } from './pacientes-apoio.ts';
import { semearPerfil, semearSessao } from './sessoes-apoio.ts';

// T115 / INI-01, INI-02, INI-03, ISO-02: GET /api/inicio.
// - INI-01: semana de segunda até o último dia habilitado, com total (sem canceladas nem
//   remarcadas), realizadas, pendentes de evolução e pendentes de pagamento.
// - INI-02: lista de hoje com no máximo 6 sessões, sem canceladas nem remarcadas; "hoje" pelo
//   relógio do banco em America/Sao_Paulo.
// - INI-03: cada sessão de hoje com o estado da evolução (4) e do pagamento (3).
// - ISO-02: só sessões do profissional.

const LENTO = { timeout: 30_000 };

type Status = 'agendada' | 'realizada' | 'faltou' | 'cancelada' | 'remarcada';

// Datas de calendário de Brasília pelo relógio do banco.
async function datas() {
  const [linha] = await comoAdmin<
    Record<
      | 'hoje'
      | 'ontem'
      | 'amanha'
      | 'segunda'
      | 'sabado'
      | 'domingo'
      | 'domingo_anterior'
      | 'proxima_segunda',
      string
    >
  >(
    `select to_char(d, 'YYYY-MM-DD') as hoje,
            to_char(d - 1, 'YYYY-MM-DD') as ontem,
            to_char(d + 1, 'YYYY-MM-DD') as amanha,
            to_char(s, 'YYYY-MM-DD') as segunda,
            to_char(s + 5, 'YYYY-MM-DD') as sabado,
            to_char(s + 6, 'YYYY-MM-DD') as domingo,
            to_char(s - 1, 'YYYY-MM-DD') as domingo_anterior,
            to_char(s + 7, 'YYYY-MM-DD') as proxima_segunda
     from (select (now() at time zone 'America/Sao_Paulo')::date as d,
                  date_trunc('week', now() at time zone 'America/Sao_Paulo')::date as s) x`,
  );
  return linha!;
}

async function sessao(
  usuarioId: string,
  pacienteId: string,
  dia: string,
  hora: string,
  status: Status,
  opcoes: { cobravel?: boolean; pago?: boolean; evolucao?: 'hoje' | 'antiga' } = {},
): Promise<string> {
  const inicio = `${dia}T${hora}:00-03:00`;
  const id = await semearSessao(usuarioId, pacienteId, {
    inicio,
    fim: new Date(new Date(inicio).getTime() + 50 * 60_000).toISOString(),
    status,
    cobravel: opcoes.cobravel ?? false,
  });
  if (opcoes.pago)
    await comoAdmin(
      `insert into pagamento (usuario_id, sessao_id, valor_centavos, data_pagamento, meio)
       values ($1, $2, 100, '2026-10-01', 'pix')`,
      [usuarioId, id],
    );
  if (opcoes.evolucao)
    await comoAdmin(
      `begin; set local session_replication_role = replica;
       insert into evolucao (usuario_id, paciente_id, sessao_id, texto, criado_em)
       values ('${usuarioId}', '${pacienteId}', '${id}', 'x',
               ${opcoes.evolucao === 'hoje' ? 'now()' : "now() - interval '2 days'"});
       commit;`,
    );
  return id;
}

describe('exige sessão', LENTO, () => {
  it('sem sessão responde 401', async () => {
    const resposta = await pedir('GET', '/api/inicio', null);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });
});

describe('com 8 sessões hoje (INI-01, INI-02, INI-03)', LENTO, () => {
  async function cenario() {
    const d = await datas();
    const prof = await sessaoDeTeste();
    const u = prof.usuarioId;
    await semearPerfil(u, { atende_sabado: true, atende_domingo: true });
    const ana = await semearPaciente(u, { nome: 'Ana' });
    const s = {
      cancelada: await sessao(u, ana, d.hoje, '07:00', 'cancelada', { cobravel: true }),
      remarcada: await sessao(u, ana, d.hoje, '07:30', 'remarcada'),
      s1: await sessao(u, ana, d.hoje, '08:00', 'realizada'),
      s2: await sessao(u, ana, d.hoje, '09:00', 'realizada', { evolucao: 'hoje', pago: true }),
      s3: await sessao(u, ana, d.hoje, '10:00', 'realizada', { evolucao: 'antiga' }),
      s4: await sessao(u, ana, d.hoje, '11:00', 'faltou', { cobravel: true }),
      s5: await sessao(u, ana, d.hoje, '12:00', 'faltou'),
      s6: await sessao(u, ana, d.hoje, '13:00', 'agendada'),
      s7: await sessao(u, ana, d.hoje, '14:00', 'agendada'),
      s8: await sessao(u, ana, d.hoje, '15:00', 'agendada'),
    };
    // Fora da semana: não contam.
    await sessao(u, ana, d.domingo_anterior, '10:00', 'realizada');
    await sessao(u, ana, d.proxima_segunda, '10:00', 'realizada');
    return { d, prof, ana, s };
  }

  it('lista 6 sessões, sem canceladas nem remarcadas, com os estados da evolução e do pagamento', async () => {
    const { prof, ana, s } = await cenario();
    const resposta = await pedir('GET', '/api/inicio', prof);
    expect(resposta.status).toBe(200);
    const resumo = (await resposta.json()) as ResumoInicio;
    expect(resumo.hoje).toHaveLength(6);
    expect(resumo.hoje.map((h) => [h.id, h.status, h.evolucao, h.pagamento])).toEqual([
      [s.s1, 'realizada', 'editavel_hoje_sem_texto', 'pendente'],
      [s.s2, 'realizada', 'editavel_hoje', 'pago'],
      [s.s3, 'realizada', 'registrada', 'pendente'],
      [s.s4, 'faltou', 'sem_registro', 'pendente'],
      [s.s5, 'faltou', 'sem_registro', 'nao_cobravel'],
      [s.s6, 'agendada', 'sem_registro', 'nao_cobravel'],
    ]);
    expect(resumo.hoje[0]).toEqual({
      id: s.s1,
      inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T11:00:00/),
      fim: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T11:50:00/),
      status: 'realizada',
      paciente: { id: ana, nome: 'Ana' },
      evolucao: 'editavel_hoje_sem_texto',
      pagamento: 'pendente',
    });
    expect(resumo.hoje_total).toBe(8);
    expect(resumo.alerta).toEqual({ editavel_hoje_sem_texto: 1 });
  });

  it('contadores da semana', async () => {
    const { d, prof } = await cenario();
    const resumo = (await (await pedir('GET', '/api/inicio', prof)).json()) as ResumoInicio;
    expect(resumo.semana).toEqual({
      inicio: d.segunda,
      fim: d.domingo,
      total: 8,
      realizadas: 3,
      pendentes_evolucao: 1,
      // s1, s3, s4 e a cancelada cobrável.
      pendentes_pagamento: 4,
    });
  });
});

describe('semana de segunda ao último dia habilitado (INI-01)', LENTO, () => {
  it('sábado desligado fica fora; o fim acompanha o domingo habilitado', async () => {
    const d = await datas();
    const prof = await sessaoDeTeste();
    const u = prof.usuarioId;
    await semearPerfil(u, { atende_sabado: false, atende_domingo: true });
    const ana = await semearPaciente(u);
    await sessao(u, ana, d.segunda, '10:00', 'realizada');
    await sessao(u, ana, d.sabado, '10:00', 'realizada');
    await sessao(u, ana, d.domingo, '10:00', 'agendada');
    const resumo = (await (await pedir('GET', '/api/inicio', prof)).json()) as ResumoInicio;
    expect(resumo.semana).toMatchObject({
      inicio: d.segunda,
      fim: d.domingo,
      total: 2,
      realizadas: 1,
    });
  });

  it('sem perfil, a semana vai de segunda a sexta', async () => {
    const d = await datas();
    const prof = await sessaoDeTeste();
    const resumo = (await (await pedir('GET', '/api/inicio', prof)).json()) as ResumoInicio;
    expect(resumo.semana.inicio).toBe(d.segunda);
    const sexta = new Date(`${d.segunda}T00:00:00Z`);
    sexta.setUTCDate(sexta.getUTCDate() + 4);
    expect(resumo.semana.fim).toBe(sexta.toISOString().slice(0, 10));
    expect(resumo).toMatchObject({
      semana: { total: 0, realizadas: 0, pendentes_evolucao: 0, pendentes_pagamento: 0 },
      hoje: [],
      hoje_total: 0,
      alerta: { editavel_hoje_sem_texto: 0 },
    });
  });
});

describe('"hoje" pelo relógio do banco em Brasília (INI-02)', LENTO, () => {
  it('23:30 de hoje em Brasília entra; 23:30 de ontem e 00:30 de amanhã não', async () => {
    const d = await datas();
    const prof = await sessaoDeTeste();
    const u = prof.usuarioId;
    await semearPerfil(u, { atende_sabado: true, atende_domingo: true });
    const ana = await semearPaciente(u);
    // 23:30 em Brasília já é o dia seguinte em UTC; 00:30 de amanhã ainda é hoje em UTC.
    const tarde = await sessao(u, ana, d.hoje, '23:30', 'agendada');
    await sessao(u, ana, d.ontem, '23:30', 'agendada');
    await sessao(u, ana, d.amanha, '00:30', 'agendada');
    const resumo = (await (await pedir('GET', '/api/inicio', prof)).json()) as ResumoInicio;
    expect(resumo.hoje.map((h) => h.id)).toEqual([tarde]);
    expect(resumo.hoje_total).toBe(1);
  });
});

describe('isolamento (ISO-02)', LENTO, () => {
  it('as sessões de outro profissional não aparecem nem contam', async () => {
    const d = await datas();
    const dona = await sessaoDeTeste();
    await semearPerfil(dona.usuarioId, { atende_sabado: true, atende_domingo: true });
    const paciente = await semearPaciente(dona.usuarioId);
    await sessao(dona.usuarioId, paciente, d.hoje, '10:00', 'realizada');
    const outra = await sessaoDeTeste();
    await semearPerfil(outra.usuarioId, { atende_sabado: true, atende_domingo: true });
    const resumo = (await (await pedir('GET', '/api/inicio', outra)).json()) as ResumoInicio;
    expect(resumo).toMatchObject({
      semana: { total: 0, realizadas: 0, pendentes_evolucao: 0, pendentes_pagamento: 0 },
      hoje: [],
      hoje_total: 0,
      alerta: { editavel_hoje_sem_texto: 0 },
    });
  });
});
