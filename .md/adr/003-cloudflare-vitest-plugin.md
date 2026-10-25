# ADR-003: `@cloudflare/vitest-plugin` para testar o Worker

- **Status**: Aceito
- **Data**: 2026-10-24
- **Supersedes**: a citação a `@cloudflare/vitest-pool-workers` no [padrão LJS](../../.specs/produto/padrao-ljs.md), seção 3 (o padrão não é um ADR)
- **Origem**: STATE.md, AD-001; [design](../../.specs/features/evolucao-segura/design.md), Risks & Concerns e Tech Decisions [P-3]

## Contexto

O padrão LJS pede `@cloudflare/vitest-pool-workers` para testar a API. Esse pacote está descontinuado. Seu sucessor oficial é o `@cloudflare/vitest-plugin` (versão 1.4.7 na pesquisa de 2026-10-24, com Vitest 4 ou 5 como peer). O padrão LJS manda justificar e perguntar antes de trocar uma peça; o usuário aprovou a troca em 2026-10-24.

## Decisão

Testamos o Worker com `@cloudflare/vitest-plugin`, rodando os testes dentro do runtime do Worker, com o Hyperdrive local configurado por `miniflare.hyperdrives` apontando para o Postgres do Docker (porta 5433 no host).

O Vitest raiz (versão 5) usa `projects`; o projeto `backend/api` terá a configuração do plugin quando a tarefa T16 criar o harness.

## Consequências

- Mantemos o espírito do padrão (testes no runtime real do Worker) com um pacote mantido.
- A configuração é a do plugin, não a do pool; trocar de volta exige ADR com `Supersedes:`.
- A versão do Vitest fica limitada pelo peer do plugin.
- O AD-001 do `STATE.md` aponta para este ADR.
