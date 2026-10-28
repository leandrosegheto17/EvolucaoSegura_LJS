# Especificação: Evolução Segura (recriação no padrão LJS)

- **Data**: 2026-10-24
- **Tamanho**: Complex (domínio clínico e financeiro, cobrança, push, LGPD, infraestrutura nova)
- **Entradas**: [necessidade.md](../../produto/necessidade.md) (decisões D-01 a D-19), [padrao-ljs.md](../../produto/padrao-ljs.md), [analise-legado.md](../../produto/analise-legado.md) e o mapa de comportamentos do legado levantado em 2026-10-24 (citações `legado:arquivo:linha` relativas a `C:\Leandro\Projetos\EvolucaoSeguraWeb`).
- **Aprovação**: spec aprovada pelo usuário em 2026-10-24 (Specify da fase 4).
- **Decisões desta fase**: D-20 a D-31, na seção Assumptions & Open Questions e em [context.md](context.md).
- **Convenções dos critérios**: "API" é o Worker Hono em `/api/*`; "evolucao_app" é o front em `/app`. Dinheiro em **centavos inteiros**; datas de calendário em `America/Sao_Paulo`. Corpo de erro no formato problem+json com o campo `codigo`. Recurso de outro profissional responde **404 idêntico** ao de inexistente.

## Problem Statement

O profissional de saúde autônomo (psicólogo, nutricionista, fisioterapeuta) precisa de prontuário, agenda e controle de recebimentos num só lugar, com dado sensível protegido; hoje usa documentos soltos. O app já existe (legado), mas roda fora do padrão LJS (NestJS numa VM, acesso por whitelist, sem cobrança). A recriação publica o mesmo produto no padrão LJS, com cadastro aberto, planos Free/Pro e custo de infraestrutura zero.

## Goals

- [ ] Todas as telas do legado no escopo funcionam em `/app` com o mesmo layout (comparação visual tela a tela sem diferença não justificada).
- [ ] Cadastro → trial de 14 dias → Free ou Pro (Pix pelo Asaas, sandbox) roda de ponta a ponta num teste e2e.
- [ ] Profissional B não lê nem escreve nenhum dado de A (teste de isolamento verde no CI, em todas as tabelas de negócio).
- [ ] Backup diário cifrado roda e uma restauração a partir de cópia limpa é executada e registrada antes da publicação.
- [ ] App publicado no domínio próprio pelo `deploy.yml`, com custo fixo mensal R$ 0.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Login com Google (OIDC) | D-01 |
| IA (geração de texto, pseudonimização, ciência do paciente) | D-01, em qualquer plano |
| Relatórios/resumos (rascunho → entregue) | D-01; os modelos de texto do tipo `relatorio` também saem |
| PDF gerado no servidor | D-09: o PDF é montado no navegador |
| Migração de dados do legado | D-03: banco novo começa vazio |
| Whitelist de e-mails e primeiro acesso por convite | Substituídos pelo cadastro aberto (D-02) |
| Inatividade configurável (5/10/15/30) | D-18: fixa em 15 min |
| Navegação por dia no Início | D-23: só hoje, como o código do legado |
| Exportação completa em CSV | D-09 define .zip com PDFs e JSON (D-29) |
| Encerrar outras sessões pelo usuário | Não existe no legado; fora do escopo de recriação |
| Ambiente de homologação | Padrão LJS: preview é `wrangler dev` local |
| Várias especialidades por profissional | D-15 |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| D-20 Free com mais de 5 pacientes ativos | Bloqueia só criar e reativar paciente enquanto houver 5 ou mais ativos; tudo o que existe continua editável | Não impedir o registro clínico, que é obrigação legal; substitui o "excedente somente leitura" de D-07 | y (usuário, 2026-10-24) |
| D-21 Tolerância de atraso | 7 dias após o vencimento em `atrasada`, com aviso; depois `free` | Escolha do usuário | y |
| D-22 Push "sessão próxima" | 15 min antes do início | Escolha do usuário | y |
| D-23 Push "evolução pendente" e Início | Às 20:00; Início mostra só hoje | Escolha do usuário | y |
| D-24 Inativar paciente | Sessões futuras ficam como estão | Comportamento do legado; escolha do usuário | y |
| D-25 Domínio | `evolucaosegura.com.br`, zona já na Cloudflare; subdomínio do app definido no deploy por `URL_PUBLICA` | Usuário confirmou a zona na Cloudflare; o legado usa `app.` (`legado:wrangler.jsonc:13`) e segue no ar | y (zona); subdomínio n |
| D-26 Asaas | Construção e testes no sandbox; conta de produção (PJ/MEI) é pré-requisito só para publicar a cobrança | Conta ainda não existe | y |
| D-27 Remetente | `@evolucaosegura.com.br`, verificado no Resend (usa 1 dos 3 domínios do Free) | Escolha do usuário | y |
| D-28 Desistir da exclusão | Link no e-mail, válido pelos 30 dias até a purga | Escolha do usuário | y |
| D-29 Exportação completa | `.zip` montado no navegador com `dados.json` e um PDF de prontuário por paciente; sem CSV | D-09 | n |
| D-30 Exclusão exige exportação | Exportação completa servida nas últimas 24 h, declaração de guarda e senha | D-08 pede exportação obrigatória antes; 24 h evita exportação antiga | n |
| D-31 Purga | Apaga todas as linhas do profissional (inclusive auditoria) e guarda só `conta_excluida` (id, data do pedido, data da purga), sem dado pessoal | Exclusão LGPD; sem conta não há a quem mostrar a trilha | n |
| Cadastro com e-mail já cadastrado | Mesma resposta 202; envia ao dono um e-mail "você já tem conta" com link de recuperação | Anti-enumeração do padrão LJS sem deixar o dono sem saída | n |
| Cadastro repetido de e-mail não confirmado | Substitui nome e senha pendentes e invalida o token anterior | Evita conta presa num token perdido | n |
| Confirmação de e-mail | Não abre sessão; o profissional entra com senha e 2FA; o trial começa na confirmação | Login sempre com 2FA (D-02) | n |
| Primeiro uso | Sem nome e especialidade no perfil, o app leva a `/app/perfil` antes de qualquer outra tela | Cadastro aberto não traz perfil; a anamnese depende da especialidade | n |
| Troca de especialidade | Permitida enquanto não houver anamnese registrada; depois, 409 `SPECIALTY_HAS_ANAMNESIS` | Com uma só especialidade (D-15), é o equivalente da desativação do legado | n |
| Desligar sábado/domingo com sessões (D-14) | Sem `confirmar: true`, 409 `WEEKEND_DAY_HAS_SESSIONS` com a contagem; com ele, salva e mantém as sessões | Mostra o aviso antes de salvar | n |
| `privacidade_agenda` | Mantida com o comportamento do código do legado (confirmar na construção ao portar a tela) | Faz parte do "resto do legado" (D-01); comportamento não mapeado nesta fase. PREMISSA | n |
| Assinar exige CPF/CNPJ | Pedido no "Meu plano" ao assinar | O Asaas exige CPF/CNPJ do cliente para cobrança. PREMISSA, provar no sandbox | n |
| Cancelamento do Pro | Cancela no Asaas na hora; segue Pro até `periodo_fim`; depois `free` | Padrão de assinatura; não devolve dinheiro | n |
| Queda para Free por atraso | Cancela a assinatura no Asaas; para voltar, assina de novo | Evita cobranças para quem já caiu | n |
| Push sem dado clínico | Conteúdo do push não traz nome de paciente nem texto clínico | A notificação aparece na tela bloqueada; dado sensível (LGPD art. 11) | n |
| Auditoria nova | Acrescenta `auth.login_ok`, `auth.logout`, `conta.cadastrada`, `conta.exclusao_*` e `assinatura.*` às ações do legado | Produto aberto precisa de trilha de acesso e de cobrança | n |
| Lighthouse PWA ≥ 90 | Trocado por: Chrome reconhece o app como instalável, manifest e service worker válidos | O Lighthouse 12 (2024) removeu a categoria PWA; a nota não é mais medível. Verificar a versão na preparação | n |
| Rate limit | Binding `ratelimits`; se o spike da preparação mostrar que não existe no Free, contador em tabela com os mesmos limites | `necessidade.md` §6 | n |
| D-32 Exportação completa paginada | A API entrega a exportação completa em páginas por tabela com cursor; o navegador junta e monta `dados.json` e `.zip` | O spike `cpu-exportacao` (2026-10-24) mediu cerca de 1 s de CPU e 39,65 MB para o volume de 5 anos, contra 10 ms de CPU por requisição no Free | y (usuário, 2026-10-24) |
| Prazo legal de guarda do prontuário | [A ESCLARECER: parecer jurídico sobre 5 anos (CFP 001/2009) × 20 anos (Lei 13.787/2018)] antes de abrir para usuários reais; não trava a construção | Afeta só os termos e o texto da exclusão | n |
| Revisão jurídica de termos e privacidade | Textos-base escritos na construção; revisão por advogado antes de usuários reais | `necessidade.md` §6 | n |
| Subdomínio do app | [A ESCLARECER: raiz `evolucaosegura.com.br` ou outro subdomínio, sem colidir com o legado em `app.`] até a implantação | Entra só por `URL_PUBLICA` e pela rota do `wrangler.jsonc` | n |

