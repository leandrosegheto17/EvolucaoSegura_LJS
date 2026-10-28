# Runbook de operação

Procedimentos para quem opera o Evolução Segura em produção. Complementa o `README.md` (rodar
local, variáveis, deploy, testar o webhook).

Como ler este documento:

- Cada comando foi executado na máquina de desenvolvimento (Windows, Git Bash, `psql` 16; para o dump do Neon, que é Postgres 18, use `pg_dump` e
  `pg_restore` 18) contra
  o Postgres local do `docker-compose.yml` (porta 5433) num **banco descartável** com as
  migrations aplicadas, ou contra o Worker local (`wrangler dev`). O que depende de conta externa
  (Asaas, Neon, Cloudflare, Resend) está marcado **não executado**, com o motivo.
- Nenhum valor real aparece aqui. `<...>` é um valor que você preenche; ids como
  `00000000-0000-4000-8000-000000000001`, `sub_demo_1` e `evt_demo_1&1` são fictícios.
- No `psql` do Windows as opções (`-c`, `-v`, `-f`) vêm **antes** da URL; depois dela são
  ignoradas e o `psql` abre o modo interativo.

## Conexões

| Para quê                                    | Role                                                 | Onde está a URL                                   |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Funções `tarefas.*` e auditoria (operações) | `evolucao_app`                                       | `NEON_URL_APP` (GitHub Secret do env. `producao`) |
| Diagnóstico e ajustes como dono das tabelas | role de migração (`neondb_owner`) → `evolucao_owner` | `NEON_URL_MIGRACAO`                               |
| Leitura para backup                         | `evolucao_backup_ro`                                 | `NEON_URL_BACKUP`                                 |

### Branches do Neon

O projeto do Neon tem só **duas branches permanentes**; nenhum workflow cria ou apaga branch.

| Branch | Para quê                                           | Variáveis que apontam para ela                                                                                                |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `main` | Produção                                           | `NEON_URL_MIGRACAO`, `NEON_URL_APP` e `NEON_URL_BACKUP` (GitHub Secrets do environment `producao`) e o Hyperdrive de produção |
| `dev`  | Desenvolvimento e ensaio contra o Neon real, à mão | Nenhuma no GitHub; só na sua sessão do terminal, quando precisar                                                              |

O database no Neon se chama **`evolucao`**, nas duas branches: é o caminho de toda URL `NEON_URL_*`
(`.../evolucao?sslmode=require`), do Hyperdrive, do backup e do dump. O `validarUrlNeon` recusa
qualquer outro nome. O Postgres local mantém os nomes próprios: `evolucao_segura` (desenvolvimento,
`docker-compose.yml`), `evolucao_segura_e2e` (e2e) e os bancos temporários dos testes.

O ponto de volta antes de cada migração é o dump cifrado com `age` que o `deploy.yml` guarda como
artefato (seção 5), não uma branch. `DATABASE_URL` é só do Postgres local e dos testes: nunca
aponte para o Neon.

As URLs ficam no environment `producao` do GitHub e no console do Neon; nunca as cole em arquivo
versionado nem em chamado. Exporte numa variável só na sua sessão do terminal, por exemplo
`export URL_APP='<url da role evolucao_app>'`, e feche o terminal ao terminar.

As tabelas do profissional têm RLS forçada, que vale também para a role `evolucao_owner`. Para ler
`webhook_evento` sem passar pela API, assuma `evolucao_owner` e ligue o contexto das funções do webhook
(`app.tarefa_webhook = 'on'`, policies da migration 0014) só dentro de uma transação desfeita no
fim, como nos exemplos abaixo.

Banco descartável usado na verificação (para repetir os exemplos sem tocar no banco de
desenvolvimento):

```bash
U=postgresql://postgres:postgres@localhost:5433
psql -c "create database rb_demo" $U/postgres
DATABASE_URL=$U/rb_demo pnpm migrar
# Worker local apontando para ele (role evolucao_app liberada como no passo 3b do README)
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://evolucao_app:evolucao_app@localhost:5433/rb_demo \
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
set local role "evolucao_owner";
set local app.tarefa_webhook = 'on';
select event_id, tipo, usuario_id, recebido_em, processado_em
from public.webhook_evento order by recebido_em desc limit 20;
rollback;
EOF
```

Localmente, `URL_MIGRACAO=postgresql://postgres:postgres@localhost:5433/rb_demo`. Em produção é
a URL da role de migração; o `set local role "evolucao_owner"` funciona porque a migration 0001 concede
`evolucao_owner` a ela com SET. Contra o Neon: **não executado** (exige acesso ao Neon).

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

Com a role `evolucao_app` (executado no banco descartável):

```bash
psql -X -c "select * from tarefas.localizar_assinatura_asaas('<id da assinatura no Asaas>', null)" "$URL_APP"
```

Sem o id da assinatura, passe `null` no primeiro e o id do cliente (`cus_...`) no segundo
parâmetro. Nenhuma linha: a assinatura não tem esses ids; não siga, investigue a criação.

### 2.2 Levar a assinatura a ativa, com auditoria

