import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ErroAsaas } from '../../src/integracoes/asaas.ts';
import { tarefaAssinaturas } from '../../src/tarefas/assinaturas.ts';
import { type ContextoTarefa, despachar } from '../../src/tarefas/despachar.ts';
import { TAREFAS } from '../../src/tarefas/registro.ts';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import {
  asaasSimulado,
  auditoriaDe,
  type Estado,
  linhaAssinatura,
  semearAssinatura,
} from '../rotas/plano-apoio.ts';

// T137 / PLANO-04, PLANO-10, PLANO-11: a tarefa do cron leva a free, pelas regras da T125:
// - trial com periodo_fim vencido (PLANO-04) e cancelada no fim do período (PLANO-11), sem
//   chamar o Asaas;
// - atrasada com a tolerância de 7 dias esgotada (PLANO-10), cancelando a assinatura no Asaas e
//   limpando o asaas_subscription_id (decisão do usuário, 2026-10-27). Se o cancelamento falhar,
//   nada muda e a próxima execução tenta de novo.
// Critérios: dados intactos ao cair para Free; cancela no Asaas ao cair por atraso; reexecução
// não repete efeitos. Audita assinatura.free (ator sistema) só com nomes de campos.
// Isolamento no banco de teste compartilhado: as assinaturas daqui vencem em 1999 e a tarefa roda
// com `agora` em 1999; as dos outros arquivos (datas de 2026) nunca entram na lista. Teste que
// deixa uma assinatura vencida sem cair para free a leva a free no fim, para não sobrar.

const AGORA = new Date('1999-07-01T12:00:00.000Z');
const DIA = 24 * 60 * 60 * 1000;
const antes = (ms: number) => new Date(AGORA.getTime() - ms).toISOString();
const depois = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

function montar(limite = 10) {
  const asaas = asaasSimulado();
  const erros: unknown[] = [];
  const tarefa = tarefaAssinaturas({ asaas: () => asaas.cliente });
  const ctx: ContextoTarefa = {
    agora: AGORA,
    desde: null,
    limite,
    env,
    emSegundoPlano: () => {},
    capturarErro: (e) => erros.push(e),
  };
  return { asaas, erros, rodar: () => tarefa.executar(ctx), tarefa };
}

async function profissional(
  status: Estado,
  opcoes: { periodoFim: string; vencimentoAtraso?: string | null; comAsaas?: boolean },
) {
  const { usuarioId } = await sessaoDeTeste();
  const ids = await semearAssinatura(usuarioId, status, {
    comAsaas: opcoes.comAsaas ?? true,
    periodoFim: opcoes.periodoFim,
    vencimentoAtraso: opcoes.vencimentoAtraso ?? null,
  });
  return { usuarioId, ...ids };
}

const levarAFree = (usuarioId: string) =>
  comoAdmin(
    `update assinatura set status = 'free', plano = 'free', vencimento_atraso = null
     where usuario_id = $1`,
    [usuarioId],
  );

// Tudo o que é do profissional fora da assinatura (conta e um paciente).
async function dadosDoProfissional(usuarioId: string) {
  const usuario = await comoAdmin('select * from usuario where id = $1', [usuarioId]);
  const pacientes = await comoAdmin('select * from paciente where usuario_id = $1 order by id', [
    usuarioId,
  ]);
  return { usuario, pacientes };
}

const cancelamentos = (asaas: ReturnType<typeof asaasSimulado>) =>
  asaas.chamadas.filter((c) => c.operacao === 'cancelarAssinatura').map((c) => c.dados);

