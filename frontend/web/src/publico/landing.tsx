import { Link } from 'react-router';

// PUB-01 (T155): página inicial pública. Preços e limites exatamente como a spec: Free até 5
// pacientes ativos; Pro R$ 19,90/mês sem limite; trial de 14 dias.
// PREMISSA: textos da proposta de valor escritos pelo implementador; sem mockup, segue o padrão
// das demais telas públicas.
export function Landing() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold">Evolução Segura</h1>
        <p>
          O prontuário do consultório, simples e seguro: pacientes, agenda, anamnese, evolução das
          sessões e cobrança num só lugar, com seus dados sempre sob seu controle.
        </p>
        <Link to="/cadastro" className="self-start rounded border px-4 py-2 font-medium">
          Começar grátis
        </Link>
      </header>
      <section aria-labelledby="planos" className="flex flex-col gap-4">
        <h2 id="planos" className="text-xl font-semibold">
          Planos
        </h2>
        <p>Todo cadastro novo começa com 14 dias de teste do plano Pro.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <article className="flex flex-col gap-2 rounded border p-4">
            <h3 className="text-lg font-semibold">Free</h3>
            <p>R$ 0</p>
            <p>Até 5 pacientes ativos.</p>
          </article>
          <article className="flex flex-col gap-2 rounded border p-4">
            <h3 className="text-lg font-semibold">Pro</h3>
            <p>R$ 19,90/mês</p>
            <p>Sem limite de pacientes.</p>
          </article>
        </div>
      </section>
      <footer className="flex gap-4 text-sm">
        <Link to="/termos">Termos de uso</Link>
        <Link to="/privacidade">Política de privacidade</Link>
        <Link to="/entrar">Entrar</Link>
      </footer>
    </main>
  );
}
