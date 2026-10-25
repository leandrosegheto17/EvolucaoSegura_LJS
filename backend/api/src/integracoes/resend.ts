import * as Sentry from '@sentry/cloudflare';

// CAD-08, AUTH-08, D-27: envio de e-mail transacional pelo Resend, por fetch e só em texto puro.
// Remetente sempre de @evolucaosegura.com.br. Toda falha vira ErroEnvioEmail, sem o endereço do
// destinatário (nem o corpo da resposta, que pode ecoá-lo) e sem escrever no console. Quem chama
// decide a resposta: 202 nos fluxos anti-enumeração, 503 mail_unavailable no 2FA.
// O plano gratuito tem 100 e-mails por dia: o primeiro 429 desta instância do Worker vai ao
// Sentry como alerta (design, Risks; runbook tem o plano B).

const URL_RESEND = 'https://api.resend.com/emails';
const REMETENTE =
  /^(?:[^<>@]+ <[^\s<>@]+@evolucaosegura\.com\.br>|[^\s<>@]+@evolucaosegura\.com\.br)$/;

export type TipoErroEmail = 'limite' | 'falha' | 'rede';

export class ErroEnvioEmail extends Error {
  readonly tipo: TipoErroEmail;
  readonly status: number | null;
  constructor(tipo: TipoErroEmail, status: number | null) {
    super(
      tipo === 'rede'
        ? 'Resend indisponível (erro de rede)'
        : `Resend recusou o envio (HTTP ${status})`,
    );
    this.name = 'ErroEnvioEmail';
    this.tipo = tipo;
    this.status = status;
  }
}

export interface MensagemEmail {
  para: string;
  assunto: string;
  texto: string;
}

export interface ClienteEmail {
  enviar(mensagem: MensagemEmail): Promise<void>;
}

export interface OpcoesResend {
  apiKey: string;
  remetente: string;
  fetch?: typeof fetch;
  alertar?: (erro: ErroEnvioEmail) => void;
}

const alertaPadrao = (erro: ErroEnvioEmail): void => {
  Sentry.captureException(erro, { level: 'fatal', fingerprint: ['resend', 'limite'] });
};

// Um alerta por instância do Worker: os 429 seguintes do mesmo dia não inundam o Sentry.
let limiteJaAlertado = false;

// Só para os testes: volta ao estado de uma instância nova.
export function reiniciarAlertaDeLimite(): void {
  limiteJaAlertado = false;
}

export function criarClienteResend(opcoes: OpcoesResend): ClienteEmail {
  if (!opcoes.apiKey) throw new Error('Resend: chave ausente');
  if (!REMETENTE.test(opcoes.remetente))
    throw new Error('Resend: remetente fora de @evolucaosegura.com.br');
  const fetchFn = opcoes.fetch ?? fetch;
  const alertar = opcoes.alertar ?? alertaPadrao;

  return {
    async enviar({ para, assunto, texto }) {
      let resposta: Response;
      try {
        resposta = await fetchFn(URL_RESEND, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opcoes.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: opcoes.remetente,
            to: [para],
            subject: assunto,
            text: texto,
          }),
        });
      } catch {
        // A exceção original pode citar o destinatário: não vai como causa.
        throw new ErroEnvioEmail('rede', null);
      }
      // O corpo não é lido nem repassado (pode ecoar o endereço); só libera a conexão.
      await resposta.body?.cancel();
      if (resposta.ok) return;
      if (resposta.status === 429) {
        const erro = new ErroEnvioEmail('limite', 429);
        if (!limiteJaAlertado) {
          limiteJaAlertado = true;
          alertar(erro);
        }
        throw erro;
      }
      throw new ErroEnvioEmail('falha', resposta.status);
    },
  };
}
