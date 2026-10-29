# Validação: ci-globalsetup-api (correção do commit eafa70b)

Veredito: **PASS** (com uma ressalva de cobertura, item 2)

Branch `bug/ci-globalsetup-api`, comparada com `main`. Verificador independente, sem confiar no relato do autor. Não existe `relato.md` nesta pasta; a fonte da verdade foi o pedido (relato e itens 1 a 5).

## Causa declarada: confirmada

- Sem a correção, o projeto mínimo reproduz o relato do CI: `No test files found`, depois `Startup Error: TypeError: code.charCodeAt is not a function`.
- A pilha mostra a cadeia: `Error.prepareStackTrace` do jiti (`jiti/dist/babel.cjs`) delega ao do Vite (`vite/dist/node/module-runner.js:1102 prepareStackTrace` → `getRunnerSourceMap` → `extractInlineSourceMap:366`), que lança. Isso casa com a causa declarada (gancho do Vite chamado quando o jiti formata uma pilha).
- Com `semGanchoDePilha` ativo, o mesmo projeto passa (`Tests 1 passed`, status 0), com `JITI_FS_CACHE=false`.
- Nuance: o `TypeError` aparece dentro do `reportStartError` do Vitest (`startVitest`), ou seja, o gancho também estraga a impressão do erro original. Isso explica por que o CI só mostrava o erro opaco. Não muda a correção.

## 1. O teste novo falha sem a correção e passa com ela: OK

Cópia isolada (`git worktree` temporário, `node_modules` por junção, descartada ao fim).

| Cenário | Resultado |
|---|---|
| Código do commit | `preparar-banco-api.test.ts`: 8 passed (8) |
| M1: `preparar-banco.ts` revertido para o de `main` | 1 failed, 7 passed. Falha em `backend/scripts/test/preparar-banco-api.test.ts:96`: `expect(saida).not.toMatch(/No test files found\|Startup Error\|charCodeAt/)`, com a saída "No test files found" + "Startup Error ... charCodeAt" |
| M3: remover `Error.prepareStackTrace = undefined;` (`preparar-banco.ts:24`) | 1 failed, 7 passed. Morta |
| M2: remover `Error.prepareStackTrace = original;` (`preparar-banco.ts:28`) | 8 passed. **SOBREVIVEU** (ver item 2) |

Sensor: 3 mutações, 2 mortas, 1 sobreviveu.

Asserções do teste (`backend/scripts/test/preparar-banco-api.test.ts`): `:96` sem as mensagens do defeito; `:97` `toMatch(/Tests\s+1 passed/)`; `:98` `status` 0. O valor esperado é o que o relato define (a suíte roda). O processo filho usa `JITI_FS_CACHE: 'false'` (`:92`), o que reproduz o CI sem cache.

## 2. Restauração do gancho se `migrar()` lançar: correta no código, sem teste

- `backend/api/test/preparar-banco.ts:21-31`: o gancho original é guardado, a restauração `Error.prepareStackTrace = original` está num `finally`, então roda também quando `trabalho()` rejeita. Está correto por leitura.
- `preparar-banco.ts:60-67`: se a migração lançar, o `catch` (`:76-78`) chama `apagar()` e relança; o gancho já foi restaurado antes.
- **Lacuna de cobertura (baixa gravidade):** nenhum teste exercita a restauração. A mutação M2 (não restaurar) sobrevive. O efeito prático é pequeno (o globalSetup roda uma vez e o gancho do jiti/Vite só importa na migração), mas "restaura mesmo se lançar" não está provado por teste. `semGanchoDePilha` não é exportada, o que dificulta testá-la isolada.

## 3. Mesmo defeito em outros pontos: não encontrado

Grep por `globalSetup`, `migrar(`, `jiti`, `node-pg-migrate`, `prepareStackTrace` em todo o repositório:

