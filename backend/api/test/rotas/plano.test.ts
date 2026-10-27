import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_COBRANCA_INDISPONIVEL, type RespostaPlano } from '@es/contrato/plano';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { type CobrancaAsaas, ErroAsaas } from '../../src/integracoes/asaas.ts';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import {
  appComAsaas,
  asaasSimulado,
  type Estado,
  type Sessao,
  USER_AGENT,
  semearAssinatura,
} from './plano-apoio.ts';

// T134 / PLANO-14, PLANO-05: GET /api/plano ("Meu plano").
// - Plano e estado efetivos agora, com a data de renovação (ativa) ou de fim (trial, cancelada,
//   atrasada pela tolerância de 7 dias); free sem data.
// - Pix copia-e-cola e QR só com cobrança em aberto (PENDING ou OVERDUE, decisão do usuário) da
//   assinatura no Asaas; o QR é buscado na hora. Nada do Asaas é gravado; a rota não escreve no banco.
// - Asaas fora ou lento responde 503 `cobranca_indisponivel` (a tela mostra "Cobrança
//   indisponível"). Sem assinatura no Asaas, o Asaas não é chamado.
// - Isolamento: cada profissional vê só o próprio plano e o Pix da própria assinatura.

const DIA = 24 * 60 * 60 * 1000;
const daqui = (ms: number) => new Date(Date.now() + ms).toISOString();

const QR = {
  imagemPngBase64: 'iVBORw0KGgoAAAANSUhEUg==',
  copiaECola: '00020101021226820014br.gov.bcb.pix',
  expiraEm: '2027-10-30 23:59:59',
};

const cobranca = (dados: Partial<CobrancaAsaas> = {}): CobrancaAsaas => ({
  id: `pay_${crypto.randomUUID().slice(0, 12)}`,
  status: 'PENDING',
  vencimento: '2026-10-30',
  valorCentavos: 1990,
  ...dados,
});

function lerPlano(app: ReturnType<typeof appComAsaas>, sessao: Sessao | null) {
  return app.request(
    '/api/plano',
    {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': USER_AGENT,
        ...(sessao ? { cookie: sessao.cookie } : {}),
      },
    },
    env,
  );
}

async function cenario(
  status: Estado,
  opcoes: {
    comAsaas?: boolean;
    periodoFim?: string;
    vencimentoAtraso?: string | null;
    cobrancas?: CobrancaAsaas[];
  } = {},
) {
  const sessao = await sessaoDeTeste();
  const ids = await semearAssinatura(sessao.usuarioId, status, {
    comAsaas: opcoes.comAsaas ?? false,
    periodoFim: opcoes.periodoFim ?? daqui(10 * DIA),
    ...(opcoes.vencimentoAtraso !== undefined ? { vencimentoAtraso: opcoes.vencimentoAtraso } : {}),
  });
  const asaas = asaasSimulado({ cobrancas: opcoes.cobrancas ?? [], qr: QR });
  return { sessao, ids, asaas, app: appComAsaas(asaas.cliente) };
}

// Retrato das linhas do profissional nas tabelas que a rota poderia tocar (e de todas com
// usuario_id e RLS forçada), para provar que nada é gravado.
async function retrato(usuarioId: string): Promise<Record<string, string>> {
  const tabelas = await comoAdmin<{ tabela: string }>(
    `select c.relname as tabela from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'usuario_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
     order by 1`,
  );
  // Uma consulta só para todas as tabelas (os nomes vêm do catálogo, nunca de entrada), para o
  // retrato não somar dezenas de idas ao banco com a máquina carregada.
  const linhas = await comoAdmin<{ tabela: string; md5: string | null }>(
    tabelas
      .map(
        ({ tabela }) =>
          `select '${tabela}' as tabela,
                  (select md5(string_agg(t::text, '|' order by t::text))
                   from public.${tabela} t where usuario_id = $1) as md5`,
      )
      .join(' union all '),
    [usuarioId],
  );
  return Object.fromEntries(linhas.map((l) => [l.tabela, l.md5 ?? 'vazia']));
}

