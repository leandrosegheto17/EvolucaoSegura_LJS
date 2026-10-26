export const MAIN_ID = 'conteudo';

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      className="absolute left-2 top-2 z-50 -translate-y-24 rounded-card bg-pri px-4 py-3 text-onpri focus:translate-y-0 focus:outline-4 focus:outline-focus"
      onClick={(e) => {
        e.preventDefault();
        const main = document.getElementById(MAIN_ID);
        main?.focus();
        main?.scrollIntoView?.();
      }}
    >
      Pular para o conteúdo
    </a>
  );
}