describe('trial vencido cai para free (PLANO-04)', () => {
  it('muda para free sem tocar nos dados nem no Asaas, e audita', async () => {
    const { asaas, erros, rodar } = montar();
    const p = await profissional('trial', { periodoFim: antes(DIA), comAsaas: false });
    await comoAdmin(`insert into paciente (usuario_id, nome) values ($1, 'Paciente Um')`, [
      p.usuarioId,
    ]);
    const dadosAntes = await dadosDoProfissional(p.usuarioId);
    const antesDaTarefa = await linhaAssinatura(p.usuarioId);

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
      plano: 'free',
      status: 'free',
      periodo_fim: antesDaTarefa!.periodo_fim,
      vencimento_atraso: null,
      asaas_subscription_id: null,
    });
    expect(await dadosDoProfissional(p.usuarioId)).toEqual(dadosAntes);
    expect(await auditoriaDe(p.usuarioId)).toEqual([
      {
        ator: 'sistema',
        acao: 'assinatura.free',
        alvo_tipo: 'conta',
        alvo_id: p.usuarioId,
        campos_alterados: ['status', 'plano'],
      },
    ]);
    expect(asaas.chamadas).toEqual([]);
    expect(erros).toEqual([]);
  });

  it('trial com periodo_fim no futuro fica como está', async () => {
    const { rodar } = montar();
    const p = await profissional('trial', { periodoFim: depois(DIA), comAsaas: false });

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({ status: 'trial', plano: 'pro' });
    expect(await auditoriaDe(p.usuarioId)).toEqual([]);
  });
});

describe('cancelada no fim do período cai para free (PLANO-11)', () => {
  it('muda para free sem chamar o Asaas (já cancelada lá) e mantém os ids', async () => {
    const { asaas, rodar } = montar();
    const p = await profissional('cancelada', { periodoFim: antes(1) });

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
      plano: 'free',
      status: 'free',
      asaas_customer_id: p.cliente,
      asaas_subscription_id: p.assinatura,
    });
    expect(asaas.chamadas).toEqual([]);
    expect((await auditoriaDe(p.usuarioId)).map((e) => e.campos_alterados)).toEqual([
      ['status', 'plano'],
    ]);
  });

  it('cancelada até o futuro segue com o Pro', async () => {
    const { rodar } = montar();
    const p = await profissional('cancelada', { periodoFim: depois(1) });

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({ status: 'cancelada' });
  });
});

describe('atrasada com 7 dias de tolerância esgotados (PLANO-10)', () => {
  it('cancela no Asaas, muda para free, limpa o id da assinatura e mantém os dados', async () => {
    const { asaas, erros, rodar } = montar();
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(7 * DIA),
    });
    await comoAdmin(`insert into paciente (usuario_id, nome) values ($1, 'Paciente Dois')`, [
      p.usuarioId,
    ]);
    const dadosAntes = await dadosDoProfissional(p.usuarioId);

    await rodar();

    expect(cancelamentos(asaas)).toEqual([p.assinatura]);
    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
      plano: 'free',
      status: 'free',
      asaas_customer_id: p.cliente,
      asaas_subscription_id: null,
      vencimento_atraso: null,
    });
    expect(await dadosDoProfissional(p.usuarioId)).toEqual(dadosAntes);
    expect(await auditoriaDe(p.usuarioId)).toEqual([
      {
        ator: 'sistema',
        acao: 'assinatura.free',
        alvo_tipo: 'conta',
        alvo_id: p.usuarioId,
        campos_alterados: ['status', 'plano', 'vencimento_atraso', 'asaas_subscription_id'],
      },
    ]);
    expect(erros).toEqual([]);
  });

  it('atrasada dentro da tolerância fica como está, sem chamar o Asaas', async () => {
    const { asaas, rodar } = montar();
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(7 * DIA - 1),
    });

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
      status: 'atrasada',
      asaas_subscription_id: p.assinatura,
    });
    expect(cancelamentos(asaas)).not.toContain(p.assinatura);
  });

  it('Asaas falha: nada muda, o erro vai ao Sentry e as demais assinaturas seguem', async () => {
    const { asaas, erros, rodar } = montar();
    const falha = new ErroAsaas('rede');
    asaas.falharEm('cancelarAssinatura', falha);
    const atrasada = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(10 * DIA),
    });
    const trial = await profissional('trial', { periodoFim: antes(DIA), comAsaas: false });
    const antesDaTarefa = await linhaAssinatura(atrasada.usuarioId);
    try {
      await rodar();

      expect(cancelamentos(asaas)).toEqual([atrasada.assinatura]);
      expect(await linhaAssinatura(atrasada.usuarioId)).toEqual(antesDaTarefa);
      expect(await auditoriaDe(atrasada.usuarioId)).toEqual([]);
      expect(erros).toEqual([falha]);
      expect(await linhaAssinatura(trial.usuarioId)).toMatchObject({ status: 'free' });
    } finally {
      await levarAFree(atrasada.usuarioId);
    }
  });

  it('a execução seguinte tenta de novo depois de uma falha do Asaas', async () => {
    const primeira = montar();
    primeira.asaas.falharEm('cancelarAssinatura');
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(10 * DIA),
    });
    try {
      await primeira.rodar();
      expect(await linhaAssinatura(p.usuarioId)).toMatchObject({ status: 'atrasada' });

      const segunda = montar();
      await segunda.rodar();

      expect(cancelamentos(segunda.asaas)).toEqual([p.assinatura]);
      expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
        status: 'free',
        asaas_subscription_id: null,
      });
    } finally {
      await levarAFree(p.usuarioId);
    }
  });

  it('assinatura que já não existe no Asaas (404) conta como cancelada', async () => {
    const { asaas, erros, rodar } = montar();
    asaas.falharEm('cancelarAssinatura', new ErroAsaas('falha', 404));
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(10 * DIA),
    });

    await rodar();

    expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
      status: 'free',
      asaas_subscription_id: null,
    });
    expect(erros).toEqual([]);
  });

  it('outro erro HTTP do Asaas (400) não muda nada', async () => {
    const { asaas, erros, rodar } = montar();
    asaas.falharEm('cancelarAssinatura', new ErroAsaas('falha', 400, ['invalid_action']));
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(10 * DIA),
    });
    try {
      await rodar();

      expect(await linhaAssinatura(p.usuarioId)).toMatchObject({
        status: 'atrasada',
        asaas_subscription_id: p.assinatura,
      });
      expect(erros).toHaveLength(1);
    } finally {
      await levarAFree(p.usuarioId);
    }
  });
});

