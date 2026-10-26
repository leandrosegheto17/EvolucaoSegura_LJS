import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react';

// Peças comuns das telas públicas (cadastro, confirmar, entrar, recuperar). Sem cor própria: o
// visual do legado (tokens e componentes de ui) entra quando o guia de estilo for portado.

export function Pagina({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      {children}
    </main>
  );
}

type PropsCampo = InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string | null };

export function Campo({ rotulo, erro, ...input }: PropsCampo) {
  const id = useId();
  const idErro = `${id}-erro`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-medium">
        {rotulo}
      </label>
      <input
        id={id}
        className="rounded border px-3 py-2"
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? idErro : undefined}
        {...input}
      />
      {erro ? (
        <p id={idErro} className="text-sm">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

// Mensagem de erro (anunciada na hora) ou de sucesso/aviso (anunciada sem interromper).
export function Aviso({ tom, children }: { tom: 'erro' | 'ok'; children: ReactNode }) {
  return (
    <div role={tom === 'erro' ? 'alert' : 'status'} className="rounded border p-3">
      {children}
    </div>
  );
}

export function Botao({
  children,
  ...props
}: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      className="rounded border px-4 py-2 font-medium disabled:opacity-60"
      {...props}
    >
      {children}
    </button>
  );
}
