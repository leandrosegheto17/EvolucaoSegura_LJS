import { Badge, Seal } from '../Feedback';
import { PencilIcon } from './icons';

export type DocEstado = 'rascunho' | 'entregue';

/** `entregueEm` ja formatado pelo chamador a partir do dado do servidor (RF-30a). */
export function DocStatusBadge({ estado, entregueEm }: { estado: DocEstado; entregueEm?: string }) {
  if (estado === 'entregue') {
    return <Seal>{entregueEm ? `Entregue em ${entregueEm}` : 'Entregue'}</Seal>;
  }
  return (
    <Badge tone="warn" icon={<PencilIcon />}>
      Rascunho
    </Badge>
  );
}
