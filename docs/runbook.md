# Runbook de operação

Procedimentos para quem opera o Evolução Segura em produção. Complementa o `README.md` (rodar
local, variáveis, deploy, testar o webhook).

Como ler este documento:

- Cada comando foi executado na máquina de desenvolvimento (Windows, Git Bash, `psql` 16) contra
  o Postgres local do `docker-compose.yml` (porta 5433) num **banco descartável** com as
  migrations aplicadas, ou contra o Worker local (`wrangler dev`). O que depende de conta externa
  (Asaas, Neon, Cloudflare, Resend) está marcado **não executado**, com o motivo.
- Nenhum valor real aparece aqui. `<...>` é um valor que você preenche; ids como
  `00000000-0000-4000-8000-000000000001`, `sub_demo_1` e `evt_demo_1&1` são fictícios.
- No `psql` do Windows as opções (`-c`, `-v`, `-f`) vêm **antes** da URL; depois dela são
  ignoradas e o `psql` abre o modo interativo.

## Conexões

| Para quê                                    | Role                                        | Onde está a URL                                   |
| ------------------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| Funções `tarefas.*` e auditoria (operações) | `app`                                       | `NEON_URL_APP` (GitHub Secret do env. `producao`) |
| Diagnóstico e ajustes como dono das tabelas | role de migração (`neondb_owner`) → `owner` | `NEON_URL_MIGRACAO`                               |
| Leitura para backup                         | `backup_ro`                                 | `NEON_URL_BACKUP`                                 |

As URLs ficam no environment `producao` do GitHub e no console do Neon; nunca as cole em arquivo
versionado nem em chamado. Exporte numa variável só na sua sessão do terminal, por exemplo
`export URL_APP='<url da role app>'`, e feche o terminal ao terminar.

As tabelas do profissional têm RLS forçada, que vale também para a role `owner`. Para ler
`webhook_evento` sem passar pela API, assuma `owner` e ligue o contexto das funções do webhook
(`app.tarefa_webhook = 'on'`, policies da migration 0014) só dentro de uma transação desfeita no
fim, como nos exemplos abaixo.

Banco descartável usado na verificação (para repetir os exemplos sem tocar no banco de
desenvolvimento):

```bash
U=postgresql://postgres:postgres@localhost:5433
psql -c "create database rb_demo" $U/postgres
DATABASE_URL=$U/rb_demo pnpm migrar
# Worker local apontando para ele (role app liberada como no passo 3b do README)
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://app:app@localhost:5433/rb_demo \
  pnpm --filter @es/api exec wrangler dev --config ../../wrangler.jsonc --port 8787
# ao terminar: psql -c "drop database rb_demo with (force)" $U/postgres
```

## 1. Webhook do Asaas que falhou

### Como o webhook falha

A rota `POST /api/webhooks/asaas` (`backend/api/src/rotas/webhook-asaas.ts`) grava o evento,
processa e marca como processado **numa transação só**:

| Resposta                      | Causa                                                                        | O que fica gravado        |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------- |
| `401`                         | cabeçalho `asaas-access-token` ausente ou diferente do `ASAAS_WEBHOOK_TOKEN` | nada                      |
| `422`                         | corpo sem `id` ou `event`                                                    | nada                      |
| `500`                         | erro no processamento (assinatura não achada, Asaas fora, ...)               | nada (tudo é desfeito)    |
| `200 {"status":"processado"}` | evento novo processado                                                       | linha em `webhook_evento` |
| `200 {"status":"repetido"}`   | o mesmo `id` já foi processado                                               | nada muda                 |

Consequência: **evento que falhou não aparece em `webhook_evento`**. O Asaas reenvia sozinho
os eventos que receberam erro; depois de 15 falhas seguidas ele **pausa a fila** de webhooks
daquela URL. O `500` vai ao Sentry pelo `onError` do app.

Causa mais comum de `500` que se resolve sozinha: o evento chega antes de a rota de assinar
gravar os ids do Asaas na assinatura (`public.gravar_ids_asaas`, migration 0013); o reenvio
seguinte encontra a assinatura.

### Diagnóstico

1. Sentry: procure os erros da rota `/api/webhooks/asaas` no horário (nunca há dado pessoal no
   evento). Não executado: exige a conta do Sentry.
2. Painel do Asaas (Integrações > Webhooks): veja o histórico de envios, o código de resposta e
   se a fila está pausada. Não executado: exige a conta do Asaas.
