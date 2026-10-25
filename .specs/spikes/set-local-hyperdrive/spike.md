# Spike: `SET LOCAL app.usuario_id` dentro de `BEGIN` fica restrito à transação quando a conexão passa pelo pooler do Hyperdrive, usando Kysely sobre um `pg.Client` por requisição?

- **Slug**: set-local-hyperdrive · **Data**: 2026-10-24
- **Chamado por**: tarefa T12 (spike S1) de `.specs/features/evolucao-segura/tasks.md`; risco "SET LOCAL com pooler do Hyperdrive" do `design.md`
- **Usar em**: `design.md`, seção Risks & Concerns (linhas do Hyperdrive e do Kysely); T32 (`backend/api/src/db.ts`); ADR-005
- **Preparação aprovada**: sim (2026-10-24)

## Pergunta

Com o Worker conectado ao Postgres pelo Hyperdrive (pooler em modo transação), cada requisição abrindo `BEGIN; SET LOCAL app.usuario_id = $1` por Kysely sobre um `pg.Client` novo, alguma requisição enxerga o `app.usuario_id` de outra? (sim/não)

- **Por que importa**: o isolamento entre profissionais (ISO-01, ISO-02) depende de o contexto do RLS valer só na transação. Vazamento = um profissional lê dados de outro.
- **Por que é spike**: motivo 2. A documentação do Hyperdrive descreve o modo transação, mas não cita `SET LOCAL` literalmente, e não há exemplo oficial de Kysely com Hyperdrive.

## Critério de sucesso (congelado na aprovação)

- **Deu certo**: em 1.000 requisições concorrentes (20 em paralelo), alternando 2 usuários, **0** respostas trazem `current_setting('app.usuario_id', true)` diferente do usuário da própria requisição, e **0** consultas fora de transação veem valor não vazio. Kysely executa `BEGIN`, `SET LOCAL`, consulta e `COMMIT` no mesmo `pg.Client`.
- **Deu errado**: **1 ou mais** respostas com o usuário de outra requisição, ou valor não vazio visto fora da transação.
- **Inconclusivo**: o teste só roda contra um proxy local (sem o Hyperdrive real), ou menos de 1.000 requisições completam.
- **Resultado que provaria que não**: uma única resposta com o `usuario_id` errado.
- **Condições da medição**: Worker de teste com Hyperdrive real apontando para uma branch descartável do Neon Free (`sa-east-1`), dados falsos, 1.000 requisições com 20 simultâneas, 3 repetições. Como referência complementar, o mesmo teste local contra PgBouncer em modo transação (não decide o veredito sozinho).

## Prazo e método

- **Prazo**: 3 horas e 3 tentativas, o que vier primeiro
- **Início**: 2026-10-24 22:01 · **Limite**: 2026-10-25 01:01
- **Extensão**: nenhuma
- **Método**: (1) Worker mínimo com Hono, rota que abre transação, faz `SET LOCAL`, espera 0 a 50 ms aleatórios e devolve `current_setting`; outra rota que lê fora de transação. (2) Rodar localmente contra PgBouncer em modo transação. (3) Publicar o Worker de teste em `*.workers.dev` com Hyperdrive real e disparar a carga com um script Node. (4) Remover Worker, Hyperdrive e branch do Neon ao fim.
- **Onde roda**: `.specs/spikes/set-local-hyperdrive/codigo/`
- **Ações externas**: criar branch descartável no Neon; criar uma configuração Hyperdrive e publicar um Worker de teste em `workers.dev` na conta Cloudflare do usuário; apagar os três ao fim. Cada uma com confirmação específica.

## A esclarecer

- Resolvido em 2026-10-24: o usuário autorizou usar as contas Neon Free e Cloudflare (branch, Hyperdrive e Worker de teste, apagados ao fim; cada criação com confirmação).
