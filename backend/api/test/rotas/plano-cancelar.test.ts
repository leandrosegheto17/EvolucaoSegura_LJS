import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_ASSINATURA_ESTADO, PROBLEMA_COBRANCA_INDISPONIVEL } from '@es/contrato/plano';
import { estadoPorTempo, proLiberado } from '@es/dominio/plano/assinatura';
import { describe, expect, it } from 'vitest';
import { ErroAsaas } from '../../src/integracoes/asaas.ts';
import { sessaoDeTeste } from '../apoio.ts';
import {
  appComAsaas,
  asaasSimulado,
  auditoriaDe,
  type Estado,
  linhaAssinatura,
  pedirPlano,
  semearAssinatura,
} from './plano-apoio.ts';

// T132 / PLANO-11, PLANO-12: POST /api/plano/cancelar.
// - Cancela no Asaas, muda para cancelada e mantém o Pro até periodo_fim; depois dele o cron leva
//   a free (T137, pela regra estadoPorTempo do domínio).
// - Só ativa cancela; os demais estados respondem 409 (decisão do usuário, 2026-10-27).
// - Asaas fora ou lento responde 503 sem mudar o estado (PLANO-12).
// - Audita assinatura.cancelada só com o nome do campo.

const PERIODO_FIM = '2026-11-10T03:00:00.000Z';

async function cenario(status: Estado) {
  const sessao = await sessaoDeTeste();
  const ids = await semearAssinatura(sessao.usuarioId, status, {
    comAsaas: true,
    periodoFim: PERIODO_FIM,
  });
  const asaas = asaasSimulado();
  return { sessao, ids, asaas, app: appComAsaas(asaas.cliente) };
}

describe('autenticação', () => {
  it('sem sessão responde 401 e não chama o Asaas', async () => {
    const asaas = asaasSimulado();
    const resposta = await pedirPlano(appComAsaas(asaas.cliente), '/api/plano/cancelar', null);
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('cancelar em ativa (PLANO-11)', () => {
  it('cancela no Asaas, fica cancelada e mantém periodo_fim e o plano pro', async () => {
    const { sessao, ids, asaas, app } = await cenario('ativa');

    const resposta = await pedirPlano(app, '/api/plano/cancelar', sessao);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({ status: 'cancelada', periodo_fim: PERIODO_FIM });
    expect(asaas.chamadas).toEqual([{ operacao: 'cancelarAssinatura', dados: ids.assinatura }]);
    expect(await linhaAssinatura(sessao.usuarioId)).toMatchObject({
      plano: 'pro',
      status: 'cancelada',
      periodo_fim: new Date(PERIODO_FIM),
      vencimento_atraso: null,
    });
  });

  it('o Pro segue até periodo_fim e depois dele a regra do cron leva a free', async () => {
    const { sessao, app } = await cenario('ativa');
    await pedirPlano(app, '/api/plano/cancelar', sessao);
    const linha = (await linhaAssinatura(sessao.usuarioId))! as Parameters<
      typeof estadoPorTempo
    >[0];
    const fim = new Date(PERIODO_FIM).getTime();

    expect(proLiberado(linha, new Date(fim - 1))).toBe(true);
    expect(estadoPorTempo(linha, new Date(fim - 1))).toBe('cancelada');
    expect(estadoPorTempo(linha, new Date(fim))).toBe('free');
  });

  it('audita assinatura.cancelada só com o nome do campo', async () => {
    const { sessao, app } = await cenario('ativa');
    await pedirPlano(app, '/api/plano/cancelar', sessao);
    expect(await auditoriaDe(sessao.usuarioId)).toEqual([
      {
        ator: sessao.usuarioId,
        acao: 'assinatura.cancelada',
        alvo_tipo: 'conta',
        alvo_id: sessao.usuarioId,
        campos_alterados: ['status'],
      },
    ]);
  });

  it('não toca a assinatura de outro profissional', async () => {
    const outro = await cenario('ativa');
    const antes = await linhaAssinatura(outro.sessao.usuarioId);
    const { sessao, app } = await cenario('ativa');
    expect((await pedirPlano(app, '/api/plano/cancelar', sessao)).status).toBe(200);
    expect(await linhaAssinatura(outro.sessao.usuarioId)).toEqual(antes);
  });
});

describe('estado que não permite cancelar responde 409', () => {
  it.each(['trial', 'atrasada', 'cancelada', 'free'] as const)('%s', async (status) => {
    const { sessao, asaas, app } = await cenario(status);
    const antes = await linhaAssinatura(sessao.usuarioId);
    const resposta = await pedirPlano(app, '/api/plano/cancelar', sessao);
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(PROBLEMA_ASSINATURA_ESTADO);
    expect(asaas.chamadas).toEqual([]);
    expect(await linhaAssinatura(sessao.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId)).toEqual([]);
  });

  it('profissional sem assinatura (PREMISSA)', async () => {
    const sessao = await sessaoDeTeste();
    const asaas = asaasSimulado();
    const resposta = await pedirPlano(appComAsaas(asaas.cliente), '/api/plano/cancelar', sessao);
    expect(resposta.status).toBe(409);
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('Asaas fora responde 503 sem mudar o estado (PLANO-12)', () => {
  it.each([new ErroAsaas('falha', 500), new ErroAsaas('tempo_excedido'), new ErroAsaas('rede')])(
    '%o',
    async (erro) => {
      const { sessao, asaas, app } = await cenario('ativa');
      asaas.falharEm('cancelarAssinatura', erro);
      const antes = await linhaAssinatura(sessao.usuarioId);

      const resposta = await pedirPlano(app, '/api/plano/cancelar', sessao);

      expect(resposta.status).toBe(503);
      expect(await resposta.json()).toEqual(PROBLEMA_COBRANCA_INDISPONIVEL);
      expect(await linhaAssinatura(sessao.usuarioId)).toEqual(antes);
      expect(await auditoriaDe(sessao.usuarioId)).toEqual([]);
    },
  );
});
