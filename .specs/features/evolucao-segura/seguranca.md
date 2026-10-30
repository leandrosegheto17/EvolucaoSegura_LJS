# Segurança: Evolução Segura (feature `evolucao-segura`)

**Commit auditado:** `718124e` (branch `main`) · **Data:** 2026-10-30 · **Auditor:** agente `auditor-seguranca`
**Escopo:** a feature inteira (Worker Hono + assets, Hyperdrive/Neon com RLS, Asaas, Resend, push VAPID, 2FA, backup com age, workflows do GitHub). Repositório **público**.
**Teste ativo:** só local (Hono em Node, um `wrangler dev` próprio na porta 8799 já encerrado, e a suíte de isolamento num banco temporário do Postgres do docker-compose, apagado no fim). Nada foi enviado à produção, ao Neon real, ao Asaas, ao Resend nem ao GitHub.
**Saídas brutas:** `.specs/features/evolucao-segura/evidencias/` (ignorada pelo git; PoCs em `evidencias/poc/`).

## Resumo

| Severidade | Qtde | Achados |
|---|---|---|
| Crítico | 0 | — |
| Alto | 1 | SEC-001 |
| Médio | 6 | SEC-002 a SEC-007 |
| Baixo | 11 | SEC-008 a SEC-018 |

**Bloqueia o lançamento?** Sim, enquanto SEC-001 (alto) não for corrigido ou aceito por escrito pelo dono do produto. A severidade é proposta pelo auditor; a aprovação é do usuário.

Nenhum indício de invasão em curso nem de dado já vazado. Nenhum segredo real no código nem no histórico (285 commits).

## Ferramentas rodadas

| Ferramenta | Resultado | Saída |
|---|---|---|
| `varredura-seguranca.py ferramentas` | executado | `evidencias/resumo-ferramentas.md` |
| `pnpm audit --prod` / `pnpm audit` (todas) | 0 crítico; 4 altos + 4 moderados (undici, via wrangler/miniflare); 1 alto (zod no `@cloudflare/vitest-plugin`); 1 baixo (deepmerge) | `evidencias/dependencias-node.json`, `evidencias/pnpm-audit-todas.json` |
| Gitleaks (histórico inteiro, com `.gitleaks.toml`) | 0 segredos | `evidencias/gitleaks.json` |
| Busca embutida de segredos no histórico | 82 ocorrências, todas falsos positivos (URLs `postgres:postgres@localhost`, senhas de teste, segredos de teste do vitest) | `evidencias/segredos-historico.json` |
| Busca manual no histórico (`npg_`, `re_`, `$aact_`, `AGE-SECRET-KEY`, host `ep-*.neon.tech`, DSN do Sentry, `ghp_`) | nada real (só `re_test_`, `re_existente_e`, host `ep-exemplo`) | — |
| Suíte de isolamento (RLS) a partir da raiz | 19/19 verdes; banco temporário apagado | `evidencias/isolamento-raiz.log` |
| osv-scanner, semgrep | não instalados (não executados) | — |

## Superfície de ataque

- **Públicas (sem sessão):** `POST /api/cadastro`, `/api/cadastro/confirmar`, `/api/auth/entrar`, `/api/auth/2fa/verificar`, `/api/auth/2fa/reenviar`, `/api/auth/recuperar`, `/api/auth/recuperar/confirmar`, `/api/conta/excluir/confirmar`, `/api/conta/desistir`, `/api/webhooks/asaas` (token `asaas-access-token`), `GET /api/health`. Conferido que só essas rotas não montam `autenticada` (sessão + CSRF + transação).
- **Autenticadas:** demais `/api/*` (pacientes, agenda, anamnese, evoluções, rascunhos, financeiro, exportação, plano, push, auditoria, exclusão de conta).
- **Assets:** SPA servida pela camada de assets (`run_worker_first` só em `/api/*`), service worker `/sw.js`.
- **Cron** `*/5` com funções `tarefas.*` `SECURITY DEFINER`.
- **CI/CD:** `ci.yml`, `e2e.yml` (push/PR), `deploy.yml` e `backup.yml` (environment `producao`, segredos do Neon, Cloudflare e chave pública age).
- **Dados sensíveis:** dados de saúde (anamnese, evoluções), dados pessoais de pacientes, e-mail e CPF/CNPJ do profissional (enviado ao Asaas), hashes bcrypt, tokens e sessões (só SHA-256), dump cifrado do banco.

