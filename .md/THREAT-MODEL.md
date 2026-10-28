# Modelo de ameaças: Evolução Segura

> Método: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege). Fontes: [spec](../.specs/features/evolucao-segura/spec.md) (critérios entre colchetes) e [design](../.specs/features/evolucao-segura/design.md). Controles listados são os que a spec exige; o que ainda não existe no código está marcado como planejado. Este documento é revisado a cada etapa que muda uma fronteira de confiança e na auditoria de segurança antes da publicação.

## 1. Ativos

| Ativo                                                        | Por que importa                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| Prontuário (anamnese, evolução, TCLE) e agenda dos pacientes | Dado de saúde, sensível pela LGPD (art. 11)                 |
| Credenciais, sessões e códigos 2FA                           | Quem os tem se passa pelo profissional                      |
| Dados financeiros (preços, pagamentos) e assinatura          | Sigilo do profissional e integridade da cobrança            |
| Trilha de auditoria                                          | Prova de quem fez o quê                                     |
| Backups cifrados e a chave privada do `age`                  | Cópia completa do banco                                     |
| Segredos (Asaas, Resend, VAPID, Sentry, `NEON_URL_MIGRACAO`) | Acesso a serviços externos e ao banco como `evolucao_owner` |

## 2. Fronteiras de confiança

| Fronteira | De → Para                                           | O que cruza                                  | Controle principal                                                  |
| --------- | --------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| F1        | Internet → Worker (`/api/*` e assets)               | Qualquer requisição, de qualquer IP          | Rate limit, cabeçalhos, validação Zod, CSRF, sessão                 |
| F2        | Worker → Postgres (Hyperdrive, role `evolucao_app`) | Consultas com `app.usuario_id`               | RLS forçada, transação por requisição, grants mínimos               |
| F3        | Asaas → Worker (`/api/webhooks/asaas`)              | Eventos de cobrança                          | Token no cabeçalho, `event_id` único, estado calculado pelo domínio |
| F4        | Worker → Resend, Asaas, serviços de push            | Dados mínimos para e-mail, cobrança e push   | Texto puro, sem dado clínico, erro tipado, tempo limite             |
| F5        | Worker → Sentry                                     | Erros                                        | Scrubbing de corpo, cookie e e-mail                                 |
| F6        | Navegador ↔ dispositivo do profissional             | Sessão, cache, rascunhos, exportações        | Cookie `__Host-sid`, `no-store`, limpeza do cache ao expirar        |
| F7        | GitHub Actions → Neon e Cloudflare                  | Migração como `evolucao_owner`, deploy, dump | Environment `producao`, só `main`, segredos fora do repositório     |
| F8        | Banco → artefato de backup                          | Dump completo                                | Role `evolucao_backup_ro`, cifra com `age`, retenção de 30 dias     |

## 3. Ameaças por área

Nas tabelas, "Planejado" significa que a tarefa que entrega o controle ainda está pendente no [tasks.md](../.specs/features/evolucao-segura/tasks.md).

### 3.1 Autenticação e sessão (F1, F6)

| STRIDE | Ameaça                                             | Controle                                                                                                                                         | Critério            |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| S      | Adivinhar ou reaproveitar senha de um profissional | Política de senha com lista de comuns; bcrypt custo 12 no Postgres; 2FA por e-mail em todo login; bloqueio de 5 falhas em 15 min por e-mail e IP | AUTH-07, 11, 12     |
| S      | Roubo ou fixação de sessão                         | Id de 256 bits guardado como SHA-256; cookie `__Host-sid` HttpOnly, Secure, SameSite=Lax; id novo a cada login; expiração em 15 min ou 12 h      | AUTH-04, 09, 10     |
| S      | Forçar código 2FA                                  | 6 dígitos por CSPRNG, HMAC, 10 min, uso único, 5 erros invalidam o desafio, rate limit de 10 por minuto                                          | AUTH-03, 05, OPS-07 |
| T      | CSRF em escrita autenticada                        | `x-csrf-token` obrigatório; SameSite=Lax                                                                                                         | AUTH-17             |
| R      | Negar um login ou logout                           | Auditoria `auth.login_ok` e `auth.logout`                                                                                                        | AUD-04              |
| I      | Enumerar e-mails cadastrados                       | Mesma resposta e tempo equivalente em cadastro, login e recuperação; hash calculado também para e-mail inexistente                               | CAD-02, AUTH-02, 13 |
| I      | Token de e-mail ou recuperação vazado do banco     | Só SHA-256 no banco, 256 bits, 30 min, uso único                                                                                                 | CAD-03, AUTH-13     |
| D      | Esgotar a cota de 100 e-mails por dia do Resend    | Rate limit por IP; 503 `mail_unavailable` sem contar falha; alerta no Sentry. Risco residual: ataque distribuído pode esgotar a cota             | AUTH-08, OPS-07     |
| E      | Sessão de conta bloqueada ou em exclusão           | Login recusado com o mesmo 401; sessões encerradas ao bloquear                                                                                   | AUTH-02, CONTA-03   |

