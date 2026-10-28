# ADR-012: Exclusão e purga de conta

- **Status**: Aceito
- **Data**: 2026-10-28
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), CONTA-01 a CONTA-05; [design](../../.specs/features/evolucao-segura/design.md), Data Models (`conta_excluida`), componente "Tarefas do cron" e etapa 14 ("012 Exclusão e purga de conta"); [contexto](../../.specs/features/evolucao-segura/context.md), D-28, D-30 e D-31; ADR-005 e ADR-010; tarefas T148 a T153, T180 a T183

## Contexto

O profissional pode excluir a própria conta (LGPD). O prontuário é dele (controlador) e tem guarda legal, por isso a exclusão exige a exportação completa servida nas últimas 24 horas e a declaração de que ele guarda o prontuário. Depois de confirmada, a conta fica 30 dias bloqueada, com um link de desistência, e então tudo é apagado. A role `evolucao_app` do Worker não tem DELETE em nenhuma tabela (ADR-005), a auditoria e os registros clínicos são só de inclusão (trigger `negar_alteracao`, ES001, que barra até o owner) e o RLS é forçado também para o owner. A migration roda no Neon com o `neondb_owner`, sem superusuário, onde `SET app.*` na definição de função falha (achado do lote 20).

## Decisão

- **Fluxo**: pedido (`POST /api/conta/excluir`, com sessão, senha, declaração e exportação de 24 h; 422 com o requisito que falta) → e-mail com link de confirmação (token de 256 bits, só SHA-256 no banco, 30 minutos, uso único) → confirmação pública (`POST /api/conta/excluir/confirmar`): grava `usuario.bloqueado_exclusao_em`, encerra as sessões, cancela no Asaas (fora do ar = 503 `cobranca_indisponivel` e nada muda) e manda o e-mail com a data da purga e o link de desistência, que vence junto com a purga → desistência pública (`POST /api/conta/desistir`) antes de 30 dias: desbloqueia, plano `free` ou trial restante, entra de novo com senha e 2FA.
- **Purga**: `tarefas.purgar_contas(agora, limite)` (migration 0023), SECURITY DEFINER do owner com `search_path` fixo. Purga as contas com `bloqueado_exclusao_em + 720 horas <= agora` (o mesmo cálculo do `purga_em` anunciado), das bloqueadas há mais tempo para as mais recentes, até o lote do cron, com `FOR UPDATE SKIP LOCKED` (uma desistência em curso fica para a execução seguinte). Para cada conta, numa só transação: grava `conta_excluida` (id, `pedido_em` = último `conta.exclusao_pedida` até o bloqueio, `purgado_em` = agora) e apaga as linhas de todas as tabelas com `usuario_id`, auditoria inclusive, a linha de `tentativa_login` do SHA-256 do e-mail e, por fim, o `usuario`.
- **Contexto sem `SET app.*` na definição**: a função liga `app.usuario_id` (o RLS forçado), `app.purga_usuario` e `app.tarefa_assinatura = 'off'` com `set_config` local em tempo de execução, e devolve os valores anteriores no fim. Roda no Neon sem superusuário.
- **Exceção única ao "só inclusão"**: `negar_alteracao` deixa passar só o DELETE da linha de um profissional cuja purga está em curso (`app.purga_usuario` igual ao `usuario_id` da linha) e cuja conta está bloqueada há 30 dias ou mais pelo relógio do banco. UPDATE e TRUNCATE seguem barrados para qualquer role; DELETE fora disso também. A `evolucao_app` continua sem DELETE.
- **Cron**: a purga é a 5ª tarefa do despachante (`registro.ts`), antes da limpeza de tokens, sem janela: o estado (a conta bloqueada ainda existir) diz o que falta, a execução perdida é coberta pela seguinte e a reexecução é inofensiva.
- **Garantia por teste**: a varredura (`backend/api/test/tarefas/purga-varredura.test.ts`) semeia uma linha em toda tabela com `usuario_id` achada pelo catálogo e, depois da purga, procura o id, o e-mail e o hash do e-mail no texto de todas as linhas de todas as tabelas: só `conta_excluida` pode ter o id. Tabela nova entra na varredura sozinha; se a purga não a apagar, o teste falha (ou a chave estrangeira para `usuario` faz a purga falhar).

## Consequências

- Tabela nova com dado do profissional precisa de uma linha na função de purga (migration nova que a substitua); a varredura e a chave estrangeira apontam o esquecimento.
- O dado sai do banco, mas continua nos backups até eles vencerem (artefatos de 30 dias, ADR-004) e no cadastro de cliente do Asaas (nome, e-mail e CPF/CNPJ), que a purga não apaga: a assinatura já foi cancelada lá na confirmação. Tratar a retenção e o cliente do Asaas no texto de privacidade (CONTA-06) e, se preciso, numa tarefa própria.
- Corrida rara conhecida (lote 21): um 2FA concluído no instante da confirmação pode abrir sessão, porque o middleware de sessão não confere o bloqueio. Essa sessão dura no máximo 12 horas (AUTH-09) e some na purga; não resolvido aqui.
- `pedido_em` sem o evento `conta.exclusao_pedida` (não deveria acontecer) vira a data do bloqueio.
- O lote de 10 contas por execução (PREMISSA do ADR-010) é folgado para o volume esperado; medir depois do primeiro deploy.