O script usa a mesma função do webhook (`tarefas.mudar_estado_assinatura`, migration 0012), com a
máquina de estados do PLANO-01, e o mesmo cálculo do fim do período (dia seguinte ao vencimento,
meia-noite em America/Sao_Paulo). Só grava, e só audita como `admin-cli`, se a função responder
`permitida` e a assinatura não estava em `free`; qualquer outro caso desfaz a transação. Salve
como `reprocessar.sql`:

```sql
\set ON_ERROR_STOP on
begin;
select r.resultado, r.status_anterior,
       r.resultado = 'permitida' and r.status_anterior <> 'free' as mudou
from tarefas.mudar_estado_assinatura(:'usuario'::uuid, 'ativa',
       (:'vencimento'::date + 1)::timestamp at time zone 'America/Sao_Paulo', null) r
\gset
\echo resultado: :resultado (antes: :status_anterior)
\if :mudou
  select set_config('app.usuario_id', :'usuario', true);
  insert into public.audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id, campos_alterados)
  values (:'usuario'::uuid, 'admin-cli', 'assinatura.ativa', 'conta', :'usuario'::uuid,
          case :'status_anterior'
            when 'atrasada' then '{status,periodo_fim,vencimento_atraso}'
            else '{status,periodo_fim}' end::text[]);
  commit;
\else
  rollback;
\endif
```

E rode com a role `evolucao_app` (executado no banco descartável):

```bash
psql -X -q -v usuario=<usuario_id da 2.1> -v vencimento=<nextDueDate AAAA-MM-DD> -f reprocessar.sql "$URL_APP"
```

Resultados possíveis:

- `permitida`: mudou (trial ou atrasada passam a ativa) e o evento `assinatura.ativa` foi
  auditado. Observado: assinatura em `atrasada` foi a `ativa`, `vencimento_atraso` limpo,
  auditoria `{status,periodo_fim,vencimento_atraso}`.
- `permitida (antes: free)`: desfeito de propósito. Ao ir para free, o cron cancela a assinatura
  no Asaas e limpa o id dela (migration 0015, `tarefas/assinaturas.ts`); uma `ativa` feita à mão
  ficaria sem cobrança seguinte e, como o cron nunca vence `ativa`, Pro para sempre. Em free, o
  profissional assina de novo pelo "Meu plano"; se o pagamento dessa assinatura nova não chegou,
  reenvie o evento (seção 1).
- `mesmo_estado`: já estava ativa; nada é gravado (observado ao rodar de novo).
- `transicao_invalida`: por exemplo, `cancelada` não volta a `ativa` (PLANO-01). Nada é gravado.
  Não force: o profissional assina de novo pelo "Meu plano" quando a assinatura estiver em free.
- `inexistente`: o `usuario_id` não tem assinatura.

O e-mail de pagamento confirmado (PLANO-13) **não** é enviado por este caminho; avise o
profissional, se for o caso. Contra o Neon: **não executado** (exige acesso ao Neon).

## 3. Reativar um usuário

"Reativar" cobre três situações diferentes. Identifique qual antes de agir.

### 3.1 Plano Pro em atraso ou em free

- Em `atrasada`, com o pagamento feito: é o reprocessamento da seção 2.
- Em `atrasada`, sem pagamento: o profissional paga o Pix pendente em "Meu plano" (vale também
  dentro dos 7 dias de tolerância); o webhook faz o resto.
- Em `free`: o profissional assina de novo em "Meu plano". Não há reativação manual (seção 2,
  caso `antes: free`).

### 3.2 Login bloqueado por tentativas

Depois de 5 falhas em 15 minutos, o e-mail fica bloqueado por 15 minutos (AUTH-07,
`regras-acesso.ts`); o bloqueio passa sozinho. Para liberar antes, com a role de migração
assumindo `evolucao_owner` (a `tentativa_login` guarda só o SHA-256 do e-mail, em minúsculas). Executado
no banco descartável:

```bash
psql -X -v ON_ERROR_STOP=1 -v email='<e-mail do profissional>' "$URL_MIGRACAO" <<'EOF'
begin;
set local role "evolucao_owner";
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

## 4. Rotacionar segredos

Quando: suspeita de vazamento, saída de alguém com acesso, ou periodicamente. Regra geral: gere
o valor novo, grave no destino, confira que o app funciona e **só então** revogue o antigo no
serviço de origem. Nunca cole o valor em chamado, commit ou log; prefira que o comando leia da
entrada padrão (sem `--body`), para o valor não ficar no histórico do shell.

Comandos comuns (a partir da raiz do repositório):

```bash
# Valor aleatório para HMAC_2FA_SEGREDO e ASAAS_WEBHOOK_TOKEN (64 caracteres)
openssl rand -base64 48

# Segredo do Worker de produção (pede o valor; precisa de login na Cloudflare)
pnpm --filter @es/api exec wrangler secret put <NOME> --config ../../wrangler.jsonc

