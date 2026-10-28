/**
 * Modo privacidade (RF-23): mostra iniciais; o nome completo fica em aria-label.
 * role="img" e valido em WAI-ARIA (role="text" nao e). Decisao: o nome completo
 * permanece no DOM (aria-label) para leitores de tela; o modo privacidade oculta apenas na
 * tela (shoulder-surfing), nao do DOM.
 */
export function PrivacyName({
  nome,
  privado = false,
  nomeAcessivel = 'completo',
}: {
  nome: string;
  privado?: boolean;
  /** "completo" (padrao): aria-label com o nome completo. "exibido" (estrito, RF-54d/SEC-25):
   *  nome acessivel e title = iniciais; nenhum atributo contem o nome completo. */
  nomeAcessivel?: 'completo' | 'exibido';
}) {
  if (!privado) return <span>{nome}</span>;
  const iniciais = nome
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
  if (nomeAcessivel === 'exibido')
    return (
      <span role="img" aria-label={iniciais} title={iniciais}>
        {iniciais}
      </span>
    );
  return (
    <span role="img" aria-label={nome}>
      {iniciais}
    </span>
  );
}
