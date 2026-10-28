/** Opções de um `<Select>` de modelos: opção vazia (rótulo por prop) seguida da lista. */
export function ModeloOptions({
  vazio,
  modelos,
}: {
  vazio: string;
  modelos: { id: string; nome: string }[];
}) {
  return (
    <>
      <option value="">{vazio}</option>
      {modelos.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nome}
        </option>
      ))}
    </>
  );
}
