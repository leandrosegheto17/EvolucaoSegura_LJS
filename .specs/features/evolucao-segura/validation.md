# Evolução Segura: validação independente

## Validation (validação): evolucao-segura - FAIL ❌

**Data**: 2026-10-29
**Spec**: `.specs/features/evolucao-segura/spec.md` (155 requisitos: 143 P1, 12 P2)
**Commit verificado**: `d3eab8e` (main, igual a origin/main, árvore limpa antes e depois)
**Diff range**: toda a feature (267 commits; 201 tarefas)
**Verificador**: sub-agente independente (autor diferente do verificador)

**Por que FAIL** (resumo; detalhes nas seções): (1) 1 mutante sobreviveu no código de isolamento multi-inquilino (ISO-01, "SET LOCAL"); (2) o service worker tem defeito conhecido que, por leitura do código e pelo comentário do próprio e2e, quebra a navegação direta a `/app/*` (afeta PUB-02/PUB-03); (3) EVO-03 não é alcançável pela interface (nenhum link gera `?sessao=`), o que também mascara o fluxo "agenda → evolução → pagamento" do critério de sucesso; (4) o e2e não roda no CI e eu não o executei; (5) 1 teste de API intermitente (`plano.test.ts:234`) falhou numa das 3 execuções completas; (6) a restauração registrada em produção foi de um banco vazio. Os 155 critérios têm teste e o gate passa em 2 de 3 execuções; as falhas acima são o que impede o veredito de passar.

**Resultado de cada eixo**:

