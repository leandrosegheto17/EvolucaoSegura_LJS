# Evolução Segura: Tarefas

## Execution Protocol (MANDATORY -- do not skip)

Implemente estas tarefas com a skill `tlc-spec-driven`: **ative-a pelo nome e siga o fluxo de Execute e as Critical Rules.** Não procure arquivos da skill por caminho. A skill é a fonte da verdade do fluxo completo (ciclo por tarefa, delegação a subagentes, revisão de adequação, Verificador, sensor de discriminação).

**Se a skill não puder ser ativada, PARE e avise o usuário.**

Regras deste projeto que valem para toda tarefa:

- Cada tarefa é um commit atômico (AD-002). Os itens de *Done when* sempre incluem: gate da tarefa verde, contagem de testes registrada (sem remoções silenciosas) e `tasks.md` atualizado no mesmo commit.
- Os testes nascem dos critérios da spec e afirmam o resultado definido nela; nunca espelham a implementação. Teste copiado do legado só entra se passar verde aqui.
- Ao fechar cada etapa (a última fase de cada uma), gerar o relatório do padrão LJS: o que foi feito, como validar e o que vem a seguir.
- Código do legado (`C:\Leandro\Projetos\EvolucaoSeguraWeb`) é somente leitura: copiar o arquivo, adaptar e trazer o teste.
- Push, deploy, `wrangler deploy`, criação de recursos na Cloudflare, Neon, Asaas ou Resend e qualquer ação externa exigem confirmação específica.
- Segredos nunca entram em arquivo versionado. O usuário fornece a chave do Asaas sandbox, o token do Resend e o DSN do Sentry quando a tarefa pedir.
- Os spikes (T12 a T15) são descartáveis: código em `.specs/spikes/<slug>/codigo/`, fora do git, nunca integrado.

---

**Spec**: `.specs/features/evolucao-segura/spec.md`
**Design**: `.specs/features/evolucao-segura/design.md`
**Status**: Approved (usuário, 2026-10-24; matriz de testes e gates confirmados; execução por subagentes em lotes; ferramentas: context7 e skills do fluxo)

---

## Test Coverage Matrix

> Gerada a partir do design, do padrão LJS e da spec; projeto novo, sem testes existentes. Diretrizes encontradas: `.specs/produto/padrao-ljs.md` (Vitest, `@cloudflare/vitest-plugin` por AD-001, Testing Library, Playwright), `.specs/features/evolucao-segura/spec.md` (testes de isolamento e de contrato). Comandos definidos na T2, T3 e T16; confirmar antes do Execute.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Contrato (Zod) | unit | Cada limite da spec nos dois lados (aceito e recusado); campo extra recusado | `backend/contrato/src/**/*.test.ts` | `pnpm --filter @es/contrato test` |
| Domínio (regras puras) | unit | Todos os ramos; 1:1 com os critérios da spec; todos os casos limite; testes do legado trazidos junto | `backend/dominio/src/**/*.test.ts` | `pnpm --filter @es/dominio test` |
| Rotas, middlewares, repositórios, tarefas e integrações do Worker | integration | Cada rota: caminho feliz, cada caso limite e erro da spec, e recurso de outro profissional (404) | `backend/api/test/**/*.test.ts` e `backend/api/src/**/*.test.ts` | `pnpm --filter @es/api test` (Postgres local no ar) |
| Migrations e garantias do banco | integration | RLS forçada, grants, triggers, funções `tarefas.*`; catálogo varrido, não lista fixa | `backend/scripts/test/**/*.test.ts` | `pnpm --filter @es/scripts test` |
| Isolamento entre profissionais | integration | Toda tabela com `usuario_id`: B não lê nem escreve nada de A | `backend/api/test/isolamento/*.test.ts` | `pnpm test:isolamento` |
| Front (componentes, cliente, regras de tela) | unit (Testing Library) | Cada comportamento da spec que a tela expõe; estados de erro e vazio | `frontend/web/src/**/*.test.tsx` | `pnpm --filter @es/web test` |
| Fluxos de ponta a ponta | e2e (Playwright) | Cadastro, login com 2FA, assinar no sandbox, agenda para evolução para pagamento | `e2e/*.spec.ts` | `pnpm e2e` |
| Workflows, wrangler, documentos, spikes | none | Teste de leitura do YAML quando o critério da spec for verificável por arquivo (OPS-01, 03, 04, 05); spikes isentos | — | gate de build |

## Gate Check Commands

> Gerados a partir do padrão LJS; confirmar antes do Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tarefas só com testes unitários | `pnpm --filter <pacote> test` |
| Full | Tarefas com testes de integração ou de isolamento | `docker compose up -d && pnpm test` |
| Build | Fim de fase e tarefas de configuração, front ou documentos | `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @es/web build` |

---

## Execution Plan

As fases correm em sequência e as tarefas dentro de cada fase também. Cada etapa do design é uma fase; as etapas maiores (1, 4, 7 e 12) foram divididas em partes que fecham no mesmo relatório de etapa.

### Phase 1: Etapa 1, parte 1: Preparação (monorepo, ferramentas, CI e documentos)

```
T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8 -> T9 -> T10 -> T11
```

### Phase 2: Etapa 1, parte 2: Spikes S1 a S4 (com participação do usuário)

```
T12 -> T13 -> T14 -> T15
```

### Phase 3: Etapa 2: Esqueleto ponta a ponta (Worker, front mínimo, deploy e backup)

```
T16 -> T17 -> T18 -> T19 -> T20 -> T21 -> T22 -> T23 -> T24 -> T25 -> T26 -> T27
```

### Phase 4: Etapa 3: Banco base (roles, RLS, auditoria, transação por requisição)

```
T28 -> T29 -> T30 -> T31 -> T32 -> T33 -> T34 -> T35 -> T36
```

### Phase 5: Etapa 4, parte 1: Acesso, cadastro e confirmação

```
T37 -> T38 -> T39 -> T40 -> T41 -> T42 -> T43 -> T44 -> T45
```

### Phase 6: Etapa 4, parte 2: Login com 2FA, sessão e CSRF

```
T46 -> T47 -> T48 -> T49 -> T50 -> T51 -> T52 -> T53
```

### Phase 7: Etapa 4, parte 3: Recuperação de senha, telas públicas e inatividade

```
T54 -> T55 -> T56 -> T57 -> T58 -> T59 -> T60
```

### Phase 8: Etapa 5: Perfil, configurações e shell /app

```
T61 -> T62 -> T63 -> T64 -> T65 -> T66
```

### Phase 9: Etapa 6: Pacientes e TCLE

```
T67 -> T68 -> T69 -> T70 -> T71 -> T72 -> T73
```

### Phase 10: Etapa 7, parte 1: Agenda, domínio e sessões

```
T74 -> T75 -> T76 -> T77 -> T78 -> T79 -> T80 -> T81 -> T82
```

### Phase 11: Etapa 7, parte 2: Agenda, séries e telas

```
T83 -> T84 -> T85 -> T86 -> T87 -> T88
```

### Phase 12: Etapa 8: Anamnese configurável

```
T89 -> T90 -> T91 -> T92 -> T93 -> T94 -> T95 -> T96 -> T97
```

### Phase 13: Etapa 9: Evoluções, rascunhos e modelos de texto

```
T98 -> T99 -> T100 -> T101 -> T102 -> T103 -> T104 -> T105 -> T106
```

### Phase 14: Etapa 10: Financeiro e Início

```
T107 -> T108 -> T109 -> T110 -> T111 -> T112 -> T113 -> T114 -> T115 -> T116 -> T117
```

### Phase 15: Etapa 11: Auditoria (telas) e exportação

```
T118 -> T119 -> T120 -> T121 -> T122 -> T123 -> T124
```

### Phase 16: Etapa 12, parte 1: Planos, Asaas e webhook

```
T125 -> T126 -> T127 -> T128 -> T129 -> T130 -> T131 -> T132
```

### Phase 17: Etapa 12, parte 2: Meu plano, limite do Free e cron único

```
T133 -> T134 -> T135 -> T136 -> T137 -> T138 -> T139
```

### Phase 18: Etapa 13: Push

```
T140 -> T141 -> T142 -> T143 -> T144 -> T145 -> T146 -> T147
```

### Phase 19: Etapa 14: Exclusão de conta, termos, landing e PWA

```
T148 -> T149 -> T150 -> T151 -> T152 -> T153 -> T154 -> T155 -> T156 -> T157
```

### Phase 20: Etapa 15: Fechamento (e2e, restauração, README e runbook)

```
T158 -> T159 -> T160 -> T161 -> T162 -> T163 -> T164 -> T165
```

---

## Task Breakdown

### T1: Primeiro commit e branch main

**What**: Criar a branch `main` e versionar o que já existe (`.gitignore`, `.claude/`, `.specs/`).
**Where**: `.gitignore`
**Depends on**: None
**Requirement**: OPS-11

**Done when**:

- [x] Branch `main` criada com o commit raiz
- [x] `.gitignore` cobre `node_modules`, `.env*` (menos `.env.example`), `dist`, `.specs/spikes/*/codigo/` e `evidencias/`
- [x] Nenhum segredo no commit

**Tests**: none
**Gate**: build (sem código ainda: `git status` limpo)

---

### T2: Monorepo pnpm e TypeScript estrito

**What**: Criar a raiz pnpm com os 5 pacotes `@es/contrato`, `@es/dominio`, `@es/api`, `@es/scripts`, `@es/web`.
**Where**: `package.json`
**Depends on**: T1
**Requirement**: OPS-05

**Done when**:

- [x] Node 24 em `engines` e `.nvmrc`, pnpm 11, `type: module` em todos os pacotes
- [x] `tsconfig.base.json` estrito herdado por cada pacote
- [x] `pnpm install` e `pnpm typecheck` rodam

**Tests**: none
**Gate**: build

---

### T3: Vitest e teste de fumaça

**What**: Instalar o Vitest (modo projects) e um teste que roda, para fechar a infraestrutura mínima de testes.
**Where**: `backend/dominio/src/fumaca.test.ts`
**Depends on**: T2
**Requirement**: OPS-05

**Done when**:

- [x] `pnpm test` roda o Vitest em todos os pacotes
- [x] 1 teste de fumaça verde
- [x] Falha se o runner não for encontrado

**Tests**: unit
**Gate**: quick

---

### T4: ESLint, Prettier e `pnpm lint`

**What**: Configurar lint e formatação na raiz com as regras do padrão LJS.
**Where**: `eslint.config.mjs`
**Depends on**: T3
**Requirement**: OPS-05

**Done when**:

- [x] `pnpm lint` passa na base atual
- [x] `.prettierrc` na raiz
- [x] Regra que proíbe `wrangler deploy` fora do workflow não é de lint (vem na etapa 2)

**Tests**: none
**Gate**: build

---

### T5: Registrar a suíte em `testes.json`

**What**: Gravar o comando da suíte para a checagem final e a trava de testes.
**Where**: `.specs/projeto/testes.json`
**Depends on**: T4
**Requirement**: OPS-05

**Done when**:

- [x] `{"comando": "pnpm lint && pnpm typecheck && pnpm test"}` gravado
- [x] `python .claude/scripts/trava-testes.py --rodar` roda e fica verde

**Tests**: none
**Gate**: build

---

### T6: Postgres 16 local com Docker

**What**: Subir só o Postgres 16 com `docker compose`, com as roles preparadas na etapa 3.
**Where**: `docker-compose.yml`
**Depends on**: T5
**Requirement**: OPS-05

**Done when**:

- [x] `docker compose up -d` deixa o Postgres 16 pronto na porta local
- [x] Volume nomeado
- [x] Healthcheck configurado

**Tests**: none
**Gate**: build

---

