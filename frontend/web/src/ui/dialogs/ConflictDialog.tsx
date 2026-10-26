import { Button } from '../Button';
import { AlertDialog, DialogShell } from './Dialog';

export type ConflictDialogProps = {
  open: boolean;
  onReload: () => void;
  onClose: () => void;
};

/** 412 / row_version antigo (E13): nada é sobrescrito em silêncio. Esc apenas fecha. */
export function ConflictDialog({ open, onReload, onClose }: ConflictDialogProps) {
  return (
    <DialogShell
      open={open}
      onEscape={onClose}
      title="Este registro foi alterado em outra sessão"
      description={<p>Seu texto não foi salvo para não sobrescrever a versão mais recente. Recarregue para ver as alterações; seu texto continua na tela até você decidir.</p>}
    >
      <AlertDialog.Cancel asChild><Button variant="outline" onClick={onClose}>Continuar editando</Button></AlertDialog.Cancel>
      <Button onClick={onReload}>Recarregar versão atual</Button>
    </DialogShell>
  );
}
