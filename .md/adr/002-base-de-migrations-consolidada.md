# ADR-002: Base de migrations consolidada nova

- **Status**: Aceito
- **Data**: 2026-10-24
- **Supersedes**: nenhum
- **Origem**: [design](../../.specs/features/evolucao-segura/design.md), abordagem escolhida e Data Models; spec, decisão D-03 (banco novo começa vazio)

## Contexto

O legado tem 35 migrations (0001 a 0035) acumuladas ao longo do tempo. O banco novo começa vazio (D-03), sem migração de dados, e muda o modelo: cadastro aberto, cobrança, push, exclusão de conta, uma especialidade por profissional, dinheiro em centavos e sem IA, relatório nem Google.

## Decisão

Escrevemos uma base de migrations nova e consolidada em `backend/scripts/migrations/`, com **uma migration por área** (roles e base, auditoria, identidade, assinatura, perfil, pacientes, agenda e as seguintes). O legado serve de fonte de consulta (roles, helpers de RLS, triggers de revisão, guardas), nunca de cópia direta.

Regras da base:

- Toda tabela de negócio tem `usuario_id`, RLS com `FORCE`, `criado_em`; as editáveis têm `row_version`.
- A role `app` não recebe DELETE nem TRUNCATE em tabela de negócio.
- Dinheiro em `bigint` de centavos.
- Cada migration roda em transação (`node-pg-migrate` 9, ESM) e o CI aplica todas do zero num Postgres 16 de serviço.
- Os testes de garantia do banco do legado são adaptados ao schema novo, não copiados às cegas.

## Consequências

- O histórico do schema fica curto e coerente com o produto novo.
- Não existe caminho de migração dos dados do legado; é preciso uma decisão nova (ADR) se isso mudar.
- Cada área nova entra no teste de isolamento, que varre o catálogo do banco.
- Mais trabalho de escrita agora, em troca de não carregar decisões antigas (IA, whitelist, decimal) para o banco novo.