**Open questions:** none que bloqueie a construção. As duas marcadas `[A ESCLARECER]` acima precisam de resposta antes da publicação, não antes do código.

---

## User Stories

### P1: Cadastro com confirmação de e-mail ⭐ MVP

**User Story**: Como profissional, quero criar minha conta sozinho e confirmar meu e-mail para começar o teste grátis.

**Why P1**: Sem cadastro aberto não há produto LJS.

**Acceptance Criteria**:
1. [CAD-01] WHEN o visitante envia nome (1 a 200), e-mail válido, senha que passa na política (AUTH-11) e aceite dos termos para `POST /api/cadastro` THEN a API SHALL responder 202 e enviar um e-mail com link de confirmação.
2. [CAD-02] WHEN o e-mail já tem conta confirmada THEN a API SHALL responder o mesmo 202, com o mesmo corpo, e enviar ao dono um e-mail "você já tem conta" com link de recuperação.
3. The API SHALL gravar o token de confirmação só como SHA-256, com 256 bits de entropia, validade de 30 minutos e uso único. [CAD-03]
4. [CAD-04] WHEN o link de confirmação válido é aberto THEN a API SHALL ativar a conta, iniciar o trial de 14 dias e criar a assinatura com `status = trial` e `periodo_fim` = confirmação + 14 dias.
5. [CAD-05] IF o token de confirmação é inválido, expirado ou já usado THEN a API SHALL responder 400 `link_invalido` sem alterar nenhuma conta.
6. [CAD-06] WHEN um novo cadastro chega para um e-mail ainda não confirmado THEN a API SHALL substituir nome e senha pendentes e invalidar o token anterior.
7. [CAD-07] WHEN a conta é confirmada THEN a API SHALL registrar o aceite dos termos com data, hora e versão dos termos e da política de privacidade.
8. [CAD-08] IF o envio do e-mail de confirmação falha THEN a API SHALL responder o mesmo 202 e registrar o erro no Sentry, sem revelar a falha ao visitante.
9. [CAD-09] WHILE a conta não está confirmada a API SHALL recusar o login com a mesma resposta 401 de senha errada.

**Independent Test**: cadastrar no ambiente local com o e-mail capturado em teste, abrir o link, ver a conta em trial com 14 dias.

---

### P1: Login com 2FA, sessão e recuperação de senha ⭐ MVP

**User Story**: Como profissional, quero entrar com senha e código por e-mail e ter a sessão encerrada quando me afasto, para proteger o prontuário.

**Why P1**: Dado de saúde exige autenticação forte (D-02).

**Acceptance Criteria**:
1. [AUTH-01] WHEN e-mail e senha corretos chegam a `POST /api/auth/entrar` THEN a API SHALL responder 202 `{status: "2fa_required"}` e enviar um código de 6 dígitos por e-mail, sem criar sessão.
2. [AUTH-02] IF a senha está errada, o e-mail não existe, a conta não está confirmada ou a conta está bloqueada para exclusão THEN a API SHALL responder 401 com o mesmo corpo e tempo de resposta equivalente (o hash é calculado também no caminho de e-mail inexistente).
3. The API SHALL gerar o código 2FA com CSPRNG, guardar só o HMAC-SHA256 dele, aceitá-lo por 10 minutos e uma única vez. [AUTH-03]
4. [AUTH-04] WHEN o código correto chega a `POST /api/auth/2fa/verificar` dentro da validade THEN a API SHALL criar a sessão, definir o cookie `__Host-sid` (Path=/, Secure, HttpOnly, SameSite=Lax, sem Domain) e responder 200 com o token CSRF.
5. [AUTH-05] IF o código errado é enviado 5 vezes no mesmo desafio THEN a API SHALL invalidar o desafio e recusar novos códigos dele com 401.
6. [AUTH-06] WHEN o reenvio do código é pedido THEN a API SHALL responder 202 com o mesmo corpo em todos os casos e só enviar novo código se o último envio tiver mais de 60 segundos (medido pelo relógio do banco).
7. [AUTH-07] WHEN um e-mail ou um IP acumula 5 falhas de login em 15 minutos THEN a API SHALL bloquear novas tentativas desse e-mail ou IP por 15 minutos com 429 e cabeçalho `Retry-After` em segundos, guardando o estado em tabela.
8. [AUTH-08] IF o envio do e-mail do código 2FA falha THEN a API SHALL responder 503 `mail_unavailable` sem contar falha de login.
9. The API SHALL guardar a sessão como SHA-256 de um id de 256 bits (CSPRNG) e encerrá-la após 15 minutos sem requisição autenticada ou 12 horas desde o login, o que vier primeiro. [AUTH-09]
10. [AUTH-10] WHEN um login é concluído THEN a API SHALL criar um id de sessão novo e encerrar a sessão anterior apresentada no mesmo navegador.
11. [AUTH-11] IF a senha tem menos de 12 ou mais de 128 caracteres, está na lista de senhas comuns (após NFKC, minúsculas e sem espaços) ou é um único caractere repetido THEN a API SHALL responder 422 com o motivo `curta`, `longa` ou `comum`.
12. The API SHALL calcular e conferir o hash de senha no Postgres com `crypt()` e `gen_salt('bf', 12)`, sempre passando a senha como parâmetro. [AUTH-12]
13. [AUTH-13] WHEN a recuperação de senha é pedida THEN a API SHALL responder 202 vazio em todos os casos e, se a conta existir, enviar link com token de 256 bits (SHA-256 no banco), válido por 30 minutos e de uso único, invalidando pedidos anteriores.
14. [AUTH-14] WHEN a nova senha é confirmada com token válido THEN a API SHALL trocar o hash, encerrar todas as sessões do profissional e responder 204, sem abrir sessão.
15. [AUTH-15] IF o token de recuperação é inválido THEN a API SHALL responder 400 `link_invalido` antes de avaliar a política de senha.
16. [AUTH-16] WHEN `POST /api/auth/sair` é chamado THEN a API SHALL encerrar a sessão (sem DELETE), limpar o cookie com `Max-Age=0` e responder 204.
17. [AUTH-17] IF uma requisição autenticada que altera dados chega sem o cabeçalho `x-csrf-token` correto THEN a API SHALL responder 403 sem executar a operação.
18. [AUTH-18] WHILE faltam 120 segundos para a inatividade de 15 minutos o app SHALL mostrar o diálogo "Sua sessão vai expirar" com contagem regressiva; "Continuar conectado" renova a sessão.
19. [AUTH-19] WHEN a sessão expira THEN o app SHALL limpar os dados em cache e levar a `/sessao-expirada`, preservando rascunhos para restauração.