### T7: gitleaks

**What**: Configurar a varredura de segredos.
**Where**: `.gitleaks.toml`
**Depends on**: T6
**Requirement**: OPS-11

**Done when**:

- [x] `gitleaks detect` passa no repositório
- [x] Regras de allowlist só para exemplos do `.env.example`

**Tests**: none
**Gate**: build

---

### T8: Workflow `ci.yml`

**What**: Criar o CI com lint, typecheck, testes, gitleaks, build do web, migrations do zero num Postgres de serviço e teste de isolamento.
**Where**: `.github/workflows/ci.yml`
**Depends on**: T7
**Requirement**: OPS-05

**Done when**:

- [x] Teste que lê o YAML e confere cada passo exigido pelo OPS-05
- [x] `pnpm test:isolamento` existe (pode ficar vazio até a etapa 3)
- [x] Primeiro push só com confirmação específica

**Tests**: unit
**Gate**: quick

---

### T9: Documentos `.md/` (PRD, PRD-TECNICO, SDD)

**What**: Derivar da spec e do design os três documentos de produto e arquitetura.
**Where**: `.md/`
**Depends on**: T8
**Requirement**: OPS-05

**Done when**:

- [x] Cada documento aponta para a spec e o design como fonte
- [x] Sem conteúdo que a spec não sustente

**Tests**: none
**Gate**: build

---

### T10: Documentos `.md/` (GUARDRAILS, THREAT-MODEL)

**What**: Escrever as regras de trabalho e o modelo de ameaças (STRIDE) com as fronteiras de confiança.
**Where**: `.md/`
**Depends on**: T9
**Requirement**: ISO-01

**Done when**:

- [x] THREAT-MODEL cobre auth, isolamento, webhook, push, exportação e exclusão
- [x] GUARDRAILS inclui testes obrigatórios e proibição de `wrangler deploy` fora do `deploy.yml`

**Tests**: none
**Gate**: build

---

### T11: ADRs 001 a 003

**What**: Registrar stack e monorepo LJS, base de migrations consolidada e `@cloudflare/vitest-plugin` (AD-001).
**Where**: `.md/adr/`
**Depends on**: T10
**Requirement**: OPS-05

**Done when**:

- [x] Três ADRs em `.md/adr/NNN-titulo.md`
- [x] AD-001 do `STATE.md` aponta para o ADR-003

**Tests**: none
**Gate**: build

---

### T12: Spike S1: Hyperdrive, Kysely e `SET LOCAL`

**What**: Provar que `SET LOCAL` dentro de `BEGIN` vale só na transação com o pooler do Hyperdrive, que Kysely roda sobre um `pg.Client` por requisição e medir a CPU da exportação completa.
**Where**: `.specs/spikes/hyperdrive-kysely/`
**Depends on**: T11
**Requirement**: ISO-01, OPS-13, OPS-14

**Done when**:

- [x] Pergunta, critério de sucesso e limite de tempo definidos antes (skill `spike`)
- [x] Veredito com nível de confiança em `registro.md`
- [x] Código descartado, fora do git

**Tests**: none (spike descartável, isento pelo CLAUDE.md)
**Gate**: build (sem código de produto)

---

### T13: Spike S2: rate limit no plano Free

**What**: Provar se o binding `ratelimits` existe no Free; se não, decidir pelo contador em `limite_uso`.
**Where**: `.specs/spikes/rate-limit/`
**Depends on**: T12
**Requirement**: OPS-07

**Done when**:

- [x] Veredito registrado
- [x] Mecanismo escolhido fica anotado para o ADR-006

**Tests**: none (spike descartável, isento pelo CLAUDE.md)
**Gate**: build (sem código de produto)

---

### T14: Spike S3: Asaas sandbox

**What**: Provar cliente com CPF/CNPJ, assinatura mensal por Pix, QR Code e webhook com token no sandbox.
**Where**: `.specs/spikes/asaas-sandbox/`
**Depends on**: T13
**Requirement**: PLANO-05, PLANO-06

**Done when**:

- [ ] Chave do sandbox fornecida pelo usuário e fora do git
- [ ] Campos exigidos pelo Asaas e eventos do webhook anotados
- [ ] Veredito registrado

**Tests**: none (spike descartável, isento pelo CLAUDE.md)
**Gate**: build (sem código de produto)

---

### T15: Spike S4: Web Push no Worker

**What**: Provar o envio de push cifrado com `@block65/webcrypto-web-push` e VAPID ES256 a partir de um Worker.
**Where**: `.specs/spikes/push-worker/`
**Depends on**: T14
**Requirement**: PUSH-07

**Done when**:

- [x] Envio recebido num navegador de teste
- [x] Custo de CPU por envio anotado
- [x] Veredito registrado

**Tests**: none (spike descartável, isento pelo CLAUDE.md)
**Gate**: build (sem código de produto)

---

### T16: Harness de teste do Worker

**What**: Configurar `@cloudflare/vitest-plugin` com o `wrangler.jsonc` mínimo e o Hyperdrive local por `miniflare.hyperdrives`.
**Where**: `backend/api/vitest.config.ts`
**Depends on**: T15
**Requirement**: OPS-05

**Done when**:

- [x] Um teste de fumaça roda dentro do runtime do Worker
- [x] Conexão ao Postgres local funciona no teste

**Tests**: integration
**Gate**: full

---

### T17: GET /api/health

**What**: Responder 200 sem tocar no banco.
**Where**: `backend/api/src/rotas/health.ts`
**Depends on**: T16
**Requirement**: OPS-06

**Done when**:

- [x] 200 com corpo fixo
- [x] Teste com Hyperdrive que lança erro se usado, provando que não toca o banco

**Tests**: integration
**Gate**: full

---

### T18: Cabeçalhos de segurança e no-store

**What**: Aplicar CSP, HSTS, nosniff, Referrer-Policy e `frame-ancestors 'none'`; `Cache-Control: no-store` em `/api/*`.
**Where**: `backend/api/src/middleware/cabecalhos.ts`
**Depends on**: T17
**Requirement**: OPS-09, PUB-05

**Done when**:

- [x] Cada cabeçalho presente nas respostas
- [x] CSP sem origens externas além das necessárias
- [x] `no-store` em toda rota `/api/*`, inclusive em erro

**Tests**: integration
**Gate**: full

---

### T19: Schema de ambiente e `.env.example`

**What**: Validar as variáveis do Worker com Zod e listá-las no `.env.example` com obrigatoriedade, formato e se é segredo.
**Where**: `backend/api/src/ambiente.ts`
**Depends on**: T18
**Requirement**: OPS-11

**Done when**:

- [x] Variável ausente ou malformada falha na partida
- [x] Teste confere que toda variável do schema consta no `.env.example`
- [x] Nenhum segredo em arquivo versionado

**Tests**: unit
**Gate**: quick

---

### T20: Guardas de código

**What**: Teste que falha se houver URL absoluta do app no código ou nas migrations, ou biblioteca de hash de senha ou de PDF em `backend/api`.
**Where**: `backend/scripts/test/guardas-codigo.test.ts`
**Depends on**: T19
**Requirement**: OPS-10, OPS-14

**Done when**:

- [x] Falha ao inserir o domínio literal em `backend/` ou `frontend/`
- [x] Falha ao adicionar `bcrypt` ou `pdfmake` ao `package.json` da API
- [x] Única fonte da URL é `URL_PUBLICA`

**Tests**: unit
**Gate**: quick

---

### T21: Sentry no Worker

**What**: Enviar erros com release igual ao SHA e remover corpo, cookie e e-mail antes do envio.
**Where**: `backend/api/src/sentry.ts`
**Depends on**: T20
**Requirement**: OPS-08

**Done when**:

- [x] Função de scrubbing remove corpo, cookie e e-mail
- [x] Release vem de variável
- [x] Erro não tratado vira 500 genérico e é capturado

**Tests**: unit
**Gate**: quick

---

### T22: Front mínimo (Vite, React 19, Router e Tailwind)

**What**: Criar o esqueleto do front com base `/app`.
**Where**: `frontend/web/vite.config.ts`
**Depends on**: T21
**Requirement**: PUB-02

**Done when**:

- [x] Página inicial renderiza em `/app`
- [x] `pnpm --filter @es/web build` gera `dist`

**Tests**: unit
**Gate**: build

---

### T23: Sentry no front

**What**: Configurar `@sentry/react` com release igual ao SHA e scrubbing.
**Where**: `frontend/web/src/sentry.ts`
**Depends on**: T22
**Requirement**: OPS-08

**Done when**:

- [x] Scrubbing remove e-mail, cookie e corpo
- [x] Teste unitário da função de filtragem

**Tests**: unit
**Gate**: quick

---

### T24: Worker serve assets e API

**What**: Configurar `assets` com fallback de SPA e `run_worker_first: ["/api/*"]`.
**Where**: `wrangler.jsonc`
**Depends on**: T23
**Requirement**: PUB-05, OPS-03

**Done when**:

- [x] `/api/*` cai no Hono, demais rotas no front
- [x] Rota desconhecida do front devolve o `index.html`
- [x] Teste de integração dos três casos

**Tests**: integration
**Gate**: full

---

### T25: Workflow `deploy.yml`

**What**: Criar o deploy manual, só pela `main`, environment `producao`, concurrency sem cancelamento, na ordem fixa.
**Where**: `.github/workflows/deploy.yml`
**Depends on**: T24
**Requirement**: OPS-03

**Done when**:

- [x] Teste lê o YAML e confere a ordem: build web, branch de restauração Neon (mantendo as 2 mais recentes), dump cifrado, migração com `owner`, `wrangler deploy --var URL_PUBLICA`
- [x] Só `workflow_dispatch`
- [x] Execução real só com confirmação específica

**Tests**: unit
**Gate**: quick

---

### T26: Teste do único `wrangler deploy`

**What**: Falhar se `wrangler deploy` aparecer fora do `deploy.yml`.
**Where**: `backend/scripts/test/wrangler-deploy.test.ts`
**Depends on**: T25
**Requirement**: OPS-04

**Done when**:

- [x] Teste verde hoje
- [x] Teste vermelho se o comando aparecer em outro arquivo (verificado com um arquivo temporário)

**Tests**: unit
**Gate**: quick

---

### T27: Workflow `backup.yml` e ADR-004

**What**: Criar o backup diário às 04:00 de Brasília com `pg_dump -Fc` pela role `backup_ro`, cifrado com `age`, artefato por 30 dias, também manual.
**Where**: `.github/workflows/backup.yml`
**Depends on**: T26
**Requirement**: OPS-01

**Done when**:

- [x] Teste lê o YAML: cron `0 7 * * *` (UTC), `pg_dump -Fc`, `age`, `retention-days: 30`, `workflow_dispatch`
- [x] Conexão direta, sem `-pooler`
- [x] ADR-004 gravado

**Tests**: unit
**Gate**: quick

---

### T28: `migrar.ts` e `pnpm migrar`

**What**: Rodar as migrations com `node-pg-migrate` 9 (ESM), uma por mudança, em transação.
**Where**: `backend/scripts/src/migrar.ts`
**Depends on**: T27
**Requirement**: OPS-05

**Done when**:

- [x] Aplica do zero num banco vazio
- [x] Reaplicar não altera nada
- [x] Falha de uma migration desfaz tudo

**Tests**: integration
**Gate**: full

---

### T29: Migration 0001: roles e base

**What**: Criar roles `owner`, `app` e `backup_ro`, `pgcrypto`, schema `tarefas` e helper `app_usuario_id()`.
**Where**: `backend/scripts/migrations/0001_base.ts`
**Depends on**: T28
**Requirement**: ISO-03, ISO-04

**Done when**:

