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
- Cada tarefa leva `**Estimativa**` e tem no máximo 2 horas de trabalho humano (regra do projeto). Estimativa das tarefas concluídas é aproximada; acima de 2h, divide-se a tarefa pendente.
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
T107 -> T108 -> T109 -> T110 -> T111 -> T112 -> T113 -> T114 -> T115 -> T116 -> T117 -> T166 -> T167 -> T168
```

### Phase 15: Etapa 11, parte 1: Auditoria (telas) e PDF do prontuário

```
T118 -> T119 -> T120 -> T121 -> T123
```

### Phase 16: Etapa 12, parte 1: Planos, Asaas e webhook

```
T125 -> T126 -> T127 -> T128 -> T169 -> T129 -> T130 -> T131 -> T132
```

### Phase 17: Etapa 12, parte 2: Meu plano, limite do Free e cron único

```
T133 -> T134 -> T135 -> T136 -> T170 -> T137 -> T138 -> T139 -> T196
```

### Phase 18: Etapa 13: Push

```
T140 -> T141 -> T142 -> T176 -> T177 -> T143 -> T144 -> T145 -> T146 -> T178 -> T147 -> T179
```

### Phase 19: Etapa 11, parte 2: Exportação completa (depende de Neon e Hyperdrive de teste)

```
T122 -> T171 -> T172 -> T173 -> T124 -> T174 -> T175
```

### Phase 20: Etapa 14, parte 1: Exclusão de conta

```
T148 -> T149 -> T180 -> T150 -> T181 -> T151 -> T152 -> T182 -> T183 -> T153
```

### Phase 21: Etapa 14, parte 2: Termos, landing e PWA

```
T154 -> T155 -> T156 -> T184 -> T157
```

### Phase 22: Etapa 15, parte 1: Testes de ponta a ponta (e2e)

```
T158 -> T185 -> T159 -> T186 -> T160 -> T187
```

### Phase 23: Etapa 15, parte 2: Fechamento (comparação visual, restauração, README e runbook)

```
T161 -> T188 -> T189 -> T190 -> T162 -> T191 -> T163 -> T192 -> T164 -> T193 -> T194 -> T197 -> T198 -> T199 -> T195 -> T165
```

---

## Task Breakdown

### T1: Primeiro commit e branch main

**What**: Criar a branch `main` e versionar o que já existe (`.gitignore`, `.claude/`, `.specs/`).
**Estimativa**: 30 min
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
**Estimativa**: 1,5h
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
**Estimativa**: 1h
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
**Estimativa**: 1h
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
**Estimativa**: 30 min
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
**Estimativa**: 1h
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
**Estimativa**: 1h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 4h
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
**Estimativa**: 3h
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
**Estimativa**: 5h
**Where**: `.specs/spikes/asaas-sandbox/`
**Depends on**: T13
**Requirement**: PLANO-05, PLANO-06

**Done when**:

- [x] Chave do sandbox fornecida pelo usuário e fora do git
- [x] Campos exigidos pelo Asaas e eventos do webhook anotados
- [x] Veredito registrado

**Tests**: none (spike descartável, isento pelo CLAUDE.md)
**Gate**: build (sem código de produto)

---

### T15: Spike S4: Web Push no Worker

**What**: Provar o envio de push cifrado com `@block65/webcrypto-web-push` e VAPID ES256 a partir de um Worker.
**Estimativa**: 4h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 4h
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
**Estimativa**: 3h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 4h
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
**Estimativa**: 3h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 2h
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
**Estimativa**: 4h
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
**Estimativa**: 2h
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
**Estimativa**: 1,5h
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
**Estimativa**: 1,5h
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
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/evolucoes.ts`
**Depends on**: T100
**Requirement**: EVO-01, EVO-02, EVO-03

**Done when**:

- [x] Segunda evolução da sessão responde 409 `EVOLUTION_EXISTS`
- [x] Sessão agendada vira realizada, atomicamente
- [x] Evolução sem sessão aceita
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T102: Editar a evolução no dia

**What**: Permitir edição no dia do cadastro com `row_version` obrigatório.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/evolucoes-editar.ts`
**Depends on**: T101
**Requirement**: EVO-04

**Done when**:

- [x] Versão divergente responde 409
- [x] Depois da meia-noite a edição é recusada (relógio do banco)

**Tests**: integration
**Gate**: full

---

### T103: Retificar a evolução

**What**: Criar retificação com texto novo e motivo depois do dia do cadastro; sem rota de exclusão.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/evolucoes-retificar.ts`
**Depends on**: T102
**Requirement**: EVO-05, EVO-06, EVO-07

**Done when**:

- [x] No dia responde 409 `EDIT_WINDOW_OPEN`
- [x] Original preservada
- [x] Não existe rota DELETE

**Tests**: integration
**Gate**: full

---

### T104: Rascunhos

**What**: Upsert por (profissional, tipo, ref) com `If-Match`.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/rascunhos.ts`
**Depends on**: T103
**Requirement**: RAS-01, RAS-02

**Done when**:

- [x] `If-Match` divergente responde 412; rascunho inexistente aceita ausente ou "0"
- [x] Payload acima de 512 KiB recusado
- [x] Nada é apagado

**Tests**: integration
**Gate**: full

---

### T105: Modelos de texto

**What**: Criar, listar e arquivar modelos do tipo `evolucao`.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/modelos-texto.ts`
**Depends on**: T104
**Requirement**: RAS-03

**Done when**:

- [x] Nome duplicado (sem diferenciar maiúsculas) recusado
- [x] Arquivar em vez de apagar
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T106: Telas de evolução, rascunho e modelos

**What**: Portar as telas e oferecer restaurar o rascunho no próximo acesso após expirar a sessão.
**Estimativa**: 3h
**Where**: `frontend/web/src/app/evolucao/evolucao.tsx`
**Depends on**: T105
**Requirement**: RAS-04, EVO-04, EVO-05

**Done when**:

- [x] Rascunho oferecido depois da sessão expirar com texto não salvo
- [x] Meia-noite com a tela aberta recusa a gravação e oferece retificar
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T107: Migration 0010: financeiro

**What**: Criar `preco_paciente`, `preco_sessao` (com revisões) e `pagamento` com valores em `bigint` centavos e um pagamento por sessão.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0010_financeiro.ts`
**Depends on**: T106
**Requirement**: FIN-01, FIN-02

**Done when**:

- [x] Valor de 0 a 9.999.999.999 por restrição
- [x] `pagamento` único por sessão
- [x] Sem DELETE para `app`
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T108: Contrato do financeiro em centavos e ADR-007

**What**: Schemas de preço, pagamento e débitos em centavos inteiros.
**Estimativa**: 1,5h
**Where**: `backend/contrato/src/financeiro.ts`
**Depends on**: T107
**Requirement**: FIN-01, FIN-03

**Done when**:

- [x] Decimal recusado
- [x] Data YYYY-MM-DD válida e `meio` da lista
- [x] ADR-007 gravado

**Tests**: unit
**Gate**: quick

---

### T109: Regras de débito, pagamento e preço

**What**: Copiar `debts.ts`, `payment.ts` e `price.ts` trocando decimal por centavos.
**Estimativa**: 1,5h
**Where**: `backend/dominio/src/financeiro/debitos.ts`
**Depends on**: T108
**Requirement**: FIN-04, FIN-05, FIN-06

**Done when**:

- [x] Em débito: realizada sem pagamento e faltou ou cancelada cobrável sem pagamento
- [x] Agendada e remarcada nunca
- [x] Pagamento sem valor e sem preço é recusado

**Tests**: unit
**Gate**: quick

---

### T110: Preços do paciente e da sessão

**What**: Definir preço por paciente e ajuste por sessão, com revisão e `row_version`, auditando.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/precos.ts`
**Depends on**: T109
**Requirement**: FIN-02, FIN-08

**Done when**:

- [x] Versão divergente responde 409
- [x] Auditoria `preco_paciente.definido` e `preco_sessao.ajustado` só quando a versão muda
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T111: Pagamentos

**What**: Registrar e corrigir pagamento, sem exclusão.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/pagamentos.ts`
**Depends on**: T110
**Requirement**: FIN-03, FIN-04, FIN-05, FIN-08

**Done when**:

- [x] Sem valor usa o preço do paciente; sem preço responde 422
- [x] Duplicado responde 422 `PAYMENT_DUPLICATE`; com `confirmar_duplicidade` gera revisão
- [x] Auditoria `pagamento.registrado` e `pagamento.corrigido`

**Tests**: integration
**Gate**: full

---

### T112: Débitos e total pendente

**What**: Listar débitos com filtro e somar o pendente em centavos.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/debitos.ts`
**Depends on**: T111
**Requirement**: FIN-06, FIN-07

**Done when**:

- [x] Filtros `em_debito`, `em_dia` e todos
- [x] Total em centavos inteiros
- [x] Só dados do profissional

**Tests**: integration
**Gate**: full

---

### T113: Guarda de cancelamento com registros

