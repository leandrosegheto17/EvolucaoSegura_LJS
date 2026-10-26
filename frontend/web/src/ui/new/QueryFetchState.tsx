import { Alert, Skeleton } from '../Feedback';
import { Button } from '../Button';

/** Esqueleto enquanto a consulta carrega e alerta de erro com "Tentar novamente"; nada quando pronta. */
export function QueryFetchState({
  isPending,
  isError,
  errorMessage,
  onRetry,
  skeletonClassName,
}: {
  isPending: boolean;
  isError: boolean;
  errorMessage: string;
  onRetry: () => void;
  skeletonClassName: string;
}) {
  return (
    <>
      {isPending && <Skeleton className={skeletonClassName} />}
      {isError && (
        <Alert tone="err">
          <p>{errorMessage}</p>
          <Button variant="outline" className="mt-2" onClick={onRetry}>
            Tentar novamente
          </Button>
        </Alert>
      )}
    </>
  );
}
