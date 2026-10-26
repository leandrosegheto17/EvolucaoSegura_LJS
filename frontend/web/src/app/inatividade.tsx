import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CAMINHO_SESSAO_EXPIRADA,
  EVENTO_NAO_AUTORIZADO,
  EVENTO_SESSAO_USADA,
  api,
  definirCsrf,
} from '../lib/api.ts';

// AUTH-18, AUTH-19: aviso de inatividade e sessão expirada, adaptados do SessionTimeoutGuard e do
// SessionTimeoutDialog do legado.
// A sessão do servidor acaba 15 min depois da última requisição autenticada (AUTH-09), então a
// contagem daqui recomeça a cada resposta autenticada (EVENTO_SESSAO_USADA, do cliente da API), e
// não a cada clique ou tecla: atividade sem requisição não renova nada no servidor.
// - Nos últimos 120 s, o diálogo "Sua sessão vai expirar" mostra a contagem. "Continuar conectado"
//   (ou Esc) faz GET /api/eu, que renova a sessão; um 401 ali segue o fluxo do cliente.
// - Aos 15:00, o app limpa o cache do TanStack Query e o token CSRF e vai para /sessao-expirada.
//   Os rascunhos não são apagados: localStorage e sessionStorage ficam como estão, e os do servidor
//   (RAS-01) seguem guardados para restauração (RAS-04).
// - Um 401 de qualquer requisição (EVENTO_NAO_AUTORIZADO) também limpa o cache.

export const INATIVIDADE_MS = 15 * 60_000;
export const AVISO_MS = 120_000;

const formatar = (segundos: number) =>
  `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

export function GuardaInatividade() {
  const navegar = useNavigate();
  const clienteQuery = useQueryClient();
  const [ultimoUso, setUltimoUso] = useState(() => Date.now());
  const [aberto, setAberto] = useState(false);
  const [, setTique] = useState(0);

  const expirar = useCallback(() => {
    setAberto(false);
    definirCsrf(null);
    clienteQuery.clear();
    navegar(CAMINHO_SESSAO_EXPIRADA, { replace: true });
  }, [clienteQuery, navegar]);

  useEffect(() => {
    const aoUsar = () => {
      setAberto(false);
      setUltimoUso(Date.now());
    };
    const aoNegar = () => clienteQuery.clear();
    window.addEventListener(EVENTO_SESSAO_USADA, aoUsar);
    window.addEventListener(EVENTO_NAO_AUTORIZADO, aoNegar);
    return () => {
      window.removeEventListener(EVENTO_SESSAO_USADA, aoUsar);
      window.removeEventListener(EVENTO_NAO_AUTORIZADO, aoNegar);
    };
  }, [clienteQuery]);

  useEffect(() => {
    const fim = ultimoUso + INATIVIDADE_MS;
    const aviso = setTimeout(() => setAberto(true), fim - AVISO_MS - Date.now());
    const termino = setTimeout(expirar, fim - Date.now());
    return () => {
      clearTimeout(aviso);
      clearTimeout(termino);
    };
  }, [ultimoUso, expirar]);

  useEffect(() => {
    if (!aberto) return;
    const id = setInterval(() => setTique((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [aberto]);

  const continuar = useCallback(() => {
    // GET /api/eu renova o último uso; a resposta dispara EVENTO_SESSAO_USADA, que fecha o aviso e
    // recomeça a contagem. Sem resposta (rede), o aviso fica aberto para tentar de novo. O 401 já
    // leva a /sessao-expirada pelo cliente.
    api.carregarCsrf().catch(() => undefined);
  }, []);

  if (!aberto) return null;
  const restante = Math.max(0, Math.ceil((ultimoUso + INATIVIDADE_MS - Date.now()) / 1000));
  return <DialogoInatividade segundos={restante} aoContinuar={continuar} />;
}

function DialogoInatividade({
  segundos,
  aoContinuar,
}: {
  segundos: number;
  aoContinuar: () => void;
}) {
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => botao.current?.focus(), []);
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-texto`}
        className="flex max-w-sm flex-col gap-4 rounded border bg-[Canvas] p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') aoContinuar();
        }}
      >
        <h2 id={`${id}-titulo`} className="text-lg font-semibold">
          Sua sessão vai expirar
        </h2>
        <p id={`${id}-texto`}>
          Por inatividade, sua sessão termina em <strong>{formatar(segundos)}</strong>. Seus
          rascunhos ficam guardados.
        </p>
        {/* Anúncio a cada 30 s, não a cada segundo. */}
        <p role="status" className="sr-only">
          {segundos > 0 && segundos % 30 === 0 ? `Sessão expira em ${formatar(segundos)}` : ''}
        </p>
        <button
          ref={botao}
          type="button"
          className="rounded border px-4 py-2 font-medium"
          onClick={aoContinuar}
        >
          Continuar conectado
        </button>
      </div>
    </div>
  );
}

export function SessaoExpirada() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Sessão expirada</h1>
      <div role="status" className="rounded border p-3">
        Sua sessão terminou por inatividade. Entre novamente para continuar. Seus rascunhos foram
        preservados e poderão ser restaurados.
      </div>
      <Link to="/entrar">Entrar novamente</Link>
    </main>
  );
}
