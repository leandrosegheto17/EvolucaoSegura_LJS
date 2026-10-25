# Registro do spike: um Worker envia Web Push cifrado com VAPID ES256 usando `@block65/webcrypto-web-push` e o navegador mostra a notificação?

- **Slug**: push-worker · **Data**: 2026-10-24 · **Chamado por**: tarefa T15 (spike S4) de `.specs/features/evolucao-segura/tasks.md` · **Usar em**: tarefa T142 (`backend/api/src/integracoes/push.ts`) e ADR-011
- **Veredito**: sim com ressalvas (a cifra da biblioteca funciona no Worker e o Chrome exibe a notificação, mas o JWT VAPID da biblioteca é recusado pelo FCM por causa da claim `iat`; é preciso assinar o JWT por conta própria, sem `iat`)
- **Confiança**: média. Pesam a favor: inscrição e Chrome reais, FCM real, causa isolada por comparação com a biblioteca de referência, 5 de 5 exibidas. Pesam contra: só o FCM (Chrome) foi testado, não Firefox, Safari/iOS nem Edge; uma só máquina; CPU por envio não medida.
- **Destino do código**: descartado (2026-10-24)

## Resposta

Sim, com uma correção obrigatória. A biblioteca carrega e cifra no workerd e o corpo cifrado é aceito e decifrado pelo Chrome (5 de 5 notificações com o texto certo, 201 do FCM). O `Authorization` que a biblioteca monta, porém, é recusado pelo FCM (403 `invalid JWT provided`) porque inclui a claim `iat`. Com o JWT assinado por `crypto.subtle` apenas com `aud`, `exp` (12 h) e `sub`, os envios passam. O critério de CPU (até 3 ms) ficou sem medida confiável: registrado só como estimativa (a cifra e a assinatura rodam em Web Crypto nativo; a medição real fica para a T142 no Worker publicado).

## Método e resultado

- **Método**: Worker em `wrangler dev` com Chrome real; comparação com `web-push` 3 para isolar a causa; 5 envios com a correção.
- **Medições principais**: 403 sem a correção, 201 e 5 de 5 exibidas com ela (detalhe em `resultado.md`).
- **Tempo gasto**: cerca de 40 minutos de 2 horas.

## Explicações concorrentes e sem resposta

- Outros serviços de push (Mozilla autopush, Apple) podem exigir ou rejeitar outras claims; só o FCM foi testado. Safari no iOS (PWA instalado) é caminho crítico para o PUB-04 e precisa de teste próprio.
- Não se mediu a CPU por envio no Free. A assinatura ECDSA e a cifra AES-GCM em Web Crypto devem ser baratas, mas é suposição.
- A biblioteca pode corrigir o `iat` em versão futura; o código do produto não deve depender disso.

## Riscos descobertos

| Risco | Impacto | O que fazer |
|---|---|---|
| FCM recusa JWT com `iat` (biblioteca 2.0.0) | alto se ignorado: nenhum push chega ao Chrome | Na T142, assinar o JWT próprio sem `iat` (cerca de 10 linhas) e usar só a cifra da biblioteca; teste que confere as claims do JWT; ADR-011 registra a decisão |
| Windows com notificações do sistema desligadas parece "push quebrado" | baixo | Runbook e instrução do app: conferir as notificações do sistema |
| 201 do serviço não prova entrega | médio | Não tratar 201 como entrega; só remover a inscrição em 404 e 410 (PUSH-06) |
| Safari/iOS e Firefox sem teste | médio | Teste manual de PWA instalado no iOS antes de publicar (PUB-04) |

## Trechos de referência (não copiar: reescrever com testes)

- Cifra: `buildPushPayload({ data, options: { ttl } }, subscription, vapid)` devolve `{ headers, body, method }`; `vapid.publicKey` é a chave pública P-256 crua em base64url e `vapid.privateKey` é o `d` do JWK em base64url.
- JWT próprio: `ES256`, claims `{ aud: origem do endpoint, exp: agora + 12 h, sub: "mailto:..." }`, sem `iat`; cabeçalho `Authorization: vapid t=<jwt>, k=<chave pública>`.

## Links

- README de `@block65/webcrypto-web-push` 2.0.0 e `web-push` 3 (biblioteca de referência), consultados em 2026-10-24 (ver `design.md`, fonte [P-7])