**What**: Ligar a guarda realizada para cancelada à existência de evolução ou pagamento.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/sessoes-status.ts`
**Depends on**: T112
**Requirement**: AGE-08

**Done when**:

- [x] Sessão com evolução ou com pagamento responde 422 `SESSION_HAS_RECORDS`
- [x] Sem registros, cancela

**Tests**: integration
**Gate**: full

---

### T114: Regras do resumo do Início

**What**: Copiar `summary.ts`.
**Estimativa**: 1,5h
**Where**: `backend/dominio/src/inicio/resumo.ts`
**Depends on**: T113
**Requirement**: INI-01, INI-03

**Done when**:

- [x] Classificação de evolução em quatro estados e de pagamento em três
- [x] Semana de segunda ao último dia habilitado
- [x] Testes do legado verdes

**Tests**: unit
**Gate**: quick

---

### T115: GET /api/inicio

**What**: Montar o resumo da semana e a lista de hoje (no máximo 6, sem canceladas nem remarcadas).
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/inicio.ts`
**Depends on**: T114
**Requirement**: INI-01, INI-02, INI-03

**Done when**:

- [x] Com 8 sessões hoje, 6 na lista e contadores corretos
- [x] "Hoje" pelo relógio do banco em Brasília
- [x] Isolamento coberto

**Tests**: integration
**Gate**: full

---

### T116: Tela do financeiro

**What**: Débitos com filtro na URL e total pendente.
**Estimativa**: 3h
**Where**: `frontend/web/src/app/financeiro/financeiro.tsx`
**Depends on**: T115
**Requirement**: FIN-07

**Done when**:

- [x] Filtro guardado na URL
- [x] Total em reais formatado a partir de centavos
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T117: Tela do Início

**What**: Semana, contadores e lista de hoje.
**Estimativa**: 3h
**Where**: `frontend/web/src/app/inicio/inicio.tsx`
**Depends on**: T116
**Requirement**: INI-01, INI-02, INI-03

**Done when**:

- [x] Contadores e lista batem com a API
- [x] Selos de evolução e pagamento
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T166: Telas de preço do paciente e da sessão

**What**: Definir o preço do paciente e ajustar o preço da sessão, com leitura do valor atual, `row_version` e erro 409.
**Estimativa**: 1,5h
**Where**: `frontend/web/src/app/financeiro/preco.tsx`, `frontend/web/src/app/financeiro/api.ts` e `frontend/web/src/rotas.tsx`
**Depends on**: T117
**Requirement**: FIN-09

**Done when**:

- [x] Rotas `/app/financeiro/preco/paciente/:id` e `/app/financeiro/preco/sessao/:id`
- [x] Valor mostrado em reais e enviado em centavos inteiros; decimal inválido recusado na tela
- [x] GET 404 = formulário de criação sem `row_version`; GET 200 = edição com o `row_version` lido
- [x] 409 `versao_divergente` pede para recarregar, sem perder o que foi digitado
- [x] Layout comparado com o legado (billing/price)

**Tests**: unit
**Gate**: quick

---

### T167: Tela de registrar pagamento

**What**: Registrar ou corrigir o pagamento de uma sessão (data, meio, valor opcional), com confirmação de duplicidade.
**Estimativa**: 1,5h
**Where**: `frontend/web/src/app/financeiro/pagamento.tsx`, `frontend/web/src/app/financeiro/api.ts` e `frontend/web/src/rotas.tsx`
**Depends on**: T166
**Requirement**: FIN-09

**Done when**:

- [x] Rota `/app/financeiro/pagamento/:sessaoId`; meios da lista fechada e data de hoje por padrão
- [x] Valor vazio usa o preço da API; 422 `PRICE_REQUIRED` pede o valor
- [x] 422 `PAYMENT_DUPLICATE` pede confirmação explícita e só então reenvia com `confirmar_duplicidade: true`; 201 e 200 mostram mensagens distintas
- [x] Link "Registrar pagamento" na lista de débitos do financeiro (T116)
- [x] Layout comparado com o legado (billing/payment)

**Tests**: unit
**Gate**: quick

---

### T168: Atalho "Pagamento" na lista de hoje do Início

**What**: Sessão pendente de pagamento na lista de hoje ganha o atalho para a tela de pagamento.
**Estimativa**: 1,5h
**Where**: `frontend/web/src/app/inicio/inicio.tsx`
**Depends on**: T167
**Requirement**: FIN-09, INI-03

**Done when**:

- [x] Atalho "Pagamento" só nas sessões com pagamento pendente; some em pago e não cobrável
- [x] O atalho leva a `/app/financeiro/pagamento/:sessaoId`
- [x] Testes existentes do Início seguem verdes sem alteração

**Tests**: unit
**Gate**: build

---

### T118: GET /api/auditoria

**What**: Trilha da conta e histórico do paciente, páginas de 50, filtros e sem `paciente.consultado`.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/auditoria.ts`
**Depends on**: T168
**Requirement**: AUD-03

**Done when**:

- [x] Filtros Todos, Retificações e Exportações
- [x] Paginação por cursor
- [x] Evento de consulta excluído
- [x] Só eventos do profissional

**Tests**: integration
**Gate**: full

---

### T119: Tela de auditoria

**What**: Portar a tela com "Carregar mais".
**Estimativa**: 1,5h
**Where**: `frontend/web/src/app/auditoria/auditoria.tsx`
**Depends on**: T118
**Requirement**: AUD-03

**Done when**:

- [x] Duas visões (conta e paciente)
- [x] Filtros e "Carregar mais"
- [x] Layout comparado com o legado

**Tests**: unit
**Gate**: quick

---

### T120: Migration 0011: limites de uso

**What**: Criar `limite_uso` e a função que conta por janela.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0011_limite_uso.ts`
**Depends on**: T119
**Requirement**: EXP-05

**Done when**:

- [x] Contador por chave e janela atômico
- [x] Entra no teste de isolamento

**Tests**: integration
**Gate**: full

---

### T121: GET prontuário do paciente

**What**: Devolver anamnese (versões e retificações) e evoluções do período em JSON.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/exportar-prontuario.ts`
**Depends on**: T120
**Requirement**: EXP-01, EXP-07, EXP-06

**Done when**:

- [x] Período inválido responde 400 e paciente de outro profissional 404
- [x] Dia em Brasília
- [x] Auditoria `exportacao.concluida` sem conteúdo

**Tests**: integration
**Gate**: full

---

### T123: PDF do prontuário no navegador e ADR-008

**What**: Portar o documento de `record-pdf.ts` para pdfmake no navegador, em chunk sob demanda.
**Estimativa**: 3h
**Where**: `frontend/web/src/export/pdf-prontuario.ts`
**Depends on**: T121
**Requirement**: EXP-02

**Done when**:

- [x] Nome `prontuario-<8 caracteres do id>.pdf`
- [x] Título, paciente, período, registro e rodapé "Prontuário — documento confidencial"
- [x] Texto acentuado correto
- [x] ADR-008 gravado

**Tests**: unit
**Gate**: build

---

### T125: Regras da assinatura e do limite do Free

**What**: Máquina de estados e `limitePacientes`.
**Estimativa**: 2h
**Where**: `backend/dominio/src/plano/assinatura.ts`
**Depends on**: T123
**Requirement**: PLANO-01, PLANO-02, PLANO-03, PLANO-04, PLANO-10, PLANO-11

**Done when**:

- [x] Cada transição permitida aceita e as demais recusadas
- [x] Tolerância de 7 dias em `atrasada`
- [x] Free com 5 ativos retorna `LIMITE_PLANO`, com 4 retorna ok
- [x] Tempo por parâmetro

**Tests**: unit
**Gate**: quick

---

### T126: Migration 0012: funções `tarefas.*` de assinatura

**What**: Funções `SECURITY DEFINER` para localizar e atualizar assinatura por id do Asaas, sem RLS do usuário.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0012_funcoes_plano.ts`
**Depends on**: T125
**Requirement**: PLANO-08, ISO-03

**Done when**:

- [x] `search_path` fixo e parâmetros tipados
- [x] Teste das funções `tarefas.*` continua verde
- [x] `app` só executa as listadas

**Tests**: integration
**Gate**: full

---

### T127: Cliente Asaas

**What**: Criar cliente e assinatura mensal de 1990 centavos por Pix, buscar o QR e cancelar, com tempo limite.
**Estimativa**: 2h
**Where**: `backend/api/src/integracoes/asaas.ts`
**Depends on**: T126
**Requirement**: PLANO-05, PLANO-12

**Done when**:

- [x] Endpoint do sandbox ou da produção por variável
- [x] Falha e tempo excedido viram erro tipado
- [x] Teste com `fetch` simulado dos formatos do spike S3

**Tests**: integration
**Gate**: full

---

### T128: POST /api/plano/assinar

**What**: Assinar o Pro com nome e CPF/CNPJ validado por dígito verificador.
**Estimativa**: 3h
**Where**: `backend/api/src/rotas/plano-assinar.ts`, `backend/contrato/src/plano.ts` e `backend/scripts/migrations/0013_ids_asaas.ts` (função `public.gravar_ids_asaas`, porque a `app` não tem UPDATE na assinatura)
**Decisões do usuário (2026-10-27)**: ids do Asaas gravados pela função da migration 0013 (a do webhook passou a ser a 0014 e as seguintes subiram um número); assinar só em trial e free, os demais estados respondem 409; primeiro vencimento hoje em America/Sao_Paulo; auditoria pela ação nova `assinatura.solicitada`. PREMISSA: 409 também sem assinatura e em trial que já tem assinatura no Asaas; cliente do Asaas criado a cada assinatura.
**Depends on**: T127
**Requirement**: PLANO-05, PLANO-12

