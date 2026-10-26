/** Foco visivel de 3 px (RNF-11) e alvo minimo de 48 px. Sem estilo inline (CSP). */
export const FOCUS =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus';
export const TARGET = 'min-h-12 min-w-12';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