### 3.2 Isolamento entre profissionais (F2)

| STRIDE | Ameaça                                                        | Controle                                                                                                                    | Critério               |
| ------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| I      | Profissional B lê dado de A por id ou por listagem            | RLS `FORCE` em toda tabela de negócio; 404 idêntico ao de inexistente; teste de isolamento varre o catálogo                 | ISO-01, ISO-02         |
| T      | B altera ou referencia recurso de A                           | RLS na escrita; chaves estrangeiras checadas dentro da transação do próprio usuário                                         | ISO-02                 |
| I      | Vazamento de contexto entre requisições pelo pooler           | `SET LOCAL` dentro de `BEGIN`; spike S1 prova o comportamento com o pooler do Hyperdrive. Pendente do spike                 | ISO-01, design (Risks) |
| E      | Bug na API contorna o RLS por role privilegiada               | Runtime usa a role `evolucao_app` (sem `BYPASSRLS`, sem DDL); `evolucao_owner` só nas migrations                            | ISO-03                 |
| E      | Função `SECURITY DEFINER` mal escrita escala privilégio       | `search_path` fixo, parâmetros tipados, sem SQL dinâmico; teste que a `evolucao_app` executa só as funções listadas         | ISO-03                 |
| T      | Apagar ou adulterar prontuário e auditoria                    | `evolucao_app` sem DELETE e TRUNCATE; auditoria bloqueada para UPDATE e DELETE por trigger, inclusive para `evolucao_owner` | ISO-03, AUD-01         |
| I      | Cache do Hyperdrive serve dado desatualizado de outro momento | Cache desligado (`--caching-disabled`)                                                                                      | OPS-13                 |

### 3.3 Webhook do Asaas (F3)

| STRIDE | Ameaça                                            | Controle                                                                                                                           | Critério         |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| S      | Quem não é o Asaas envia evento falso             | Token configurado exigido; sem ele, 401 sem processar. Risco residual: o token é um segredo compartilhado, sem assinatura do corpo | PLANO-06         |
| T      | Evento forjado muda a assinatura de outro usuário | Estado vindo do domínio a partir do evento validado; vínculo por `asaas_customer_id` e `asaas_subscription_id`                     | PLANO-08, 09     |
| R      | Contestar uma mudança de plano                    | `webhook_evento` guarda cada evento; auditoria `assinatura.<estado>`                                                               | PLANO-07, AUD-04 |
| D      | Reenvio em massa ou repetição                     | Idempotência por `event_id` único; limite próprio do webhook (`LIMITE_WEBHOOK`)                                                    | PLANO-07, OPS-07 |
| E      | Rota do webhook usada para ler dado sem sessão    | Rota pula a sessão mas só chama funções `SECURITY DEFINER` estreitas; resposta sem dado                                            | design           |

### 3.4 Push (F4)

| STRIDE | Ameaça                                            | Controle                                                                                                         | Critério        |
| ------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------- |
| I      | Notificação na tela bloqueada expõe dado de saúde | Push sem nome de paciente nem texto clínico; payload cifrado (RFC 8291)                                          | PUSH-05         |
| S      | Inscrever o endpoint de outro para receber avisos | `push_subscription` sob RLS, ligada ao `usuario_id` da sessão                                                    | PUSH-01, ISO-01 |
| T      | Alterar o conteúdo em trânsito                    | Cifra de ponta a ponta do payload e VAPID ES256                                                                  | PUSH-07         |
| D      | Lote grande estoura CPU ou duplica envio          | Envio em lotes com `ctx.waitUntil`; `notificacao_enviada` única por tipo e ref; remoção de assinatura 404 ou 410 | PUSH-02, 06, 07 |
| E      | Chave VAPID privada vazada                        | Segredo no `wrangler secret`; rotação no runbook                                                                 | OPS-11, OPS-12  |

### 3.5 Exportação (F1, F6)

