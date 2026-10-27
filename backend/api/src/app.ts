import * as Sentry from '@sentry/cloudflare';
import { waitUntil } from 'cloudflare:workers';
import { Hono } from 'hono';
import { cabecalhos } from './middleware/cabecalhos.ts';
import { limitePorIp } from './middleware/limite.ts';
import { type ClienteAsaas, criarClienteAsaas } from './integracoes/asaas.ts';
import { emailCobrancaPadrao } from './integracoes/emails-cobranca.ts';
import { type ClienteEmail, criarClienteResend } from './integracoes/resend.ts';
import { rotasReenviar2fa } from './rotas/auth-2fa-reenviar.ts';
import { rotas2fa } from './rotas/auth-2fa.ts';
import { rotasEntrar } from './rotas/auth-entrar.ts';
import { rotasSair } from './rotas/auth-sair.ts';
import { rotasAnamnese } from './rotas/anamnese.ts';
import { rotasAnamneseRetificar } from './rotas/anamnese-retificar.ts';
import { rotasAuditoria } from './rotas/auditoria.ts';
import { rotasCadastro } from './rotas/cadastro.ts';
import { rotasConfiguracoes } from './rotas/configuracoes.ts';
import { rotasConfirmar } from './rotas/confirmar.ts';
import { rotasDebitos } from './rotas/debitos.ts';
import { rotasEu } from './rotas/eu.ts';
import { rotasInicio } from './rotas/inicio.ts';
import { rotasEvolucoes } from './rotas/evolucoes.ts';
import { rotasEvolucoesEditar } from './rotas/evolucoes-editar.ts';
import { rotasEvolucoesRetificar } from './rotas/evolucoes-retificar.ts';
import { rotasExportarProntuario } from './rotas/exportar-prontuario.ts';
import { rotasExportarTudo } from './rotas/exportar-tudo.ts';
import { rotasModeloAnamnese } from './rotas/modelo-anamnese.ts';
import { rotasModelosTexto } from './rotas/modelos-texto.ts';
import { rotasPacienteFicha } from './rotas/paciente-ficha.ts';
import { rotasPacientes } from './rotas/pacientes.ts';
import { rotasPacientesAtivo } from './rotas/pacientes-ativo.ts';
import { rotasPagamentos } from './rotas/pagamentos.ts';
import { rotasPerfil } from './rotas/perfil.ts';
import { rotasPlano } from './rotas/plano.ts';
import { rotasPlanoAssinar } from './rotas/plano-assinar.ts';
import { rotasPlanoCancelar } from './rotas/plano-cancelar.ts';
import { rotasPrecos } from './rotas/precos.ts';
import { rotasPush } from './rotas/push.ts';
import { rotasRascunhos } from './rotas/rascunhos.ts';
import { health } from './rotas/health.ts';
import { rotasRecuperar } from './rotas/recuperar.ts';
import { rotasRedefinir } from './rotas/redefinir.ts';
import { rotasSeries } from './rotas/series.ts';
import { rotasSeriesAlterar } from './rotas/series-alterar.ts';
import { rotasSeriesCancelar } from './rotas/series-cancelar.ts';
import { rotasSessoes } from './rotas/sessoes.ts';
import { rotasSessoesEditar } from './rotas/sessoes-editar.ts';
import { rotasSessoesLista } from './rotas/sessoes-lista.ts';
import { rotasSessoesStatus } from './rotas/sessoes-status.ts';
import { rotasTcle } from './rotas/tcle.ts';
import { processarCobrancaGerada } from './rotas/webhook-gerada.ts';
import { processarPagamento } from './rotas/webhook-pago.ts';
import { processarVencida } from './rotas/webhook-vencida.ts';
import { type ProcessadorWebhook, rotasWebhookAsaas } from './rotas/webhook-asaas.ts';

interface OpcoesApp {
  capturarErro?: (erro: unknown) => void;
  // Os testes trocam o Resend por um cliente simulado.
  email?: (env: Cloudflare.Env) => ClienteEmail;
  // Trabalho depois da resposta (padrão: waitUntil do Worker); os testes guardam e esperam.
  emSegundoPlano?: (tarefa: Promise<unknown>) => void;
  // Os testes trocam o Asaas por um cliente simulado.
  asaas?: (env: Cloudflare.Env) => ClienteAsaas;
  // Os testes trocam os processadores do webhook do Asaas por evento.
  processadoresWebhook?: Readonly<Record<string, ProcessadorWebhook>>;
}

// PLANO-08, PLANO-09: processadores do webhook do Asaas por tipo de evento.
// O spike S3 viu PAYMENT_RECEIVED; PAYMENT_CONFIRMED é aceito por segurança (Pix real).
// PLANO-13: PAYMENT_CREATED só pede o e-mail de cobrança gerada.
const PROCESSADORES_WEBHOOK: Readonly<Record<string, ProcessadorWebhook>> = {
  PAYMENT_CREATED: processarCobrancaGerada,
  PAYMENT_RECEIVED: processarPagamento,
  PAYMENT_CONFIRMED: processarPagamento,
  PAYMENT_OVERDUE: processarVencida,
};

