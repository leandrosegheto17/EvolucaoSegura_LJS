# Estado

## Retomada

- **Fluxo**: 2, Aplicação para uso próprio (skill `uso-proprio`). Na prática é um produto vendido no padrão LJS; o usuário escolheu seguir por este fluxo (ver `necessidade.md`).
- **Item**: `.specs/features/evolucao-segura/` (`spec.md`, `context.md`, `design.md`, `tasks.md`); produto em `.specs/produto/`; spikes em `.specs/spikes/`
- **Fase aprovada**: 6, Construção, lotes 1 a 3 (T1 a T36, Phases 1 a 4) em 2026-10-25; spikes S1, S2 e S4 concluídos e aprovados
- **Próxima fase**: 6, Construção, lote 4 = Phase 5 (acesso, cadastro e confirmação, T37 a T45) — modelo indicado: sonnet. Despachar `implementador-dominio` (identidade, senha e 2FA são regra difícil) ou `implementador`, um lote por vez, como nos lotes 1 a 3. Padrão de commit: um por tarefa, `[x]` no `tasks.md` no mesmo commit.
- **Construção** (no meio): lotes 1 a 3 concluídos, 203 testes verdes, trava de testes verde no commit e01d746. Os commits dos lotes 1 a 3 (até e01d746) já estão em `origin/main` (o agente relatou não ter enviado nada; ainda assim o remoto os tem, origem do push não apurada). O commit desta retomada é local até o próximo push (que exige confirmação específica). O tlc retoma por `tasks.md` (itens `[x]`) e pelo git. Cada etapa fecha com relatório (feito, como validar, próximo; AD-002).
- **Pendências do lote 3 a fechar no início da próxima sessão** (documentos, sem código):
  - Apontar a entrada AD-005 do `## Decisions` para `.md/adr/005-rls-transacao-por-requisicao-e-funcoes-de-tarefa.md`.
  - Atualizar a tabela de rastreabilidade da `spec.md` (ISO-*, AUD-*, OPS-13), que segue "Pending".
  - O runbook precisa descrever o provisionamento de login e senha das roles `owner`, `app` e `backup_ro` no Neon (nascem `NOLOGIN`).
  - Depois do primeiro deploy, fazer um teste de fumaça de vazamento de contexto entre conexões reaproveitadas do Hyperdrive (o teste local não pega; ver ADR-005).
- **Combinado na conversa e não registrado em artefato**:
  - **Tabelas de identidade** (`sessao`, `desafio_2fa` etc.) ficam sem RLS conforme o design; o teste de isolamento (`backend/api/test/isolamento/isolamento.test.ts`) ganha uma **lista explícita de exceções, cada uma com justificativa**, revisada tabela a tabela na Phase 5.
  - **Ator da auditoria sem usuário = `'sistema'`** (não `'system'` do legado). Mantido como está.
  - Premissas do lote 3 aceitas: IPv6 truncado em /48 com `::` expandido; eventos de exclusão `conta.exclusao_pedida/confirmada/desistida`; eventos de assinatura usam o alvo `conta`; `usuario.provisionado` removido.
  - Infra de teste da API: o binding `HYPERDRIVE` conecta como a role `app` (RLS valendo); `HYPERDRIVE_ADMIN` (superusuário) só semeia e confere; o globalSetup `backend/api/test/preparar-banco.ts` aplica as migrations. O passo "Migrations do zero" do CI deixou de ser realmente do zero.
  - O usuário quer ter **os três apps LJS prontos e publicados**. Este é um deles; os outros dois dividem a mesma conta Cloudflare (5 crons) e o Resend (3 domínios).
  - O legado (`C:\Leandro\Projetos\EvolucaoSeguraWeb`) é **somente leitura**. Lá existe uma refatoração em andamento (`.specs/refatoracoes/padronizar-stack-infra-deploy/`) que esta recriação torna desnecessária. Não mexer nela.
  - **Spike S3 (`asaas-sandbox`, T14) segue pendente**: o usuário ainda não tem conta no sandbox do Asaas. Antes da Phase 15 (etapa 12) perguntar de novo; o critério e o prazo já estão aprovados em `.specs/spikes/asaas-sandbox/spike.md`.
  - **O CI do GitHub não roda**: o job não inicia por problema de cobrança da conta `leandrosegheto17` (pagamentos recentes falharam ou limite de gastos). Conferir Billing & plans; depois reexecutar com `gh run rerun`. A suíte local está verde.
  - Aviso da Cloudflare, Neon, Asaas, Resend e Sentry: nada foi criado nessas contas além dos recursos de spike, que foram apagados. O Neon e a Cloudflare ficaram logados (`neonctl auth`, `wrangler login`) nesta máquina.
  - O Postgres local do projeto roda no Docker na porta **5433** (a 5432 é de outro projeto); o banco local `evolucao_segura` acumula linhas de teste no `audit_log` (só de inclusão), sem efeito nos testes.
  - Windows com notificações desligadas esconde o push do Chrome (relevante para testes manuais de push).
- **Gravada em**: 2026-10-25 00:10

## Decisions

- **AD-001** (2026-10-24, active): testes do Worker com `@cloudflare/vitest-plugin`, sucessor do `@cloudflare/vitest-pool-workers` (descontinuado) citado no padrão LJS. Aprovado pelo usuário. Registrado no [ADR-003](../.md/adr/003-cloudflare-vitest-plugin.md). Ver `features/evolucao-segura/design.md`.
- **AD-002** (2026-10-24, active): um commit atômico por tarefa (tlc); o "um commit por etapa" do padrão LJS vira um relatório ao fechar cada etapa (o que foi feito, como validar, o que vem a seguir). Aprovado pelo usuário.
- **AD-003** (2026-10-24, active): exportação completa paginada por tabela com cursor; o navegador junta as páginas e monta `dados.json` e `.zip` (spec D-32, EXP-03 a EXP-06, T122). Motivo: o spike `cpu-exportacao` mediu cerca de 1 s de CPU e 39,65 MB para a exportação inteira numa resposta, contra 10 ms por requisição no Free. Aprovado pelo usuário. Ver `.specs/spikes/cpu-exportacao/registro.md`.
- **AD-004** (2026-10-24, active): push com a cifra de `@block65/webcrypto-web-push` e JWT VAPID assinado pelo próprio projeto, sem a claim `iat` (o FCM recusa JWT com `iat`). Ver `.specs/spikes/push-worker/registro.md` e a T142.
- **AD-005** (2026-10-24, active): rate limit pelo binding `ratelimits` (funciona no Free, limite efetivo ±1) e contexto do RLS por `set_config('app.usuario_id', $1, true)` dentro de `BEGIN`. Ver `.specs/spikes/rate-limit-free/registro.md` e `.specs/spikes/set-local-hyperdrive/registro.md`. Detalhes da transação por requisição e das funções `tarefas.*` no [ADR-005](../.md/adr/005-rls-transacao-por-requisicao-e-funcoes-de-tarefa.md).
- **AD-006** (2026-10-25, active): autenticação própria (bcrypt de custo 12 só no Postgres, 2FA por e-mail com HMAC, sessão opaca com SHA-256, tabelas de identidade sem RLS com exceções explícitas no harness) e rate limit por IP com o binding `ratelimits`, um namespace por grupo (acesso 10/min, público 60/min, webhook 120/min, este por PREMISSA), limite aproximado (±1). Ver [ADR-006](../.md/adr/006-autenticacao-propria-e-rate-limit.md) e a T43.
