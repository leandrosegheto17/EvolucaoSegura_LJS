# Medição de CPU da exportação (T122)

**Data:** 2026-10-27
**Requisito:** EXP-03, EXP-04
**Resultado:** nenhum tamanho útil de página cabe com folga em 10 ms de CPU. A T122 para aqui, e o próximo passo é um novo spike (Done when da T122). O tamanho máximo de página **não foi fixado**.

## Ambiente

- **Banco:** Neon só de teste em sa-east-1, PostgreSQL 18. O banco foi zerado e recebeu as migrations 0001 a 0021 deste projeto.
- **Massa falsa:** 1 profissional, 300 pacientes, 3.000 sessões, 3.000 evoluções de 1.500 caracteres com acento e 3.000 pagamentos com uma revisão cada.
- **Conexão:** Hyperdrive de teste, sem cache. O Worker descartável roda no workers.dev, plano Free, com `nodejs_compat` e `pg` 8.23.1, e foi apagado no mesmo dia.
- **Requisição medida:** abre um `pg.Client` novo, faz `BEGIN`, `SET LOCAL ROLE app` (RLS forçada valendo) e `set_config('app.usuario_id', …, true)`, lê uma página de N linhas de uma tabela por `id`, com `limit N + 1` para saber se há próxima, faz `COMMIT` e serializa o corpo `{tabela, proximo_cursor, linhas}`.
- **Duas formas de serializar:**
  - `sql`: o Postgres monta o JSON (`json_agg(to_jsonb(...))::text`) e o Worker só concatena o texto.
  - `js`: o Worker recebe as linhas e faz `JSON.stringify`.
- **Como a CPU foi lida:** campo `cpuTime` de cada evento do `wrangler tail --format json`, com 20 chamadas sequenciais por caso. O tail perdeu alguns eventos, por isso a coluna "eventos" fica abaixo de 20 em alguns casos.

## Medições

| Tabela | Forma | N (linhas) | Corpo | Eventos | CPU mediana | CPU máxima |
|---|---|---|---|---|---|---|
| evolucao | sql | 1 | ~2 KB | 20 | 5 ms | 10 ms |
| evolucao | sql | 10 | ~21 KB | 15 | 7 ms | 10 ms |
| evolucao | sql | 25 | ~53 KB | 14 | 7,5 ms | 13 ms |
| evolucao | sql | 50 | ~105 KB | 14 | 8,5 ms | 14 ms |
| evolucao | sql | 100 | 211 KB | 20 | 12 ms | 36 ms |
| evolucao | sql | 200 | 422 KB | 20 | 19 ms | 29 ms |
| evolucao | sql | 300 | 633 KB | 20 | 24,5 ms | 47 ms |
| evolucao | sql | 500 | 1,05 MB | 17 | 30 ms | 53 ms |
| evolucao | js | 50 | ~104 KB | 18 | 12 ms | 18 ms |
| evolucao | js | 100 | 208 KB | 19 | 15 ms | 24 ms |
| evolucao | js | 200 | 415 KB | 18 | 21,5 ms | 32 ms |
| evolucao | js | 300 | 623 KB | 14 | 27 ms | 40 ms |
| sessao_atendimento | sql | 300 | 132 KB | 14 | 8,5 ms | 28 ms |
| sessao_atendimento | sql | 1.000 | 440 KB | 18 | 16 ms | 53 ms |
| pagamento_revisao | sql | 300 | 265 KB | 16 | 12 ms | 25 ms |

Todas as execuções terminaram com `outcome: ok` e HTTP 200. Nenhuma foi cortada por CPU, nem as de 53 ms.

## Leitura

1. **O custo fixo já consome a folga.** Com uma única linha, a requisição (conexão nova pelo Hyperdrive, transação, papel, usuário, consulta e commit) gasta 5 ms de mediana e chega a 10 ms de máximo. Isso vale para toda rota autenticada, não só para a exportação.
2. **A partir daí, a CPU cresce com o tamanho da página.** Por volta de 25 a 50 evoluções a mediana ainda fica abaixo de 10 ms, mas o máximo passa disso. Com 100 ou mais evoluções, até a mediana passa de 10 ms.
3. **Montar o JSON no Postgres (`sql`) sai 20 a 30% mais barato** do que serializar no Worker (`js`).
4. **Uma página útil não cabe com folga.** Com 25 linhas por página, a massa do spike `cpu-exportacao` (cerca de 66 mil linhas) daria cerca de 2.600 requisições por exportação, e mesmo assim o máximo passaria de 10 ms.
5. **Contradição com o spike `cpu-exportacao`.** Lá, quase todas as execuções foram cortadas no teto (por volta de 1 s). Aqui, execuções de 30 a 53 ms passaram sem corte. Pelo que se viu, o limite do Free não corta uma requisição logo que ela passa de 10 ms, mas a margem real não está medida. PREMISSA: não dá para contar com essa margem sem um spike que a meça.

## O que o novo spike precisa responder

- Até quanto de CPU por requisição o Free tolera de fato sem `exceededCpu`, e se isso se mantém em rajada (uma exportação são muitas requisições seguidas).
- Se o custo fixo de 5 a 10 ms por requisição (conexão nova pelo Hyperdrive a cada pedido) pode ser reduzido, e como isso afeta as outras rotas.
- Alternativas fora do tamanho de página: plano Workers Paid (30 s de CPU), exportação gerada fora da requisição, ou páginas montadas por inteiro no Postgres.

## Achado à parte: as migrations falham no Neon com PostgreSQL 18

As migrations 0012, 0013, 0014, 0015, 0018, 0019, 0020 e 0021 criam funções com `SET app.tarefa_* = '…'` na definição. No Neon, o usuário da migration (`neondb_owner`, que não é superusuário) recebe `permission denied to set parameter "app.tarefa_assinatura"`. O erro se repete com qualquer parâmetro personalizado (por exemplo, `xyz.teste`). Como as migrations rodam numa única transação, nada foi aplicado.

No Postgres local, que roda como superusuário, o erro não aparece. Só para esta medição, as migrations foram aplicadas a partir de uma cópia fora do repositório, sem essas linhas `SET` (o que não afeta a leitura das tabelas medidas). Nenhuma migration do repositório foi alterada. Isso precisa de correção antes do primeiro deploy no Neon. [A ESCLARECER: tarefa e abordagem da correção]
