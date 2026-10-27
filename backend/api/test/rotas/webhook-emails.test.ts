import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { ErroEnvioEmail } from '../../src/integracoes/resend.ts';
import { comoAdmin, emailSimulado, emailUnico } from '../apoio.ts';
import { asaasSimulado, type Estado, linhaAssinatura, semearAssinatura } from './plano-apoio.ts';
import { entregar, eventoAsaas } from './webhook-apoio.ts';

// T138 / PLANO-13: o webhook do Asaas envia o e-mail transacional de cada evento de cobrança:
// cobrança gerada (PAYMENT_CREATED), pagamento confirmado (PAYMENT_RECEIVED/CONFIRMED) e cobrança
// vencida (PAYMENT_OVERDUE).
// - Um e-mail por evento, sem repetir em reenvio do webhook (mesmo event_id) nem em outro evento
//   que não muda nada (ex.: PAYMENT_CONFIRMED depois de PAYMENT_RECEIVED do mesmo pagamento).
// - Sai depois de gravar (segundo plano); falha de envio vai ao Sentry e não desfaz a mudança de
//   estado. Erro de processamento (500) não envia nada.
// - Texto puro em português, sem dado clínico.

const PROXIMO_VENCIMENTO = '2026-11-30';

function montar() {
  const asaas = asaasSimulado({ proximoVencimento: PROXIMO_VENCIMENTO });
  const email = emailSimulado();
  const avisos: unknown[] = [];
  const pendentes: Promise<unknown>[] = [];
  const app = criarApp({
    capturarErro: (e) => avisos.push(e),
    asaas: () => asaas.cliente,
    email: () => email.cliente,
    emSegundoPlano: (p) => void pendentes.push(p),
  });
  const entregarEEsperar = async (corpo: unknown) => {
    const resposta = await entregar(app, corpo);
    await Promise.all(pendentes);
    return resposta;
  };
  return { app, asaas, email, avisos, entregar: entregarEEsperar };
}

// Profissional com e-mail próprio, um paciente (dado clínico que nunca vai no e-mail) e a
// assinatura no estado pedido.
async function assinante(status: Estado, opcoes: { periodoFim?: string } = {}) {
  const endereco = emailUnico('cobranca');
  const [u] = await comoAdmin<{ id: string }>(
    `insert into usuario (email, nome, confirmado_em) values ($1, 'Ana Souza', now()) returning id`,
    [endereco],
  );
  await comoAdmin(`insert into paciente (usuario_id, nome) values ($1, 'Paciente Sigiloso')`, [
    u!.id,
  ]);
  const ids = await semearAssinatura(u!.id, status, { comAsaas: true, ...opcoes });
  return { usuarioId: u!.id, email: endereco, assinatura: ids.assinatura!, cliente: ids.cliente! };
}

type A = Awaited<ReturnType<typeof assinante>>;
const evento = (event: string, a: A, dueDate = '2026-10-30'): ReturnType<typeof eventoAsaas> =>
  eventoAsaas(event, { subscription: a.assinatura, customer: a.cliente, dueDate });

