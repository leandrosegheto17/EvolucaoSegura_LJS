import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import {
  PROBLEMA_ASSINATURA_ESTADO,
  PROBLEMA_COBRANCA_INDISPONIVEL,
  RESPOSTA_ASSINAR,
} from '@es/contrato/plano';
import { describe, expect, it } from 'vitest';
import { ErroAsaas } from '../../src/integracoes/asaas.ts';
import { sessaoDeTeste } from '../apoio.ts';
import {
  appComAsaas,
  asaasSimulado,
  auditoriaDe,
  type Estado,
  hojeEmSaoPaulo,
  linhaAssinatura,
  pedirPlano,
  semearAssinatura,
} from './plano-apoio.ts';

// T128 / PLANO-05, PLANO-12: POST /api/plano/assinar.
// - Nome e CPF/CNPJ (dígito verificador); inválido responde 422 sem chamar o Asaas.
// - Cria no Asaas o cliente e a assinatura (primeiro vencimento hoje em America/Sao_Paulo) e grava
//   os ids na assinatura do profissional, sem mudar o estado; audita assinatura.solicitada só com
//   os nomes dos campos; responde 201.
// - Só em trial e free; ativa, atrasada e cancelada respondem 409 (decisão do usuário).
// - Asaas fora ou lento responde 503 sem mudar o estado local (PLANO-12).

const CORPO = { nome: 'Ana Souza', cpf_cnpj: '529.982.247-25' };

async function cenario(status: Estado, opcoes: { comAsaas?: boolean } = {}) {
  const sessao = await sessaoDeTeste();
  const ids = await semearAssinatura(sessao.usuarioId, status, opcoes);
  const asaas = asaasSimulado();
  return { sessao, ids, asaas, app: appComAsaas(asaas.cliente) };
}