## O que está bem feito (conferido)

- RLS com `FORCE` em toda tabela de negócio, policy `USING` + `WITH CHECK` por `app_usuario_id()`, FKs compostas `(id, usuario_id)` impedindo referência cruzada entre profissionais; `evolucao_app` e `evolucao_backup_ro` com `NOBYPASSRLS` e a 0024 falhando se alguma role tiver `SUPERUSER`/`BYPASSRLS` (`backend/scripts/migrations/0024_roles_padronizadas.ts:208-227`). Isolamento provado localmente (19 testes).
- `set_config('app.usuario_id', $1, true)` parametrizado numa transação por requisição (`backend/api/src/db.ts:344-377`); deploy falha se o cache do Hyperdrive estiver ligado.
- Funções `SECURITY DEFINER` com `search_path` fixo, sem SQL dinâmico, `EXECUTE` só para a app; o trigger `negar_alteracao` usa `now()` do banco, então `purgar_contas` com `p_agora` adulterado não apaga tabelas só de inclusão.
- Webhook: token comparado em tempo constante antes de ler o corpo, deduplicação por `event_id`, tudo numa transação (`backend/api/src/rotas/webhook-asaas.ts:76-129`).
- Senha só no Postgres (bcrypt 12, hash falso para e-mail inexistente), tokens de 256 bits guardados como SHA-256, código 2FA guardado como HMAC com segredo, uso único atômico (`UPDATE ... RETURNING`).
- Cookie `__Host-sid` (`Secure`, `HttpOnly`, `SameSite=Lax`, sem `Max-Age`), CSRF por HMAC do id da sessão com comparação em tempo constante, sessão de 15 min/12 h, todas as sessões encerradas na redefinição de senha.
- Sem CORS; `Cache-Control: no-store` em `/api/*`; erros 500 genéricos; Sentry sem corpo, cookie e e-mail.
- Tokens dos links de e-mail removidos da barra de endereço pelo front; push sem nome de paciente; `link` da sessão restrito a `http(s)://` no banco.
- Nenhum segredo no repositório ou no histórico; `.env*` e `.dev.vars*` ignorados.

---

## Achados

### SEC-001 [ALTO] Rotas públicas esgotam a cota diária do Resend e derrubam o login de todos (2FA por e-mail)

- **Estado:** confirmado por leitura de código e pelo runbook; não reproduzido contra o Resend (proibido).
- **Onde:** `backend/api/src/rotas/cadastro.ts:72-98` (envia e-mail a qualquer endereço, novo, pendente ou já confirmado), `backend/api/src/rotas/recuperar.ts:153-176`, `backend/api/src/rotas/auth-2fa-reenviar.ts:39-56`; limite só por IP em `backend/api/src/middleware/limite.ts:14-21` e `wrangler.jsonc:18-21` (10/min/IP, por localização). O runbook confirma a cota de 100 e-mails/dia **compartilhada com os outros apps LJS** (`docs/runbook.md:532-560`).
- **Cenário:** sem conta e sem credencial, o atacante faz cerca de 100 `POST /api/cadastro` com e-mails aleatórios (10 IPs por 1 minuto, ou 1 IP por 10 minutos; com SEC-003 ou SEC-008, menos ainda). A cota acaba: todo login passa a responder `503 mail_unavailable`, porque o código 2FA não sai, e o mesmo vale para cadastro, recuperação e e-mails de cobrança. Os outros dois apps LJS caem junto. Basta repetir uma vez por dia.
- **Reprodução (local, sem Resend):** com o cliente de e-mail simulado dos testes, 100 chamadas a `POST /api/cadastro` com `{"nome":"x","email":"<aleatório>@exemplo.com","senha":"<senha válida>"}` resultam em 100 chamadas a `enviar()`. Nenhuma trava além do binding por IP.
- **Correção recomendada:** (1) CAPTCHA invisível (Cloudflare Turnstile) em cadastro, recuperação e reenvio; (2) teto global e por e-mail de destino em tabela (`limite_uso`), por exemplo 3 e-mails por destinatário/hora e um orçamento diário por tipo, reservando parte da cota para 2FA; (3) conta Resend própria para este app, ou plano pago; (4) alerta antes do limite, não só no primeiro 429.

