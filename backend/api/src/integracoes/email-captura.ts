import type { ClienteEmail } from './resend.ts';

// OPS-05 (T158): captura de e-mail só para o e2e. Com E2E_EMAIL_CAPTURA_URL definida (o schema só
// aceita localhost), o Worker entrega a mensagem a um coletor local em vez de chamar o Resend, e o
// teste lê o link ou o código ali. Em produção a variável não existe.

export function criarClienteCaptura(url: string, fetchFn: typeof fetch = fetch): ClienteEmail {
  return {
    async enviar(mensagem) {
      const resposta = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mensagem),
      });
      await resposta.body?.cancel();
      if (!resposta.ok) throw new Error(`Coletor de e-mail recusou (HTTP ${resposta.status})`);
    },
  };
}
