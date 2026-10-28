# ADR-001: Stack e monorepo LJS

- **Status**: Aceito
- **Data**: 2026-10-24
- **Supersedes**: nenhum
- **Origem**: [padrão LJS](../../.specs/produto/padrao-ljs.md), seções 1 a 3; [design](../../.specs/features/evolucao-segura/design.md), Tech Decisions

## Contexto

O Evolução Segura é recriado no padrão da LJS Software: custo fixo zero, um Worker da Cloudflare, Postgres no Neon e deploy pelo GitHub Actions. O padrão vale para todos os apps da LJS e não se troca sem justificar.

## Decisão

Adotamos o padrão LJS como está, num monorepo pnpm com TypeScript estrito:

- Node 24 (`engines` e `.nvmrc`), pnpm 11, `type: module` em todos os pacotes.
- Cinco pacotes: `@es/contrato` (schemas Zod), `@es/dominio` (regras puras), `@es/api` (Hono no Worker), `@es/scripts` (migrations e operação) e `@es/web` (React 19, Vite, PWA).
- API e front no mesmo Worker, com `assets` e `run_worker_first: ["/api/*"]`.
- Banco Neon Postgres 18 por Hyperdrive (a mesma versão maior no Docker local, no CI e no `pg_dump` dos workflows; revisado em 2026-10-28, era 16), com Kysely e `pg`; um `Client` por requisição.
- Ferramentas: Vitest 5 com `projects` na raiz, ESLint 10 com typescript-eslint, Prettier, gitleaks, Docker Compose só com o Postgres 18 local (`postgres:18`, por tag: o projeto não fixa imagem por digest).
- Versões exatas no `package.json`, sem `^`.
- Documentação em `.md/` e decisões em `.md/adr/`.

Duas decisões de ferramenta tomadas na preparação:

- **TypeScript fixado em 6.0.3.** A versão 7.0 é a mais recente, mas o typescript-eslint 8.72 recusa TypeScript 7 e exige versão abaixo de 6.1. Mantemos 6.0.3 até o typescript-eslint suportar o 7.
- **Postgres local na porta 5433 do host.** A 5432 já é usada por outro projeto na máquina de desenvolvimento. Dentro do contêiner e no CI a porta continua 5432.

## Consequências

- Todos os apps da LJS compartilham a mesma estrutura, o que reduz custo de manutenção.
- O limite de 10 ms de CPU por requisição do plano gratuito obriga a manter hash de senha no Postgres e PDF no navegador (OPS-14).
- Trocar TypeScript 6 por 7 vira tarefa própria quando o typescript-eslint der suporte.
- Desvios do padrão exigem ADR novo com `Supersedes:`.