### SEC-002 [MÉDIO] As páginas do app (HTML/JS) saem sem CSP, HSTS, `frame-ancestors`, `nosniff` e `Referrer-Policy`

- **Estado:** confirmado no `wrangler dev` local.
- **Onde:** `wrangler.jsonc:8-15` (`run_worker_first: ["/api/*"]`: os assets não passam pelo middleware `backend/api/src/middleware/cabecalhos.ts`); não existe `_headers` em `frontend/web/public/`. O teste de OPS-09 (`backend/api/test/cabecalhos.test.ts`) só cobre `/api/*`, e a validação marcou OPS-09 como atendido.
- **Cenário:** sem `frame-ancestors`/`X-Frame-Options`, qualquer site pode embutir `/app/...` num iframe (clickjacking sobre ações do profissional logado). Sem CSP no documento, não há defesa em profundidade contra XSS. Sem HSTS no documento principal, o primeiro acesso por `http://` fica exposto, a menos que a zona force HTTPS.
- **Reprodução:** `pnpm build:web`, depois `wrangler dev --port 8799` e `curl -sD - -o /dev/null http://127.0.0.1:8799/app/inicio`. Resultado: `200` só com `Content-Type` e `Cache-Control`, sem nenhum dos cabeçalhos de segurança. Em `/api/health` todos aparecem (`evidencias/wrangler-dev-8799.log`).
- **Correção recomendada:** gerar `frontend/web/public/_headers` com os mesmos valores de `cabecalhos.ts` para `/*`, ou ligar `run_worker_first` para tudo; teste que confira os cabeçalhos em `/`, `/app/*` e `/sw.js`.

### SEC-003 [MÉDIO] Limite por IP contornável com percent-encoding no caminho

- **Estado:** confirmado localmente (Hono 4.13.13 e `wrangler dev`). O efeito em produção depende de a normalização de URL da Cloudflare reescrever o caminho antes do Worker: **[A ESCLARECER: testar contra um ambiente de homologação autorizado]**.
- **Onde:** `backend/api/src/middleware/limite.ts:50` decide o grupo por `new URL(c.req.url).pathname` (não decodifica), enquanto o roteador do Hono decodifica o caminho (`getPath` + `decodeURI`). `/api/auth/%65ntrar` chega ao handler de `/api/auth/entrar` com `grupoDaRota` = `null`, ou seja, sem limite.
- **Cenário:** força bruta no 2FA, envio em massa de cadastro e recuperação (agrava SEC-001 e SEC-006) e custo de bcrypt no Neon (cada `entrar` ou `cadastro` roda bcrypt 12 no compute) sem o teto de 10/min.
- **Reprodução:** `node --experimental-strip-types evidencias/poc/poc-limite.mts` (middleware real, binding que sempre nega): `/api/auth/entrar` dá `429`; `/api/auth/%65ntrar` e `/api/cadastr%6F` dão `200`, com o binding chamado 0 vezes. No `wrangler dev`, 14 POST no caminho normal passaram pelo limitador, e os caminhos codificados chegaram ao handler (`422` de validação) sem passar por ele.
- **Correção recomendada:** decidir o grupo pelo caminho já roteado (`c.req.path`) ou aplicar o limitador por rota (`app.post('/auth/entrar', limite('acesso'), ...)`); por precaução, recusar caminhos com `%` em `/api/*`; teste com variantes codificadas.

