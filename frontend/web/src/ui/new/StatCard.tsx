import { Link } from 'react-router';
import { Card } from '../Layout';
import { AlertIcon } from './icons';

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  complemento?: string;
  progresso?: { feito: number; total: number };
  atencao?: { texto: string; destino: string; acao?: string; descricao?: string };
}

function pct({ feito, total }: { feito: number; total: number }) {
  if (!(total > 0) || !(feito > 0)) return 0;
  return Math.min(100, Math.round((feito / total) * 100));
}

export function StatCard({ label, value, hint, complemento, progresso, atencao }: StatCardProps) {
  return (
    <Card>
      <p className="text-mut">{label}</p>
      <p className="font-heading text-3xl font-extrabold text-ink">{value}</p>
      {hint && <p className="text-sm text-mut">{hint}</p>}
      {complemento && <p className="text-sm text-mut">{complemento}</p>}
      {progresso && (
        <div className="mt-2">
          <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-(--soft)">
            <div data-testid="stat-progresso-barra" className="h-full bg-(--pri)" style={{ width: `${pct(progresso)}%` }} />
          </div>
          <p className="mt-1 text-sm text-mut">{progresso.feito} de {progresso.total}</p>
        </div>
      )}
      {atencao && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 rounded-md border-l-4 border-(--warn) bg-(--warnbg) px-2 py-1 text-sm text-(--warn)">
          <AlertIcon />
          <span aria-hidden="true">{atencao.texto}</span>
          <Link to={atencao.destino} className="inline-flex min-h-11 items-center font-semibold underline">
            {atencao.acao ?? 'Ver'}{' '}
            <span className="sr-only">{atencao.descricao ?? atencao.texto}</span>
          </Link>
        </div>
      )}
    </Card>
  );
}