- [x] `app` não tem DELETE nem TRUNCATE por padrão
- [x] `backup_ro` só lê, sem escrita
- [x] `app_usuario_id()` devolve o valor de `app.usuario_id`

**Tests**: integration
**Gate**: full

---

### T30: Migration 0002: `audit_log`

**What**: Criar a tabela de auditoria só de inclusão, com RLS forçada.
**Where**: `backend/scripts/migrations/0002_auditoria.ts`
**Depends on**: T29
**Requirement**: AUD-01, ISO-01

**Done when**:

- [x] UPDATE e DELETE bloqueados mesmo para `owner` por trigger
- [x] RLS `FORCE` ativa
- [x] Profissional só enxerga as próprias linhas

**Tests**: integration
**Gate**: full

---

### T31: Contrato e lista de eventos de auditoria

**What**: Definir o schema estrito do evento e a lista de ações e alvos permitidos.
**Where**: `backend/contrato/src/auditoria.ts`
**Depends on**: T30
**Requirement**: AUD-02

**Done when**:

- [x] Ação ou alvo fora da lista e chave extra são recusados
- [x] Lista do legado sem IA, relatório, Google e whitelist, com as ações novas de AUD-04

**Tests**: unit
**Gate**: quick

---

### T32: Transação por requisição

**What**: `comTransacao(env, usuarioId, fn)`: um `pg.Client` por requisição, `BEGIN`, `SET LOCAL app.usuario_id`, `COMMIT` ou `ROLLBACK`, `client.end()` em `ctx.waitUntil`.
**Where**: `backend/api/src/db.ts`
**Depends on**: T31
**Requirement**: ISO-01

**Done when**:

- [x] Usar `set_config('app.usuario_id', $1, true)` com parâmetro (o `SET LOCAL` não aceita parâmetro); `app_usuario_id()` trata string vazia como ausente (spike set-local-hyperdrive)
- [x] Contexto do usuário não vaza para a requisição seguinte
- [x] Erro faz `ROLLBACK`
- [x] Sem usuário, nenhuma linha de tabela com RLS fica visível

**Tests**: integration
**Gate**: full

---

### T33: Repositório de auditoria

**What**: Gravar o evento na mesma transação da operação, com IP truncado (/24 IPv4, /48 IPv6) e user-agent resumido.
**Where**: `backend/api/src/repositorios/auditoria.ts`
**Depends on**: T32
**Requirement**: AUD-01, AUD-02

**Done when**:

- [x] Falha ao gravar a auditoria desfaz a operação
- [x] IP e user-agent truncados como especificado
- [x] Sem conteúdo clínico no registro

**Tests**: integration
**Gate**: full

---

### T34: Cache do Hyperdrive desligado

**What**: Gerar e documentar o comando de criação do Hyperdrive com cache desligado.
**Where**: `backend/scripts/src/hyperdrive.ts`
**Depends on**: T33
**Requirement**: OPS-13

**Done when**:

- [x] Teste confere `--caching-disabled` no comando gerado
- [x] Variáveis sem segredo no código

**Tests**: unit
**Gate**: quick

---

### T35: Harness de isolamento

**What**: Teste que cria dois profissionais e, para cada tabela com `usuario_id`, exige `FORCE ROW LEVEL SECURITY` e que B não lê nem escreve linha de A.
**Where**: `backend/api/test/isolamento/isolamento.test.ts`
**Depends on**: T34
**Requirement**: ISO-01, ISO-02

**Done when**:

- [x] Varre o catálogo do banco, então cobre tabelas futuras sozinho
- [x] Falha se uma tabela nova ficar sem RLS forçada
- [x] Integrado ao `pnpm test:isolamento` do CI

**Tests**: integration
**Gate**: full

---

### T36: Teste das funções `tarefas.*` e ADR-005

**What**: Garantir que toda função `SECURITY DEFINER` tem `search_path` fixo e que `app` só executa as listadas.
**Where**: `backend/scripts/test/funcoes-tarefas.test.ts`
**Depends on**: T35
**Requirement**: ISO-03

**Done when**:

- [x] Falha se uma função `tarefas.*` não tiver `SECURITY DEFINER` com `search_path` fixo
- [x] Lista de funções executáveis pela `app` é explícita
- [x] ADR-005 gravado

**Tests**: integration
**Gate**: full

---

### T37: Contrato de identidade

**What**: Schemas Zod de cadastro, entrar, 2FA, recuperação e códigos de erro problem+json.
**Where**: `backend/contrato/src/identidade.ts`
**Depends on**: T36
**Requirement**: CAD-01, AUTH-02

**Done when**:

- [x] Nome 1 a 200, e-mail válido, aceite de termos obrigatório
- [x] Resposta de erro de login única para todos os motivos
- [x] Chave desconhecida recusada

**Tests**: unit
**Gate**: quick

---

### T38: Política de senha

**What**: Copiar `password-policy.ts` e a lista de 124 senhas comuns, com seus testes.
**Where**: `backend/dominio/src/identidade/politica-senha.ts`
**Depends on**: T37
**Requirement**: AUTH-11

**Done when**:

- [x] Menos de 12, mais de 128, senha comum (após NFKC, minúsculas, sem espaços) e caractere repetido recusados com `curta`, `longa`, `comum`
- [x] Testes do legado verdes aqui

**Tests**: unit
**Gate**: quick

---

### T39: Regras de acesso puras

**What**: Funções de expiração de sessão (15 min, 12 h), bloqueio (5 falhas em 15 min), 5 tentativas de 2FA e reenvio após 60 s.
**Where**: `backend/dominio/src/identidade/regras-acesso.ts`
**Depends on**: T38
**Requirement**: AUTH-05, AUTH-06, AUTH-07, AUTH-09

**Done when**:

- [x] Todos os limites nos extremos (4 e 5 falhas, 59 e 61 s, 14:59 e 15:00)
- [x] Tempo sempre recebido por parâmetro

**Tests**: unit
**Gate**: quick

---

### T40: Migration 0003: identidade

**What**: Criar `usuario`, `credencial_senha`, `sessao`, `desafio_2fa`, `token_email`, `tentativa_login`, `aceite_termos`, com grants mínimos e funções de hash (`crypt`, `gen_salt('bf', 12)`).
**Where**: `backend/scripts/migrations/0003_identidade.ts`
**Depends on**: T39
**Requirement**: AUTH-12, CAD-03

**Done when**:

- [x] Hash e conferência só no Postgres, com a senha como parâmetro
- [x] Tokens, sessão e código 2FA guardados só como hash
- [x] `app` não apaga linhas

**Tests**: integration
**Gate**: full

---

### T41: Migration 0004: assinatura e webhook

**What**: Criar `assinatura` e `webhook_evento` com RLS forçada.
**Where**: `backend/scripts/migrations/0004_assinatura.ts`
**Depends on**: T40
**Requirement**: PLANO-01, ISO-01

**Done when**:

- [x] Estados `trial`, `ativa`, `atrasada`, `cancelada`, `free` por restrição
- [x] `event_id` único
- [x] Teste de isolamento passa a cobrir as tabelas

**Tests**: integration
**Gate**: full

---

### T42: Cliente Resend

**What**: Enviar e-mail de texto puro por `fetch`, com erro tipado e alerta ao Sentry no primeiro 429.
**Where**: `backend/api/src/integracoes/resend.ts`
**Depends on**: T41
**Requirement**: CAD-08, AUTH-08

**Done when**:

- [x] Remetente `@evolucaosegura.com.br`
- [x] Falha e 429 viram erro tipado, sem vazar o e-mail no log
- [x] Teste com `fetch` simulado

**Tests**: integration
**Gate**: full

---

### T43: Rate limit

**What**: Aplicar o limite por IP (10/min em entrar, 2FA, cadastro e recuperação; 60/min nas demais públicas; limite do webhook) com o mecanismo escolhido no spike S2.
**Where**: `backend/api/src/middleware/limite.ts`
**Depends on**: T42
**Requirement**: OPS-07

**Done when**:

- [x] Usar o binding `ratelimits`, que o spike rate-limit-free confirmou no Free (limite efetivo de ±1); o teste não depende do número exato de passes
- [x] 11ª requisição no minuto recebe 429
- [x] Contadores separados por grupo de rota
- [x] ADR-006 gravado com a decisão do spike

**Tests**: integration
**Gate**: full

---

### T44: POST /api/cadastro

**What**: Cadastrar com resposta 202 igual para e-mail novo, existente e pendente, enviando o e-mail certo em cada caso.
**Where**: `backend/api/src/rotas/cadastro.ts`
**Depends on**: T43
**Requirement**: CAD-01, CAD-02, CAD-03, CAD-06, CAD-08

**Done when**:

- [x] Mesmo corpo e status nos três casos
- [x] Conta confirmada recebe e-mail com link de recuperação
- [x] Reenvio substitui nome e senha pendentes e invalida o token anterior
- [x] Falha do Resend responde 202 e vai ao Sentry
- [x] Token de 256 bits, SHA-256 no banco, 30 min

**Tests**: integration
**Gate**: full

---

### T45: Confirmação de e-mail

**What**: Ativar a conta, iniciar o trial de 14 dias, registrar o aceite dos termos com versão e auditar `conta.cadastrada`.
**Where**: `backend/api/src/rotas/confirmar.ts`
**Depends on**: T44
**Requirement**: CAD-04, CAD-05, CAD-07, AUD-04

**Done when**:

- [x] Assinatura `trial` com `periodo_fim` igual à confirmação mais 14 dias
- [x] Token inválido, expirado ou usado responde 400 `link_invalido` sem alterar conta
- [x] Aceite grava data, hora e versões
- [x] Auditoria na mesma transação

**Tests**: integration
**Gate**: full

---

### T46: POST /api/auth/entrar

**What**: Validar senha, enviar o código 2FA de 6 dígitos (CSPRNG, HMAC-SHA256) e recusar com 401 único e tempo equivalente.
**Where**: `backend/api/src/rotas/auth-entrar.ts`
**Depends on**: T45
**Requirement**: AUTH-01, AUTH-02, AUTH-03, AUTH-08, CAD-09

**Done when**:

- [x] 202 `2fa_required` sem criar sessão
- [x] E-mail inexistente também calcula o hash
- [x] Conta não confirmada ou bloqueada recebe o mesmo 401
- [x] Falha do Resend responde 503 `mail_unavailable` sem contar falha
- [x] Código guardado só como HMAC, válido por 10 min, uso único

**Tests**: integration
**Gate**: full

---

### T47: Bloqueio por falhas

**What**: Bloquear e-mail e IP por 15 min após 5 falhas em 15 min, com 429 e `Retry-After`, estado em `tentativa_login`.
**Where**: `backend/api/src/rotas/auth-entrar.ts`
**Depends on**: T46
**Requirement**: AUTH-07

**Done when**:

- [x] A 5ª falha bloqueia, a 4ª não
- [x] Bloqueio por e-mail e por IP independentes
- [x] `Retry-After` em segundos
- [x] Sucesso não zera o bloqueio vigente

**Tests**: integration
**Gate**: full

---

### T48: POST /api/auth/2fa/verificar

**What**: Validar o código, criar a sessão nova (`__Host-sid`) e devolver o token CSRF, auditando `auth.login_ok`.
**Where**: `backend/api/src/rotas/auth-2fa.ts`
**Depends on**: T47
**Requirement**: AUTH-04, AUTH-05, AUTH-10, AUD-04

**Done when**:

- [x] Cookie com Path=/, Secure, HttpOnly, SameSite=Lax e sem Domain
- [x] 5 erros invalidam o desafio
- [x] Id de sessão novo e sessão anterior do navegador encerrada
- [x] Código usado não vale de novo

**Tests**: integration
**Gate**: full

---

### T49: Reenvio do código 2FA