**Done when**:

- [x] CPF/CNPJ inválido responde 422
- [x] Asaas fora responde 503 sem mudar o estado local
- [x] Auditoria `assinatura.*`

**Tests**: integration
**Gate**: full

---

### T169: Migration 0014: função `tarefas.*` do webhook

**What**: Função `SECURITY DEFINER` para gravar `webhook_evento` (idempotente por `event_id`) e marcar `processado_em`, porque a `app` só lê essa tabela.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0014_funcoes_webhook.ts`
**Depends on**: T128
**Requirement**: PLANO-06, PLANO-07

**Done when**:

- [x] Gravar evento novo devolve "novo"; `event_id` repetido devolve "repetido" sem alterar o registro
- [x] Marcar `processado_em` só em evento existente e só uma vez
- [x] `search_path` fixo, parâmetros tipados, `app` executa só as funções listadas e `backup_ro` nenhuma
- [x] Lista explícita de `funcoes-tarefas.test.ts` atualizada; teste de isolamento segue verde

**Tests**: integration
**Gate**: full

---

### T129: Webhook: autenticação e idempotência

**What**: Validar `asaas-access-token`, gravar `webhook_evento` antes de processar e ignorar repetição.
**Estimativa**: 3h
**Where**: `backend/api/src/rotas/webhook-asaas.ts`
**Depends on**: T169
**Requirement**: PLANO-06, PLANO-07

**Done when**:

- [x] Sem o token responde 401 sem processar
- [x] `event_id` repetido responde 200 sem efeito
- [x] Erro de processamento responde 500 para o Asaas reenviar
- Decisão do usuário (2026-10-27): gravar e processar numa transação só; erro (ou assinatura não achada, T130 e T131) responde 500 e o reenvio chega como evento novo. PREMISSA: corpo sem `id` ou `event` responde 422.

**Tests**: integration
**Gate**: full

---

### T130: Webhook: pagamento recebido ou confirmado

**What**: Mudar para `ativa` e definir `periodo_fim` pelo próximo vencimento.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/webhook-pago.ts`
**Depends on**: T129
**Requirement**: PLANO-08

**Done when**:

- [x] Estado final igual se o webhook chega antes da resposta da criação
- [x] Outros estados não regridem
- [x] Auditoria da mudança
- Decisão do usuário (2026-10-27): `periodo_fim` = início do dia seguinte ao `nextDueDate` (de `GET /subscriptions/{id}`, método novo do cliente Asaas) em America/Sao_Paulo. Cancelada não volta a ativa: ignorada e registrada no Sentry (`AvisoWebhook`).

**Tests**: integration
**Gate**: full

---

### T131: Webhook: cobrança vencida

**What**: Mudar para `atrasada` e registrar o início da tolerância.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/webhook-vencida.ts`
**Depends on**: T130
**Requirement**: PLANO-09

**Done when**:

- [x] `vencimento_atraso` gravado
- [x] Transição inválida ignorada com registro
- PREMISSA: `vencimento_atraso` = início do dia seguinte ao `dueDate` em America/Sao_Paulo (mesma regra do `periodo_fim`); o registro da transição inválida vai ao Sentry (`AvisoWebhook`) e o evento fica marcado com o profissional.

**Tests**: integration
**Gate**: full

---

### T132: POST /api/plano/cancelar

**What**: Cancelar no Asaas, ficar `cancelada` e manter o Pro até `periodo_fim`.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/plano-cancelar.ts`
**Depends on**: T131
**Requirement**: PLANO-11, PLANO-12

**Done when**:

- [x] Asaas fora responde 503 sem mudar o estado
- [x] Depois de `periodo_fim` o cron leva a `free` (etapa seguinte)
- [x] Auditoria
- Decisão do usuário (2026-10-27): só `ativa` cancela; os demais estados respondem 409. O "cron leva a free" é provado aqui pela regra `estadoPorTempo` sobre a linha cancelada; o cron em si é a T137.

**Tests**: integration
**Gate**: full

---

### T133: Middleware de plano e limite do Free

**What**: `exigePlano('pro')` e bloqueio de criar e reativar paciente no Free com 5 ativos.
**Estimativa**: 2h
**Where**: `backend/api/src/middleware/plano.ts`
**Depends on**: T132
**Requirement**: PLANO-02, PLANO-03, PLANO-15

**Done when**:

- [x] Free com 5 ativos responde 403 `LIMITE_PLANO` ao criar e reativar
- [x] Tudo o que existe segue editável
- [x] Inativar um libera
- [x] Trial, ativa, atrasada e cancelada no período liberam tudo
- PREMISSA: sem linha de assinatura conta como Free; reativar paciente já ativo ou inexistente segue 200 (PAC-04) ou 404 antes do limite; contagem com advisory lock por profissional (pedidos simultâneos não passam do limite). SPEC_DEVIATION: o exigePlano roda dentro da transação, depois da lista `autenticada`, não entre o CSRF e a transação.

**Tests**: integration
**Gate**: full

---

### T134: GET /api/plano

**What**: Plano atual, renovação ou fim e Pix pendente (QR buscado na hora).
**Estimativa**: 3h
**Where**: `backend/api/src/rotas/plano.ts`
**Depends on**: T133
**Requirement**: PLANO-14, PLANO-05

**Done when**:

- [x] Pix e QR só com cobrança pendente
- [x] Dados do Asaas não persistidos além do necessário
- [x] Isolamento coberto
- Decisão do usuário (2026-10-27): o Pix aparece com cobrança `PENDING` ou `OVERDUE` (a vencida também, para pagar na tolerância da D-21); com mais de uma, a de vencimento mais antigo. PREMISSA: cancelada não consulta o Asaas; `plano` e `status` efetivos pelas regras da T125; data de renovação em ativa e de fim em trial, cancelada e atrasada (vencimento + 7 dias); Asaas fora ou sem configuração = 503 `cobranca_indisponivel`; sem assinatura no Asaas, o Asaas não é chamado.

**Tests**: integration
**Gate**: full

---

### T135: Tela Meu plano

**What**: Plano, renovação, Pix copia-e-cola e QR, assinatura com CPF/CNPJ e cancelamento.
**Estimativa**: 3h
**Where**: `frontend/web/src/app/plano/meu-plano.tsx`
**Depends on**: T134
**Requirement**: PLANO-05, PLANO-11, PLANO-14

**Done when**:

- [x] Formulário valida CPF/CNPJ
- [x] "Cobrança indisponível" em 503
- [x] Cancelar pede confirmação

**Tests**: unit
**Gate**: quick

---

### T136: Despachante do cron e ADR-010

**What**: Um Cron Trigger `*/5 * * * *` que chama as tarefas em ordem, com orçamento de CPU e idempotência.
**Estimativa**: 4h
**Where**: `backend/api/src/tarefas/despachar.ts`
**Depends on**: T135
**Requirement**: PUSH-07, PLANO-04

**Done when**:

- [x] Tarefa que falha não impede as demais
- [x] Execução perdida é compensada na seguinte dentro da janela
- [x] `wrangler.jsonc` com um único cron
- [x] ADR-010 gravado

**Tests**: integration
**Gate**: full

---

### T170: Migration 0015: função `tarefas.*` das assinaturas vencidas