### SEC-004 [MÉDIO] Dump com todos os dados de saúde fica em artefato que qualquer conta do GitHub baixa; a única barreira é a chave age

- **Estado:** confirmado por configuração; o runbook já registra o fato (`docs/runbook.md:394-396`) e cita um artefato real (`backup-40910306123`).
- **Onde:** `.github/workflows/backup.yml:47-65` e `deploy.yml:132-150` (repositório público, retenção de 30 dias). O dump lê tudo pela `evolucao_backup_ro`, inclusive `credencial_senha` (bcrypt), sessões, tokens e o `audit_log` com IP e user-agent (`0003_identidade.ts:96-97`).
- **Cenário:** "colhe agora, decifra depois": quem baixar hoje os 30 dias de dumps lê prontuários de todos os profissionais se a chave privada vazar a qualquer momento (máquina do operador, gerenciador de senhas, backup pessoal). Tamanho e frequência dos arquivos também ficam públicos. Cifrar com age (X25519) é sólido; o risco está em ter um único controle protegendo dado sensível publicado.
- **Correção recomendada:** guardar o backup fora do alcance público: bucket R2 privado com token só de escrita no Actions, ou repositório privado só para backups, ou repositório principal privado. Se o artefato público continuar, registrar a aceitação do risco, guardar a chave em hardware/cofre com dois guardiões e rotacionar o par age periodicamente.

### SEC-005 [MÉDIO] Nome de paciente vai ao Sentry (breadcrumbs de clique e URLs de busca)

- **Estado:** confirmado por leitura de código (Sentry 11.9.0 e componentes do app); não reproduzido contra o Sentry.
- **Onde:** o Sentry do navegador grava `aria-label` nos breadcrumbs de clique (`node_modules/.pnpm/@sentry+browser-utils@11.9.0/.../htmlTreeAsString.js:98`), e o app põe o nome do paciente em `aria-label`: `frontend/web/src/app/financeiro/financeiro.tsx:124` ("Ver pendências de <nome>"), `:135` ("Registrar pagamento de <nome>"), `frontend/web/src/ui/new/PrivacyName.tsx:31`. A busca `GET /api/pacientes?q=<nome>` (`backend/contrato/src/pacientes.ts:46-50`) entra nos breadcrumbs de fetch do front e na URL dos eventos do Worker. `limparEvento` só mascara e-mails (`frontend/web/src/sentry.ts:22-35`, `backend/api/src/sentry.ts:21-34`).
- **Cenário:** qualquer erro depois de um clique na tela financeira (ou de uma busca) envia ao Sentry, um operador nos EUA, o nome do paciente associado a "em débito" com um profissional de saúde. Isso é dado pessoal sensível por contexto, transferido sem previsão na política (ver SEC-016).
- **Correção recomendada:** no `beforeSend` e no `beforeBreadcrumb`, descartar breadcrumbs `ui.click` (ou apagar o `message`) e tirar a query string das URLs de breadcrumbs e de `request.url`; ou desligar o `breadcrumbsIntegration({ dom: false })`; teste com um evento que contenha `aria-label` e `?q=`.

### SEC-006 [MÉDIO] Cadastro permite enviar e-mail com texto do atacante, a partir do domínio do app, para qualquer endereço

