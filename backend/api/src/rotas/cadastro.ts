import { RESPOSTA_CADASTRO, esquemaCadastro } from '@es/contrato/identidade';
import { avaliarSenha } from '@es/dominio/identidade/politica-senha';
import { Hono } from 'hono';
import { comTransacao } from '../db.ts';
import { lerCorpo, responderProblema } from '../http.ts';
import type { ClienteEmail, MensagemEmail } from '../integracoes/resend.ts';
import {
  conferirSenha,
  criarOuTravarUsuario,
  criarTokenEmail,
  definirSenha,
  invalidarTokens,
  trocarNome,
} from '../repositorios/identidade.ts';
import { gerarToken } from '../tokens.ts';

// CAD-01, CAD-02, CAD-03, CAD-06, CAD-08: POST /api/cadastro. Contrato e política de senha
// primeiro (422, iguais para qualquer e-mail). Depois, o mesmo 202 com o mesmo corpo em todos os
// casos, mudando só o e-mail enviado:
// - e-mail novo: conta pendente, senha só como hash no banco e link de confirmação;
// - pendente: troca nome e senha, invalida o token anterior e manda um link novo;
// - confirmado: não mexe na conta, confere a senha só para gastar o mesmo tempo de hash, e manda
//   "você já tem conta" com o link da recuperação.
// O e-mail sai depois do COMMIT; falha de envio vai ao Sentry e a resposta continua 202.

export const VALIDADE_CONFIRMACAO_MINUTOS = 30;

export interface DependenciasCadastro {
  email: (env: Cloudflare.Env) => ClienteEmail;
  capturarErro: (erro: unknown) => void;
}

function emailDeConfirmacao(urlPublica: string, para: string, nome: string, token: string) {
  return {
    para,
    assunto: 'Confirme seu e-mail no Evolução Segura',
    texto: [
      `Olá, ${nome}.`,
      '',
      `Para ativar sua conta, abra o link abaixo em até ${VALIDADE_CONFIRMACAO_MINUTOS} minutos:`,
      `${urlPublica}/confirmar?token=${token}`,
      '',
      'Se você não pediu este cadastro, ignore este e-mail.',
    ].join('\n'),
  } satisfies MensagemEmail;
}

function emailDeContaExistente(urlPublica: string, para: string) {
  return {
    para,
    assunto: 'Você já tem conta no Evolução Segura',
    texto: [
      'Recebemos um pedido de cadastro com este e-mail, mas ele já tem uma conta.',
      '',
      'Se esqueceu a senha, recupere o acesso em:',
      `${urlPublica}/recuperar`,
      '',
      'Se não foi você, ignore este e-mail. Sua conta não foi alterada.',
    ].join('\n'),
  } satisfies MensagemEmail;
}

export function rotasCadastro(deps: DependenciasCadastro) {
  return new Hono<{ Bindings: Cloudflare.Env }>().post('/cadastro', async (c) => {
    const leitura = await lerCorpo(c, esquemaCadastro);
    if (!leitura.ok) return leitura.resposta;
    const { nome, email, senha } = leitura.dados;
    const motivo = avaliarSenha(senha);
    if (motivo !== null)
      return responderProblema(c, 'senha_fora_da_politica', 'Senha fora da política', { motivo });

    const mensagem = await comTransacao(c.env, null, async (trx) => {
      const { novo, usuario } = await criarOuTravarUsuario(trx, email, nome);
      if (usuario.confirmado) {
        await conferirSenha(trx, email, senha);
        return emailDeContaExistente(c.env.URL_PUBLICA, email);
      }
      if (!novo) {
        await trocarNome(trx, usuario.id, nome);
        await invalidarTokens(trx, usuario.id, 'confirmacao');
      }
      await definirSenha(trx, usuario.id, senha);
      const { token, hash } = await gerarToken();
      await criarTokenEmail(trx, {
        usuarioId: usuario.id,
        tipo: 'confirmacao',
        hash,
        validadeMinutos: VALIDADE_CONFIRMACAO_MINUTOS,
      });
      return emailDeConfirmacao(c.env.URL_PUBLICA, email, nome, token);
    });

    try {
      await deps.email(c.env).enviar(mensagem);
    } catch (erro) {
      deps.capturarErro(erro);
    }
    return c.json(RESPOSTA_CADASTRO, 202);
  });
}
