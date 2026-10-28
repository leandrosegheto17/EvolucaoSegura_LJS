import { Button } from '../Button';
import { AlertDialog, DialogShell } from './Dialog';

export type ConfirmDeliverDialogProps = {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** RF-30a: ação irreversível. Foco inicial em Cancelar; Esc cancela, nunca confirma. */
export function ConfirmDeliverDialog({ open, onConfirm, onCancel }: ConfirmDeliverDialogProps) {
  return (
    <DialogShell
      open={open}
      onEscape={onCancel}
      title="Marcar como Entregue?"
      description={
        <p>
          Após entregar, o documento não poderá ser modificado nem retificado. Para outra versão,
          crie um novo documento.
        </p>
      }
    >
      <AlertDialog.Cancel asChild>
        <Button variant="outline">Cancelar</Button>
      </AlertDialog.Cancel>
      <Button onClick={onConfirm}>Marcar como Entregue</Button>
    </DialogShell>
  );
}
