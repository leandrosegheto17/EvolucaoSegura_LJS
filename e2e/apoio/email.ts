import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { URL_COLETOR } from './config.ts';

// OPS-05: leitura dos e-mails capturados pelo coletor (apoio/coletor-email.ts).

export interface EmailCapturado {
  para: string;
  assunto: string;
  texto: string;
}

// Espera chegar um e-mail para o endereço cujo assunto contenha `assunto` e devolve o mais novo.
export async function esperarEmail(
  request: APIRequestContext,
  para: string,
  assunto: string,
): Promise<EmailCapturado> {
  let achado: EmailCapturado | undefined;
  await expect
    .poll(
      async () => {
        const resposta = await request.get(`${URL_COLETOR}/emails`, { params: { para } });
        const lista = (await resposta.json()) as EmailCapturado[];
        achado = lista.filter((email) => email.assunto.includes(assunto)).at(-1);
        return achado !== undefined;
      },
      { message: `e-mail "${assunto}" para ${para}`, timeout: 15_000 },
    )
    .toBe(true);
  return achado!;
}

export function linkDoEmail(email: EmailCapturado): string {
  const link = /https?:\/\/\S+/.exec(email.texto);
  if (!link) throw new Error('e-mail sem link');
  return link[0];
}

export function codigoDoEmail(email: EmailCapturado): string {
  const codigo = /\b(\d{6})\b/.exec(email.texto);
  if (!codigo) throw new Error('e-mail sem código de 6 dígitos');
  return codigo[1]!;
}