describe('autenticação', () => {
  it('sem sessão responde 401 e não chama o Asaas', async () => {
    const asaas = asaasSimulado();
    const resposta = await pedirPlano(
      appComAsaas(asaas.cliente),
      '/api/plano/assinar',
      null,
      CORPO,
    );
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('assinar em trial e free (PLANO-05)', () => {
  it.each(['trial', 'free'] as const)(
    'em %s cria cliente e assinatura no Asaas, grava os ids e mantém o estado',
    async (status) => {
      const { sessao, asaas, app } = await cenario(status);
      const antes = await linhaAssinatura(sessao.usuarioId);

      const resposta = await pedirPlano(app, '/api/plano/assinar', sessao, CORPO);

      expect(resposta.status).toBe(201);
      expect(await resposta.json()).toEqual(RESPOSTA_ASSINAR);
      expect(asaas.chamadas.map((c) => c.operacao)).toEqual(['criarCliente', 'criarAssinatura']);
      expect(asaas.chamadas[0]!.dados).toEqual({ nome: 'Ana Souza', cpfCnpj: '52998224725' });
      const assinaturaPedida = asaas.chamadas[1]!.dados as {
        clienteId: string;
        primeiroVencimento: string;
      };
      expect(assinaturaPedida.primeiroVencimento).toBe(hojeEmSaoPaulo());

      const depois = await linhaAssinatura(sessao.usuarioId);
      expect(depois!.asaas_customer_id).toBe(assinaturaPedida.clienteId);
      expect(depois!.asaas_subscription_id).toMatch(/^sub_/);
      expect({
        plano: depois!.plano,
        status: depois!.status,
        periodo_fim: depois!.periodo_fim,
        vencimento_atraso: depois!.vencimento_atraso,
      }).toEqual({
        plano: antes!.plano,
        status,
        periodo_fim: antes!.periodo_fim,
        vencimento_atraso: null,
      });
    },
  );

  it('audita assinatura.solicitada só com os nomes dos campos', async () => {
    const { sessao, app } = await cenario('trial');
    await pedirPlano(app, '/api/plano/assinar', sessao, CORPO);
    expect(await auditoriaDe(sessao.usuarioId)).toEqual([
      {
        ator: sessao.usuarioId,
        acao: 'assinatura.solicitada',
        alvo_tipo: 'conta',
        alvo_id: sessao.usuarioId,
        campos_alterados: ['asaas_customer_id', 'asaas_subscription_id'],
      },
    ]);
  });

  it('não toca a assinatura de outro profissional', async () => {
    const outro = await cenario('trial', { comAsaas: true });
    const antes = await linhaAssinatura(outro.sessao.usuarioId);
    const { sessao, app } = await cenario('free');
    expect((await pedirPlano(app, '/api/plano/assinar', sessao, CORPO)).status).toBe(201);
    expect(await linhaAssinatura(outro.sessao.usuarioId)).toEqual(antes);
  });
});

describe('CPF/CNPJ inválido responde 422', () => {
  it.each([
    { nome: 'Ana Souza', cpf_cnpj: '529.982.247-24' },
    { nome: 'Ana Souza', cpf_cnpj: '11222333000180' },
    { nome: 'Ana Souza', cpf_cnpj: '11111111111' },
  ])('%j', async (corpo) => {
    const { sessao, asaas, app } = await cenario('trial');
    const antes = await linhaAssinatura(sessao.usuarioId);
    const resposta = await pedirPlano(app, '/api/plano/assinar', sessao, corpo);
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['cpf_cnpj'] });
    expect(asaas.chamadas).toEqual([]);
    expect(await linhaAssinatura(sessao.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId)).toEqual([]);
  });
});

describe('estado que não permite assinar responde 409', () => {
  it.each(['ativa', 'atrasada', 'cancelada'] as const)('%s', async (status) => {
    const { sessao, asaas, app } = await cenario(status, { comAsaas: true });
    const antes = await linhaAssinatura(sessao.usuarioId);
    const resposta = await pedirPlano(app, '/api/plano/assinar', sessao, CORPO);
    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual(PROBLEMA_ASSINATURA_ESTADO);
    expect(asaas.chamadas).toEqual([]);
    expect(await linhaAssinatura(sessao.usuarioId)).toEqual(antes);
  });

  it('trial que já tem assinatura no Asaas (PREMISSA)', async () => {
    const { sessao, asaas, app } = await cenario('trial', { comAsaas: true });
    const resposta = await pedirPlano(app, '/api/plano/assinar', sessao, CORPO);
    expect(resposta.status).toBe(409);
    expect(asaas.chamadas).toEqual([]);
  });

  it('profissional sem assinatura (PREMISSA)', async () => {
    const sessao = await sessaoDeTeste();
    const asaas = asaasSimulado();
    const resposta = await pedirPlano(
      appComAsaas(asaas.cliente),
      '/api/plano/assinar',
      sessao,
      CORPO,
    );
    expect(resposta.status).toBe(409);
    expect(asaas.chamadas).toEqual([]);
  });
});

describe('Asaas fora responde 503 sem mudar o estado local (PLANO-12)', () => {
  it.each([
    ['criarCliente', new ErroAsaas('falha', 500)],
    ['criarCliente', new ErroAsaas('tempo_excedido')],
    ['criarAssinatura', new ErroAsaas('rede')],
    ['criarAssinatura', new ErroAsaas('tempo_excedido')],
  ] as const)('falha em %s (%o)', async (operacao, erro) => {
    const { sessao, asaas, app } = await cenario('trial');
    asaas.falharEm(operacao, erro);
    const antes = await linhaAssinatura(sessao.usuarioId);

    const resposta = await pedirPlano(app, '/api/plano/assinar', sessao, CORPO);

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual(PROBLEMA_COBRANCA_INDISPONIVEL);
    expect(await linhaAssinatura(sessao.usuarioId)).toEqual(antes);
    expect(await auditoriaDe(sessao.usuarioId)).toEqual([]);
  });

  it('Asaas sem configuração (chave ou endpoint ausente) também responde 503', async () => {
    const sessao = await sessaoDeTeste();
    await semearAssinatura(sessao.usuarioId, 'trial');
    const { criarApp } = await import('../../src/app.ts');
    const resposta = await pedirPlano(
      criarApp({ capturarErro: () => {} }),
      '/api/plano/assinar',
      sessao,
      CORPO,
    );
    expect(resposta.status).toBe(503);
    expect((await linhaAssinatura(sessao.usuarioId))!.asaas_subscription_id).toBeNull();
  });
});
