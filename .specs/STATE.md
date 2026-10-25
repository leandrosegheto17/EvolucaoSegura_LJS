# Estado

## Retomada

- **Fluxo**: 2, Aplicação para uso próprio (skill `uso-proprio`). Na prática é um produto vendido no padrão LJS; o usuário escolheu seguir por este fluxo (ver `necessidade.md`).
- **Item**: `.specs/features/evolucao-segura/` (`spec.md`, `context.md`, `design.md`); produto em `.specs/produto/`
- **Fase aprovada**: 5, Preparação (Tasks): `tasks.md` com 165 tarefas em 19 fases aprovado em 2026-10-24; fase 4 (spec e design) aprovada antes
- **Próxima fase**: 5 e 6, Preparação e construção (`tlc-spec-driven` Tasks e Execute), com modelo indicado sonnet
- **Construção**: não iniciada. Execução por subagentes em lotes (~7 tarefas, fases inteiras), começando pela Phase 1 (T1 a T15: preparação e spikes S1 a S4).
- **Combinado na conversa e não registrado em artefato**:
  - O usuário quer ter **os três apps LJS prontos e publicados**. Este é um deles; os outros dois dividem a mesma conta Cloudflare (5 crons) e o Resend (3 domínios).
  - O legado (`C:\Leandro\Projetos\EvolucaoSeguraWeb`) é **somente leitura**. Lá existe uma refatoração em andamento (`.specs/refatoracoes/padronizar-stack-infra-deploy/`) que esta recriação torna desnecessária. Não mexer nela.
  - O repositório ainda não tem commits (`.claude/`, `.gitignore` e `.specs/` sem rastreio); a etapa 1 faz o primeiro commit.
- **Gravada em**: 2026-10-24

## Decisions

- **AD-001** (2026-10-24, active): testes do Worker com `@cloudflare/vitest-plugin`, sucessor do `@cloudflare/vitest-pool-workers` (descontinuado) citado no padrão LJS. Aprovado pelo usuário. Registrado no [ADR-003](../.md/adr/003-cloudflare-vitest-plugin.md). Ver `features/evolucao-segura/design.md`.
- **AD-002** (2026-10-24, active): um commit atômico por tarefa (tlc); o "um commit por etapa" do padrão LJS vira um relatório ao fechar cada etapa (o que foi feito, como validar, o que vem a seguir). Aprovado pelo usuário.
