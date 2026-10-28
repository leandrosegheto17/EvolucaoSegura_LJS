import type { RespostaConfirmarExclusao } from '@es/contrato/conta';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ehErroApi } from '../lib/api.ts';
import { Aviso, Botao, Pagina } from './componentes.tsx';
import {
  MENSAGEM_ERRO_GENERICO,
  MENSAGEM_LINK_INVALIDO,
  MENSAGEM_MUITAS_TENTATIVAS,
} from './mensagens.ts';

// T153 / CONTA-03, CONTA-04: telas públicas abertas pelos links dos e-mails da exclusão de conta
// (caminhos gravados pela T180 e pela T181).
// - /confirmar-exclusao?token=: POST /api/conta/excluir/confirmar.
// - /desistir-exclusao?token=: POST /api/conta/desistir.
// Ao contrário da confirmação do cadastro, nada é enviado ao abrir a página: a pessoa clica no
// botão. Assim um leitor de e-mail ou antivírus que abre os links sozinho não bloqueia nem
// desbloqueia a conta. O token sai da barra de endereço (histórico) e fica só no estado.
// PREMISSA: o clique explícito e os textos destas telas foram escolhidos pelo implementador.

type Estado = 'pronto' | 'enviando' | 'feito' | 'link_invalido' | 'indisponivel' | 'falha';

function useTokenDoLink(): string | null {
  const [parametros] = useSearchParams();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [token] = useState(() => parametros.get('token'));
  useEffect(() => {
    if (parametros.has('token')) navegar(pathname, { replace: true });
  }, [parametros, navegar, pathname]);
  return token;
}

function estadoDoErro(erro: unknown): Estado {
  if (ehErroApi(erro) && erro.codigo === 'link_invalido') return 'link_invalido';
  if (ehErroApi(erro) && erro.status === 503) return 'indisponivel';
  return 'falha';
}

const dataBr = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

function Falhas({ estado, muitas }: { estado: Estado; muitas: boolean }) {
  if (estado === 'link_invalido')
    return (
      <Aviso tom="erro">
        {MENSAGEM_LINK_INVALIDO} Para excluir a conta, entre e peça a exclusão de novo nas
        Configurações.
      </Aviso>
    );
  if (estado === 'falha')
    return <Aviso tom="erro">{muitas ? MENSAGEM_MUITAS_TENTATIVAS : MENSAGEM_ERRO_GENERICO}</Aviso>;
  return null;
}

export function ConfirmarExclusao() {
  const token = useTokenDoLink();
  const [estado, setEstado] = useState<Estado>(token ? 'pronto' : 'link_invalido');
  const [purgaEm, setPurgaEm] = useState<string | null>(null);
  const [muitas, setMuitas] = useState(false);

  async function confirmar() {
    if (!token) return;
    setEstado('enviando');
    try {
      const r = await api.requisitar<RespostaConfirmarExclusao>('/conta/excluir/confirmar', {
        metodo: 'POST',
        publica: true,
        corpo: { token },
      });
      setPurgaEm(r.purga_em);
      setEstado('feito');
    } catch (erro) {
      setMuitas(ehErroApi(erro) && erro.status === 429);
      setEstado(estadoDoErro(erro));
    }
  }

  const podeClicar =
    estado === 'pronto' || estado === 'enviando' || estado === 'indisponivel' || estado === 'falha';

  return (
    <Pagina titulo="Confirmar a exclusão da conta">
      {estado === 'feito' && purgaEm !== null ? (
        <>
          <Aviso tom="ok">
            Conta bloqueada. Em {dataBr(purgaEm)}, todos os dados da conta serão apagados de forma
            definitiva. Enviamos ao seu e-mail um link para desistir até essa data.
          </Aviso>
        </>
      ) : null}
      {podeClicar ? (
        <>
          <p>
            Ao confirmar, a conta é bloqueada na hora, as sessões abertas são encerradas e a
            assinatura é cancelada. Os dados são apagados depois de 30 dias, se você não desistir.
          </p>
          <Botao type="button" onClick={() => void confirmar()} disabled={estado === 'enviando'}>
            Confirmar a exclusão
          </Botao>
        </>
      ) : null}
      {estado === 'indisponivel' ? (
        <Aviso tom="erro">
          Não conseguimos cancelar a sua assinatura agora. Nada foi alterado: tente de novo em
          alguns minutos com este mesmo link.
        </Aviso>
      ) : null}
      <Falhas estado={estado} muitas={muitas} />
    </Pagina>
  );
}

export function DesistirExclusao() {
  const token = useTokenDoLink();
  const [estado, setEstado] = useState<Estado>(token ? 'pronto' : 'link_invalido');
  const [muitas, setMuitas] = useState(false);

  async function desistir() {
    if (!token) return;
    setEstado('enviando');
    try {
      await api.requisitar('/conta/desistir', { metodo: 'POST', publica: true, corpo: { token } });
      setEstado('feito');
    } catch (erro) {
      setMuitas(ehErroApi(erro) && erro.status === 429);
      setEstado(estadoDoErro(erro));
    }
  }

  const podeClicar =
    estado === 'pronto' || estado === 'enviando' || estado === 'indisponivel' || estado === 'falha';

  return (
    <Pagina titulo="Desistir da exclusão da conta">
      {estado === 'feito' ? (
        <>
          <Aviso tom="ok">
            Exclusão cancelada e conta desbloqueada. Entre com seu e-mail e senha; enviaremos um
            código de acesso.
          </Aviso>
          <Link to="/entrar">Entrar</Link>
        </>
      ) : null}
      {podeClicar ? (
        <>
          <p>A conta volta a funcionar e nenhum dado é apagado.</p>
          <Botao type="button" onClick={() => void desistir()} disabled={estado === 'enviando'}>
            Desistir da exclusão
          </Botao>
        </>
      ) : null}
      {estado === 'indisponivel' ? <Aviso tom="erro">{MENSAGEM_ERRO_GENERICO}</Aviso> : null}
      <Falhas estado={estado} muitas={muitas} />
    </Pagina>
  );
}
