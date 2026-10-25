# Estado

## Retomada

- **Fluxo**: 2, Aplicação para uso próprio (skill `uso-proprio`). Na prática é um produto vendido no padrão LJS; o usuário escolheu seguir por este fluxo (ver `necessidade.md`).
- **Item**: `.specs/features/evolucao-segura/` (`spec.md`, `context.md`, `design.md`, `tasks.md`); produto em `.specs/produto/`; spikes em `.specs/spikes/`
- **Fase aprovada**: 6, Construção, lotes 1 e 2 (T1 a T28, Phases 1 a 3) em 2026-10-24; spikes S1, S2 e S4 concluídos e aprovados
- **Próxima fase**: 6, Construção, lote 3 = Phase 4 (banco base, T29 a T37) — modelo indicado: sonnet. Despachar `implementador` (ou `implementador-dominio` quando a regra for difícil), um lote por vez, como nos lotes 1 e 2.
- **Construção** (no meio): lotes 1 e 2 concluídos, 96 testes verdes, trava de testes verde no commit 985cbcd e tudo em `origin/main` (GitHub privado `leandrosegheto17/EvolucaoSegura_LJS`). O tlc retoma por `tasks.md` (itens `[x]`) e pelo git. Cada etapa fecha com relatório (feito, como validar, próximo; AD-002).
- **Combinado na conversa e não registrado em artefato**:
  - O usuário quer ter **os três apps LJS prontos e publicados**. Este é um deles; os outros dois dividem a mesma conta Cloudflare (5 crons) e o Resend (3 domínios).
  - O legado (`C:\Leandro\Projetos\EvolucaoSeguraWeb`) é **somente leitura**. Lá existe uma refatoração em andamento (`.specs/refatoracoes/padronizar-stack-infra-deploy/`) que esta recriação torna desnecessária. Não mexer nela.
  - **Spike S3 (`asaas-sandbox`, T14) segue pendente**: o usuário ainda não tem conta no sandbox do Asaas. Antes da Phase 15 (etapa 12) perguntar de novo; o critério e o prazo já estão aprovados em `.specs/spikes/asaas-sandbox/spike.md`.
  - **O CI do GitHub não roda**: o job não inicia por problema de cobrança da conta `leandrosegheto17` (pagamentos recentes falharam ou limite de gastos). Conferir Billing & plans; depois reexecutar com `gh run rerun`. A suíte local está verde.
  - Aviso da Cloudflare, Neon, Asaas, Resend e Sentry: nada foi criado nessas contas além dos recursos de spike, que foram apagados. O Neon e a Cloudflare ficaram logados (`neonctl auth`, `wrangler login`) nesta máquina.
  - O Postgres local do projeto roda no Docker na porta **5433** (a 5432 é de outro projeto).
  - Windows com notificações desligadas esconde o push do Chrome (relevante para testes manuais de push).
- **Gravada em**: 2026-10-24 23:40

## Decisions

- **AD-001** (2026-10-24, active): testes do Worker com `@cloudflare/vitest-plugin`, sucessor do `@cloudflare/vitest-pool-workers` (descontinuado) citado no padrão LJS. Aprovado pelo usuário. Registrado no [ADR-003](../.md/adr/003-cloudflare-vitest-plugin.md). Ver `features/evolucao-segura/design.md`.
- **AD-002** (2026-10-24, active): um commit atômico por tarefa (tlc); o "um commit por etapa" do padrão LJS vira um relatório ao fechar cada etapa (o que foi feito, como validar, o que vem a seguir). Aprovado pelo usuário.
- **AD-003** (2026-10-24, active): exportação completa paginada por tabela com cursor; o navegador junta as páginas e monta `dados.json` e `.zip` (spec D-32, EXP-03 a EXP-06, T122). Motivo: o spike `cpu-exportacao` mediu cerca de 1 s de CPU e 39,65 MB para a exportação inteira numa resposta, contra 10 ms por requisição no Free. Aprovado pelo usuário. Ver `.specs/spikes/cpu-exportacao/registro.md`.
- **AD-004** (2026-10-24, active): push com a cifra de `@block65/webcrypto-web-push` e JWT VAPID assinado pelo próprio projeto, sem a claim `iat` (o FCM recusa JWT com `iat`). Ver `.specs/spikes/push-worker/registro.md` e a T142.
- **AD-005** (2026-10-24, active): rate limit pelo binding `ratelimits` (funciona no Free, limite efetivo ±1) e contexto do RLS por `set_config('app.usuario_id', $1, true)` dentro de `BEGIN`. Ver `.specs/spikes/rate-limit-free/registro.md` e `.specs/spikes/set-local-hyperdrive/registro.md`.