**What**: Função `SECURITY DEFINER` que lista, entre todos os usuários, as assinaturas cujo tempo acabou (trial e cancelada com `periodo_fim` vencido; atrasada com a tolerância de 7 dias esgotada), devolvendo `usuario_id`, `status` e `asaas_subscription_id`, para o cron da T137.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0015_funcoes_assinaturas_vencidas.ts`
**Depends on**: T136
**Requirement**: PLANO-04, PLANO-10, PLANO-11

**Done when**:

- [x] Lista só os casos vencidos pelas regras da T125, com o tempo por parâmetro
- [x] Não devolve dado clínico nem de outro tipo além dos três campos
- [x] `search_path` fixo, parâmetros tipados, `app` executa só as funções listadas e `backup_ro` nenhuma
- [x] Lista explícita de `funcoes-tarefas.test.ts` atualizada; teste de isolamento segue verde

- Decisão do usuário (2026-10-27): a mesma migration cria `tarefas.desvincular_assinatura_asaas(usuario)`, que limpa o `asaas_subscription_id` da assinatura já em `free` (a T137 a chama depois de cancelar no Asaas por atraso, para o `GET /api/plano` deixar de consultar o Asaas); mantém o `asaas_customer_id`. A listagem recebe também `p_limite` (lote do cron, ADR-010).

**Tests**: integration
**Gate**: full

---

### T137: Tarefa: transições da assinatura

**What**: Trial vencido para free, atraso de 7 dias para free (cancelando no Asaas) e fim do período cancelado para free.
**Estimativa**: 3h
**Where**: `backend/api/src/tarefas/assinaturas.ts`
**Depends on**: T170
**Requirement**: PLANO-04, PLANO-10, PLANO-11

**Done when**:

- [x] Dados intactos ao cair para Free
- [x] Cancela no Asaas ao cair por atraso
- [x] Reexecução não repete efeitos

- Decisão do usuário (2026-10-27): ao cair por atraso, cancela no Asaas e limpa o `asaas_subscription_id` (`tarefas.desvincular_assinatura_asaas`, migration 0015); falha do Asaas não muda nada e a execução seguinte tenta de novo. PREMISSA: 404 do Asaas no cancelamento conta como já cancelada. Trial e cancelada não chamam o Asaas e mantêm os ids. Audita `assinatura.free` (ator sistema).

**Tests**: integration
**Gate**: full

---

### T138: E-mails transacionais de cobrança

**What**: Cobrança gerada, pagamento confirmado e cobrança vencida.
**Estimativa**: 3h
**Where**: `backend/api/src/integracoes/emails-cobranca.ts`
**Depends on**: T137
**Requirement**: PLANO-13

**Done when**:

- [x] Um e-mail por evento, sem repetir em reenvio de webhook
- [x] Texto puro em português
- [x] Falha de envio não desfaz a mudança de estado

- O e-mail sai do webhook (T129 a T131) depois do COMMIT, em segundo plano: cobrança gerada em `PAYMENT_CREATED` (processador novo `rotas/webhook-gerada.ts`; assinatura não achada responde 500, como os outros eventos), pagamento confirmado só quando o pagamento muda o estado ou adianta `periodo_fim`, cobrança vencida só na mudança para `atrasada`. Sem função `tarefas.*` nova: a dedupe é o `event_id` mais o estado. PREMISSA: sem `RESEND_API_KEY` ou `MAIL_FROM` os e-mails de cobrança ficam desligados (sem erro no Sentry).

**Tests**: integration
**Gate**: full

---

### T139: Tarefa: limpeza de tokens e sessões vencidos

**What**: Marcar como vencidos tokens e sessões antigos por função `tarefas.*`, sem DELETE pela `app`.
**Estimativa**: 2h
**Where**: `backend/api/src/tarefas/limpeza.ts`
**Depends on**: T138
**Requirement**: CAD-03, AUTH-09

**Done when**:

- [x] Registros vencidos deixam de valer
- [x] Registros válidos intactos
- [x] Reexecução é inofensiva

- A função `tarefas.vencer_tokens_e_sessoes(agora)` vai na migration 0016 (`0016_funcoes_limpeza.ts`); por isso T140 passa a 0017 e T148 a 0018. Marca `token_email` (invalidado_em) e `sessao` (encerrada_em); `desafio_2fa` fica de fora (não é token nem sessão; o código já expira por `expira_em`).

**Tests**: integration
**Gate**: full

---

### T196: Desvincular o id do Asaas também na cancelada que cai para free

**What**: Fazer a tarefa de transições (T137) desvincular o `asaas_subscription_id` também quando a assinatura cancelada vira `free`, para o `GET /api/plano` não consultar o Asaas com uma assinatura já cancelada. Teste primeiro.
**Estimativa**: 1h
**Where**: `backend/api/src/tarefas/assinaturas.ts`
**Depends on**: T139
**Requirement**: PLANO-11

**Done when**:

- [x] Cancelada que cai para free fica sem `asaas_subscription_id`
- [x] Reexecução não repete efeitos
- [x] `GET /api/plano` de quem está sem id não chama o Asaas

- O teste da T137 "cancelada ... mantém os ids" foi trocado para exigir o id limpo, pela decisão do usuário (2026-10-27) que criou esta tarefa; a auditoria passa a listar `asaas_subscription_id`.

**Tests**: integration
**Gate**: full

---

### T140: Migration 0017: push

**What**: Criar `push_subscription` (endpoint único) e `notificacao_enviada` (única por tipo e referência).
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0017_push.ts`
**Depends on**: T196
**Requirement**: PUSH-01, PUSH-02

**Done when**:

- [x] Duplicar o envio viola a restrição
- [x] RLS forçada
- [x] Entra no teste de isolamento

- `notificacao_enviada` é única por (usuario_id, tipo, ref): a ref do dia (PUSH-03) é a mesma para todos; a app só grava e lê. `push_subscription` com endpoint único global; a app tem SELECT, INSERT, DELETE (desativar remove; ISO-03 não cobre a assinatura) e UPDATE só nas chaves.
- `pacientes-ativo.test.ts` ("não toca em nenhum outro dado"): `retratoDoResto` passou a consultar as tabelas em paralelo (`Promise.all`), porque com as duas tabelas novas o teste passava de 5 s; a asserção não mudou. Mudança aprovada pelo usuário em 2026-10-27.

**Tests**: integration
**Gate**: full

---

### T141: Janelas de envio

**What**: Regras puras: 15 a 10 minutos antes da sessão, 20:00 de Brasília, trial a 3 dias do fim.
**Estimativa**: 1,5h
**Where**: `backend/dominio/src/push/janelas.ts`
**Depends on**: T140
**Requirement**: PUSH-02, PUSH-03, PUSH-04

**Done when**:

- [x] Limites exatos de cada janela
- [x] Fuso de Brasília
- [x] Uma vez por sessão, por dia e por evento

- Limites: sessão próxima quando faltam de 15 a 10 minutos (os dois inclusive); pendência das 20:00 às 21:00 (exclusivo) em America/Sao_Paulo (PREMISSA aprovada pelo usuário em 2026-10-27: a hora seguinte compensa execução perdida do cron); trial de `periodo_fim` - 72 h (inclusive) até `periodo_fim` (exclusivo). Chaves de `notificacao_enviada`: id da sessão, dia de Brasília, `periodo_fim` ISO e id da cobrança.

**Tests**: unit
**Gate**: quick

---

### T142: JWT VAPID assinado sem `iat`

**What**: Assinar o JWT VAPID ES256 por conta própria, sem a claim `iat`.
**Estimativa**: 2h
**Where**: `backend/api/src/integracoes/push-vapid.ts`
**Depends on**: T141
**Requirement**: PUSH-06

**Done when**:

- [x] Assinar o JWT VAPID por conta própria, sem a claim `iat` (o FCM recusa JWT com `iat`, como o da biblioteca 2.0.0); teste que confere as claims (spike push-worker)
- [x] JWT assinado com `crypto.subtle`

- Claims `aud` (origem do endpoint), `exp` (agora + 12 h) e `sub`; chaves no formato do spike (pública P-256 crua e `d` do JWK, base64url); `cabecalhoAutorizacaoVapid` monta `vapid t=<jwt>, k=<chave pública>`.

**Tests**: integration
**Gate**: full

---

### T176: Envio de push cifrado e remoção de assinatura morta

**What**: Enviar o push cifrado usando só a cifra da biblioteca e remover a assinatura em 404 ou 410.
**Estimativa**: 2h
**Where**: `backend/api/src/integracoes/push.ts`
**Depends on**: T142
**Requirement**: PUSH-06, PUSH-07

**Done when**:

- [x] Só a cifra da biblioteca é usada; o JWT vem da T142
- [x] 404 e 410 removem a assinatura

- `@block65/webcrypto-web-push` 2.0.0 instalada (só `encryptNotification`). A mensagem vai cifrada como JSON `{titulo, corpo, url}`. 201 não prova entrega; outras respostas e erro de rede devolvem `falha` sem remover nem lançar. TTL padrão de 1 h (PREMISSA). A remoção roda numa transação do dono da assinatura (RLS; a app tem DELETE na `push_subscription`).

**Tests**: integration
**Gate**: full

---

### T177: Envio de push em lotes e ADR-011

**What**: Enviar em lotes com `ctx.waitUntil` e gravar o ADR-011.
**Estimativa**: 1,5h
**Where**: `backend/api/src/integracoes/push-lotes.ts`
**Depends on**: T176
**Requirement**: PUSH-07

**Done when**:

- [x] Lotes com `ctx.waitUntil`
- [x] ADR-011 gravado

- Um único `waitUntil` por chamada; dentro dele, lotes em sequência com até 6 envios simultâneos (PREMISSA: limite de conexões de saída de uma execução do Worker). Envio com erro vai a `capturarErro` e não impede os demais. ADR em `.md/adr/011-web-push-com-web-crypto.md`.

**Tests**: integration
**Gate**: full

---

### T143: Ativar e desativar push

**What**: Guardar e remover a assinatura do dispositivo.
**Estimativa**: 1,5h
**Where**: `backend/api/src/rotas/push.ts`
**Depends on**: T177
**Requirement**: PUSH-01

**Done when**:

- [x] Mesmo endpoint não duplica
- [x] Desativar remove
- [x] Isolamento coberto

- `POST /api/push/assinatura` (corpo = `PushSubscription.toJSON()`) e `DELETE /api/push/assinatura` (`{endpoint}`), autenticadas, 204 nas duas; contrato em `backend/contrato/src/push.ts`. Mesmo endpoint do profissional só troca as chaves. PREMISSAS: endpoint já ativo para outro profissional responde 409 `endpoint_em_uso` sem tocar na linha dele; desativar sem nada a remover responde 204; sem auditoria (a spec não lista evento de push).

