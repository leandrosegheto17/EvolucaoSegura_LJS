import { useEffect, useRef, useState } from 'react';
import { Button } from '../Button';
import { AlertDialog, DialogShell } from './Dialog';

export type SessionTimeoutDialogProps = {
  open: boolean;
  /** Segundos restantes iniciais (UX: aviso com 2 min). */
  secondsLeft?: number;
  onExtend: () => void;
  onExpire: () => void;
};

function fmt(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** WCAG 2.2.1: avisa, permite prorrogar. Esc prorroga (nunca encerra). */
export function SessionTimeoutDialog({ open, secondsLeft = 120, onExtend, onExpire }: SessionTimeoutDialogProps) {
  const [left, setLeft] = useState(secondsLeft);
  const expired = useRef(onExpire);
  expired.current = onExpire;

  useEffect(() => {
    if (!open) return;
    setLeft(secondsLeft);
    let remaining = secondsLeft;
    const id = setInterval(() => {
      remaining -= 1;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) { clearInterval(id); expired.current(); }
    }, 1000);
    return () => clearInterval(id);
  }, [open, secondsLeft]);

  return (
    <DialogShell
      open={open}
      onEscape={onExtend}
      title="Sua sessão vai expirar"
      description={
        <div>
          <p>Por inatividade, sua sessão termina em <strong>{fmt(left)}</strong>. Seu rascunho está salvo no servidor.</p>
          {/* Anúncio pontual (não a cada segundo) */}
          <p role="status" className="sr-only">{left > 0 && left % 30 === 0 ? `Sessão expira em ${fmt(left)}` : ''}</p>
        </div>
      }
    >
      <Button variant="outline" onClick={onExpire}>Sair agora</Button>
      <AlertDialog.Cancel asChild><Button>Continuar conectado</Button></AlertDialog.Cancel>
    </DialogShell>
  );
}