# Secret do GitHub no environment producao (lê o valor da entrada padrão)
gh secret set <NOME> --env producao
```

O `openssl rand` foi executado (64 caracteres, acima do mínimo de 32 do `ambiente.ts`). A sintaxe
do `wrangler secret put` e do `gh secret set --env` foi conferida com `--help`; a gravação em si
**não foi executada** (exige as contas de produção e mudaria segredos reais).

| Segredo                                        | Onde fica                                           | Como trocar                                                                                                              | Efeito da troca                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HMAC_2FA_SEGREDO`                             | Worker                                              | `openssl rand`, `wrangler secret put`                                                                                    | Códigos de 2FA já enviados deixam de valer; quem estava no meio do login pede outro código.                                                                 |
| `ASAAS_WEBHOOK_TOKEN`                          | Worker e Asaas                                      | `wrangler secret put` e, logo em seguida, o mesmo valor no painel do Asaas (Integrações > Webhooks)                      | Entre os dois passos o webhook responde `401` e o Asaas reenvia; se a fila pausar, reative-a (seção 1).                                                     |
| `ASAAS_API_KEY`                                | Worker                                              | Chave nova no painel do Asaas, `wrangler secret put`, depois revogar a antiga                                            | Nenhum, nessa ordem.                                                                                                                                        |
| `RESEND_API_KEY`                               | Worker                                              | Chave nova no painel do Resend, `wrangler secret put`, depois revogar a antiga                                           | Nenhum, nessa ordem. Sem chave válida os e-mails param, inclusive o de 2FA.                                                                                 |
| `VAPID_PRIVATE_KEY` e `VAPID_PUBLIC_KEY`       | Worker                                              | Gerar o par (abaixo), `wrangler secret put VAPID_PRIVATE_KEY` e a pública como var do Worker                             | PREMISSA: as inscrições de push existentes usam a chave pública antiga e deixam de receber; cada profissional ativa o push de novo. Troque só em vazamento. |
| `NEON_URL_MIGRACAO`, `NEON_URL_BACKUP`         | GitHub (`producao`)                                 | Senha nova da role no console do Neon (Roles > Reset password), `gh secret set`                                          | Deploy e backup usam a URL nova na próxima execução.                                                                                                        |
| `NEON_URL_APP`                                 | GitHub e Hyperdrive                                 | Senha nova da role `evolucao_app` no Neon, `gh secret set NEON_URL_APP --env producao` e atualizar o Hyperdrive (abaixo) | O Worker perde o banco entre a troca da senha e a atualização do Hyperdrive: faça as duas em seguida, fora do horário de uso.                               |
| `CLOUDFLARE_API_TOKEN`                         | GitHub (`producao`)                                 | Token novo no console da Cloudflare, `gh secret set`, depois revogar o antigo                                            | Nenhum, nessa ordem.                                                                                                                                        |
| Par `age` (`AGE_PUBLIC_KEY` e a chave privada) | Pública no GitHub; privada fora de qualquer serviço | `age-keygen`, `gh secret set AGE_PUBLIC_KEY --env producao`                                                              | Backups novos só abrem com a privada nova. **Guarde a antiga por 30 dias** (retenção dos artefatos), senão os backups anteriores ficam ilegíveis.           |

Par VAPID no formato do produto (pública P-256 crua de 65 bytes e privada como o `d` do JWK, em
base64url; `backend/api/src/integracoes/push-vapid.ts`). Executado: gerou chaves de 65 e 32
bytes.

```bash
node --input-type=module -e "const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']); const pub = Buffer.from(await crypto.subtle.exportKey('raw', k.publicKey)).toString('base64url'); const { d } = await crypto.subtle.exportKey('jwk', k.privateKey); console.log('VAPID_PUBLIC_KEY=' + pub); console.log('VAPID_PRIVATE_KEY=' + d);"
```

Par `age` (executado; a chave privada fica num arquivo que nunca vai para o repositório nem para
o GitHub):

```bash
age-keygen -o chave-backup-<AAAA-MM>.txt   # imprime a chave pública (age1...)
age-keygen -y chave-backup-<AAAA-MM>.txt   # mostra a pública de novo, se precisar
```

Hyperdrive depois de trocar a senha da role `evolucao_app` (sintaxe conferida com `--help`; **não
executado**, exige a conta Cloudflare; o id fica em `wrangler.jsonc`, `hyperdrive[0].id`):

```bash
node backend/scripts/src/neon/validar-url.ts NEON_URL_APP && \
  pnpm --filter @es/api exec wrangler hyperdrive update <id do Hyperdrive> --connection-string="$NEON_URL_APP"
```

Depois de qualquer troca no Worker, confira `https://<domínio>/api/health` e um login completo.
**Não executado** em produção.

## 5. Restaurar o backup

### Onde estão as cópias

| Cópia                               | Origem                                                                                                              | Retenção |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| Artefato `backup-<run_id>`          | `backup.yml`: todo dia às 04:00 de Brasília (07:00 UTC), role `evolucao_backup_ro`, `pg_dump -Fc` cifrado com `age` | 30 dias  |
| Artefato `dump-pre-deploy-<run_id>` | `deploy.yml`, antes de cada migração                                                                                | 30 dias  |

Situação observada em 2026-10-28 (`gh run list --workflow backup.yml`): as execuções agendadas do
`backup.yml` **falham** porque os secrets do environment `producao` ainda não existem (o `age`
recebe a chave pública vazia e o `pg_dump` fica sem URL). Não há backup de produção até eles
serem configurados.

### 5.1 Baixar um backup

```bash
gh run list --workflow backup.yml --status success --limit 5
gh run download <run_id> -n backup-<run_id>      # grava backup.dump.age na pasta atual
```

`gh run list` executado (só leitura). `gh run download` **não executado**: ainda não há execução
com sucesso.

