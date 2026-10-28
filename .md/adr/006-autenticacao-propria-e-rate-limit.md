# ADR-006: Autenticação própria e rate limit por IP

- **Status**: Aceito
- **Data**: 2026-10-25
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), CAD-01 a CAD-09, AUTH-01 a AUTH-19, OPS-07 e OPS-14; [design](../../.specs/features/evolucao-segura/design.md), Data Models, Risks e etapa 4; [spike rate-limit-free](../../.specs/spikes/rate-limit-free/registro.md); AD-005 e AD-006 do [STATE](../../.specs/STATE.md)

## Contexto

O cadastro é aberto e o login guarda acesso a prontuário. Não há provedor de identidade (Google saiu, D-01) e o Worker do plano Free tem 10 ms de CPU por requisição, o que não comporta bcrypt. As rotas públicas (cadastro, entrar, 2FA, recuperação, confirmação, webhook) precisam de limite por IP contra força bruta e contra o esgotamento da cota de 100 e-mails por dia do Resend. O design deixou o mecanismo do limite para o spike S2: o binding `ratelimits` do Worker, se existir no Free, ou um contador em tabela.

## Decisão

### Autenticação própria

- **Senha só no Postgres** (migration 0003): bcrypt de custo 12 por `crypt()` e `gen_salt('bf', 12)`, nas funções `definir_senha()` e `conferir_senha()` (`SECURITY DEFINER`, `search_path` fixo), sempre com a senha como parâmetro. A role `evolucao_app` não lê `credencial_senha`. Sem conta para o e-mail, `conferir_senha()` calcula um hash de mesmo custo (tempo equivalente, AUTH-02). Política de senha local (`backend/dominio/src/identidade/politica-senha.ts`, lista de 124 comuns do legado).
- **Segundo fator por e-mail em todo login**: código de 6 dígitos por CSPRNG, guardado só como HMAC-SHA256, válido por 10 minutos, uso único, invalidado no 5º erro; reenvio só com mais de 60 s.
- **Sessão opaca**: id de 256 bits no cookie `__Host-sid`, guardado só como SHA-256; encerra após 15 min sem uso ou 12 h do login. Encerrar, usar e invalidar são `UPDATE` de data; a `evolucao_app` não apaga.
- **Tokens de e-mail** (confirmação, recuperação, exclusão, desistência): 256 bits, só SHA-256 no banco, 30 minutos, uso único.
- **Tabelas de identidade sem RLS**: são lidas antes de existir usuário na transação. Em troca, grants mínimos por coluna e a lista `EXCECOES_SEM_RLS` do harness de isolamento, com o motivo e os privilégios exatos da `evolucao_app` em cada uma.
- **Anti-enumeração**: cadastro e recuperação respondem o mesmo 202 em todos os casos; o login recusa com um só corpo de 401 para todos os motivos.

### Rate limit por IP

- **Mecanismo**: o binding `ratelimits` do Worker. O spike provou que ele existe no plano Free (3 rodadas: 11 passes e 4 recusas em 15 requisições, limite efetivo ±1).
- **Grupos** (`backend/api/src/middleware/limite.ts`), cada um com o próprio namespace e contador, chave = `CF-Connecting-IP`:
  - `LIMITE_ACESSO`: 10 por minuto em cadastro, entrar, 2FA e recuperação;
  - `LIMITE_PUBLICO`: 60 por minuto nas demais rotas públicas;
  - `LIMITE_WEBHOOK`: 120 por minuto no webhook do Asaas (PREMISSA: a spec não fixa o número; revisar com o volume real do Asaas).
- Acima do limite, 429 `muitas_tentativas` em problem+json. Rota autenticada não tem limite por IP.
- O limite é **aproximado**: o binding conta por localização da Cloudflare e mediu ±1. O bloqueio forte de login (5 falhas em 15 min por e-mail e por IP, AUTH-07) fica em tabela (`tentativa_login`), não no binding.

## Alternativas consideradas

- **Contador em tabela (`limite_uso`) para todo o rate limit**: exato e global, mas custa uma ida ao banco em toda rota pública, inclusive para recusar abuso. Fica como plano B, se o binding deixar de existir no Free.
- **bcrypt ou argon2 no Worker** (como o legado fazia com argon2): estoura os 10 ms de CPU (OPS-14).

## Consequências

- O teste do OPS-07 usa o binding simulado do miniflare e aceita um passe a mais; não depende do número exato.
- `/api/health` ficou fora do limite (SPEC_DEVIATION registrada em `limite.ts`), à espera de decisão do usuário.
- Rota pública nova precisa entrar num grupo de `limite.ts` junto com a própria rota.
- Ataque distribuído (muitos IPs) ainda pode esgotar a cota do Resend; mitigação: alerta no Sentry no primeiro 429 do Resend e plano B no runbook (THREAT-MODEL, risco residual 2).