- **Estado:** confirmado por leitura de código.
- **Onde:** `backend/api/src/rotas/cadastro.ts:33-46` (`Olá, ${nome}.` no corpo) e `backend/contrato/src/identidade.ts:16` (`nome` livre de até 200 caracteres, com quebras de linha e URLs).
- **Cenário:** `POST /api/cadastro` com `email` = vítima e `nome` = "Sua conta foi suspensa. Regularize em https://golpe.exemplo …". O e-mail sai assinado (DKIM) por `@evolucaosegura.com.br` com aparência legítima. Serve para phishing contra profissionais e pacientes e queima a reputação do domínio e da conta Resend, que é compartilhada.
- **Correção recomendada:** não ecoar o nome no e-mail (usar "Olá."); ou restringir `nome` a letras, espaços e pontuação simples, sem `://`, `www.` nem quebra de linha; somar ao limite por destinatário do SEC-001.

### SEC-007 [MÉDIO] Rascunhos ilimitados de até 512 KiB por conta podem esgotar o armazenamento do Neon (negação de serviço para todos)

- **Estado:** confirmado por leitura de código.
- **Onde:** `backend/api/src/rotas/rascunhos.ts:68-90` (PUT cria um rascunho por `(tipo, ref)`), `backend/dominio/src/clinico/rascunho.ts:18-22` e `0009_evolucao.ts:59-68` (`tipo` e `ref` livres até 120 caracteres; o `ref` não precisa existir), `backend/contrato/src/clinico.ts:89-103` (512 KiB). Não há rota de exclusão nem limite por conta ou por tempo nas rotas autenticadas.
- **Cenário:** um cadastro gratuito (trial aberto) faz cerca de 1.000 `PUT /api/rascunhos/x/<n>` com 512 KiB de dados aleatórios, ou seja, cerca de 0,5 GB, o armazenamento do Neon Free. O banco para de aceitar escrita para todos os profissionais. O mesmo vale, em menor escala, para modelos de texto e retificações.
- **Correção recomendada:** cota por profissional (número de rascunhos e bytes totais), `ref` validado contra o tipo (UUID de sessão ou paciente existente), limite de escrita por sessão em `limite_uso`, purga de rascunhos antigos pelo cron e alerta de armazenamento.

### SEC-008 [BAIXO] Rotas públicas aceitam corpo `text/plain`: login CSRF e disparo de cadastro e recuperação a partir do navegador de terceiros

- **Estado:** confirmado localmente (`evidencias/poc/poc-texto.mts`: um corpo de `<form enctype="text/plain">` passa pelo `lerCorpo` + `esquemaVerificar2fa`, usando chave JSON duplicada para engolir o `=`).
- **Onde:** `backend/api/src/http.ts:28-30` (`c.req.json()` não confere `Content-Type`); rotas públicas sem CSRF e sem conferência de `Origin`.
- **Cenário:** (a) um site malicioso faz o navegador da vítima enviar `POST /api/auth/2fa/verificar` com o e-mail e um código válido **do atacante**. A vítima passa a usar a conta do atacante, e a sessão dela é encerrada (`auth-2fa.ts:168`). (b) Qualquer site pode usar os visitantes para disparar `POST /api/cadastro` e `/api/auth/recuperar` de milhares de IPs, o que contorna o limite por IP e agrava SEC-001 e SEC-006.
- **Correção recomendada:** exigir `Content-Type: application/json` (415 caso contrário) e conferir `Origin`/`Sec-Fetch-Site` nas rotas públicas que escrevem.

### SEC-009 [BAIXO] Bloqueio por e-mail permite negar acesso a um profissional específico

- **Onde:** `backend/api/src/rotas/auth-entrar.ts:70-87`, `backend/dominio/src/identidade/regras-acesso.ts:8-10` (5 falhas em 15 min bloqueiam o e-mail por 15 min, mesmo com a senha certa).
- **Cenário:** com 5 tentativas a cada 15 minutos, um atacante mantém bloqueado o login de um profissional cujo e-mail é público. É a troca prevista no AUTH-07, mas sem atenuante.
- **Correção recomendada:** bloquear pelo par (e-mail, IP), com teto global por e-mail mais alto, e/ou exigir CAPTCHA em vez de bloquear; avisar o titular por e-mail no bloqueio.

