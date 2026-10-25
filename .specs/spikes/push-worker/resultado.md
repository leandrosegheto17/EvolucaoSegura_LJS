# Resultado: push-worker

- **Situação**: concluído
- **Tempo gasto**: cerca de 40 minutos (22:21 a ~23:00) de 2 horas · **Tentativas**: 2 de 3 (abordagem 1: biblioteca como vem, recusada pelo Google; abordagem 2: cifra da biblioteca com JWT assinado sem `iat`)

## O que foi feito

1. Worker de teste (`wrangler dev`, workerd local) com `@block65/webcrypto-web-push` 2.0.0 e `nodejs_compat`, página `http://localhost:<porta>` com service worker (handlers `push` e `notificationclick`), chaves VAPID geradas para o teste.
2. `GET /teste-carga`: a biblioteca carrega e cifra no workerd (payload cifrado de 4096 bytes, sem rede).
3. Inscrição real do Chrome do usuário e envio pela biblioteca como vem: o Google (FCM) respondeu `403 permission denied: invalid JWT provided`, também depois de trocar o `subject` do VAPID (descartou o `subject`).
4. Isolamento da causa com a mesma inscrição e as mesmas chaves: a biblioteca de referência `web-push` 3 recebeu 201; o corpo cifrado da biblioteca com o `Authorization` do `web-push` recebeu 201; o `Authorization` da biblioteca com o mesmo corpo recebeu 403. As claims diferem em uma só coisa: a biblioteca inclui `iat`; o `web-push` não. Assinando um JWT próprio com as claims `aud`, `exp` e `sub` (sem `iat`): 201; com `iat`: 403.
5. Worker com a correção (JWT assinado por `crypto.subtle` sem `iat`, substituindo o `Authorization` da biblioteca): 5 envios, 5 respostas 201.
6. Primeira rodada de exibição: nenhuma notificação apareceu, inclusive para a biblioteca de referência. Causa: as notificações do Windows estavam desligadas (`ToastEnabled = 0`). O usuário as ligou.
7. Segunda rodada: 5 de 5 notificações exibidas com o texto certo.

## Medições

| Medição | Valor | Condições | Comando | Conferida pela sessão |
|---|---|---|---|---|
| Biblioteca carrega e cifra no workerd | sim, 4096 bytes | `wrangler dev`, subscription falsa | `curl http://localhost:8798/teste-carga` | sim |
| Envio pela biblioteca como vem | 403 `invalid JWT provided` | Chrome real, FCM | `curl -X POST .../enviar?n=1` | sim |
| Envio com cifra da biblioteca + JWT sem `iat` | 201 nos 5 envios | Chrome real, FCM, Worker em workerd local | `curl -X POST "http://localhost:8797/enviar?n=<k>"` (k de 1 a 5) | sim |
| Notificações exibidas | 5 de 5, texto certo | Chrome no Windows, notificações do Windows ligadas | contagem do usuário | sim (resposta do usuário) |
| JWT com `iat` vs sem `iat` | 403 vs 201 | mesma inscrição, mesmo corpo | `node diagnostico2.mjs` | sim |
| CPU por envio | não medida de forma confiável | `performance.now()` no workerd só avança em I/O; sem deploy de teste | — | não medida |

## Observações

- **Surpresas**: o FCM rejeita JWT VAPID com a claim `iat`; a biblioteca 2.0.0 sempre a inclui.
- **Obstáculos**: notificações do Windows desligadas; o `wrangler dev` deixa o `workerd` filho vivo quando o pai é encerrado por `timeout`; uma segunda cópia ocupava a porta 8799.
- **Comportamentos inesperados**: a primeira exibição "falhou" sem erro algum; o 201 do serviço não prova entrega.
- **Esforço real**: maior que o previsto por causa do diagnóstico do JWT e do ambiente do Windows.
- **Perguntas novas**: custo real de CPU por envio no Free (precisa de deploy de teste ou medir na T142).