### 5.2 Testar o backup antes de usar

Sempre teste o arquivo baixado num Postgres descartável. O `infra/restore-test.sh` restaura,
conta as linhas por tabela, compara com a origem (se informada) e apaga o banco. Executado com um
backup cifrado do banco descartável `rb_demo` (todas as tabelas `OK`, `resultado=ok`):

```bash
U=postgresql://postgres:postgres@localhost:5433
RESTORE_AGE_IDENTITY=chave-backup-<AAAA-MM>.txt RESTORE_SOURCE_URL=<url da origem> \
  RESTORE_ADMIN_URL=$U/postgres infra/restore-test.sh backup.dump.age
```

Sem `RESTORE_SOURCE_URL` ele só conta. Só aceita `localhost` e `127.0.0.1`: nunca aponte
`RESTORE_ADMIN_URL` para produção.

### 5.3 Restaurar produção

Antes: pare o que escreve no banco (o que vier depois do backup será perdido) e anote o horário
do backup escolhido.

O deploy não cria branch no Neon: o ponto de volta de um deploy que deu errado é o artefato
`dump-pre-deploy-<run_id>` daquele deploy (Opção A).

**Opção A: a partir do dump cifrado**, num banco novo e vazio, com a role de migração. Executado
localmente no Postgres do docker-compose (banco `rb_restaurado`, a partir do backup do
`rb_demo`):

```bash
DESTINO='<url do banco novo e vazio, role de migração>'
ORIGEM_URL='<url do banco de onde veio o backup, se ainda existir>'

# 1. Restaurar mantendo os donos (owner) e as permissões das tabelas
age -d -i chave-backup-<AAAA-MM>.txt backup.dump.age | pg_restore --exit-on-error -d "$DESTINO"

# 2. Permissões do próprio banco (o dump de um banco não as leva)
psql -X -v ON_ERROR_STOP=1 "$DESTINO" <<'SQL'
do $$
begin
  execute format('revoke all on database %I from public', current_database());
  execute format('grant connect on database %I to "evolucao_owner", evolucao_app, evolucao_backup_ro', current_database());
end $$;
SQL

# 3. Conferir as contagens contra a origem (sai com 1 se divergir)
infra/comparar-contagens.sh "$ORIGEM_URL" "$DESTINO"
```

Observado localmente: as 34 tabelas do app ficaram com dono `evolucao_owner`, a RLS forçada se manteve, a
role `evolucao_app` conectou e leu a assinatura do usuário definido em `app.usuario_id`, e o
`comparar-contagens.sh` deu `resultado=ok`.

**Opção B: pelo histórico do Neon**, só para um problema dentro da janela de restauração do plano
(PREMISSA: 6 h no Free). No console do Neon, restaure a branch `main` para um instante anterior ao
problema. Se o Neon guardar o estado anterior numa branch extra, apague-a depois de conferir a
restauração: o projeto fica só com `main` e `dev`. **Não executado** (exige a conta do Neon).

Depois, aponte o Worker para o banco restaurado atualizando o Hyperdrive com a URL da role `evolucao_app`
desse banco (comando da seção 4) e confira `/api/health` e um login. **Não executado** em
produção. No Neon a restauração roda com `neondb_owner`, que não é superusuário: as funções do
dump não podem ter `SET app.*` na definição (correção das migrations nas T197 e T198), senão o
passo 1 falha com `permission denied to set parameter`.

### 5.4 Depois de restaurar

- Eventos do Asaas recebidos depois do horário do backup se perderam. No painel do Asaas, liste
  os pagamentos confirmados desde então e reprocesse cada assinatura afetada (seção 2).
- Contas, pacientes e registros criados depois do backup não existem mais: comunique os
  profissionais afetados.
- Registre a restauração (data, backup usado, contagens) no histórico do incidente.

## 6. Pré-requisitos da publicação

Nada abaixo foi feito por este runbook: cada item é decisão e ação do dono do produto, em contas
externas. Marque cada um antes do primeiro `deploy.yml`. A ordem do primeiro deploy, com o login
das roles do Neon e o Hyperdrive, está na seção 8.

### 6.1 Conta do Asaas de produção

- [ ] Conta de produção aprovada no Asaas (dados da empresa e conta bancária).
- [ ] Chave da API de produção gravada no Worker: `wrangler secret put ASAAS_API_KEY` (seção 4).
- [ ] `ASAAS_BASE_URL=https://api.asaas.com/v3` no Worker (no sandbox é
      `https://api-sandbox.asaas.com/v3`; formatos aceitos em `.env.example`).
- [ ] Webhook cadastrado no painel (Integrações > Webhooks): URL
      `https://<domínio>/api/webhooks/asaas`, o mesmo token de `ASAAS_WEBHOOK_TOKEN` e os eventos
      `PAYMENT_CREATED`, `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED` e `PAYMENT_OVERDUE`.
- [ ] Revalidar com um Pix real o que o spike S3 não provou (ADR-009): o evento do Pix pago, a
      reentrega do webhook e o nascimento do ciclo seguinte (`.specs/STATE.md`, spike S3).

**Não executado**: exige a conta de produção do Asaas.

### 6.2 Chave Pix na conta do Asaas

- [ ] Chave Pix cadastrada na conta de produção do Asaas.

