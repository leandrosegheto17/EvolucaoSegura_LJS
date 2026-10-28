# Guardrails: Evolução Segura

> Regras de trabalho do projeto. Origem: [padrão LJS](../.specs/produto/padrao-ljs.md), [spec](../.specs/features/evolucao-segura/spec.md), [design](../.specs/features/evolucao-segura/design.md) e as regras do `CLAUDE.md`. Quebrar uma regra daqui exige ADR em [adr/](adr/).

## 1. Testes (inegociável)

- Toda mudança de comportamento tem teste automatizado que falharia sem ela. Correção de bug começa pelo teste que reproduz o bug.
- Os testes nascem do critério de aceite da spec, nunca do código já escrito.
- Nunca apagar, pular, comentar ou enfraquecer um teste para fazê-lo passar. Mudar um teste existente exige motivo registrado e aprovação do usuário.
- Teste copiado do legado só entra se passar verde aqui.
- Toda tabela de negócio entra no teste de isolamento (profissional B não lê nem escreve nada de A). O teste varre o catálogo do banco, então uma tabela nova sem RLS forçada falha o CI.
- Antes de integrar ou implantar: `python .claude/scripts/trava-testes.py --rodar` com tudo commitado e a suíte verde.
- Gate de cada tarefa: o executor de testes decide, não a opinião de quem escreveu.

## 2. Deploy e infraestrutura

- `wrangler deploy` existe **só** no `.github/workflows/deploy.yml`. Um teste da suíte falha se o comando aparecer em outro arquivo (OPS-04).
- O `deploy.yml` roda só por `workflow_dispatch`, só pela `main`, no environment `producao`, com `concurrency` sem cancelamento, na ordem fixa do OPS-03.
- Push, deploy, criação de recursos na Cloudflare, Neon, Asaas ou Resend e qualquer ação externa exigem confirmação específica do usuário, mesmo com a fase aprovada.
- Nenhuma dependência paga. Se algo exigir plano pago, parar e perguntar.
- Sem ambiente de homologação: o preview é `wrangler dev` local.
- Nenhuma URL absoluta do app no código ou no banco. A única fonte é `URL_PUBLICA` (OPS-10).

## 3. Segredos

- Segredos só em GitHub Secrets (environment `producao`) e `wrangler secret`. Nunca em arquivo versionado.
- `.env.example` lista toda variável com obrigatoriedade, formato e se é segredo; o gitleaks roda no CI.
- O usuário fornece a chave do Asaas sandbox, o token do Resend e o DSN do Sentry quando a tarefa pedir.
- Chave privada do `age` fica fora do GitHub.

## 4. Banco e isolamento

- Toda tabela de negócio tem `usuario_id`, RLS com `FORCE ROW LEVEL SECURITY` e `criado_em`. As editáveis têm `row_version`.
- A API abre uma transação por requisição com `SET LOCAL app.usuario_id`. Nada acessa o banco fora de `comTransacao`.
- A role `evolucao_app` não tem DELETE nem TRUNCATE nas tabelas de dado clínico, financeiro e de auditoria. DDL só pela role `evolucao_owner`, nas migrations.
- Funções `SECURITY DEFINER` do schema `tarefas`: `search_path` fixo, parâmetros tipados, sem SQL dinâmico; a `evolucao_app` executa só as listadas.
- Uma migration por mudança, sempre em transação, aplicada do zero no CI.
- Hash de senha só no Postgres (`crypt()` com `gen_salt('bf', 12)`), com a senha como parâmetro. O Worker não calcula hash nem gera PDF (OPS-14). Nenhuma biblioteca de hash de senha ou de PDF em `backend/api`.
- Auditoria só de inclusão, na mesma transação, sem conteúdo clínico.

## 5. Dados clínicos e privacidade

- Prontuário, sessões e pagamentos não se apagam pela aplicação: inativar, mudar de status ou retificar.
- Push, e-mail, log e Sentry não carregam nome de paciente nem texto clínico. O Sentry recebe release igual ao SHA e sem corpo, cookie ou e-mail (OPS-08, PUSH-05).
- Recurso de outro profissional responde 404 idêntico ao de inexistente.
- Respostas de `/api/*` com `Cache-Control: no-store`.

## 6. Código

- Português do Brasil em documentos, commits, pastas, tabelas e rotas. Identificadores seguem o padrão LJS.
- Dinheiro em centavos inteiros; datas de calendário em `America/Sao_Paulo`; "hoje" e janelas de edição pelo relógio do banco.
- Regras de negócio puras em `backend/dominio`, sem I/O. Contrato Zod em `backend/contrato`, única fonte entre API e front.
- Legado em `C:\Leandro\Projetos\EvolucaoSeguraWeb` é somente leitura: copiar o arquivo, adaptar e trazer o teste.
- Mudança só do escopo da tarefa. Divergência da spec ou do design recebe `SPEC_DEVIATION` no código e vai ao relatório.

## 7. Commits e fluxo

- Um commit atômico por tarefa, em Conventional Commits e em português, validado por `check_commit.py`. Código, testes e o status em `tasks.md` vão no mesmo commit.
- Ao fechar cada etapa, relatório LJS: o que foi feito, como validar e o que vem a seguir (AD-002).
- Decisão de arquitetura vira ADR em `.md/adr/NNN-titulo.md`; decisão que muda uma anterior usa `Supersedes:`.
- Tarefa que falha ou bloqueia: parar e relatar. Não começar a próxima.
