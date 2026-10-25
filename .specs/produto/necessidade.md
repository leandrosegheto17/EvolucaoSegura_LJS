# Necessidade: Evolução Segura (recriação no padrão LJS)

- **Data**: 2026-10-24
- **Veredito**: construir
- **Motivo de construir**: outro. Recriar o app existente (`C:\Leandro\Projetos\EvolucaoSeguraWeb`) no padrão de stack, infraestrutura e deploy da LJS Software, como um dos apps publicados da LJS. A pesquisa de mercado foi dispensada pelo usuário: a infraestrutura e o desenvolvimento têm custo zero, e escala só será pensada se surgirem usuários reais.
- **Fluxo**: aberto pelo fluxo 2 (uso próprio), mas o produto tem cadastro aberto, planos e cobrança. O usuário escolheu seguir por aqui. As fases de cobrança, liberação e LGPD entram como requisitos da spec.
- **Entradas**: o padrão LJS em [padrao-ljs.md](padrao-ljs.md) (prompt do usuário, sem alterações) e a análise do legado em [analise-legado.md](analise-legado.md).
- **Aprovação das fases 1 a 3**: aprovada pelo usuário em 2026-10-24 (seguir numa sessão nova).
- **Mockup**: dispensado — layout das telas do legado reaproveitado (D-04); as telas novas do padrão LJS são feitas direto no código com os tokens e componentes do legado, por escolha do usuário em 2026-10-24.

## 1. Necessidade

- **O que resolve**: prontuário e agenda para o profissional de saúde autônomo (psicólogo, com outras especialidades): agenda semanal, pacientes, anamnese configurável, evoluções com janela de edição e retificação, controle de valores e pagamentos recebidos, exportação e auditoria. Tudo com isolamento por usuário e foco em dado sensível.
- **Como faço hoje**: documentos do Word soltos. O legado existe, mas roda fora do padrão LJS (NestJS numa VM, acesso por whitelist).
- **Frequência de uso**: diária.

## 2. O que já existe

| Solução | Cobre | Não cobre | Fonte |
|---|---|---|---|
| Legado EvolucaoSeguraWeb | Todo o domínio clínico, financeiro, layout, RLS, sessão | Padrão LJS (Worker, Hono, Hyperdrive, Asaas, push, Sentry, cadastro aberto, bcrypt no Postgres) | [analise-legado.md](analise-legado.md) |

- **Conclusão**: construir do zero neste repositório, reaproveitando do legado as regras, o domínio puro, os schemas Zod, a base das migrations, os testes de garantia e **100% do layout** (o código atual de `frontend/src` é a fonte de verdade). A pesquisa de soluções de terceiros foi dispensada pelo usuário.

## 3. Escopo

### Essencial (entra)

- **Padrão LJS completo**: monorepo, Worker com Hono e assets, Neon via Hyperdrive, RLS, auth própria, Resend, Asaas, Web Push, rate limit, Sentry, backup no Actions, CI/CD, PWA, landing, "Meu plano", termos e privacidade, exclusão de conta, README e runbook.
- **Do legado**: agenda (sessões, séries, conflito, fim de semana, status), pacientes (cadastro, inativar/reativar, TCLE), anamnese com modelo configurável, evoluções (janela do dia, retificação), rascunhos, modelos de texto, preço por paciente e por sessão, pagamentos, débitos, Início (resumo), exportação, auditoria, perfil e configurações.

### Fica de fora

- Login com Google (OIDC).
- IA (geração de relatórios), em qualquer plano.
- Relatórios/resumos (rascunho → entregue).
- PDF gerado no servidor. A exportação continua, mas o PDF é montado no navegador.
- Migração de dados do legado: o banco novo começa do zero, e o legado segue no ar até o usuário desligar.
- Whitelist de e-mails.

### Decisões do usuário (2026-10-24)

