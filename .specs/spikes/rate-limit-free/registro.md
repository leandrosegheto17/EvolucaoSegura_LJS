# Registro do spike: o binding `ratelimits` do Worker funciona no plano Free e bloqueia a 11ª requisição em 60 segundos?

- **Slug**: rate-limit-free · **Data**: 2026-10-24 · **Chamado por**: tarefa T13 (spike S2) de `.specs/features/evolucao-segura/tasks.md` · **Usar em**: tarefa T43 (`backend/api/src/middleware/limite.ts`) e ADR-006
- **Veredito**: sim com ressalvas (o binding funciona no Free; o limite efetivo foi 11, não 10)
- **Confiança**: média. Três rodadas idênticas e conta Free real pesam a favor. Pesam contra: uma só máquina e uma só localização, medição não reproduzida pela sessão (Worker já apagado) e o desvio de 1 requisição não investigado.
- **Destino do código**: descartado (2026-10-24)

## Resposta

Sim. O deploy no plano Free aceitou o binding `ratelimits`. Nas 3 rodadas, as 10 primeiras passaram, a 11ª também passou e as 4 seguintes (12ª a 15ª) foram recusadas, ou seja, 4 das 5 restantes, no limite exato do critério ("deu certo"). Decisão para o ADR-006: usar o binding como mecanismo do OPS-07, tratando o limite como aproximado (±1) e mantendo o bloqueio forte de login (AUTH-07) em tabela.

## Método e resultado

- **Método**: Worker mínimo com o binding, publicado em workers.dev, 3 rodadas de 15 requisições, apagado ao fim.
- **Medições principais**: 11 passes e 4 recusas em cada uma das 3 rodadas (detalhe em `resultado.md`).
- **Tempo gasto**: cerca de 5 minutos de 1 hora.

## Explicações concorrentes e sem resposta

- A 11ª requisição pode ter passado por contagem aproximada do binding, por relógio de janela ou por diferença entre locais da Cloudflare. O spike não distingue.
- Não mede o comportamento com tráfego de vários IPs ou vários locais (o binding conta por localização).
- Os testes automatizados do Worker (`vitest-plugin`) usam o binding simulado do miniflare, que pode contar diferente; o teste do OPS-07 não deve depender do número exato de passes em produção.

## Riscos descobertos

| Risco | Impacto | O que fazer |
|---|---|---|
| Limite efetivo ±1 e por localização | baixo | Aceitar; o teste de aceite do OPS-07 usa o simulado e o ADR-006 registra a aproximação |
| Comportamento do binding pode mudar no Free | baixo | Manter a alternativa em tabela `limite_uso` documentada no ADR-006 |

## Trechos de referência (não copiar: reescrever com testes)

```jsonc
"ratelimits": [{ "name": "RL", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } }]
```

```js
const { success } = await env.RL.limit({ key });
```

## Links

- Documentação do binding de rate limit da Cloudflare (consultada em 2026-10-24, ver `design.md` [P-1])
