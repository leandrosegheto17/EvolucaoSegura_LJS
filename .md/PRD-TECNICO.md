# PRD técnico: Evolução Segura

> Derivado de [spec.md](../.specs/features/evolucao-segura/spec.md), [design.md](../.specs/features/evolucao-segura/design.md) e do [padrão LJS](../.specs/produto/padrao-ljs.md). Descreve os requisitos não funcionais e as restrições técnicas. Decisões de arquitetura ficam em [adr/](adr/). Onde o padrão LJS e a spec divergem, vale a spec (decisões D-01 a D-31).

## 1. Restrições de plataforma

| Item        | Requisito                                                                                | Fonte                      |
| ----------- | ---------------------------------------------------------------------------------------- | -------------------------- |
| Custo       | Custo fixo mensal de R$ 0; nenhuma dependência paga                                      | Spec, Goals; padrão LJS §5 |
| Runtime     | Um Cloudflare Worker serve o front (assets) e a API Hono em `/api/*`                     | Design, Architecture       |
| CPU         | 10 ms por requisição; sem hash de senha nem PDF no Worker                                | OPS-14                     |
| Banco       | Neon Postgres 16 (`sa-east-1`) por Hyperdrive; Kysely e `pg`, um `Client` por requisição | Design, Tech Decisions     |
| Repositório | Monorepo pnpm, Node 24, TypeScript estrito, `type: module`                               | Padrão LJS §1              |
| Cron        | Um único Cron Trigger `*/5 * * * *` com despachante                                      | PUSH-07; design            |
| Domínio     | `evolucaosegura.com.br`; nenhuma URL absoluta no código ou no banco, só `URL_PUBLICA`    | OPS-10, D-25               |

## 2. Segurança e isolamento