**What**: Responder 202 igual em todos os casos e só enviar se o último envio tem mais de 60 s pelo relógio do banco.
**Where**: `backend/api/src/rotas/auth-2fa-reenviar.ts`
**Depends on**: T48
**Requirement**: AUTH-06

**Done when**:

- [x] Corpo idêntico com e sem envio
- [x] Segundo pedido em 59 s não envia, em 61 s envia
- [x] Relógio do banco, não do Worker

**Tests**: integration
**Gate**: full

---

### T50: Middleware de sessão

**What**: Resolver o cookie por SHA-256, expirar por inatividade (15 min) ou tempo absoluto (12 h) e renovar o último uso.
**Where**: `backend/api/src/middleware/sessao.ts`
**Depends on**: T49
**Requirement**: AUTH-09

**Done when**:

- [x] Cookie inválido, vencido ou de sessão encerrada responde 401
- [x] Último uso atualizado a cada requisição
- [x] Teste com relógio simulado nos dois limites

**Tests**: integration
**Gate**: full

---

### T51: Middleware de CSRF

**What**: Exigir `x-csrf-token` correto em métodos de escrita autenticados.
**Where**: `backend/api/src/middleware/csrf.ts`
**Depends on**: T50
**Requirement**: AUTH-17

**Done when**:

- [x] Escrita sem o cabeçalho ou com valor errado responde 403 sem executar
- [x] GET passa sem o cabeçalho
- [x] Rotas públicas ficam fora

**Tests**: integration
**Gate**: full

---

### T52: POST /api/auth/sair

**What**: Encerrar a sessão sem DELETE, limpar o cookie com `Max-Age=0` e auditar `auth.logout`.
**Where**: `backend/api/src/rotas/auth-sair.ts`
**Depends on**: T51
**Requirement**: AUTH-16, AUD-04

**Done when**:

- [x] 204 e cookie limpo
- [x] Requisição seguinte com o mesmo cookie recebe 401
- [x] Auditoria gravada

**Tests**: integration
**Gate**: full

---

### T53: Pipeline completo e GET /api/eu

**What**: Montar `app.ts` na ordem do design (cabeçalhos, rate limit, sessão, CSRF, plano, transação, handler, auditoria) e expor o usuário logado.
**Where**: `backend/api/src/app.ts`
**Depends on**: T52
**Requirement**: ISO-01, OPS-07, AUTH-17

**Done when**:

- [x] Rotas públicas pulam sessão e CSRF
- [x] Rota autenticada roda dentro de `comTransacao`
- [x] Teste de ordem dos middlewares
- [x] `GET /api/eu` devolve usuário e estado do perfil

**Tests**: integration
**Gate**: full

---

### T54: Pedido de recuperação de senha

**What**: Responder 202 vazio em todos os casos; se a conta existe, enviar link com token de 256 bits (30 min, uso único), invalidando pedidos anteriores.
**Where**: `backend/api/src/rotas/recuperar.ts`
**Depends on**: T53
**Requirement**: AUTH-13

**Done when**:

- [x] Mesma resposta para conta existente e inexistente
- [x] Novo pedido invalida o anterior
- [x] Token guardado só como SHA-256

**Tests**: integration
**Gate**: full

---

### T55: Nova senha

**What**: Trocar o hash, encerrar todas as sessões e responder 204 sem abrir sessão; checar o token antes da política de senha.
**Where**: `backend/api/src/rotas/redefinir.ts`
**Depends on**: T54
**Requirement**: AUTH-14, AUTH-15

**Done when**:

- [x] Token inválido responde 400 `link_invalido` antes de avaliar a senha
- [x] Senha nova que não passa na política responde 422
- [x] Todas as sessões encerradas
- [x] Token usado não vale de novo

**Tests**: integration
**Gate**: full

---

### T56: Cliente de API e guarda de sessão no front

**What**: Portar `lib/api` para o prefixo `/api`, com o token CSRF em toda escrita e TanStack Query.
**Where**: `frontend/web/src/lib/api.ts`
**Depends on**: T55
**Requirement**: AUTH-17, PUB-02

**Done when**:

- [x] Escrita envia `x-csrf-token`
- [x] 401 leva a `/sessao-expirada`
- [x] Teste do cliente com `fetch` simulado

**Tests**: unit
**Gate**: quick

---

### T57: Telas de cadastro e confirmação

**What**: Telas `/cadastro` e `/confirmar` com aceite dos termos e mensagens de erro do contrato.
**Where**: `frontend/web/src/publico/cadastro.tsx`
**Depends on**: T56
**Requirement**: CAD-01, CAD-05

**Done when**:

- [x] Envia nome, e-mail, senha e aceite
- [x] Exibe o motivo da política de senha
- [x] Link inválido mostra mensagem clara

**Tests**: unit
**Gate**: quick

---

### T58: Telas de entrar e código 2FA

**What**: Telas `/entrar` e do código, com reenvio.
**Where**: `frontend/web/src/publico/entrar.tsx`
**Depends on**: T57
**Requirement**: AUTH-01, AUTH-04, AUTH-06

**Done when**:

- [x] Fluxo senha, código, entrada no app
- [x] Reenvio com contagem de 60 s
- [x] 503 mostra "Não foi possível enviar o código agora"

**Tests**: unit
**Gate**: quick

---

### T59: Telas de recuperação

**What**: Telas `/recuperar` e `/redefinir`.
**Where**: `frontend/web/src/publico/recuperar.tsx`
**Depends on**: T58
**Requirement**: AUTH-13, AUTH-14

**Done when**:

- [x] Pedido mostra sempre a mesma mensagem
- [x] Redefinição trata `link_invalido` e motivo da senha

**Tests**: unit
**Gate**: quick

---

### T60: Aviso de inatividade e sessão expirada

**What**: Diálogo com contagem regressiva nos últimos 120 s, renovação, limpeza do cache e `/sessao-expirada` preservando rascunhos.
**Where**: `frontend/web/src/app/inatividade.tsx`
**Depends on**: T59
**Requirement**: AUTH-18, AUTH-19

**Done when**:

- [x] Diálogo aparece aos 13:00 de inatividade (relógio simulado)
- [x] "Continuar conectado" renova
- [x] Expiração limpa o cache e mantém os rascunhos

**Tests**: unit
**Gate**: quick

---

### T61: Migration 0005: perfil e configurações

**What**: Criar `perfil` e `configuracao_usuario` com RLS forçada.
**Where**: `backend/scripts/migrations/0005_perfil.ts`
**Depends on**: T60
**Requirement**: PERF-02, PERF-03, PERF-08

**Done when**:

- [x] Uma especialidade por profissional
- [x] `atende_sabado` e `atende_domingo` com padrão falso
- [x] `privacidade_agenda` com padrão falso

**Tests**: integration
**Gate**: full

---

### T62: GET e PUT /api/perfil

**What**: Ler e salvar perfil e especialidade (`psicologia`, `nutricao`, `fisioterapia`, `outra` com nome), auditando só nomes de campo.
**Where**: `backend/api/src/rotas/perfil.ts`
**Depends on**: T61
**Requirement**: PERF-02, PERF-03, PERF-09

**Done when**:

- [x] Chave desconhecida responde 422, vazio vira null
- [x] `outra` exige nome de 1 a 60
- [x] Auditoria `perfil.editado` só quando algo mudou
- [x] Outro profissional não enxerga o perfil

**Tests**: integration
**Gate**: full

---

### T63: GET e PUT /api/configuracoes

**What**: Salvar `privacidade_agenda`, sem opção de inatividade, auditando `configuracao.alterada`.
**Where**: `backend/api/src/rotas/configuracoes.ts`
**Depends on**: T62
**Requirement**: PERF-08, PERF-09

**Done when**:

- [x] Sem mudança, nada é gravado nem auditado
- [x] Comportamento do legado confirmado ao portar a tela
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T64: Design system do front

**What**: Copiar `ui`, tokens, fontes e ícones do legado.
**Where**: `frontend/web/src/ui/`
**Depends on**: T63
**Requirement**: PUB-02

**Done when**:

- [x] Componentes e tokens idênticos ao legado
- [x] Testes de componente do legado verdes

**Tests**: unit
**Gate**: quick

---

### T65: Shell `/app` e guarda de perfil

**What**: Portar layout, navegação e roteamento sob `/app` e levar qualquer rota a `/app/perfil` enquanto faltarem nome e especialidade.
**Where**: `frontend/web/src/app/shell.tsx`
**Depends on**: T64
**Requirement**: PERF-01, PUB-02

**Done when**:

- [x] Perfil incompleto redireciona qualquer rota de `/app`
- [x] Navegação igual à do legado no escopo

**Tests**: unit
**Gate**: quick

---

### T66: Tela de perfil e configurações

**What**: Portar a tela com especialidade única e configurações.
**Where**: `frontend/web/src/app/perfil/perfil.tsx`
**Depends on**: T65
**Requirement**: PERF-02, PERF-03, PERF-08

**Done when**:

- [x] Campos e limites do contrato
- [x] Troca de especialidade mostra o erro do servidor
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T67: Migration 0006: pacientes e TCLE

**What**: Criar `paciente` e `consentimento_tcle` com RLS forçada, sem colunas de IA.
**Where**: `backend/scripts/migrations/0006_pacientes.ts`
**Depends on**: T66
**Requirement**: PAC-01, PAC-05, PAC-07

**Done when**:

- [x] Só inclusão em `consentimento_tcle`
- [x] Sem permissão de DELETE para `app`
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T68: Contrato de pacientes

**What**: Schemas de paciente, listagem e TCLE.
**Where**: `backend/contrato/src/pacientes.ts`
**Depends on**: T67
**Requirement**: PAC-01, PAC-02, PAC-05

**Done when**:

- [x] Limites de nome, telefone, e-mail e endereço
- [x] Campo extra recusado
- [x] Data do TCLE YYYY-MM-DD válida

**Tests**: unit
**Gate**: quick

---

### T69: Criar, buscar e listar pacientes

**What**: `POST`, `GET` lista com `q`, `ativo`, `limit` e `offset`, sem rota de exclusão.
**Where**: `backend/api/src/rotas/pacientes.ts`
**Depends on**: T68
**Requirement**: PAC-01, PAC-02, PAC-07

**Done when**:

- [x] Curingas escapados na busca
- [x] `ativo` inválido responde 400
- [x] `limit` fora de 1 a 100 recusado
- [x] Outro profissional recebe 404 idêntico ao inexistente
- [x] Não existe rota DELETE

**Tests**: integration
**Gate**: full

---

### T70: Inativar e reativar

**What**: Trocar só o flag `ativo`, sem tocar em prontuário nem sessões futuras, auditando.
**Where**: `backend/api/src/rotas/pacientes-ativo.ts`
**Depends on**: T69
**Requirement**: PAC-03, PAC-04

**Done when**:

- [x] Auditoria `paciente.inativado` e `paciente.reativado`
- [x] Repetir o mesmo estado não muda `row_version` nem audita
- [x] Sessões futuras intactas

**Tests**: integration
**Gate**: full

---

### T71: TCLE

**What**: Registrar o consentimento só por inclusão.
**Where**: `backend/api/src/rotas/tcle.ts`
**Depends on**: T70
**Requirement**: PAC-05

**Done when**:

- [x] Finalidade 1 a 500, versão 1 a 50, data válida
- [x] Sem edição nem exclusão
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T72: Ficha do paciente

**What**: Abrir a ficha e auditar `paciente.consultado`.
**Where**: `backend/api/src/rotas/paciente-ficha.ts`
**Depends on**: T71
**Requirement**: PAC-06

**Done when**:

- [x] Cada abertura grava a auditoria
- [x] Paciente de outro profissional responde 404 sem auditar