### SEC-010 [BAIXO] 2FA sem teto por conta: o reenvio zera os erros a cada 60 s e o login com a senha certa abre desafios sem limite

- **Onde:** `backend/api/src/rotas/auth-2fa-reenviar.ts:39-50` (desafio novo com `erros = 0` sem pedir a senha), `backend/api/src/repositorios/identidade.ts:139-158`, `backend/api/src/rotas/auth-2fa.ts:156-163` (os erros do 2FA não entram em `tentativa_login`).
- **Cenário:** quem já tem a senha tenta cerca de 5 códigos por minuto, indefinidamente. Hoje a cota do Resend limita isso a cerca de 500 tentativas/dia (probabilidade de cerca de 5×10⁻⁴/dia); com plano pago, chega a cerca de 7.200/dia (cerca de 0,7%/dia).
- **Correção recomendada:** contar os erros de 2FA por conta numa janela (ex.: 10/hora) e bloquear o 2FA da conta; limitar desafios por hora; avisar o titular.

### SEC-011 [BAIXO] `POST /api/conta/excluir` confere a senha sem limite de tentativas

- **Onde:** `backend/api/src/rotas/conta-excluir.ts:75` (`faltando` inclui `senha`; rota autenticada fora do limitador e do `tentativa_login`).
- **Cenário:** quem roubou uma sessão descobre a senha (oráculo de bcrypt) para reutilizá-la depois ou em outros serviços; cada tentativa também custa cerca de 250 ms de CPU do Neon.
- **Correção recomendada:** contar as falhas dessa conferência em `tentativa_login` (mesma regra do login) e encerrar a sessão após N erros.

### SEC-012 [BAIXO] O requisito "exportou nas últimas 24 h" da exclusão é satisfeito pedindo só a última página (e por GET com efeito colateral)

- **Onde:** `backend/api/src/rotas/exportar-tudo.ts:137-149` audita `exportacao.concluida` sempre que a página não tem próxima, e o cursor é previsível (`{"t":"configuracao_usuario","d":null}` em base64url); `backend/api/src/rotas/conta-excluir.ts:30-40` aceita esse evento.
- **Cenário:** o profissional (ou uma navegação de topo induzida de outro site, já que o cookie `Lax` vai em GET) registra a "exportação concluída" sem baixar nada. Isso enfraquece a salvaguarda de guarda do prontuário antes da purga.
- **Correção recomendada:** auditar a conclusão só quando a sequência começou pelo primeiro cursor (por exemplo, id de exportação assinado no cursor, ou contagem de páginas servidas em `limite_uso`).

### SEC-013 [BAIXO] Push: número ilimitado de assinaturas por conta e endpoint `https://` arbitrário

- **Onde:** `backend/contrato/src/push.ts:10-13`, `backend/api/src/rotas/push.ts:32-52`, envio em `backend/api/src/integracoes/push-lotes.ts:31-40` (o limite de 10 itens por tarefa vale por profissional, não por assinatura).
- **Cenário:** uma conta registra milhares de endpoints (ex.: um servidor do atacante). Cada lembrete gera milhares de subrequisições no cron, o que estoura o limite de subrequisições do Worker e atrasa ou derruba os avisos dos outros profissionais. Também permite usar o Worker para disparar POSTs a URLs escolhidas.
- **Correção recomendada:** limite de assinaturas por conta (ex.: 10) e lista de hosts de push conhecidos (FCM, Mozilla, Apple, WNS).

### SEC-014 [BAIXO] Dependências com vulnerabilidade conhecida, todas fora do código que roda no Worker

