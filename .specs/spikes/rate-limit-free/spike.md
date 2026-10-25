# Spike: o binding `ratelimits` do Worker funciona no plano Free e bloqueia a 11ª requisição em 60 segundos?

- **Slug**: rate-limit-free · **Data**: 2026-10-24
- **Chamado por**: tarefa T13 (spike S2) de `.specs/features/evolucao-segura/tasks.md`; risco "Rate limit binding sem confirmação no Free" do `design.md`
- **Usar em**: tarefa T43 (`backend/api/src/middleware/limite.ts`) e ADR-006
- **Preparação aprovada**: sim (2026-10-24)

## Pergunta

Um Worker no plano Free, com o binding `ratelimits` configurado em 10 requisições por 60 segundos, publica sem erro e recusa a 11ª requisição da mesma chave dentro do minuto? (sim/não)

- **Por que importa**: define o mecanismo do OPS-07. Se não funcionar, o rate limit vai para a tabela `limite_uso`, com mais escrita no banco.
- **Por que é spike**: motivo 2. A pesquisa de 2026-10-24 não achou na documentação se o binding está disponível no plano Free.

## Critério de sucesso (congelado na aprovação)

- **Deu certo**: o deploy aceita o binding e, em 3 rodadas de 15 requisições seguidas da mesma chave, as 10 primeiras passam e **pelo menos 4 das 5 restantes** são recusadas (o binding conta por localização e é aproximado).
- **Deu errado**: o deploy recusa o binding no plano Free, ou **nenhuma** requisição é recusada em nenhuma das 3 rodadas.
- **Inconclusivo**: recusa errática (entre 1 e 3 das 5 numa rodada) ou bloqueio já antes da 10ª.
- **Resultado que provaria que não**: erro de deploy citando plano, ou 15 de 15 passando nas 3 rodadas.
- **Condições da medição**: Worker de teste em `workers.dev`, conta Free, chave fixa, requisições disparadas de uma só máquina em menos de 60 s, 3 rodadas com 2 minutos de intervalo.

## Prazo e método

- **Prazo**: 1 hora e 2 tentativas, o que vier primeiro
- **Início**: <gravado ao despachar> · **Limite**: <início + 1 h>
- **Extensão**: nenhuma
- **Método**: (1) Worker mínimo com o binding e uma rota que chama `limit({ key })`. (2) `wrangler deploy` do Worker de teste. (3) Script com 15 chamadas seguidas, 3 rodadas. (4) Apagar o Worker.
- **Onde roda**: `.specs/spikes/rate-limit-free/codigo/`
- **Ações externas**: publicar e depois apagar um Worker de teste na conta Cloudflare do usuário, com confirmação específica.

## A esclarecer

- nenhum além da autorização da ação externa