**Tests**: integration
**Gate**: full

---

### T73: Telas de pacientes

**What**: Lista, ficha e TCLE portadas do legado.
**Where**: `frontend/web/src/app/pacientes/pacientes.tsx`
**Depends on**: T72
**Requirement**: PAC-02, PAC-03, PAC-05

**Done when**:

- [x] Busca, filtro de ativos e inativação
- [x] Registro de TCLE
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T74: Migration 0007: agenda

**What**: Criar `serie_recorrencia` e `sessao_atendimento` com RLS forçada e `cobravel` com padrão falso.
**Where**: `backend/scripts/migrations/0007_agenda.ts`
**Depends on**: T73
**Requirement**: AGE-10, AGE-17

**Done when**:

- [x] Sem permissão de DELETE para `app`
- [x] `row_version` presente
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T75: Contrato da agenda

**What**: Schemas de sessão, listagem e mudança de status.
**Where**: `backend/contrato/src/agenda.ts`
**Depends on**: T74
**Requirement**: AGE-01, AGE-03

**Done when**:

- [x] ISO 8601 com offset, anos 2000 a 2100, `fim > inicio`
- [x] Link opcional com http ou https até 500
- [x] Intervalo de listagem de até 62 dias, `limit` padrão 50 e máximo 100

**Tests**: unit
**Gate**: quick

---

### T76: Transições de status

**What**: Copiar `session.ts` e acrescentar realizada para cancelada com guarda e `cobravel` padrão falso.
**Where**: `backend/dominio/src/agenda/sessao.ts`
**Depends on**: T75
**Requirement**: AGE-07, AGE-08, AGE-10

**Done when**:

- [x] Todas as transições da matriz aceitas e as demais recusadas
- [x] Mesmo status é idempotente
- [x] Realizada para cancelada recusa se há registros
- [x] Falta ou cancelamento grava `cobravel = false`

**Tests**: unit
**Gate**: quick

---

### T77: Conflito e dia habilitado

**What**: Copiar conflito e disponibilidade por dia da semana.
**Where**: `backend/dominio/src/agenda/conflito.ts`
**Depends on**: T76
**Requirement**: AGE-04, AGE-06, AGE-09

**Done when**:

- [x] Intervalos [início, fim) que apenas se encostam não conflitam
- [x] Conflito só com agendada, realizada ou faltou
- [x] Sábado e domingo desligados recusados

**Tests**: unit
**Gate**: quick

---

### T78: POST /api/sessoes

**What**: Criar sessão avulsa com conflito, dia habilitado e paciente ativo.
**Where**: `backend/api/src/rotas/sessoes.ts`
**Depends on**: T77
**Requirement**: AGE-01, AGE-04, AGE-05, AGE-06, AGE-12

**Done when**:

- [x] 409 `SCHEDULE_CONFLICT` sem `confirmar_conflito`; com ele grava sem alterar a existente
- [x] 422 `WEEKDAY_UNAVAILABLE`
- [x] 422 `PATIENT_INACTIVE`
- [x] Paciente de outro profissional responde 404

**Tests**: integration
**Gate**: full

---

### T79: GET /api/sessoes

**What**: Listar por intervalo com cursor keyset.
**Where**: `backend/api/src/rotas/sessoes-lista.ts`
**Depends on**: T78
**Requirement**: AGE-03

**Done when**:

- [x] Intervalo acima de 62 dias recusado
- [x] Paginação estável com cursor
- [x] Só sessões do profissional

**Tests**: integration
**Gate**: full

---

### T80: Editar e mover sessão

**What**: Alterar horário e dados com `row_version`, reaplicando conflito, dia e paciente.
**Where**: `backend/api/src/rotas/sessoes-editar.ts`
**Depends on**: T79
**Requirement**: AGE-11, AGE-04, AGE-06, AGE-12

**Done when**:

- [x] Versão divergente responde 409 sem gravar
- [x] Mover reaplica as três checagens
- [x] Sessão não é apagada em nenhum caminho

**Tests**: integration
**Gate**: full

---

### T81: Mudar status da sessão

**What**: Aplicar as transições, reaplicando checagens ao voltar para agendada e gravando `cobravel`.
**Where**: `backend/api/src/rotas/sessoes-status.ts`
**Depends on**: T80
**Requirement**: AGE-07, AGE-09, AGE-10, AGE-11

**Done when**:

- [x] Transição inválida responde 422
- [x] Voltar para agendada reaplica dia habilitado e conflito
- [x] Falta e cancelamento gravam `cobravel = false` salvo "cobrar"

**Tests**: integration
**Gate**: full

---

### T82: Fim de semana desligado com sessões futuras

**What**: No `PUT /api/perfil`, responder 409 `WEEKEND_DAY_HAS_SESSIONS` com a contagem, ou salvar mantendo as sessões com `confirmar: true`.
**Where**: `backend/api/src/rotas/perfil.ts`
**Depends on**: T81
**Requirement**: PERF-06, PERF-07

**Done when**:

- [x] Sem `confirmar`, nada é salvo e a contagem vem no erro
- [x] Com `confirmar`, salva e mantém as sessões
- [x] Só conta sessões futuras não canceladas

**Tests**: integration
**Gate**: full

---

### T83: Geração e deslocamento de ocorrências

**What**: Copiar `series.ts`: gerar 2 a 52 ocorrências semanais ou quinzenais e deslocar a partir de uma data.
**Where**: `backend/dominio/src/agenda/serie.ts`
**Depends on**: T82
**Requirement**: AGE-13, AGE-15

**Done when**:

- [x] 1 e 53 ocorrências recusadas, 2 e 52 aceitas
- [x] Quinzenal pula uma semana
- [x] Deslocamento só das `agendada` a partir da data

**Tests**: unit
**Gate**: quick

---

### T84: POST /api/series

**What**: Criar a série inteira ou nenhuma ocorrência.
**Where**: `backend/api/src/rotas/series.ts`
**Depends on**: T83
**Requirement**: AGE-13, AGE-14

**Done when**:

- [x] Todas as colisões listadas no 409 e nada criado sem `confirmar_conflito`
- [x] Com a confirmação, cria todas
- [x] Mesma duração em todas

**Tests**: integration
**Gate**: full

---

### T85: Alterar série a partir de uma data

**What**: Deslocar só as ocorrências `agendada` a partir da data, ignorando as próprias ocorrências no conflito.
**Where**: `backend/api/src/rotas/series-alterar.ts`
**Depends on**: T84
**Requirement**: AGE-15

**Done when**:

- [x] Passadas e já realizadas intocadas
- [x] Dia habilitado e conflito reaplicados
- [x] Tudo ou nada

**Tests**: integration
**Gate**: full

---

### T86: Cancelar série a partir de uma data

**What**: Marcar série e ocorrências `agendada` como canceladas, sem apagar, de forma idempotente.
**Where**: `backend/api/src/rotas/series-cancelar.ts`
**Depends on**: T85
**Requirement**: AGE-16, AGE-17

**Done when**:

- [x] Segunda chamada não muda nada
- [x] Ocorrências anteriores à data intactas
- [x] Nenhuma linha apagada

**Tests**: integration
**Gate**: full

---

### T87: Tela da agenda

**What**: Semana, criação de sessão e durações 30, 45, 50, 60 e 90 com 50 pré-selecionado.
**Where**: `frontend/web/src/app/agenda/agenda.tsx`
**Depends on**: T86
**Requirement**: AGE-02, AGE-01

**Done when**:

- [x] 50 minutos pré-selecionado
- [x] Layout comparado com o legado
- [x] Erros do contrato exibidos

**Tests**: unit
**Gate**: quick

---

### T88: Série, conflito e status na tela

**What**: Criação de série, diálogo de conflito e mudança de status.
**Where**: `frontend/web/src/app/agenda/serie.tsx`
**Depends on**: T87
**Requirement**: AGE-04, AGE-13, AGE-14, AGE-07

**Done when**:

- [x] Diálogo lista as colisões e oferece confirmar
- [x] Ações de status só mostram transições válidas
- [x] "Cobrar" visível em falta e cancelamento

**Tests**: unit
**Gate**: quick

---

### T89: Migration 0008: anamnese

**What**: Criar `modelo_anamnese`, `modelo_anamnese_item`, `anamnese` e `anamnese_retificacao` com RLS forçada.
**Where**: `backend/scripts/migrations/0008_anamnese.ts`
**Depends on**: T88
**Requirement**: ANA-03, ANA-04

**Done when**:

- [x] `valores jsonb` e `modelo_revisao`
- [x] Sem DELETE para `app`
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T90: Regras do modelo de anamnese

**What**: Copiar `model.domain.ts` e `presets.ts`: limites de itens, rótulos e bloqueio quando há anamnese.
**Where**: `backend/dominio/src/anamnese/modelo.ts`
**Depends on**: T89
**Requirement**: ANA-01, ANA-02, ANA-03

**Done when**:

- [x] 30 campos e 12 alertas no limite
- [x] Rótulo único sem diferenciar maiúsculas
- [x] Um só campo "Frequência"
- [x] Com anamnese, só inclusão de itens
- [x] Preset de psicologia com 7 campos e 4 alertas

**Tests**: unit
**Gate**: quick

---

### T91: Regras dos valores

**What**: Copiar `anamnesis-values.domain.ts` sem o schema morto de 20.000 e 5.000.
**Where**: `backend/dominio/src/anamnese/valores.ts`
**Depends on**: T90
**Requirement**: ANA-04

**Done when**:

- [x] Texto até 5.000 e observação até 500
- [x] Id de item desconhecido ou de revisão futura recusado

**Tests**: unit
**Gate**: quick

---

### T92: Contrato da anamnese

**What**: Schemas de modelo, anamnese e retificação.
**Where**: `backend/contrato/src/anamnese.ts`
**Depends on**: T91
**Requirement**: ANA-01, ANA-04, ANA-06

**Done when**:

- [x] Motivo de 1 a 5.000
- [x] Código `MODEL_LABEL_INVALID` sem ecoar o texto

**Tests**: unit
**Gate**: quick

---

### T93: Modelo padrão e troca de especialidade

**What**: Criar o modelo padrão ao definir a especialidade e bloquear a troca quando há anamnese.
**Where**: `backend/api/src/rotas/perfil.ts`
**Depends on**: T92
**Requirement**: PERF-04, PERF-05

**Done when**:

- [x] Definir psicologia cria o modelo com 7 campos e 4 alertas
- [x] Com anamnese registrada, troca responde 409 `SPECIALTY_HAS_ANAMNESIS`

**Tests**: integration
**Gate**: full

---

### T94: Rotas do modelo

**What**: Ler e editar o modelo respeitando o bloqueio.
**Where**: `backend/api/src/rotas/modelo-anamnese.ts`
**Depends on**: T93
**Requirement**: ANA-01, ANA-02, ANA-03

**Done when**:

- [x] Remover ou renomear com anamnese registrada responde erro
- [x] Incluir item em qualquer posição é aceito
- [x] 422 `MODEL_LABEL_INVALID`

**Tests**: integration
**Gate**: full

---

### T95: Registrar e editar a anamnese no dia

**What**: Uma anamnese por paciente, editável até a meia-noite de Brasília pelo relógio do banco.
**Where**: `backend/api/src/rotas/anamnese.ts`
**Depends on**: T94
**Requirement**: ANA-04, ANA-05

**Done when**:

- [x] Segunda anamnese do paciente recusada
- [x] Edição às 23:59 aceita e à 00:00 recusada
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T96: Retificar a anamnese

**What**: Criar nova versão com motivo depois do dia do cadastro, preservando a original.
**Where**: `backend/api/src/rotas/anamnese-retificar.ts`
**Depends on**: T95
**Requirement**: ANA-06, ANA-07, ANA-08

