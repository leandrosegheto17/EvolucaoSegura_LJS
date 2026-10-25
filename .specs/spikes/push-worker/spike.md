# Spike: um Worker envia Web Push cifrado com VAPID ES256 usando `@block65/webcrypto-web-push` e o navegador mostra a notificação?

- **Slug**: push-worker · **Data**: 2026-10-24
- **Chamado por**: tarefa T15 (spike S4) de `.specs/features/evolucao-segura/tasks.md`; risco "Lib de push no Worker" do plano em etapas
- **Usar em**: tarefa T142 (`backend/api/src/integracoes/push.ts`) e ADR-011
- **Preparação aprovada**: sim (2026-10-24)

## Pergunta

Rodando no runtime do Worker (workerd, `wrangler dev`), a biblioteca `@block65/webcrypto-web-push` 2.0.0 envia um push com payload cifrado que um Chrome inscrito recebe e exibe, gastando quanto de CPU por envio? (sim/não, com número)

- **Por que importa**: PUSH-01 a PUSH-08 dependem disso; se a biblioteca não roda no Worker, a alternativa é escrever o RFC 8291 à mão.
- **Por que é spike**: motivo 1. Ninguém do projeto usou esta biblioteca, e compatibilidade com o runtime do Worker só se prova rodando.

## Critério de sucesso (congelado na aprovação)

- **Deu certo**: 5 de 5 envios exibidos no Chrome com o texto do payload, resposta 201 do serviço de push, e CPU por envio ≤ 3 ms (medida no deploy de teste, se houver; senão registrada só como estimativa).
- **Deu errado**: a biblioteca não carrega no workerd, ou o serviço de push recusa (401/403) em todas as tentativas.
- **Inconclusivo**: 201 do serviço sem notificação exibida (problema do navegador de teste), ou CPU não medida.
- **Resultado que provaria que não**: erro de import ou de Web Crypto no workerd.
- **Condições da medição**: `wrangler dev` local, chaves VAPID geradas para o teste, Chrome do usuário inscrito numa página local (`http://localhost`), 5 envios.

## Prazo e método

- **Prazo**: 2 horas e 3 tentativas, o que vier primeiro
- **Início**: <gravado ao despachar> · **Limite**: <início + 2 h>
- **Extensão**: nenhuma
- **Método**: (1) Gerar par VAPID. (2) Página local com service worker que se inscreve e mostra o push. (3) Worker com rota que envia ao endpoint inscrito. (4) Usuário abre a página e permite notificações; enviar 5 vezes.
- **Onde roda**: `.specs/spikes/push-worker/codigo/`
- **Ações externas**: o envio chega ao serviço de push do Google (FCM) pelo navegador do usuário; nenhuma conta nova. Exige o usuário abrir a página e permitir notificações.

## A esclarecer

- nenhum