- **Isolamento**: `usuario_id` e RLS com `FORCE ROW LEVEL SECURITY` em toda tabela de negócio; transação por requisição com `SET LOCAL app.usuario_id`; recurso de outro profissional responde 404 idêntico ao de inexistente (ISO-01, ISO-02).
- **Roles**: `owner` (DDL, só nas migrations), `app` (runtime, sem DELETE nem TRUNCATE nas tabelas de dado clínico, financeiro e de auditoria), `backup_ro` (só leitura) (ISO-03, ISO-04).
- **Autenticação própria**: sessão opaca de 256 bits (CSPRNG) guardada como SHA-256; cookie `__Host-sid` com Path=/, Secure, HttpOnly, SameSite=Lax e sem Domain; inatividade de 15 min e limite absoluto de 12 h; id novo a cada login (AUTH-04, AUTH-09, AUTH-10).
- **2FA por e-mail**: código de 6 dígitos (CSPRNG), guardado só como HMAC-SHA256, válido por 10 min, uso único, 5 erros invalidam o desafio (AUTH-03, AUTH-05).
- **Senha**: hash e conferência no Postgres com `crypt()` e `gen_salt('bf', 12)`, senha sempre como parâmetro; política de 12 a 128 caracteres com lista de senhas comuns (AUTH-11, AUTH-12).
- **Anti-enumeração**: mesma resposta e tempo equivalente para e-mail existente ou não, no cadastro, no login e na recuperação (CAD-02, AUTH-02, AUTH-13).
- **Bloqueio**: 5 falhas em 15 min por e-mail e por IP, estado em tabela (AUTH-07).
- **CSRF**: cabeçalho `x-csrf-token` em toda escrita autenticada (AUTH-17).
- **Rate limit**: 10 por minuto por IP em entrar, 2FA, cadastro e recuperação; 60 por minuto nas demais públicas; limite próprio do webhook. Mecanismo definido pelo spike S2 (OPS-07).
- **Cabeçalhos**: CSP sem origens externas além das necessárias, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`; `Cache-Control: no-store` em `/api/*` (OPS-09, PUB-05).
- **Segredos**: GitHub Secrets (environment `producao`) e `wrangler secret`; nada versionado; gitleaks no CI; `.env.example` com obrigatoriedade, formato e se é segredo (OPS-11).
- **Auditoria**: só inclusão, na mesma transação, sem conteúdo clínico, IP truncado (/24 IPv4, /48 IPv6) (AUD-01, AUD-02).

## 3. Dados

- Dinheiro em centavos inteiros (`bigint`); datas de calendário em `America/Sao_Paulo`; "hoje" e a janela de edição pelo relógio do banco (FIN-01, ANA-05, INI-02).
- Edição concorrente por `row_version`; divergência responde 409 (AGE-11, EVO-04).
- Prontuário e agenda nunca são apagados pela aplicação: pacientes inativam, sessões mudam de status, evoluções só se retificam (PAC-07, AGE-17, EVO-07).
- Base de migrations consolidada nova, uma migration por área, aplicada do zero no CI com `node-pg-migrate` (design, Data Models).
- Hyperdrive com cache desligado para dado que muda por ação do usuário (OPS-13).

## 4. Integrações

| Sistema  | Uso                                                                        | Requisito                                                                                                        |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Resend   | E-mail de texto puro por `fetch`, remetente `@evolucaosegura.com.br`       | 100 e-mails por dia no plano gratuito; o limite vira 503 `mail_unavailable` no 2FA e alerta no Sentry (D-27)     |
| Asaas    | Cliente, assinatura mensal por Pix e webhook em `POST /api/webhooks/asaas` | Token no webhook, idempotência por `event_id`; sandbox até existir conta de produção (PLANO-05 a PLANO-12, D-26) |
| Web Push | VAPID ES256 com `crypto.subtle`, payload cifrado, sem dado clínico         | PUSH-05, PUSH-07                                                                                                 |
| Sentry   | `@sentry/cloudflare` e `@sentry/react`; release igual ao SHA               | Sem corpo, cookie ou e-mail (OPS-08)                                                                             |

## 5. Operação

- **CI** (`ci.yml`): lint, typecheck, testes, gitleaks, build do web, migrations do zero num Postgres de serviço e teste de isolamento (OPS-05).
- **Deploy** (`deploy.yml`): manual, só pela `main`, environment `producao`, concurrency sem cancelamento; ordem fixa: build do web, branch de restauração no Neon (mantendo as 2 mais recentes), dump cifrado, migração com `owner`, `wrangler deploy --var URL_PUBLICA`. Único lugar com `wrangler deploy` (OPS-03, OPS-04).
- **Backup** (`backup.yml`): diário às 04:00 de Brasília (`0 7 * * *` em UTC), `pg_dump -Fc` pela role `backup_ro`, cifrado com `age`, artefato por 30 dias, também manual (OPS-01).
- **Restauração**: documentada no runbook e executada a partir de cópia limpa antes da publicação, conferindo contagem de linhas por tabela (OPS-02).
- **Disponibilidade**: `GET /api/health` responde 200 sem tocar no banco (OPS-06).
- **README e runbook**: rodar local, variáveis, deploy, testar o webhook local; webhook falhou, reprocessar pagamento, reativar usuário, rotacionar segredos, restaurar backup (OPS-12).

## 6. Testes

Toda mudança de comportamento tem teste automatizado derivado do critério da spec. Camadas: contrato (Zod) e domínio em Vitest; Worker com `@cloudflare/vitest-plugin` (AD-001, ADR-003); front com Testing Library; isolamento por varredura do catálogo do banco; e2e com Playwright (cadastro, login com 2FA, assinar no sandbox, agenda para evolução para pagamento). Matriz completa e comandos em [tasks.md](../.specs/features/evolucao-segura/tasks.md).

## 7. Riscos técnicos conhecidos

Lista mantida no design, seção Risks & Concerns: rate limit no plano Free (spike S2), `SET LOCAL` com o pooler do Hyperdrive (spike S1), Kysely sobre `pg.Client` (spike S1), CPU de 10 ms, limite de 100 e-mails por dia do Resend, artefatos do Actions (500 MB), bundle e acentos do pdfmake, funções `SECURITY DEFINER`.

## 8. Pendências

- `[A ESCLARECER]` subdomínio do app (ver [PRD](PRD.md), seção 8).
- PREMISSA: a categoria PWA do Lighthouse foi removida na versão 12; o critério vira "Chrome reconhece o app como instalável, com manifest e service worker válidos" (spec, Assumptions). Verificar a versão na preparação.