| # | Tema | Decisão |
|---|---|---|
| D-01 | Escopo | Tudo do legado, menos Google, IA e relatórios |
| D-02 | Acesso | Cadastro aberto (padrão LJS) + **2FA por e-mail em todo login** (como no legado) |
| D-03 | Dados do legado | Começar do zero, sem migração |
| D-04 | Layout | Código atual de `frontend/src` é a fonte de verdade; os mockups `.html` são só referência |
| D-05 | Plano Pro | **R$ 19,90/mês**, sem limite (Pix, assinatura Asaas) |
| D-06 | Plano Free | **Até 5 pacientes ativos**; o resto liberado. Aplicado na API |
| D-07 | Trial | 14 dias sem cartão; ao expirar cai para Free sem apagar dados, e o excedente fica somente leitura (padrão LJS) |
| D-08 | Exclusão de conta | Exportação completa obrigatória antes; o profissional declara que assume a guarda do prontuário; purga em 30 dias. Termos: profissional = controlador, LJS = operadora |
| D-09 | Exportação | Mantida como no legado (prontuário por paciente + completa). PDF montado no navegador a partir de JSON da API; a completa é um .zip com os PDFs e um JSON |
| D-10 | Falta/cancelamento | **Não** gera débito por padrão; o profissional marca "cobrar" (segue o PRD Q4; muda o `cobravel` default true do código) |
| D-11 | Realizada → cancelada | Permitido só se a sessão não tiver evolução nem pagamento |
| D-12 | Evolução e status | Registrar evolução ligada a sessão agendada muda o status para **realizada** automaticamente |
| D-13 | Evoluções por sessão | **No máximo uma** por sessão (índice único); complemento vira retificação. Evolução sem sessão continua permitida |
| D-14 | Desligar sábado/domingo | Avisa quantas sessões futuras existem nesses dias e as mantém; bloqueia só criar ou mover para lá |
| D-15 | Especialidade | **Uma só** por profissional (perfil único, como no PRD), com um modelo de anamnese |
| D-16 | Contato do paciente | Telefone, e-mail e endereço (como o código); só o nome é obrigatório |
| D-17 | Push | Sessão próxima, evolução pendente (fim do dia) e cobrança/plano. Sem resumo do dia |
| D-18 | Inatividade | Fixa em 15 min (padrão LJS); a opção 5/10/15/30 sai das configurações |
| D-19 | Domínio | Reaproveitar o domínio pago já usado pelo legado (`evolucaosegura.com.br`, PREMISSA pelo CSP do legado) |

- **Bom o bastante quando**: as telas do legado funcionam iguais em `/app`, o cadastro com trial, Free e Pro (Pix pelo Asaas) roda de ponta a ponta, e o app está publicado no domínio com backup diário restaurado com sucesso.

## 4. Restrições

- **Onde roda**: nuvem gratuita (Cloudflare Workers + Neon Free via Hyperdrive). Localmente, Docker só para o Postgres.
- **Limites dos planos gratuitos** (consulta em 2026-10-24, agente pesquisador; confiança alta, salvo indicação):

| Serviço | Limite | Fonte |
|---|---|---|
| Workers Free | 100.000 requisições/dia; **10 ms de CPU** por requisição e por cron; 50 subrequests por invocação; **5 Cron Triggers por conta**; assets: 20.000 arquivos, 25 MiB cada | developers.cloudflare.com/workers/platform/limits/ |
| Rate Limiting binding | Por localização (não é contador global); disponibilidade no Free **não confirmada** (confiança baixa) | developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ |
| Custom domain | Exige zona ativa na Cloudflare | developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| Hyperdrive Free | Disponível; 10 configs; ~20 conexões à origem; 100.000 consultas/dia (confiança média) | developers.cloudflare.com/hyperdrive/platform/limits/ |
| Neon Free | 1 GB por projeto; 100 CU-h/mês; autosuspend de 5 min (cold start); 10 branches; restore de 6 h; sa-east-1 disponível | neon.com/docs/introduction/plans |
| Resend Free | **100 e-mails/dia**, 3.000/mês, 3 domínios | resend.com/pricing |
| Sentry Developer | 5k erros; retenção de 30 dias (confiança média) | sentry.io/pricing/ |
| GitHub Actions (privado) | 2.000 min/mês; **500 MB de artefatos**; retenção padrão de 90 dias | docs.github.com (billing de Actions) |
| Asaas | Pix: R$ 1,99 por cobrança recebida (R$ 0,99 nos 3 primeiros meses); sandbox disponível (confiança média) | asaas.com/precos-e-taxas, docs.asaas.com/docs/sandbox |
- **Stack**: a do padrão LJS (já dominada pelo usuário; o legado usa quase toda).
- **Exposição**: internet, com autenticação, HTTPS, 2FA, rate limit e auditoria de segurança na validação.

