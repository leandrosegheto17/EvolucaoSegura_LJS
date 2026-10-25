# Análise do legado: Evolução Segura

Data: 2026-10-24
Origem: `C:\Leandro\Projetos\EvolucaoSeguraWeb` (somente leitura). Citações relativas a essa raiz.
Objetivo: recriar o app neste repositório no padrão LJS Software, mantendo as regras de negócio e **100% do layout das telas**. Pesquisa de mercado dispensada pelo usuário.

## 1. O que é

Prontuário e agenda para profissional de saúde autônomo (psicólogo, com suporte a nutrição, fisioterapia e outras especialidades). Inclui agenda semanal, pacientes, anamnese configurável, evoluções, relatórios com IA opcional, PDF e controle de pagamentos recebidos. Hoje o acesso é restrito por whitelist (2 usuários), e o paciente não acessa o sistema (`.md/VISAO-PRODUTO.md:11`, `.md/PRD.md:2`).

**Natureza dos dados:** dado de saúde é **dado pessoal sensível** (LGPD art. 11). Com o cadastro aberto, o produto passa a ser multi-inquilino com dado sensível de terceiros (os pacientes).

## 2. Stack atual × padrão LJS

| Item LJS | Legado |
|---|---|
| pnpm 11, Node 24, TS estrito, ESM | Igual |
| `backend/contrato` (Zod) | Diferente: `shared/src/*.ts` |
| `backend/dominio` (puro) | Diferente: `backend/src/*/domain/` |
| Hono no Worker | **Não existe**: NestJS 12 + Fastify 5 numa VM (Compose + Caddy). Migração para Hono só planejada (`.specs/refatoracoes/padronizar-stack-infra-deploy/`), sem código |
| Worker servindo o front | Diferente: `wrangler.jsonc` só publica `frontend/dist` |
| Neon + Hyperdrive | Neon sim; Hyperdrive não |
| Kysely + pg, node-pg-migrate | Igual (migrations 0001–0035, faltam 0006 e 0007) |
| Roles owner/app/backup_ro, RLS FORCE, `SET LOCAL` | Igual (`0001_roles.sql`, `0002_helpers.sql:47`, `0016_backup_ro_rls.sql`) |
| Sessão opaca, `__Host-sid`, 15 min/12 h | Igual (`backend/src/identity/api/session.cookie.ts:1`, `session.service.ts:3-4`) |
| bcrypt via pgcrypto | **Diferente**: argon2id no Node |
| Cadastro aberto com confirmação | **Diferente**: whitelist + primeiro acesso + 2FA por e-mail + Google OIDC |
| Bloqueio 5 falhas / 15 min | Igual |
| Resend via fetch | Igual (`backend/src/mail/http-send.ts:12`) |
| Asaas, planos, trial | **Não existe** |
| Web Push + Cron | **Não existe** |
| Rate limit binding | Diferente: `@nestjs/throttler` em memória |
| Sentry | **Não existe** (pino) |
| Backup no Actions | Diferente: `infra/backup/backup.sh` (pg_dump + age + R2) fora do Actions |
| CI / deploy manual | `ci.yml` existe; `deploy.yml` por `workflow_run` em runner self-hosted |
| React 19 + Vite + PWA + TanStack Query + React Router 7 | Igual |

ADRs que conflitam com o LJS: 001 (NestJS), 004, 015, 020, 021 (hospedagem e deploy), 005 e 016 (argon2, Google, 2FA, whitelist), 009 (pdfmake no backend, sem prova no Worker), 011 (nomes de pastas). Compatíveis: 002, 003, 006, 007, 010, 012, 013, 014, 017, 018, 019. Sem equivalente no LJS: 008 (IA via OpenAI).

Testes: 127 specs no backend e 70 no front. O último registro completo (`.md/QA-REPORT.md`) tem 6 falhas no backend. A suíte atual não está confirmada como verde: existe uma dispensa temporária da trava (commit `7bd4566`).

## 3. Entidades (schema real)

