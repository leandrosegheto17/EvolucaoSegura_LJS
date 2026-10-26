import * as Sentry from '@sentry/cloudflare';
import { waitUntil } from 'cloudflare:workers';
import { Hono } from 'hono';
import { cabecalhos } from './middleware/cabecalhos.ts';
import { limitePorIp } from './middleware/limite.ts';
import { type ClienteEmail, criarClienteResend } from './integracoes/resend.ts';
import { rotasReenviar2fa } from './rotas/auth-2fa-reenviar.ts';
import { rotas2fa } from './rotas/auth-2fa.ts';
import { rotasEntrar } from './rotas/auth-entrar.ts';
import { rotasSair } from './rotas/auth-sair.ts';
import { rotasAnamnese } from './rotas/anamnese.ts';
import { rotasAnamneseRetificar } from './rotas/anamnese-retificar.ts';
import { rotasCadastro } from './rotas/cadastro.ts';
import { rotasConfiguracoes } from './rotas/configuracoes.ts';
import { rotasConfirmar } from './rotas/confirmar.ts';
import { rotasEu } from './rotas/eu.ts';
import { rotasEvolucoes } from './rotas/evolucoes.ts';
import { rotasEvolucoesEditar } from './rotas/evolucoes-editar.ts';
import { rotasModeloAnamnese } from './rotas/modelo-anamnese.ts';
import { rotasPacienteFicha } from './rotas/paciente-ficha.ts';
import { rotasPacientes } from './rotas/pacientes.ts';
import { rotasPacientesAtivo } from './rotas/pacientes-ativo.ts';
import { rotasPerfil } from './rotas/perfil.ts';
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

interface OpcoesApp {
  capturarErro?: (erro: unknown) => void;
  // Os testes trocam o Resend por um cliente simulado.
  email?: (env: Cloudflare.Env) => ClienteEmail;
  // Trabalho depois da resposta (padrão: waitUntil do Worker); os testes guardam e esperam.
  emSegundoPlano?: (tarefa: Promise<unknown>) => void;
}

// Chave ou remetente ausente faz a criação lançar: quem envia trata como falha de envio.
const emailPadrao = (env: Cloudflare.Env): ClienteEmail =>
  criarClienteResend({ apiKey: env.RESEND_API_KEY ?? '', remetente: env.MAIL_FROM ?? '' });

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
