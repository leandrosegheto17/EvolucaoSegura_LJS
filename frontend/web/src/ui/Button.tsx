import type { ButtonHTMLAttributes } from 'react';
import { FOCUS, TARGET, cx } from './classes';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline';
  full?: boolean;
};

export function Button({ variant = 'primary', full, className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        TARGET,
        FOCUS,
        'inline-flex items-center justify-center gap-2 rounded-card border-2 border-pri px-4 font-semibold disabled:cursor-not-allowed disabled:opacity-60',
        variant === 'primary' ? 'bg-pri text-onpri' : 'bg-transparent text-pri',
        full && 'w-full',
        className,
      )}
      {...rest}
    />
  );
}