describe('reexecução não repete efeitos', () => {
  it('a segunda execução não chama o Asaas, não audita e não muda a linha', async () => {
    const p = await profissional('atrasada', {
      periodoFim: antes(30 * DIA),
      vencimentoAtraso: antes(8 * DIA),
    });
    const t = await profissional('trial', { periodoFim: antes(DIA), comAsaas: false });
    await montar().rodar();
    const linhaP = await linhaAssinatura(p.usuarioId);
    const linhaT = await linhaAssinatura(t.usuarioId);

    const segunda = montar();
    await segunda.rodar();

    expect(segunda.asaas.chamadas).toEqual([]);
    expect(await linhaAssinatura(p.usuarioId)).toEqual(linhaP);
    expect(await linhaAssinatura(t.usuarioId)).toEqual(linhaT);
    expect(await auditoriaDe(p.usuarioId)).toHaveLength(1);
    expect(await auditoriaDe(t.usuarioId)).toHaveLength(1);
    expect(segunda.erros).toEqual([]);
  });
});

describe('no cron', () => {
  it('está registrada no despachante, sem janela (faz tudo o que venceu até agora)', () => {
    const tarefa = TAREFAS.find((t) => t.nome === 'assinaturas');
    expect(tarefa?.janelaMs).toBeNull();
  });

  it('respeita o lote por execução e a seguinte trata o resto', async () => {
    const um = await profissional('trial', { periodoFim: antes(3 * DIA), comAsaas: false });
    const dois = await profissional('trial', { periodoFim: antes(2 * DIA), comAsaas: false });
    const { tarefa } = montar(1);
    const rodar = () =>
      despachar(AGORA, env, {
        tarefas: [tarefa],
        capturarErro: () => {},
        emSegundoPlano: () => {},
      });

    // O despachante passa o seu lote; aqui a tarefa é chamada direto com lote 1.
    await montar(1).rodar();
    expect((await linhaAssinatura(um.usuarioId))!.status).toBe('free');
    expect((await linhaAssinatura(dois.usuarioId))!.status).toBe('trial');

    await rodar();
    expect((await linhaAssinatura(dois.usuarioId))!.status).toBe('free');
  });
});
