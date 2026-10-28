# ADR-005: RLS, transação por requisição e funções de tarefa

- **Status**: Aceito
- **Data**: 2026-10-24
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), ISO-01 a ISO-04, AUD-01 e AUD-02; [design](../../.specs/features/evolucao-segura/design.md), Architecture Overview, Data Models, Tech Decisions e etapa 3; [spike set-local-hyperdrive](../../.specs/spikes/set-local-hyperdrive/registro.md); AD-005 do [STATE](../../.specs/STATE.md)

## Contexto

O produto é multi-inquilino e guarda prontuário. Um profissional nunca pode ver nem alterar dado de outro, nem por erro de código na API. O Worker fala com o Neon pelo Hyperdrive, que reaproveita conexões entre requisições. O cron e o webhook rodam sem sessão de usuário, mas precisam ler e gravar dado de vários profissionais e apagar o que vence.

## Decisão

- **Três roles** (migration 0001): `owner` é dono do schema e das tabelas e o único que faz DDL; `app` é a role do Worker, sem superusuário, sem `BYPASSRLS`, sem DELETE e sem TRUNCATE por padrão, com DML concedido tabela a tabela; `backup_ro` só lê, com uma policy de leitura em cada tabela com RLS para o `pg_dump`. As roles nascem `NOLOGIN` e sem senha; login e senha são provisionados fora do repositório.
- **RLS forçada** em toda tabela com `usuario_id`: `ENABLE` e `FORCE ROW LEVEL SECURITY`, com a policy `usuario_id = app_usuario_id()`. O helper lê `app.usuario_id` e trata o vazio como ausente; sem usuário, nenhuma linha aparece.
- **Uma transação por requisição** (`comTransacao`, em `backend/api/src/db.ts`): um `pg.Client` novo pelo Hyperdrive, Kysely por cima, `BEGIN`, `set_config('app.usuario_id', $1, true)` com parâmetro (o `SET LOCAL` não aceita parâmetro), `COMMIT` ou `ROLLBACK`, e `client.end()` em `waitUntil`. O spike provou que o contexto não vaza entre requisições com o Hyperdrive real.
- **Tempo limite de conexão de 8 s, sem retry** (revisado em 2026-10-28, padrão Neon): o `pg.Client` do `comTransacao` abre com `connectionTimeoutMillis: 8000` (`TEMPO_LIMITE_CONEXAO_MS`). O Neon Free suspende o compute ocioso e a primeira conexão espera ele voltar; 8 s cobrem essa espera sem deixar a requisição presa. Não há nova tentativa: a falha volta como erro da requisição (e vai ao Sentry), e quem chamou decide repetir.
- **Auditoria na mesma transação**: `audit_log` é só de inclusão (trigger barra UPDATE, DELETE e TRUNCATE para qualquer role) e o evento é gravado pelo mesmo `trx` da operação. Falha da auditoria desfaz a operação.
- **Funções de tarefa**: cron e webhook só tocam o banco por funções do schema `tarefas`, sempre `SECURITY DEFINER` com `search_path` fixo, parâmetros tipados e sem SQL dinâmico. A `app` executa só as funções de uma lista explícita, mantida no teste `backend/scripts/test/funcoes-tarefas.test.ts`. Função nova nasce sem EXECUTE para PUBLIC (privilégio padrão da migration 0001).
- **Testes que travam a regra**: o harness de isolamento (`backend/api/test/isolamento/`) varre o catálogo e falha se uma tabela com `usuario_id` ficar sem RLS forçada ou se B ler, alterar, apagar ou criar linha de A. O teste das funções falha se uma função de `tarefas` não for `SECURITY DEFINER` com `search_path` fixo, se qualquer `SECURITY DEFINER` não tiver `search_path` fixo ou se a `app` executar algo fora da lista.

## Consequências

- Um erro de filtro na API não expõe dado de outro profissional: o banco devolve zero linhas e a rota responde 404 (ISO-02).
- A `app` nunca apaga: exclusão de conta, purga e limpeza de tokens passam por funções `tarefas.*`, revisadas uma a uma.
- Toda tabela nova entra sozinha no harness de isolamento. Uma tabela com `usuario_id` que não deva ter RLS (por exemplo, as de identidade, que o design deixa sem RLS) exige decisão explícita antes de existir.
- Os testes da API conectam como `app` (senha de teste local, só no Postgres do Docker e do CI) e usam um binding de superusuário só para semear dados.
- O isolamento no CI roda contra o Hyperdrive local, sem o pooler real. A garantia do pooler vem do spike e deve ser repetida num teste de fumaça depois do primeiro deploy.
