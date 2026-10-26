import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, definirCsrf, ehErroApi } from '../lib/api.ts';
import { Aviso, Botao, Campo, Pagina } from './componentes.tsx';
import { useContagem } from './contagem.ts';
import { MENSAGEM_ERRO_GENERICO, MENSAGEM_MUITAS_TENTATIVAS } from './mensagens.ts';

// AUTH-01, AUTH-04, AUTH-06, AUTH-08: tela /entrar em dois passos.
// 1. e-mail e senha (POST /api/auth/entrar). O 202 leva ao código; 401 tem uma mensagem só (não
//    diz se o e-mail existe); 429 diz quanto esperar (Retry-After); 503 diz que o código não saiu.
// 2. código de 6 dígitos (POST /api/auth/2fa/verificar). O 200 traz o token CSRF da sessão nova,
//    que o cliente guarda na memória, e o app abre em /app.
// O reenvio (POST /api/auth/2fa/reenviar) fica bloqueado por 60 s depois de cada envio, com a
// contagem no botão. A resposta dele é sempre a mesma (AUTH-06): a tela não promete que saiu.

const ESPERA_REENVIO_SEGUNDOS = 60;
export const MENSAGEM_SEM_ENVIO =
  'Não foi possível enviar o código agora. Tente de novo em instantes.';

function mensagemDeBloqueio(retryAfter: number | undefined): string {
  if (retryAfter === undefined) return MENSAGEM_MUITAS_TENTATIVAS;
  const minutos = Math.ceil(retryAfter / 60);
  return `Muitas tentativas. Tente de novo em ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
}

export function Entrar() {
  const navegar = useNavigate();
  const [passo, setPasso] = useState<'senha' | 'codigo'>('senha');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [esperaReenvio, iniciarEspera] = useContagem();

  function tratarErro(e: unknown, quandoRecusado: string) {
    if (ehErroApi(e) && e.status === 401) setErro(quandoRecusado);
    else if (ehErroApi(e) && e.status === 429) setErro(mensagemDeBloqueio(e.retryAfter));
    else if (ehErroApi(e) && e.status === 503) setErro(MENSAGEM_SEM_ENVIO);
    else setErro(MENSAGEM_ERRO_GENERICO);
  }

  async function enviarSenha(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      await api.requisitar('/auth/entrar', {
        metodo: 'POST',
        publica: true,
        corpo: { email, senha },
      });
      setSenha('');
      setCodigo('');
      setPasso('codigo');
      iniciarEspera(ESPERA_REENVIO_SEGUNDOS);
    } catch (e) {
      tratarErro(e, 'E-mail ou senha incorretos.');
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCodigo(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setAviso(null);
    if (!/^\d{6}$/.test(codigo)) {
      setErro('Digite os 6 dígitos do código que enviamos por e-mail.');
      return;
    }
    setErro(null);
    setOcupado(true);
    try {
      const resposta = await api.requisitar<{ csrf_token: string }>('/auth/2fa/verificar', {
        metodo: 'POST',
        publica: true,
        corpo: { email, codigo },
      });
      definirCsrf(resposta.csrf_token);
      navegar('/app', { replace: true });
    } catch (e) {
      tratarErro(
        e,
        'Código incorreto ou vencido. Confira o e-mail mais recente ou volte e entre de novo.',
      );
    } finally {
      setOcupado(false);
    }
  }

  async function reenviar() {
    if (ocupado || esperaReenvio > 0) return;
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      await api.requisitar('/auth/2fa/reenviar', {
        metodo: 'POST',
        publica: true,
        corpo: { email },
      });
      iniciarEspera(ESPERA_REENVIO_SEGUNDOS);
      setAviso('Pedido recebido. Se o código anterior ainda valia, enviamos um novo código.');
    } catch (e) {
      tratarErro(e, MENSAGEM_ERRO_GENERICO);
    } finally {
      setOcupado(false);
    }
  }

  function voltar() {
    setPasso('senha');
    setErro(null);
    setAviso(null);
  }

  if (passo === 'codigo')
    return (
      <Pagina titulo="Código de acesso">
        <p>
          Enviamos um código de 6 dígitos para <strong>{email}</strong>. Ele vale por 10 minutos.
        </p>
        <form onSubmit={enviarCodigo} noValidate className="flex flex-col gap-4">
          <Campo
            rotulo="Código"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.trim())}
          />
          {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
          {aviso ? <Aviso tom="ok">{aviso}</Aviso> : null}
          <Botao disabled={ocupado}>Confirmar código</Botao>
        </form>
        <button
          type="button"
          className="underline disabled:no-underline disabled:opacity-60"
          disabled={ocupado || esperaReenvio > 0}
          onClick={() => void reenviar()}
        >
          {esperaReenvio > 0 ? `Reenviar código em ${esperaReenvio} s` : 'Reenviar código'}
        </button>
        <button type="button" className="underline" onClick={voltar}>
          Voltar
        </button>
      </Pagina>
    );

  return (
    <Pagina titulo="Entrar">
      <form onSubmit={enviarSenha} noValidate className="flex flex-col gap-4">
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
        <Botao disabled={ocupado}>Entrar</Botao>
      </form>
      <p>
        <Link to="/recuperar">Esqueci minha senha</Link>
      </p>
      <p>
        Ainda não tem conta? <Link to="/cadastro">Criar conta</Link>
      </p>
    </Pagina>
  );
}
