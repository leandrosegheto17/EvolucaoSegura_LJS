# Spike: a exportação completa de um profissional com volume realista cabe em 10 ms de CPU no Worker do plano Free?

- **Slug**: cpu-exportacao · **Data**: 2026-10-24
- **Chamado por**: tarefa T12 (spike S1, parte de CPU) de `.specs/features/evolucao-segura/tasks.md`; risco "CPU de 10 ms" do `design.md`
- **Usar em**: `design.md`, Risks & Concerns (linha da CPU); tarefa T122 (exportação completa) e ADR-008
- **Preparação aprovada**: sim (2026-10-24)

## Pergunta

Quanto tempo de CPU (ms, mediana e máximo) o Worker gasta para ler e serializar em JSON a exportação completa de um profissional com volume realista? (número)

- **Por que importa**: acima de 10 ms o Worker do plano Free é encerrado (erro 1102) e a exportação, pré-requisito da exclusão de conta (CONTA-01), não funciona.
- **Por que é spike**: motivo 3. O consumo só aparece rodando no runtime real; o ambiente local não mede nem aplica o limite de CPU.

## Critério de sucesso (congelado na aprovação)

- **Deu certo**: mediana **≤ 5 ms** e máximo **≤ 8 ms** de CPU em 20 execuções (folga de 20% sob o limite).
- **Deu errado**: mediana **> 10 ms**, ou mais de 2 das 20 execuções encerradas por limite de CPU.
- **Inconclusivo**: mediana entre 5 e 10 ms, ou CPU medida só localmente.
- **Resultado que provaria que não**: mediana acima de 10 ms.
- **Condições da medição**: Worker de teste em `workers.dev` (plano Free), CPU lida no painel da Cloudflare ou em `wrangler tail` (campo de CPU por invocação). Volume falso: 300 pacientes, 15.000 sessões, 15.000 evoluções de 1.500 caracteres, 1 anamnese por paciente, 15.000 pagamentos e 30.000 eventos de auditoria (PREMISSA: cerca de 5 anos de um consultório cheio). 20 execuções.

## Prazo e método

- **Prazo**: 2 horas e 2 tentativas, o que vier primeiro
- **Início**: 2026-10-24 22:07 · **Limite**: 2026-10-25 00:07
- **Extensão**: nenhuma
- **Método**: (1) Popular a branch do Neon do spike `set-local-hyperdrive` com o volume falso. (2) Rota que lê tudo por Kysely e devolve o JSON. (3) Chamar 20 vezes e ler a CPU por invocação. (4) Segunda tentativa, só se a primeira der errado: streaming do JSON por tabela.
- **Onde roda**: `.specs/spikes/cpu-exportacao/codigo/`
- **Ações externas**: as mesmas do spike `set-local-hyperdrive` (reaproveita o Worker de teste, o Hyperdrive e a branch do Neon), com confirmação específica.

## A esclarecer

- Resolvido em 2026-10-24: volume falso aprovado pelo usuário como está (segue PREMISSA quanto ao maior cliente real).