**Independent Test**: entrar com código capturado do e-mail de teste; errar 5 vezes e ver o 429; deixar 15 min parado (relógio simulado) e ver a sessão expirar.

---

### P1: Isolamento entre profissionais ⭐ MVP

**User Story**: Como profissional, quero ter certeza de que nenhum outro usuário vê meus pacientes.

**Why P1**: Produto multi-inquilino com dado sensível.

**Acceptance Criteria**:
1. The banco SHALL ter `usuario_id` e RLS com `FORCE ROW LEVEL SECURITY` em toda tabela de negócio, e a API SHALL abrir uma transação por requisição com `SET LOCAL app.usuario_id`. [ISO-01]
2. [ISO-02] WHEN o profissional B lê, altera ou cria referência a qualquer recurso de A por id THEN a API SHALL responder 404 idêntico ao de recurso inexistente, sem alterar dados (teste negativo por tabela de negócio no CI).
3. The role `evolucao_app` SHALL não ter permissão de DELETE nem TRUNCATE nas tabelas de dado clínico, financeiro e de auditoria; DDL só pela role `evolucao_owner` nas migrations. [ISO-03]
4. The role `evolucao_backup_ro` SHALL ter só leitura e conseguir ler todas as linhas para o `pg_dump`. [ISO-04]

**Independent Test**: suíte de isolamento cria dois profissionais e tenta cada operação cruzada.

---

### P1: Perfil, especialidade e configurações ⭐ MVP

**User Story**: Como profissional, quero informar meus dados, minha especialidade e meus dias de atendimento.

**Why P1**: A anamnese e a agenda dependem disso.

**Acceptance Criteria**:
1. [PERF-01] WHILE o perfil não tem nome e especialidade o app SHALL levar qualquer rota de `/app` para `/app/perfil`.
2. The API SHALL aceitar no perfil `nome` (1 a 200, obrigatório), `contato` (até 200), `endereco` (até 300), `atende_sabado` e `atende_domingo` (padrão falso), recusar chave desconhecida com 422 e gravar vazio como null. [PERF-02]
3. The API SHALL aceitar uma única especialidade por profissional: `psicologia`, `nutricao`, `fisioterapia` ou `outra` (esta com nome de 1 a 60), com registro profissional opcional (conselho até 40, número até 40, região até 100). [PERF-03]
4. [PERF-04] WHEN a especialidade é definida THEN a API SHALL criar o modelo de anamnese padrão dela (presets do legado, `legado:backend/src/clinical/model/presets.ts`).
5. [PERF-05] IF a troca de especialidade é pedida e já existe anamnese registrada THEN a API SHALL responder 409 `SPECIALTY_HAS_ANAMNESIS`.
6. [PERF-06] IF desligar sábado ou domingo é pedido sem `confirmar: true` e existem sessões futuras não canceladas nesse dia THEN a API SHALL responder 409 `WEEKEND_DAY_HAS_SESSIONS` com a quantidade, sem salvar.
7. [PERF-07] WHEN desligar sábado ou domingo é pedido com `confirmar: true` THEN a API SHALL salvar e manter as sessões existentes nesse dia.
8. The configurações SHALL conter `privacidade_agenda` (padrão falso, comportamento do legado) e a ativação de push por dispositivo, sem opção de inatividade. [PERF-08]
9. [PERF-09] WHEN perfil ou configuração mudam de fato THEN a API SHALL auditar `perfil.editado` ou `configuracao.alterada` só com nomes de campo; sem mudança, nada é gravado.

**Independent Test**: conta nova cai no perfil; escolher psicologia cria o modelo com 7 campos e 4 alertas.

---

### P1: Pacientes ⭐ MVP

**User Story**: Como profissional, quero cadastrar, buscar, inativar e reativar pacientes e registrar o TCLE.

**Why P1**: Centro do prontuário.

**Acceptance Criteria**:
1. The API SHALL aceitar paciente com `nome` (aparado, 1 a 200, obrigatório), `telefone` (até 40), `email` (até 254, formato `x@y` sem espaços) e `endereco` (até 500), gravar vazio como null e recusar campo extra com 422. [PAC-01]
2. [PAC-02] WHEN a listagem é pedida THEN a API SHALL filtrar por `q` (nome, curingas escapados) e `ativo` (true/false; outro valor = 400), com `limit` de 1 a 100 (padrão 50) e `offset` ≥ 0.
3. [PAC-03] WHEN um paciente é inativado ou reativado THEN a API SHALL só trocar o flag `ativo`, sem tocar no prontuário nem nas sessões futuras, e auditar `paciente.inativado` ou `paciente.reativado`.
4. [PAC-04] WHEN inativar ou reativar não muda o estado THEN a API SHALL responder sucesso sem incrementar `row_version` nem auditar.
5. The API SHALL registrar TCLE só por inclusão (finalidade 1 a 500, versão 1 a 50, data YYYY-MM-DD válida), sem editar nem excluir. [PAC-05]
6. [PAC-06] WHEN a ficha do paciente é aberta THEN a API SHALL auditar `paciente.consultado`.
7. The API SHALL não oferecer exclusão de paciente. [PAC-07]

**Independent Test**: criar, buscar por parte do nome, inativar e ver o paciente fora da lista de ativos.

---

### P1: Agenda ⭐ MVP

**User Story**: Como profissional, quero agendar sessões avulsas e recorrentes, ver a semana e marcar o que aconteceu.

**Why P1**: Uso diário.