// Chave ou remetente ausente faz a criação lançar: quem envia trata como falha de envio.
const emailPadrao = (env: Cloudflare.Env): ClienteEmail =>
  criarClienteResend({ apiKey: env.RESEND_API_KEY ?? '', remetente: env.MAIL_FROM ?? '' });

// Chave ou endpoint ausente faz a criação lançar: a rota trata como Asaas indisponível (503).
const asaasPadrao = (env: Cloudflare.Env): ClienteAsaas =>
  criarClienteAsaas({ apiKey: env.ASAAS_API_KEY ?? '', baseUrl: env.ASAAS_BASE_URL ?? '' });

export function criarApp(opcoes: OpcoesApp = {}): Hono<{ Bindings: Cloudflare.Env }> {
  const capturarErro = opcoes.capturarErro ?? ((erro) => Sentry.captureException(erro));
  const app = new Hono<{ Bindings: Cloudflare.Env }>();
  // Pipeline (design): cabeçalhos e rate limit valem para tudo; sessão, CSRF e transação, só nas
  // rotas autenticadas (middleware/autenticada.ts). Rotas públicas pulam sessão e CSRF.
  app.use('*', cabecalhos);
  app.use('/api/*', limitePorIp);
  app.route('/api', health);
  app.route('/api', rotasCadastro({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotasConfirmar);
  app.route('/api', rotasEntrar({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route('/api', rotas2fa);
  app.route('/api', rotasReenviar2fa({ email: opcoes.email ?? emailPadrao, capturarErro }));
  app.route(
    '/api',
    rotasRecuperar({
      email: opcoes.email ?? emailPadrao,
      capturarErro,
      emSegundoPlano: opcoes.emSegundoPlano ?? waitUntil,
    }),
  );
  app.route('/api', rotasRedefinir);
  app.route(
    '/api',
    rotasWebhookAsaas({
      asaas: opcoes.asaas ?? asaasPadrao,
      capturarErro,
      processadores: opcoes.processadoresWebhook ?? PROCESSADORES_WEBHOOK,
      email: opcoes.email ?? emailCobrancaPadrao,
      emSegundoPlano: opcoes.emSegundoPlano ?? waitUntil,
    }),
  );
  // Autenticadas: cada rota monta a lista `autenticada` (sessão, CSRF, transação).
  app.route('/api', rotasSair);
  app.route('/api', rotasEu);
  app.route('/api', rotasPerfil);
  app.route('/api', rotasConfiguracoes);
  app.route('/api', rotasPacientes);
  app.route('/api', rotasPacientesAtivo);
  app.route('/api', rotasTcle);
  app.route('/api', rotasPacienteFicha);
  app.route('/api', rotasSessoes);
  app.route('/api', rotasSessoesLista);
  app.route('/api', rotasSessoesEditar);
  app.route('/api', rotasSessoesStatus);
  app.route('/api', rotasSeries);
  app.route('/api', rotasSeriesAlterar);
  app.route('/api', rotasSeriesCancelar);
  app.route('/api', rotasModeloAnamnese);
  app.route('/api', rotasAnamnese);
  app.route('/api', rotasAnamneseRetificar);
  app.route('/api', rotasEvolucoes);
  app.route('/api', rotasEvolucoesEditar);
  app.route('/api', rotasEvolucoesRetificar);
  app.route('/api', rotasRascunhos);
  app.route('/api', rotasModelosTexto);
  app.route('/api', rotasPrecos);
  app.route('/api', rotasPagamentos);
  app.route('/api', rotasDebitos);
  app.route('/api', rotasInicio);
  app.route('/api', rotasAuditoria);
  app.route('/api', rotasExportarProntuario);
  app.route('/api', rotasExportarTudo);
  app.route('/api', rotasPlano({ asaas: opcoes.asaas ?? asaasPadrao, capturarErro }));
  app.route('/api', rotasPlanoAssinar({ asaas: opcoes.asaas ?? asaasPadrao, capturarErro }));
  app.route('/api', rotasPlanoCancelar({ asaas: opcoes.asaas ?? asaasPadrao, capturarErro }));
  app.route('/api', rotasPush);
  // Erro não tratado: vai ao Sentry e o usuário recebe um 500 genérico, sem detalhe do erro.
  app.onError((erro, c) => {
    capturarErro(erro);
    return c.json(
      { tipo: 'about:blank', titulo: 'Erro interno', status: 500, codigo: 'erro_interno' },
      500,
      { 'Content-Type': 'application/problem+json' },
    );
  });
  return app;
}