Sem chave Pix cadastrada, o QR do Pix que o Asaas gera expira às 23:59 do mesmo dia (design,
riscos, P-4). O app busca o QR na hora de mostrar o "Meu plano" (`GET /api/plano`), então o QR
exibido é sempre o do momento; o risco é o profissional copiar o código e pagar em outro dia.
**Não executado**: exige a conta de produção.

### 6.3 Domínio

- [ ] Subdomínio do app escolhido (spec, D-25). [A ESCLARECER: raiz evolucaosegura.com.br ou
      outro subdomínio, sem colidir com o legado em app.]
- [ ] Rota ou domínio personalizado do Worker configurado na Cloudflare para esse endereço (o
      `wrangler.jsonc` ainda não tem `routes`).
- [ ] `URL_PUBLICA` (variável `vars.URL_PUBLICA` do environment `producao`) com o endereço final,
      `https` e sem barra no fim; o `deploy.yml` a passa ao Worker com `--var`.
- [ ] Remetente `@evolucaosegura.com.br` verificado no Resend (D-27) e `MAIL_FROM` no Worker.

Conferido em 2026-10-28 (só leitura, DNS público):

```bash
nslookup -type=NS evolucaosegura.com.br 8.8.8.8
# nameservers *.ns.cloudflare.com: a zona está na Cloudflare
nslookup -type=TXT resend._domainkey.evolucaosegura.com.br 8.8.8.8
# Non-existent domain: o registro DKIM do Resend ainda não existe
```

O segundo resultado indica que o domínio ainda **não está verificado** no Resend (o Resend pede
um registro TXT `resend._domainkey`; o nome exato vem do painel dele ao adicionar o domínio).
Rota e verificação do domínio: **não executado** (exigem as contas Cloudflare e Resend).

### 6.4 Revisão jurídica

- [ ] Termos de uso e política de privacidade (`/termos` e `/privacidade`, versões
      `VERSAO_TERMOS` e `VERSAO_PRIVACIDADE` em `backend/contrato/src/identidade.ts`) revisados
      por advogado antes de usuários reais. Os textos atuais foram escritos na construção, sem
      revisão.
- [ ] Prazo legal de guarda do prontuário definido (spec); afeta os termos e o texto da exclusão
      de conta. [A ESCLARECER: parecer jurídico sobre 5 anos (CFP 001/2009) × 20 anos (Lei
      13.787/2018)]
- [ ] Se o texto mudar, suba a versão em `identidade.ts` para que o aceite novo seja registrado.

**Não executado**: depende de parecer externo.

## 7. Plano B

### 7.1 Resend: limite de e-mails

O plano gratuito do Resend envia 100 e-mails por dia, e todo login manda um código de 2FA por
e-mail. PREMISSA: os três apps LJS usam a mesma conta do Resend, então o limite é dividido entre
eles.

Como aparece:

- Sentry: um evento de nível `fatal` com a impressão `resend`/`limite` no primeiro `429` de cada
  instância do Worker (`backend/api/src/integracoes/resend.ts`).
- Usuário: o login responde `503 mail_unavailable` ("Não foi possível enviar o código agora") e
  não conta como falha de login; cadastro, recuperação de senha e e-mails de cobrança também não
  saem (os de cobrança só vão ao Sentry, sem desfazer nada).

O que fazer:

1. Confirme no painel do Resend que é o limite (e não chave revogada ou domínio desverificado:
   nesses casos o erro não é `429`; corrija pela seção 4 ou 6.3).
2. Imediato: o envio volta quando a cota do Resend renovar. Avise os profissionais que o login
   pode falhar até lá. Não desligue o 2FA: não há chave para isso e ele é requisito de
   segurança.
3. Se o limite foi atingido por uso legítimo: assine um plano pago do Resend na mesma conta
   (decisão do dono do produto, sai do custo fixo R$ 0). A chave e o domínio continuam os
   mesmos; se a conta mudar, troque `RESEND_API_KEY` (seção 4) e verifique o domínio na conta
   nova.
4. Se foi abuso (muitos pedidos de código, cadastro ou recuperação): confira os 429 do limite por
   IP (OPS-07) e o bloqueio por e-mail (AUTH-07); o Resend volta sozinho quando o abuso para.

Trocar de provedor de e-mail exige mudar `integracoes/resend.ts`: não é plano B imediato, é
tarefa nova. **Não executado**: exige a conta do Resend.

### 7.2 Chave Pix do Asaas

O app cobra só por Pix (`billingType: 'PIX'` em `backend/api/src/integracoes/asaas.ts`); não há
boleto nem cartão como alternativa no código.

- **Chave Pix indisponível** (removida, conta bancária trocada, bloqueio): cadastre outra chave
  (por exemplo, aleatória ou CNPJ) no painel do Asaas. Enquanto isso o QR continua sendo gerado
  sem chave cadastrada e expira no mesmo dia (6.2): oriente o profissional a abrir o "Meu plano"
  e pagar no mesmo dia. PREMISSA: a geração do QR sem chave cadastrada, vista no sandbox (spike
  S3), vale também na produção.
- **Asaas fora do ar**: o "Meu plano" responde `503 cobranca_indisponivel` e o erro vai ao
  Sentry; assinar também falha. Quem está em atraso tem 7 dias de tolerância a partir do
  vencimento (D-21) antes de ir para free, e os eventos que o webhook não recebeu chegam quando o
  Asaas voltar (seção 1).