- O único `globalSetup` real é `backend/api/vitest.config.ts:27` (`./test/preparar-banco.ts`), e o `test:isolamento` (`backend/api/package.json:9`) usa a mesma configuração, então também fica coberto. O outro `globalSetup` é a fixture do próprio teste novo.
- Outros chamadores de `migrar()`: `backend/scripts/test/banco.ts:32`, `migrar.test.ts`, `migration-0025-backup-leitura.test.ts:89`, `migrations-sem-superusuario.test.ts`, `trava-host.test.ts`. São chamados dentro de testes (workers), não do globalSetup. Prova empírica: suíte completa da raiz com `JITI_FS_CACHE=false` (como no CI): 209 de 210 arquivos e 3309 de 3310 testes passaram. A única falha (`wrangler-deploy.test.ts`, EISDIR) é artefato das junções de `node_modules` da minha cópia; na árvore real o arquivo passa (3 passed) com `JITI_FS_CACHE=false`.
- `e2e/apoio/preparar-banco.ts:30` chama `migrar()` fora do Vitest (Playwright), sem o gancho do Vite; não é afetado. `pnpm migrar` e `pnpm migrar` do CI rodam em Node puro.
- Nenhum outro uso de `Error.prepareStackTrace` no código do projeto.
- Observação (não é defeito deste bug): a suíte de `backend/scripts` deixa bancos `es_migrar_*` e `es_com_su_*`/`es_sem_su_set_*` no Postgres local (dezenas já existiam antes desta verificação). Não vêm do teste novo.

## 4. Banco temporário, processos e banco remoto: OK

- Lista de bancos do Postgres local (5433) antes e depois da execução do teste novo na árvore real: idêntica (`diff` sem saída). Após as rodadas da cópia (inclusive a que falhou na migração em M1), `select datname ... like 'es_api%'` retorna vazio: o `catch` de `preparar-banco.ts:76-78` apaga o banco na falha, e a função devolvida apaga no fim.
- Sem processo para trás: `spawnSync` é síncrono, com `timeout: 110_000` (`:93`) e o teste com 120 s (`:99`). Nenhum `vitest` remanescente após as rodadas.
- Sem banco remoto: `DATABASE_URL` ou o padrão `localhost:5433` (`fixtures/globalsetup-api/setup.ts:3-4`), e `prepararBancoEm` chama `exigirHostLocal` (`preparar-banco.ts:38`), que recusa host remoto. Nome `es_api_g_<ts>_<rand>` passa no `NOME_VALIDO` (`/^es_api_[a-z0-9_]+$/`).
- Árvore real: `git status --porcelain` vazio antes e depois; worktree temporária removida e `git worktree list` sem ela; `node_modules` reais intactos.

## 5. Nenhum teste existente apagado ou enfraquecido: OK

`git diff main...bug/ci-globalsetup-api --stat`: 5 arquivos, 72 inserções, 5 remoções. As 5 remoções são todas em `preparar-banco.ts` (o bloco `migrar` reindentado dentro de `semGanchoDePilha`). `preparar-banco-api.test.ts` só ganhou linhas (imports e o novo `describe`, sem linha removida); as demais são fixtures novas.

## Gate

- Suíte completa da raiz (`vitest run`, `JITI_FS_CACHE=false`, Postgres local): 3309 passaram, 1 falhou por artefato do ambiente de verificação (junção), que passa na árvore real.
- `preparar-banco-api.test.ts` na árvore real: 8 passaram, 0 falharam.
- Não rodei Linux/Postgres 18 do CI de fato; a equivalência é por `JITI_FS_CACHE=false` e Postgres local (Windows). O gancho do Vite e do jiti é independente do SO, e o reproduzi com o mesmo sintoma do CI.

## Lacunas, em ordem de gravidade

1. Restauração do gancho (`Error.prepareStackTrace = original`) sem teste: a mutação M2 sobrevive — `backend/api/test/preparar-banco.ts:28`. Não bloqueia (corretude garantida pelo `finally`); recomendação: exportar `semGanchoDePilha` e testar que restaura após `trabalho` rejeitar.