**Done when**:

- [x] No dia do cadastro responde 409 `EDIT_WINDOW_OPEN`
- [x] Sem conteúdo novo responde 400
- [x] Original preservada e versão vigente é a nova

**Tests**: integration
**Gate**: full

---

### T97: Tela de anamnese e editor do modelo

**What**: Portar as telas com os selos "Editável hoje" e "Registrada" e o alerta marcado.
**Where**: `frontend/web/src/app/anamnese/anamnese.tsx`
**Depends on**: T96
**Requirement**: ANA-09

**Done when**:

- [x] Selo correto nos dois estados
- [x] Alerta clínico da versão vigente em destaque
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T98: Migration 0009: evolução e rascunho

**What**: Criar `evolucao`, `evolucao_retificacao`, `rascunho` e `modelo_texto`, com índice único parcial em `sessao_id`.
**Where**: `backend/scripts/migrations/0009_evolucao.ts`
**Depends on**: T97
**Requirement**: EVO-02, RAS-01, RAS-03

**Done when**:

- [x] Segunda evolução da mesma sessão violada pelo banco
- [x] Sem DELETE para `app`
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T99: Regras de janela, rascunho e modelos

**What**: Copiar `edit-window.ts`, `draft.ts` e `templates.domain.ts`, com modelo só do tipo `evolucao`.
**Where**: `backend/dominio/src/clinico/janela-edicao.ts`
**Depends on**: T98
**Requirement**: EVO-04, RAS-02, RAS-03

**Done when**:

- [x] Janela fecha à meia-noite de Brasília
- [x] Nome do modelo único sem diferenciar maiúsculas
- [x] Testes do legado verdes

**Tests**: unit
**Gate**: quick

---

### T100: Contrato de evolução e rascunho

**What**: Schemas de evolução, retificação, rascunho e modelo de texto.
**Where**: `backend/contrato/src/clinico.ts`
**Depends on**: T99
**Requirement**: EVO-01, EVO-05, RAS-01

**Done when**:

- [x] Texto não vazio após aparar, até 100.000
- [x] Payload do rascunho até 512 KiB
- [x] Modelo até 50.000

**Tests**: unit
**Gate**: quick

---

### T101: POST /api/evolucoes

**What**: Registrar a evolução e, se a sessão estava agendada, mudá-la para realizada na mesma transação.
**Where**: `backend/api/src/rotas/evolucoes.ts`
**Depends on**: T100
**Requirement**: EVO-01, EVO-02, EVO-03

**Done when**:

- [ ] Segunda evolução da sessão responde 409 `EVOLUTION_EXISTS`
- [ ] Sessão agendada vira realizada, atomicamente
- [ ] Evolução sem sessão aceita
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T102: Editar a evolução no dia

**What**: Permitir edição no dia do cadastro com `row_version` obrigatório.
**Where**: `backend/api/src/rotas/evolucoes-editar.ts`
**Depends on**: T101
**Requirement**: EVO-04

**Done when**:

- [ ] Versão divergente responde 409
- [ ] Depois da meia-noite a edição é recusada (relógio do banco)

**Tests**: integration
**Gate**: full

---

### T103: Retificar a evolução

**What**: Criar retificação com texto novo e motivo depois do dia do cadastro; sem rota de exclusão.
**Where**: `backend/api/src/rotas/evolucoes-retificar.ts`
**Depends on**: T102
**Requirement**: EVO-05, EVO-06, EVO-07

**Done when**:

- [ ] No dia responde 409 `EDIT_WINDOW_OPEN`
- [ ] Original preservada
- [ ] Não existe rota DELETE

**Tests**: integration
**Gate**: full

---

### T104: Rascunhos

**What**: Upsert por (profissional, tipo, ref) com `If-Match`.
**Where**: `backend/api/src/rotas/rascunhos.ts`
**Depends on**: T103
**Requirement**: RAS-01, RAS-02

**Done when**:

- [ ] `If-Match` divergente responde 412; rascunho inexistente aceita ausente ou "0"
- [ ] Payload acima de 512 KiB recusado
- [ ] Nada é apagado

**Tests**: integration
**Gate**: full

---

### T105: Modelos de texto

**What**: Criar, listar e arquivar modelos do tipo `evolucao`.
**Where**: `backend/api/src/rotas/modelos-texto.ts`
**Depends on**: T104
**Requirement**: RAS-03

**Done when**:

- [ ] Nome duplicado (sem diferenciar maiúsculas) recusado
- [ ] Arquivar em vez de apagar
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T106: Telas de evolução, rascunho e modelos

**What**: Portar as telas e oferecer restaurar o rascunho no próximo acesso após expirar a sessão.
**Where**: `frontend/web/src/app/evolucao/evolucao.tsx`
**Depends on**: T105
**Requirement**: RAS-04, EVO-04, EVO-05

**Done when**:

- [ ] Rascunho oferecido depois da sessão expirar com texto não salvo
- [ ] Meia-noite com a tela aberta recusa a gravação e oferece retificar
- [ ] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T107: Migration 0010: financeiro

**What**: Criar `preco_paciente`, `preco_sessao` (com revisões) e `pagamento` com valores em `bigint` centavos e um pagamento por sessão.
**Where**: `backend/scripts/migrations/0010_financeiro.ts`
**Depends on**: T106
**Requirement**: FIN-01, FIN-02

**Done when**:

- [ ] Valor de 0 a 9.999.999.999 por restrição
- [ ] `pagamento` único por sessão
- [ ] Sem DELETE para `app`
- [ ] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T108: Contrato do financeiro em centavos e ADR-007

**What**: Schemas de preço, pagamento e débitos em centavos inteiros.
**Where**: `backend/contrato/src/financeiro.ts`
**Depends on**: T107
**Requirement**: FIN-01, FIN-03

**Done when**:

- [ ] Decimal recusado
- [ ] Data YYYY-MM-DD válida e `meio` da lista
- [ ] ADR-007 gravado

**Tests**: unit
**Gate**: quick

---

### T109: Regras de débito, pagamento e preço

**What**: Copiar `debts.ts`, `payment.ts` e `price.ts` trocando decimal por centavos.
**Where**: `backend/dominio/src/financeiro/debitos.ts`
**Depends on**: T108
**Requirement**: FIN-04, FIN-05, FIN-06

**Done when**:

- [ ] Em débito: realizada sem pagamento e faltou ou cancelada cobrável sem pagamento
- [ ] Agendada e remarcada nunca
- [ ] Pagamento sem valor e sem preço é recusado

**Tests**: unit
**Gate**: quick

---

### T110: Preços do paciente e da sessão

**What**: Definir preço por paciente e ajuste por sessão, com revisão e `row_version`, auditando.
**Where**: `backend/api/src/rotas/precos.ts`
**Depends on**: T109
**Requirement**: FIN-02, FIN-08

**Done when**:

- [ ] Versão divergente responde 409
- [ ] Auditoria `preco_paciente.definido` e `preco_sessao.ajustado` só quando a versão muda
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T111: Pagamentos

**What**: Registrar e corrigir pagamento, sem exclusão.
**Where**: `backend/api/src/rotas/pagamentos.ts`
**Depends on**: T110
**Requirement**: FIN-03, FIN-04, FIN-05, FIN-08

**Done when**:

- [ ] Sem valor usa o preço do paciente; sem preço responde 422
- [ ] Duplicado responde 422 `PAYMENT_DUPLICATE`; com `confirmar_duplicidade` gera revisão
- [ ] Auditoria `pagamento.registrado` e `pagamento.corrigido`

**Tests**: integration
**Gate**: full

---

### T112: Débitos e total pendente

**What**: Listar débitos com filtro e somar o pendente em centavos.
**Where**: `backend/api/src/rotas/debitos.ts`
**Depends on**: T111
**Requirement**: FIN-06, FIN-07

**Done when**:

- [ ] Filtros `em_debito`, `em_dia` e todos
- [ ] Total em centavos inteiros
- [ ] Só dados do profissional

**Tests**: integration
**Gate**: full

---

### T113: Guarda de cancelamento com registros

**What**: Ligar a guarda realizada para cancelada à existência de evolução ou pagamento.
**Where**: `backend/api/src/rotas/sessoes-status.ts`
**Depends on**: T112
**Requirement**: AGE-08

**Done when**:

- [ ] Sessão com evolução ou com pagamento responde 422 `SESSION_HAS_RECORDS`
- [ ] Sem registros, cancela

**Tests**: integration
**Gate**: full

---

### T114: Regras do resumo do Início

**What**: Copiar `summary.ts`.
**Where**: `backend/dominio/src/inicio/resumo.ts`
**Depends on**: T113
**Requirement**: INI-01, INI-03

**Done when**:

- [ ] Classificação de evolução em quatro estados e de pagamento em três
- [ ] Semana de segunda ao último dia habilitado
- [ ] Testes do legado verdes

**Tests**: unit
**Gate**: quick

---

### T115: GET /api/inicio

**What**: Montar o resumo da semana e a lista de hoje (no máximo 6, sem canceladas nem remarcadas).
**Where**: `backend/api/src/rotas/inicio.ts`
**Depends on**: T114
**Requirement**: INI-01, INI-02, INI-03

**Done when**:

- [ ] Com 8 sessões hoje, 6 na lista e contadores corretos
- [ ] "Hoje" pelo relógio do banco em Brasília
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T116: Tela do financeiro

**What**: Débitos com filtro na URL e total pendente.
**Where**: `frontend/web/src/app/financeiro/financeiro.tsx`
**Depends on**: T115
**Requirement**: FIN-07

**Done when**:

- [ ] Filtro guardado na URL
- [ ] Total em reais formatado a partir de centavos
- [ ] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T117: Tela do Início

**What**: Semana, contadores e lista de hoje.
**Where**: `frontend/web/src/app/inicio/inicio.tsx`
**Depends on**: T116
**Requirement**: INI-01, INI-02, INI-03

**Done when**:

- [ ] Contadores e lista batem com a API
- [ ] Selos de evolução e pagamento
- [ ] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T118: GET /api/auditoria

**What**: Trilha da conta e histórico do paciente, páginas de 50, filtros e sem `paciente.consultado`.
**Where**: `backend/api/src/rotas/auditoria.ts`
**Depends on**: T117
**Requirement**: AUD-03

**Done when**:

- [ ] Filtros Todos, Retificações e Exportações
- [ ] Paginação por cursor
- [ ] Evento de consulta excluído
- [ ] Só eventos do profissional

**Tests**: integration
**Gate**: full

---

### T119: Tela de auditoria

**What**: Portar a tela com "Carregar mais".
**Where**: `frontend/web/src/app/auditoria/auditoria.tsx`
**Depends on**: T118
**Requirement**: AUD-03

**Done when**:

- [ ] Duas visões (conta e paciente)
- [ ] Filtros e "Carregar mais"
- [ ] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T120: Migration 0011: limites de uso

**What**: Criar `limite_uso` e a função que conta por janela.
**Where**: `backend/scripts/migrations/0011_limite_uso.ts`
**Depends on**: T119
**Requirement**: EXP-05

**Done when**:

- [ ] Contador por chave e janela atômico
- [ ] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T121: GET prontuário do paciente

**What**: Devolver anamnese (versões e retificações) e evoluções do período em JSON.
**Where**: `backend/api/src/rotas/exportar-prontuario.ts`
**Depends on**: T120
**Requirement**: EXP-01, EXP-07, EXP-06

**Done when**:

- [ ] Período inválido responde 400 e paciente de outro profissional 404
- [ ] Dia em Brasília
- [ ] Auditoria `exportacao.concluida` sem conteúdo

**Tests**: integration
**Gate**: full

---

### T122: GET exportação completa paginada