**Tests**: integration
**Gate**: full

---

### T144: Tarefa: sessão próxima

**What**: Enviar o aviso de 15 minutos antes, uma vez por sessão.
**Estimativa**: 2h
**Where**: `backend/api/src/tarefas/push-sessao.ts`
**Depends on**: T143
**Requirement**: PUSH-02, PUSH-05

**Done when**:

- [x] Sessão às 14:00 gera um envio entre 13:45 e 13:50 e nenhum outro
- [x] Corpo sem nome de paciente nem texto clínico

- A função `tarefas.listar_sessoes_para_aviso(de, ate, limite)` vai na migration 0018 (`0018_funcoes_push_sessao.ts`), como a 0016 da T139 (decisão do usuário, 2026-10-27); por isso T148 passa a 0019. Policies só de SELECT para o owner, ligadas por `app.tarefa_push` dentro da função (desenho da 0012). A tarefa grava `notificacao_enviada` antes de enviar (no máximo uma vez), numa transação do profissional, e entrega os envios a `enviarEmLotes`. Corpo: "Sessão próxima" / "Sua sessão começa às HH:MM." (Brasília) / `/app/agenda`. PREMISSAS: TTL de 15 min; sem as chaves VAPID o push fica desligado (nada gravado nem enviado); a tela é a agenda (não há tela própria de sessão).

**Tests**: integration
**Gate**: full

---

### T145: Tarefa: evolução pendente às 20:00

**What**: Enviar a contagem de sessões realizadas sem evolução, uma vez por dia.
**Estimativa**: 2h
**Where**: `backend/api/src/tarefas/push-pendente.ts`
**Depends on**: T144
**Requirement**: PUSH-03, PUSH-05

**Done when**:

- [x] Sem pendências, nada é enviado
- [x] Uma vez por dia
- [x] Corpo só com a quantidade

- A função `tarefas.listar_pendencias_evolucao(dia, limite)` vai na migration 0019 (`0019_funcoes_push_pendente.ts`), no desenho da 0018 (policy só de SELECT do owner em `evolucao`, ligada por `app.tarefa_push` dentro da função). SPEC_DEVIATION da Retomada (que previa 0020 para T145 e T146, deixando 0019 à T148): `migrar.ts` usa `checkOrder: true`, então uma 0020 aplicada antes de uma 0019 quebraria a migração do banco local; segue o padrão da T144 e a T148 passa a 0020. Passos comuns (gravar a chave antes de enviar, montar os envios, entregar em lotes) em `tarefas/push-avisos.ts`, reaproveitados pela T146 e pela T178. Corpo: "Evoluções pendentes" / "Você tem N sessões de hoje sem evolução." (singular com 1) / `/app` (Início). Sessões do dia = `realizada` com início no dia de Brasília, sem evolução ligada. PREMISSAS: TTL de 3 h (vale até o fim do dia); até 10 profissionais por execução, o resto nas execuções seguintes da janela das 20:00 às 21:00.

**Tests**: integration
**Gate**: full

---

### T146: Push de cobrança

**What**: Cobrança gerada, pagamento confirmado e cobrança vencida.
**Estimativa**: 2h
**Where**: `backend/api/src/tarefas/push-cobranca.ts`
**Depends on**: T145
**Requirement**: PUSH-04, PUSH-05

**Done when**:

- [x] Uma vez por evento
- [x] Corpo sem dado clínico

- Tarefa do cron `push_cobranca`, terceira do despachante (design: "avisos de plano"). A origem são os eventos do webhook já processados em `webhook_evento` com o profissional achado; a função `tarefas.listar_eventos_cobranca_para_aviso(desde, ate, limite)` vai na migration 0020 (`0020_funcoes_push_cobranca.ts`, policy só de SELECT do owner em `webhook_evento` ligada por `app.tarefa_push`); por isso a T148 passa a 0021. `PAYMENT_CREATED` = cobrança gerada; `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED` = pagamento confirmado (um aviso só por pagamento); `PAYMENT_OVERDUE` = cobrança vencida. Chave = (tipo, id do pagamento). Corpo com texto fixo (sem valor, datas nem ids) e `/app/plano`. PREMISSAS: o push sai para todo evento desses tipos ligado ao profissional, mesmo quando o webhook não mudou o estado (o e-mail da PLANO-13 só sai na mudança); janela de 24 h (evento mais antigo não gera push) e TTL de 24 h; até 10 avisos por execução.

**Tests**: integration
**Gate**: full

---

### T178: Push de fim de trial

**What**: Aviso do trial a 3 dias do fim.
**Estimativa**: 1,5h
**Where**: `backend/api/src/tarefas/push-trial.ts`
**Depends on**: T146
**Requirement**: PUSH-04, PUSH-05

**Done when**:

- [x] Uma vez por evento
- [x] Corpo sem dado clínico

- Tarefa do cron `push_trial`, quarta do despachante (antes das transições de assinatura), sem janela de compensação (o estado diz o que falta). A função `tarefas.listar_trials_terminando(agora, limite)` vai na migration 0021 (`0021_funcoes_push_trial.ts`, policy só de SELECT do owner em `assinatura` ligada por `app.tarefa_push`); por isso a T148 passa a 0022. Janela do domínio: `periodo_fim` em (agora, agora + 3 dias]. A ref ('trial_terminando', `periodo_fim` ISO UTC com milissegundos, microssegundos truncados como no `Date` do JS) vem pronta da função, no formato de `chaveTrialTerminando`. Corpo: "Seu teste está acabando" / "Seu período de teste termina em N dias. Assine em Meu plano para continuar no Pro." (N arredondado para cima, de 3 a 1; singular com 1) / `/app/plano`. PREMISSAS: TTL de 24 h; o aviso sai mesmo se o push for ativado já perto do fim, com os dias que faltam.

**Tests**: integration
**Gate**: full

---

### T147: Service worker: push e clique

**What**: Handlers de `push` e `notificationclick`, abrindo sessão, Início ou Meu plano.
**Estimativa**: 2h
**Where**: `frontend/web/src/pwa/sw.ts`
**Depends on**: T178
**Requirement**: PUSH-01

**Done when**:

- [x] Clique abre a tela relacionada
- [x] Teste do roteamento do clique

- `sw.ts` sem imports, emitido como `/sw.js` (escopo `/`) por uma segunda entrada do build em `vite.config.ts` (SPEC_DEVIATION do design, que prevê o `vite-plugin-pwa` com injectManifest: o plugin entra com o manifest na T156 e passa a gerar o `sw.js` a partir deste arquivo). Destinos: sessão próxima `/app/agenda` (não há tela própria de sessão), evolução pendente `/app` (Início), cobrança e trial `/app/plano`; qualquer url fora de `/app` na mesma origem abre o Início. Com o app aberto, a janela navega e ganha foco; senão abre outra. Push sem dados ou com JSON inválido mostra "Evolução Segura" e abre o Início. O registro do service worker fica com a ativação do push (T179); precache e offline na T184.

**Tests**: unit
**Gate**: build

---

### T179: Preferência de push por dispositivo

**What**: Interruptor por dispositivo nas configurações.
**Estimativa**: 2h
**Where**: `frontend/web/src/app/configuracoes/push.tsx`
**Depends on**: T147
**Requirement**: PUSH-01, PUSH-08

**Done when**:

- [x] Interruptor ativa e desativa o push do dispositivo
- [x] Permissão negada tratada

- Cartão "Notificações" nas Configurações (`perfil/configuracoes.tsx`) com o componente `configuracoes/push.tsx`. Ativar: permissão, registro de `/sw.js` (T147), `pushManager.subscribe` com a chave VAPID e `POST /api/push/assinatura`; desativar: `DELETE` e depois `unsubscribe`. Estado inicial pela assinatura do navegador. SPEC_DEVIATION (escopo): o navegador precisa da chave pública VAPID e nada a expunha, então a tarefa acrescenta `GET /api/push/chave` (autenticada, `{chave_publica}` ou `null` quando o push está desligado; contrato `esquemaChavePush`). PREMISSAS: permissão negada bloqueia o interruptor com a explicação de liberar no navegador; pedido fechado sem resposta deixa tentar de novo; falha ao guardar cancela a assinatura nova; 409 `endpoint_em_uso` avisa e não mexe na assinatura (é da outra conta); navegador sem suporte (ex.: Safari do iPhone fora do app instalado) mostra a orientação de adicionar à Tela de Início e esconde o interruptor; textos escritos pelo implementador.

**Tests**: unit
**Gate**: build

---

### T122: Medição de CPU da exportação no Hyperdrive real

**What**: Medir no Hyperdrive real a CPU de uma página de tamanho fixo (ex.: 300 evoluções de 1.500 caracteres) e fixar o tamanho máximo de página. Pré-requisito do usuário: Neon e Hyperdrive de teste criados.
**Estimativa**: 1,5h
**Where**: `.specs/features/evolucao-segura/medicao-exportacao.md`
**Depends on**: T179
**Requirement**: EXP-03

**Done when**:

- [x] Medição registrada com ambiente, tamanho de página e CPU
- [x] Tamanho máximo de página fixado em 25 linhas, JSON montado no Postgres (decisão do usuário, 2026-10-27)

