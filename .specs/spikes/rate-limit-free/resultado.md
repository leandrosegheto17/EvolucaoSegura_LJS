# Resultado: rate-limit-free

- **Situação**: concluído
- **Tempo gasto**: cerca de 5 minutos (21:55 a 22:00) de 1 hora · **Tentativas**: 1 de 2

## O que foi feito

1. Worker mínimo `es-spike-ratelimit` (`index.js`) com o binding `RL` (`namespace_id` 1001, `simple { limit: 10, period: 60 }`), respondendo 200 se `success` e 429 se não.
2. `npx wrangler deploy` na conta Cloudflare Free do usuário (wrangler 4.152.0): aceito sem erro, saída "env.RL (10 requests/60s) Rate Limit".
3. `node medir.mjs`: 3 rodadas de 15 requisições seguidas da mesma chave, 120 s entre rodadas, de uma só máquina.
4. `npx wrangler delete --name es-spike-ratelimit --force`: "Successfully deleted". A sessão confirmou depois que a URL responde 404.

Sem diferença em relação ao método planejado.

## Medições

| Medição | Valor | Condições | Comando | Conferida pela sessão |
|---|---|---|---|---|
| Deploy com binding `ratelimits` no Free | aceito, sem erro | conta Free, wrangler 4.152.0 | `npx wrangler deploy` | não reproduziu (relato do agente; configuração e script conferidos na pasta) |
| Rodada 1 (00:55:57 UTC) | 200 ×11, depois 429 ×4 | 15 requisições seguidas, chave fixa | `node medir.mjs` | não reproduziu |
| Rodada 2 (00:57:58 UTC) | 200 ×11, depois 429 ×4 | idem | `node medir.mjs` | não reproduziu |
| Rodada 3 (00:59:58 UTC) | 200 ×11, depois 429 ×4 | idem | `node medir.mjs` | não reproduziu |

A sessão não repetiu a medição porque o Worker já tinha sido apagado, como o plano previa; repetir exigiria publicar de novo (nova ação externa). Os três resultados são idênticos entre si.

## Observações

- **Surpresas**: a recusa começou na 12ª requisição; passaram 11, não 10. Provável contagem aproximada do binding. Não investigado.
- **Obstáculos**: nenhum.
- **Comportamentos inesperados**: limite efetivo de 11 por 60 s com `limit: 10`.
- **Esforço real**: bem menor que a hora prevista.
- **Perguntas novas**: nenhuma que justifique outro spike.
