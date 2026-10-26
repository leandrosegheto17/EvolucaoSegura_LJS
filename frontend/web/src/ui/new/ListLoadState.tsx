import { Button } from '../Button';
import { Alert, Skeleton, Spinner } from '../Feedback';

export type LoadState = 'loading' | 'ready' | 'error';

/** Carregando (spinner + skeleton) e erro com "Tentar novamente"; não renderiza nada quando pronto. */
export function ListLoadState({
  load,
  loadingLabel,
  errorMessage,
  onRetry,
}: {
  load: LoadState;
  loadingLabel: string;
  errorMessage: string;
  onRetry: () => void;
}) {
  if (load === 'loading')
    return (
      <div aria-busy="true">
        <Spinner label={loadingLabel} />
        <Skeleton className="h-10" />
      </div>
    );
  if (load === 'error')
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="err">{errorMessage}</Alert>
        <Button type="button" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    );
  return null;
}
