# Evolução Segura

Aplicação web (PWA) de prontuário e evolução para profissionais de saúde. Um único Worker da
Cloudflare serve o front (React/Vite, em `frontend/web`) e a API (Hono, em `backend/api`, rotas
`/api/*`), com Postgres (Neon em produção, Hyperdrive) e migrations em `backend/scripts`.

Estrutura: `backend/api` (Worker), `backend/scripts` (migrations e scripts), `frontend/web` (app),
`e2e` (Playwright), `infra` (backup e restauração), `.github/workflows` (CI, deploy e backup).

Os comandos abaixo foram executados na máquina de desenvolvimento (Windows, Git Bash). Os que não
puderam ser executados estão marcados como **não executado**.

## Pré-requisitos

- Node.js 24 (`.nvmrc`; o `package.json` exige `>=24 <25`).
- pnpm 11 (`packageManager: pnpm@11.23.0`).
- Docker, para o Postgres 16 local (`docker-compose.yml`).
- Para o backup e a restauração (`infra/`): `psql`, `pg_restore` e `age` no PATH, e bash.

## Rodar localmente

```bash
# 1. Dependências
pnpm install --frozen-lockfile

# 2. Postgres 16 local (porta 5433 no host; usuário/senha postgres, banco evolucao_segura)
docker compose up -d

# 3. Migrations (usa DATABASE_URL; sem ela, o Postgres local acima)
pnpm migrar

# 3b. Só no ambiente local: libera o login da role app (as migrations a criam sem senha)
docker compose exec postgres psql -U postgres -d evolucao_segura -c "alter role app with login password 'app'"

# 4. Build do front (o Worker serve frontend/web/dist)
pnpm build:web
```