- **Onde:** `undici 7.29.1` (via `@sentry/cloudflare > wrangler > miniflare`): GHSA-xjj6-f33q-929c, GHSA-4w7w-5xrc-9h26, GHSA-2m5v-pch6-74hx, GHSA-qrxm-fqhp-jwvm (altos) e 4 moderados; `zod` dentro do `@cloudflare/vitest-plugin` (GHSA-mrhx-c7xc-m3w5); `deepmerge` (baixo, build do PWA). O `zod` do app é 4.6.7, já corrigido.
- **Risco:** só na máquina do desenvolvedor e no CI/deploy (ferramenta wrangler), não no runtime.
- **Correção recomendada:** atualizar o wrangler para uma versão com `undici >= 7.30.1` (ou `overrides`) e o `@cloudflare/vitest-plugin`. É decisão do usuário (`/atualizacoes`).

### SEC-015 [BAIXO] Cadeia de suprimento dos workflows

- **Onde:** actions por tag móvel (`actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/upload-artifact@v7`) em todos os workflows; `ci.yml:56` baixa o gitleaks com `curl | tar` sem conferir checksum; `e2e.yml:103` usa o segredo de repositório `ASAAS_API_KEY` em `push` (qualquer branch).
- **Cenário:** uma tag comprometida de uma action roda no job de deploy, que recebe `CLOUDFLARE_API_TOKEN` e a URL do owner do Neon.
- **Correção recomendada:** fixar as actions por SHA (com Dependabot), conferir o SHA-256 do gitleaks, garantir que `ASAAS_API_KEY` de repositório seja só de sandbox e restringir o environment `producao` (ver Perguntas).

### SEC-016 [BAIXO] LGPD: política sem suboperadores nem transferência internacional; dados de terceiros sem retenção definida

- **Onde:** `frontend/web/src/publico/termos.tsx:75-108` não cita Cloudflare, Neon, Resend, Sentry nem GitHub (backups), nem a transferência internacional (art. 33) e o encarregado. Contas pendentes nunca confirmadas (e-mail e nome de terceiros inseridos por qualquer um) não são apagadas (`0016_funcoes_limpeza.ts` só marca tokens e sessões). `webhook_evento` sem profissional associado e `tentativa_login` por IP (SHA-256 de IPv4, reversível por força bruta) ficam para sempre.
- **Correção recomendada:** completar a política na revisão jurídica já prevista (`docs/runbook.md` 6.4); purgar contas pendentes após N dias e linhas de `tentativa_login` e `webhook_evento` antigas; usar HMAC com segredo no lugar de SHA-256 puro para chave de IP.

### SEC-017 [BAIXO] A validação do ambiente (`lerAmbiente`) não roda no Worker

- **Onde:** `backend/api/src/ambiente.ts:69` é usado só nos testes; `backend/api/src/app.ts:83-86` usa `env.E2E_EMAIL_CAPTURA_URL` direto.
- **Cenário:** a trava "só localhost" do `E2E_EMAIL_CAPTURA_URL` e os formatos (`ASAAS_BASE_URL`, `HMAC_2FA_SEGREDO >= 32`) não protegem a produção. Uma variável errada no painel da Cloudflare desviaria todos os e-mails (códigos 2FA e links de redefinição) para outro endereço sem falhar.
- **Correção recomendada:** chamar `lerAmbiente(env)` uma vez por instância no `fetch` e no `scheduled` (falha fechada, sem ecoar valores).

### SEC-018 [BAIXO] Ambiente local: Postgres aberto na rede e `wrangler dev` como superusuário

- **Onde:** `docker-compose.yml:11-12` publica `0.0.0.0:5433` com `postgres/postgres`; `wrangler.jsonc:33` aponta o Hyperdrive local para o superusuário `postgres`, que ignora o RLS.
- **Cenário:** outra máquina da rede lê o banco de desenvolvimento; o teste manual com `wrangler dev` não exercita o RLS (só o e2e e a suíte usam `evolucao_app`).
- **Correção recomendada:** publicar só em `127.0.0.1:5433` e usar `evolucao_app` no `localConnectionString` (como no runbook, passo 3b).

---

## Observações (sem severidade)

