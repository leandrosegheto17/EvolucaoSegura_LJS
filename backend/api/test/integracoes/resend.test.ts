import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ErroEnvioEmail,
  criarClienteResend,
  reiniciarAlertaDeLimite,
} from '../../src/integracoes/resend.ts';

// T42 / CAD-08, AUTH-08, D-27: cliente do Resend por fetch, só texto puro, com remetente de
// @evolucaosegura.com.br. Falha, 429 e erro de rede viram ErroEnvioEmail (erro tipado) sem o
// e-mail do destinatário na mensagem nem no log; o primeiro 429 vai ao Sentry como alerta (cota
// de 100 por dia do plano gratuito). O fetch é simulado: nenhum teste chama o Resend de verdade.

const DESTINO = 'ana@exemplo.com.br';
const REMETENTE = 'Evolução Segura <nao-responda@evolucaosegura.com.br>';
const mensagem = { para: DESTINO, assunto: 'Confirme seu e-mail', texto: 'Abra o link: x' };

interface Chamada {
  url: string;
  init: RequestInit;
}

function fetchSimulado(resposta: () => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fn = async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return resposta();
  };
  return { fn: fn as typeof fetch, chamadas };
}

function cliente(fetchFn: typeof fetch, alertar = vi.fn()) {
  return {
    alertar,
    resend: criarClienteResend({
      apiKey: 're_teste123',
      remetente: REMETENTE,
      fetch: fetchFn,
      alertar,
    }),
  };
}

const json = (corpo: unknown, status: number) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

async function erroDe(promessa: Promise<unknown>): Promise<ErroEnvioEmail> {
  try {
    await promessa;
  } catch (erro) {
    return erro as ErroEnvioEmail;
  }
  throw new Error('esperava erro');
}

afterEach(() => {
  reiniciarAlertaDeLimite();
  vi.restoreAllMocks();
});

describe('envio', () => {
  it('faz POST em /emails com a chave, o remetente e só texto puro', async () => {
    const { fn, chamadas } = fetchSimulado(() => json({ id: 'email_1' }, 200));
    await cliente(fn).resend.enviar(mensagem);

    expect(chamadas).toHaveLength(1);
    const [{ url, init }] = chamadas as [Chamada];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_teste123');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      from: REMETENTE,
      to: [DESTINO],
      subject: 'Confirme seu e-mail',
      text: 'Abra o link: x',
    });
  });

  it('aceita remetente só com o endereço de evolucaosegura.com.br', () => {
    const { fn } = fetchSimulado(() => json({}, 200));
    expect(() =>
      criarClienteResend({ apiKey: 're_x', remetente: 'oi@evolucaosegura.com.br', fetch: fn }),
    ).not.toThrow();
  });

  it.each([
    'nao-responda@outro.com.br',
    'Evolução <x@evolucaosegura.com.br.golpe.com>',
    'x@sub.evolucaosegura.com.br',
    '',
  ])('recusa remetente fora de @evolucaosegura.com.br: %j', (remetente) => {
    const { fn } = fetchSimulado(() => json({}, 200));
    expect(() => criarClienteResend({ apiKey: 're_x', remetente, fetch: fn })).toThrow('remetente');
  });

  it('recusa chave ausente', () => {
    const { fn } = fetchSimulado(() => json({}, 200));
    expect(() => criarClienteResend({ apiKey: '', remetente: REMETENTE, fetch: fn })).toThrow();
  });
});

describe('erro tipado, sem vazar o e-mail', () => {
  it('429 vira ErroEnvioEmail do tipo limite', async () => {
    const { fn } = fetchSimulado(() => json({ message: `limite para ${DESTINO}` }, 429));
    const erro = await erroDe(cliente(fn).resend.enviar(mensagem));

    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro).toMatchObject({ tipo: 'limite', status: 429 });
  });

  it('resposta 5xx ou 4xx vira ErroEnvioEmail do tipo falha, com o status', async () => {
    for (const status of [500, 422, 401]) {
      const { fn } = fetchSimulado(() => json({ message: `inválido: ${DESTINO}` }, status));
      const erro = await erroDe(cliente(fn).resend.enviar(mensagem));
      expect(erro, String(status)).toBeInstanceOf(ErroEnvioEmail);
      expect(erro, String(status)).toMatchObject({ tipo: 'falha', status });
    }
  });

  it('erro de rede vira ErroEnvioEmail do tipo rede', async () => {
    const { fn } = fetchSimulado(() => {
      throw new TypeError(`falha ao conectar para ${DESTINO}`);
    });
    const erro = await erroDe(cliente(fn).resend.enviar(mensagem));

    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro).toMatchObject({ tipo: 'rede', status: null });
  });

  it('nenhum erro carrega o e-mail (mensagem, pilha, causa ou campos)', async () => {
    const respostas = [
      () => json({ message: `limite para ${DESTINO}` }, 429),
      () => json({ message: `inválido: ${DESTINO}` }, 500),
      () => {
        throw new TypeError(`falha ao conectar para ${DESTINO}`);
      },
    ];
    for (const resposta of respostas) {
      const { fn } = fetchSimulado(resposta);
      const erro = await erroDe(cliente(fn).resend.enviar(mensagem));
      const texto = [erro.message, erro.stack, String(erro.cause), JSON.stringify(erro)].join(' ');
      expect(texto).not.toContain(DESTINO);
    }
  });

  it('não escreve nada no console', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const { fn } = fetchSimulado(() => json({ message: DESTINO }, 500));
    await erroDe(cliente(fn).resend.enviar(mensagem));

    for (const espiao of espioes) expect(espiao).not.toHaveBeenCalled();
  });
});

describe('alerta no Sentry ao primeiro 429', () => {
  it('alerta uma vez no primeiro 429, com erro tipado e sem o e-mail', async () => {
    const { fn } = fetchSimulado(() => json({}, 429));
    const { resend, alertar } = cliente(fn);
    await erroDe(resend.enviar(mensagem));
    await erroDe(resend.enviar(mensagem));

    expect(alertar).toHaveBeenCalledTimes(1);
    const [erro] = alertar.mock.calls[0] as [ErroEnvioEmail];
    expect(erro).toBeInstanceOf(ErroEnvioEmail);
    expect(erro.tipo).toBe('limite');
    expect(JSON.stringify(alertar.mock.calls)).not.toContain(DESTINO);
  });

  it('o alerta vale para a instância do Worker, não para cada cliente criado', async () => {
    const { fn } = fetchSimulado(() => json({}, 429));
    const primeiro = cliente(fn);
    const segundo = cliente(fn);
    await erroDe(primeiro.resend.enviar(mensagem));
    await erroDe(segundo.resend.enviar(mensagem));

    expect(primeiro.alertar).toHaveBeenCalledTimes(1);
    expect(segundo.alertar).not.toHaveBeenCalled();
  });

  it('falha que não é 429 não dispara o alerta de limite', async () => {
    const { fn } = fetchSimulado(() => json({}, 500));
    const { resend, alertar } = cliente(fn);
    await erroDe(resend.enviar(mensagem));

    expect(alertar).not.toHaveBeenCalled();
  });
});