- **Spec-anchored**: 147 de 155 critérios com asserção que bate com o resultado da spec; 1 (ISO-01) com mutante sobrevivente; 7 com lacuna de precisão da spec ou cobertura parcial (tabela adiante).
- **Gate**: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @es/web build`: lint, typecheck e build passaram; `pnpm test`: 210 arquivos, 3316 testes, 0 pulados. Passou em 2 das 3 execuções completas (ver Gate Check).
- **Sensor**: 12 mutações, 11 mortas, 1 sobreviveu (M10).

---

## Preparação e isolamento

- Baseline antes de qualquer sensor: `git status --porcelain` vazio; `git worktree list` com a árvore real e `C:/Users/leand/orca/workspaces/EvolucaoSegura_LJS/elkhorn` (que não é do verificador).
- Sensor numa worktree temporária (`git worktree add --detach C:/es-vfy HEAD`, nunca `git stash`), removida com `git worktree remove --force` + `prune`; `git worktree list` voltou idêntico ao baseline. A árvore real só ganhou este `validation.md` (não commitado). **Sobra não rastreada**: a pasta `C:\es-vfy` (node_modules da worktree) ficou no disco porque a remoção recursiva foi bloqueada pela política de segurança; não é worktree registrada. Pode ser apagada à mão.
- Banco: os testes usam bancos temporários `es_api_*` no Postgres do Docker (porta 5433). Banco de origem do teste de restauração (`es_vfy_origem`) criado e apagado por mim.
- Ambiente: o `localhost` desta máquina resolve primeiro para IPv6 e a conexão ao 5433 expira (confirmado com `pg` em Node: `localhost` expirou, `127.0.0.1` funcionou). Sem `DATABASE_URL`, `pnpm test` fica parado (idle) na preparação do projeto da API. Rodei tudo com `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura` (variável documentada em `backend/api/vitest.urls.ts`), sem alterar arquivo algum.

---

## Task Completion

| Verificação | Resultado |
| --- | --- |
| Tarefas T1 a T201 | ✅ 201 concluídas; `tasks.md` tem 552 caixas marcadas e 0 pendentes; `python .claude/scripts/progresso.py` diz "Todas as 201 tarefas concluídas: 100%" |
| Tarefas acima de 2 h | ⚠️ anotado, não bloqueia: 29 tarefas (T12, T13, T14, T15, T29 e mais 24) |
| Bloqueadas ou parciais | nenhuma |

---

## Spec-Anchored Acceptance Criteria

Convenção: `B/` = `backend/api/test/`; `S/` = `backend/scripts/test/`; `W/` = `frontend/web/src/`; `D/` = `backend/dominio/src/`. A coluna de evidência dá `arquivo:linha` da asserção e a expressão. Todos os IDs aparecem também em cabeçalhos e títulos de teste (155 de 155).

### Cadastro

| Critério | Resultado exigido pela spec | `arquivo:linha` + asserção | Resultado |
| --- | --- | --- | --- |
| CAD-01 | 202 e e-mail com link | `B/rotas/cadastro.test.ts:102` `expect(resposta.status).toBe(202)`; `:125` `toContain('${URL_PUBLICA}/confirmar?token=')` | ✅ |
| CAD-02 | mesmo 202/corpo; e-mail "já tem conta" com link de recuperação | `B/rotas/cadastro.test.ts:173-178` `toBe(202)`, `assunto toMatch(/já tem conta/i)`, `texto toContain('/recuperar')` | ✅ |
| CAD-03 | SHA-256, 256 bits, 30 min, uso único | `B/rotas/cadastro.test.ts:137` `Buffer.from(token,'base64url') toHaveLength(32)`; `:140` `token_hash.equals(sha256(token))`; `:141` `expira_em-criado_em toBe(30*60_000)` (uso único: `B/rotas/confirmar.test.ts:204`) | ✅ |
| CAD-04 | ativa, trial 14 dias, assinatura `trial` | `B/rotas/confirmar.test.ts:100` `toEqual({status:200, corpo:{status:'confirmada'}})`; `:102` `confirmado_em toBeInstanceOf(Date)` (assinatura trial com `periodo_fim` = confirmação + 14 dias: teste de `B/rotas/confirmar.test.ts:110`) | ✅ |
| CAD-05 | 400 `link_invalido`, conta intacta | `B/rotas/confirmar.test.ts:191` `toEqual({status:400, corpo:LINK_INVALIDO})`; `:192` `estadoDaConta toEqual(antes)` | ✅ |
| CAD-06 | substitui nome e senha, invalida token anterior | `B/rotas/cadastro.test.ts:225` `toMatchObject({nome:'Ana Nova'})`; `:237` `invalidado_em not.toBeNull()` | ✅ |
| CAD-07 | aceite com data, hora e versão | `B/rotas/confirmar.test.ts:92` (descrição CAD-07); `W/publico/termos.test.tsx:22-23` versão e data | ✅ |
| CAD-08 | mesmo 202, erro no Sentry | `B/rotas/cadastro.test.ts:279` `capturarErro toHaveBeenCalledWith(erro)`; `:274` corpo igual | ✅ |
| CAD-09 | login recusado com o mesmo 401 | `B/rotas/auth-entrar.test.ts:166-168` `toBe(401)`, `toEqual(RESPOSTA_LOGIN_RECUSADO)` | ✅ |

### Login, sessão e recuperação

| Critério | Resultado exigido | Evidência | Resultado |
| --- | --- | --- | --- |
| AUTH-01 | 202 `{status:'2fa_required'}`, sem sessão | `B/rotas/auth-entrar.test.ts:93-95` `toBe(202)`, `toEqual({status:'2fa_required'})`, `cookie toBeNull()` | ✅ |
| AUTH-02 | 401 com corpo único; hash também no e-mail inexistente | `B/rotas/auth-entrar.test.ts:166-168`; tempo equivalente: `B/rotas/cadastro.test.ts:208` (cadastro) | ✅ (tempo em login: ver nota) |
| AUTH-03 | CSPRNG, HMAC, 10 min, uso único | `B/rotas/auth-2fa.test.ts:167-171` primeira 200, segunda `toBe(401)` | ✅ |
| AUTH-04 | cookie `__Host-sid` com atributos, 200 com CSRF | `B/rotas/auth-2fa.test.ts:84-86` `toBe(200)`, `Object.keys(corpo) toEqual(['csrf_token'])`; atributos no teste de `:77` | ✅ |
| AUTH-05 | 5 erros invalidam o desafio | `B/rotas/auth-2fa.test.ts:213-224` quatro 401 e o código certo depois do 5º erro `toBe(401)` | ✅ |
| AUTH-06 | 202 sempre; reenvia só após 60 s | `B/rotas/auth-2fa-reenviar.test.ts:65-66` `toBe(202)`, `enviadas toHaveLength(1)` | ✅ |
| AUTH-07 | 5 falhas em 15 min bloqueiam; 429 e `Retry-After` | `B/rotas/auth-bloqueio.test.ts:74-75` `[401×4]` e a seguinte 202; `:85` cinco 401; `:106` bloco `Retry-After` | ✅ |
| AUTH-08 | 503 `mail_unavailable` | `B/rotas/auth-entrar.test.ts:229-231` `toBe(503)`, `toMatchObject({status:503, codigo:'mail_unavailable'})` | ✅ |
| AUTH-09 | 15 min de inatividade ou 12 h | `B/middleware/sessao.test.ts:78-79`; 12 h: `:146`; limites exatos: `D/identidade/regras-acesso.test.ts` ("vale aos 14:59 sem uso e encerra aos 15:00") | ✅ |
| AUTH-10 | id novo e sessão anterior encerrada | `B/rotas/auth-2fa.test.ts:254-256` `segunda not.toBe(primeira)`, `encerrada_em not.toBeNull()` | ✅ |
| AUTH-11 | 422 `curta`/`longa`/`comum` | `B/rotas/cadastro.test.ts:330-332` `toBe(422)`, `problem+json`; regra pura: `D/identidade/politica-senha.test.ts` | ✅ |
| AUTH-12 | `crypt()`/`gen_salt('bf',12)` | `S/migration-0003-identidade.test.ts:102` `hash toMatch(/^\$2a\$12\$.{53}$/)`; `:108` `confere toEqual({ok:true})` | ✅ |
| AUTH-13 | 202 vazio; token 256 bits, 30 min, anteriores invalidados | `B/rotas/recuperar.test.ts:72-74` `toBe(202)`, `corpo toBe('')`, `enviadas toHaveLength(1)` | ✅ |
| AUTH-14 | troca hash, encerra sessões, 204 | `B/rotas/redefinir.test.ts:197` `boa.status toBe(204)`; sessões encerradas: `:92` consulta `encerrada_em is null` (e `:150` link inválido não encerra) | ✅ |
| AUTH-15 | 400 `link_invalido` antes da política | `B/rotas/redefinir.test.ts:115-117` `toBe(400)`, `toEqual(PROBLEMA_LINK)`, hash intacto | ✅ |
| AUTH-16 | sem DELETE, cookie `Max-Age=0`, 204 | `B/rotas/auth-sair.test.ts:61-67` `toBe(204)`, corpo `''`, `atributos[0] toBe('__host-sid=')` | ✅ |
| AUTH-17 | 403 sem `x-csrf-token` correto | `B/middleware/csrf.test.ts:88-90` `toBe(403)`, `toEqual(CSRF_INVALIDO)` | ✅ |
| AUTH-18 | diálogo aos 120 s com contagem; "Continuar conectado" renova | `W/app/inatividade.test.tsx:85-86` aviso presente e `heading 'Sua sessão vai expirar'` | ✅ |
| AUTH-19 | limpa cache e vai a `/sessao-expirada` | `W/app/inatividade.test.tsx:170` `pathname toBe('/sessao-expirada')` | ✅ |

### Isolamento

| Critério | Resultado exigido | Evidência | Resultado |
| --- | --- | --- | --- |
| ISO-01 | `usuario_id` + RLS forçada + transação por requisição com `SET LOCAL` | `B/pipeline.test.ts:100-101` `toBe(200)`, `{usuario: login.conta.id}`; `B/db.test.ts:70-73` "não vaza para a requisição seguinte". **O mutante M10 (trocar o escopo de transação para sessão) sobrevive**: o teste não discrimina "SET LOCAL" porque cada `comTransacao` abre conexão nova no Hyperdrive simulado | ❌ GAP |
| ISO-02 | 404 idêntico em todas as tabelas | `B/isolamento/isolamento.test.ts:7` (78 referências); `B/middleware/plano.test.ts:144-146` `toBe(404)` e `ativo:false` intacto; 19 testes de isolamento | ✅ |
| ISO-03 | `evolucao_app` sem DELETE/TRUNCATE | `S/migration-0003-identidade.test.ts:270` `privilegios toEqual(...)` (mesmo padrão em todas as migrations 0002-0023) | ✅ |
| ISO-04 | `evolucao_backup_ro` só lê, lê tudo | `S/migration-0025-backup-leitura.test.ts:126` `linha?.pode toBe(true)`; `S/migration-0011-limite-uso.test.ts:274` | ✅ |

### Perfil e configurações

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PERF-01 | `B/rotas/perfil.test.ts:377-383` `completo toBe(false)`, `toBe(false)`, `toBe(true)`; redirecionamento no app: `W/app/shell.test.tsx` | ✅ |
| PERF-02 | `B/rotas/perfil.test.ts:108-110` 404 inicial; `:142` chave desconhecida 422; vazio vira null no mesmo arquivo | ✅ |
| PERF-03 | `B/rotas/perfil.test.ts:190-194` `toBe(200)`, `especialidade toEqual(...)`, linha no banco | ✅ |
| PERF-04 | `B/rotas/modelo-anamnese.test.ts:161` `[especialidade, campos.length, alertas.length] toEqual([...])` | ✅ |
| PERF-05 | `B/rotas/anamnese.test.ts:259-274` linhas de anamnese; 409 `SPECIALTY_HAS_ANAMNESIS` em `B/rotas/perfil-modelo.test.ts:7` | ✅ |
| PERF-06 | `B/rotas/perfil-fim-de-semana.test.ts:57-59` `toBe(409)`, `toEqual(problemaFimDeSemanaComSessoes(2))` | ✅ |
| PERF-07 | `B/rotas/perfil-fim-de-semana.test.ts:121-123` `toBe(200)`, `atende_sabado:false` | ✅ |
| PERF-08 | `B/rotas/configuracoes.test.ts:71-79` `toEqual({privacidade_agenda:false})`, ligar 200 | ⚠️ Lacuna de precisão: a spec diz "comportamento do legado" e o define como PREMISSA; o teste prova gravar e ler, não o efeito |
| PERF-09 | `B/rotas/configuracoes.test.ts:124-125` `auditoria toEqual([campo,campo])`, `row_version toBe(2)` | ✅ |

### Pacientes

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PAC-01 | `B/rotas/pacientes.test.ts:65-77` `toBe(201)`, corpo, linha no banco | ✅ |
| PAC-02 | `B/rotas/pacientes.test.ts:148-155` ordem e paginação `toEqual([...])`; `:208-209` `ativo=true/false`; `:228` `resposta.status toBe(400)` para valor inválido | ✅ |
| PAC-03 | `B/rotas/pacientes-ativo.test.ts:87-94` `toBe(200)`, linha `ativo` trocada, auditoria | ✅ |
| PAC-04 | `B/middleware/plano.test.ts:135-136` `toBe(200)`, `row_version: 1` mantido | ✅ |
| PAC-05 | `B/rotas/tcle.test.ts:74-82` `toBe(201)`, corpo e linhas | ✅ |
| PAC-06 | `B/rotas/paciente-ficha.test.ts:23-25` (negativo: 401 sem consulta); positivo no mesmo arquivo | ✅ |
| PAC-07 | `B/rotas/pacientes.test.ts:274-276` `status toBe(404)` e paciente intacto | ✅ |

### Agenda

| Critério | Evidência | Resultado |
| --- | --- | --- |
| AGE-01 | `B/rotas/sessoes.test.ts:72-86` `toBe(201)`, corpo, linha; 422 em `:64`+ | ✅ |
| AGE-02 | `W/app/agenda/agenda.test.tsx:173` `duracao.value toBe('50')` | ✅ |
| AGE-03 | `B/rotas/sessoes-lista.test.ts:67-69` `toBe(400)`, `toEqual(PROBLEMA_CONSULTA_SESSOES_INVALIDA)` (intervalo acima de 62 dias) | ✅ |
| AGE-04 | `B/rotas/series-alterar.test.ts:249-254` `toBe(409)`, tudo ou nada; encostar não conflita em `D/agenda/conflito.test.ts` | ✅ |
| AGE-05 | `B/rotas/series.test.ts:220` (AGE-14, AGE-05) | ✅ |
| AGE-06 | `B/rotas/series-alterar.test.ts:190-192` `toBe(422)`, `PROBLEMA_DIA_INDISPONIVEL` | ✅ |
| AGE-07 | `B/rotas/sessoes-status.test.ts:87-89` `toBe(200)`, `status: para, row_version: 2` | ✅ |
| AGE-08 | `B/rotas/sessoes-registros.test.ts:58-59` sessão intacta, sem auditoria | ✅ |
| AGE-09 | `B/rotas/sessoes-status.test.ts:217-219` `toBe(422)`, `PROBLEMA_DIA_INDISPONIVEL`, linha igual | ✅ |
| AGE-10 | `B/rotas/sessoes-status.test.ts:170` `toMatchObject({status: para, cobravel: false})` | ✅ |
| AGE-11 | `B/rotas/series-alterar.test.ts:320-322` `toBe(409)`, `PROBLEMA_VERSAO_DIVERGENTE`, sem gravar | ✅ |
| AGE-12 | `B/rotas/series-alterar.test.ts:190-192` | ✅ |
| AGE-13 | `B/rotas/series.test.ts:106-117` `toBe(201)`, série e `sessoes.map([inicio,fim]) toEqual([...])` | ✅ |
| AGE-14 | `B/rotas/series.test.ts:259-261` `toBe(409)`, `problem+json`, lista de colisões | ✅ |
| AGE-15 | `B/rotas/series-alterar.test.ts:90-93` `toBe(200)`, `row_version: 2` | ✅ |
| AGE-16 | `B/rotas/series-cancelar.test.ts:77-80` `cancelada: true`, `[id,status] toEqual(...)` | ✅ |
| AGE-17 | `B/rotas/series-cancelar.test.ts:169-174` contagem de linhas igual antes e depois | ✅ |

### Anamnese e evoluções

| Critério | Evidência | Resultado |
| --- | --- | --- |
| ANA-01/02 | `B/rotas/modelo-anamnese.test.ts:346-349` `toBe(422)`, texto não ecoado (`not.toContain('sentinela')`), banco intacto | ✅ |
| ANA-03 | `B/rotas/modelo-anamnese.test.ts:193-196` só incluir; bloqueio com anamnese no mesmo arquivo | ✅ |
| ANA-04 | `B/rotas/anamnese.test.ts:117-136` `toBe(201)`, `anamnese toMatchObject`, releitura igual | ✅ |
| ANA-05 | `B/rotas/anamnese.test.ts:297-305` `toBe(200)`, eventos de auditoria | ✅ |
| ANA-06 | `B/rotas/anamnese-retificar.test.ts:116-127` `toBe(201)`, `retificacoes toEqual([...])` | ✅ |
| ANA-07 | `B/rotas/anamnese-retificar.test.ts:220` `retificacoesNoBanco toEqual([])` (409 `EDIT_WINDOW_OPEN` no teste de `:209`) | ✅ |
| ANA-08 | `B/rotas/anamnese-retificar.test.ts:223` sem conteúdo novo; `:259-260` 422/`validacao` | ⚠️ Lacuna de precisão: a spec diz "responder 400" e o teste do conteúdo igual afirma 400 em `:223`, mas a validação do motivo responde 422 (`:259`); a spec não distingue os dois casos |
| ANA-09 | `D/anamnese/valores.test.ts:181-183` `versaoVigente(...) toBe(retificacao)`; selos no app: `W/app/anamnese/anamnese.test.tsx` | ✅ |
| EVO-01 | `B/rotas/evolucoes.test.ts:73-89` `toBe(201)`, evolução, linhas | ✅ |
| EVO-02 | `B/rotas/evolucoes.test.ts:141` 409 `EVOLUTION_EXISTS` | ✅ |
| EVO-03 | `B/rotas/evolucoes.test.ts:154-156` `toBe(201)`, `sessao_id`, sessão vira `realizada`. **Só pela API**: a interface não gera `?sessao=` (ver Achados) | ⚠️ Cobertura de API; sem efeito pela interface |
| EVO-04 | `B/rotas/evolucoes-editar.test.ts:76-83` `toBe(200)`, `{texto, row_version: 2}` | ✅ |
| EVO-05 | `B/rotas/evolucoes-retificar.test.ts:92-102` `toBe(201)`, original `{texto:'original', row_version:1}` | ✅ |
| EVO-06 | `B/rotas/evolucoes-retificar.test.ts:235` `retificacoesNoBanco toEqual([])` | ✅ |
| EVO-07 | `B/rotas/evolucoes-retificar.test.ts:248-251` `status toBe(404)` para DELETE | ✅ |

### Financeiro e Início

| Critério | Evidência | Resultado |
| --- | --- | --- |
| FIN-01/02 | `B/rotas/precos.test.ts:117-125` `toBe(200)`, `precoNoBanco toEqual([{valor_centavos:'15050', row_version:1}])`; 409 em `:112+` | ✅ |
| FIN-03/04/08 | `B/rotas/pagamentos.test.ts:103-114` `toBe(201)`, pagamento e linhas; 422 `PRICE_REQUIRED` e auditoria no mesmo bloco | ✅ |
| FIN-05 | `B/rotas/pagamentos.test.ts:206-227` `toBe(201)` com confirmação, `revisoesDa` | ✅ |
| FIN-06/07 | `B/rotas/debitos.test.ts:105-139` `toEqual(...)` da lista e `paciente_id toEqual([ana, carla])`; regra pura `D/financeiro/debitos.test.ts` | ✅ |
| FIN-09 | `W/app/financeiro/pagamento.test.tsx:63-68` data padrão e meios; `:114` `PRICE_REQUIRED`; `:128` `PAYMENT_DUPLICATE` com confirmação; `W/app/financeiro/preco.test.tsx:116` 409 `versao_divergente`; `W/app/financeiro/financeiro.test.tsx:171` link "Registrar pagamento"; `W/app/inicio/inicio.test.tsx:227` atalho "Pagamento" | ✅ |
| INI-01/02/03 | `B/rotas/inicio.test.ts:117-120` `hoje toHaveLength(6)`, `[id,status,evolucao,pagamento] toEqual(...)` | ✅ |

### Planos, cobrança, exportação, conta, auditoria

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PLANO-01 | `D/plano/assinatura.test.ts:37-47` estados e `aceitas toHaveLength(8)`, `recusadas toHaveLength(17)` | ✅ |
| PLANO-02 | `B/middleware/plano.test.ts:271-273` criar 201, reativar 200, `totalPacientes toBe(8)` | ✅ |
| PLANO-03 | `B/middleware/plano.test.ts:71-77`; `:82` 403 `LIMITE_PLANO`, sem gravar | ✅ |
| PLANO-04 | `B/tarefas/assinaturas.test.ts:94-102` `free`, dados intactos, auditoria | ✅ |
| PLANO-05 | `B/rotas/plano-assinar.test.ts:62-64` `toBe(201)`, `RESPOSTA_ASSINAR`, `['criarCliente','criarAssinatura']`; Pix: `B/rotas/plano.test.ts:213-222` (`valor_centavos: 1990`) | ✅ |
| PLANO-06 | `B/rotas/webhook-asaas.test.ts:43-45` `toBe(401)`, `chamadas toEqual([])` | ✅ |
| PLANO-07 | `B/rotas/webhook-asaas.test.ts:69-71` `toBe(200)`, `{status:'processado'}`; repetido sem efeito | ✅ |
| PLANO-08 | `B/rotas/webhook-pago.test.ts:56-58` `toBe(200)`, `linhaAssinatura` com `ativa` e `periodo_fim` | ✅ |
| PLANO-09 | `B/rotas/webhook-vencida.test.ts:48-55` `atrasada`, auditoria | ✅ |
| PLANO-10 | `B/tarefas/assinaturas.test.ts:217-225` `cancelamentos toEqual([assinatura])`, `free`, dados intactos | ✅ |
| PLANO-11 | `B/rotas/plano-cancelar.test.ts:52-54` `toEqual({status:'cancelada', periodo_fim})`, `cancelarAssinatura` chamado | ✅ |
| PLANO-12 | `B/rotas/plano-assinar.test.ts:174` `toBe(503)`; `B/rotas/plano-cancelar.test.ts:130` `toBe(503)`; `B/integracoes/asaas.test.ts:216-217` | ✅ |
| PLANO-13 | `B/rotas/webhook-emails.test.ts:63-66` um e-mail por evento | ✅ |
| PLANO-14 | `B/rotas/plano.test.ts:117-124` `toBe(200)`, corpo, sem chamada ao Asaas quando não há assinatura | ✅ |
| PLANO-15 | `B/middleware/plano.test.ts:18` (limite aplicado na API, testado por requisição HTTP) | ✅ |
| EXP-01 | `B/rotas/exportar-prontuario.test.ts:174-176` paciente, período e profissional `toEqual(...)` | ✅ |
| EXP-02 | `W/export/pdf-prontuario.test.ts:101` `nomeArquivoProntuario(...) toBe('prontuario-0a1b2c3d.pdf')`; `:112` rodapé "Prontuário — documento confidencial" | ✅ |
| EXP-03 | `B/rotas/exportar-tudo-conclusao.test.ts:61` `tabelas toEqual(TABELAS_EXPORTACAO)`; `:63` sem tabelas proibidas; zip: `W/export/zip-completo.test.ts:45` | ✅ |
| EXP-04 | `B/rotas/exportar-tudo.test.ts:276,307` `auditoriaTotal toBe(antes)` (400 sem auditar), `TAMANHO_MAXIMO_PAGINA` importado do contrato | ✅ |
| EXP-05 | `B/middleware/limite-exportacao.test.ts:36-39` `[200×5]` e o sexto `toBe(429)`, contador em tabela | ✅ |
| EXP-06 | `B/rotas/exportar-prontuario.test.ts:467,482` evento `exportacao.concluida`, sem conteúdo | ✅ |
| EXP-07 | `B/rotas/exportar-prontuario.test.ts:441-443` `toBe(404)`, `PROBLEMA_PRONTUARIO_NAO_ENCONTRADO` | ✅ |
| CONTA-01 | `B/rotas/conta-excluir.test.ts:78-79` `toBe(202)` com tudo; 422 por requisito no mesmo arquivo | ✅ |
| CONTA-02 | `B/rotas/conta-excluir-email.test.ts:65-68` `toBe(202)`, um e-mail ao dono | ✅ |
| CONTA-03 | `B/rotas/conta-excluir-confirmar-asaas.test.ts:74-76` `cancelarAssinatura`, `status: 'cancelada'` | ✅ |
| CONTA-04 | `B/rotas/conta-desistir.test.ts:71-73` `toBe(200)`, `{status:'desbloqueada'}`, `bloqueio toBeNull()` | ✅ |
| CONTA-05 | `B/tarefas/purga-varredura.test.ts:226-231` varredura pelo catálogo, `varrer(A) toEqual({conta_excluida: 1})` | ✅ |
| CONTA-06 | `W/publico/termos.test.tsx:22-30` versão, data, "profissional é o controlador", "LJS é a operadora" | ✅ |
| AUD-01 | `B/rotas/confirmar.test.ts:295-297` falha da auditoria: 500 e conta intacta | ✅ |
| AUD-02 | `backend/contrato/src/auditoria.test.ts:107` `aceita({acao:'evolucao.texto_livre'}) toBe(false)`; `:131` alvo fora da lista | ✅ |
| AUD-03 | `B/rotas/auditoria.test.ts:169-172` `toBe(200)`, `acoes(corpo) toEqual([...])` | ✅ |
| AUD-04 | `B/rotas/auth-2fa.test.ts:120` `eventos toEqual([...])` para `auth.login_ok` | ✅ |

### Landing, PWA, operação, P2

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PUB-01 | `W/publico/landing.test.tsx:24-43` Free até 5 pacientes, Pro R$ 19,90, trial de 14 dias, "Começar grátis" para `/cadastro` | ✅ |
| PUB-02 | `W/app/shell.test.tsx:61-63` navegação do legado; `.specs/features/evolucao-segura/comparacao-visual.md` (todas as diferenças decididas pelo usuário em 2026-10-28) | ⚠️ Lacuna de precisão: "mesmo layout" não é mensurável; a prova é a conferência humana, não teste automático |
| PUB-03 | `W/pwa/manifesto.test.ts:13-22` standalone, ícones 192/512 maskable; `W/pwa/offline.test.ts:93` precache; `W/pwa/sw.test.ts:68` push/clique. **"Instalável pelo Chrome" não foi testado por nenhum teste, e o service worker quebra navegação a `/app/*` (Achado 1)** | ⚠️ Cobertura parcial |
| PUB-04 | `W/pwa/instrucao-ios.test.tsx:59` instrução com "Compartilhar" e "Adicionar à Tela de Início" | ✅ |
| PUB-05 | `B/cabecalhos.test.ts:59,66` `Cache-Control toBe('no-store')` (inclusive no 404) | ✅ |
| OPS-01 | `S/backup-workflow.test.ts:32` `schedule toEqual([{cron:'0 7 * * *'}])` (04:00 Brasília); `:42` `pg_dump -Fc --enable-row-security`; age e retenção no mesmo arquivo | ✅ |
| OPS-02 | `S/migration-0025-backup-leitura.test.ts:126`; execução real: seção Restauração abaixo | ⚠️ Evidência fraca em produção (banco vazio), reforçada por mim com dados |
| OPS-03 | `S/deploy-workflow.test.ts:54,58,63,69,72` só `workflow_dispatch`, só `main`, environment `producao`, `cancel-in-progress toBe(false)`, ordem | ✅ |
| OPS-04 | `S/wrangler-deploy.test.ts:76,104` `arquivosComDeploy(raiz) toEqual([ARQUIVO_PERMITIDO])` e `toEqual([])` | ✅ |
| OPS-05 | `S/ci-workflow.test.ts:34-50` push e pull_request, comandos, `migrar` antes do isolamento | ✅ |
| OPS-06 | `B/health.test.ts:18-23` `toBe(200)`, `{status:'ok'}`, `HYPERDRIVE.connectionString` lança | ✅ |
| OPS-07 | `B/limite.test.ts:82-86` `passes` entre 10 e 11, depois 429; 60/min em `:117`; webhook em `:126` | ⚠️ Lacuna de precisão: o limite é por binding, com tolerância de ±1 no teste; a spec diz "passa de 10" |
| OPS-08 | `B/sentry.test.ts:59-65` `release toBe('24f04e0')`; remoção de cookie/corpo/e-mail em `:35-38`; app: `W/sentry.test.ts:5` | ✅ |
| OPS-09 | `B/cabecalhos.test.ts:20-31` HSTS, nosniff, no-referrer, CSP com `frame-ancestors 'none'` e `default-src 'self'` | ✅ |
| OPS-10 | `S/guardas-codigo.test.ts:34-39` `temUrlAbsolutaDoApp(...) toBe(true/false)` | ✅ |
| OPS-11 | `S/env-example.test.ts:26` toda variável do esquema aparece no `.env.example`; `B/ambiente.test.ts:4` | ✅ |
| OPS-12 | sem teste automático; conferido por leitura: `README.md` tem Rodar localmente, Variáveis, Deploy, Backup e restauração, Testar o webhook; `docs/runbook.md` seções 1 a 5 (webhook, reprocessar, reativar, rotacionar, restaurar); `.specs/features/evolucao-segura/validacao-readme.md` registra execução por agente sem contexto | ✅ (por leitura) |
| OPS-13 | `S/hyperdrive.test.ts:21` `--caching-disabled`; `S/cache-hyperdrive.test.ts:35-39` | ✅ |
| OPS-14 | `S/guardas-codigo.test.ts:72-87` `dependenciasProibidas(...)`, `arquivosComImportacaoProibida(raiz) toEqual([...])` | ✅ |
| RAS-01 | `B/rotas/rascunhos.test.ts:87-89` `toBe(200)`, `etag toBe('"1"')` | ✅ |
| RAS-02 | `B/rotas/rascunhos.test.ts:197-227` versão e 412 | ✅ |
| RAS-03 | `B/rotas/modelos-texto.test.ts:72-82` `toBe(201)`, `listar toEqual([modelo])` | ✅ |
| RAS-04 | `W/app/evolucao/evolucao.test.tsx:148-152` oferta de restaurar, nenhuma escrita automática | ✅ |
| PUSH-01 | `B/rotas/push.test.ts:73-82` `toBe(204)`, linhas | ✅ |
| PUSH-02 | `B/tarefas/push-sessao.test.ts:123` `porExecucao toEqual({'13:40':0,'13:45':1,'13:50':0,...})`; execução perdida: `:128` | ✅ |
| PUSH-03 | `B/tarefas/push-pendente.test.ts:115-117` sem pendências nada é enviado; positivo no mesmo arquivo | ✅ |
| PUSH-04 | `B/tarefas/push-cobranca.test.ts:139-142` títulos enviados e `avisos toEqual(...)` | ✅ |
| PUSH-05 | `B/tarefas/push-cobranca.test.ts:299` `texto not.toContain(proibido)` | ✅ |
| PUSH-06 | `B/integracoes/push.test.ts:227-228` `'assinatura_removida'`, `existe toBe(false)` | ✅ |
| PUSH-07 | `B/integracoes/push-lotes.test.ts:92-93` `emSegundoPlano toHaveBeenCalledTimes(1)`; VAPID: `B/integracoes/push-vapid.test.ts` | ✅ |
| PUSH-08 | `W/pwa/sw.test.ts:74-84` `destinoDoClique(url, ORIGEM) toBe(esperado)` | ✅ |

**Status**: ✅ 147 critérios cobertos com o resultado da spec; ⚠️ 7 com lacuna de precisão ou cobertura parcial (PERF-08, ANA-08, EVO-03, PUB-02, PUB-03, OPS-02, OPS-07); ❌ 1 critério com mutante sobrevivente (ISO-01).

**Nota sobre AUTH-02**: o tempo de resposta equivalente no caminho de e-mail inexistente é afirmado de forma explícita só no cadastro (`B/rotas/cadastro.test.ts:208`, `toBeGreaterThan(novo*0.5)`, tolerância larga); no login (`B/rotas/auth-entrar.test.ts:159`) a igualdade de corpo e status é afirmada, e o cálculo de hash no caminho inexistente é coberto pelo teste de `crypt`; a medição de tempo do login em si não foi localizada.

---

## Casos limite

- [x] Neon em autosuspend: `B/db.test.ts:142-149` afirma `connectionTimeoutMillis: 8_000` e `TEMPO_LIMITE_CONEXAO_MS toBe(8_000)`. ⚠️ Lacuna de precisão: a spec diz "dentro do timeout do Worker" sem número, e nenhum teste simula o cold start; só a configuração é verificada. A decisão está em `design.md:175`.
- [x] Resend com limite diário: `B/integracoes/resend.test.ts:103-108` `erro toMatchObject({tipo:'limite', status:429})`; 503 `mail_unavailable` em `B/rotas/auth-entrar.test.ts:229-231`; alerta no Sentry em `backend/api/src/integracoes/resend.ts:49`.
- [x] Duas abas na mesma sessão ou evolução: 409 por `row_version`, `B/rotas/series-alterar.test.ts:320` e `B/rotas/evolucoes-editar.test.ts:72`.
- [x] Webhook antes da resposta da criação: `B/rotas/webhook-pago.test.ts:155` ("webhook antes da resposta da criação (edge case)").
- [x] Meia-noite com evolução aberta: `W/app/evolucao/evolucao.test.tsx:237-275` recusa, mantém o texto e oferece retificar.
- [x] Cron perdido: `B/tarefas/push-sessao.test.ts:128` "se a execução das 13:45 se perdeu, a das 13:50 envia (uma vez)".
- [x] Free com 5 ativos inativa um paciente e pode criar: `B/middleware/plano.test.ts:209` ("inativar libera a vaga").

---

## Discrimination Sensor

Profundidade: **P0 completo manual** (≥ 5 mutações; área de auth, isolamento, dinheiro, webhook, LGPD, backup). Cada mutação aplicada numa worktree temporária e revertida (`git checkout -- <arquivo>`, `git status --porcelain` limpo após cada uma); testes alvo rodados com `pnpm exec vitest run <arquivos>`.

| Mut. | Arquivo:linha | Falha injetada | Testes rodados | Morta? |
| --- | --- | --- | --- | --- |
| M1 | `backend/dominio/src/identidade/regras-acesso.ts:11` | `LIMITE_ERROS_2FA = 5` → `6` (AUTH-05) | `regras-acesso.test.ts`, `auth-2fa.test.ts` | ✅ morta ("o 4º erro mantém o desafio e o 5º o invalida") |
| M2 | `backend/scripts/migrations/0006_pacientes.ts:55` | política de RLS `USING (usuario_id = ...)` → `USING (true)` na tabela `paciente` (ISO-01/02) | `isolamento.test.ts`, `migration-0006-pacientes.test.ts` | ✅ morta ("o profissional só enxerga as próprias linhas") |
| M3 | `backend/api/src/middleware/csrf.ts:11` | `POST` tratado como leitura, sem exigir CSRF (AUTH-17) | `csrf.test.ts` | ✅ morta ("POST sem o cabeçalho: 403 sem executar") |
| M4 | `backend/api/src/rotas/webhook-asaas.ts:82` | `timingSafeEqual(a, b)` → `a.byteLength === b.byteLength` (aceita qualquer token; PLANO-06) | `webhook-asaas.test.ts` | ✅ morta ("com outro token responde 401 sem processar") |
| M5 | `backend/scripts/migrations/0014_funcoes_webhook.ts:54` | `ON CONFLICT DO NOTHING` → `DO UPDATE` (quebra a idempotência; PLANO-07) | `webhook-asaas.test.ts`, `migration-0014-funcoes-webhook.test.ts` | ✅ morta ("event_id repetido devolve 'repetido'") |
| M6 | `backend/dominio/src/financeiro/debitos.ts:18` | `faltou/cancelada` em débito mesmo sem `cobravel` (dinheiro; FIN-06) | `debitos.test.ts` (domínio e API) | ✅ morta (22 falhas) |
| M7 | `backend/dominio/src/plano/assinatura.ts:89` | `ativos >= 5` → `ativos > 5` (limite do Free; PLANO-03) | `assinatura.test.ts`, `plano.test.ts` | ✅ morta ("Free com 5 ativos: LIMITE_PLANO") |
| M8 | `backend/scripts/migrations/0023_funcoes_purga.ts:113` | remove `DELETE FROM public.pagamento` da purga (LGPD; CONTA-05) | `migration-0023-funcoes-purga.test.ts`, `purga-varredura.test.ts`, `purga.test.ts` | ✅ morta (11 falhas, varredura pelo catálogo) |
| M9 | `.github/workflows/backup.yml:58` | remove `--enable-row-security` do `pg_dump` (backup; OPS-01) | `backup-workflow.test.ts` | ✅ morta |
| M10 | `backend/api/src/db.ts:345` | `set_config('app.usuario_id', ..., true)` → `false` (sai do escopo de transação para o de sessão; ISO-01) | `db.test.ts`, `pipeline.test.ts`, `isolamento.test.ts` (40 testes) | ❌ **sobreviveu** (40 passam) |
| M11 | `backend/dominio/src/agenda/conflito.ts:19` | `<` → `<=` (sessões que só se encostam passam a conflitar; AGE-04) | `conflito.test.ts` | ✅ morta |
| M12 | `backend/dominio/src/identidade/regras-acesso.ts:6` | inatividade 15 → 16 min (AUTH-09) | `regras-acesso.test.ts`, `sessao.test.ts` | ✅ morta ("vale aos 14:59 sem uso e encerra aos 15:00") |

**Resultado**: 11 de 12 mortas, **FAIL ❌** (1 sobrevivente).

**Sobre M10**: o teste `B/db.test.ts:70-73` ("o contexto do usuário não vaza para a requisição seguinte") só consegue ver o vazamento se duas chamadas de `comTransacao` compartilharem a conexão do banco. No harness local cada chamada abre um `pg.Client` novo e o fecha, então o mutante é invisível. A prova de que `true` (transação) é necessário em produção está só no spike `.specs/spikes/set-local-hyperdrive/resultado.md` (carga real, 0 de 3.000 divergências), que não é teste automático da suíte. Se o Hyperdrive reaproveitar a conexão e a variável vazar, uma rota pública sem `set_config` leria `app.usuario_id` do usuário anterior (o comportamento "fica nulo" descrito em `db.ts:16`). Correção sugerida: teste que roda `comTransacao` duas vezes sobre uma única conexão compartilhada (ou que inspeciona o SQL emitido) e exige `is_local = true`.

---

## Gate Check

- **Gate command**: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @es/web build` (Build do `tasks.md`), com `DATABASE_URL` apontando para `127.0.0.1:5433`.
- **Execuções completas de `pnpm test`**:

| # | Resultado |
| --- | --- |
| 1 | **Caiu no início** com `workerd/jsg/setup.c++:38: fatal: V8 fatal error ... JavaScript heap out of memory` (17 s, nenhum teste rodou). Não reproduziu |
| 2 | 210 arquivos, 3315 passaram, **1 falhou**: `backend/api/test/rotas/plano.test.ts:234`, `expect(asaas.chamadas.filter(c => c.operacao === 'buscarQrPix')).toHaveLength(2)` recebeu 1 |
| 3 | 210 arquivos, **3316 passaram, 0 falharam, 0 pulados** (239 s) |
| 4 | (via `trava-testes.py --rodar`) lint, typecheck e 3316 testes passaram, "SUÍTE VERDE. Commit d3eab8e registrado como verde." |

- **lint**: saída 0 (eslint + prettier). **typecheck**: saída 0 (6 pacotes). **build do web**: saída 0 (`dist/` gerado, aviso de chunk > 500 kB, não bloqueia).
- **Pulados**: 0 (nenhum `.skip/.todo/.only/xit` no código).
- **Falha intermitente (`plano.test.ts:234`)**: passou 2 vezes isoladas e 2 vezes na suíte completa. O teste chama `lerPlano` duas vezes e **não afirma o status da segunda resposta**, então a causa (provável erro transitório sob carga) fica escondida. Defeito de qualidade do teste: ele deveria afirmar `status` 200 nas duas chamadas.
- **Test count before feature**: não se aplica (projeto começou vazio); **after**: 3316. **Delta**: +3316.
- **Integridade dos testes ao longo da feature** (`git log`): nenhum arquivo de teste foi apagado (`--diff-filter=D` vazio); nenhum teste pulado; dos 41 pares commit+arquivo de teste com linhas de asserção removidas, nenhum remove mais asserções do que acrescenta (renomeações como as roles em `9f3f4ae`, `ad84e6a`, `54369d7`: troca 1 por 1 com motivo no commit). Mudança aprovada pelo usuário registrada em `W/rotas.test.tsx:19`.

### `trava-testes.py --rodar`

```
$ eslint . && prettier --check .
$ pnpm -r --if-present typecheck
$ vitest run
SUÍTE VERDE. Commit d3eab8e registrado como verde.   (saída 0)
```

Sobre o `JSONDecodeError` sem argumentos: sem `--rodar` o script entra no modo de gancho (`modo_hook`), que faz `json.load(sys.stdin)`; com a entrada vazia (terminal ou `</dev/null`) o `json` lança `JSONDecodeError: Expecting value: line 1 column 1 (char 0)` (reproduzido). Não é falha do produto; falta proteger o gancho contra entrada vazia.

### Restauração do backup a partir de cópia limpa

- **Executado por mim**: banco de origem migrado do zero (25 migrations), semeado com 2 profissionais e 14 pacientes, `pg_dump -Fc`, cifrado com `age`, restaurado por `infra/restore-test.sh` num banco descartável com `RESTORE_SOURCE_URL` apontando para a origem. Saída: 35 tabelas `OK` (todas as do schema `public`, mais `pgmigrations`) com contagem igual à da origem (`usuario` 2, `paciente` 14, `pgmigrations` 25), `resultado=ok`, `status=ok duracao=19s`. Banco de origem apagado depois.
- **Limites**: o dump foi feito pelo `postgres` com `pg_dump` 16 (o Postgres local é o 16; produção é o 18) e não pela role `evolucao_backup_ro` com RLS.
- **Só lido**: `docs/runbook.md:373-408` registra a restauração de produção de 2026-10-29 (run `40910306123`, 233.396 bytes, 35 tabelas, `status=ok`) mas as 34 tabelas de negócio tinham 0 linhas e a origem não foi comparada ("Origem comparada: não"). Esse registro prova que o pipeline de backup e restore roda, não que dados reais voltam íntegros. A execução com dados que fiz acima cobre essa lacuna só em ambiente local.

---

## Code Quality

| Princípio | Status |
| --- | --- |
| Testes mapeiam critério de aceite e não são rasos (amostra: cadastro, auth-2fa, isolamento, webhook) | ✅ (asserções exatas de status, corpo e banco; mutantes mortos) |
| Testes citam critério (155 IDs) e nenhum teste apagado/pulado | ✅ |
| Resultado esperado da spec nas asserções | ✅ com as 7 lacunas de precisão listadas |
| Cobertura por camada: domínio 1:1, rotas com feliz + borda + erro | ✅ (rotas têm bloco de erro por critério); ❌ exceção em ISO-01 (M10) |
| Teste intermitente | ❌ `plano.test.ts:234` não afirma o status da segunda resposta |
| Diretrizes seguidas | `.specs/projeto/` e `padrao-ljs.md`; sem novas violações vistas |
| Escopo e padrões | ✅ nenhum arquivo fora do escopo da feature verificado por amostragem; CI roda lint, typecheck, testes, gitleaks, build, migração e isolamento (`.github/workflows/ci.yml`) |

---

## Achados (defeitos sem tarefa, registrados sem correção)

1. **Service worker pode quebrar a navegação direta a `/app/*`** (alto). `frontend/web/src/pwa/offline.ts:67-71` guarda `/index.html` buscado por `fetch`; `:94-99` devolve esse shell para qualquer navegação em `/app`. O Worker responde `/index.html` com 307 para `/` (o próprio `e2e/playwright.config.ts` documenta isso e por isso bloqueia o service worker no e2e), e uma resposta com `redirected = true` não pode atender navegação. Nenhum teste (`offline.test.ts`) cobre `redirected`. Confirmado por leitura do código e do comentário; **não executado em navegador**.
2. **EVO-03 sem efeito pela interface** (alto). `frontend/web/src/app/evolucao/evolucao.tsx:516` só liga a evolução à sessão com `?sessao=<id>`; os links para a tela (`inicio.tsx:82`, `inicio.tsx:157`, `pacientes/ficha.tsx:62`) apontam para `/app/pacientes/:id/evolucao` sem `sessao`. O e2e (`e2e/apoio/clinico.ts:66`) navega direto com `?sessao=`, o que esconde o problema. O fluxo "agenda → evolução → pagamento" do critério de sucesso não é alcançável por cliques.
3. **E2E fora do CI** (médio). `.github/workflows/ci.yml` não chama `pnpm e2e`; e eu não o executei (usa `localhost:5433` fixo em `e2e/apoio/config.ts:14`, que trava nesta máquina; 2 dos 8 specs exigem a chave do sandbox do Asaas, conforme o `README.md`). O critério de sucesso "e2e Playwright verde" não tem prova nesta validação.
4. **`trava-testes.py` sem argumentos**: causa isolada (modo de gancho lendo JSON vazio). Baixo; é script de fluxo, não do produto.
5. **Falha intermitente de `plano.test.ts:234`** (médio, teste frágil) e **queda de `workerd` por falta de memória** na primeira execução completa (não reproduziu; registrar caso volte).
6. **`localhost` → IPv6 trava o Postgres local no Windows**: sem `DATABASE_URL` com `127.0.0.1`, a suíte da API fica parada sem mensagem. `backend/api/vitest.urls.ts` e `e2e/apoio/config.ts` usam `localhost` como padrão. Baixo (ambiente), mas custa horas a quem tropeça; sugerir `127.0.0.1` como padrão.
7. **Restauração em produção registrada com banco vazio** (médio, ver Restauração).
8. **29 tarefas acima de 2 h** (anotado, não bloqueia).
9. **Lacunas de precisão da spec**: PERF-08 (`privacidade_agenda` "comportamento do legado"), ANA-08 (400 × 422), OPS-07 (tolerância do binding), PUB-02 ("mesmo layout"), PUB-03 ("instalável pelo Chrome" sem teste), Neon cold start ("timeout do Worker" sem valor), e as duas marcações `[A ESCLARECER]` da spec (prazo legal de guarda e subdomínio), que a spec já declara como pré-requisitos de publicação.

---

## Fix Plans

1. **Fix 1 (Major) - mutante M10**: acrescentar teste que prove `is_local = true`, p. ex. `comTransacao` duas vezes sobre uma única conexão compartilhada (ou verificar `current_setting` após o `COMMIT` na mesma conexão). Prioridade: Major (isolamento multi-inquilino).
2. **Fix 2 (Major) - service worker**: tratar `redirected` ao guardar/devolver o shell (reconstruir `new Response(await r.blob(), ...)` ou buscar `/` em vez de `/index.html`) e acrescentar teste. Verificar em navegador real, com o service worker ligado.
3. **Fix 3 (Major) - EVO-03 pela interface**: gerar `?sessao=<id>` nos links da lista de hoje do Início e da agenda; ajustar o e2e para clicar em vez de navegar direto.
4. **Fix 4 (Major) - e2e no CI** (ou registrar a decisão de deixá-lo local) e executá-lo uma vez verde.
5. **Fix 5 (Minor) - `plano.test.ts:234`**: afirmar o status das duas respostas para expor a causa da intermitência.
6. **Fix 6 (Minor) - restauração**: refazer a restauração de produção quando houver dados, comparando contagens com a origem.

---

## Requirement Traceability Update

Não alterei `spec.md` (a tabela de rastreabilidade continua com os rótulos antigos "Implementing/Pending"; a atualização cabe ao orquestrador depois do re-teste). Estado conforme esta validação: 147 requisitos "Verificados"; "Precisam de correção": ISO-01; "Verificados com ressalva": PERF-08, ANA-08, EVO-03, PUB-02, PUB-03, OPS-02, OPS-07.

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 147/155 critérios com a asserção igual ao resultado da spec; 7 com lacuna de precisão ou cobertura parcial; 1 critério (ISO-01) com mutante sobrevivente.
**Sensor**: 11/12 mutações mortas (M10 sobreviveu).
**Gate**: lint, typecheck, build verdes; `pnpm test` 210 arquivos / 3316 testes, 0 pulados, verde em 2 de 3 execuções completas (1 falha intermitente e 1 queda do `workerd` por memória).

**What works**: cobertura de teste por critério muito boa (155 de 155 IDs, asserções exatas de status, corpo, banco e auditoria); isolamento por RLS provado por testes e mutações (M2); auth, CSRF, webhook, idempotência, purga e backup com mutantes mortos; restauração do backup cifrado reproduzida com dados e contagens iguais; nenhum teste apagado, pulado ou enfraquecido ao longo da feature; 201 tarefas concluídas.

**Issues found**: ver Achados e Fix Plans (M10, service worker, EVO-03 sem efeito na interface, e2e fora do CI, teste intermitente, restauração de produção com banco vazio).

**Next steps**: executar os Fix 1 a 5, depois rodar de novo esta validação (máximo de 3 iterações antes de escalar ao usuário). O `validation.md` não foi commitado.
