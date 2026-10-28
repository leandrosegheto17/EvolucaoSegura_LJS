# Roadmap

As 23 fases do `.specs/features/evolucao-segura/tasks.md` (Execution Plan), reorganizadas em 2026-10-27 (AD-013): cada tarefa tem até 2h de trabalho humano (`**Estimativa**`). É uma feature só, com uma linha por fase. A **Situação** usa o vocabulário fixo da skill `progresso` (`Concluída`, `Em andamento`, `Não começada`); troque-a no mesmo commit em que a fase fechar.

| # | Fase | Situação | Observação |
|---|---|---|---|
| 1 | Etapa 1, parte 1: Preparação (monorepo, ferramentas, CI e documentos) | Concluída |  |
| 2 | Etapa 1, parte 2: Spikes S1 a S4 (com participação do usuário) | Concluída |  |
| 3 | Etapa 2: Esqueleto ponta a ponta (Worker, front mínimo, deploy e backup) | Concluída |  |
| 4 | Etapa 3: Banco base (roles, RLS, auditoria, transação por requisição) | Concluída |  |
| 5 | Etapa 4, parte 1: Acesso, cadastro e confirmação | Concluída |  |
| 6 | Etapa 4, parte 2: Login com 2FA, sessão e CSRF | Concluída |  |
| 7 | Etapa 4, parte 3: Recuperação de senha, telas públicas e inatividade | Concluída |  |
| 8 | Etapa 5: Perfil, configurações e shell /app | Concluída |  |
| 9 | Etapa 6: Pacientes e TCLE | Concluída |  |
| 10 | Etapa 7, parte 1: Agenda, domínio e sessões | Concluída |  |
| 11 | Etapa 7, parte 2: Agenda, séries e telas | Concluída |  |
| 12 | Etapa 8: Anamnese configurável | Concluída |  |
| 13 | Etapa 9: Evoluções, rascunhos e modelos de texto | Concluída |  |
| 14 | Etapa 10: Financeiro e Início | Concluída |  |
| 15 | Etapa 11, parte 1: Auditoria (telas) e PDF do prontuário | Concluída |  |
| 16 | Etapa 12, parte 1: Planos, Asaas e webhook | Concluída |  |
| 17 | Etapa 12, parte 2: Meu plano, limite do Free e cron único | Concluída |  |
| 18 | Etapa 13: Push | Concluída |  |
| 19 | Etapa 11, parte 2: Exportação completa (depende de Neon e Hyperdrive de teste) | Concluída | Lote 20 em 2026-10-27; T122 com página de 25 linhas (SPEC_DEVIATION, risco de CPU aceito no Free) |
| 20 | Etapa 14, parte 1: Exclusão de conta | Concluída | Lotes 21 e 22 em 2026-10-28; ADR-012 |
| 21 | Etapa 14, parte 2: Termos, landing e PWA | Concluída | Lote 23; checagem do Chrome da T156 registrada em 2026-10-28 |
| 22 | Etapa 15, parte 1: Testes de ponta a ponta (e2e) | Concluída | Lote 24 em 2026-10-28 |
| 23 | Etapa 15, parte 2: Fechamento (comparação visual, restauração, README e runbook) | Em andamento | T165 bloqueada: evolucao_backup_ro sem acesso a pgmigrations e sequences e sem row security; ações do usuário: conferência visual (T161, T188 a T190) e roles do Neon (T195) |

## Pendências do usuário

Ações que só o usuário faz; cada uma bloqueia a tarefa indicada e exige confirmação específica quando for externa.

- **Antes da T122 (Phase 19):** criar Neon e Hyperdrive de teste para medir a CPU da exportação.
- **T156 (Phase 21):** conferir no Chrome que o app é reconhecido como instalável.
- **T161 e T188 a T190 (Phase 23):** conferência visual das telas contra o legado (as telas dos lotes 8 a 14 seguem com a conferência visual pendente).
- **T195 (Phase 23):** provisionar login e senha das roles `evolucao_owner`, `evolucao_app` e `evolucao_backup_ro` no Neon, depois do primeiro deploy.
- **Antes da primeira liberação:** provar no Asaas com Pix real o evento de pagamento, a reentrega do webhook e o ciclo seguinte (ADR-009); conta Asaas de produção, chave Pix, domínio e revisão jurídica dos termos (T194).
- **Sem prazo:** o CI do GitHub não roda por cobrança da conta `leandrosegheto17`; commits locais seguem sem push até confirmação específica.
