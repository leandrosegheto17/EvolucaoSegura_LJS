import { describe, expect, it } from 'vitest';
import { ErroAsaas, criarClienteAsaas } from '../../src/integracoes/asaas.ts';

// T127 / PLANO-05, PLANO-12: cliente do Asaas. Cria o cliente e a assinatura mensal de 1990
// centavos por Pix, lista as cobranças, busca o QR e cancela, com tempo limite. O endpoint
// (sandbox ou produção) vem da variável. Falha, erro de rede, resposta fora do formato e tempo
// excedido viram ErroAsaas. O fetch é simulado com os formatos do spike S3 (dados fictícios):
// nenhum teste chama o Asaas de verdade.

const SANDBOX = 'https://api-sandbox.asaas.com/v3';
const PRODUCAO = 'https://api.asaas.com/v3';
const CHAVE = '$aact_teste_ficticia';

interface Chamada {
  url: string;
  init: RequestInit;
}

function fetchSimulado(resposta: (url: string) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const fn = async (url: RequestInfo | URL, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return resposta(String(url));
  };
  return { fn: fn as typeof fetch, chamadas };
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

const cliente = (fn: typeof fetch, baseUrl: string = SANDBOX, tempoLimiteMs?: number) =>
  criarClienteAsaas({
    apiKey: CHAVE,
    baseUrl,
    fetch: fn,
    ...(tempoLimiteMs ? { tempoLimiteMs } : {}),
  });

async function erroDe(promessa: Promise<unknown>): Promise<ErroAsaas> {
  try {
    await promessa;
  } catch (erro) {
    return erro as ErroAsaas;
  }
  throw new Error('esperava erro');
}

// Formatos do spike S3 (resultado.md, seções 1 a 3).
const CLIENTE_CRIADO = {
  object: 'customer',
  id: 'cus_000009700882',
  name: 'Ana Souza',
  cpfCnpj: '12345678909',
  personType: 'FISICA',
  email: null,
};
const ASSINATURA_CRIADA = {
  object: 'subscription',
  id: 'sub_58a47vh52dgm4omd',
  customer: 'cus_000009700882',
  billingType: 'PIX',
  value: 19.9,
  cycle: 'MONTHLY',
  nextDueDate: '2026-11-30',
  status: 'ACTIVE',
};
const COBRANCAS = {
  object: 'list',
  hasMore: false,
  totalCount: 1,
  data: [
    {
      object: 'payment',
      id: 'pay_ykskkgoe37uu9og9',
      customer: 'cus_000009700882',
      subscription: 'sub_58a47vh52dgm4omd',
      value: 19.9,
      netValue: 18.91,
      billingType: 'PIX',
      status: 'PENDING',
      dueDate: '2026-10-30',
      invoiceUrl: 'https://sandbox.asaas.com/i/ficticio',
    },
  ],
};
const QR = {
  success: true,
  encodedImage: 'iVBORw0KGgoAAAANSUhEUgAA',
  payload: '00020101021226820014br.gov.bcb.pix',
  expirationDate: '2027-10-30 23:59:59',
  description: null,
};

describe('endpoint por variável', () => {
  it('usa o sandbox quando ASAAS_BASE_URL é o do sandbox', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(CLIENTE_CRIADO));
    await cliente(fn, SANDBOX).criarCliente({ nome: 'Ana Souza', cpfCnpj: '12345678909' });
    expect(chamadas.map((c) => c.url)).toEqual([`${SANDBOX}/customers`]);
  });

  it('usa a produção quando ASAAS_BASE_URL é o da produção', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(CLIENTE_CRIADO));
    await cliente(fn, PRODUCAO).criarCliente({ nome: 'Ana Souza', cpfCnpj: '12345678909' });
    expect(chamadas.map((c) => c.url)).toEqual([`${PRODUCAO}/customers`]);
  });

  it('recusa endpoint fora dos dois e chave ausente', () => {
    const { fn } = fetchSimulado(() => json({}));
    expect(() => cliente(fn, 'https://exemplo.com/v3')).toThrow();
    expect(() => criarClienteAsaas({ apiKey: '', baseUrl: SANDBOX, fetch: fn })).toThrow();
  });
});

