import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  /** Chamado em Esc. Nunca deve executar ação destrutiva. */
  onEscape: () => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
};

export function DialogShell({ open, onEscape, title, description, children }: Props) {
  // Sem Trigger do Radix (diálogo controlado), o retorno de foco é feito aqui.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && document.activeElement instanceof HTMLElement)
    opener.current = document.activeElement;
  useEffect(() => {
    wasOpen.current = open;
  }, [open]);
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onEscape();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 bg-black/50" />
        <AlertDialog.Content
          onCloseAutoFocus={(e) => {
            if (opener.current?.isConnected) {
              e.preventDefault();
              opener.current.focus();
            }
          }}
          className="fixed left-1/2 top-1/2 w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border-2 border-pri bg-surf p-6 text-ink"
        >
          <AlertDialog.Title className="text-lg font-bold">{title}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="mt-2">{description}</div>
          </AlertDialog.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-3">{children}</div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export { AlertDialog };