3. Banco: veja o que foi gravado (executado no banco descartável):

```bash
psql -X -v ON_ERROR_STOP=1 "$URL_MIGRACAO" <<'EOF'
begin read only;
set local role "owner";
set local app.tarefa_webhook = 'on';
select event_id, tipo, usuario_id, recebido_em, processado_em
from public.webhook_evento order by recebido_em desc limit 20;
rollback;
EOF
```

Localmente, `URL_MIGRACAO=postgresql://postgres:postgres@localhost:5433/rb_demo`. Em produção é
a URL da role de migração; o `set local role "owner"` funciona porque a migration 0001 concede
`owner` a ela com SET. Contra o Neon: **não executado** (exige acesso ao Neon).

O evento com falha não aparece na lista. Um evento que aparece com `processado_em` preenchido já
foi tratado; reenviá-lo responde `repetido` e não muda nada.

### Corrigir e reprocessar

1. Corrija a causa (token errado no Worker: `wrangler secret put ASAAS_WEBHOOK_TOKEN`, seção de
   segredos; Asaas fora: espere; assinatura sem ids: espere o reenvio).
2. Se a fila do Asaas pausou, reative-a no painel (Integrações > Webhooks). **Não executado**
   (exige a conta do Asaas). Os eventos retidos são reenviados com o **mesmo `id`** e, como não
   foram gravados, chegam como novos.
3. Para reenviar um evento à mão (por exemplo, copiado do histórico do painel), mande o mesmo
   corpo, com o mesmo `id`, para a rota. Executado contra o Worker local:

```bash
T='<valor de ASAAS_WEBHOOK_TOKEN>'
cat > evento.json <<'EOF'
{"id":"evt_demo_1&1","event":"PAYMENT_CREATED","payment":{"id":"pay_demo_1","subscription":"sub_demo_1","customer":"cus_demo_1","dueDate":"2026-11-10","value":49.9}}
EOF
curl -s -w ' HTTP %{http_code}\n' -X POST http://localhost:8787/api/webhooks/asaas \
  -H "asaas-access-token: $T" -H "content-type: application/json" --data-binary @evento.json
```

Observado: com a assinatura ainda sem os ids do Asaas, `500` e nada gravado; depois de os ids
estarem na assinatura, o mesmo comando respondeu `200 {"status":"processado"}` e o evento
apareceu no diagnóstico com `usuario_id` e `processado_em`; uma terceira vez, `repetido`. Em
produção troque a URL pela pública (`https://<domínio>/api/webhooks/asaas`): **não executado**
(exige o token de produção). Apague o `evento.json` depois: o corpo real tem ids do Asaas.

Eventos de pagamento (`PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`) consultam a API do Asaas
(`GET /subscriptions/{id}`, para o próximo vencimento). Localmente, com uma `ASAAS_API_KEY`
fictícia, o reenvio desse tipo respondeu `500` e nada foi gravado, como esperado. O caminho de
sucesso exige a chave do sandbox ou de produção: **não executado**.

## 2. Reprocessar um pagamento

Use quando o pagamento está confirmado no Asaas e a assinatura não foi para `ativa`, e reenviar o
evento (seção 1) não resolve ou não é possível (evento perdido, fila descartada).

Antes, confira no painel do Asaas que o pagamento está `RECEIVED` ou `CONFIRMED` e anote o
próximo vencimento da assinatura (`nextDueDate`, AAAA-MM-DD). **Não executado** (exige a conta
do Asaas).

### 2.1 Achar o profissional pelo id do Asaas

Com a role `app` (executado no banco descartável):

```bash
psql -X -c "select * from tarefas.localizar_assinatura_asaas('<id da assinatura no Asaas>', null)" "$URL_APP"
```

Sem o id da assinatura, passe `null` no primeiro e o id do cliente (`cus_...`) no segundo
parâmetro. Nenhuma linha: a assinatura não tem esses ids; não siga, investigue a criação.

### 2.2 Levar a assinatura a ativa, com auditoria

O script usa a mesma função do webhook (`tarefas.mudar_estado_assinatura`, migration 0012), com a
máquina de estados do PLANO-01, e o mesmo cálculo do fim do período (dia seguinte ao vencimento,
meia-noite em America/Sao_Paulo). Só grava, e só audita como `admin-cli`, se a função responder
`permitida`; qualquer outro resultado desfaz a transação. Salve como `reprocessar.sql`:

```sql
\set ON_ERROR_STOP on
begin;
select r.resultado, r.status_anterior,
       r.resultado = 'permitida' as mudou
from tarefas.mudar_estado_assinatura(:'usuario'::uuid, 'ativa',
       (:'vencimento'::date + 1)::timestamp at time zone 'America/Sao_Paulo', null) r
\gset
\echo resultado: :resultado (antes: :status_anterior)
\if :mudou
  select set_config('app.usuario_id', :'usuario', true);
  insert into public.audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id, campos_alterados)
  values (:'usuario'::uuid, 'admin-cli', 'assinatura.ativa', 'conta', :'usuario'::uuid,
          case :'status_anterior'
            when 'free' then '{status,periodo_fim,plano}'
            when 'atrasada' then '{status,periodo_fim,vencimento_atraso}'
            else '{status,periodo_fim}' end::text[]);
  commit;
\else
  rollback;
\endif
```

E rode com a role `app` (executado no banco descartável):

```bash
psql -X -q -v usuario=<usuario_id da 2.1> -v vencimento=<nextDueDate AAAA-MM-DD> -f reprocessar.sql "$URL_APP"
```

Resultados possíveis:

- `permitida`: mudou (trial, atrasada ou free passam a ativa) e o evento `assinatura.ativa` foi
  auditado. Observado: assinatura em `atrasada` foi a `ativa`, `vencimento_atraso` limpo,
  auditoria `{status,periodo_fim,vencimento_atraso}`.
- `mesmo_estado`: já estava ativa; nada é gravado (observado ao rodar de novo).
- `transicao_invalida`: por exemplo, `cancelada` não volta a `ativa` (PLANO-01). Nada é gravado.
  Não force: o profissional assina de novo pelo "Meu plano" quando a assinatura estiver em free.
- `inexistente`: o `usuario_id` não tem assinatura.

O e-mail de pagamento confirmado (PLANO-13) **não** é enviado por este caminho; avise o
profissional, se for o caso. Contra o Neon: **não executado** (exige acesso ao Neon).

## 3. Reativar um usuário

"Reativar" cobre três situações diferentes. Identifique qual antes de agir.

### 3.1 Plano Pro em atraso ou em free, com pagamento feito

É o reprocessamento da seção 2: `atrasada` e `free` passam a `ativa` pela mesma função. Se não
há pagamento, o caminho é o profissional assinar ou pagar o Pix pendente em "Meu plano"; o
webhook faz o resto.

### 3.2 Login bloqueado por tentativas

Depois de 5 falhas em 15 minutos, o e-mail fica bloqueado por 15 minutos (AUTH-07,
`regras-acesso.ts`); o bloqueio passa sozinho. Para liberar antes, com a role de migração
assumindo `owner` (a `tentativa_login` guarda só o SHA-256 do e-mail, em minúsculas). Executado
no banco descartável:

```bash
psql -X -v ON_ERROR_STOP=1 -v email='<e-mail do profissional>' "$URL_MIGRACAO" <<'EOF'
begin;
set local role "owner";
update public.tentativa_login
   set falhas = 0, janela_inicio = null, bloqueado_ate = null
 where tipo = 'email' and chave_hash = sha256(convert_to(lower(:'email'), 'UTF8'));
commit;
EOF
```

`UPDATE 1` liberou; `UPDATE 0`, não havia registro para esse e-mail. Contra o Neon: **não
executado**.

### 3.3 Conta bloqueada para exclusão

Depois de confirmar a exclusão, a conta fica bloqueada por 30 dias e então é purgada
(`tarefas.purgar_contas`, migration 0023). Quem desfaz é o próprio profissional, pelo link de
desistência do e-mail, que chama `POST /api/conta/desistir` com o token (desbloqueia, ajusta o
plano e audita `conta.exclusao_desistida`). Verificado no Worker local que a rota existe e recusa
token inválido:

```bash
curl -s -w ' HTTP %{http_code}\n' -X POST http://localhost:8787/api/conta/desistir \
  -H "content-type: application/json" -H "origin: http://localhost:8787" \
  -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
# 400 {"codigo":"link_invalido",...}
```

Não há procedimento manual de operador para desbloquear: a regra de volta ao plano da rota não
deve ser repetida à mão. Depois da purga não há o que reativar (os dados não existem mais).
`[A ESCLARECER: reenvio do link de desistência quando o profissional o perdeu]`
