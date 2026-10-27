# Resultado do spike: Asaas sandbox (cliente, assinatura Pix, QR Code, webhook)

- **Data**: 2026-10-27 · **Início** 10:55 · **Fim** cerca de 11:25 (limite 13:55) · **Tentativas**: 1 de 3
- **Veredito**: SIM COM RESSALVAS
- **Confiança**: média. Pesa contra: o pagamento NÃO foi um Pix real nem o botão do painel (o usuário não achou o botão); foi simulado por `POST /v3/payments/{id}/receiveInCash` (recebimento em dinheiro), autorizado só no sandbox. O evento real de um Pix pago (`pixTransaction`, `PAYMENT_CONFIRMED`) pode diferir. O ciclo seguinte da assinatura não foi observado. A reentrega do webhook não ocorreu, então a idempotência por id do evento é inferida, não provada.

Todos os dados abaixo são fictícios (sandbox). Nenhuma chave ou token foi gravado.

## 1. Cliente (POST /customers), 2 execuções OK
- Só `name` é obrigatório (sem `name`: 400 `invalid_name`).
- CPF é opcional na criação: cliente sem `cpfCnpj` foi criado (200).
- CPF com dígito verificador inválido: 400 `invalid_object` "O CPF/CNPJ informado é inválido." CPF válido: 200, `personType: "FISICA"`.
- Resposta: `{object:"customer", id:"cus_000009700882", name, cpfCnpj:"12345678909", personType, email:null, ...}`.

## 2. Assinatura (POST /subscriptions), 2 execuções OK
- Corpo: `{customer, billingType:"PIX", value:19.90, cycle:"MONTHLY", nextDueDate:"2026-10-30", description}`. Resposta 200, `status:"ACTIVE"`.
- Cliente SEM CPF/CNPJ: 400 `invalid_object` "Para criar esta cobrança é necessário preencher o CPF ou CNPJ do cliente." Logo, assinar exige CPF/CNPJ (premissa da spec confirmada).
- A resposta traz `nextDueDate` = vencimento do CICLO SEGUINTE (2026-11-30), não o que foi enviado; a primeira cobrança nasce de imediato com o `dueDate` enviado (2026-10-30).

## 3. Cobrança e QR Code, 2 execuções OK
- GET /subscriptions/{id}/payments lista a 1ª cobrança (`status:"PENDING"`, `billingType:"PIX"`, `subscription`, `dueDate`, `value`, `netValue` 18,91, `invoiceUrl`).
- GET /payments/{id}/pixQrCode: 200 `{success:true, encodedImage:<PNG base64, ~1,1 mil caracteres>, payload:"0002010102122682...", expirationDate:"2027-10-30 23:59:59", description}`. Funcionou SEM eu cadastrar chave Pix: o payload usa a chave dinâmica do Asaas (`pix-h.asaas.com/qr/cobv/<uuid>`). A expiração do QR é de cerca de 1 ano após o vencimento. O recebedor no payload é o nome da conta (dado real, não reproduzido).

## 4. Pagamento (simulado)
- O sandbox não tem endpoint de simulação de Pix. Foi usado `POST /payments/{id}/receiveInCash` com `{paymentDate:"2026-10-27", value:19.90, notifyCustomer:false}`: 200 nas 2 cobranças, na primeira tentativa, mesmo sendo cobrança Pix de assinatura. Resultado: `status:"RECEIVED_IN_CASH"`, `paymentDate` e `clientPaymentDate` preenchidos, `netValue` 19,9 (sem taxa).

## 5. Webhook (POST /webhooks e entrega)
- Criação: `{name, url, email, enabled, interrupted:false, apiVersion:3, authToken, sendType:"SEQUENTIALLY", events:[...]}`. 200; a resposta mostra `hasAuthToken:true` e ECOA o `authToken` (redigir logs). Exige `email`.
- Entrega: POST com `Content-Type: application/json`, `User-Agent: Asaas_Hmlg/3.0` (sandbox) e cabeçalho `asaas-access-token` igual ao configurado (conferido). Chegou em cerca de 1 s. O Worker respondeu 200 e não houve reentrega.
- Eventos vistos: `PAYMENT_CREATED` (ao criar a assinatura, um por cobrança) e `PAYMENT_RECEIVED` (ao receber). `PAYMENT_CONFIRMED` é aceito na lista de eventos, mas NÃO chegou neste caminho (receiveInCash); para Pix real a documentação indica PAYMENT_RECEIVED, não verificado aqui.
- Formato (fictício):
```json
{"id":"evt_d26e303b238e509335ac9ba210e51b0f&23477397","event":"PAYMENT_RECEIVED","dateCreated":"2026-10-27 11:17:46",
 "account":{"id":"<uuid>","ownerId":null},
 "payment":{"object":"payment","id":"pay_ykskkgoe37uu9og9","customer":"cus_000009700882","subscription":"sub_58a47vh52dgm4omd",
  "value":19.9,"netValue":19.9,"billingType":"PIX","status":"RECEIVED_IN_CASH","dueDate":"2026-10-30",
  "paymentDate":"2026-10-27","clientPaymentDate":"2026-10-27","pixTransaction":null,"invoiceUrl":"https://sandbox.asaas.com/i/..."}}
```
- Id do evento: `evt_<hash>&<sequencial>`. O hash foi idêntico nos dois PAYMENT_RECEIVED (e nos dois PAYMENT_CREATED) e o sufixo sequencial mudou entre eventos (23477397 e 23477402). Reentrega não foi observada; é preciso assumir que mantém o id completo (PREMISSA) e deduplicar pelo id inteiro.
- O payload NÃO traz a próxima data de vencimento: obtê-la com GET /subscriptions/{subscription} (`nextDueDate`, `status`). Após o pagamento continuou 2026-11-30 e a assinatura `ACTIVE`, com 1 cobrança só (a do ciclo seguinte não foi gerada no sandbox no tempo do spike).

## Erros e surpresas
- `status` no pagamento simulado é `RECEIVED_IN_CASH`, não `RECEIVED`; o consumidor deve decidir pelo `event`, não pelo `status`. Em Pix real o `status` esperado é `RECEIVED` (não verificado).
- Todo erro vem como `{errors:[{code, description}]}` com HTTP 400.

## Limpeza (confirmada)
Webhook do sandbox removido (DELETE 200, listagem com 0). Worker `es-spike-asaas-hook` apagado (`wrangler delete`, o que remove seus secrets). KV `es-spike-asaas-hooks` apagado (listagem sem o prefixo es-spike). A URL do workers.dev responde 404. Restam no sandbox 3 clientes e 2 assinaturas de teste (dados falsos).