describe('operações (formatos do spike S3)', () => {
  it('cria o cliente com nome e CPF/CNPJ, com access_token e User-Agent', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(CLIENTE_CRIADO));
    const criado = await cliente(fn).criarCliente({ nome: 'Ana Souza', cpfCnpj: '12345678909' });

    expect(criado).toEqual({ id: 'cus_000009700882' });
    const [{ init }] = chamadas as [Chamada];
    const cabecalhos = new Headers(init.headers);
    expect(init.method).toBe('POST');
    expect(cabecalhos.get('access_token')).toBe(CHAVE);
    expect(cabecalhos.get('user-agent')).toMatch(/\S+/);
    expect(cabecalhos.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Ana Souza', cpfCnpj: '12345678909' });
  });

  it('cria a assinatura mensal de 1990 centavos por Pix', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(ASSINATURA_CRIADA));
    const criada = await cliente(fn).criarAssinatura({
      clienteId: 'cus_000009700882',
      primeiroVencimento: '2026-10-30',
    });

    expect(criada).toEqual({ id: 'sub_58a47vh52dgm4omd', proximoVencimento: '2026-11-30' });
    const [{ url, init }] = chamadas as [Chamada];
    expect(url).toBe(`${SANDBOX}/subscriptions`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      customer: 'cus_000009700882',
      billingType: 'PIX',
      value: 19.9,
      cycle: 'MONTHLY',
      nextDueDate: '2026-10-30',
    });
  });

  it('consulta a assinatura e devolve o próximo vencimento (nextDueDate)', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(ASSINATURA_CRIADA));
    const assinatura = await cliente(fn).obterAssinatura('sub_58a47vh52dgm4omd');

    expect(assinatura).toEqual({ id: 'sub_58a47vh52dgm4omd', proximoVencimento: '2026-11-30' });
    expect(chamadas.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', `${SANDBOX}/subscriptions/sub_58a47vh52dgm4omd`],
    ]);
  });

  it('lista as cobranças da assinatura em centavos', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(COBRANCAS));
    const cobrancas = await cliente(fn).listarCobrancas('sub_58a47vh52dgm4omd');

    expect(cobrancas).toEqual([
      {
        id: 'pay_ykskkgoe37uu9og9',
        status: 'PENDING',
        vencimento: '2026-10-30',
        valorCentavos: 1990,
      },
    ]);
    expect(chamadas.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', `${SANDBOX}/subscriptions/sub_58a47vh52dgm4omd/payments`],
    ]);
  });

  it('busca o QR Code Pix da cobrança', async () => {
    const { fn, chamadas } = fetchSimulado(() => json(QR));
    const qr = await cliente(fn).buscarQrPix('pay_ykskkgoe37uu9og9');

    expect(qr).toEqual({
      imagemPngBase64: 'iVBORw0KGgoAAAANSUhEUgAA',
      copiaECola: '00020101021226820014br.gov.bcb.pix',
      expiraEm: '2027-10-30 23:59:59',
    });
    expect(chamadas.map((c) => [c.init.method, c.url])).toEqual([
      ['GET', `${SANDBOX}/payments/pay_ykskkgoe37uu9og9/pixQrCode`],
    ]);
  });

  it('cancela a assinatura', async () => {
    const { fn, chamadas } = fetchSimulado(() =>
      json({ deleted: true, id: 'sub_58a47vh52dgm4omd' }),
    );
    await expect(cliente(fn).cancelarAssinatura('sub_58a47vh52dgm4omd')).resolves.toBeUndefined();
    expect(chamadas.map((c) => [c.init.method, c.url])).toEqual([
      ['DELETE', `${SANDBOX}/subscriptions/sub_58a47vh52dgm4omd`],
    ]);
  });
});

describe('falha e tempo excedido viram erro tipado (PLANO-12)', () => {
  it('HTTP 400 do Asaas vira falha com o status e os códigos, sem a descrição', async () => {
    const { fn } = fetchSimulado(() =>
      json(
        {
          errors: [
            { code: 'invalid_object', description: 'O CPF/CNPJ 12345678900 informado é inválido.' },
          ],
        },
        400,
      ),
    );
    const erro = await erroDe(
      cliente(fn).criarCliente({ nome: 'Ana Souza', cpfCnpj: '12345678900' }),
    );
    expect(erro).toBeInstanceOf(ErroAsaas);
    expect([erro.tipo, erro.status, erro.codigos]).toEqual(['falha', 400, ['invalid_object']]);
    expect(erro.message).not.toContain('12345678900');
    expect(erro.message).not.toContain('Ana Souza');
  });

  it('HTTP 5xx vira falha', async () => {
    const { fn } = fetchSimulado(() => new Response('erro', { status: 503 }));
    const erro = await erroDe(cliente(fn).cancelarAssinatura('sub_x'));
    expect([erro.tipo, erro.status]).toEqual(['falha', 503]);
  });

  it('erro de rede vira rede', async () => {
    const fn = (async () => {
      throw new TypeError('fetch failed: api-sandbox.asaas.com');
    }) as typeof fetch;
    const erro = await erroDe(cliente(fn).listarCobrancas('sub_x'));
    expect(erro).toBeInstanceOf(ErroAsaas);
    expect(erro.tipo).toBe('rede');
  });

  it('resposta 200 fora do formato vira resposta_invalida', async () => {
    const { fn } = fetchSimulado(() => json({ object: 'customer' }));
    const erro = await erroDe(cliente(fn).criarCliente({ nome: 'Ana', cpfCnpj: '12345678909' }));
    expect(erro.tipo).toBe('resposta_invalida');
  });

  it('cancelamento sem deleted: true vira resposta_invalida', async () => {
    const { fn } = fetchSimulado(() => json({ deleted: false, id: 'sub_x' }));
    expect((await erroDe(cliente(fn).cancelarAssinatura('sub_x'))).tipo).toBe('resposta_invalida');
  });

  it('Asaas que não responde dentro do tempo limite vira tempo_excedido', async () => {
    // Responde só quando a requisição é abortada (como o fetch real faz).
    const fn = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, rejeitar) => {
        init?.signal?.addEventListener('abort', () =>
          rejeitar(new DOMException('aborted', 'AbortError')),
        );
      })) as typeof fetch;
    const inicio = Date.now();
    const erro = await erroDe(
      cliente(fn, SANDBOX, 50).criarAssinatura({
        clienteId: 'cus_x',
        primeiroVencimento: '2026-10-30',
      }),
    );
    expect(erro).toBeInstanceOf(ErroAsaas);
    expect(erro.tipo).toBe('tempo_excedido');
    expect(Date.now() - inicio).toBeLessThan(2_000);
  });
});