- 2026-10-27: medição em `medicao-exportacao.md`. Nenhum tamanho útil coube com folga (custo fixo de 5 ms de mediana e 10 ms de máximo com 1 linha). Achado à parte: as migrations 0012 a 0015 e 0018 a 0021 falham no Neon (PG 18) por `SET app.tarefa_*` na definição das funções (tratado nas T197 a T199).
- SPEC_DEVIATION (Done when): o critério mandava fixar com folga em 10 ms e, sem tamanho útil, abrir novo spike. O usuário aceitou o risco no plano Free e adiou o Workers Paid para quando o produto tiver mais clientes. Com 25 linhas: mediana 7,5 ms, máximo 13 ms, nenhuma execução cortada. A margem real do Free segue sem medir (PREMISSA). Se a exportação passar a ser cortada, abrir o spike de margem ou adotar o plano pago.

**Tests**: none
**Gate**: build

---

### T171: GET exportação completa paginada por tabela

**What**: Entregar os dados do profissional em páginas por tabela, com cursor (D-32), no tamanho máximo fixado na T122.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/exportar-tudo.ts`
**Depends on**: T122
**Requirement**: EXP-03, EXP-04

**Done when**:

- [x] Cada tabela é entregue em páginas com cursor, sem repetir nem perder linha
- [x] Página acima do máximo ou cursor inválido responde 400 sem auditar
- [x] Isolamento coberto

- Decisões de 2026-10-27: página de 25 linhas, JSON montado no Postgres (T122). Tabelas: a lista do legado (`export-full.domain.ts`) restrita às que existem aqui, mais `preco_sessao`, `preco_sessao_revisao` e `preco_paciente_revisao`, sem `relatorio` (D-01) e sem as novas (`assinatura`, `audit_log`, `push_subscription`, `notificacao_enviada`, `limite_uso`, `aceite_termos`). PREMISSA (a confirmar na T171): cursor opaco único com a tabela e a última chave, em `GET ?cursor=&limite=`; sem cursor é a primeira página (conta no limite da T172); `proximo_cursor: null` é a última (audita na T173).
- 2026-10-27, feito: `GET /api/exportacao?cursor=&limite=` (contrato em `@es/contrato/exportacao`: `TABELAS_EXPORTACAO`, `TAMANHO_MAXIMO_PAGINA`, `esquemaConsultaExportacao`, `PaginaExportacao`). Cursor confirmado como PREMISSA: base64url de `{"t": tabela, "d": última chave ou null}`; a página que esgota a tabela aponta para o começo da próxima. Linhas inteiras via `to_jsonb` montadas no Postgres. PREMISSAS: 400 `pagina_invalida` para limite fora de 1 a 25, fora do formato (inteiro sem zero à esquerda) ou parâmetro desconhecido; 400 `cursor_invalido` para cursor que não decodifica, tabela fora da lista ou chave fora do tipo (uuid; bigint nas revisões); o cursor não é assinado, então quem o forja só anda pelos próprios dados (RLS e filtro por `usuario_id`).

**Tests**: integration
**Gate**: full

---

### T172: Limite de 5 exportações em 60 s

**What**: Aplicar `contar_uso` só ao início da exportação completa e acrescentar `limite_uso` ao tipo `Banco` de `db.ts`.
**Estimativa**: 1,5h
**Where**: `backend/api/src/middleware/limite-exportacao.ts`
**Depends on**: T171
**Requirement**: EXP-05

**Done when**:

- [x] Mais de 5 exportações iniciadas em 60 s responde 429
- [x] A rota do prontuário não conta no limite

- 2026-10-27, feito: `limiteExportacao` depois da lista `autenticada` em `GET /api/exportacao`; pedido sem cursor chama `contar_uso('exportacao', 60)` e acima de 5 responde 429 `limite_exportacao` (contrato: `LIMITE_EXPORTACOES`, `JANELA_LIMITE_EXPORTACAO_SEGUNDOS`, `PROBLEMA_LIMITE_EXPORTACAO`); `limite_uso` no `Banco`. PREMISSAS: o pedido sem cursor conta antes da validação da página (início com limite inválido conta); a contagem fica gravada também na resposta 429; código e título do problema escritos pelo implementador. Teste da T171 mudado com aprovação do usuário (2026-10-27): `beforeEach` que zera `limite_uso` de A e B em `exportar-tudo.test.ts`, sem mudar asserção.

**Tests**: integration
**Gate**: full

---

### T173: Exportação sem credenciais e auditoria da conclusão

**What**: Garantir que o corpo da exportação não traz credenciais nem sessões e auditar a conclusão.
**Estimativa**: 1,5h
**Where**: `backend/api/src/rotas/exportar-tudo.ts`
**Depends on**: T172
**Requirement**: EXP-06

**Done when**:

- [x] Sem hash de senha nem sessão no corpo
- [x] Audita `exportacao.concluida` só ao servir a última página

- 2026-10-27, feito: servida a página com `proximo_cursor: null`, `GET /api/exportacao` audita `exportacao.concluida` com alvo `exportacao`, sem `alvo_id` nem campos, na transação da leitura; cada exportação concluída gera um evento (pedir de novo a última página audita de novo). O corpo só traz as tabelas de `TABELAS_EXPORTACAO`; o teste confere que hash da senha, sessão, 2FA e tokens de e-mail não aparecem.

**Tests**: integration
**Gate**: full

---

### T124: Junção das páginas e `dados.json` no navegador

**What**: Juntar no navegador as páginas da exportação completa e montar o `.zip` com `dados.json` (fflate).
**Estimativa**: 2h
**Where**: `frontend/web/src/export/zip-completo.ts`
**Depends on**: T173
**Requirement**: EXP-03

**Done when**:

- [x] Páginas juntas na ordem, sem perder linha
- [x] `dados.json` no zip com todas as tabelas
- [x] Chunk do fflate carregado só ao exportar

- 2026-10-27, feito: `juntarPaginas` anda pelos cursores até `proximo_cursor` nulo e devolve todas as tabelas de `TABELAS_EXPORTACAO` (vazias quando sem linha); `montarZipCompleto` monta o zip com `dados.json` mais arquivos extras, com `fflate` 0.8.3 (dependência nova do web) por import dinâmico. O chunk separado só aparece no build quando a T175 importar o módulo.

**Tests**: unit
**Gate**: build

---

### T174: PDF por paciente dentro do zip

**What**: Acrescentar ao `.zip` um PDF por paciente, reusando `baixarPdfProntuario` da T123.
**Estimativa**: 2h
**Where**: `frontend/web/src/export/zip-pdfs.ts`
**Depends on**: T124
**Requirement**: EXP-02

**Done when**:

- [x] Zip contém um PDF por paciente

- 2026-10-27, feito: `gerarPdfsPacientes` busca o prontuário completo de cada paciente (um por vez) e gera o PDF `prontuarios/prontuario-<8 do id>.pdf`. SPEC_DEVIATION: usa `gerarPdfProntuario` (o motor que `baixarPdfProntuario` chama), porque a segunda só dispara o download e não devolve os bytes.

**Tests**: unit
**Gate**: build

---

### T175: Tela de exportação completa

**What**: Tela de exportação com progresso e tratamento dos erros 413 e 429.
**Estimativa**: 2h
**Where**: `frontend/web/src/app/exportar/exportar.tsx`
**Depends on**: T174
**Requirement**: EXP-03

**Done when**:

- [x] Exportação inicia e baixa o zip
- [x] Erro 413 tratado na tela
- [x] Erro 429 tratado na tela

- 2026-10-27, feito: `ExportarPage` em `/app/exportar` (botão "Exportar meus dados", progresso por fase, baixa `evolucao-segura-exportacao.zip`); 429 (com Retry-After) e 413 mostram mensagem e devolvem o botão; link no cartão "Meus dados" das Configurações. O build mostra o fflate em chunk próprio (`browser-*.js`, 8,8 kB). PREMISSAS: textos escritos pelo implementador; não há mockup (`.specs/mockup/` não existe); a API não emite 413, a tela só trata o status; rota e link nas Configurações escolhidos pelo implementador.

**Tests**: unit
**Gate**: build

---

### T148: Migration 0022: exclusão de conta

**What**: Criar `conta_excluida` e as colunas de bloqueio, e aceitar os tipos `exclusao` e `desistencia` em `token_email`.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0022_exclusao.ts` (era 0018; a T144 criou a 0018, a T145 a 0019, a T146 a 0020 e a T178 a 0021)
**Depends on**: T175
**Requirement**: CONTA-03, CONTA-05

**Done when**:

- [x] `conta_excluida` sem dado pessoal
- [x] Bloqueio por `bloqueado_exclusao_em`

- 2026-10-28, feito: `conta_excluida` (id, `pedido_em`, `purgado_em`, sem FK, sem `usuario_id`), do `owner`, sem privilégio para a app, `backup_ro` só lê; índice parcial `usuario_bloqueado_exclusao_idx` para a purga. A coluna `bloqueado_exclusao_em` e os tipos `exclusao` e `desistencia` de `token_email` já existiam desde a 0003 (só testados de novo aqui). Sem função e sem `SET app.*` na migration (roda no Neon).

**Tests**: integration
**Gate**: full