`usuario`, `whitelist_entry`, `credencial_senha`, `identidade_google`, `sessao`, `desafio_2fa`, `token_email`, `tentativa_login` (0003); `perfil` com `atende_sabado`/`atende_domingo` (0005, 0026); `perfil_especialidade` (0027); `modelo_anamnese` e `modelo_anamnese_item` (0028); `paciente` com `ia_ciencia_em` e `paciente_de_teste` (0005, 0025); `consentimento_tcle` append-only; `serie_recorrencia` (0008); `sessao_atendimento` com `status`, `cobravel` e `row_version` (0008); `anamnese` com `valores jsonb` e `modelo_revisao` (0009, 0029); `anamnese_retificacao`; `evolucao` e `evolucao_retificacao` (0010); `rascunho`, `modelo_texto` (0011); `relatorio` (0012, guardas 0015/0021/0024); `preco_paciente`, `preco_sessao` com revisões (0013, 0017); `pagamento` com UNIQUE por sessão (0013, 0022); `configuracao_usuario` (0014); `audit_log` append-only (0004). Toda tabela de dado tem `usuario_id` com RLS. **Nenhuma tabela permite DELETE.**

## 4. Regras de negócio (RN do legado)

- **RN-01 Sessão:** absoluta 12 h; inatividade 15 min, ajustável em 5/10/15/30 (`settings.domain.ts:2`).
- **RN-02/03 Login:** argon2id + 2FA por e-mail (6 dígitos, 10 min, 5 tentativas, reenvio a cada 60 s). Google entra sem 2FA (`google-login.service.ts:119`).
- **RN-04 Bloqueio:** 5 falhas em 15 min, por e-mail e por IP.
- **RN-05 Senha:** 12 a 128 caracteres, lista de senhas comuns, sem repetição (`password-policy.ts`).
- **RN-06 Whitelist:** só e-mails da lista; quem sai dela tem as sessões encerradas.
- **RN-07 Débito derivado:** pendente = realizada sem pagamento, ou faltou/cancelada com `cobravel` e sem pagamento (`billing/domain/debts.ts:18-23`).
- **RN-08 Pagamento:** um por sessão (409, ou `confirmar_duplicidade`); meio em {dinheiro, pix, cartao, transferencia, outro}; valor padrão = preço do paciente; correção gera revisão; sem estorno.
- **RN-09 Preço:** ≥ 0, 2 casas, máx. 99.999.999,99; por paciente, com ajuste por sessão; `row_version`.
- **RN-10 Status da sessão:** agendada→realizada/faltou/cancelada/remarcada; realizada→agendada/faltou; faltou→agendada/realizada; cancelada/remarcada→agendada.
- **RN-11 Conflito:** intervalo [início, fim); ocupam agendada, realizada e faltou; 409 liberável com `confirmar_conflito`.
- **RN-12 Recorrência:** semanal ou quinzenal, 2 a 52 ocorrências; alterar ou cancelar "a partir de" uma data.
- **RN-13 Datas:** ISO com offset, anos 2000–2100, janela de listagem de até 62 dias.
- **RN-14 Fim de semana:** sábado e domingo desligados por padrão; 422 WEEKDAY_UNAVAILABLE.
- **RN-15 Janela de edição:** editável no dia do cadastro (America/Sao_Paulo); depois, só retificação com motivo.
- **RN-16 Evolução:** até 100.000 caracteres; retificação com motivo; sem exclusão.
- **RN-17/18 Anamnese:** uma por paciente+especialidade; modelo configurável (30 campos, 12 alertas, rótulo de 1 a 60 caracteres); após o bloqueio, só incluir ou reordenar.
- **RN-19 Relatório:** rascunho → entregue (imutável); cópia cria outra linha.
- **RN-20 IA:** desligada por padrão; exige chave, ciência do paciente e pseudonimização; 10 gerações por hora.
- **RN-21 Paciente:** só nome obrigatório; inativar/reativar; TCLE append-only.
- **RN-22 Rascunho:** até 512 KB, If-Match.
- **RN-23 Exportação:** 5 por minuto, 3 PDFs simultâneos, completa até 25 MB.
- **RN-24 Auditoria:** append-only, sem conteúdo clínico.
- **RN-25 Início:** resumo só dos dias habilitados, até 6 sessões em "hoje".

