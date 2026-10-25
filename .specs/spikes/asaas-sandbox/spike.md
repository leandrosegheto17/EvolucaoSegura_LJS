# Spike: o sandbox do Asaas cria cliente com CPF, assinatura mensal por Pix com QR Code e entrega o webhook de pagamento autenticado por token, como descreve a documentação?

- **Slug**: asaas-sandbox · **Data**: 2026-10-24
- **Chamado por**: tarefa T14 (spike S3) de `.specs/features/evolucao-segura/tasks.md`; premissa "Assinar exige CPF/CNPJ" da spec
- **Usar em**: tarefas T127 a T131 (cliente Asaas, assinar, webhook), ADR-009 e premissa de CPF/CNPJ na spec
- **Preparação aprovada**: pendente

## Pergunta

No sandbox, o fluxo cliente (nome e CPF) → assinatura mensal de R$ 19,90 por Pix → QR Code da primeira cobrança → pagamento simulado → webhook `PAYMENT_RECEIVED` (ou `PAYMENT_CONFIRMED`) com cabeçalho `asaas-access-token` funciona de ponta a ponta? (sim/não)

- **Por que importa**: é o núcleo do PLANO-05 a PLANO-09. Campos exigidos, nomes de evento e formato do payload definem o contrato do código.
- **Por que é spike**: motivo 2. O comportamento real do sandbox (campos obrigatórios, QR sem chave Pix, eventos enviados, reenvio) só se conhece testando.

## Critério de sucesso (congelado na aprovação)

- **Deu certo**: os 5 passos completam; o webhook chega com o token configurado; o payload traz `event`, id do pagamento, id da assinatura e próxima data de vencimento (ou forma de obtê-la); repetir o evento com o mesmo id é identificável para idempotência.
- **Deu errado**: algum passo impossível no sandbox (ex.: assinatura Pix sem QR, webhook sem token, evento de pagamento ausente).
- **Inconclusivo**: um passo só funciona com ajuste manual no painel, ou o webhook não é entregue por motivo de rede do teste.
- **Resultado que provaria que não**: a API recusar assinatura com `billingType: PIX` ou o webhook não trazer o token.
- **Condições da medição**: conta sandbox do Asaas, dados falsos (CPF de teste válido), webhook recebido por um Worker de teste em `workers.dev` (ou túnel local), cada passo executado 2 vezes.

## Prazo e método

- **Prazo**: 3 horas e 3 tentativas, o que vier primeiro
- **Início**: <gravado ao despachar> · **Limite**: <início + 3 h>
- **Extensão**: nenhuma
- **Método**: (1) Script Node com `fetch` para criar cliente, assinatura e buscar o QR. (2) Endpoint que grava os webhooks recebidos. (3) Simular o pagamento pelo sandbox e capturar o payload. (4) Anotar campos obrigatórios, erros e eventos.
- **Onde roda**: `.specs/spikes/asaas-sandbox/codigo/`
- **Ações externas**: conta sandbox do Asaas (criada pelo usuário); chave da API do sandbox só em variável de ambiente; Worker de teste ou túnel para receber o webhook. Cada uma com confirmação específica.

## A esclarecer

- [A ESCLARECER: conta sandbox do Asaas. O usuário decidiu em 2026-10-24 deixar para depois. Critério e prazo aprovados; o spike não começa sem a conta. Bloqueia a etapa 12, não as etapas 2 a 11.]
