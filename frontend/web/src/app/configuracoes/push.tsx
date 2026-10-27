import type { ChavePush } from '@es/contrato/push';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, Spinner } from '../../ui';
import { api, ehErroApi } from '../../lib/api.ts';

// PUSH-01, PERF-08: interruptor do push por dispositivo, no cartão Notificações das
// Configurações. Sem origem no legado (ele não tinha push).
// - Estado inicial: ligado quando o navegador já tem assinatura no service worker do app
//   (getRegistration + getSubscription); desligado caso contrário.
// - Ativar: pede a permissão; concedida, registra /sw.js (T147), espera ficar pronto, assina no
//   PushManager com a chave pública VAPID (GET /api/push/chave) e guarda a assinatura
//   (POST /api/push/assinatura). Falha ao guardar cancela a assinatura nova, para o navegador não
//   ficar ligado sem o servidor saber; o 409 endpoint_em_uso (o dispositivo já recebe de outra
//   conta, T143) não mexe na assinatura, que é da outra conta.
// - Desativar: remove no servidor (DELETE /api/push/assinatura) e depois cancela no navegador;
//   falha no servidor deixa ligado.
// - Permissão negada (antes ou ao pedir): interruptor bloqueado, com a explicação de como liberar
//   (o site não pode pedir de novo). Pedido fechado sem resposta: fica desligado e pode repetir.
// - Navegador sem service worker, PushManager ou Notification (ex.: Safari do iPhone fora do app
//   instalado): explica e não mostra o interruptor. Push desligado no servidor (chave null):
//   interruptor bloqueado.

export const CHAVE_PUSH = ['push', 'chave'] as const;
const CAMINHO_SW = '/sw.js';

const TEXTO_BLOQUEADO =
  'As notificações estão bloqueadas neste navegador. Para ativar, libere nas configurações do navegador.';

export function chaveParaBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  const binario = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

const temSuporte = (): boolean =>
  typeof window !== 'undefined' &&
  Boolean(navigator.serviceWorker) &&
  'PushManager' in window &&
  'Notification' in window;

async function assinaturaAtual(): Promise<PushSubscription | null> {
  const registro = await navigator.serviceWorker.getRegistration('/');
  return (await registro?.pushManager.getSubscription()) ?? null;
}

type Aviso = { tom: 'ok' | 'err' | 'info'; texto: string } | null;

function Interruptor({
  ligado,
  bloqueado,
  onAlternar,
}: {
  ligado: boolean;
  bloqueado: boolean;
  onAlternar: () => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        role="switch"
        checked={ligado}
        disabled={bloqueado}
        onChange={onAlternar}
      />
      <span>Notificações neste dispositivo</span>
    </label>
  );
}

export function PushDispositivo() {
  const suportado = temSuporte();
  const chave = useQuery({
    queryKey: CHAVE_PUSH,
    queryFn: ({ signal }) => api.requisitar<ChavePush>('/push/chave', { sinal: signal }),
    enabled: suportado,
  });
  const [ligado, setLigado] = useState<boolean | null>(null);
  const [negada, setNegada] = useState(() => suportado && Notification.permission === 'denied');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  useEffect(() => {
    if (!suportado) return;
    let vivo = true;
    assinaturaAtual()
      .then((a) => vivo && setLigado(a !== null))
      .catch(() => vivo && setLigado(false));
    return () => {
      vivo = false;
    };
  }, [suportado]);

  if (!suportado)
    return (
      <p className="text-mut">
        Este navegador não recebe notificações. No iPhone e no iPad, adicione o app à Tela de Início
        e abra por lá.
      </p>
    );

  const chavePublica = chave.data?.chave_publica ?? null;
  const indisponivel = chave.isSuccess && chavePublica === null;

  async function ativar(publica: string) {
    const permissao = await Notification.requestPermission();
    if (permissao === 'denied') {
      setNegada(true);
      return;
    }
    if (permissao !== 'granted') {
      setAviso({ tom: 'info', texto: 'Permissão não concedida. Toque de novo para tentar.' });
      return;
    }
    await navigator.serviceWorker.register(CAMINHO_SW, { scope: '/' });
    const registro = await navigator.serviceWorker.ready;
    const assinatura = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chaveParaBytes(publica),
    });
    try {
      await api.requisitar('/push/assinatura', { metodo: 'POST', corpo: assinatura.toJSON() });
    } catch (erro) {
      if (ehErroApi(erro) && erro.codigo === 'endpoint_em_uso') {
        setAviso({
          tom: 'err',
          texto: 'Este dispositivo já recebe notificações de outra conta. Desative nela primeiro.',
        });
        return;
      }
      await assinatura.unsubscribe().catch(() => false);
      throw erro;
    }
    setLigado(true);
    setAviso({ tom: 'ok', texto: 'Notificações ativadas neste dispositivo.' });
  }

  async function desativar() {
    const assinatura = await assinaturaAtual();
    if (assinatura) {
      try {
        await api.requisitar('/push/assinatura', {
          metodo: 'DELETE',
          corpo: { endpoint: assinatura.endpoint },
        });
      } catch {
        setAviso({
          tom: 'err',
          texto: 'Não foi possível desativar as notificações agora. Tente novamente.',
        });
        return;
      }
      await assinatura.unsubscribe().catch(() => false);
    }
    setLigado(false);
    setAviso({ tom: 'ok', texto: 'Notificações desativadas neste dispositivo.' });
  }

  async function alternar() {
    if (chavePublica === null) return;
    setOcupado(true);
    setAviso(null);
    try {
      if (ligado) await desativar();
      else await ativar(chavePublica);
    } catch {
      setAviso({
        tom: 'err',
        texto: 'Não foi possível ativar as notificações agora. Tente novamente.',
      });
    } finally {
      setOcupado(false);
    }
  }

  const bloqueado =
    negada || ocupado || ligado === null || chavePublica === null || chave.isPending;

  return (
    <div className="flex flex-col gap-3">
      <Interruptor
        ligado={ligado === true && !negada}
        bloqueado={bloqueado}
        onAlternar={() => void alternar()}
      />
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        {ocupado && <Spinner label="Aguarde" />}
        {aviso?.tom === 'ok' && <Alert tone="ok">{aviso.texto}</Alert>}
        {aviso?.tom === 'info' && <p className="text-mut">{aviso.texto}</p>}
      </div>
      {aviso?.tom === 'err' && <Alert tone="err">{aviso.texto}</Alert>}
      {negada && <p className="text-mut">{TEXTO_BLOQUEADO}</p>}
      {indisponivel && <p className="text-mut">As notificações estão indisponíveis no momento.</p>}
      {chave.isError && (
        <p className="text-mut">Não foi possível verificar as notificações agora.</p>
      )}
    </div>
  );
}
