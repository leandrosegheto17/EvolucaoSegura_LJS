// Ponto de entrada provisório do Worker; a API Hono entra na T17.
export default {
  fetch(): Response {
    return new Response('Evolução Segura');
  },
} satisfies ExportedHandler<Cloudflare.Env>;