| STRIDE | Ameaça                                     | Controle                                                                                                                                       | Critério       |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| I      | Exportar dado de outro profissional        | Mesma transação com RLS; paciente de outro responde 404                                                                                        | EXP-07, ISO-02 |
| I      | Credenciais e sessões no arquivo           | Exportação completa exclui credenciais e sessões                                                                                               | EXP-03         |
| I      | Arquivo baixado fica no dispositivo        | `no-store`; PDF e zip montados no navegador, sem cópia no servidor. Risco residual: o arquivo no disco do profissional é responsabilidade dele | PUB-05, EXP-02 |
| R      | Exportar sem deixar rastro                 | Auditoria `exportacao.concluida`, sem conteúdo                                                                                                 | EXP-06         |
| D      | Exportações repetidas esgotam CPU ou banda | Limite de 5 por 60 s com contador em tabela; 413 acima de 25 MB                                                                                | EXP-04, EXP-05 |
| E      | Sessão roubada exporta tudo                | CSRF, sessão curta, 2FA no login. Risco residual: sessão válida roubada ainda exporta                                                          | AUTH-09, 17    |

### 3.6 Exclusão de conta (F1, F7)

| STRIDE | Ameaça                                               | Controle                                                                                                               | Critério         |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| S      | Terceiro com sessão aberta apaga a conta             | Exige senha, exportação completa nas últimas 24 h e declaração de guarda; confirmação por link enviado ao e-mail       | CONTA-01, 02     |
| T      | Purga apaga linhas de outro profissional             | Função `SECURITY DEFINER` estreita, parâmetro tipado, teste de que só o `usuario_id` alvo é afetado                    | CONTA-05, ISO-03 |
| R      | Negar que pediu a exclusão                           | Auditoria `conta.exclusao_<etapa>` até a purga; depois fica só `conta_excluida` (id, datas), sem dado pessoal          | AUD-04, CONTA-05 |
| I      | Dado remanescente após a purga, inclusive em backups | Purga apaga todas as linhas; backups de 30 dias podem reter a conta até vencerem. Risco residual a declarar nos termos | CONTA-05         |
| D      | Bloquear a conta de outra pessoa                     | Só o dono, autenticado, inicia; desistência por link por 30 dias                                                       | CONTA-03, 04     |
| E      | Reabrir a conta após a purga                         | Purga é definitiva; novo cadastro cria conta nova                                                                      | CONTA-05         |

### 3.7 Cadeia de entrega e operação (F5, F7, F8)

| STRIDE | Ameaça                                 | Controle                                                                                                 | Critério       |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------- |
| E      | Deploy fora do fluxo fiscalizado       | `wrangler deploy` só no `deploy.yml`, manual, só `main`, environment `producao`; teste falha se aparecer | OPS-03, OPS-04 |
| I      | Segredo commitado                      | gitleaks no CI; `.env.example` sem valores reais; segredos só em GitHub Secrets e `wrangler secret`      | OPS-05, OPS-11 |
| I      | Backup lido por terceiros              | Cifra com `age` (chave pública no secret, privada fora do GitHub); artefato por 30 dias                  | OPS-01         |
| I      | Dado pessoal no Sentry                 | Scrubbing de corpo, cookie e e-mail; release igual ao SHA                                                | OPS-08         |
| T      | Migração destrutiva em produção        | Dump cifrado com `age` antes de migrar, guardado como artefato por 30 dias                               | OPS-03         |
| D      | Perda do banco                         | Backup diário e restauração testada antes da publicação                                                  | OPS-01, OPS-02 |
| I      | Script de terceiros no navegador (XSS) | CSP sem origens externas além das necessárias; `nosniff`; `frame-ancestors 'none'`                       | OPS-09         |

## 4. Riscos residuais aceitos

1. O webhook do Asaas se autentica por token compartilhado, não por assinatura do corpo (PREMISSA: confirmar no spike S3 se o Asaas oferece algo mais forte).
2. A cota de 100 e-mails por dia do Resend pode ser esgotada por ataque distribuído, o que impede logins novos (mitigação: alerta e plano B no runbook).
3. O binding de rate limit conta por localização, não globalmente (design [P-1]); o bloqueio forte de login fica em tabela.
4. Sessão válida roubada permite exportar tudo até expirar.
5. Backups retêm dado de conta excluída por até 30 dias.

## 5. Pendências

- `[A ESCLARECER]` prazo legal de guarda do prontuário (5 ou 20 anos): afeta o texto da exclusão e a retenção, não a modelagem de ameaças.
- Revisar este documento após os spikes S1 a S4 e na auditoria de segurança da fase de verificação.
