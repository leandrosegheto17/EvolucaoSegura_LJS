# ADR-010: Cron único com despachante

- **Status**: Aceito
- **Data**: 2026-10-27
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), PUSH-07 e PLANO-04; [design](../../.specs/features/evolucao-segura/design.md), componente "Tarefas do cron", Tech Decisions (linha do cron) e etapa 12 ("010 Cron único com despachante"); tarefa T136

## Contexto

O produto precisa de trabalho agendado: lembrete de sessão (janela de 15 a 10 minutos antes), pendência das 20:00, avisos de plano, transições de assinatura (trial vencido, atraso de 7 dias, cancelada no fim do período), purga de contas e limpeza de tokens e sessões vencidos. A conta da Cloudflare do usuário tem 5 Cron Triggers, divididos entre 3 apps. No plano Free, cada execução do Worker tem 10 ms de CPU (a espera de rede e de banco não conta). A Cloudflare não garante que toda execução agendada aconteça.

## Decisão

- **Um único Cron Trigger** `*/5 * * * *` no `wrangler.jsonc` (teste `backend/scripts/test/wrangler-cron.test.ts`). O handler `scheduled` do Worker (`backend/api/src/index.ts`) chama o despachante.
- **Despachante** (`backend/api/src/tarefas/despachar.ts`): roda as tarefas de `backend/api/src/tarefas/registro.ts` em ordem, uma depois da outra. A ordem segue o design; tarefa nova entra nessa lista, na posição dela.
- **Falha isolada**: o erro de uma tarefa vai ao Sentry com a tag `tarefa` (nome) e as seguintes rodam. Dentro de uma tarefa, cada item vai numa transação própria sempre que um item com erro não deva impedir os demais.
- **Tempo por parâmetro**: `agora` é o horário agendado (`controller.scheduledTime`); as tarefas não leem o relógio do processo e as regras puras recebem o instante.
- **Compensação de execução perdida**: cada tarefa declara uma janela. Com janela, recebe `desde = agora - janela` e faz o que venceu em `(desde, agora]` e ainda não foi feito, então a execução seguinte cobre a perdida enquanto o item estiver dentro da janela. Sem janela, faz tudo o que venceu até agora (o estado diz o que falta).
- **Idempotência**: pelo estado (a mesma transição de novo não muda nada) ou pela tabela `notificacao_enviada` (tipo, ref, chave única), para os envios. Reexecutar ou sobrepor execuções não repete efeitos.
- **Orçamento de CPU**: cada tarefa trata no máximo `LOTE_POR_EXECUCAO` itens (10, por PREMISSA) por execução; o resto fica para a seguinte, 5 minutos depois.
- **Banco**: as tarefas tocam dados de vários profissionais só por funções `tarefas.*` `SECURITY DEFINER` (ADR-005).

## Consequências

- Sobram 4 Cron Triggers da conta para os outros apps.
- Uma tarefa lenta atrasa as seguintes da mesma execução; o lote limitado e a idempotência mantêm isso dentro do orçamento, e a próxima execução retoma.
- O lote de 10 itens é uma premissa: medir a CPU do cron depois do primeiro deploy e ajustar.
- A precisão do agendamento é de 5 minutos: as janelas de cada tarefa (ex.: lembrete de 15 a 10 minutos) são escolhidas em função desse intervalo.
