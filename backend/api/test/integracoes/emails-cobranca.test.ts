import { describe, expect, it } from 'vitest';
import { mensagemDeCobranca } from '../../src/integracoes/emails-cobranca.ts';

// T138 / PLANO-13: texto dos e-mails transacionais de cobrança. Texto puro em português, sem
// HTML, sem dado clínico e sem dado pessoal além do destinatário; o link leva ao Meu plano.

const URL = 'https://app.evolucaosegura.com.br';
const PARA = 'ana@exemplo.com.br';

describe('mensagemDeCobranca', () => {
  it('cobrança gerada: valor, vencimento e link do Meu plano', () => {
    expect(
      mensagemDeCobranca(
        { tipo: 'cobranca_gerada', vencimento: '2026-10-30', valorCentavos: 1990 },
        PARA,
        URL,
      ),
    ).toEqual({
      para: PARA,
      assunto: 'Nova cobrança do Evolução Segura Pro',
      texto: [
        'A cobrança mensal do Evolução Segura Pro foi gerada.',
        '',
        'Valor: R$ 19,90',
        'Vencimento: 30/10/2026',
        '',
        'Para pagar com Pix, abra Meu plano:',
        `${URL}/app/plano`,
      ].join('\n'),
    });
  });

  it('cobrança gerada sem valor ou vencimento legíveis omite essas linhas', () => {
    const { texto } = mensagemDeCobranca(
      { tipo: 'cobranca_gerada', vencimento: null, valorCentavos: null },
      PARA,
      URL,
    );
    expect(texto).not.toContain('Valor');
    expect(texto).not.toContain('Vencimento');
    expect(texto).toContain(`${URL}/app/plano`);
  });

  it('pagamento confirmado: próxima cobrança', () => {
    expect(
      mensagemDeCobranca(
        { tipo: 'pagamento_confirmado', proximoVencimento: '2026-11-30' },
        PARA,
        URL,
      ),
    ).toEqual({
      para: PARA,
      assunto: 'Pagamento confirmado no Evolução Segura',
      texto: [
        'Recebemos o pagamento do Evolução Segura Pro. Obrigado!',
        '',
        'Seu plano Pro está ativo. Próxima cobrança: 30/11/2026.',
        '',
        'Detalhes em Meu plano:',
        `${URL}/app/plano`,
      ].join('\n'),
    });
  });

  it('cobrança vencida: vencimento e fim da tolerância de 7 dias (D-21)', () => {
    expect(
      mensagemDeCobranca({ tipo: 'cobranca_vencida', vencimento: '2026-10-30' }, PARA, URL),
    ).toEqual({
      para: PARA,
      assunto: 'Cobrança vencida do Evolução Segura Pro',
      texto: [
        'A cobrança do Evolução Segura Pro com vencimento em 30/10/2026 não foi paga.',
        '',
        'Você pode pagar com Pix até 06/11/2026 pelo Meu plano. Depois disso, a conta passa para o plano Free, sem perder nenhum dado.',
        '',
        `${URL}/app/plano`,
      ].join('\n'),
    });
  });

  it('a tolerância atravessa o fim do mês e do ano', () => {
    const { texto } = mensagemDeCobranca(
      { tipo: 'cobranca_vencida', vencimento: '2026-12-28' },
      PARA,
      URL,
    );
    expect(texto).toContain('até 04/01/2027');
  });

  it.each([
    { tipo: 'cobranca_gerada', vencimento: '2026-10-30', valorCentavos: 1990 },
    { tipo: 'pagamento_confirmado', proximoVencimento: '2026-11-30' },
    { tipo: 'cobranca_vencida', vencimento: '2026-10-30' },
  ] as const)('$tipo é texto puro, sem HTML', (email) => {
    const { texto, assunto } = mensagemDeCobranca(email, PARA, URL);
    expect(texto).not.toMatch(/<[a-z!/]/i);
    expect(assunto).not.toMatch(/<[a-z!/]/i);
    expect(texto).not.toContain(PARA);
  });
});
