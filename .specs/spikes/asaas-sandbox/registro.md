# Registro do spike: o sandbox do Asaas cria cliente com CPF, assinatura mensal por Pix com QR Code e entrega o webhook de pagamento autenticado por token?

- **Slug**: asaas-sandbox · **Data**: 2026-10-27 · **Chamado por**: tarefa T14 (spike S3) de `.specs/features/evolucao-segura/tasks.md` · **Usar em**: tarefas T127 a T131, ADR-009 e premissa de CPF/CNPJ
- **Veredito**: sim com ressalvas
- **Confiança**: média. O pagamento foi simulado por `receiveInCash`, não por Pix real nem pelo botão do painel; a reentrega e o ciclo seguinte não foram observados.
- **Destino do código**: descartado (2026-10-27)

## Resposta

Sim. Cliente, assinatura PIX de R$ 19,90, QR Code (sem chave Pix cadastrada) e webhook com `asaas-access-token` funcionaram, cada passo 2 vezes. O evento de pagamento recebido foi `PAYMENT_RECEIVED`.

## O que mudar

- **Premissa de CPF/CNPJ**: confirmada. O cliente nasce sem CPF, mas a assinatura é recusada (400) sem CPF/CNPJ; o Asaas recusa CPF com dígito inválido.
- **T127 (cliente)**: só `name` é obrigatório; enviar `cpfCnpj`. Mapear erros `{errors:[{code,description}]}`.
- **T128/T129 (assinar, QR)**: `POST /subscriptions` com `billingType:"PIX"`, `cycle:"MONTHLY"`, `value:19.90`, `nextDueDate`; depois listar `/subscriptions/{id}/payments` e buscar `/payments/{id}/pixQrCode` (`encodedImage`, `payload`, `expirationDate`). `User-Agent` obrigatório.
- **T130/T131 (webhook)**: validar `asaas-access-token` em tempo constante, responder 2xx rápido, tratar `PAYMENT_RECEIVED` (aceitar `PAYMENT_CONFIRMED` por segurança), deduplicar pelo `id` inteiro do evento (`evt_...&N`), ler `payment.id`, `payment.subscription` e `payment.dueDate`. A próxima data de vencimento vem de `GET /subscriptions/{id}` (`nextDueDate`), não do payload. Não depender de `payment.status` ser `RECEIVED`.
- **ADR-009**: registrar a lacuna (Pix real e ciclo seguinte não observados) e revalidar com Pix real antes da primeira liberação. Logs devem redigir `authToken` (a API o ecoa).

## Riscos

| Risco | Impacto | O que fazer |
|---|---|---|
| Pix real pode emitir evento ou status diferente do simulado | médio | Teste de aceite com Pix real antes da liberação; consumidor tolerante |
| Reentrega com id diferente (não observada) | médio | Idempotência também por `payment.id` + `event` |
| Ciclo seguinte não observado | médio | Cron de assinaturas vencidas (T170) como rede de segurança |

Detalhes e payloads em `resultado.md`.
