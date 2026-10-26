import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { Alert, Button, Skeleton } from '../../ui';
import { definirAtivo, lerPaciente } from './api.ts';

// PAC-03, PAC-07: inativar e reativar o paciente, portado de
// patients/status/PatientStatusPage.tsx do legado com o mesmo layout e os mesmos textos (E7).
// Nenhuma ação de excluir. Depois da troca, a ficha e a lista são recarregadas.

export function PatientStatusPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const consulta = useQuery({
    queryKey: ['paciente', id],
    queryFn: ({ signal }) => lerPaciente(id, signal),
  });
  const troca = useMutation({
    mutationFn: (ativo: boolean) => definirAtivo(id, ativo),
    onSuccess: (paciente) => {
      qc.setQueryData(['paciente', id], paciente);
      void qc.invalidateQueries({ queryKey: ['pacientes'] });
    },
  });
  const feito = troca.isSuccess ? troca.variables : undefined;

  if (consulta.isPending) return <Skeleton className="h-32" />;
  if (consulta.isError) {
    return (
      <Alert tone="err">
        <p>Não foi possível carregar o paciente.</p>
        <Button variant="outline" className="mt-2" onClick={() => void consulta.refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  }
  const { nome, ativo } = consulta.data;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Situação do paciente</h1>
      {feito !== undefined && (
        <Alert tone="ok">
          <b>{feito ? 'Paciente reativado.' : 'Paciente inativado.'}</b>{' '}
          {feito
            ? 'Ele voltou à lista de ativos com todo o histórico.'
            : 'O histórico foi preservado.'}
        </Alert>
      )}
      {troca.isError && (
        <Alert tone="err">Não foi possível concluir a ação. Tente novamente.</Alert>
      )}
      <section className="rounded-card border-2 border-pri bg-surf p-4">
        {ativo ? (
          <>
            <h2 className="text-lg font-bold">Inativar {nome}?</h2>
            <p className="mt-2">
              O paciente sai da lista de ativos e não recebe novas sessões.{' '}
              <b>O prontuário completo é mantido</b> e pode ser reativado a qualquer momento.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold">Reativar {nome}?</h2>
            <p className="mt-2">Ele volta à lista de ativos com todo o histórico.</p>
          </>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={troca.isPending} onClick={() => troca.mutate(!ativo)}>
            {ativo ? 'Inativar paciente' : 'Reativar'}
          </Button>
          <Link
            to="/app/pacientes"
            className="inline-flex min-h-12 min-w-12 items-center rounded-card border-2 border-pri px-4 font-semibold text-pri"
          >
            {ativo ? 'Voltar' : 'Cancelar'}
          </Link>
        </div>
      </section>
      <Alert tone="warn">
        <b>Pacientes não podem ser excluídos.</b> O prontuário é retido por segurança e integridade
        do registro. Use "Inativar".
      </Alert>
    </div>
  );
}