- **Pagou e a assinatura não voltou** (pagamento feito fora do prazo, durante a falha): siga a
  seção 2. Se a assinatura já foi para free, o profissional assina de novo (seção 3.1).

**Não executado**: exige a conta de produção do Asaas.

## 8. Primeiro deploy: roles do Neon e Hyperdrive

As roles `evolucao_owner`, `evolucao_app` e `evolucao_backup_ro` nascem `NOLOGIN` e sem senha na migration 0001 (ADR-005):
segredo nunca entra em migration. Login e senha são dados depois, à mão, por quem opera o Neon.
Nada desta seção foi executado no Neon nem na Cloudflare (exige as contas); os comandos de banco
foram executados no Postgres local, com uma role que simula o `neondb_owner` (`CREATEROLE` e
`CREATEDB`, sem superusuário), como indicado em cada passo.

Nomes padronizados (2026-10-28): `evolucao_owner`, `evolucao_app` e `evolucao_backup_ro`. Se o
banco já tiver as roles antigas (`owner`, `app`, `backup_ro`) de uma migração anterior, a migration
0024 as renomeia (a senha SCRAM e os privilégios continuam) e as URLs `NEON_URL_APP` e
`NEON_URL_BACKUP` precisam ser regravadas com o usuário novo (8.4). Não crie as roles pelo console
do Neon: as criadas por lá podem vir com `BYPASSRLS`, e a 0024 falha de propósito nesse caso.

### 8.1 Ordem

O primeiro deploy tem uma dependência circular: o `wrangler deploy` precisa do id real do
Hyperdrive no `wrangler.jsonc` (hoje é o placeholder `00000000000000000000000000000000`); o
Hyperdrive só é criado com uma URL que conecta, a da role `evolucao_app`; e a role `evolucao_app` só existe depois
da migration 0001. Por isso o login das roles fica **entre a migração e o deploy do Worker**:

1. **Antes de tudo**: os secrets que não dependem das roles no environment `producao`
   (`NEON_URL_MIGRACAO`, `AGE_PUBLIC_KEY`, `CLOUDFLARE_API_TOKEN`) e as variáveis
   (`CLOUDFLARE_ACCOUNT_ID`, `URL_PUBLICA`), mais os itens da seção 6. `NEON_URL_MIGRACAO` é a URL
   da role de migração (`neondb_owner`) na branch `main`, na **conexão direta** (host sem
   `-pooler`).
2. **Aplicar as migrations** no Neon, da sua máquina, com o mesmo comando que o `deploy.yml` roda
   (cria as três roles `NOLOGIN` e todo o schema):

   ```bash
   read -rs NEON_URL_MIGRACAO && export NEON_URL_MIGRACAO   # cole a URL; nada aparece na tela
   pnpm migrar --alvo producao    # pede o host exato antes de conectar
   unset NEON_URL_MIGRACAO
   ```

   O `pnpm migrar` só vai a um banco remoto com `--alvo producao` (lê `NEON_URL_MIGRACAO`, branch
   `main`) ou `--alvo dev` (lê `NEON_URL_MIGRACAO_DEV`, branch `dev`). Antes de conectar ele
   valida a URL (`validarUrlNeon`: host `*.neon.tech`, sem `-pooler`, `sslmode=require` ou mais
   forte) e pede o host exato digitado; no GitHub Actions, `CI=true` dispensa a digitação. Sem
   `--alvo`, ele usa `DATABASE_URL` e recusa qualquer host que não seja local.

   Rodar o `deploy.yml` neste ponto **não** migra: o passo "Conferir que o cache do Hyperdrive
   está desligado" vem antes do dump e da migração e falha com o id placeholder do
   `wrangler.jsonc`.

3. **Conferir as roles e o pgcrypto** (8.3) e **dar login e senha** a `evolucao_app` e `evolucao_backup_ro` (8.2).
4. **Gravar as URLs** `NEON_URL_APP` e `NEON_URL_BACKUP` no environment `producao` (8.4).
5. **Criar o Hyperdrive** com a URL da `evolucao_app` e pôr o id no `wrangler.jsonc` (8.5); o commit vai
   para a `main` pelo fluxo normal (o id não é segredo).
6. **Rodar o `deploy.yml`** (`gh workflow run deploy.yml --ref main`): a migração não tem nada
   novo e o Worker sobe.
7. **Depois do deploy**: `https://<domínio>/api/health`, um login completo, o teste de fumaça do
   isolamento (seção 9) e um backup à mão para provar a `evolucao_backup_ro`:
   `gh workflow run backup.yml` e, depois, `gh run list --workflow backup.yml --limit 1`.

O roteiro (`roadmap.md`) diz "depois do primeiro deploy" para o provisionamento: leia como
"depois da primeira migração". O passo 5 não pode vir antes do 3.

### 8.2 Login e senha de uma role

A senha nasce num gerenciador de senhas e é colada no terminal sem aparecer na tela; ela nunca
vai para arquivo, commit, chamado ou histórico do shell. Use só letras e números (ela vai dentro
de uma URL; com `/`, `@` ou `:` seria preciso codificar). Se o gerenciador não gerar, gere com
`openssl rand -hex 32` (64 caracteres, 256 bits) e guarde no gerenciador antes de seguir.