---

### T149: Pedir a exclusão: validações

**What**: Exigir exportação completa servida nas últimas 24 h (a rota vem da T173, na Phase 19, que precede esta fase), declaração de guarda e senha.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/conta-excluir.ts`
**Depends on**: T148
**Requirement**: CONTA-01, CONTA-02

**Done when**:

- [x] Cada requisito que falta é indicado no 422

- 2026-10-28, feito: `POST /api/conta/excluir` (sessão e CSRF; a rota abre a própria transação para o e-mail da T180 sair depois do COMMIT). 422 `requisitos_exclusao` com `requisitos` (campo novo e opcional do `esquemaProblema`) na ordem `exportacao`, `declaracao_guarda`, `senha`; todos conferidos a cada pedido. Exportação = evento `exportacao.concluida` (T173) nas últimas 24 h pelo relógio do banco. PREMISSAS: campo ausente conta como requisito que falta (tipo errado ou chave extra = 422 `validacao`); senha conferida por `conferir_senha`, sem contar no bloqueio de login; contrato em `@es/contrato/conta`.

**Tests**: integration
**Gate**: full

---

### T180: Pedir a exclusão: token e e-mail de confirmação

**What**: Gerar o token de confirmação e enviar o link.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/conta-excluir-email.ts`
**Depends on**: T149
**Requirement**: CONTA-01

**Done when**:

- [ ] Token de 256 bits, SHA-256, 30 min, uso único
- [ ] Auditoria `conta.exclusao_pedida`

**Tests**: integration
**Gate**: full

---

### T150: Confirmar a exclusão: bloqueio

**What**: Bloquear a conta e encerrar as sessões.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/conta-excluir-confirmar.ts`
**Depends on**: T180
**Requirement**: CONTA-03

**Done when**:

- [ ] Login recusado depois de confirmar
- [ ] Sessões abertas encerradas

**Tests**: integration
**Gate**: full

---

### T181: Confirmar a exclusão: Asaas e e-mail

**What**: Cancelar a assinatura no Asaas e enviar o e-mail com a data da purga e o link de desistência.
**Estimativa**: 2h
**Where**: `backend/api/src/integracoes/emails-exclusao.ts`
**Depends on**: T150
**Requirement**: CONTA-03, CONTA-04

**Done when**:

- [ ] Asaas cancelado
- [ ] Link de desistência válido por 30 dias

**Tests**: integration
**Gate**: full

---

### T151: Desistir da exclusão

**What**: Desbloquear a conta antes da purga.
**Estimativa**: 2h
**Where**: `backend/api/src/rotas/conta-desistir.ts`
**Depends on**: T181
**Requirement**: CONTA-04

**Done when**:

- [ ] Volta a entrar com senha e 2FA
- [ ] Plano `free` ou trial restante
- [ ] Link depois da purga responde `link_invalido`

**Tests**: integration
**Gate**: full

---

### T152: Função de purga

**What**: Função `SECURITY DEFINER` que apaga todas as linhas do profissional após 30 dias e guarda só `conta_excluida`.
**Estimativa**: 2h
**Where**: `backend/api/src/tarefas/purga.ts`
**Depends on**: T151
**Requirement**: CONTA-05

**Done when**:

- [ ] Antes de 30 dias nada é apagado
- [ ] `conta_excluida` com id, data do pedido e data da purga

**Tests**: integration
**Gate**: full

---

### T182: Varredura da purga pelo catálogo

**What**: Teste que varre o catálogo e prova que nenhuma tabela guarda linha do profissional depois da purga, auditoria inclusive.
**Estimativa**: 2h
**Where**: `backend/api/test/tarefas/purga-varredura.test.ts`
**Depends on**: T152
**Requirement**: CONTA-05

**Done when**:

- [ ] Após 30 dias nenhuma tabela tem linha do profissional, auditoria inclusive (varredura pelo catálogo)
- [ ] Dados de outro profissional intactos

**Tests**: integration
**Gate**: full

---

### T183: Purga no cron e ADR-012

**What**: Registrar a purga no despachante do cron (posição reservada em `registro.ts`) e gravar o ADR-012.
**Estimativa**: 1,5h
**Where**: `backend/api/src/tarefas/registro.ts`
**Depends on**: T182
**Requirement**: CONTA-05

**Done when**:

- [ ] Purga chamada pelo cron
- [ ] Reexecução é inofensiva
- [ ] ADR-012 gravado

**Tests**: integration
**Gate**: full

---

### T153: Tela de exclusão de conta

**What**: Fluxo com exportação, declaração de guarda e senha.
**Estimativa**: 2h
**Where**: `frontend/web/src/app/conta/excluir.tsx`
**Depends on**: T183
**Requirement**: CONTA-01

**Done when**:

- [ ] Botão só com os três requisitos
- [ ] Mensagens do servidor exibidas

**Tests**: unit
**Gate**: quick

---

### T154: Termos e privacidade

**What**: Páginas `/termos` e `/privacidade` com versão e data, profissional como controlador e LJS como operadora.
**Estimativa**: 2h
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
**Estimativa**: 1,5h
**Where**: `frontend/web/src/publico/landing.tsx`
**Depends on**: T154
**Requirement**: PUB-01

**Done when**:

- [ ] Botão leva a `/cadastro`
- [ ] Preços e limites iguais à spec

**Tests**: unit
**Gate**: quick

---

### T156: Manifest e ícones

**What**: Manifest com ícones 192 e 512 maskable e `display: standalone`.
**Estimativa**: 2h
**Where**: `frontend/web/vite.config.ts`
**Depends on**: T155
**Requirement**: PUB-03

**Done when**:

- [ ] Teste confere o manifest gerado
- [ ] Chrome reconhece como instalável (checagem manual registrada)

**Tests**: unit
**Gate**: build

---

### T184: Precache do shell e página offline

**What**: Precache do shell e página offline.
**Estimativa**: 2h
**Where**: `frontend/web/src/pwa/offline.ts`
**Depends on**: T156
**Requirement**: PUB-03

**Done when**:

- [ ] Shell servido do precache
- [ ] Página offline servida sem rede

**Tests**: unit
**Gate**: build

---

### T157: Instrução de instalação no iOS

**What**: Orientar "Compartilhar" e "Adicionar à Tela de Início" no Safari fora do modo instalado.
**Estimativa**: 1,5h
**Where**: `frontend/web/src/pwa/instrucao-ios.tsx`
**Depends on**: T184
**Requirement**: PUB-04

**Done when**:

- [ ] Aparece só no Safari do iOS fora do modo instalado
- [ ] Dispensar lembra a escolha

**Tests**: unit
**Gate**: quick

---

### T158: Playwright: infraestrutura e2e

**What**: Playwright com o Worker local e o Postgres no ar, e e-mail capturado em teste.
**Estimativa**: 2h
**Where**: `e2e/playwright.config.ts`
**Depends on**: T157
**Requirement**: OPS-05

**Done when**:

- [ ] `pnpm e2e` sobe o Worker local e o Postgres
- [ ] E-mail capturado em teste

**Tests**: e2e
**Gate**: full

---

### T185: Playwright: cadastro e login

**What**: Fluxo cadastro, confirmação e login com 2FA.
**Estimativa**: 2h
**Where**: `e2e/acesso.spec.ts`
**Depends on**: T158
**Requirement**: CAD-04, AUTH-04

**Done when**:

- [ ] Conta nova chega ao app com o trial de 14 dias

**Tests**: e2e
**Gate**: full

---

### T159: Playwright: assinar e ver o Pix

**What**: Assinar o Pro no sandbox e ver Pix e QR.
**Estimativa**: 1,5h
**Where**: `e2e/plano.spec.ts`
**Depends on**: T185
**Requirement**: PLANO-05

**Done when**:

- [ ] Pix e QR exibidos

**Tests**: e2e
**Gate**: full

---

### T186: Playwright: webhook de pagamento

**What**: Simular o webhook de pagamento e ver `ativa`.
**Estimativa**: 1,5h
**Where**: `e2e/plano-webhook.spec.ts`
**Depends on**: T159
**Requirement**: PLANO-08

**Done when**:

- [ ] Depois do webhook, o plano aparece como ativo

**Tests**: e2e
**Gate**: full

---

### T160: Playwright: agenda e evolução

**What**: Criar a sessão e registrar a evolução.
**Estimativa**: 2h
**Where**: `e2e/fluxo-principal.spec.ts`
**Depends on**: T186
**Requirement**: AGE-01, EVO-03

**Done when**:

- [ ] Sessão criada, evolução registrada (sessão vira realizada)

**Tests**: e2e
**Gate**: full

---

### T187: Playwright: pagamento

**What**: Registrar o pagamento e ver o débito sumir.
**Estimativa**: 1,5h
**Where**: `e2e/fluxo-pagamento.spec.ts`
**Depends on**: T160
**Requirement**: FIN-03

**Done when**:

- [ ] Pagamento registrado e débito some

**Tests**: e2e
**Gate**: full

---

### T161: Comparação visual: acesso e telas públicas

**What**: Comparar com o legado as telas de acesso e as públicas e registrar as diferenças. Conferência feita com o usuário.
**Estimativa**: 2h
**Where**: `.specs/features/evolucao-segura/comparacao-visual.md`
**Depends on**: T187
**Requirement**: PUB-02

**Done when**:

- [ ] Tabela tela × diferença × decisão registrada para o grupo
- [ ] Sem diferença não justificada; as justificadas listadas

**Tests**: none
**Gate**: build

---

### T188: Comparação visual: agenda e pacientes

**What**: Comparar com o legado as telas de agenda e de pacientes e registrar as diferenças. Conferência feita com o usuário.
**Estimativa**: 2h
**Where**: `.specs/features/evolucao-segura/comparacao-visual.md`
**Depends on**: T161
**Requirement**: PUB-02

**Done when**:

- [ ] Tabela tela × diferença × decisão registrada para o grupo
- [ ] Sem diferença não justificada; as justificadas listadas

**Tests**: none
**Gate**: build

---

### T189: Comparação visual: anamnese, evoluções e rascunhos

**What**: Comparar com o legado as telas de anamnese, evolução e rascunhos e registrar as diferenças. Conferência feita com o usuário.
**Estimativa**: 2h
**Where**: `.specs/features/evolucao-segura/comparacao-visual.md`
**Depends on**: T188
**Requirement**: PUB-02

**Done when**:

- [ ] Tabela tela × diferença × decisão registrada para o grupo
- [ ] Sem diferença não justificada; as justificadas listadas

**Tests**: none
**Gate**: build

---

### T190: Comparação visual: financeiro, plano, auditoria e conta

**What**: Comparar com o legado as telas de financeiro, plano, auditoria e conta e registrar as diferenças. Conferência feita com o usuário.
**Estimativa**: 2h
**Where**: `.specs/features/evolucao-segura/comparacao-visual.md`
**Depends on**: T189
**Requirement**: PUB-02

**Done when**:

- [ ] Tabela tela × diferença × decisão registrada para o grupo
- [ ] Sem diferença não justificada; as justificadas listadas

**Tests**: none
**Gate**: build

---

### T162: Script de restauração

**What**: Adaptar `restore-test.sh` para restaurar o dump cifrado num Postgres limpo.
**Estimativa**: 2h
**Where**: `infra/restore-test.sh`
**Depends on**: T190
**Requirement**: OPS-02

**Done when**:

- [ ] Restaura a partir de cópia limpa

**Tests**: none
**Gate**: build

---

### T191: Comparação de contagens na restauração

**What**: Comparar a contagem de linhas por tabela entre a origem e a restauração.
**Estimativa**: 1,5h
**Where**: `infra/comparar-contagens.sh`
**Depends on**: T162
**Requirement**: OPS-02

**Done when**:

- [ ] Contagem por tabela bate com a origem
- [ ] Falha em qualquer divergência

**Tests**: none
**Gate**: build

---

### T163: README

**What**: Escrever o README: rodar local, variáveis, deploy e testar o webhook local.
**Estimativa**: 2h
**Where**: `README.md`
**Depends on**: T191
**Requirement**: OPS-12

**Done when**:

- [ ] Cada comando citado foi executado

**Tests**: none
**Gate**: build

---

### T192: Validação do README por agente sem contexto

**What**: Um agente sem contexto roda o projeto seguindo só o README.
**Estimativa**: 1,5h
**Where**: `.specs/features/evolucao-segura/validacao-readme.md`
**Depends on**: T163
**Requirement**: OPS-12

**Done when**:

- [ ] Um agente sem contexto roda o projeto seguindo só o README
- [ ] Tropeços registrados e corrigidos no README

**Tests**: none
**Gate**: build

---

### T164: Runbook: webhook, reprocessar e reativar

**What**: Procedimentos para webhook que falhou, reprocessar pagamento e reativar usuário.
**Estimativa**: 2h
**Where**: `docs/runbook.md`
**Depends on**: T192
**Requirement**: OPS-12

**Done when**:

- [ ] Cada procedimento tem comandos verificados

**Tests**: none
**Gate**: build

---

### T193: Runbook: segredos e restauração do backup

**What**: Procedimentos para rotacionar segredos e restaurar o backup.
**Estimativa**: 2h
**Where**: `docs/runbook.md`
**Depends on**: T164
**Requirement**: OPS-12

**Done when**:

- [ ] Cada procedimento tem comandos verificados

**Tests**: none
**Gate**: build

---

### T194: Runbook: pré-requisitos de publicação e plano B

**What**: Pré-requisitos da publicação, plano B do Resend e chave Pix do Asaas.
**Estimativa**: 1,5h
**Where**: `docs/runbook.md`
**Depends on**: T193
**Requirement**: OPS-12

**Done when**:

- [ ] Pré-requisitos da publicação listados (conta Asaas de produção, chave Pix, domínio, revisão jurídica)
- [ ] Plano B do Resend e chave Pix do Asaas descritos

**Tests**: none
**Gate**: build

---

### T197: Migrations 0012 a 0015 aplicáveis por quem não é superusuário

**What**: Tirar o `SET app.tarefa_* = ...` da definição das funções das migrations 0012, 0013, 0014 e 0015, que no Neon (PostgreSQL 18, `neondb_owner` sem superusuário) falha com `permission denied to set parameter`, mantendo o mesmo comportamento (por exemplo, `set_config(..., true)` dentro da função). Mexe em migrations já existentes: a mudança e os testes delas precisam da aprovação do usuário (concedida em 2026-10-27, ao escolher esta tarefa).
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0012_*.ts`, `0013_*.ts`, `0014_*.ts`, `0015_*.ts`
**Depends on**: T194
**Requirement**: OPS-03

