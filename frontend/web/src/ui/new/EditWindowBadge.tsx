import { Badge } from '../Feedback';
import { ClockIcon, LockIcon } from './icons';

/** Estado vem do servidor (RF-25b); o cliente nunca calcula a virada do dia. */
export type EditWindowEstado = 'editavel_hoje' | 'registrada';

export function EditWindowBadge({ estado }: { estado: EditWindowEstado }) {
  return estado === 'editavel_hoje' ? (
    <Badge tone="warn" icon={<ClockIcon />}>
      Editável hoje
    </Badge>
  ) : (
    <Badge tone="ok" icon={<LockIcon />}>
      Registrada
    </Badge>
  );
}