Uma vez por role, com a role de migração (que criou as roles na 0001 e por isso pode alterá-las):

```bash
ROLE=evolucao_app     # depois, evolucao_backup_ro
read -rs SENHA_ROLE && export SENHA_ROLE     # cole a senha do gerenciador
if [ "${#SENHA_ROLE}" -lt 32 ]; then
  echo "senha vazia ou curta: nada foi alterado"
else
  psql -X -v ON_ERROR_STOP=1 -v role="$ROLE" "$NEON_URL_MIGRACAO" <<'SQL'
\getenv senha SENHA_ROLE
ALTER ROLE :"role" LOGIN PASSWORD :'senha';
SQL
fi
unset SENHA_ROLE
```

O `\getenv` (psql 15 ou mais novo) lê a senha da variável de ambiente, então ela não aparece na
linha de comando nem no texto do SQL. Executado no Postgres local: a role simulada passou de
`NOLOGIN` a `LOGIN`, com a senha guardada como `SCRAM-SHA-256`, e conectou com ela; com a
variável vazia, nada foi alterado. PREMISSA: o Neon exige senha com pelo menos 60 bits de
entropia para role criada por SQL; os 64 caracteres hexadecimais atendem com folga.

**`evolucao_owner`**: nenhum fluxo de hoje conecta como `evolucao_owner`. O deploy e os procedimentos deste runbook
usam a role de migração e assumem `evolucao_owner` com `SET ROLE` (seção "Conexões"). Dar login a ela é o
mesmo comando com `ROLE=evolucao_owner`, mas abre uma porta que nada usa.
`[A ESCLARECER: dar LOGIN à evolucao_owner ou mantê-la NOLOGIN (decisão do dono do produto)]`

Trocar a senha depois (rotação, seção 4) é o mesmo comando; para a `evolucao_app`, atualize em seguida o
Hyperdrive.

### 8.3 Conferir as roles e o pgcrypto

Depois do passo 2 e de novo depois de 8.2 (executado no Postgres local):

```bash
psql -X -v ON_ERROR_STOP=1 "$NEON_URL_MIGRACAO" <<'SQL'
select rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
from pg_roles where rolname in ('evolucao_owner', 'evolucao_app', 'evolucao_backup_ro') order by 1;
select has_function_privilege('evolucao_owner', 'public.crypt(text, text)', 'execute') as crypt,
       has_function_privilege('evolucao_owner', 'public.gen_salt(text, integer)', 'execute') as gen_salt;
SQL
```

Esperado: as três com `rolsuper`, `rolcreaterole`, `rolcreatedb` e `rolbypassrls` em `f`;
`rolcanlogin` em `t` só nas que receberam login; `crypt` e `gen_salt` em `t` (o hash de senha
roda como `evolucao_owner`, migration 0003). Se algo vier diferente, pare: o login do app falharia ou uma
role teria poder demais.

### 8.4 URLs no GitHub

As URLs são montadas na hora, a partir da conexão **direta** do console do Neon (host sem
`-pooler`: o `backup.yml` recusa o pooler e o spike do Hyperdrive usou a direta), e vão para o
`gh` pela entrada padrão:

```bash
HOST='<host da conexão direta, ep-...neon.tech>'; BANCO=evolucao
read -rs SENHA_ROLE   # senha da evolucao_app
printf '%s' "postgresql://evolucao_app:$SENHA_ROLE@$HOST/$BANCO?sslmode=require" | gh secret set NEON_URL_APP --env producao
read -rs SENHA_ROLE   # senha da evolucao_backup_ro
printf '%s' "postgresql://evolucao_backup_ro:$SENHA_ROLE@$HOST/$BANCO?sslmode=require" | gh secret set NEON_URL_BACKUP --env producao
unset SENHA_ROLE
```

**Não executado** (exige o repositório no GitHub com o environment `producao`).

### 8.5 Criar o Hyperdrive

Com cache **desligado**, como no spike `set-local-hyperdrive`, que mediu o isolamento nessa
condição (sintaxe conferida com `--help` no wrangler 4.152.0; **não executado**, exige a conta
Cloudflare):

```bash
read -rs SENHA_ROLE   # senha da evolucao_app
export NEON_URL_APP="postgresql://evolucao_app:$SENHA_ROLE@$HOST/$BANCO?sslmode=require"
unset SENHA_ROLE
node backend/scripts/src/hyperdrive.ts   # valida NEON_URL_APP e imprime o comando abaixo
pnpm --filter @es/api exec wrangler hyperdrive create evolucao-segura \
  --connection-string="$NEON_URL_APP" --caching-disabled
unset NEON_URL_APP
```

O `hyperdrive.ts` passa a URL por `validarUrlNeon` (Neon, conexão direta, TLS) e sai com 1, sem
imprimir o comando, se ela não servir.

O comando imprime o id: troque o placeholder em `wrangler.jsonc` (`hyperdrive[0].id`). A cada
deploy, o `deploy.yml` consulta esse Hyperdrive na API da Cloudflare
(`backend/scripts/src/operacao/cache-hyperdrive.ts`) e para antes do dump e da migração se a
resposta não trouxer `caching.disabled = true`. O `CLOUDFLARE_API_TOKEN` precisa da permissão de
leitura do Hyperdrive, além da de deploy do Worker. Não
altere o `sslmode` da URL (o spike viu que o `pg` trata `require` como `verify-full`, sem efeito
no resultado).