## 5. Dados e backup

- **Dados guardados**: prontuário (anamnese, evoluções), agenda, dados de pacientes, valores e pagamentos, contas e assinaturas. **Dado pessoal sensível de saúde** (LGPD art. 11).
- **Custo de perder**: alto, porque o profissional tem obrigação legal de guardar o prontuário.
- **Backup**: diário às 04:00 BRT no GitHub Actions, `pg_dump -Fc` com a role `backup_ro`, cifrado com `age`, retenção de 30 dias, e branch de restauração no Neon antes de cada deploy (padrão LJS).
- **Teste de restauração**: obrigatório na validação, a partir de uma cópia limpa, e documentado no runbook.

## 6. Riscos e dúvidas

- **CPU de 10 ms no Worker**: o hash de senha vai para o Postgres (bcrypt/pgcrypto), o PDF para o navegador, e push e e-mail são I/O. Cálculos de agenda e débito devem caber; medir no CI.
- **Estado em memória do legado** (cooldown do 2FA, limites de exportação): passa para tabela ou binding.
- **Cron Triggers**: o limite é de 5 por **conta**, e os três apps LJS dividem a mesma conta. Este app deve usar **um único cron** frequente (ex.: a cada 5 min) que despacha lembrete, evolução pendente, cobrança e expiração do trial. Cada execução também tem 10 ms de CPU, então o envio de push vai em lotes.
- **Resend: 100 e-mails/dia**. Com 2FA em todo login, cada login gasta 1 e-mail, além de confirmação, recuperação e cobrança. Dá para começar, mas esse é o primeiro limite a estourar com usuários reais (alerta e plano B no runbook). Os 3 domínios do Free são compartilhados com os outros apps LJS.
- **Neon: 1 GB** e cold start depois de 5 min parado; a primeira requisição depois da pausa fica mais lenta.
- **Artefatos do Actions: 500 MB** no total. O dump diário com 30 dias de retenção precisa caber; medir o tamanho do dump e, se precisar, guardar em outro lugar.
- **Rate Limiting binding** não está confirmado no Free: provar num spike na preparação; se não existir, usar contador em tabela.
- **Asaas**: R$ 1,99 por Pix sobre R$ 19,90 dá cerca de 10% por cobrança. Não é custo fixo, mas reduz a receita.
- **LGPD e saúde**: termos e privacidade precisam de revisão por advogado antes de usuários reais. A guarda mínima é de **5 anos** (Resolução CFP 001/2009, ainda vigente, citada pela 06/2019 art. 15; confiança média). Uma fonte secundária fala em 20 anos pela Lei 13.787/2018 (prontuário digitalizado), sem confirmação: **pedir parecer jurídico** antes de abrir para usuários reais. Isso afeta D-08.
- **Domínio**: o custom domain no Worker exige a zona DNS do domínio do legado na Cloudflare. [A ESCLARECER: onde o domínio está registrado e qual DNS usa hoje.]
- **[A ESCLARECER: antecedência do lembrete de "sessão próxima" (ex.: 30 min) e horário do aviso de evolução pendente.]**
- **Asaas**: ainda não há conta ou CNPJ definidos. [A ESCLARECER: a conta Asaas já existe (PJ/MEI)?]
- **Testes do legado**: a suíte não está confirmada como verde; os testes reaproveitados precisam passar aqui.
