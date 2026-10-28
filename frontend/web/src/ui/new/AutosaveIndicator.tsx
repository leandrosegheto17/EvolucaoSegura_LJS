export type AutosaveEstado = 'salvo' | 'salvando' | 'nao_salvo';

/** `salvoAs` (HH:MM) vem pronto do chamador; regiao aria-live=polite (RF-41). */
export function AutosaveIndicator({
  estado,
  salvoAs,
}: {
  estado: AutosaveEstado;
  salvoAs?: string;
}) {
  const text =
    estado === 'salvando'
      ? 'Salvando...'
      : estado === 'nao_salvo'
        ? 'Não salvo'
        : salvoAs
          ? `Salvo às ${salvoAs}`
          : 'Salvo';
  const icon = estado === 'salvando' ? '…' : estado === 'nao_salvo' ? '!' : '✓';
  return (
    <span aria-live="polite" className={estado === 'nao_salvo' ? 'text-err' : 'text-mut'}>
      <span aria-hidden="true">{icon} </span>
      {text}
    </span>
  );
}
