# Validação do README por agente sem contexto (T192)

Data: 2026-10-28. Commit validado: `7598015` (README). O agente usou só o `README.md` e o que ele
manda abrir, num worktree limpo em `%TEMP%` (e um segundo, `C:\es-wt2`, só para isolar um erro).
Ambiente: Windows 11, Git Bash, Node 24.16.0, pnpm 11.23.0, Docker, `psql`/`pg_restore`/`age` no
PATH.

Banco: a porta 5433 e o container `evolucao-segura-postgres` já eram do banco de desenvolvimento do
usuário; nada dele foi tocado. A validação usou um container próprio (`es-readme-val-pg`, porta
5440), removido no fim.

## Passos

| # | Passo do README | Comando | Resultado |
|---|---|---|---|
| 1 | Pré-requisitos | `node -v`, `pnpm -v`, `docker ps`, `which psql pg_restore age` | OK (24.16.0, 11.23.0) |
| 2 | Instalar | `pnpm install --frozen-lockfile` | OK, 19 s |
| 3 | Subir o banco | `docker compose up -d` | **Não executado como escrito**: ver tropeço 1. Usado `docker run ... -p 5440:5432 postgres:16` |
| 4 | Migrar | `DATABASE_URL=...5440... pnpm migrar` | OK, 23 migrations |
| 5 | Passo 3b | `alter role app with login password 'app'` (via `docker exec`) | OK |
| 6 | Build do front | `pnpm build:web` | OK |
| 7 | `.dev.vars` | Criado na raiz com as 5 variáveis do README | Log: "Using secrets defined in ..\..\.dev.vars" (README correto) |
| 8 | Subir o Worker | `pnpm --filter @es/api exec wrangler dev --config ../../wrangler.jsonc --port 8787` com `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` apontando para 5440 | OK, "Ready on http://127.0.0.1:8787"; `GET /` 200 |
| 9 | Webhook | `curl` do README | 1ª `200 processado`; repetida `200 repetido`; sem `id` `422`; token errado `401`. Igual ao README |
| 10 | `pnpm lint` | | OK |
| 11 | `pnpm typecheck` | | OK |
| 12 | `pnpm test` | | Falhou nas primeiras vezes (tropeço 4); depois **198 arquivos, 3080 testes passaram**, ~4,5 min |
| 13 | `pnpm test:isolamento` | | Falha com `code.charCodeAt is not a function`, como o README já avisa; `pnpm exec vitest run backend/api/test/isolamento` passa (19 testes) |
| 14 | Backup: origem demo + `pg_dump` | bloco do README (porta 5440) | OK |
| 15 | `infra/restore-test.sh amostra.dump` | idem | `status=ok`, 19 s |
| 16 | `infra/comparar-contagens.sh` | idem | `resultado=ok` |
| 17 | Dump `.age` | `age-keygen`, `age -r`, `RESTORE_AGE_IDENTITY` | `status=ok` |
| 18 | `drop database origem_demo` | | OK |
| 19 | `pnpm e2e` | | **Não executado aqui**: depende do Chromium do Playwright e do sandbox do Asaas (o README já diz que 2 dos 8 não passam sem chave) |
| 20 | Deploy, webhook real do Asaas com túnel | | **Não executável aqui** (contas Cloudflare, Neon, Asaas) |

## Tropeços e correções

1. **Porta 5433 e nome do container fixos no `docker-compose.yml`.** Com outro Postgres na máquina
   o passo 2 falha, e o README não dizia o que fazer nem que `DATABASE_URL` e a variável do
   Hyperdrive redirecionam tudo. Correção: parágrafo novo em "Rodar localmente" com o `docker run`
   alternativo, o `export DATABASE_URL`, a variável do Hyperdrive e o passo 3b adaptado.
2. **Processos do wrangler sobrevivem ao encerramento.** Mesmo após matar o `workerd`, voltaram
   `node`, `esbuild` e novo `workerd`, ainda escutando a 8787 e travando a pasta do worktree
   (`Permission denied` ao mover `.wrangler`/`dist`). O README só falava do `workerd`. Correção:
   texto sobre `taskkill /PID <pid> /F /T` e sobre `node`/`esbuild` remanescentes.
3. **`$T` do webhook não era definido.** O `curl` usava `$T` sem dizer de onde vinha no texto do
   comando. Correção: linha `T=<o valor de ASAAS_WEBHOOK_TOKEN>` antes do `curl`.
4. **`pnpm test` na raiz falhou numa cópia limpa** com `Startup Error: code.charCodeAt is not a
   function` (o mesmo erro do `test:isolamento`, projeto `@es/api`), embora o README dissesse só
   que o `test:isolamento` falha. Em `C:\es-wt2` e no primeiro worktree falhou nas primeiras
   execuções; depois que se editou e desfez uma linha em `node_modules/.../vite/.../module-runner.js`
   (só para ver o erro real), todas as execuções passaram. Causa **não isolada** (suspeita de cache
   do vite/vitest num primeiro uso). Correção: nota honesta no README com a alternativa
   (reinstalar e repetir). Fica como pendência de investigação.
5. **Duração não informada.** `pnpm test` leva ~4,5 min. Correção: dito ao lado do comando.
6. **Comentário do `.env.example`** mandava criar `backend/api/.dev.vars`; o wrangler lê na raiz.
   Corrigido em commit separado (`docs(env)`).

Sem tropeço: pré-requisitos, instalação, migrations, build, `.dev.vars`, subida do Worker,
webhook e backup/restauração (inclusive `.age`) funcionaram como escritos. O README já cita
`age-keygen`; ele vem junto com o `age`.

## Não executado

- `docker compose up -d` literal (porta/nome ocupados pelo banco do usuário).
- `pnpm e2e`.
- Deploy e workflows (Cloudflare, Neon, GitHub).
- Webhook real do Asaas (conta e túnel externos); a chave do Asaas usada foi um texto qualquer.

## Resíduos

Os worktrees foram removidos do git (`git worktree remove`/`prune`). As pastas
`%TEMP%\es-readme-wt` e `C:\es-wt2` ainda existem com `node_modules`; a remoção por script foi
bloqueada pela política de segurança e deve ser feita à mão. O container `es-readme-val-pg` foi
removido.