**Done when**:

- [ ] Nenhuma dessas quatro migrations declara `SET <parâmetro personalizado>` na definição de função
- [ ] Os testes de funções `tarefas.*` e de assinatura seguem verdes sem enfraquecer asserção
- [ ] Achado registrado em `medicao-exportacao.md` marcado como tratado

**Tests**: integration
**Gate**: full

---

### T198: Migrations 0018 a 0021 aplicáveis por quem não é superusuário

**What**: Mesma correção da T197 nas migrations 0018, 0019, 0020 e 0021.
**Estimativa**: 2h
**Where**: `backend/scripts/migrations/0018_*.ts`, `0019_*.ts`, `0020_*.ts`, `0021_*.ts`
**Depends on**: T197
**Requirement**: OPS-03

**Done when**:

- [ ] Nenhuma dessas quatro migrations declara `SET <parâmetro personalizado>` na definição de função
- [ ] Os testes de `tarefas.*`, push e aviso de sessão seguem verdes sem enfraquecer asserção

**Tests**: integration
**Gate**: full

---

### T199: Teste de que toda migration aplica sem superusuário

**What**: Teste que aplica todas as migrations com uma role que não é superusuário (como o `neondb_owner`) e falha se alguma exigir superusuário, para o problema não voltar.
**Estimativa**: 2h
**Where**: `backend/scripts/test/migrations-sem-superusuario.test.ts`
**Depends on**: T198
**Requirement**: OPS-03

**Done when**:

- [ ] Migrations 0001 em diante aplicam por uma role sem superusuário
- [ ] O teste falha quando uma migration usa `SET` de parâmetro personalizado na definição de função (provado numa cópia, sem alterar teste existente)

**Tests**: integration
**Gate**: full

---

### T195: Runbook: roles do Neon e fumaça do Hyperdrive

**What**: Provisionamento de login e senha das roles `owner`, `app` e `backup_ro` no Neon e teste de fumaça de vazamento de contexto. Ação do usuário no Neon.
**Estimativa**: 2h
**Where**: `docs/runbook.md`
**Depends on**: T199
**Requirement**: OPS-12

**Done when**:

- [ ] Provisionamento de login e senha das roles `owner`, `app` e `backup_ro` no Neon (nascem `NOLOGIN`), com a ordem em relação ao primeiro deploy (pendência do lote 3, ADR-005)
- [ ] Teste de fumaça de vazamento de contexto entre conexões reaproveitadas do Hyperdrive, depois do primeiro deploy (ADR-005)

**Tests**: none
**Gate**: build

---

### T165: Restauração executada e registrada

**What**: Executar o backup, restaurar numa cópia limpa e registrar data, tamanho do dump e contagens no runbook.
**Estimativa**: 1,5h
**Where**: `docs/runbook.md`
**Depends on**: T195
**Requirement**: OPS-02, OPS-01

**Done when**:

- [ ] Registro com data, tamanho e contagem por tabela
- [ ] Tamanho do dump comparado com o limite de artefatos do Actions

**Tests**: none
**Gate**: build

---

## Phase Execution Map

```
Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7 -> Phase 8 -> Phase 9 -> Phase 10 -> Phase 11 -> Phase 12 -> Phase 13 -> Phase 14 -> Phase 15 -> Phase 16 -> Phase 17 -> Phase 18 -> Phase 19 -> Phase 20 -> Phase 21 -> Phase 22 -> Phase 23
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
T168 -> T118
T123 -> T125
T132 -> T133
T196 -> T140
T179 -> T122
T175 -> T148
T153 -> T154
T157 -> T158
T187 -> T161
```

Execução estritamente sequencial; uma tarefa por vez, em ordem, com um commit atômico cada.

