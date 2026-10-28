# Padrão de projeto — LJS Software

> Prompt fornecido pelo usuário em 2026-10-24, gravado sem alterações. Ele define a stack, a infraestrutura e o deploy de **todos** os apps da LJS. Neste app, as exceções estão nas decisões D-01 a D-19 de [necessidade.md](necessidade.md); em caso de conflito, valem as decisões.

Você vai criar do zero a aplicação Evolução Segura. A mesma já existe em C:\Leandro\Projetos\EvolucaoSeguraWeb e vamos recriá-la.
Este prompt define a stack, a infraestrutura e o modelo de deploy que valem para TODOS os
apps da LJS Software. Não substitua nenhum item por outro sem justificar e perguntar antes.
Antes de escrever código, apresente um plano com etapas, arquivos e riscos para aprovação.

## 1. Estrutura do repositório (monorepo pnpm, TypeScript estrito)

- Node 24 (`engines` + `.nvmrc`), pnpm 11, `type: module` em todos os pacotes.
- Pacotes:
  - `backend/contrato` — schemas Zod e tipos compartilhados entre API e front (única fonte do contrato).
  - `backend/dominio` — regras de negócio puras, sem I/O, 100% testáveis.
  - `backend/api` — Hono rodando no Cloudflare Worker; único acesso ao banco.
  - `backend/scripts` — `migrar.ts`, `seed-local.ts`, scripts de operação.
  - `frontend/web` — React 19 + Vite + `vite-plugin-pwa` + React Router; TanStack Query para dados.
- Raiz: `wrangler.jsonc`, `docker-compose.yml` (só Postgres local), `eslint.config.mjs`,
  `.prettierrc`, `tsconfig.base.json`, `.gitleaks.toml`, `.env.example` comentado.
- Método: pasta `.md/` com `PRD.md`, `PRD-TECNICO.md`, `SDD.md`, `GUARDRAILS.md`,
  `THREAT-MODEL.md` e `adr/NNN-titulo.md`. Toda decisão de arquitetura vira ADR;
  decisão que muda uma anterior usa `Supersedes:`.
- Idioma do código e dos docs: português (nomes de pastas, tabelas, rotas e commits).

## 2. Infraestrutura (custo zero)

| Camada     | Padrão |
|------------|--------|
| Front      | Cloudflare Worker com `assets` (`directory: frontend/web/dist`, `not_found_handling: single-page-application`). |
| API        | Hono no MESMO Worker, rotas `/api/*` com `run_worker_first: ["/api/*"]`, `compatibility_flags: ["nodejs_compat"]`. Limite: 10 ms de CPU por requisição — espera de rede/banco não conta. |
| Banco      | Neon Free (Postgres, `sa-east-1`) acessado por Hyperdrive. Kysely + `pg`. Branch `main` = produção; branch `dev` para desenvolvimento. Cache do Hyperdrive desligado para dados que mudam por ação do usuário. |
| Roles      | `evolucao_owner` (DDL, só nas migrations), `evolucao_app` (runtime, sem DELETE/TRUNCATE onde não for regra), `evolucao_backup_ro` (leitura). |
| Isolamento | Toda tabela de negócio tem a coluna do dono (`usuario_id` ou equivalente); RLS com `FORCE ROW LEVEL SECURITY`; a API abre transação por requisição e faz `SET LOCAL app.usuario_id`. Teste negativo obrigatório: usuário B não lê nem escreve nada de A. |
| Auth       | Própria: sessão opaca (id 256 bits CSPRNG, guardado como SHA-256) em tabela; cookie `__Host-sid` (Secure, HttpOnly, SameSite=Lax, sem Domain). Hash de senha com bcrypt NO POSTGRES (`pgcrypto`, `crypt()/gen_salt('bf',12)`), senha sempre como parâmetro. Inatividade 15 min, absoluta 12 h, rotação no login. |
| Cadastro   | Aberto, com confirmação por e-mail (token 256 bits, hash no banco, 30 min, uso único). Anti-enumeração: mesma resposta e tempo para e-mail existente ou não. Bloqueio: 5 falhas em 15 min por e-mail e por IP, estado em tabela. Aceite de termos registrado (data, hora, versão). |
| E-mail     | Resend via `fetch` (sem SDK Node). Domínio `ljssoftware.com.br` já verificado; `MAIL_FROM` por app. Transacionais: confirmação, recuperação, cobrança gerada, pagamento confirmado, atraso. |
| Cobrança   | Asaas, assinatura mensal com Pix como método principal. Tabelas `assinatura` (`usuario_id`, `plano`, `status`, `asaas_customer_id`, `asaas_subscription_id`, `periodo_fim`) e `webhook_evento` (`event_id` único). Webhook em `POST /api/webhooks/asaas`: valida token, idempotente, fora da sessão. Estados: `trial → ativa → atrasada → cancelada → free`. Middleware `exigePlano('pro')`; limites do Free aplicados na API, nunca só no front. Trial 14 dias sem cartão; ao expirar cai para Free SEM apagar dados (excedente vira somente leitura). |
| Push       | Web Push nativo (VAPID). Tabela `push_subscription`. Assinatura do JWT ES256 com `crypto.subtle`. Disparo por Cron Trigger do Worker, em lotes com `ctx.waitUntil`. |
| Rate limit | Binding `ratelimits` do Worker: `LIMITE_ENTRAR` (10/min), `LIMITE_PUBLICO` (60/min), `LIMITE_WEBHOOK`. |
| Erros      | Sentry free: `@sentry/cloudflare` no Worker, `@sentry/react` no front; release = SHA; scrubbing de payload, cookie e e-mail nos logs. |
| Uptime     | UptimeRobot em `GET /api/health` (não toca o banco). |
| Backup     | `backup.yml` no GitHub Actions: diário 04:00 BRT, `pg_dump -Fc` com role `evolucao_backup_ro`, cifrado com `age` (chave pública em secret, privada fora do GitHub), artefato com retenção 30 dias. Teste de restauração documentado. |
| Domínio    | `<app>.ljssoftware.com.br` via `routes: [{ pattern, custom_domain: true }]`. Nenhuma URL absoluta no código ou no banco; única variável `URL_PUBLICA`, injetada no deploy. |
| PWA        | Manifest completo (ícones 192/512 maskable, `display: standalone`), service worker com precache do shell e handler de `push`/`notificationclick`, página offline, instrução de instalação no iOS. API com `Cache-Control: no-store`. Lighthouse PWA ≥ 90. |
| Segredos   | GitHub Secrets (environment `producao`) e `wrangler secret`. Nunca em arquivo versionado. `.env.example` lista toda variável com obrigatoriedade, formato e se é segredo. |

