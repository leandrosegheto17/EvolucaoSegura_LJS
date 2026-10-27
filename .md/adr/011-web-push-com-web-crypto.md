# ADR-011: Web Push com Web Crypto

- **Status**: Aceito
- **Data**: 2026-10-27
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), PUSH-05 a PUSH-08; [design](../../.specs/features/evolucao-segura/design.md), Tech Decisions (linha do push) e etapa 13 ("011 Web Push com Web Crypto"); spike [push-worker](../../.specs/spikes/push-worker/registro.md); AD-004; tarefas T142, T176 e T177

## Contexto

O produto envia notificações push (lembrete de sessão, evolução pendente, cobrança e fim do trial) a partir do Worker, que não tem as APIs de criptografia do Node usadas pela biblioteca `web-push`. A spec pede o JWT VAPID ES256 assinado com `crypto.subtle` e o envio em lotes com `ctx.waitUntil` (PUSH-07). O spike push-worker (2026-10-24) mostrou que `@block65/webcrypto-web-push` 2.0.0 cifra no workerd e o Chrome decifra, mas o JWT VAPID que a biblioteca monta é recusado pelo FCM (403 `invalid JWT provided`) por levar a claim `iat`.

## Decisão

- **Cifra da biblioteca**: só `encryptNotification` de `@block65/webcrypto-web-push` 2.0.0 (RFC 8291, `aes128gcm`, Web Crypto). A mensagem vai cifrada como JSON `{titulo, corpo, url}`, para o service worker abrir a tela certa (PUSH-08). Código: `backend/api/src/integracoes/push.ts`.
- **JWT VAPID próprio**: ES256 com `crypto.subtle`, claims `aud` (origem do endpoint), `exp` (agora + 12 h) e `sub` (contato), sem `iat`; cabeçalho `Authorization: vapid t=<jwt>, k=<chave pública>` (RFC 8292). Código: `backend/api/src/integracoes/push-vapid.ts`. Não se usa o `vapidHeaders` nem o `buildPushPayload` da biblioteca.
- **Assinatura morta**: 404 ou 410 do serviço removem a `push_subscription` (PUSH-06). 201 não prova entrega; as demais respostas e o erro de rede não removem nada.
- **Lotes**: `enviarEmLotes` (`backend/api/src/integracoes/push-lotes.ts`) entrega todo o envio a um único `ctx.waitUntil`; dentro dele os lotes vão em sequência, com até 6 envios simultâneos por lote (PREMISSA: limite de conexões de saída de uma execução do Worker). Um envio com erro vai ao Sentry e não impede os demais.
- **Conteúdo**: quem monta a mensagem não põe nome de paciente nem texto clínico (PUSH-05); a notificação aparece na tela bloqueada.

## Consequências

- Se a biblioteca corrigir o `iat` numa versão futura, o produto não depende disso; atualizar continua sendo decisão do usuário (`/atualizacoes`).
- Só o FCM (Chrome) foi testado de verdade no spike; Firefox, Safari no iOS (PWA instalado) e Edge ficam para o teste manual antes de publicar (PUB-04).
- A CPU por envio não foi medida no Free; medir depois do primeiro deploy, junto com o lote do cron (ADR-010).
- As chaves VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) são segredos do Worker; sem elas o push fica desligado.