describe('um e-mail por evento (PLANO-13)', () => {
  it('cobrança gerada envia um e-mail; reenvio não repete', async () => {
    const m = montar();
    const a = await assinante('ativa');
    const e = evento('PAYMENT_CREATED', a);

    expect((await m.entregar(e)).status).toBe(200);
    expect((await m.entregar(e)).status).toBe(200);

    expect(m.email.enviadas).toEqual([
      expect.objectContaining({ para: a.email, assunto: 'Nova cobrança do Evolução Segura Pro' }),
    ]);
    expect(m.email.enviadas[0]!.texto).toContain('Vencimento: 30/10/2026');
    expect(m.email.enviadas[0]!.texto).toContain('R$ 19,90');
    expect(m.avisos).toEqual([]);
  });

  it('pagamento confirmado envia um e-mail; reenvio e PAYMENT_CONFIRMED do mesmo pagamento não', async () => {
    const m = montar();
    const a = await assinante('trial');
    const recebido = evento('PAYMENT_RECEIVED', a);

    await m.entregar(recebido);
    await m.entregar(recebido);
    await m.entregar({ ...evento('PAYMENT_CONFIRMED', a), payment: recebido.payment });

    expect(m.email.enviadas).toEqual([
      expect.objectContaining({
        para: a.email,
        assunto: 'Pagamento confirmado no Evolução Segura',
      }),
    ]);
    expect(m.email.enviadas[0]!.texto).toContain('Próxima cobrança: 30/11/2026.');
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({ status: 'ativa' });
  });

  it('renovação de ativa (periodo_fim adiantado) envia o e-mail de pagamento', async () => {
    const m = montar();
    const a = await assinante('ativa', { periodoFim: '2026-11-01T03:00:00.000Z' });

    await m.entregar(evento('PAYMENT_RECEIVED', a));

    expect(m.email.enviadas.map((e) => e.assunto)).toEqual([
      'Pagamento confirmado no Evolução Segura',
    ]);
  });

  it('cobrança vencida envia um e-mail; nova vencida em atrasada não repete', async () => {
    const m = montar();
    const a = await assinante('ativa');

    await m.entregar(evento('PAYMENT_OVERDUE', a));
    await m.entregar(evento('PAYMENT_OVERDUE', a, '2026-11-30'));

    expect(m.email.enviadas).toEqual([
      expect.objectContaining({
        para: a.email,
        assunto: 'Cobrança vencida do Evolução Segura Pro',
      }),
    ]);
    expect(m.email.enviadas[0]!.texto).toContain('vencimento em 30/10/2026');
    expect(m.email.enviadas[0]!.texto).toContain('até 06/11/2026');
  });

  it('transição inválida (vencida em trial) não envia e-mail', async () => {
    const m = montar();
    const a = await assinante('trial');

    await m.entregar(evento('PAYMENT_OVERDUE', a));

    expect(m.email.enviadas).toEqual([]);
  });
});

describe('falhas', () => {
  it('falha de envio não desfaz a mudança de estado e vai ao Sentry', async () => {
    const m = montar();
    const falha = new ErroEnvioEmail('falha', 500);
    m.email.falhar(falha);
    const a = await assinante('ativa');

    const resposta = await m.entregar(evento('PAYMENT_OVERDUE', a));

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({ status: 'atrasada' });
    expect(m.avisos).toEqual([falha]);
  });

  it('erro de processamento (assinatura não achada, 500) não envia e-mail', async () => {
    const m = montar();
    const e = eventoAsaas('PAYMENT_CREATED', {
      subscription: `sub_inexistente_${crypto.randomUUID().slice(0, 8)}`,
      customer: `cus_inexistente_${crypto.randomUUID().slice(0, 8)}`,
    });

    const resposta = await m.entregar(e);

    expect(resposta.status).toBe(500);
    expect(m.email.enviadas).toEqual([]);
  });

  it('sem o Resend configurado, o webhook processa sem tentar enviar', async () => {
    const avisos: unknown[] = [];
    const asaas = asaasSimulado({ proximoVencimento: PROXIMO_VENCIMENTO });
    const app = criarApp({ capturarErro: (e) => avisos.push(e), asaas: () => asaas.cliente });
    const a = await assinante('ativa');

    const resposta = await entregar(app, evento('PAYMENT_OVERDUE', a));

    expect(resposta.status).toBe(200);
    expect(await linhaAssinatura(a.usuarioId)).toMatchObject({ status: 'atrasada' });
    expect(avisos).toEqual([]);
  });
});

describe('conteúdo', () => {
  it('nenhum e-mail leva dado clínico, nome do paciente nem ids do Asaas', async () => {
    const m = montar();
    const a = await assinante('ativa');

    await m.entregar(evento('PAYMENT_CREATED', a));
    await m.entregar(evento('PAYMENT_OVERDUE', a));
    await m.entregar(evento('PAYMENT_RECEIVED', a));

    expect(m.email.enviadas).toHaveLength(3);
    for (const { texto, assunto } of m.email.enviadas) {
      for (const proibido of ['Paciente Sigiloso', a.assinatura, a.cliente, a.email]) {
        expect(texto).not.toContain(proibido);
        expect(assunto).not.toContain(proibido);
      }
      expect(texto).not.toMatch(/<[a-z!/]/i);
    }
  });
});