- `pnpm test:isolamento` (o comando do passo "Teste de isolamento" do `ci.yml:62-63`) falhou localmente com "Vitest failed to find the current suite" (`evidencias/isolamento.log`); o mesmo arquivo rodado pela raiz passou 19/19 (`evidencias/isolamento-raiz.log`). Vale conferir no histórico do CI se o passo está verde de verdade, porque ele é a garantia do ISO-02.
- O roteiro 8.3 do runbook confere atributos das roles, mas não as **associações** (`pg_auth_members`): recomenda-se conferir que `evolucao_app` e `evolucao_backup_ro` não são membros de `neon_superuser`, `pg_read_all_data` nem `pg_write_all_data`.
- `usuario`, `sessao`, `token_email` e `desafio_2fa` não têm RLS e a app pode ler todas as linhas (`0003_identidade.ts:99-106`). Não há injeção de SQL (todo SQL é parametrizado; `sql.ref`/`sql.table` só com valores fixos ou enum), mas qualquer falha futura daria acesso à lista de e-mails de todos os profissionais.
- Os screenshots `comparacao/*/legado-*.png` (repositório público) usam dados de exemplo ("Paciente Exemplo Um"); conferidos por amostragem.

## Perguntas para o usuário

1. **Environment `producao` no GitHub** (não verificável daqui): ele tem "Deployment branches = só `main`" e revisor obrigatório?
   - (a) Sim, os dois (recomendado): nenhuma branch nem colaborador consegue rodar um workflow alterado com `NEON_URL_MIGRACAO`, `NEON_URL_BACKUP` e `CLOUDFLARE_API_TOKEN`.
   - (b) Só a restrição de branch: protege contra workflow alterado em outra branch, mas qualquer push na `main` executa com os segredos.
   - (c) Nenhum: quem tem escrita no repositório pode ler todos os prontuários pela `NEON_URL_BACKUP`. Nesse caso SEC-015 sobe para alto.
2. **Onde guardar o backup (SEC-004):**
   - (a) Bucket R2 privado (recomendado): o dump sai do alcance público, com custo próximo de zero.
   - (b) Repositório privado só para backups: simples, mas os artefatos ainda dependem do GitHub.
   - (c) Manter o artefato público e aceitar o risco por escrito: tudo depende da chave age.
3. **Cota do Resend (SEC-001):**
   - (a) Turnstile + limite por destinatário e orçamento reservado para 2FA (recomendado): resolve o abuso sem custo fixo.
   - (b) Plano pago ou conta Resend exclusiva: aumenta a cota, mas o abuso continua barato.
   - (c) Aceitar o risco no lançamento: qualquer pessoa derruba o login de todos por um dia com cerca de 100 requisições.

## Decisões do usuário (2026-10-30)

- **SEC-001 (alto): risco ACEITO por escrito pelo usuário para o lançamento.** Sem Turnstile, sem limite por destinatário e sem cota reservada ao 2FA. Qualquer pessoa pode esgotar a cota de 100 e-mails/dia do Resend, compartilhada com os outros apps LJS, e derrubar o login de todos por um dia. Reavaliar se houver abuso ou antes de ter mais clientes.
- **SEC-004 (médio): risco ACEITO por escrito.** O dump cifrado com age continua em artefato do Actions de repositório público (retenção de 30 dias). Tudo depende da chave privada age, que precisa de cópia fora do GitHub e de dois guardiões.
- **Environment `producao`:** o usuário informou que restringe a branch `main` e exige revisor (não verificado pelo auditor; conferir no GitHub). SEC-015 permanece baixo.
- **Correções planejadas:** SEC-002 (T214), SEC-003 (T215), SEC-005 (T216), SEC-006 (T217), SEC-007 (T218 e T219) e a observação do `test:isolamento` (T220), na Phase 25. Os baixos (SEC-008 a SEC-018) ficam como pendências registradas, sem tarefa.