**Acceptance Criteria**:
1. The API SHALL aceitar sessão com início e fim em ISO 8601 com offset, anos 2000 a 2100, `fim > inicio` e link opcional (até 500, começando com http:// ou https://); fora disso, 422. [AGE-01]
2. The app SHALL oferecer as durações 30, 45, 50, 60 e 90 minutos, com 50 pré-selecionado. [AGE-02]
3. [AGE-03] WHEN a agenda é listada THEN a API SHALL aceitar o intervalo [de, até) de no máximo 62 dias, com `limit` padrão 50 e máximo 100 e cursor keyset.
4. [AGE-04] IF a sessão nova ou movida cai num horário que se sobrepõe ([início, fim)) a outra `agendada`, `realizada` ou `faltou` sem `confirmar_conflito: true` THEN a API SHALL responder 409 `SCHEDULE_CONFLICT`; sessões que só se encostam não conflitam.
5. [AGE-05] WHEN `confirmar_conflito: true` é enviado THEN a API SHALL gravar a sessão sem alterar a sessão existente.
6. [AGE-06] IF a sessão é criada ou movida para sábado ou domingo desligado no perfil THEN a API SHALL responder 422 `WEEKDAY_UNAVAILABLE`.
7. The API SHALL aceitar só as transições de status: agendada → realizada, faltou, cancelada ou remarcada; realizada → agendada, faltou ou cancelada; faltou → agendada ou realizada; cancelada → agendada; remarcada → agendada; mesmo status é idempotente; outras respondem 422. [AGE-07]
8. [AGE-08] IF realizada → cancelada é pedida e a sessão tem evolução ou pagamento THEN a API SHALL responder 422 `SESSION_HAS_RECORDS`.
9. [AGE-09] WHEN uma sessão cancelada ou remarcada volta a agendada THEN a API SHALL reaplicar a checagem de dia habilitado e de conflito.
10. [AGE-10] WHEN uma sessão vira `faltou` ou `cancelada` THEN a API SHALL gravar `cobravel = false`, salvo se o profissional marcar "cobrar".
11. [AGE-11] IF a edição ou mudança de status chega com `row_version` diferente do atual THEN a API SHALL responder 409 sem gravar.
12. [AGE-12] IF a sessão é criada ou movida para paciente inativo THEN a API SHALL responder 422 `PATIENT_INACTIVE`.
13. [AGE-13] WHEN uma série é criada THEN a API SHALL criar de 2 a 52 ocorrências (a primeira incluída), semanais ou quinzenais, com a mesma duração, todas ou nenhuma.
14. [AGE-14] IF alguma ocorrência da série conflita e não há `confirmar_conflito: true` THEN a API SHALL responder 409 listando todas as colisões, sem criar nenhuma.
15. [AGE-15] WHEN a série é alterada "a partir de" uma data THEN a API SHALL deslocar só as ocorrências `agendada` a partir dela, reaplicando dia habilitado e conflito (excluindo as próprias ocorrências).
16. [AGE-16] WHEN a série é cancelada "a partir de" uma data THEN a API SHALL marcar a série e as ocorrências `agendada` a partir dela como canceladas, sem apagar nada, de forma idempotente.
17. The API SHALL não apagar sessões; cancelar e remarcar são só mudanças de status. [AGE-17]

**Independent Test**: criar série semanal de 4, ver conflito ao sobrepor, cancelar a partir da terceira.

---

### P1: Anamnese configurável ⭐ MVP

**User Story**: Como profissional, quero registrar a anamnese do paciente num modelo que eu ajusto à minha prática.

**Why P1**: Parte do prontuário.

**Acceptance Criteria**:
1. The API SHALL limitar o modelo a 30 campos e 12 alertas, com rótulo aparado de 1 a 60 caracteres, único sem diferenciar maiúsculas; violação = 422 `MODEL_LABEL_INVALID` sem ecoar o texto. [ANA-01]
2. The modelo SHALL ter campos só de texto livre e no máximo um campo especial "Frequência" (semanal, quinzenal, mensal, outra). [ANA-02]
3. [ANA-03] WHILE existe ao menos uma anamnese registrada a API SHALL recusar remover, renomear ou mudar a ordem relativa dos itens do modelo, permitindo só incluir itens novos em qualquer posição.
4. The API SHALL aceitar uma anamnese por paciente, com texto de campo até 5.000 caracteres e observação de alerta até 500, recusando id de item desconhecido ou de revisão futura. [ANA-04]
5. [ANA-05] WHILE é o dia do cadastro da anamnese (até a meia-noite de America/Sao_Paulo, pelo relógio do banco) a API SHALL permitir editá-la.
6. [ANA-06] WHEN a retificação é pedida depois do dia do cadastro com motivo de 1 a 5.000 caracteres THEN a API SHALL criar uma nova versão e preservar a original.
7. [ANA-07] IF a retificação é pedida no dia do cadastro THEN a API SHALL responder 409 `EDIT_WINDOW_OPEN`.
8. [ANA-08] IF a retificação não traz conteúdo novo THEN a API SHALL responder 400.
9. The app SHALL mostrar o selo "Editável hoje" ou "Registrada" e o alerta clínico marcado na versão vigente. [ANA-09]

**Independent Test**: registrar anamnese, tentar retificar no mesmo dia (409), avançar o relógio e retificar.

---

### P1: Evoluções ⭐ MVP

**User Story**: Como profissional, quero registrar a evolução de cada sessão e corrigir depois só por retificação.

**Why P1**: Registro clínico obrigatório.

**Acceptance Criteria**:
1. The API SHALL aceitar evolução com texto não vazio (após aparar) de até 100.000 caracteres e `sessao_id` opcional. [EVO-01]
2. [EVO-02] IF já existe evolução ligada à mesma sessão THEN a API SHALL responder 409 `EVOLUTION_EXISTS` (índice único por sessão).
3. [EVO-03] WHEN uma evolução é registrada ligada a uma sessão `agendada` THEN a API SHALL mudar a sessão para `realizada` na mesma transação.
4. [EVO-04] WHILE é o dia do cadastro a API SHALL permitir editar a evolução com `row_version` obrigatório; divergência = 409.
5. [EVO-05] WHEN a retificação é pedida depois do dia do cadastro com texto novo e motivo (até 100.000 cada) THEN a API SHALL criar a retificação e preservar a original.
6. [EVO-06] IF a retificação é pedida no dia do cadastro THEN a API SHALL responder 409 `EDIT_WINDOW_OPEN`.
7. The API SHALL não oferecer exclusão de evolução. [EVO-07]

**Independent Test**: registrar evolução de uma sessão agendada e vê-la virar realizada; segunda evolução na mesma sessão = 409.

---

### P1: Financeiro ⭐ MVP

**User Story**: Como profissional, quero definir valores, registrar pagamentos e ver quem está em débito.

**Why P1**: Parte do escopo do legado e do uso diário.

**Acceptance Criteria**:
1. The API SHALL trafegar e gravar valores em centavos inteiros de 0 a 9.999.999.999. [FIN-01]
2. The API SHALL manter preço por paciente e ajuste por sessão com revisão antes/depois e `row_version`; criar com `row_version` informado ou editar com versão divergente = 409. [FIN-02]
3. The API SHALL aceitar pagamento com data YYYY-MM-DD válida, `meio` em {dinheiro, pix, cartao, transferencia, outro} e valor opcional; ausente, usa o preço do paciente. [FIN-03]
4. [FIN-04] IF o pagamento não tem valor e o paciente não tem preço THEN a API SHALL responder 422.
5. [FIN-05] IF já existe pagamento da sessão e não há `confirmar_duplicidade: true` THEN a API SHALL responder 422 `PAYMENT_DUPLICATE`; com ele, corrige o pagamento gerando revisão.
6. The API SHALL considerar em débito a sessão `realizada` sem pagamento e a `faltou` ou `cancelada` com `cobravel` e sem pagamento; agendada e remarcada nunca. [FIN-06]
7. [FIN-07] WHEN `/app/financeiro` é aberto THEN o app SHALL listar débitos com filtro `em_debito`, `em_dia` ou todos guardado na URL e o total pendente somado em centavos.
8. The API SHALL não excluir pagamentos e SHALL auditar `pagamento.registrado`, `pagamento.corrigido`, `preco_paciente.definido` e `preco_sessao.ajustado` quando a versão muda. [FIN-08]
9. [FIN-09] WHEN o profissional abre `/app/financeiro/preco/paciente/:id`, `/app/financeiro/preco/sessao/:id` ou `/app/financeiro/pagamento/:sessaoId` THEN o app SHALL permitir definir o preço do paciente, ajustar o preço da sessão e registrar ou corrigir o pagamento da sessão (data, meio e valor opcional), mostrando valores em reais e enviando centavos; WHEN a API responde 409 `versao_divergente` THEN o app SHALL pedir para recarregar, WHEN responde 422 `PAYMENT_DUPLICATE` THEN SHALL pedir confirmação explícita antes de reenviar com `confirmar_duplicidade: true`, e WHEN responde 422 `PRICE_REQUIRED` THEN SHALL pedir o valor. Cada sessão da lista de hoje do Início, quando pendente de pagamento, SHALL ter o atalho "Pagamento" para essa tela, e cada paciente da lista de débitos SHALL ter o link "Registrar pagamento" para as sessões pendentes.

**Independent Test**: definir preço, marcar sessão realizada, ver débito; registrar pagamento e ver o débito sumir.

---

### P1: Início ⭐ MVP

**User Story**: Como profissional, quero abrir o app e ver a semana e o dia de hoje.

**Why P1**: Tela de entrada.

**Acceptance Criteria**:
1. [INI-01] WHEN `/app` é aberto THEN o app SHALL mostrar a semana de segunda até o último dia habilitado, com total, realizadas, pendentes de evolução e pendentes de pagamento.
2. The lista de hoje SHALL mostrar no máximo 6 sessões, sem canceladas nem remarcadas, com "hoje" pelo relógio do banco em America/Sao_Paulo. [INI-02]
3. The Início SHALL classificar cada sessão em `editavel_hoje_sem_texto`, `sem_registro`, `editavel_hoje` ou `registrada` (evolução) e em pago, pendente ou não cobrável (pagamento), pelas regras do legado (`legado:backend/src/home/domain/summary.ts:115-124`). [INI-03]

**Independent Test**: com 8 sessões hoje, ver 6 na lista e os contadores corretos.

---

### P1: Planos, trial e cobrança pelo Asaas ⭐ MVP

**User Story**: Como profissional, quero testar grátis, usar o Free com até 5 pacientes ou assinar o Pro por Pix.

**Why P1**: Modelo de negócio do padrão LJS.

**Acceptance Criteria**:
1. The assinatura SHALL ter os estados `trial`, `ativa`, `atrasada`, `cancelada` e `free`, só com as transições trial → ativa ou free; ativa → atrasada ou cancelada; atrasada → ativa ou free; cancelada → free; free → ativa. [PLANO-01]
2. [PLANO-02] WHILE a assinatura está em `trial`, `ativa`, `atrasada` ou `cancelada` com `periodo_fim` no futuro a API SHALL liberar tudo sem limite de pacientes.
3. [PLANO-03] IF o plano é Free e o profissional já tem 5 ou mais pacientes ativos THEN a API SHALL recusar criar ou reativar paciente com 403 `LIMITE_PLANO`, mantendo editável tudo o que existe.
4. [PLANO-04] WHEN o trial passa de `periodo_fim` sem pagamento THEN o sistema SHALL mudar a assinatura para `free` sem apagar nem bloquear dado.
5. [PLANO-05] WHEN o profissional assina o Pro informando nome e CPF/CNPJ THEN a API SHALL criar no Asaas o cliente e a assinatura mensal de 1990 centavos por Pix e mostrar em "Meu plano" o Pix copia-e-cola e o QR da cobrança pendente.
6. [PLANO-06] IF o webhook chega a `POST /api/webhooks/asaas` sem o token configurado THEN a API SHALL responder 401 sem processar.
7. [PLANO-07] WHEN um webhook com `event_id` já registrado chega THEN a API SHALL responder 200 sem efeito novo.
8. [PLANO-08] WHEN o webhook de pagamento recebido ou confirmado chega THEN a API SHALL mudar a assinatura para `ativa` e definir `periodo_fim` pela próxima data de vencimento.
9. [PLANO-09] WHEN o webhook de cobrança vencida chega THEN a API SHALL mudar a assinatura para `atrasada`.
10. [PLANO-10] WHEN uma assinatura passa 7 dias em `atrasada` desde o vencimento THEN o sistema SHALL cancelar a assinatura no Asaas e mudá-la para `free`.
11. [PLANO-11] WHEN o profissional cancela o Pro THEN a API SHALL cancelar no Asaas, mudar para `cancelada` e manter o Pro até `periodo_fim`, quando passa a `free`.
12. [PLANO-12] IF o Asaas falha ou excede o tempo ao assinar ou cancelar THEN a API SHALL responder 503 sem mudar o estado local.
13. [PLANO-13] WHEN uma cobrança é gerada, um pagamento é confirmado ou uma cobrança vence THEN o sistema SHALL enviar o e-mail transacional correspondente.
14. The "Meu plano" SHALL mostrar o plano atual, a data de renovação ou de fim, o Pix pendente e a opção de cancelar. [PLANO-14]
15. The limites do Free SHALL ser aplicados na API pelo middleware de plano, nunca só no app. [PLANO-15]

**Independent Test**: no sandbox, assinar, simular o webhook de pagamento e ver `ativa`; simular atraso + 7 dias e ver `free` com os dados intactos.

---

### P1: Exportação do prontuário ⭐ MVP

**User Story**: Como profissional, quero exportar o prontuário de um paciente ou tudo, para guardar e para levar meus dados.

**Why P1**: Obrigação de guarda e pré-requisito da exclusão.

**Acceptance Criteria**:
1. [EXP-01] WHEN o prontuário de um paciente é pedido com período opcional (`de` ≤ `até`, YYYY-MM-DD) THEN a API SHALL devolver JSON com anamnese (versões e retificações com motivo, só campos da revisão vigente) e evoluções no período em America/Sao_Paulo.
2. [EXP-02] WHEN o app recebe o JSON do prontuário THEN o app SHALL montar no navegador o PDF `prontuario-<8 primeiros caracteres do id>.pdf` com título "Prontuário", paciente, período, registro profissional e rodapé "Prontuário — documento confidencial".
3. [EXP-03] WHEN a exportação completa é pedida THEN a API SHALL entregar todos os dados do profissional (sem credenciais nem sessões) em páginas por tabela, com cursor e tamanho máximo de página, e o app SHALL juntar as páginas e montar um `.zip` com `dados.json` e um PDF de prontuário por paciente.
4. [EXP-04] IF uma página da exportação pedida passa do tamanho máximo de página ou o cursor é inválido THEN a API SHALL responder 400 sem auditar; o tamanho máximo de página é definido pela medição de CPU da tarefa T122 (spike cpu-exportacao: a exportação inteira numa resposta custa cerca de 1 s de CPU contra o limite de 10 ms).
5. [EXP-05] IF o profissional inicia mais de 5 exportações em 60 segundos (a primeira página de cada exportação conta como início) THEN a API SHALL responder 429, com o contador guardado em tabela.
6. [EXP-06] WHEN uma exportação é servida (na exportação completa, ao servir a última página) THEN a API SHALL auditar `exportacao.concluida` (alvo paciente ou exportação), sem conteúdo.
7. [EXP-07] IF o período é inválido ou o paciente é de outro profissional THEN a API SHALL responder 400 ou 404, respectivamente.

**Independent Test**: exportar um paciente com anamnese retificada e abrir o PDF; exportar tudo e abrir o .zip.

---

### P1: Exclusão de conta e LGPD ⭐ MVP

**User Story**: Como profissional, quero excluir minha conta levando antes meus dados.

**Why P1**: Exigência do padrão LJS e da LGPD.

**Acceptance Criteria**:
1. [CONTA-01] IF a exclusão é pedida sem exportação completa servida nas últimas 24 horas, sem a declaração de guarda do prontuário marcada ou com senha errada THEN a API SHALL recusar com 422 indicando o requisito que falta.
2. [CONTA-02] WHEN a exclusão é pedida com todos os requisitos THEN a API SHALL enviar e-mail com link de confirmação (token 256 bits, SHA-256 no banco, 30 minutos, uso único).
3. [CONTA-03] WHEN o link de confirmação é aberto THEN a API SHALL bloquear a conta, encerrar todas as sessões, cancelar a assinatura no Asaas e enviar e-mail com a data da purga e o link de desistência válido por 30 dias.
4. [CONTA-04] WHEN o link de desistência é aberto antes da purga THEN a API SHALL desbloquear a conta, que volta a entrar com senha e 2FA no plano `free` ou no trial restante.
5. [CONTA-05] WHEN se passam 30 dias da confirmação sem desistência THEN o sistema SHALL apagar todas as linhas do profissional e guardar só `conta_excluida` (id, data do pedido, data da purga), sem dado pessoal.
6. The páginas `/termos` e `/privacidade` SHALL estar em português, com versão e data, e definir o profissional como controlador e a LJS como operadora. [CONTA-06]

**Independent Test**: exportar, pedir exclusão, confirmar, ver login recusado; avançar 30 dias e ver as tabelas sem linhas do profissional.

---

### P1: Auditoria ⭐ MVP

**User Story**: Como profissional, quero ver o que aconteceu na minha conta e no histórico de cada paciente.

**Why P1**: Rastreabilidade de prontuário.

**Acceptance Criteria**:
1. The auditoria SHALL ser só de inclusão, na mesma transação da operação (falha da auditoria desfaz a operação), sem conteúdo clínico, com ator, ação, alvo, nomes de campo, IP truncado (/24 IPv4, /48 IPv6) e user-agent resumido. [AUD-01]
2. The API SHALL recusar ação ou alvo fora da lista permitida e chaves extras no evento. [AUD-02]
3. [AUD-03] WHEN `/app/auditoria` é aberto THEN o app SHALL mostrar "Trilha da minha conta" ou "Histórico do paciente" em páginas de 50 com "Carregar mais", sem `paciente.consultado`, com filtro Todos, Retificações, Exportações.
4. [AUD-04] WHEN login, logout, cadastro, mudança de assinatura ou etapa da exclusão acontecem THEN a API SHALL auditar `auth.login_ok`, `auth.logout`, `conta.cadastrada`, `assinatura.<estado>` ou `conta.exclusao_<etapa>`.

**Independent Test**: retificar uma evolução e ver o evento na trilha, sem o texto.

---

### P1: Landing, páginas públicas e PWA ⭐ MVP

**User Story**: Como visitante, quero entender o produto e começar grátis; como profissional, quero instalar o app no celular.

**Why P1**: Entrada do produto LJS.

**Acceptance Criteria**:
1. [PUB-01] WHEN `/` é aberto THEN o site SHALL mostrar a proposta de valor, os planos (Free até 5 pacientes ativos; Pro R$ 19,90/mês sem limite; trial de 14 dias) e o botão "Começar grátis" para `/cadastro`.
2. The app SHALL ficar em `/app`, com as rotas do legado no escopo sob esse prefixo e o mesmo layout do código atual do legado. [PUB-02]
3. The PWA SHALL ter manifest com ícones 192 e 512 maskable e `display: standalone`, service worker com precache do shell, página offline e handlers de `push` e `notificationclick`, e ser reconhecido como instalável pelo Chrome. [PUB-03]
4. [PUB-04] WHEN o app é aberto no Safari do iOS fora do modo instalado THEN o app SHALL oferecer a instrução de instalação ("Compartilhar" → "Adicionar à Tela de Início").
5. The respostas de `/api/*` SHALL ter `Cache-Control: no-store`. [PUB-05]

**Independent Test**: abrir `/`, clicar em "Começar grátis", instalar o PWA no Chrome.

---

### P1: Operação: backup, restauração, CI/CD e segurança ⭐ MVP

**User Story**: Como dono do produto, quero que os dados não se percam e que publicar seja seguro e repetível.

**Why P1**: O risco principal é perder dado de saúde.

**Acceptance Criteria**:
1. [OPS-01] WHEN são 04:00 em America/Sao_Paulo THEN o `backup.yml` SHALL rodar `pg_dump -Fc` com a role `evolucao_backup_ro`, cifrar com `age` (chave pública em secret) e guardar como artefato com retenção de 30 dias.
2. The runbook SHALL documentar a restauração, e uma restauração a partir de cópia limpa SHALL ser executada e registrada antes da publicação, conferindo contagem de linhas por tabela. [OPS-02]
3. [OPS-03] WHEN o `deploy.yml` roda (só manual, só pela `main`, environment `producao`, concurrency sem cancelamento) THEN ele SHALL executar na ordem: build do web, dump cifrado (sem criar branch no Neon: só `main` e `dev` são permanentes; revisado em 2026-10-28), migração com a role `evolucao_owner`, `wrangler deploy` com `URL_PUBLICA`.
4. [OPS-04] IF `wrangler deploy` aparece em outro arquivo do repositório THEN um teste da suíte SHALL falhar.
5. [OPS-05] WHEN há push ou PR THEN o `ci.yml` SHALL rodar lint, typecheck, testes, gitleaks, build do web, migrations do zero num Postgres de serviço e o teste de isolamento.
6. [OPS-06] WHEN `GET /api/health` é chamado THEN a API SHALL responder 200 sem tocar no banco.
7. [OPS-07] IF um mesmo IP passa de 10 requisições por minuto nas rotas de entrar, 2FA, cadastro e recuperação, de 60 por minuto nas demais rotas públicas, ou do limite do webhook THEN a API SHALL responder 429.
8. The Sentry SHALL receber erros do Worker e do app com release = SHA do commit e sem corpo de requisição, cookie ou e-mail. [OPS-08]
9. The respostas SHALL ter CSP sem origens externas além das necessárias (Sentry, Asaas só onde preciso), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e `frame-ancestors 'none'`. [OPS-09]
10. The código e o banco SHALL não conter URL absoluta do app; a única fonte é `URL_PUBLICA`. [OPS-10]
11. The `.env.example` SHALL listar toda variável com obrigatoriedade, formato e se é segredo, e nenhum segredo SHALL estar em arquivo versionado (gitleaks no CI). [OPS-11]
12. The `README.md` SHALL explicar rodar local, variáveis, deploy e testar o webhook local, e `docs/runbook.md` SHALL cobrir webhook falhou, reprocessar pagamento, reativar usuário, rotacionar segredos e restaurar backup. [OPS-12]
13. The Hyperdrive SHALL ter cache desligado para consultas de dado que muda por ação do usuário. [OPS-13]
14. The Worker SHALL não calcular hash de senha nem gerar PDF, para caber em 10 ms de CPU por requisição. [OPS-14]

**Independent Test**: rodar o `backup.yml` manual, restaurar o artefato num Postgres local limpo e comparar contagens.

---

### P2: Rascunhos e modelos de texto

**User Story**: Como profissional, quero não perder o que estou escrevendo e reutilizar textos frequentes.

**Why P2**: Conforto importante, mas o prontuário funciona sem.

**Acceptance Criteria**:
1. The API SHALL guardar um rascunho por (profissional, tipo, ref), com payload JSON de até 512 KiB, por upsert, sem apagar. [RAS-01]
2. [RAS-02] IF o `If-Match` do rascunho não confere com a versão atual THEN a API SHALL responder 412; rascunho inexistente aceita `If-Match` ausente ou "0".
3. The API SHALL aceitar modelos de texto do tipo `evolucao` com nome de 1 a 200 único sem diferenciar maiúsculas e corpo até 50.000 caracteres, arquiváveis. [RAS-03]
4. [RAS-04] WHEN a sessão expira com texto não salvo THEN o app SHALL oferecer restaurar o rascunho no próximo acesso.

**Independent Test**: digitar uma evolução, expirar a sessão, entrar e ver o texto oferecido.

---

### P2: Notificações push

**User Story**: Como profissional, quero ser avisado da próxima sessão, de evoluções pendentes e da minha cobrança.

**Why P2**: Ajuda o uso diário; o app funciona sem.

**Acceptance Criteria**:
1. [PUSH-01] WHEN o profissional ativa o push num dispositivo THEN a API SHALL guardar a `push_subscription` desse dispositivo; desativar a remove.
2. [PUSH-02] WHEN faltam 15 minutos para uma sessão `agendada` THEN o sistema SHALL enviar um push "sessão próxima" com o horário, uma única vez por sessão.
3. [PUSH-03] WHEN são 20:00 em America/Sao_Paulo e há sessões realizadas no dia sem evolução THEN o sistema SHALL enviar um push com a quantidade, uma vez por dia.
4. [PUSH-04] WHEN uma cobrança é gerada, um pagamento é confirmado, a cobrança vence ou o trial termina em 3 dias THEN o sistema SHALL enviar o push correspondente, uma vez por evento.
5. The push SHALL não conter nome de paciente nem texto clínico. [PUSH-05]
6. [PUSH-06] IF o serviço de push responde 404 ou 410 para uma assinatura THEN o sistema SHALL removê-la.
7. The sistema SHALL usar um único Cron Trigger a cada 5 minutos, enviando em lotes com `ctx.waitUntil`, e assinar o JWT VAPID ES256 com `crypto.subtle`. [PUSH-07]
8. [PUSH-08] WHEN o push é clicado THEN o app SHALL abrir a tela relacionada (sessão, Início ou Meu plano).

**Independent Test**: com relógio simulado, uma sessão às 14:00 gera um único envio entre 13:45 e 13:50.

---

## Edge Cases

- IF o banco Neon está em autosuspend THEN a primeira requisição SHALL esperar o cold start e responder normalmente (sem erro), dentro do timeout do Worker.
- IF o Resend recusa por limite diário (100 e-mails) THEN o login SHALL responder 503 `mail_unavailable` e o erro SHALL ir ao Sentry com alerta.
- IF duas abas editam a mesma sessão ou evolução THEN a segunda gravação SHALL receber 409 por `row_version`.
- IF o webhook do Asaas chega antes da resposta da criação da assinatura THEN o processamento SHALL ser idempotente e chegar ao mesmo estado final.
- WHEN a meia-noite de America/Sao_Paulo passa com uma evolução aberta na tela THEN a gravação SHALL ser recusada (janela fechada) e o app SHALL oferecer retificar.
- IF o cron perde uma execução THEN a seguinte SHALL enviar os avisos ainda dentro da janela sem duplicar os já enviados.
- WHEN o profissional em Free com 5 ativos inativa um paciente THEN SHALL poder criar ou reativar um paciente.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CAD-01 | P1: Cadastro | Tasks | Implementing |
| CAD-02 | P1: Cadastro | Tasks | Implementing |
| CAD-03 | P1: Cadastro | Tasks | Implementing |
| CAD-04 | P1: Cadastro | Tasks | Implementing |
| CAD-05 | P1: Cadastro | Tasks | Implementing |
| CAD-06 | P1: Cadastro | Tasks | Implementing |
| CAD-07 | P1: Cadastro | Tasks | Implementing |
| CAD-08 | P1: Cadastro | Tasks | Implementing |
| CAD-09 | P1: Cadastro | Tasks | Implementing |
| AUTH-01 | P1: Login e sessão | Tasks | Implementing |
| AUTH-02 | P1: Login e sessão | Tasks | Implementing |
| AUTH-03 | P1: Login e sessão | Tasks | Implementing |
| AUTH-04 | P1: Login e sessão | Tasks | Implementing |
| AUTH-05 | P1: Login e sessão | Tasks | Implementing |
| AUTH-06 | P1: Login e sessão | Tasks | Implementing |
| AUTH-07 | P1: Login e sessão | Tasks | Implementing |
| AUTH-08 | P1: Login e sessão | Tasks | Implementing |
| AUTH-09 | P1: Login e sessão | Tasks | Implementing |
| AUTH-10 | P1: Login e sessão | Tasks | Implementing |
| AUTH-11 | P1: Login e sessão | Tasks | Implementing |
| AUTH-12 | P1: Login e sessão | Tasks | Implementing |
| AUTH-13 | P1: Login e sessão | Tasks | Pending |
| AUTH-14 | P1: Login e sessão | Tasks | Pending |
| AUTH-15 | P1: Login e sessão | Tasks | Pending |
| AUTH-16 | P1: Login e sessão | Tasks | Implementing |
| AUTH-17 | P1: Login e sessão | Tasks | Implementing |
| AUTH-18 | P1: Login e sessão | Tasks | Pending |
| AUTH-19 | P1: Login e sessão | Tasks | Pending |
| ISO-01 | P1: Isolamento | Tasks | Implementing |
| ISO-02 | P1: Isolamento | Tasks | Implementing |
| ISO-03 | P1: Isolamento | Tasks | Implementing |
| ISO-04 | P1: Isolamento | Tasks | Implementing |
| PERF-01 | P1: Perfil | Tasks | Implementing |
| PERF-02 | P1: Perfil | Tasks | Implementing |
| PERF-03 | P1: Perfil | Tasks | Implementing |
| PERF-04 | P1: Perfil | Tasks | Implementing |
| PERF-05 | P1: Perfil | Tasks | Implementing |
| PERF-06 | P1: Perfil | Tasks | Pending |
| PERF-07 | P1: Perfil | Tasks | Pending |
| PERF-08 | P1: Perfil | Tasks | Implementing |
| PERF-09 | P1: Perfil | Tasks | Implementing |
| PAC-01 | P1: Pacientes | Tasks | Implementing |
| PAC-02 | P1: Pacientes | Tasks | Implementing |
| PAC-03 | P1: Pacientes | Tasks | Implementing |
| PAC-04 | P1: Pacientes | Tasks | Implementing |
| PAC-05 | P1: Pacientes | Tasks | Implementing |
| PAC-06 | P1: Pacientes | Tasks | Implementing |
| PAC-07 | P1: Pacientes | Tasks | Implementing |
| AGE-01 | P1: Agenda | Tasks | Pending |
| AGE-02 | P1: Agenda | Tasks | Pending |
| AGE-03 | P1: Agenda | Tasks | Pending |
| AGE-04 | P1: Agenda | Tasks | Pending |
| AGE-05 | P1: Agenda | Tasks | Pending |
| AGE-06 | P1: Agenda | Tasks | Pending |
| AGE-07 | P1: Agenda | Tasks | Pending |
| AGE-08 | P1: Agenda | Tasks | Pending |
| AGE-09 | P1: Agenda | Tasks | Pending |
| AGE-10 | P1: Agenda | Tasks | Pending |
| AGE-11 | P1: Agenda | Tasks | Pending |
| AGE-12 | P1: Agenda | Tasks | Pending |
| AGE-13 | P1: Agenda | Tasks | Pending |
| AGE-14 | P1: Agenda | Tasks | Pending |
| AGE-15 | P1: Agenda | Tasks | Pending |
| AGE-16 | P1: Agenda | Tasks | Pending |
| AGE-17 | P1: Agenda | Tasks | Pending |
| ANA-01 | P1: Anamnese | Tasks | Implementing |
| ANA-02 | P1: Anamnese | Tasks | Implementing |
| ANA-03 | P1: Anamnese | Tasks | Implementing |
| ANA-04 | P1: Anamnese | Tasks | Implementing |
| ANA-05 | P1: Anamnese | Tasks | Implementing |
| ANA-06 | P1: Anamnese | Tasks | Implementing |
| ANA-07 | P1: Anamnese | Tasks | Implementing |
| ANA-08 | P1: Anamnese | Tasks | Implementing |
| ANA-09 | P1: Anamnese | Tasks | Implementing |
| EVO-01 | P1: Evoluções | Tasks | Implementing |
| EVO-02 | P1: Evoluções | Tasks | Implementing |
| EVO-03 | P1: Evoluções | Tasks | Implementing |
| EVO-04 | P1: Evoluções | Tasks | Implementing |
| EVO-05 | P1: Evoluções | Tasks | Implementing |
| EVO-06 | P1: Evoluções | Tasks | Implementing |
| EVO-07 | P1: Evoluções | Tasks | Implementing |
| FIN-01 | P1: Financeiro | Tasks | Pending |
| FIN-02 | P1: Financeiro | Tasks | Pending |
| FIN-03 | P1: Financeiro | Tasks | Pending |
| FIN-04 | P1: Financeiro | Tasks | Pending |
| FIN-05 | P1: Financeiro | Tasks | Pending |
| FIN-06 | P1: Financeiro | Tasks | Pending |
| FIN-07 | P1: Financeiro | Tasks | Pending |
| FIN-08 | P1: Financeiro | Tasks | Pending |
| FIN-09 | P1: Financeiro | Tasks | Pending |
| INI-01 | P1: Início | Tasks | Pending |
| INI-02 | P1: Início | Tasks | Pending |
| INI-03 | P1: Início | Tasks | Pending |
| PLANO-01 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-02 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-03 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-04 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-05 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-06 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-07 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-08 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-09 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-10 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-11 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-12 | P1: Planos e cobrança | Tasks | Implementing |
| PLANO-13 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-14 | P1: Planos e cobrança | Tasks | Pending |
| PLANO-15 | P1: Planos e cobrança | Tasks | Pending |
| EXP-01 | P1: Exportação | Tasks | Pending |
| EXP-02 | P1: Exportação | Tasks | Pending |
| EXP-03 | P1: Exportação | Tasks | Pending |
| EXP-04 | P1: Exportação | Tasks | Pending |
| EXP-05 | P1: Exportação | Tasks | Pending |
| EXP-06 | P1: Exportação | Tasks | Pending |
| EXP-07 | P1: Exportação | Tasks | Pending |
| CONTA-01 | P1: Exclusão e LGPD | Tasks | Pending |
| CONTA-02 | P1: Exclusão e LGPD | Tasks | Pending |
| CONTA-03 | P1: Exclusão e LGPD | Tasks | Pending |
| CONTA-04 | P1: Exclusão e LGPD | Tasks | Pending |
| CONTA-05 | P1: Exclusão e LGPD | Tasks | Pending |
| CONTA-06 | P1: Exclusão e LGPD | Tasks | Pending |
| AUD-01 | P1: Auditoria | Tasks | Implementing |
| AUD-02 | P1: Auditoria | Tasks | Implementing |
| AUD-03 | P1: Auditoria | Tasks | Pending |
| AUD-04 | P1: Auditoria | Tasks | Implementing |
| PUB-01 | P1: Landing e PWA | Tasks | Pending |
| PUB-02 | P1: Landing e PWA | Tasks | Implementing |
| PUB-03 | P1: Landing e PWA | Tasks | Pending |
| PUB-04 | P1: Landing e PWA | Tasks | Pending |
| PUB-05 | P1: Landing e PWA | Tasks | Pending |
| OPS-01 | P1: Operação | Tasks | Pending |
| OPS-02 | P1: Operação | Tasks | Pending |
| OPS-03 | P1: Operação | Tasks | Pending |
| OPS-04 | P1: Operação | Tasks | Pending |
| OPS-05 | P1: Operação | Tasks | Pending |
| OPS-06 | P1: Operação | Tasks | Pending |
| OPS-07 | P1: Operação | Tasks | Implementing |
| OPS-08 | P1: Operação | Tasks | Pending |
| OPS-09 | P1: Operação | Tasks | Pending |
| OPS-10 | P1: Operação | Tasks | Pending |
| OPS-11 | P1: Operação | Tasks | Pending |
| OPS-12 | P1: Operação | Tasks | Pending |
| OPS-13 | P1: Operação | Tasks | Implementing |
| OPS-14 | P1: Operação | Tasks | Pending |
| RAS-01 | P2: Rascunhos e modelos | Tasks | Implementing |
| RAS-02 | P2: Rascunhos e modelos | Tasks | Implementing |
| RAS-03 | P2: Rascunhos e modelos | Tasks | Implementing |
| RAS-04 | P2: Rascunhos e modelos | Tasks | Implementing |
| PUSH-01 | P2: Push | Tasks | Pending |
| PUSH-02 | P2: Push | Tasks | Pending |
| PUSH-03 | P2: Push | Tasks | Pending |
| PUSH-04 | P2: Push | Tasks | Pending |
| PUSH-05 | P2: Push | Tasks | Pending |
| PUSH-06 | P2: Push | Tasks | Pending |
| PUSH-07 | P2: Push | Tasks | Pending |
| PUSH-08 | P2: Push | Tasks | Pending |

**Coverage:** 155 total, 155 mapped to tasks, 0 unmapped (campo `Requirement` de cada tarefa em `tasks.md`).

---

## Success Criteria

- [ ] Comparação visual das telas do legado no escopo sem diferença não justificada.
- [ ] e2e Playwright verde: cadastro, login com 2FA, assinar (sandbox), fluxo agenda → evolução → pagamento.
- [ ] Teste de isolamento verde em todas as tabelas de negócio.
- [ ] Restauração do backup executada a partir de cópia limpa e registrada no runbook.
- [ ] App no ar pelo `deploy.yml`, com `GET /api/health` 200 monitorado e custo fixo R$ 0.
