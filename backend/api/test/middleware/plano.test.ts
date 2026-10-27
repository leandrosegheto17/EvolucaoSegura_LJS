import { esquemaProblema } from '@es/contrato/identidade';
import { PROBLEMA_LIMITE_PLANO } from '@es/contrato/plano';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type AmbienteAutenticado, autenticada } from '../../src/middleware/autenticada.ts';
import { exigePlano } from '../../src/middleware/plano.ts';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import {
  auditoriaDe,
  linhaPaciente,
  pedir,
  type Sessao,
  semearPaciente,
} from '../rotas/pacientes-apoio.ts';
import { type Estado, semearAssinatura } from '../rotas/plano-apoio.ts';

// T133 / PLANO-02, PLANO-03, PLANO-15 (D-20): middleware de plano e limite do Free, na API.
// - Free com 5 ou mais pacientes ativos: criar (POST /api/pacientes) e reativar
//   (POST /api/pacientes/:id/reativar) respondem 403 LIMITE_PLANO, sem gravar nem auditar.
// - Tudo o que existe segue editável e legível (TCLE, sessão, preço, inativar, listagem).
// - Inativar um paciente libera a vaga; pacientes inativos não contam.
// - Trial e cancelada com periodo_fim no futuro, ativa e atrasada dentro dos 7 dias liberam tudo
//   (PLANO-02 como decidido no lote 15); fora do período contam como Free.
// - exigePlano('pro') recusa com 403 LIMITE_PLANO quem não está no Pro.

const DIA = 24 * 60 * 60 * 1000;
const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();

const PACIENTE = { nome: 'Joana Lima' };

async function profissional(
  status: Estado | null,
  opcoes: { periodoFim?: string; vencimentoAtraso?: string | null } = {},
): Promise<Sessao> {
  const sessao = await sessaoDeTeste();
  if (status !== null)
    await semearAssinatura(sessao.usuarioId, status, {
      periodoFim: opcoes.periodoFim ?? daqui(10 * DIA),
      ...(opcoes.vencimentoAtraso !== undefined
        ? { vencimentoAtraso: opcoes.vencimentoAtraso }
        : {}),
    });
  return sessao;
}

async function semearAtivos(usuarioId: string, quantos: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < quantos; i++) ids.push(await semearPaciente(usuarioId, { nome: `P${i}` }));
  return ids;
}

const totalPacientes = async (usuarioId: string) =>
  Number(
    (
      await comoAdmin<{ n: string }>('select count(*) as n from paciente where usuario_id = $1', [
        usuarioId,
      ])
    )[0]!.n,
  );

const criar = (sessao: Sessao) => pedir('POST', '/api/pacientes', sessao, PACIENTE);
const reativar = (sessao: Sessao, id: string) =>
  pedir('POST', `/api/pacientes/${id}/reativar`, sessao);
const inativar = (sessao: Sessao, id: string) =>
  pedir('POST', `/api/pacientes/${id}/inativar`, sessao);

async function esperaLimite(resposta: Response) {
  expect(resposta.status).toBe(403);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  expect(await resposta.json()).toEqual(PROBLEMA_LIMITE_PLANO);
}

describe('contrato do 403', () => {
  it('LIMITE_PLANO com status 403, no formato problem do contrato', () => {
    expect(esquemaProblema.parse(PROBLEMA_LIMITE_PLANO)).toEqual(PROBLEMA_LIMITE_PLANO);
    expect(PROBLEMA_LIMITE_PLANO).toMatchObject({ status: 403, codigo: 'LIMITE_PLANO' });
  });
});