**What**: Entregar todos os dados do profissional, sem credenciais nem sessões, em páginas por tabela com cursor (D-32), com rate limit no início da exportação.
**Where**: `backend/api/src/rotas/exportar-tudo.ts`
**Depends on**: T121
**Requirement**: EXP-03, EXP-04, EXP-05, EXP-06

**Done when**:

- [ ] Primeiro, medir no Hyperdrive real a CPU de uma página de tamanho fixo (ex.: 300 evoluções de 1.500 caracteres) e fixar o tamanho máximo de página que cabe com folga em 10 ms; se nenhum tamanho útil couber, parar e abrir novo spike
- [ ] Página acima do máximo ou cursor inválido responde 400 sem auditar
- [ ] Mais de 5 exportações iniciadas em 60 s responde 429
- [ ] Sem hash de senha nem sessão no corpo
- [ ] Audita `exportacao.concluida` só ao servir a última página

**Tests**: integration
**Gate**: full

---

### T123: PDF do prontuário no navegador e ADR-008

**What**: Portar o documento de `record-pdf.ts` para pdfmake no navegador, em chunk sob demanda.
**Where**: `frontend/web/src/export/pdf-prontuario.ts`
**Depends on**: T122
**Requirement**: EXP-02

**Done when**:

- [ ] Nome `prontuario-<8 caracteres do id>.pdf`
- [ ] Título, paciente, período, registro e rodapé "Prontuário — documento confidencial"
- [ ] Texto acentuado correto
- [ ] ADR-008 gravado

**Tests**: unit
**Gate**: build

---

### T124: Zip da exportação completa e tela de exportação

**What**: Juntar as páginas da exportação no navegador, montar `.zip` com `dados.json` e um PDF por paciente com fflate, e a tela de exportação.
**Where**: `frontend/web/src/export/zip-completo.ts`
**Depends on**: T123
**Requirement**: EXP-03, EXP-02

**Done when**:

- [ ] Zip contém `dados.json` e um PDF por paciente
- [ ] Chunk carregado só ao exportar
- [ ] Erro 413 e 429 tratados na tela

**Tests**: unit
**Gate**: build

---

### T125: Regras da assinatura e do limite do Free

**What**: Máquina de estados e `limitePacientes`.
**Where**: `backend/dominio/src/plano/assinatura.ts`
**Depends on**: T124
**Requirement**: PLANO-01, PLANO-02, PLANO-03, PLANO-04, PLANO-10, PLANO-11

**Done when**:

- [ ] Cada transição permitida aceita e as demais recusadas
- [ ] Tolerância de 7 dias em `atrasada`
- [ ] Free com 5 ativos retorna `LIMITE_PLANO`, com 4 retorna ok
- [ ] Tempo por parâmetro

**Tests**: unit
**Gate**: quick

---

### T126: Migration 0012: funções `tarefas.*` de assinatura

**What**: Funções `SECURITY DEFINER` para localizar e atualizar assinatura por id do Asaas, sem RLS do usuário.
**Where**: `backend/scripts/migrations/0012_funcoes_plano.ts`
**Depends on**: T125
**Requirement**: PLANO-08, ISO-03

**Done when**:

- [ ] `search_path` fixo e parâmetros tipados
- [ ] Teste das funções `tarefas.*` continua verde
- [ ] `app` só executa as listadas

**Tests**: integration
**Gate**: full

---

### T127: Cliente Asaas

**What**: Criar cliente e assinatura mensal de 1990 centavos por Pix, buscar o QR e cancelar, com tempo limite.
**Where**: `backend/api/src/integracoes/asaas.ts`
**Depends on**: T126
**Requirement**: PLANO-05, PLANO-12

**Done when**:

- [ ] Endpoint do sandbox ou da produção por variável
- [ ] Falha e tempo excedido viram erro tipado
- [ ] Teste com `fetch` simulado dos formatos do spike S3

**Tests**: integration
**Gate**: full

---

### T128: POST /api/plano/assinar

**What**: Assinar o Pro com nome e CPF/CNPJ validado por dígito verificador.
**Where**: `backend/api/src/rotas/plano-assinar.ts`
**Depends on**: T127
**Requirement**: PLANO-05, PLANO-12

**Done when**:

- [ ] CPF/CNPJ inválido responde 422
- [ ] Asaas fora responde 503 sem mudar o estado local
- [ ] Auditoria `assinatura.*`

**Tests**: integration
**Gate**: full

---

### T129: Webhook: autenticação e idempotência

**What**: Validar `asaas-access-token`, gravar `webhook_evento` antes de processar e ignorar repetição.
**Where**: `backend/api/src/rotas/webhook-asaas.ts`
**Depends on**: T128
**Requirement**: PLANO-06, PLANO-07

**Done when**:

- [ ] Sem o token responde 401 sem processar
- [ ] `event_id` repetido responde 200 sem efeito
- [ ] Erro de processamento responde 500 para o Asaas reenviar

**Tests**: integration
**Gate**: full

---

### T130: Webhook: pagamento recebido ou confirmado

**What**: Mudar para `ativa` e definir `periodo_fim` pelo próximo vencimento.
**Where**: `backend/api/src/rotas/webhook-pago.ts`
**Depends on**: T129
**Requirement**: PLANO-08

**Done when**:

- [ ] Estado final igual se o webhook chega antes da resposta da criação
- [ ] Outros estados não regridem
- [ ] Auditoria da mudança

**Tests**: integration
**Gate**: full

---

### T131: Webhook: cobrança vencida

**What**: Mudar para `atrasada` e registrar o início da tolerância.
**Where**: `backend/api/src/rotas/webhook-vencida.ts`
**Depends on**: T130
**Requirement**: PLANO-09

**Done when**:

- [ ] `vencimento_atraso` gravado
- [ ] Transição inválida ignorada com registro

**Tests**: integration
**Gate**: full

---

### T132: POST /api/plano/cancelar

**What**: Cancelar no Asaas, ficar `cancelada` e manter o Pro até `periodo_fim`.
**Where**: `backend/api/src/rotas/plano-cancelar.ts`
**Depends on**: T131
**Requirement**: PLANO-11, PLANO-12

**Done when**:

- [ ] Asaas fora responde 503 sem mudar o estado
- [ ] Depois de `periodo_fim` o cron leva a `free` (etapa seguinte)
- [ ] Auditoria

**Tests**: integration
**Gate**: full

---

### T133: Middleware de plano e limite do Free

**What**: `exigePlano('pro')` e bloqueio de criar e reativar paciente no Free com 5 ativos.
**Where**: `backend/api/src/middleware/plano.ts`
**Depends on**: T132
**Requirement**: PLANO-02, PLANO-03, PLANO-15

**Done when**:

- [ ] Free com 5 ativos responde 403 `LIMITE_PLANO` ao criar e reativar
- [ ] Tudo o que existe segue editável
- [ ] Inativar um libera
- [ ] Trial, ativa, atrasada e cancelada no período liberam tudo

**Tests**: integration
**Gate**: full

---

### T134: GET /api/plano

**What**: Plano atual, renovação ou fim e Pix pendente (QR buscado na hora).
**Where**: `backend/api/src/rotas/plano.ts`
**Depends on**: T133
**Requirement**: PLANO-14, PLANO-05

**Done when**:

- [ ] Pix e QR só com cobrança pendente
- [ ] Dados do Asaas não persistidos além do necessário
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T135: Tela Meu plano

**What**: Plano, renovação, Pix copia-e-cola e QR, assinatura com CPF/CNPJ e cancelamento.
**Where**: `frontend/web/src/app/plano/meu-plano.tsx`
**Depends on**: T134
**Requirement**: PLANO-05, PLANO-11, PLANO-14

**Done when**:

- [ ] Formulário valida CPF/CNPJ
- [ ] "Cobrança indisponível" em 503
- [ ] Cancelar pede confirmação

**Tests**: unit
**Gate**: quick

---

### T136: Despachante do cron e ADR-010

**What**: Um Cron Trigger `*/5 * * * *` que chama as tarefas em ordem, com orçamento de CPU e idempotência.
**Where**: `backend/api/src/tarefas/despachar.ts`
**Depends on**: T135
**Requirement**: PUSH-07, PLANO-04

**Done when**:

- [ ] Tarefa que falha não impede as demais
- [ ] Execução perdida é compensada na seguinte dentro da janela
- [ ] `wrangler.jsonc` com um único cron
- [ ] ADR-010 gravado

**Tests**: integration
**Gate**: full

---

### T137: Tarefa: transições da assinatura

**What**: Trial vencido para free, atraso de 7 dias para free (cancelando no Asaas) e fim do período cancelado para free.
**Where**: `backend/api/src/tarefas/assinaturas.ts`
**Depends on**: T136
**Requirement**: PLANO-04, PLANO-10, PLANO-11

**Done when**:

- [ ] Dados intactos ao cair para Free
- [ ] Cancela no Asaas ao cair por atraso
- [ ] Reexecução não repete efeitos

**Tests**: integration
**Gate**: full

---

### T138: E-mails transacionais de cobrança

**What**: Cobrança gerada, pagamento confirmado e cobrança vencida.
**Where**: `backend/api/src/integracoes/emails-cobranca.ts`
**Depends on**: T137
**Requirement**: PLANO-13

**Done when**:

- [ ] Um e-mail por evento, sem repetir em reenvio de webhook
- [ ] Texto puro em português
- [ ] Falha de envio não desfaz a mudança de estado

**Tests**: integration
**Gate**: full

---

### T139: Tarefa: limpeza de tokens e sessões vencidos

**What**: Marcar como vencidos tokens e sessões antigos por função `tarefas.*`, sem DELETE pela `app`.
**Where**: `backend/api/src/tarefas/limpeza.ts`
**Depends on**: T138
**Requirement**: CAD-03, AUTH-09

**Done when**:

- [ ] Registros vencidos deixam de valer
- [ ] Registros válidos intactos
- [ ] Reexecução é inofensiva

**Tests**: integration
**Gate**: full

---

### T140: Migration 0013: push

**What**: Criar `push_subscription` (endpoint único) e `notificacao_enviada` (única por tipo e referência).
**Where**: `backend/scripts/migrations/0013_push.ts`
**Depends on**: T139
**Requirement**: PUSH-01, PUSH-02

**Done when**:

- [ ] Duplicar o envio viola a restrição
- [ ] RLS forçada
- [ ] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T141: Janelas de envio

**What**: Regras puras: 15 a 10 minutos antes da sessão, 20:00 de Brasília, trial a 3 dias do fim.
**Where**: `backend/dominio/src/push/janelas.ts`
**Depends on**: T140
**Requirement**: PUSH-02, PUSH-03, PUSH-04

**Done when**:

- [ ] Limites exatos de cada janela
- [ ] Fuso de Brasília
- [ ] Uma vez por sessão, por dia e por evento

**Tests**: unit
**Gate**: quick

---

### T142: Cliente de push

**What**: Enviar push cifrado com VAPID ES256 e remover a assinatura em 404 ou 410.
**Where**: `backend/api/src/integracoes/push.ts`
**Depends on**: T141
**Requirement**: PUSH-06, PUSH-07

**Done when**:

- [ ] Assinar o JWT VAPID por conta própria, sem a claim `iat` (o FCM recusa JWT com `iat`, como o da biblioteca 2.0.0), e usar só a cifra da biblioteca; teste que confere as claims (spike push-worker)
- [ ] JWT assinado com `crypto.subtle`
- [ ] 404 e 410 removem a assinatura
- [ ] Lotes com `ctx.waitUntil`
- [ ] ADR-011 gravado

**Tests**: integration
**Gate**: full

---

### T143: Ativar e desativar push

