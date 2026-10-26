import { type FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ehErroApi } from '../lib/api.ts';
import { Aviso, Botao, Campo, Pagina } from './componentes.tsx';
import {
  MENSAGEM_ERRO_GENERICO,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_MOTIVO_SENHA,
  MENSAGEM_MUITAS_TENTATIVAS,
} from './mensagens.ts';

// AUTH-13, AUTH-14, AUTH-15: telas /recuperar e /redefinir.
// O pedido responde 202 vazio para qualquer e-mail, e a tela mostra sempre a mesma mensagem, sem
// repetir o e-mail. A redefinição lê o token do link (e o tira da barra de endereço), manda a senha
// nova e trata o 400 link_invalido (pede um link novo) e o 422 com o motivo da política. O 204 não
// abre sessão: a tela leva a entrar, com senha e código.

export const MENSAGEM_PEDIDO_RECEBIDO =
  'Se houver uma conta com esse e-mail, enviamos um link para criar uma senha nova. O link vale ' +
  'por 30 minutos e só pode ser usado uma vez. Confira também a caixa de spam.';

export function Recuperar() {
  const [email, setEmail] = useState('');
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setErro(null);
    setErroEmail(null);
    setOcupado(true);
    try {
      await api.requisitar('/auth/recuperar', { metodo: 'POST', publica: true, corpo: { email } });
      setEnviado(true);
    } catch (e) {
      if (ehErroApi(e) && e.codigo === 'validacao') setErroEmail('Informe um e-mail válido.');
      else if (ehErroApi(e) && e.status === 429) setErro(MENSAGEM_MUITAS_TENTATIVAS);
      else setErro(MENSAGEM_ERRO_GENERICO);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Pagina titulo="Recuperar acesso">
      {enviado ? (
        <Aviso tom="ok">{MENSAGEM_PEDIDO_RECEBIDO}</Aviso>
      ) : (
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          <p>Informe o e-mail da sua conta. Enviaremos um link para criar uma senha nova.</p>
          <Campo
            rotulo="E-mail"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            erro={erroEmail}
          />
          {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
          <Botao disabled={ocupado}>Enviar link</Botao>
        </form>
      )}
      <Link to="/entrar">Voltar para entrar</Link>
    </Pagina>
  );
}

type EstadoRedefinicao = 'formulario' | 'concluida' | 'link_invalido';

export function Redefinir() {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  // O token sai da URL (histórico) e fica só no estado.
  const [token] = useState(() => parametros.get('token'));
  const [estado, setEstado] = useState<EstadoRedefinicao>(token ? 'formulario' : 'link_invalido');
  const [senha, setSenha] = useState('');
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (parametros.has('token')) navegar(pathname, { replace: true });
  }, [parametros, navegar, pathname]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || token === null) return;
    setErro(null);
    setErroSenha(null);
    setOcupado(true);
    try {
      await api.requisitar('/auth/recuperar/confirmar', {
        metodo: 'POST',
        publica: true,
        corpo: { token, nova_senha: senha },
      });
      setSenha('');
      setEstado('concluida');
    } catch (e) {
      if (ehErroApi(e) && e.codigo === 'link_invalido') setEstado('link_invalido');
      else if (ehErroApi(e) && e.codigo === 'senha_fora_da_politica' && e.motivo)
        setErroSenha(MENSAGEM_MOTIVO_SENHA[e.motivo]);
      else if (ehErroApi(e) && e.status === 429) setErro(MENSAGEM_MUITAS_TENTATIVAS);
      else setErro(MENSAGEM_ERRO_GENERICO);
    } finally {
      setOcupado(false);
    }
  }

  if (estado === 'concluida')
    return (
      <Pagina titulo="Senha nova">
        <Aviso tom="ok">
          Senha redefinida. Por segurança, todas as sessões abertas foram encerradas. Entre com a
          senha nova; enviaremos um código para o seu e-mail.
        </Aviso>
        <Link to="/entrar">Ir para entrar</Link>
      </Pagina>
    );

  if (estado === 'link_invalido')
    return (
      <Pagina titulo="Senha nova">
        <Aviso tom="erro">{MENSAGEM_LINK_INVALIDO} Peça um link novo.</Aviso>
        <Link to="/recuperar">Pedir novo link</Link>
      </Pagina>
    );

  return (
    <Pagina titulo="Senha nova">
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Campo
          rotulo="Nova senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          erro={erroSenha}
        />
        <p className="text-sm">
          Use pelo menos 12 caracteres. Uma frase com palavras soltas é uma boa senha.
        </p>
        {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
        <Botao disabled={ocupado}>Redefinir senha</Botao>
      </form>
    </Pagina>
  );
}
