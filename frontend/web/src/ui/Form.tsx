import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { FOCUS, TARGET, cx } from './classes';

const CONTROL = cx(
  TARGET,
  FOCUS,
  'w-full rounded-card border-2 border-field bg-surf px-3 py-2 text-ink aria-[invalid=true]:border-err',
);

// T64: `| undefined` só para o exactOptionalPropertyTypes deste projeto; o resto é do legado.
export type FieldControlProps = {
  id: string;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
  required?: boolean | undefined;
};

export type FieldProps = {
  label: string;
  hint?: string;
  error?: ReactNode;
  required?: boolean;
  children: (control: FieldControlProps) => ReactNode;
};

/** Label + hint + errtxt ligados ao controle por id/aria-describedby. */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const describedBy = [hint && hintId, error && errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold text-ink">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && (
        <p id={hintId} className="text-sm text-mut">
          {hint}
        </p>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {error && (
        <p id={errId} role="alert" className="text-sm font-semibold text-err">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(CONTROL, className)} {...rest} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { reading?: boolean };

/** `reading`: serifa de leitura clinica 18/1.75, max 68ch (UX-SPEC 3.1). */
export function Textarea({ reading, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={cx(CONTROL, 'min-h-24', reading && 'max-w-[68ch] font-reading text-lg leading-[1.75]', className)}
      {...rest}
    />
  );
}