## 3. Desenvolvimento local

- `docker-compose.yml` sobe só o Postgres 18. `wrangler dev` roda o Worker com
  `localConnectionString` do Hyperdrive apontando para ele; Vite com proxy de `/api`.
- Comandos padrão na raiz: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm migrar`, `pnpm seed`, `pnpm dev`.
- Testes: Vitest; `@cloudflare/vitest-pool-workers` para a API; Testing Library no front;
  Playwright para e2e crítico (cadastro, login, assinar, fluxo principal do app).
- Migrations com `node-pg-migrate`, uma por mudança, sempre em transação, aplicadas do zero no CI.

## 4. CI/CD (GitHub Actions)

- `ci.yml` em push e PR: lint, typecheck, testes, gitleaks, build do web, migrations do zero
  num Postgres de serviço, teste de isolamento.
- `deploy.yml` com `workflow_dispatch`, SÓ pela `main`, environment `producao`, `concurrency`
  sem cancelamento. Ordem fixa:
  1. build do web (falha antes de tocar produção);
  2. dump cifrado com `age` (o ponto de volta; o Neon tem só as branches `main` e `dev`, e o
     deploy não cria nenhuma);
  3. migração com `NEON_URL_MIGRACAO` (role `evolucao_owner`);
  4. `wrangler deploy` com `--var URL_PUBLICA`.
  Único lugar do repositório com `wrangler deploy`; um teste falha se aparecer outro.
- `backup.yml` agendado + manual.
- Sem ambiente de homologação. Preview = `wrangler dev` local.

## 5. Produto (comum a todos os apps)

- Landing em `/` com proposta de valor, planos e "Começar grátis"; app em `/app`.
- Página "Meu plano": plano atual, renovação, Pix copia-e-cola/QR, cancelar.
- `/termos` e `/privacidade` em português, adequados à LGPD; exclusão de conta pelo usuário
  com e-mail de confirmação e purga em 30 dias.
- Dinheiro em centavos inteiros; datas de calendário no fuso `America/Sao_Paulo`.
- `README.md` (rodar local, variáveis, deploy, testar webhook local) e `docs/runbook.md`
  (webhook falhou, reprocessar pagamento, reativar usuário, rotacionar segredos, restaurar backup).
- Nenhuma dependência paga. Se algo exigir plano pago, pare e pergunte.

## 6. Específico deste app

Vamos olhar o projeto já existente para entender as regras de negócio. Se seguir com dúvidas me pergunte.

## 7. Formato de resposta

1. Resumo do entendimento e perguntas abertas (não assuma nada sobre cobrança, segurança ou limites de plano).
2. Plano em etapas numeradas com esforço, riscos e os ADRs que cada etapa cria.
3. Após aprovação: implemente etapa a etapa, um commit por etapa, informando o que foi feito,
   como validar e o que vem a seguir.