describe('Free com 5 ativos recusa criar e reativar (PLANO-03)', () => {
  it('criar com 5 ativos responde 403 LIMITE_PLANO e não grava', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 5);

    await esperaLimite(await criar(sessao));
    expect(await totalPacientes(sessao.usuarioId)).toBe(5);
  });

  it('criar com mais de 5 ativos também responde 403', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 7);
    await esperaLimite(await criar(sessao));
    expect(await totalPacientes(sessao.usuarioId)).toBe(7);
  });

  it('com 4 ativos cria o quinto e recusa o sexto', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 4);
    expect((await criar(sessao)).status).toBe(201);
    await esperaLimite(await criar(sessao));
    expect(await totalPacientes(sessao.usuarioId)).toBe(5);
  });

  it('pacientes inativos não contam', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 4);
    for (let i = 0; i < 3; i++) await semearPaciente(sessao.usuarioId, { ativo: false });
    expect((await criar(sessao)).status).toBe(201);
  });

  it('reativar com 5 ativos responde 403, o paciente segue inativo e nada é auditado', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 5);
    const inativo = await semearPaciente(sessao.usuarioId, { ativo: false });

    await esperaLimite(await reativar(sessao, inativo));
    expect(await linhaPaciente(inativo)).toMatchObject({ ativo: false, row_version: 1 });
    expect(await auditoriaDe(sessao.usuarioId, 'paciente.reativado')).toEqual([]);
  });

  it('reativar com 4 ativos funciona e o seguinte é recusado', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 4);
    const a = await semearPaciente(sessao.usuarioId, { ativo: false });
    const b = await semearPaciente(sessao.usuarioId, { ativo: false });
    expect((await reativar(sessao, a)).status).toBe(200);
    await esperaLimite(await reativar(sessao, b));
  });

  it('reativar paciente já ativo no limite responde 200 sem mudança (PAC-04)', async () => {
    const sessao = await profissional('free');
    const [primeiro] = await semearAtivos(sessao.usuarioId, 5);
    const resposta = await reativar(sessao, primeiro!);
    expect(resposta.status).toBe(200);
    expect(await linhaPaciente(primeiro!)).toMatchObject({ ativo: true, row_version: 1 });
  });

  it('reativar paciente inexistente ou de outro profissional no limite segue 404 (ISO-02)', async () => {
    const outro = await sessaoDeTeste();
    const alheio = await semearPaciente(outro.usuarioId, { ativo: false });
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 5);
    expect((await reativar(sessao, alheio)).status).toBe(404);
    expect((await reativar(sessao, crypto.randomUUID())).status).toBe(404);
    expect(await linhaPaciente(alheio)).toMatchObject({ ativo: false });
  });

  it('os pacientes de outro profissional não contam', async () => {
    const outro = await profissional('free');
    await semearAtivos(outro.usuarioId, 6);
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 4);
    expect((await criar(sessao)).status).toBe(201);
  });

  it('sem linha de assinatura conta como Free (PREMISSA)', async () => {
    const sessao = await profissional(null);
    await semearAtivos(sessao.usuarioId, 5);
    await esperaLimite(await criar(sessao));
  });

  it('dois pedidos simultâneos com 4 ativos criam só um', async () => {
    const sessao = await profissional('free');
    await semearAtivos(sessao.usuarioId, 4);
    const respostas = await Promise.all([criar(sessao), criar(sessao)]);
    expect(respostas.map((r) => r.status).sort()).toEqual([201, 403]);
    expect(await totalPacientes(sessao.usuarioId)).toBe(5);
  });

  it('sem sessão responde 401 antes do limite', async () => {
    const resposta = await pedir('POST', '/api/pacientes', null, PACIENTE);
    expect(resposta.status).toBe(401);
  });
});