Endpoints: 59 caminhos em `/v1` (`.md/API-CONTRACT.yaml`). No LJS passam a `/api/*`.

## 5. Telas e layout

Front atual: 266 arquivos e ~18 mil linhas em `frontend/src` (~10 mil de produção). Usa Tailwind v4 + tokens CSS (`src/ui/tokens/`), Radix só em dialogs, ícones SVG próprios e fontes self-hosted.

- **Públicas:** `/entrar`, `/entrar/google`, `/recuperar`, `/primeiro-acesso`, `/sessao-expirada`, `/acesso-negado`.
- **Autenticadas (Shell):** `/`, `/agenda`, `/sessoes/nova`, `/sessoes/:id`, `/sessoes/:id/pagamento`, `/pacientes`, `/pacientes/novo`, `/pacientes/:id`, `/pacientes/:id/editar`, `/pacientes/:id/situacao`, `/pacientes/:id/valor`, `/financeiro`, `/exportar`, `/auditoria`, `/perfil`, `/configuracoes`.
- **Foco:** `/pacientes/:id/anamnese`, `/pacientes/:id/evolucoes`, `/pacientes/:id/documentos`.

Copia quase direto: `ui/`, `ui/tokens/`, `features/*`, `app/shell/*`, `theme.ts`, `public/fonts`, `public/icons`, `lib/api/*`. Precisa adaptar: rotas (de `/` para `/app`), prefixo da API e as telas de autenticação, se o modelo de acesso mudar.

Fonte de verdade visual: o mockup `telas/*.html` está desatualizado no shell; a implementação segue o adendo de 2026-09-25 (`.md/UX-SPEC.md:205`).

PWA atual: manifest, SW `injectManifest`, precache do shell e `offline.html`. Não tem push nem instrução para iOS, e o `theme_color` (#1f5f4a) diverge do token `--pri` (#2f5f6b).

**Telas novas do padrão LJS, sem layout no legado:** landing `/`, cadastro, confirmação de e-mail, "Meu plano" (Pix), `/termos`, `/privacidade`, exclusão de conta, instrução de instalação no iOS.

## 6. Reaproveitável quase literalmente

- Zod: `shared/src/*.ts`.
- Domínio puro com specs: `billing/domain/{debts,payment,price}.ts`, `scheduling/domain/{conflict,series,session,weekday-availability}.ts`, `home/domain/summary.ts`, `clinical/domain/edit-window.ts`, `clinical/anamnesis/anamnesis-values.domain.ts`, `identity/domain/password-policy.ts`, `ai/domain/pseudonymize.ts`.
- Migrations 0001–0035 (como base do schema, possivelmente consolidadas).
- Testes de garantia do banco (`backend/test/db-guarantees/`) e de contrato HTTP (`backend/test/contrato-http/`).
- `infra/backup/restore-test.sh`, `env.schema.ts`, `.env.example`.

## 7. Riscos

- Asaas, push, Cron, Sentry, rate limit, cadastro aberto e Hyperdrive são **funcionalidades novas**, não portes.
- Limite de 10 ms de CPU do Worker: hash de senha no Node (argon2) estoura, por isso o LJS manda bcrypt para o Postgres. PDF no Worker (pdfmake) não foi provado.
- Estado em memória do legado (OIDC, limites de exportação, cooldown) não sobrevive entre instâncias do Worker; precisa ir para tabela ou binding.
- Dado de saúde em SaaS aberto: LGPD (dado sensível, operador × controlador, termos, exclusão) e o conflito com a "retenção indefinida" do PRD.
- Recriar do zero perde o histórico das migrations e os hashes argon2 existentes.
- A suíte do legado não está verde; os testes reaproveitados precisam rodar verdes aqui.

## 8. Perguntas e decisões

Registradas em `necessidade.md` (seção Decisões), à medida que forem respondidas.
