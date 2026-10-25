# PRD: Evolução Segura

> Documento derivado de [spec.md](../.specs/features/evolucao-segura/spec.md) e [design.md](../.specs/features/evolucao-segura/design.md), aprovados em 2026-10-24. A spec manda: em caso de divergência, vale a spec. Itens sem fonte na spec ou no design não entram aqui; o que depende de decisão ainda aberta vai como `[A ESCLARECER]`.

## 1. Problema

O profissional de saúde autônomo (psicólogo, nutricionista, fisioterapeuta) precisa de prontuário, agenda e controle de recebimentos num só lugar, com dado sensível protegido. Hoje usa documentos soltos. O app já existe (legado), mas roda fora do padrão LJS: NestJS numa VM, acesso por whitelist, sem cobrança. A recriação publica o mesmo produto no padrão LJS, com cadastro aberto, planos Free e Pro e custo de infraestrutura zero. (Fonte: spec, Problem Statement.)

## 2. Objetivos

1. Todas as telas do legado no escopo funcionam em `/app` com o mesmo layout.
2. Cadastro, trial de 14 dias e Free ou Pro (Pix pelo Asaas, sandbox) rodam de ponta a ponta num teste e2e.
3. O profissional B não lê nem escreve nenhum dado de A (teste de isolamento verde no CI, em todas as tabelas de negócio).
4. Backup diário cifrado roda, e uma restauração a partir de cópia limpa é executada e registrada antes da publicação.
5. App publicado no domínio próprio pelo `deploy.yml`, com custo fixo mensal de R$ 0.

## 3. Público

Profissional de saúde autônomo que atende pacientes individuais. O visitante chega pela landing em `/` e vira usuário pelo cadastro aberto (CAD-01). Cada profissional enxerga só os próprios dados (ISO-01, ISO-02).

## 4. Planos

| Plano | Condição                                                                                                     | Fonte            |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------- |
| Trial | 14 dias a partir da confirmação do e-mail, sem cartão, sem limite de pacientes                               | CAD-04, PLANO-02 |
| Free  | Até 5 pacientes ativos; com 5 ou mais, bloqueia só criar e reativar paciente; o que existe continua editável | PLANO-03, D-20   |
| Pro   | R$ 19,90 por mês, por Pix pelo Asaas, sem limite de pacientes                                                | PUB-01, PLANO-05 |

Estados da assinatura: `trial`, `ativa`, `atrasada`, `cancelada`, `free` (PLANO-01). Atraso tem 7 dias de tolerância antes de cair para `free` (PLANO-10, D-21). O trial vencido vira `free` sem apagar dados (PLANO-04).

## 5. Escopo funcional (P1 e P2)

| Área                     | O que o profissional faz                                            | Critérios           |
| ------------------------ | ------------------------------------------------------------------- | ------------------- |
| Cadastro                 | Cria a conta e confirma o e-mail                                    | CAD-01 a CAD-09     |
| Acesso                   | Entra com senha e código por e-mail; recupera a senha; sai          | AUTH-01 a AUTH-19   |
| Perfil                   | Informa dados, uma especialidade e os dias de atendimento           | PERF-01 a PERF-09   |
| Pacientes                | Cadastra, busca, inativa, reativa e registra o TCLE                 | PAC-01 a PAC-07     |
| Agenda                   | Agenda sessões avulsas e séries, marca o que aconteceu              | AGE-01 a AGE-17     |
| Anamnese                 | Registra a anamnese num modelo configurável; retifica depois do dia | ANA-01 a ANA-09     |
| Evoluções                | Registra a evolução da sessão; corrige só por retificação           | EVO-01 a EVO-07     |
| Financeiro               | Define valores, registra pagamentos, vê débitos                     | FIN-01 a FIN-08     |
| Início                   | Vê a semana e o dia de hoje                                         | INI-01 a INI-03     |
| Planos                   | Testa grátis, usa o Free ou assina o Pro; cancela                   | PLANO-01 a PLANO-15 |
| Exportação               | Exporta um prontuário (PDF) ou tudo (.zip com `dados.json` e PDFs)  | EXP-01 a EXP-07     |
| Conta                    | Exclui a conta levando antes os dados; desiste em 30 dias           | CONTA-01 a CONTA-06 |
| Auditoria                | Vê a trilha da conta e o histórico do paciente                      | AUD-01 a AUD-04     |
| Público e PWA            | Landing, termos, privacidade, instalação no celular                 | PUB-01 a PUB-05     |
| Rascunhos e modelos (P2) | Não perde o texto digitado; reutiliza textos                        | RAS-01 a RAS-04     |
| Push (P2)                | Recebe aviso de sessão, evolução pendente e cobrança                | PUSH-01 a PUSH-08   |

## 6. Fora do escopo

Login com Google; IA em qualquer plano; relatórios e resumos; PDF gerado no servidor; migração de dados do legado; whitelist e convite; inatividade configurável; navegação por dia no Início; exportação em CSV; encerrar outras sessões pelo usuário; ambiente de homologação; várias especialidades por profissional. Motivos na spec, seção Out of Scope.

## 7. Critérios de sucesso do produto

Os cinco objetivos da seção 2, verificados pelo e2e (cadastro, login com 2FA, assinar no sandbox, agenda para evolução para pagamento), pelo teste de isolamento no CI, pelo `backup.yml` e pela restauração registrada, e pelo `deploy.yml`.

## 8. Premissas e pendências

| Item                                         | Situação                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Conta de produção do Asaas (PJ ou MEI)       | Não existe. Construção e testes no sandbox; a conta é pré-requisito só para publicar a cobrança (D-26)                                |
| Prazo legal de guarda do prontuário          | `[A ESCLARECER]` parecer jurídico sobre 5 anos (CFP 001/2009) ou 20 anos (Lei 13.787/2018), antes de abrir para usuários reais        |
| Revisão jurídica dos termos e da privacidade | Textos-base escritos na construção; revisão por advogado antes de usuários reais                                                      |
| Subdomínio do app                            | `[A ESCLARECER]` raiz `evolucaosegura.com.br` ou outro, sem colidir com o legado em `app.`; definido na implantação por `URL_PUBLICA` |
| `privacidade_agenda`                         | PREMISSA: comportamento do legado, a confirmar ao portar a tela                                                                       |
| CPF/CNPJ obrigatório para assinar            | PREMISSA: o Asaas exige; provar no sandbox (spike S3)                                                                                 |