describe('tudo o que existe segue editável no Free com 5 ativos (D-20)', () => {
  it('lista, registra TCLE, agenda sessão, define preço e inativa', async () => {
    const sessao = await profissional('free');
    const [id] = await semearAtivos(sessao.usuarioId, 6);

    expect((await pedir('GET', '/api/pacientes', sessao)).status).toBe(200);
    expect((await pedir('GET', `/api/pacientes/${id}`, sessao)).status).toBe(200);
    expect(
      (
        await pedir('POST', `/api/pacientes/${id}/tcle`, sessao, {
          finalidade: 'Atendimento psicológico',
          data: '2026-10-01',
          versao: 'v1',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await pedir('POST', '/api/sessoes', sessao, {
          paciente_id: id,
          inicio: '2026-11-03T10:00:00-03:00',
          fim: '2026-11-03T10:50:00-03:00',
        })
      ).status,
    ).toBe(201);
    expect(
      (await pedir('PUT', `/api/pacientes/${id}/preco`, sessao, { valor: 15000 })).status,
    ).toBe(200);
    expect((await inativar(sessao, id!)).status).toBe(200);
  });
});

describe('inativar libera a vaga', () => {
  it('com 5 ativos, inativar um permite criar outro', async () => {
    const sessao = await profissional('free');
    const [id] = await semearAtivos(sessao.usuarioId, 5);
    await esperaLimite(await criar(sessao));

    expect((await inativar(sessao, id!)).status).toBe(200);
    expect((await criar(sessao)).status).toBe(201);
  });

  it('com 5 ativos, inativar um permite reativar outro', async () => {
    const sessao = await profissional('free');
    const [id] = await semearAtivos(sessao.usuarioId, 5);
    const inativo = await semearPaciente(sessao.usuarioId, { ativo: false });
    await esperaLimite(await reativar(sessao, inativo));

    expect((await inativar(sessao, id!)).status).toBe(200);
    expect((await reativar(sessao, inativo)).status).toBe(200);
  });
});

// Rota de teste com exigePlano('pro') depois da lista autenticada (nenhuma rota de produção do
// MVP pede o Pro além do limite de pacientes).
const appPro = new Hono<AmbienteAutenticado>().post(
  '/api/so-pro',
  ...autenticada,
  exigePlano('pro'),
  (c) => c.json({ ok: true }),
);
const pedirPro = (sessao: Sessao) =>
  appPro.request(
    '/api/so-pro',
    {
      method: 'POST',
      headers: {
        'CF-Connecting-IP': ipUnico(),
        cookie: sessao.cookie,
        'x-csrf-token': sessao.csrf,
      },
    },
    env,
  );

describe('Pro liberado (PLANO-02): sem limite de pacientes e exigePlano passa', () => {
  const casos: [string, Estado, { periodoFim?: string; vencimentoAtraso?: string | null }][] = [
    ['trial no período', 'trial', { periodoFim: daqui(DIA) }],
    ['ativa', 'ativa', { periodoFim: daqui(30 * DIA) }],
    // Renovação ainda não chegou pelo webhook: ativa não olha periodo_fim (lote 15).
    ['ativa com periodo_fim passado', 'ativa', { periodoFim: daqui(-DIA) }],
    [
      'atrasada dentro dos 7 dias',
      'atrasada',
      { periodoFim: daqui(-2 * DIA), vencimentoAtraso: daqui(-6 * DIA) },
    ],
    ['cancelada no período', 'cancelada', { periodoFim: daqui(DIA) }],
  ];

  it.each(casos)('%s: cria, reativa e passa no exigePlano', async (_, status, opcoes) => {
    const sessao = await profissional(status, opcoes);
    await semearAtivos(sessao.usuarioId, 6);
    const inativo = await semearPaciente(sessao.usuarioId, { ativo: false });

    expect((await criar(sessao)).status).toBe(201);
    expect((await reativar(sessao, inativo)).status).toBe(200);
    expect(await totalPacientes(sessao.usuarioId)).toBe(8);
    const pro = await pedirPro(sessao);
    expect(pro.status).toBe(200);
    expect(await pro.json()).toEqual({ ok: true });
  });
});

describe('fora do Pro: limite do Free e exigePlano recusa', () => {
  const casos: [
    string,
    Estado | null,
    { periodoFim?: string; vencimentoAtraso?: string | null },
  ][] = [
    ['free', 'free', {}],
    ['trial vencido', 'trial', { periodoFim: daqui(-1000) }],
    ['cancelada depois do período', 'cancelada', { periodoFim: daqui(-1000) }],
    [
      'atrasada com os 7 dias esgotados',
      'atrasada',
      { periodoFim: daqui(-8 * DIA), vencimentoAtraso: daqui(-7 * DIA - 1000) },
    ],
    ['sem assinatura (PREMISSA)', null, {}],
  ];

  it.each(casos)('%s', async (_, status, opcoes) => {
    const sessao = await profissional(status, opcoes);
    await semearAtivos(sessao.usuarioId, 5);
    await esperaLimite(await criar(sessao));
    await esperaLimite(await pedirPro(sessao));
  });

  it('exigePlano recusa o Free mesmo sem nenhum paciente', async () => {
    const sessao = await profissional('free');
    await esperaLimite(await pedirPro(sessao));
  });
});