## 9. Teste de fumaça do isolamento no Hyperdrive

Quando: depois do primeiro deploy (passo 7 da seção 8.1) e depois de qualquer mudança no
Hyperdrive, no `db.ts` ou na versão do `pg`. Por quê: o teste de isolamento do CI roda contra o
Hyperdrive local, sem o pooler real; a garantia de que o contexto `app.usuario_id` não passa de
uma requisição para outra numa conexão reaproveitada veio do spike e precisa ser repetida em
produção (ADR-005).

O teste repete o do spike: 1.000 requisições, 20 por vez, alternando duas contas. Cada uma lê
`GET /api/perfil`, que só devolve a linha do profissional do contexto (RLS forçada). Se o
contexto vazasse, a resposta traria o nome da outra conta ou nenhum perfil. Rotas autenticadas
não passam pelo limite por IP (`middleware/limite.ts`), então as 1.000 requisições não dão `429`.

### 9.1 Preparar

1. Crie duas contas de teste pelo próprio app, com e-mails que você controla, e salve o perfil de
   cada uma com um nome que não se repete em nenhum outro lugar, por exemplo `Fumaca A` e
   `Fumaca B` (sem acento, para a comparação ser literal).
2. Entre nas duas contas, cada uma num perfil de navegador diferente, e copie o valor do cookie
   `__Host-sid` de cada uma (ferramentas do desenvolvedor > Aplicativo > Cookies). Esse valor é
   uma sessão viva: trate como senha e nunca o grave em arquivo. A sessão vence com 15 minutos
   sem uso; rode o teste logo em seguida.

### 9.2 Rodar

Salve como `fumaca.sh` fora do repositório (não tem segredo, mas não é código do produto):

```bash
#!/usr/bin/env bash
# Duas sessões alternadas, em ondas paralelas; cada resposta precisa ser do próprio dono.
set -u
: "${BASE:?}" "${SID_A:?}" "${SID_B:?}" "${NOME_A:?}" "${NOME_B:?}"
N="${N:-1000}"; P="${P:-20}"
uma() {
  local sid=$SID_B meu=$NOME_B outro=$NOME_A corpo
  if (( $1 % 2 == 0 )); then sid=$SID_A meu=$NOME_A outro=$NOME_B; fi
  corpo=$(curl -s -w '|%{http_code}' -H "cookie: __Host-sid=$sid" "$BASE/api/perfil")
  if [[ "$corpo" != *'|200' ]]; then echo "http_${corpo##*|}"
  elif [[ "$corpo" == *"\"nome\":\"$outro\""* ]]; then echo VAZOU
  elif [[ "$corpo" == *"\"nome\":\"$meu\""* ]]; then echo ok
  else echo sem_nome; fi
}
{
  for (( i = 1; i <= N; i++ )); do
    uma "$i" &
    (( i % P == 0 )) && wait
  done
  wait
} | sort | uniq -c
```

E rode (o script só imprime contagens, nunca o corpo nem o cookie):

```bash
read -rs SID_A; read -rs SID_B      # cole os dois cookies, um de cada vez
BASE='https://<domínio>' NOME_A='Fumaca A' NOME_B='Fumaca B' SID_A="$SID_A" SID_B="$SID_B" bash fumaca.sh
unset SID_A SID_B
```

### 9.3 Ler o resultado

| Saída                    | Significa                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1000 ok`, e nada mais   | Passou.                                                                                                                                             |
| qualquer `VAZOU`         | Uma conta leu o perfil da outra: **vazamento de contexto**. Não libere o app para usuários reais; abra um incidente de isolamento e guarde a saída. |
| qualquer `sem_nome`      | Resposta `200` sem o nome esperado: o contexto pode ter chegado vazio ou errado. Trate como vazamento até provar o contrário.                       |
| `http_401`               | A sessão venceu ou o cookie foi colado errado; entre de novo e repita.                                                                              |
| `http_404`               | A conta não tem perfil salvo (passo 1 de 9.1). Se o perfil existe, o contexto chegou vazio: trate como `sem_nome`.                                  |
| `http_5xx` ou `http_000` | Erro no Worker ou na rede; veja o Sentry e repita. Não conta como aprovado.                                                                         |

Depois: saia das duas contas (encerra as sessões) e peça a exclusão delas pelo app (a purga roda
30 dias depois, seção 3.3). Registre a data e a saída em 9.4.

Verificação do próprio script, no Worker local (`wrangler dev`, Hyperdrive local, sem o pooler
real), contra um banco descartável com duas contas e duas sessões semeadas: `1000 ok` em 42 s;
com os nomes trocados de propósito, `20 VAZOU` em 20; com um cookie inválido, `5 http_401` e
`5 ok`. Isso prova que o script detecta o vazamento, não que o Hyperdrive real isola.

### 9.4 Registro

| Data | Deploy (`run_id`) | Resultado |
| ---- | ----------------- | --------- |

**Pendente**: o teste em produção depende do primeiro deploy, que ainda não foi feito.