describe('autenticação', () => {
  it('sem sessão responde 401 e não chama o Asaas', async () => {
    const asaas = asaasSimulado();
    const resposta = await lerPlano(appComAsaas(asaas.cliente), null);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('plano atual e data de renovação ou fim (PLANO-14)', () => {
  it('trial sem assinatura no Asaas: Pro até periodo_fim, sem Pix e sem chamar o Asaas', async () => {
    const fim = daqui(5 * DIA);
    const { sessao, asaas, app } = await cenario('trial', { periodoFim: fim });
    const resposta = await lerPlano(app, sessao);
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      plano: 'pro',
      status: 'trial',
      data: { tipo: 'fim', em: fim },
      pix: null,
    } satisfies RespostaPlano);
    expect(asaas.chamadas).toEqual([]);
  });

  it('ativa: data de renovação em periodo_fim', async () => {
    const fim = daqui(20 * DIA);
    const { sessao, app } = await cenario('ativa', { comAsaas: true, periodoFim: fim });
    expect(await (await lerPlano(app, sessao)).json()).toMatchObject({
      plano: 'pro',
      status: 'ativa',
      data: { tipo: 'renovacao', em: fim },
    });
  });

  it('cancelada no período: Pro até periodo_fim, sem chamar o Asaas', async () => {
    const fim = daqui(3 * DIA);
    const { sessao, asaas, app } = await cenario('cancelada', {
      comAsaas: true,
      periodoFim: fim,
      cobrancas: [cobranca()],
    });
    expect(await (await lerPlano(app, sessao)).json()).toEqual({
      plano: 'pro',
      status: 'cancelada',
      data: { tipo: 'fim', em: fim },
      pix: null,
    });
    expect(asaas.chamadas).toEqual([]);
  });

  it('atrasada: fim do Pro no fim da tolerância de 7 dias', async () => {
    const vencimento = new Date(Date.now() - 2 * DIA);
    const { sessao, app } = await cenario('atrasada', {
      comAsaas: true,
      periodoFim: vencimento.toISOString(),
      vencimentoAtraso: vencimento.toISOString(),
    });
    expect(await (await lerPlano(app, sessao)).json()).toMatchObject({
      plano: 'pro',
      status: 'atrasada',
      data: { tipo: 'fim', em: new Date(vencimento.getTime() + 7 * DIA).toISOString() },
    });
  });

  it('free: sem data', async () => {
    const { sessao, app } = await cenario('free');
    expect(await (await lerPlano(app, sessao)).json()).toEqual({
      plano: 'free',
      status: 'free',
      data: null,
      pix: null,
    });
  });

  it.each([
    ['trial vencido', 'trial', { periodoFim: daqui(-1000) }],
    ['cancelada depois do período', 'cancelada', { periodoFim: daqui(-1000) }],
    [
      'atrasada com os 7 dias esgotados',
      'atrasada',
      { periodoFim: daqui(-8 * DIA), vencimentoAtraso: daqui(-7 * DIA - 1000) },
    ],
  ] as const)('%s aparece como free antes do cron', async (_, status, opcoes) => {
    const { sessao, app } = await cenario(status, opcoes);
    expect(await (await lerPlano(app, sessao)).json()).toMatchObject({
      plano: 'free',
      status: 'free',
      data: null,
    });
  });

  it('sem linha de assinatura: free (PREMISSA)', async () => {
    const sessao = await sessaoDeTeste();
    const asaas = asaasSimulado();
    const resposta = await lerPlano(appComAsaas(asaas.cliente), sessao);
    expect(await resposta.json()).toEqual({ plano: 'free', status: 'free', data: null, pix: null });
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('Pix e QR só com cobrança pendente (PLANO-05)', () => {
  it('trial que assinou: lista as cobranças, busca o QR da pendente na hora e mostra o Pix', async () => {
    const pendente = cobranca({ vencimento: '2026-10-30', valorCentavos: 1990 });
    const { sessao, ids, asaas, app } = await cenario('trial', {
      comAsaas: true,
      cobrancas: [pendente],
    });

    const resposta = await lerPlano(app, sessao);

    expect(resposta.status).toBe(200);
    expect(((await resposta.json()) as RespostaPlano).pix).toEqual({
      valor_centavos: 1990,
      vencimento: '2026-10-30',
      copia_e_cola: QR.copiaECola,
      qr_code_png_base64: QR.imagemPngBase64,
      expira_em: QR.expiraEm,
    });
    expect(asaas.chamadas).toEqual([
      { operacao: 'listarCobrancas', dados: ids.assinatura },
      { operacao: 'buscarQrPix', dados: pendente.id },
    ]);
  });

  it('o QR é buscado a cada abertura (nunca guardado)', async () => {
    const { sessao, asaas, app } = await cenario('free', {
      comAsaas: true,
      cobrancas: [cobranca()],
    });
    await lerPlano(app, sessao);
    await lerPlano(app, sessao);
    expect(asaas.chamadas.filter((c) => c.operacao === 'buscarQrPix')).toHaveLength(2);
  });

  it('ativa com a cobrança do ciclo seguinte pendente mostra o Pix', async () => {
    const { sessao, app } = await cenario('ativa', {
      comAsaas: true,
      periodoFim: daqui(20 * DIA),
      cobrancas: [cobranca({ status: 'RECEIVED' }), cobranca({ vencimento: '2026-11-30' })],
    });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toMatchObject({
      vencimento: '2026-11-30',
    });
  });

  // Decisão do usuário (2026-10-27): a cobrança vencida (OVERDUE) também mostra o Pix, para quem
  // está em atrasada pagar dentro da tolerância de 7 dias (D-21).
  it('cobrança vencida (OVERDUE) mostra o Pix e busca o QR', async () => {
    const vencida = cobranca({ status: 'OVERDUE', vencimento: '2026-10-20' });
    const { sessao, asaas, app } = await cenario('atrasada', {
      comAsaas: true,
      periodoFim: daqui(-2 * DIA),
      vencimentoAtraso: daqui(-2 * DIA),
      cobrancas: [vencida],
    });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toMatchObject({
      vencimento: '2026-10-20',
      copia_e_cola: QR.copiaECola,
    });
    expect(asaas.chamadas.at(-1)).toEqual({ operacao: 'buscarQrPix', dados: vencida.id });
  });

  it('vencida e pendente juntas: a de vencimento mais antigo', async () => {
    const vencida = cobranca({ status: 'OVERDUE', vencimento: '2026-10-20' });
    const pendente = cobranca({ status: 'PENDING', vencimento: '2026-11-20' });
    const { sessao, asaas, app } = await cenario('atrasada', {
      comAsaas: true,
      periodoFim: daqui(-2 * DIA),
      vencimentoAtraso: daqui(-2 * DIA),
      cobrancas: [pendente, vencida],
    });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toMatchObject({
      vencimento: '2026-10-20',
    });
    expect(asaas.chamadas.at(-1)).toEqual({ operacao: 'buscarQrPix', dados: vencida.id });
  });

  it.each(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH', 'REFUNDED'])(
    'cobrança %s não é pendente: sem Pix e sem buscar QR',
    async (status) => {
      const { sessao, asaas, app } = await cenario('trial', {
        comAsaas: true,
        cobrancas: [cobranca({ status })],
      });
      expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toBeNull();
      expect(asaas.chamadas.map((c) => c.operacao)).toEqual(['listarCobrancas']);
    },
  );

  it('sem cobrança nenhuma: sem Pix', async () => {
    const { sessao, asaas, app } = await cenario('trial', { comAsaas: true, cobrancas: [] });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toBeNull();
    expect(asaas.chamadas.map((c) => c.operacao)).toEqual(['listarCobrancas']);
  });

  it('mais de uma pendente: a de vencimento mais antigo', async () => {
    const antiga = cobranca({ vencimento: '2026-10-30' });
    const nova = cobranca({ vencimento: '2026-11-30' });
    const { sessao, asaas, app } = await cenario('free', {
      comAsaas: true,
      cobrancas: [nova, antiga],
    });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toMatchObject({
      vencimento: '2026-10-30',
    });
    expect(asaas.chamadas.at(-1)).toEqual({ operacao: 'buscarQrPix', dados: antiga.id });
  });
});

describe('dados do Asaas não persistidos', () => {
  it('a rota não grava nada no banco e a resposta não fica em cache', async () => {
    const { sessao, app } = await cenario('trial', { comAsaas: true, cobrancas: [cobranca()] });
    const antes = await retrato(sessao.usuarioId);

    const resposta = await lerPlano(app, sessao);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get('cache-control')).toContain('no-store');
    expect(await retrato(sessao.usuarioId)).toEqual(antes);
  });
});

describe('Asaas fora responde 503 (PLANO-12)', () => {
  it.each([new ErroAsaas('falha', 500), new ErroAsaas('tempo_excedido'), new ErroAsaas('rede')])(
    'ao listar as cobranças: %o',
    async (erro) => {
      const { sessao, asaas, app } = await cenario('trial', {
        comAsaas: true,
        cobrancas: [cobranca()],
      });
      asaas.falharEm('listarCobrancas', erro);
      const antes = await retrato(sessao.usuarioId);

      const resposta = await lerPlano(app, sessao);

      expect(resposta.status).toBe(503);
      expect(resposta.headers.get('content-type')).toContain('application/problem+json');
      expect(await resposta.json()).toEqual(PROBLEMA_COBRANCA_INDISPONIVEL);
      expect(await retrato(sessao.usuarioId)).toEqual(antes);
    },
  );

  it('ao buscar o QR', async () => {
    const { sessao, asaas, app } = await cenario('trial', {
      comAsaas: true,
      cobrancas: [cobranca()],
    });
    asaas.falharEm('buscarQrPix', new ErroAsaas('tempo_excedido'));
    const resposta = await lerPlano(app, sessao);
    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual(PROBLEMA_COBRANCA_INDISPONIVEL);
  });

  it('Asaas sem configuração também responde 503 e vai ao Sentry', async () => {
    const { sessao } = await cenario('trial', { comAsaas: true });
    const erros: unknown[] = [];
    const { criarApp } = await import('../../src/app.ts');
    const app = criarApp({
      capturarErro: (e) => erros.push(e),
      asaas: () => {
        throw new Error('Asaas: chave ausente');
      },
    });
    const resposta = await lerPlano(app, sessao);
    expect(resposta.status).toBe(503);
    expect(erros).toHaveLength(1);
  });

  it('sem assinatura no Asaas o plano abre mesmo com o Asaas fora', async () => {
    const { sessao, asaas, app } = await cenario('trial');
    asaas.falharEm('listarCobrancas');
    expect((await lerPlano(app, sessao)).status).toBe(200);
  });
});

describe('isolamento (ISO-02)', () => {
  it('cada profissional vê só o próprio plano e o Pix da própria assinatura', async () => {
    const a = await cenario('ativa', { comAsaas: true, periodoFim: daqui(20 * DIA) });
    const b = await cenario('free', { comAsaas: true, cobrancas: [cobranca()] });

    // Mesmo Asaas simulado para os dois: B só consulta a assinatura de B.
    const app = appComAsaas(b.asaas.cliente);
    const deB = (await (await lerPlano(app, b.sessao)).json()) as RespostaPlano;
    expect(deB).toMatchObject({ plano: 'free', status: 'free' });
    expect(deB.pix).not.toBeNull();
    expect(b.asaas.chamadas.filter((c) => c.operacao === 'listarCobrancas')).toEqual([
      { operacao: 'listarCobrancas', dados: b.ids.assinatura },
    ]);

    const deA = (await (await lerPlano(app, a.sessao)).json()) as RespostaPlano;
    expect(deA).toMatchObject({ plano: 'pro', status: 'ativa' });
    expect(b.asaas.chamadas.filter((c) => c.operacao === 'listarCobrancas').at(-1)).toEqual({
      operacao: 'listarCobrancas',
      dados: a.ids.assinatura,
    });
  });

  it('profissional sem assinatura no Asaas não vê o Pix de outro', async () => {
    const outro = await cenario('trial', { comAsaas: true, cobrancas: [cobranca()] });
    await lerPlano(outro.app, outro.sessao);
    const { sessao, asaas, app } = await cenario('trial', { cobrancas: [cobranca()] });
    expect(((await (await lerPlano(app, sessao)).json()) as RespostaPlano).pix).toBeNull();
    expect(asaas.chamadas).toEqual([]);
  });
});
