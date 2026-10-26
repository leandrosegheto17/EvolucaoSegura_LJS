import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ehErroApi } from '../lib/api.ts';
import { Aviso, Botao, Campo, Pagina } from './componentes.tsx';
import {
  MENSAGEM_ERRO_GENERICO,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_MOTIVO_SENHA,
  MENSAGEM_MUITAS_TENTATIVAS,
} from './mensagens.ts';

// CAD-01, CAD-05: telas /cadastro e /confirmar.
// O cadastro manda nome, e-mail, senha e o aceite dos termos. A resposta 202 é a mesma para conta
// nova, pendente ou já confirmada (CAD-02), então a tela diz só que o link foi enviado. Os erros do
// contrato viram mensagem no campo: motivo da política de senha (AUTH-11) e campos recusados.
// A confirmação lê o token do link, tira-o da barra de endereço e o envia uma única vez.

type ErrosCampo = Partial<Record<'nome' | 'email' | 'senha' | 'aceite_termos', string>>;

const MENSAGEM_CAMPO: Required<ErrosCampo> = {
  nome: 'Informe o nome (até 200 caracteres).',
  email: 'Informe um e-mail válido.',
  senha: 'Informe a senha.',
  aceite_termos: 'Aceite os termos de uso e a política de privacidade para continuar.',
};

export function Cadastro() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [aceite, setAceite] = useState(false);
  const [erros, setErros] = useState<ErrosCampo>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [enviadoPara, setEnviadoPara] = useState<string | null>(null);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setErroGeral(null);
    if (!aceite) {
      setErros({ aceite_termos: MENSAGEM_CAMPO.aceite_termos });
      return;
    }
    setErros({});
    setOcupado(true);
    try {
      await api.requisitar('/cadastro', {
        metodo: 'POST',
        publica: true,
        corpo: { nome, email, senha, aceite_termos: true },
      });
      setSenha('');
      setEnviadoPara(email.trim());
    } catch (erro) {
      if (ehErroApi(erro) && erro.codigo === 'senha_fora_da_politica' && erro.motivo) {
        setErros({ senha: MENSAGEM_MOTIVO_SENHA[erro.motivo] });
      } else if (ehErroApi(erro) && erro.codigo === 'validacao' && erro.campos?.length) {
        const novos: ErrosCampo = {};
        for (const campo of erro.campos)
          if (campo in MENSAGEM_CAMPO)
            novos[campo as keyof ErrosCampo] = MENSAGEM_CAMPO[campo as keyof ErrosCampo];
        setErros(novos);
        if (Object.keys(novos).length === 0) setErroGeral(MENSAGEM_ERRO_GENERICO);
      } else if (ehErroApi(erro) && erro.status === 429) {
        setErroGeral(MENSAGEM_MUITAS_TENTATIVAS);
      } else {
        setErroGeral(MENSAGEM_ERRO_GENERICO);
      }
    } finally {
      setOcupado(false);
    }
  }

  if (enviadoPara !== null)
    return (
      <Pagina titulo="Confirme seu e-mail">
        <Aviso tom="ok">
          Enviamos um link de confirmação para <strong>{enviadoPara}</strong>. Abra o link em até 30
          minutos para ativar a conta. Se não chegar, confira a caixa de spam.
        </Aviso>
      </Pagina>
    );

  return (
    <Pagina titulo="Criar conta">
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <Campo
          rotulo="Nome"
          autoComplete="name"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          erro={erros.nome ?? null}
        />
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          erro={erros.email ?? null}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          erro={erros.senha ?? null}
        />
        <p className="text-sm">
          Use pelo menos 12 caracteres. Uma frase com palavras soltas é uma boa senha.
        </p>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} />
          <span>
            Li e aceito os <Link to="/termos">termos de uso</Link> e a{' '}
            <Link to="/privacidade">política de privacidade</Link>.
          </span>
        </label>
        {erros.aceite_termos ? <Aviso tom="erro">{erros.aceite_termos}</Aviso> : null}
        {erroGeral ? <Aviso tom="erro">{erroGeral}</Aviso> : null}
        <Botao disabled={ocupado}>Criar conta</Botao>
      </form>
      <p>
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </Pagina>
  );
}

type EstadoConfirmacao = 'confirmando' | 'confirmada' | 'link_invalido' | 'falha';

export function Confirmar() {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  // O token sai da URL (histórico) e fica só no estado.
  const [token] = useState(() => parametros.get('token'));
  const [estado, setEstado] = useState<EstadoConfirmacao>(token ? 'confirmando' : 'link_invalido');
  // Uso único: o StrictMode monta o efeito duas vezes, e o segundo envio gastaria o link.
  const enviado = useRef(false);

  useEffect(() => {
    if (parametros.has('token')) navegar(pathname, { replace: true });
  }, [parametros, navegar, pathname]);

  useEffect(() => {
    if (!token || enviado.current) return;
    enviado.current = true;
    api
      .requisitar('/cadastro/confirmar', { metodo: 'POST', publica: true, corpo: { token } })
      .then(() => setEstado('confirmada'))
      .catch((erro: unknown) =>
        setEstado(ehErroApi(erro) && erro.codigo === 'link_invalido' ? 'link_invalido' : 'falha'),
      );
  }, [token]);

  return (
    <Pagina titulo="Confirmação de e-mail">
      {estado === 'confirmando' ? <p>Confirmando seu e-mail...</p> : null}
      {estado === 'confirmada' ? (
        <>
          <Aviso tom="ok">
            E-mail confirmado. Seu teste grátis de 14 dias começou. Entre com seu e-mail e senha;
            enviaremos um código de acesso.
          </Aviso>
          <Link to="/entrar">Entrar</Link>
        </>
      ) : null}
      {estado === 'link_invalido' ? (
        <>
          <Aviso tom="erro">
            {MENSAGEM_LINK_INVALIDO} Cadastre-se de novo para receber um link novo.
          </Aviso>
          <Link to="/cadastro">Cadastrar de novo</Link>
        </>
      ) : null}
      {estado === 'falha' ? <Aviso tom="erro">{MENSAGEM_ERRO_GENERICO}</Aviso> : null}
    </Pagina>
  );
}
