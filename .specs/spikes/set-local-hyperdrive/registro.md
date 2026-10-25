# Registro do spike: `SET LOCAL app.usuario_id` dentro de `BEGIN` fica restrito à transação com o Hyperdrive, usando Kysely sobre um `pg.Client` por requisição?

- **Slug**: set-local-hyperdrive · **Data**: 2026-10-24 · **Chamado por**: tarefa T12 (spike S1) de `.specs/features/evolucao-segura/tasks.md` · **Usar em**: `design.md` (Risks & Concerns), tarefa T32 (`backend/api/src/db.ts`), ADR-005
- **Veredito**: sim (nenhuma requisição enxergou o contexto de outra)
- **Confiança**: alta para o cenário medido. Pesam a favor: Hyperdrive real, Neon Free na região do produto, 6.000 requisições com 0 divergências, medição repetida pela sessão e confirmada pelo PgBouncer local. Pesam contra: dados falsos, carga de 20 simultâneas (menor que um pico real) e ausência de captura de rede dos comandos.
- **Destino do código**: pendente

## Resposta

Sim. Com o Hyperdrive real, um `pg.Client` novo por requisição e Kysely, o contexto definido por `SET LOCAL` (ou `set_config(..., true)`) valeu só dentro da transação: 0 divergências em 3.000 requisições dentro da transação e 0 valores não vazios em 3.000 leituras fora dela, nos dois modos. O critério "deu certo" foi atendido com folga (exigia 0 em 1.000).

## Método e resultado

- **Método**: Worker de teste com Hyperdrive real, carga de 1.000 requisições (20 simultâneas) alternando 2 usuários, 3 repetições por modo; complemento com PgBouncer em modo transação.
- **Medições principais**: 0 divergências, 0 vazamentos, 0 erros em 6.000 requisições (detalhe em `resultado.md`).
- **Tempo gasto**: cerca de 10 minutos de 3 horas.

## Explicações concorrentes e sem resposta

- O pooler pode ter reaproveitado poucas conexões (20 backends para 1.000 requisições), o que é o cenário que testa o vazamento; carga muito maior poderia revelar outro comportamento. O teste de isolamento no CI roda contra Hyperdrive local, não contra o real, então esta garantia vem do spike e precisa ser repetida após a implantação (smoke test pós-deploy).
- Não se provou por captura de rede que os comandos saem no mesmo cliente; o resultado correto é a evidência.
- Não cobre o caso de a requisição lançar erro entre `BEGIN` e `COMMIT` (o `ROLLBACK` reinicia o contexto); isso entra como teste na T32.

## Riscos descobertos

| Risco | Impacto | O que fazer |
|---|---|---|
| `SET LOCAL` não aceita parâmetro | médio (injeção se mal usado) | Usar `set_config('app.usuario_id', $1, true)` com parâmetro na T32; `SET LOCAL` só com UUID validado |
| `/fora` devolve `""` em vez de `null` | baixo | `app_usuario_id()` deve tratar `""` como ausente (NULLIF) na migration 0001 |
| Garantia medida só com 20 simultâneas e dados falsos | médio | Teste de fumaça de isolamento após o deploy; manter o RLS como segunda barreira |
| `pg` trata `sslmode=require` como `verify-full` | baixo | Usar a string de conexão do Hyperdrive sem alterar o `sslmode` |

## Trechos de referência (não copiar: reescrever com testes)

```ts
const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
// mini-pool que devolve sempre o mesmo client, para o Kysely usar um client por requisição
const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
await db.transaction().execute(async (trx) => {
  await sql`select set_config('app.usuario_id', ${usuarioId}, true)`.execute(trx);
  /* consultas */
});
ctx.waitUntil(client.end());
```

## Links

- Documentação do Hyperdrive com `node-postgres` e sobre como o pooler funciona (ver `design.md`, fontes [P-2])
