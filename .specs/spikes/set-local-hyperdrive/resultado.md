# Resultado: set-local-hyperdrive

- **Situação**: concluído
- **Tempo gasto**: cerca de 10 minutos (22:01 a 22:12) de 3 horas · **Tentativas**: 1 de 3

## O que foi feito

1. Projeto Neon descartável `es-spike-s1` (Free, `aws-sa-east-1`), role `app_spike` (NOSUPERUSER, NOBYPASSRLS) e tabela `itens` com 10 linhas falsas.
2. Hyperdrive `es-spike-s1` com cache desligado, conexão direta, role `app_spike`.
3. Worker `es-spike-s1` com `nodejs_compat`: um `pg.Client` novo por requisição, Kysely com mini-pool que devolve sempre esse client, `db.transaction()` (BEGIN, consulta, COMMIT), espera aleatória de 0 a 50 ms e `ctx.waitUntil(client.end())`. Rota `/dentro` define o contexto na transação; rota `/fora` lê sem transação.
4. Carga: 1.000 requisições, 20 simultâneas, 2 UUIDs alternados, metade em `/dentro` e metade em `/fora`; 3 repetições por modo (`set_config(..., true)` e `SET LOCAL` com UUID validado e interpolado).
5. Complemento local: PgBouncer 1.26.1 em modo transação (pool de 5) contra o Postgres local, mesmo código Kysely.

Diferença do plano: a região `aws-sa-east-1` não aparece na ajuda do `neonctl`, mas a criação funcionou. `SET LOCAL` não aceita parâmetro, então o UUID é validado por regex e interpolado.

## Medições

| Medição | Valor | Condições | Comando | Conferida pela sessão |
|---|---|---|---|---|
| Divergências em `/dentro` (6 repetições) | 0 de 3.000 | Hyperdrive real, Neon sa-east-1, 20 simultâneas | `node carga.mjs https://es-spike-s1.prod-ljs.workers.dev <rep> <modo>` | sim (rep 9: 0 de 500 em cada modo) |
| Valores não vazios em `/fora` | 0 de 3.000 | idem | idem | sim (0 de 500 em cada modo) |
| Erros HTTP | 0 de 6.000 | idem | idem | sim (0 em 2.000) |
| Backends distintos (pooler reaproveitando conexões) | 20 em 1.000 requisições | idem | idem | sim (20) |
| PgBouncer local, 6 execuções | 0 divergentes, 0 vazados, 0 erros, 5 backends | pool 5, modo transação | `node local.mjs <modo> <rep>` | não reproduziu |

A sessão repetiu a carga (repetição 9, nos dois modos) contra o Worker ainda publicado: 1.000 requisições cada, 0 divergências, 0 vazamentos, 0 erros.

## Observações

- **Surpresas**: `/fora` devolve string vazia, não `null` (a variável personalizada já existe na sessão depois de um `set_config` local anterior); o critério trata os dois como vazio.
- **Obstáculos**: PgBouncer em Docker não resolveu `host.docker.internal`; trocado pelo IP da ponte. `pg` 8.23.1 avisa que `sslmode=require` vale como `verify-full`; sem efeito no resultado.
- **Comportamentos inesperados**: nenhum no isolamento.
- **Esforço real**: bem menor que o previsto.
- **Limite do que se provou**: não houve captura de rede confirmando que BEGIN, SET e COMMIT saem no mesmo cliente; a evidência é indireta (PID de backend único por transação e valor correto lido de volta).
- **Perguntas novas**: nenhuma.
