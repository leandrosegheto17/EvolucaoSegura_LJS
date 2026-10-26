import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { Alert, Badge, Button, Skeleton } from '../../ui';
import { MenuButton } from '../../ui/new';
import { PencilIcon } from '../../ui/new/icons';
import { lerPaciente } from './api.ts';
import { ConsentsCard } from './tcle.tsx';

// PAC-03, PAC-05, PAC-06: ficha do paciente, portada de patients/ficha/PatientFichaPage.tsx do
// legado com o mesmo cabeçalho (nome, selo de situação e menu "Editar") e a grade de cartões com
// Consentimentos. Abrir a ficha audita paciente.consultado no servidor (PAC-06).
// SPEC_DEVIATION: em relação ao legado, saem o selo e o cartão de ciência de IA (fora do escopo)
// e o item "Editar dados" (a spec não pede edição do paciente); o selo de alerta clínico, a
// seção Anamneses e os atalhos do prontuário (Evoluções, Histórico, Exportar, Valor) entram nas
// etapas que criam essas telas, para não deixar links sem destino.

export function PatientFichaPage() {
  const { id = '' } = useParams();
  const paciente = useQuery({
    queryKey: ['paciente', id],
    queryFn: ({ signal }) => lerPaciente(id, signal),
  });

  if (paciente.isPending) return <Skeleton className="h-10" />;
  if (paciente.isError) {
    return (
      <Alert tone="err">
        <p>Não foi possível carregar o paciente.</p>
        <Button variant="outline" className="mt-2" onClick={() => void paciente.refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex flex-wrap items-center gap-3 font-heading text-2xl font-bold">
          {paciente.data.nome}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={paciente.data.ativo ? 'ok' : 'warn'}>
            {paciente.data.ativo ? 'Ativo' : 'Inativo'}
          </Badge>
          <MenuButton
            label="Editar"
            icon={<PencilIcon />}
            items={[{ label: 'Situação do paciente', to: `/app/pacientes/${id}/situacao` }]}
          />
        </div>
      </header>
      <div className="grid grid-cols-1 items-start gap-4 min-[1100px]:grid-cols-2">
        <ConsentsCard id={id} />
      </div>
    </div>
  );
}
