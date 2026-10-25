# ADR-004: Deploy e backup no GitHub Actions

- **Status**: Aceito
- **Data**: 2026-10-24
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), OPS-01, OPS-03 e OPS-04; [design](../../.specs/features/evolucao-segura/design.md), Tech Decisions (Backup e branches) e etapa 2; padrão LJS

## Contexto

O produto guarda dado de saúde, e o risco principal é perder dado ou publicar errado. O padrão LJS põe deploy e backup no GitHub Actions, sem servidor próprio. O Neon Free não oferece backup agendado com retenção que sirva de plano de restauração por conta própria.

## Decisão

Dois workflows, e só eles tocam produção:

- **`deploy.yml`**: só `workflow_dispatch`, só pela `main`, environment `producao`, `concurrency` sem cancelamento. Ordem fixa: build do web, branch de restauração no Neon (`neondatabase/create-branch-action@v5`, mantendo as 2 mais recentes com `delete-branch-action@v3`), dump cifrado com `age`, migração com a role `owner` (`NEON_URL_MIGRACAO`) e o deploy do Worker com `--var URL_PUBLICA`. O SHA do commit vira o release do Sentry no web e no Worker.
- **`backup.yml`**: todo dia às 04:00 de Brasília (cron `0 7 * * *`, UTC), também manual. `pg_dump -Fc` pela role `backup_ro` em conexão direta (sem pooler), cifrado com `age` (chave pública em secret) e guardado como artefato por 30 dias.
- O comando de deploy do Worker só pode existir no `deploy.yml`; um teste da suíte falha se aparecer em outro arquivo (OPS-04).
- Os testes leem o YAML. Nenhum workflow é executado por testes, e a primeira execução real depende de confirmação do dono do produto.

## Consequências

- Publicar é um clique auditável, sempre com ponto de volta (branch de restauração e dump cifrado).
- A chave privada do `age` fica fora do GitHub; sem ela o backup não abre. A restauração é testada antes da publicação (OPS-02, etapa 15).
- Artefatos do Actions somam no máximo 500 MB; o tamanho do dump deve ser medido no primeiro backup e registrado no runbook.
- O environment `producao` não deve exigir revisores se o `backup.yml` precisar rodar sem ninguém: aprovação manual travaria o cron. Alternativa: mover `NEON_URL_BACKUP` e `AGE_PUBLIC_KEY` para secrets do repositório.
- Cron do GitHub pode atrasar alguns minutos e roda só na branch padrão.
- Workflows agendados são desligados após 60 dias sem atividade no repositório; o runbook lembra de conferir.