Subir o Worker local (front e API juntos em http://localhost:8787), a partir da raiz:

```bash
pnpm --filter @es/api exec wrangler dev --config ../../wrangler.jsonc --port 8787
```

O wrangler lê os segredos locais de um arquivo `.dev.vars` **na raiz do repositório**, ao lado do
`wrangler.jsonc` (já ignorado pelo git; o log mostra "Using secrets defined in ..\..\.dev.vars").
Crie-o com as variáveis do Worker de `.env.example`; o mínimo para subir e usar o webhook:

```
URL_PUBLICA=http://localhost:8787
HMAC_2FA_SEGREDO=<texto com 32 caracteres ou mais>
ASAAS_WEBHOOK_TOKEN=<texto com 32 caracteres ou mais>
ASAAS_API_KEY=<chave do sandbox do Asaas; qualquer texto serve se não for chamar o Asaas>
ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
```

O banco local vem do `localConnectionString` do Hyperdrive em `wrangler.jsonc` (Postgres do
docker-compose). Para apontar para outro banco, defina
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. No Windows, `Ctrl+C` pode deixar o
`workerd` vivo e ocupando a porta 8787: confira com `netstat -ano | findstr :8787` e encerre o
processo antes de subir de novo.

## Variáveis de ambiente

Só nomes e finalidade; os valores e segredos nunca vão para o repositório. A lista completa, com
formato e se é segredo, está em `.env.example`. Local: variáveis do Worker em
`.dev.vars` na raiz. Produção: segredos com `wrangler secret`, `URL_PUBLICA` com `--var`.

Worker:

- `URL_PUBLICA`: endereço público do app (links em e-mails, origem).
- `HMAC_2FA_SEGREDO`: segredo do HMAC do segundo fator.
- `MAIL_FROM`, `RESEND_API_KEY`: remetente e chave do Resend para enviar e-mails.
- `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`: cobrança no Asaas (chave, endereço da
  API, sandbox ou produção, e token que autentica o webhook).
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`: notificações push.
- `SENTRY_DSN`, `SENTRY_RELEASE`: monitoramento de erros (opcionais).
- `E2E_EMAIL_CAPTURA_URL`: só no e2e local, desvia os e-mails para um coletor; nunca em produção.

Build do front (entram no bundle, nunca ponha segredo): `VITE_SENTRY_DSN`, `VITE_SENTRY_RELEASE`.

Testes e scripts: `DATABASE_URL` (padrão: Postgres do docker-compose; é a URL da role owner em
produção ao rodar `pnpm migrar`).

Pipeline (GitHub Secrets do environment `producao`): `NEON_URL_MIGRACAO`, `NEON_URL_BACKUP`,
`NEON_URL_APP`, `NEON_API_KEY`, `NEON_PROJECT_ID`, `NEON_ROLE_OWNER`, `NEON_DATABASE`,
`AGE_PUBLIC_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

## Testar

Com o Postgres local no ar (`docker compose up -d`) e as migrations aplicadas:

```bash
pnpm lint            # eslint + prettier --check
pnpm typecheck       # tsc em todos os pacotes
pnpm test            # vitest (unidade e integração): 198 arquivos, 3080 testes
pnpm test:isolamento # só os testes de isolamento entre contas (usado no CI)
pnpm e2e             # Playwright: sobe coletor de e-mail e Worker local, banco evolucao_segura_e2e
```

O gate do projeto (`.specs/projeto/testes.json`) é `pnpm lint && pnpm typecheck && pnpm test`.

Observações da execução na máquina de desenvolvimento (Windows):

- `pnpm test:isolamento` falhou aqui com `Startup Error: code.charCodeAt is not a function` (erro
  do vitest ao carregar a configuração a partir de `backend/api`). A mesma suíte passa pela raiz:
  `pnpm exec vitest run backend/api/test/isolamento` (19 testes). O comando do CI não foi
  confirmado aqui.
- `pnpm e2e`: na primeira vez, `pnpm --filter @es/e2e exec playwright install chromium`. Dos 8
  testes, 6 passaram. `plano.spec.ts` e `plano-webhook.spec.ts` falharam: precisam do sandbox do
  Asaas (`ASAAS_API_KEY` real no ambiente) e falharam já no cadastro da conta. Os dois ficam
  como **não confirmados** neste ambiente.
- Se algo já escuta a porta 8787 (um `wrangler dev` esquecido), o e2e conversa com ele em vez do
  Worker novo e falha de formas confusas; encerre-o antes.

## Deploy

O deploy é feito só pelo workflow `.github/workflows/deploy.yml` (único lugar que roda
`wrangler deploy`): dump cifrado pré-deploy, `pnpm migrar` com a role owner e `wrangler deploy`
do Worker com `URL_PUBLICA` e `SENTRY_RELEASE`. O backup diário é o `backup.yml`. Passo a passo,
incluindo reversão e incidentes: `docs/runbook.md` (a ser escrito; ainda não existe).
Nenhum comando de deploy foi executado: **não executado** (exige contas Cloudflare e Neon).

## Backup e restauração

Dois scripts em `infra/` (bash; precisam de `psql` e `pg_restore`, e de `age` para dumps `.age`).

`infra/restore-test.sh <backup.dump.age|backup.dump>` restaura o dump num banco descartável,
imprime a contagem de linhas por tabela e apaga o banco. Variáveis:

- `RESTORE_ADMIN_URL` (obrigatória): Postgres descartável, nunca produção; o script só aceita os
  hosts `localhost` e `127.0.0.1` (ajustável por `RESTORE_ALLOWED_HOSTS`).
- `RESTORE_AGE_IDENTITY`: arquivo da chave privada age (obrigatório para `.age`).
- `RESTORE_SOURCE_URL`: se definida, compara as contagens com a origem.
- `RESTORE_KEEP=1`: não apaga o banco restaurado.

`infra/comparar-contagens.sh <url_origem> <url_restaurado>` compara a contagem por tabela entre
dois bancos e sai com código 1 se houver divergência.

Exemplo local completo (executado), com o Postgres do docker-compose e um banco de origem
descartável, sem segredos reais. Em produção o dump vem cifrado do `backup.yml` (arquivo `.age`).

```bash
U=postgresql://postgres:postgres@localhost:5433
psql -c "create database origem_demo" $U/postgres
DATABASE_URL=$U/origem_demo pnpm migrar
pg_dump -Fc -f amostra.dump $U/origem_demo      # as opções vêm antes da URL
RESTORE_SOURCE_URL=$U/origem_demo RESTORE_ADMIN_URL=$U/postgres   infra/restore-test.sh amostra.dump
infra/comparar-contagens.sh $U/origem_demo $U/origem_demo
psql -c "drop database origem_demo with (force)" $U/postgres
```

Para um `.age`, gere o par com `age-keygen -o chave.txt`, cifre com `age -r <chave pública> -o
amostra.dump.age amostra.dump` e restaure com `RESTORE_AGE_IDENTITY=chave.txt`. Use um banco de
origem limpo: um banco de desenvolvimento sujo pelos testes pode ter dados que violam chaves
estrangeiras e o restore falha de propósito.

## Testar o webhook do Asaas localmente

A rota é `POST /api/webhooks/asaas`. Ela exige o cabeçalho `asaas-access-token` igual a
`ASAAS_WEBHOOK_TOKEN` (sem ele ou com outro valor: 401). O corpo precisa de `id` (único por
evento, ex.: `evt_xxx&1`) e `event` (ex.: `PAYMENT_RECEIVED`); eventos de pagamento levam
`payment.subscription` e `payment.customer`, que devem existir numa assinatura da conta.

1. Defina `ASAAS_WEBHOOK_TOKEN` (32 caracteres ou mais) no `.dev.vars` e suba o Worker (seção
   "Rodar localmente"; precisa do banco migrado e da role app liberada).
2. Envie um evento simulado (executado; `$T` é o valor do token):

```bash
curl -i -X POST http://localhost:8787/api/webhooks/asaas   -H "asaas-access-token: $T" -H "content-type: application/json"   -d '{"id":"evt_local_1&1","event":"PAYMENT_UPDATED"}'
```

Resultados observados: primeira chamada `200 {"status":"processado"}`; a mesma chamada de novo
`200 {"status":"repetido"}` (deduplicado pelo `id`); token errado `401`; corpo sem `id` `422`.

Eventos com tratamento (`PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`,
`PAYMENT_OVERDUE`) precisam de `payment.subscription` e `payment.customer` de uma assinatura que
exista na conta; sem ela o Worker responde `500` de propósito (o Asaas reenvia) e nada é gravado.
Para criar essa assinatura use a tela de plano com o sandbox do Asaas. O fluxo completo está
automatizado em `e2e/plano-webhook.spec.ts` (`pnpm e2e`), que **não foi confirmado** aqui por
depender da chave do sandbox. Para receber eventos reais do sandbox, exponha a porta 8787 com um
túnel (por exemplo `cloudflared tunnel`) e cadastre a URL e o token no painel do Asaas:
**não executado** (exige conta e túnel externos).