**What**: Guardar e remover a assinatura do dispositivo.
**Where**: `backend/api/src/rotas/push.ts`
**Depends on**: T142
**Requirement**: PUSH-01

**Done when**:

- [ ] Mesmo endpoint não duplica
- [ ] Desativar remove
- [ ] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T144: Tarefa: sessão próxima

**What**: Enviar o aviso de 15 minutos antes, uma vez por sessão.
**Where**: `backend/api/src/tarefas/push-sessao.ts`
**Depends on**: T143
**Requirement**: PUSH-02, PUSH-05

**Done when**:

- [ ] Sessão às 14:00 gera um envio entre 13:45 e 13:50 e nenhum outro
- [ ] Corpo sem nome de paciente nem texto clínico

**Tests**: integration
**Gate**: full

---

### T145: Tarefa: evolução pendente às 20:00

**What**: Enviar a contagem de sessões realizadas sem evolução, uma vez por dia.
**Where**: `backend/api/src/tarefas/push-pendente.ts`
**Depends on**: T144
**Requirement**: PUSH-03, PUSH-05

**Done when**:

- [ ] Sem pendências, nada é enviado
- [ ] Uma vez por dia
- [ ] Corpo só com a quantidade

**Tests**: integration
**Gate**: full

---

### T146: Push de cobrança e fim de trial

**What**: Cobrança gerada, pagamento confirmado, cobrança vencida e trial a 3 dias do fim.
**Where**: `backend/api/src/tarefas/push-cobranca.ts`
**Depends on**: T145
**Requirement**: PUSH-04, PUSH-05

**Done when**:

- [ ] Uma vez por evento
- [ ] Corpo sem dado clínico

**Tests**: integration
**Gate**: full

---

### T147: Service worker e preferência de push

**What**: Handlers de `push` e `notificationclick`, abrindo sessão, Início ou Meu plano, e o interruptor por dispositivo nas configurações.
**Where**: `frontend/web/src/pwa/sw.ts`
**Depends on**: T146
**Requirement**: PUSH-01, PUSH-08

**Done when**:

- [ ] Clique abre a tela relacionada
- [ ] Permissão negada tratada
- [ ] Teste do roteamento do clique

**Tests**: unit
**Gate**: build

---

### T148: Migration 0014: exclusão de conta

**What**: Criar `conta_excluida` e as colunas de bloqueio, e aceitar os tipos `exclusao` e `desistencia` em `token_email`.
**Where**: `backend/scripts/migrations/0014_exclusao.ts`
**Depends on**: T147
**Requirement**: CONTA-03, CONTA-05

**Done when**:

- [ ] `conta_excluida` sem dado pessoal
- [ ] Bloqueio por `bloqueado_exclusao_em`

**Tests**: integration
**Gate**: full

---

### T149: Pedir a exclusão

**What**: Exigir exportação completa servida nas últimas 24 h, declaração de guarda e senha, e enviar o link de confirmação.
**Where**: `backend/api/src/rotas/conta-excluir.ts`
**Depends on**: T148
**Requirement**: CONTA-01, CONTA-02

**Done when**:

- [ ] Cada requisito que falta é indicado no 422
- [ ] Token de 256 bits, SHA-256, 30 min, uso único
- [ ] Auditoria `conta.exclusao_pedida`

**Tests**: integration
**Gate**: full

---

### T150: Confirmar a exclusão

**What**: Bloquear a conta, encerrar sessões, cancelar a assinatura no Asaas e enviar o e-mail com a data da purga e o link de desistência.
**Where**: `backend/api/src/rotas/conta-excluir-confirmar.ts`
**Depends on**: T149
**Requirement**: CONTA-03

**Done when**:

- [ ] Login recusado depois de confirmar
- [ ] Asaas cancelado
- [ ] Link de desistência válido por 30 dias

**Tests**: integration
**Gate**: full

---

### T151: Desistir da exclusão

**What**: Desbloquear a conta antes da purga.
**Where**: `backend/api/src/rotas/conta-desistir.ts`
**Depends on**: T150
**Requirement**: CONTA-04

**Done when**:

- [ ] Volta a entrar com senha e 2FA
- [ ] Plano `free` ou trial restante
- [ ] Link depois da purga responde `link_invalido`

**Tests**: integration
**Gate**: full

---

### T152: Purga e ADR-012

**What**: Função `SECURITY DEFINER` que apaga todas as linhas do profissional após 30 dias e guarda só `conta_excluida`, chamada pelo cron.
**Where**: `backend/api/src/tarefas/purga.ts`
**Depends on**: T151
**Requirement**: CONTA-05

**Done when**:

- [ ] Após 30 dias nenhuma tabela tem linha do profissional, auditoria inclusive (varredura pelo catálogo)
- [ ] `conta_excluida` com id, data do pedido e data da purga
- [ ] Antes de 30 dias nada é apagado
- [ ] ADR-012 gravado

**Tests**: integration
**Gate**: full

---

### T153: Tela de exclusão de conta

**What**: Fluxo com exportação, declaração de guarda e senha.
**Where**: `frontend/web/src/app/conta/excluir.tsx`
**Depends on**: T152
**Requirement**: CONTA-01

**Done when**:

- [ ] Botão só com os três requisitos
- [ ] Mensagens do servidor exibidas

**Tests**: unit
**Gate**: quick

---

### T154: Termos e privacidade

**What**: Páginas `/termos` e `/privacidade` com versão e data, profissional como controlador e LJS como operadora.
**Where**: `frontend/web/src/publico/termos.tsx`
**Depends on**: T153
**Requirement**: CONTA-06, CAD-07

**Done when**:

- [ ] Versão e data exibidas e iguais às gravadas no aceite
- [ ] Texto-base marcado para revisão jurídica

**Tests**: unit
**Gate**: quick

---

### T155: Landing

**What**: Proposta de valor, planos (Free até 5 pacientes ativos, Pro R$ 19,90, trial de 14 dias) e "Começar grátis".
**Where**: `frontend/web/src/publico/landing.tsx`
**Depends on**: T154
**Requirement**: PUB-01

**Done when**:

- [ ] Botão leva a `/cadastro`
- [ ] Preços e limites iguais à spec

**Tests**: unit
**Gate**: quick

---

### T156: Manifest, ícones e página offline

**What**: Manifest com ícones 192 e 512 maskable e `display: standalone`, precache do shell e página offline.
**Where**: `frontend/web/vite.config.ts`
**Depends on**: T155
**Requirement**: PUB-03

**Done when**:

- [ ] Teste confere o manifest gerado
- [ ] Chrome reconhece como instalável (checagem manual registrada)
- [ ] Página offline servida sem rede

**Tests**: unit
**Gate**: build

---

### T157: Instrução de instalação no iOS

**What**: Orientar "Compartilhar" e "Adicionar à Tela de Início" no Safari fora do modo instalado.
**Where**: `frontend/web/src/pwa/instrucao-ios.tsx`
**Depends on**: T156
**Requirement**: PUB-04

**Done when**:

- [ ] Aparece só no Safari do iOS fora do modo instalado
- [ ] Dispensar lembra a escolha

**Tests**: unit
**Gate**: quick

---

### T158: Playwright: cadastro e login

**What**: Infraestrutura e2e e o fluxo cadastro, confirmação, login com 2FA, com e-mail capturado em teste.
**Where**: `e2e/acesso.spec.ts`
**Depends on**: T157
**Requirement**: OPS-05, CAD-04, AUTH-04

**Done when**:

- [ ] `pnpm e2e` sobe o Worker local e o Postgres
- [ ] Conta nova chega ao app com o trial de 14 dias

**Tests**: e2e
**Gate**: full

---

### T159: Playwright: assinar no sandbox

**What**: Assinar o Pro, simular o webhook de pagamento e ver `ativa`.
**Where**: `e2e/plano.spec.ts`
**Depends on**: T158
**Requirement**: PLANO-05, PLANO-08

**Done when**:

- [ ] Pix e QR exibidos
- [ ] Depois do webhook, o plano aparece como ativo

**Tests**: e2e
**Gate**: full

---

### T160: Playwright: agenda, evolução e pagamento

**What**: Fluxo principal do app.
**Where**: `e2e/fluxo-principal.spec.ts`
**Depends on**: T159
**Requirement**: AGE-01, EVO-03, FIN-03

**Done when**:

- [ ] Sessão criada, evolução registrada (sessão vira realizada), pagamento registrado e débito some

**Tests**: e2e
**Gate**: full

---

### T161: Comparação visual com o legado

**What**: Comparar cada tela do escopo com o legado e registrar diferenças.
**Where**: `.specs/features/evolucao-segura/comparacao-visual.md`
**Depends on**: T160
**Requirement**: PUB-02

**Done when**:

- [ ] Sem diferença não justificada
- [ ] Diferenças justificadas listadas

**Tests**: none
**Gate**: build

---

### T162: Script e teste de restauração

**What**: Adaptar `restore-test.sh` para restaurar o dump cifrado num Postgres limpo e comparar a contagem de linhas por tabela.
**Where**: `infra/restore-test.sh`
**Depends on**: T161
**Requirement**: OPS-02

**Done when**:

- [ ] Restaura a partir de cópia limpa
- [ ] Contagem por tabela bate com a origem
- [ ] Falha em qualquer divergência

**Tests**: none
**Gate**: build

---

### T163: README

**What**: Rodar local, variáveis, deploy e testar o webhook local.
**Where**: `README.md`
**Depends on**: T162
**Requirement**: OPS-12

**Done when**:

- [ ] Um agente sem contexto roda o projeto seguindo só o README
- [ ] Cada comando citado foi executado

**Tests**: none
**Gate**: build

---

### T164: Runbook

**What**: Webhook falhou, reprocessar pagamento, reativar usuário, rotacionar segredos e restaurar backup, mais o plano B do Resend e a chave Pix do Asaas.
**Where**: `docs/runbook.md`
**Depends on**: T163
**Requirement**: OPS-12

**Done when**:

- [ ] Cada procedimento tem comandos verificados
- [ ] Pré-requisitos da publicação listados (conta Asaas de produção, chave Pix, domínio, revisão jurídica)
- [ ] Provisionamento de login e senha das roles `owner`, `app` e `backup_ro` no Neon (nascem `NOLOGIN`), com a ordem em relação ao primeiro deploy (pendência do lote 3, ADR-005)
- [ ] Teste de fumaça de vazamento de contexto entre conexões reaproveitadas do Hyperdrive, depois do primeiro deploy (ADR-005)

**Tests**: none
**Gate**: build

---

### T165: Restauração executada e registrada

**What**: Executar o backup, restaurar numa cópia limpa e registrar data, tamanho do dump e contagens no runbook.
**Where**: `docs/runbook.md`
**Depends on**: T164
**Requirement**: OPS-02, OPS-01

**Done when**:

- [ ] Registro com data, tamanho e contagem por tabela
- [ ] Tamanho do dump comparado com o limite de artefatos do Actions

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7 -> Phase 8 -> Phase 9 -> Phase 10 -> Phase 11 -> Phase 12 -> Phase 13 -> Phase 14 -> Phase 15 -> Phase 16 -> Phase 17 -> Phase 18 -> Phase 19 -> Phase 20
```

Passagem entre fases (a primeira tarefa de cada fase depende da última da anterior):

```
T11 -> T12
T15 -> T16
T27 -> T28
T36 -> T37
T45 -> T46
T53 -> T54
T60 -> T61
T66 -> T67
T73 -> T74
T82 -> T83
T88 -> T89
T97 -> T98
T106 -> T107
T117 -> T118
T124 -> T125
T132 -> T133
T139 -> T140
T147 -> T148
T157 -> T158
```

Execução estritamente sequencial; uma tarefa por vez, em ordem, com um commit atômico cada.

