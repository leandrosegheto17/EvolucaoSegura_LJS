# Evolução Segura: validação independente (ciclo 2 de 3)

## Validation (validação): evolucao-segura - PASS ✅ (com ressalvas que não bloqueiam)

**Data**: 2026-10-29
**Spec**: `.specs/features/evolucao-segura/spec.md` (155 requisitos: 143 P1, 12 P2; PERF-08, ANA-08, OPS-07 e a borda do Neon ajustados em 2026-10-29)
**Commit verificado**: `2f8dc41` (main; árvore limpa antes e depois do meu trabalho, salvo este arquivo)
**Diff range**: `d3eab8e..2f8dc41` (17 commits: Phase 24, T202 a T213; T211 cancelada de propósito) mais a feature inteira para o rastreio
**Verificador**: sub-agente independente (autor diferente do verificador). Ciclo anterior: FAIL em `d3eab8e` (11 de 12 mutantes mortos).

**Resumo do ciclo 2**: os seis motivos do FAIL anterior foram tratados e cada um reverificado por mim (tabela abaixo). Os 155 critérios têm asserção localizada (`arquivo:linha`) que bate com o resultado da spec; 7 têm lacuna de precisão da spec ou cobertura parcial (nenhuma nova bloqueia). A injeção de falhas passou de 12 para 27 mutações, **27 mortas, 0 sobreviventes** (o M10 do ciclo 1 agora morre). A suíte completa passou (3362 testes, 212 arquivos) em 1 de 2 execuções minhas: a outra teve 1 falha intermitente de tempo limite em `sentry.test.ts` (ressalva 1). O defeito do service worker foi **reproduzido e corrigido num Chrome real** (antes: `ERR_FAILED`; depois: página abre).

**Resultado de cada eixo**:

- **Spec-anchored**: 148 de 155 critérios com asserção igual ao resultado da spec; 7 com lacuna de precisão ou cobertura parcial (PERF-08 parte "financeiro", PUB-02, PUB-03, OPS-02, OPS-07, mais ANA-08 e EVO-03 agora com a spec precisa, ver tabela).
- **Gate**: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 212 arquivos / 3362 testes, 0 pulados (execução 2 verde; execução 1 com 1 falha de tempo limite), `pnpm --filter @es/web build` 0.
- **Sensor**: 27 mutações, 27 mortas, 0 sobreviveram.

---

## O que reprovou no ciclo 1 e o que fiz de novo

| # | Motivo do FAIL no ciclo 1 | Correção | Reverificação independente | Situação |
| --- | --- | --- | --- | --- |
| 1 | M10 sobrevivia (`set_config(..., true)` → `false`) | T202: `backend/api/test/db.test.ts:136-173` | Mutante M10 refeito: `db.test.ts` falha ("o usuário da primeira transação não vaza para a seguinte na mesma conexão"); `db.test.ts:160-167` | ✅ corrigido |
| 2 | Service worker guardava e devolvia resposta `redirected` (quebra navegação direta a `/app/*`) | T203: `frontend/web/src/pwa/offline.ts:49-56,71,97,115` | 4 mutantes do código novo mortos (M13 a M16); **prova em Chrome real**: com `offline.ts` de `d3eab8e` o cache guarda `/index.html` com `redirected: true` e `page.goto('/app/agenda')` com o SW ativo dá `net::ERR_FAILED`; com `2f8dc41` o cache guarda `redirected: false`, a página é servida e o app abre (seção Service worker) | ✅ corrigido |
| 3 | EVO-03 inalcançável pela interface (nenhum link gerava `?sessao=`) | T204, T205, T206: `inicio.tsx:83,158`, `agenda.tsx:202`, `evolucao/api.ts` (`urlEvolucaoDaSessao`), `e2e/apoio/clinico.ts` | 5 mutantes (M17 a M20, M27) mortos; e2e por cliques passou (`fluxo-principal`, `fluxo-pagamento`) | ✅ corrigido |
| 4 | e2e fora do CI e nunca executado | T208: `.github/workflows/e2e.yml`, `backend/scripts/test/ci-e2e.test.ts` | Mutante M26 morto; **executei o e2e**: 6 passaram, 2 pulados (sem `ASAAS_API_KEY`). O job só roda no GitHub: não confirmado até o primeiro push | ⚠️ parcial (ressalva 2) |
| 5 | `plano.test.ts:234` intermitente (status não afirmado) | T209: `plano.test.ts:227-241` afirma `toBe(200)` e `pix.copia_e_cola` nas duas aberturas | Lido e executado (verde nas 2 execuções completas e isolado) | ✅ corrigido |
| 6 | Restauração registrada em produção com banco vazio | (sem tarefa; o runbook segue com o registro de T165) | **Refiz a restauração com dados** a partir de dump cifrado pela role `evolucao_backup_ro` (seção Restauração) | ✅ coberto, mantida a nota de que o registro de produção tem 0 linhas |

Também tratados na Phase 24 e conferidos: T207 (`127.0.0.1` como padrão; `backend/scripts/test/urls-banco-teste.test.ts`, mutante M25 morto), T210 (privacidade da agenda; mutantes M21 a M23 mortos), T212 (hash no e-mail inexistente sem cronômetro; mutante M24 morto), T213 (`maxWorkers: 6`).

---

## Preparação e isolamento

- Baseline antes de qualquer sensor: `git status --porcelain` vazio; `git worktree list` com a árvore real e `C:/Users/leand/orca/workspaces/EvolucaoSegura_LJS/elkhorn` (não é do verificador).
- Sensor numa **cópia isolada** (`git archive HEAD` extraído em `%TEMP%\esv3`, `pnpm install --frozen-lockfile --offline`), sem `git worktree` e sem `git stash`. Linha de base na cópia: 24 arquivos de teste alvo, 434 testes verdes antes de qualquer mutação. Cada mutação gravou o arquivo, rodou `vitest` só nos testes que cobrem o trecho e **restaurou o original no `finally`**; conferi por `diff` com `git show HEAD:<arquivo>` depois de cada lote. A cópia foi apagada ao fim.
- Depois de todo o trabalho: `git status --porcelain` da árvore real igual ao baseline (vazio), `git worktree list` igual ao baseline. A única escrita na árvore real é este `validation.md`.
- Ambiente: `PG_BIN=C:/Users/leand/scoop/apps/postgresql/current/bin` (pg_dump 18.6), `NODE_OPTIONS=--stack-trace-limit=0`, `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/evolucao_segura`.
- Processos de terceiros não tocados: `wrangler dev` do usuário na porta 8787 (workerd 20148) e o worktree de `GestaoDaPelada_LJS`.

---

## Task Completion

| Verificação | Resultado |
| --- | --- |
| Tarefas T1 a T213 | ✅ 213 concluídas (`python .claude/scripts/progresso.py`: "Todas as 213 tarefas concluídas: 100%"); `tasks.md` com 574 caixas marcadas e 0 pendentes |
| T211 | ✅ cancelada de propósito e registrada em `tasks.md:4234-4245` (o app novo não tem tela de detalhe da sessão; PERF-08 passou a valer só para a agenda em `spec.md`) |
| Tarefas acima de 2 h | ⚠️ anotado, não bloqueia: 29 tarefas (T12, T13, T14, T15, T29 e mais 24), as mesmas do ciclo 1 |
| Bloqueadas ou parciais | nenhuma |

---

## Spec-Anchored Acceptance Criteria

Convenção: `B/` = `backend/api/test/`; `S/` = `backend/scripts/test/`; `W/` = `frontend/web/src/`; `D/` = `backend/dominio/src/`. Reconferi que **cada `arquivo:linha` do relatório anterior ainda existe** com um script que abre o arquivo na linha citada; corrigi abaixo as citações que tinham deslocado (`auth-entrar.test.ts` ganhou um `import` e `agenda.test.tsx` ganhou testes) e as que apontavam para título de teste ou comentário em vez da asserção.

### Cadastro

| Critério | Resultado exigido pela spec | `arquivo:linha` + asserção | Resultado |
| --- | --- | --- | --- |
| CAD-01 | 202 e e-mail com link | `B/rotas/cadastro.test.ts:102` `expect(resposta.status).toBe(202)`; `:125` `toContain('${URL_PUBLICA}/confirmar?token=')` | ✅ |
| CAD-02 | mesmo 202/corpo; e-mail "já tem conta" com link de recuperação | `B/rotas/cadastro.test.ts:173-178` `toBe(202)`, `assunto toMatch(/já tem conta/i)`, `texto toContain('/recuperar')` | ✅ |
| CAD-03 | SHA-256, 256 bits, 30 min, uso único | `B/rotas/cadastro.test.ts:137` `Buffer.from(token,'base64url') toHaveLength(32)`; `:140` `token_hash.equals(sha256(token))`; `:141` `expira_em-criado_em toBe(30*60_000)`; uso único `B/rotas/confirmar.test.ts:204` `toEqual({status:400, corpo:LINK_INVALIDO})` | ✅ |
| CAD-04 | conta ativa, assinatura `trial`, `periodo_fim` = confirmação + 14 dias | `B/rotas/confirmar.test.ts:100` `toEqual({status:200, corpo:{status:'confirmada'}})`; `:102` `confirmado_em toBeInstanceOf(Date)`; `:120` `assinatura toMatchObject({plano:'pro', status:'trial'})`; `:121` `periodo_fim - confirmado_em toBe(14 * DIA)` | ✅ |
| CAD-05 | 400 `link_invalido`, conta intacta | `B/rotas/confirmar.test.ts:191` `toEqual({status:400, corpo:LINK_INVALIDO})`; `:192` `estadoDaConta toEqual(antes)` | ✅ |
| CAD-06 | substitui nome e senha, invalida token anterior | `B/rotas/cadastro.test.ts:225` `toMatchObject({nome:'Ana Nova', confirmado_em:null})`; `:237` `invalidado_em not.toBeNull()` | ✅ |
| CAD-07 | aceite com data, hora e versões | `B/rotas/confirmar.test.ts:138-141` `aceites toEqual([{versao_termos: VERSAO_TERMOS, versao_privacidade: VERSAO_PRIVACIDADE, ...}])`; `W/publico/termos.test.tsx:22` `getByText('Versão ${VERSAO_TERMOS}')` | ✅ |
| CAD-08 | mesmo 202, erro no Sentry | `B/rotas/cadastro.test.ts:279` `capturarErro toHaveBeenCalledWith(erro)`; `:274` corpo igual | ✅ |
| CAD-09 | login recusado com o mesmo 401 | `B/rotas/auth-entrar.test.ts:167` `toBe(401)`; `:169` `toEqual(RESPOSTA_LOGIN_RECUSADO)` | ✅ |

### Login, sessão e recuperação

| Critério | Resultado exigido | Evidência | Resultado |
| --- | --- | --- | --- |
| AUTH-01 | 202 `{status:'2fa_required'}`, sem sessão | `B/rotas/auth-entrar.test.ts:94` `toBe(202)`; `:95` `toEqual({status:'2fa_required'})` | ✅ |
| AUTH-02 | 401 de corpo único; hash também no e-mail inexistente | corpo: `B/rotas/auth-entrar.test.ts:167-169`. **Hash sem cronômetro (T212, resolve a nota do ciclo 1):** `:292` `expect(inexistente).toEqual({id:null, conferir:1, crypt:1, genSalt:1})`; `:299-300` `senhaErrada toEqual({...crypt:1, genSalt:0})` e `inexistente.crypt toBe(senhaErrada.crypt)`; `:314` fonte da função confere `IF v_hash IS NULL THEN PERFORM crypt(p_senha, gen_salt('bf', 12))`. Mutante M24 (remove o `PERFORM crypt`) morto | ✅ |
| AUTH-03 | CSPRNG, HMAC, 10 min, uso único | `B/rotas/auth-2fa.test.ts:167` primeira `toBe(200)`, segunda 401 | ✅ |
| AUTH-04 | cookie `__Host-sid` com atributos, 200 com CSRF | `B/rotas/auth-2fa.test.ts:84-86` `toBe(200)`, `Object.keys(corpo) toEqual(['csrf_token'])`; atributos no teste de `:77` | ✅ |
| AUTH-05 | 5 erros invalidam o desafio | `B/rotas/auth-2fa.test.ts:213-224`, quatro 401 e o código certo depois do 5º erro `toBe(401)`; mutante M1 morto | ✅ |
| AUTH-06 | 202 sempre; reenvia só após 60 s | `B/rotas/auth-2fa-reenviar.test.ts:65-66` `toBe(202)`, `enviadas toHaveLength(1)` | ✅ |
| AUTH-07 | 5 falhas em 15 min bloqueiam; 429 e `Retry-After` | `B/rotas/auth-bloqueio.test.ts:74` `[401,401,401,401]`; `:85` cinco 401; `:106` bloco `Retry-After` | ✅ |
| AUTH-08 | 503 `mail_unavailable` | `B/rotas/auth-entrar.test.ts:230` `toBe(503)`; `:232` `toMatchObject({status:503, codigo:'mail_unavailable'})` | ✅ |
| AUTH-09 | 15 min de inatividade ou 12 h | `B/middleware/sessao.test.ts:78-79`; 12 h `:146`; limites exatos em `D/identidade/regras-acesso.test.ts`; mutante M12 morto | ✅ |
| AUTH-10 | id novo e sessão anterior encerrada | `B/rotas/auth-2fa.test.ts:254` `segunda not.toBe(primeira)`; `:256` `encerrada_em not.toBeNull()` | ✅ |
| AUTH-11 | 422 `curta`/`longa`/`comum` | `B/rotas/cadastro.test.ts:330-332` `toBe(422)`, `problem+json`; regra pura em `D/identidade/politica-senha.test.ts` | ✅ |
| AUTH-12 | `crypt()`/`gen_salt('bf',12)` | `S/migration-0003-identidade.test.ts:102` `hash toMatch(/^\$2a\$12\$.{53}$/)`; `:108` `confere toEqual({ok:true})` | ✅ |
| AUTH-13 | 202 vazio; token 256 bits, 30 min; anteriores invalidados | `B/rotas/recuperar.test.ts:72-74` `toBe(202)`, `corpo toBe('')`, `enviadas toHaveLength(1)` | ✅ |
| AUTH-14 | troca hash, encerra sessões, 204 | `B/rotas/redefinir.test.ts:197` `boa.status toBe(204)`; `:92` sessões com `encerrada_em` | ✅ |
| AUTH-15 | 400 `link_invalido` antes da política | `B/rotas/redefinir.test.ts:115-117` `toBe(400)`, `toEqual(PROBLEMA_LINK)`, hash intacto | ✅ |
| AUTH-16 | sem DELETE, cookie `Max-Age=0`, 204 | `B/rotas/auth-sair.test.ts:61-67` `toBe(204)`, corpo `''`, `atributos[0] toBe('__host-sid=')` | ✅ |
| AUTH-17 | 403 sem `x-csrf-token` correto | `B/middleware/csrf.test.ts:88-90` `toBe(403)`, `toEqual(CSRF_INVALIDO)`; mutante M3 morto | ✅ |
| AUTH-18 | diálogo aos 120 s com contagem; "Continuar conectado" renova | `W/app/inatividade.test.tsx:85-87` `aviso not.toBeNull()`, `heading 'Sua sessão vai expirar'`, `textContent toContain('2:00')` | ✅ |
| AUTH-19 | limpa cache e vai a `/sessao-expirada` | `W/app/inatividade.test.tsx:170` `pathname toBe('/sessao-expirada')` | ✅ |

### Isolamento

| Critério | Resultado exigido | Evidência | Resultado |
| --- | --- | --- | --- |
| ISO-01 | `usuario_id` + RLS forçada + transação por requisição com `SET LOCAL` | `B/pipeline.test.ts:100-101`; `B/db.test.ts:160` `usuarioDaTransacao(usuario) toBe(usuario)`, `:161` `usuarioDaTransacao(null) toBeNull()`, `:162` `criar toHaveBeenCalledTimes(2)` (as duas chamadas usam a **mesma conexão**), `:167` `current_setting fora da transação toBeNull()`. **M10 morto** (era o sobrevivente do ciclo 1); RLS forçada: `B/isolamento/isolamento.test.ts:289` `semRlsForcada(todas) toEqual(...)`; M2 morto | ✅ |
| ISO-02 | 404 idêntico em todas as tabelas | `B/isolamento/isolamento.test.ts:331,335` `contarDeA(A, tabela) toBe(1)`, `contarDeA(B, tabela) toBe(0)` para toda tabela do catálogo; HTTP 404 por rota em mais de 30 arquivos de `B/rotas` (ex.: `B/middleware/plano.test.ts:144`, `B/rotas/pacientes.test.ts:274`) | ✅ |
| ISO-03 | `evolucao_app` sem DELETE/TRUNCATE | `S/migration-0003-identidade.test.ts:270` `privilegios toEqual(...)`; `B/isolamento/isolamento.test.ts:311-312` `not.toContain('DELETE')`, `not.toContain('TRUNCATE')` | ✅ |
| ISO-04 | `evolucao_backup_ro` só lê, lê tudo | `S/migration-0025-backup-leitura.test.ts:126` `linha?.pode toBe(true)`; `S/migration-0011-limite-uso.test.ts:274`; **e a restauração real com essa role** (seção Restauração) | ✅ |

### Perfil e configurações

| Critério | Resultado exigido | Evidência | Resultado |
| --- | --- | --- | --- |
| PERF-01 | leva a `/app/perfil` até ter nome e especialidade | `B/rotas/perfil.test.ts:377` `completo toBe(false)`, depois `toBe(true)`; redirecionamento no app: `W/app/shell.test.tsx` | ✅ |
| PERF-02 | campos, 422 em chave desconhecida, vazio vira null | `B/rotas/perfil.test.ts:108` `antes.status toBe(404)`; `:142` chave desconhecida 422 | ✅ |
| PERF-03 | uma especialidade com registro opcional | `B/rotas/perfil.test.ts:190` `toBe(200)`, `especialidade toEqual(...)` | ✅ |
| PERF-04 | cria o modelo padrão | `B/rotas/modelo-anamnese.test.ts:161` `[especialidade, campos.length, alertas.length] toEqual([...])` | ✅ |
| PERF-05 | 409 `SPECIALTY_HAS_ANAMNESIS` | `B/rotas/perfil-modelo.test.ts:163` `toBe(409)`; `:166-167` `toMatchObject({status:409, codigo:'SPECIALTY_HAS_ANAMNESIS'})` | ✅ |
| PERF-06 | 409 `WEEKEND_DAY_HAS_SESSIONS` com a contagem, sem salvar | `B/rotas/perfil-fim-de-semana.test.ts:57-59` `toBe(409)`, `toEqual(problemaFimDeSemanaComSessoes(2))` | ✅ |
| PERF-07 | com `confirmar: true` salva e mantém as sessões | `B/rotas/perfil-fim-de-semana.test.ts:121-123` `toBe(200)`, `atende_sabado:false` | ✅ |
| PERF-08 | `privacidade_agenda` (padrão falso); ligada, a agenda mostra as iniciais, inclusive enquanto as configurações carregam ou se a leitura falha; Início e financeiro com o nome; sem opção de inatividade | API: `B/rotas/configuracoes.test.ts:71` `toBe(200)`, `:72` `toEqual({privacidade_agenda:false})` (padrão), `:77-79` liga e lê `{privacidade_agenda:true}`. **Agenda (T210)**: `W/app/agenda/agenda.test.tsx:341` `findByText('Z. S. X.')` e `:342` `getByRole('img',{name:'A. S.'}).getAttribute('title') toBe('A. S.')`; `:344` `semNomeCompleto(container)` (nenhum atributo leva o nome); `:351-354` desligada: nome completo e `queryByText('A. S.') toBeNull()`; `:360-362` carregando: iniciais; `:368-372` erro de leitura: iniciais; `:379-383` situação, horário e link preservados. **Início com o nome**: `W/app/inicio/inicio.test.tsx:315-316` `findByText('Paciente 1')`, `textContent not.toContain('P. 1.')`. Mutantes M21, M22, M23 mortos. **Sem teste**: "o financeiro continua com o nome" com a privacidade ligada (o código do financeiro nem lê a configuração: `grep privacidade_agenda` só acha `agenda.tsx` e `configuracoes.tsx`) | ⚠️ cobertura parcial: lacuna menor, só a cláusula do financeiro |
| PERF-09 | audita `perfil.editado`/`configuracao.alterada` só com nomes de campo | `B/rotas/configuracoes.test.ts:124-125` `auditoria toEqual([campo, campo])`, `row_version toBe(2)` | ✅ |

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
| AGE-01 | `B/rotas/sessoes.test.ts:72-86` `toBe(201)`, corpo, linha; 422 em `:64`+; front `W/app/agenda/agenda.test.tsx:223-228` corpo `{paciente_id, inicio, fim: inicio + 50 min, link:null}` | ✅ |
| AGE-02 | `W/app/agenda/agenda.test.tsx:208` `duracao.value toBe('50')`; `:209-213` opções `toEqual(['30 min','45 min','50 min','60 min','90 min'])` (linha corrigida: no ciclo 1 estava deslocada) | ✅ |
| AGE-03 | `B/rotas/sessoes-lista.test.ts:67-69` `toBe(400)`, `toEqual(PROBLEMA_CONSULTA_SESSOES_INVALIDA)` (intervalo acima de 62 dias) | ✅ |
| AGE-04 | `B/rotas/series-alterar.test.ts:249-254` `toBe(409)`, tudo ou nada; encostar não conflita em `D/agenda/conflito.test.ts`; front `W/app/agenda/agenda.test.tsx:270-273`; mutante M11 morto | ✅ |
| AGE-05 | `B/rotas/series.test.ts:284` `toBe(201)`; `:288-291` `linhaSessao das existentes toEqual(existentes)` (sem alterar a sessão existente) | ✅ |
| AGE-06 | `B/rotas/series-alterar.test.ts:190-192` `toBe(422)`, `PROBLEMA_DIA_INDISPONIVEL` | ✅ |
| AGE-07 | `B/rotas/sessoes-status.test.ts:87-89` `toBe(200)`, `status: para, row_version: 2` | ✅ |
| AGE-08 | `B/rotas/sessoes-registros.test.ts:58-59` sessão intacta (`status:'realizada', row_version:1`), sem auditoria | ✅ |
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
| ANA-07 | `B/rotas/anamnese-retificar.test.ts:209` 409 `EDIT_WINDOW_OPEN`; `:220` `retificacoesNoBanco toEqual([])` | ✅ |
| ANA-08 | spec ajustada em 2026-10-29 (400 sem conteúdo novo; 422 para motivo inválido). 400: `B/rotas/anamnese-retificar.test.ts:227-234` `esperarProblema(..., 400, PROBLEMA_SEM_CONTEUDO_NOVO)` e `:249`; 422: `:259` `status toBe(422)`, `:260` `toMatchObject({codigo:'validacao', campos:['motivo']})` | ✅ (a lacuna de precisão do ciclo 1 foi fechada pela spec) |
| ANA-09 | `D/anamnese/valores.test.ts:181-183` `versaoVigente(...) toBe(retificacao)`; selos no app: `W/app/anamnese/anamnese.test.tsx` | ✅ |
| EVO-01 | `B/rotas/evolucoes.test.ts:73-89` `toBe(201)`, evolução, linhas | ✅ |
| EVO-02 | `B/rotas/evolucoes.test.ts:195` `esperarProblema(await registrar(sessao, corpo), 409, PROBLEMA_EVOLUCAO_EXISTENTE)`; `:196` `evolucoesDe toHaveLength(1)` | ✅ |
| EVO-03 | API: `B/rotas/evolucoes.test.ts:154` `toBe(201)`, `:157` `sessao_id toBe(sessaoId)`, `:158-162` `linhaSessao toMatchObject({status:'realizada', cobravel:true, row_version:2})`. **Interface (corrige o Achado 2 do ciclo 1)**: `W/app/inicio/inicio.test.tsx:140` href `'/app/pacientes/p1/evolucao?sessao=s1'`; `:179` href do alerta `'...p2/evolucao?sessao=s2'`; clique que chega ao destino `:271-272` `textContent toBe('paciente=pac-b;sessao=sessao-b')` e `:293` `'paciente=p2;sessao=s2'` (alerta "Abrir"); `W/app/agenda/agenda.test.tsx:147-151` href `'...?sessao=s1'`, `s2`, `s3` e clique `toBe('/app/pacientes/p1/evolucao?sessao=s2')`; cancelada e remarcada sem o link `:162-164`; a tela envia `sessao_id` ao POST: `W/app/evolucao/evolucao.test.tsx:340` `corpo toEqual({paciente_id:'p1', sessao_id:'s1', texto:...})`; e2e por cliques `e2e/apoio/clinico.ts:78` (`toHaveURL('/app/pacientes/<id>/evolucao?sessao=<id>')`), 6 passaram na minha execução. Mutantes M17 a M20 e M27 mortos | ✅ |
| EVO-04 | `B/rotas/evolucoes-editar.test.ts:76-83` `toBe(200)`, `{texto, row_version: 2}` | ✅ |
| EVO-05 | `B/rotas/evolucoes-retificar.test.ts:92-102` `toBe(201)`, original `{texto:'original', row_version:1}` | ✅ |
| EVO-06 | `B/rotas/evolucoes-retificar.test.ts:235` `retificacoesNoBanco toEqual([])` | ✅ |
| EVO-07 | `B/rotas/evolucoes-retificar.test.ts:248-251` `status toBe(404)` para DELETE | ✅ |

### Financeiro e Início

| Critério | Evidência | Resultado |
| --- | --- | --- |
| FIN-01/02 | `B/rotas/precos.test.ts:117-125` `toBe(200)`, `precoNoBanco toEqual([{valor_centavos:'15050', row_version:1}])`; 409 em `:112`+ | ✅ |
| FIN-03/04/08 | `B/rotas/pagamentos.test.ts:103-114` `toBe(201)`, pagamento e linhas; 422 `PRICE_REQUIRED` e auditoria no mesmo bloco | ✅ |
| FIN-05 | `B/rotas/pagamentos.test.ts:206-227` `toBe(201)` com confirmação, `revisoesDa` | ✅ |
| FIN-06/07 | `B/rotas/debitos.test.ts:105-139` `toEqual(...)` da lista e `paciente_id toEqual([ana, carla])`; regra pura `D/financeiro/debitos.test.ts`; mutante M6 morto (11 falhas) | ✅ |
| FIN-09 | `W/app/financeiro/pagamento.test.tsx:63` `data.value toBe(hojeSaoPaulo())`; `:114` `PRICE_REQUIRED`; `:128` `PAYMENT_DUPLICATE` com confirmação; `W/app/financeiro/preco.test.tsx:116` 409 `versao_divergente`; `W/app/financeiro/financeiro.test.tsx:171` link "Registrar pagamento de Ana Souza"; `W/app/inicio/inicio.test.tsx:227` atalho "Pagamento" | ✅ |
| INI-01/02/03 | `B/rotas/inicio.test.ts:117-120` `hoje toHaveLength(6)`, `[id,status,evolucao,pagamento] toEqual(...)` | ✅ |

### Planos, cobrança, exportação, conta, auditoria

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PLANO-01 | `D/plano/assinatura.test.ts:37-47` estados e `aceitas toHaveLength(8)`, `recusadas toHaveLength(17)` | ✅ |
| PLANO-02 | `B/middleware/plano.test.ts:271-273` criar 201, reativar 200, `totalPacientes toBe(8)` | ✅ |
| PLANO-03 | `B/middleware/plano.test.ts:71` `toEqual(PROBLEMA_LIMITE_PLANO)`; `:85-87` `esperaLimite(await criar(sessao))`, `totalPacientes toBe(5)`; mutante M7 morto (14 falhas) | ✅ |
| PLANO-04 | `B/tarefas/assinaturas.test.ts:94-102` `free`, dados intactos, auditoria | ✅ |
| PLANO-05 | `B/rotas/plano-assinar.test.ts:62-64` `toBe(201)`, `RESPOSTA_ASSINAR`, `['criarCliente','criarAssinatura']`; Pix: `B/rotas/plano.test.ts:213-222` (`valor_centavos: 1990`) | ✅ (contra um Asaas simulado; o sandbox real não foi exercitado por mim, ressalva 2) |
| PLANO-06 | `B/rotas/webhook-asaas.test.ts:43-45` `toBe(401)`, `chamadas toEqual([])`; M4 morto | ✅ |
| PLANO-07 | `B/rotas/webhook-asaas.test.ts:69-71` `toBe(200)`, `{status:'processado'}`; repetido sem efeito; M5 morto | ✅ |
| PLANO-08 | `B/rotas/webhook-pago.test.ts:56-58` `toBe(200)`, `linhaAssinatura` com `ativa` e `periodo_fim` | ✅ |
| PLANO-09 | `B/rotas/webhook-vencida.test.ts:48-55` `atrasada`, auditoria | ✅ |
| PLANO-10 | `B/tarefas/assinaturas.test.ts:217-225` `cancelamentos toEqual([assinatura])`, `free`, dados intactos | ✅ |
| PLANO-11 | `B/rotas/plano-cancelar.test.ts:52-54` `toEqual({status:'cancelada', periodo_fim})`, `cancelarAssinatura` chamado | ✅ |
| PLANO-12 | `B/rotas/plano-assinar.test.ts:174` `toBe(503)`; `B/rotas/plano-cancelar.test.ts:130` `toBe(503)`; `B/integracoes/asaas.test.ts:216-217` | ✅ |
| PLANO-13 | `B/rotas/webhook-emails.test.ts:63-66` um e-mail por evento | ✅ |
| PLANO-14 | `B/rotas/plano.test.ts:117-124` `toBe(200)`, corpo, sem chamada ao Asaas sem assinatura; QR a cada abertura (T209): `:236` `primeira.status toBe(200)`, `:237` `copia_e_cola toBe(QR.copiaECola)`, `:240-241` o mesmo na segunda, `:242` `buscarQrPix toHaveLength(2)` | ✅ |
| PLANO-15 | `B/middleware/plano.test.ts:85-87` o limite é exigido pela requisição HTTP à API (`criar(sessao)` → 403 `LIMITE_PLANO`, banco intacto), `:253-262` tabela de estados que liberam | ✅ |
| EXP-01 | `B/rotas/exportar-prontuario.test.ts:174-176` paciente, período e profissional `toEqual(...)` | ✅ |
| EXP-02 | `W/export/pdf-prontuario.test.ts:101` `nomeArquivoProntuario(...) toBe('prontuario-0a1b2c3d.pdf')`; `:112` rodapé "Prontuário — documento confidencial" | ✅ |
| EXP-03 | `B/rotas/exportar-tudo-conclusao.test.ts:61` `tabelas toEqual(TABELAS_EXPORTACAO)`; `:63` sem tabelas proibidas; zip: `W/export/zip-completo.test.ts:45` | ✅ |
| EXP-04 | `B/rotas/exportar-tudo.test.ts:276,307` `auditoriaTotal toBe(antes)` (400 sem auditar), `TAMANHO_MAXIMO_PAGINA` importado do contrato | ✅ |
| EXP-05 | `B/middleware/limite-exportacao.test.ts:36-39` `[200,200,200,200,200]` e o sexto `toBe(429)`, contador em tabela | ✅ |
| EXP-06 | `B/rotas/exportar-prontuario.test.ts:467,482` evento `exportacao.concluida`, sem conteúdo | ✅ |
| EXP-07 | `B/rotas/exportar-prontuario.test.ts:441-443` `toBe(404)`, `PROBLEMA_PRONTUARIO_NAO_ENCONTRADO` | ✅ |
| CONTA-01 | `B/rotas/conta-excluir.test.ts:78-79` `toBe(202)` com tudo; 422 por requisito no mesmo arquivo | ✅ |
| CONTA-02 | `B/rotas/conta-excluir-email.test.ts:65-68` `toBe(202)`, um e-mail ao dono | ✅ |
| CONTA-03 | `B/rotas/conta-excluir-confirmar-asaas.test.ts:74-76` `cancelarAssinatura`, `status: 'cancelada'` | ✅ |
| CONTA-04 | `B/rotas/conta-desistir.test.ts:71-73` `toBe(200)`, `{status:'desbloqueada'}`, `bloqueio toBeNull()` | ✅ |
| CONTA-05 | `B/tarefas/purga-varredura.test.ts:226-231` varredura pelo catálogo, `varrer(A) toEqual({conta_excluida: 1})`; M8 morto (ver nota) | ✅ |
| CONTA-06 | `W/publico/termos.test.tsx:22-30` versão, data, "profissional é o controlador", "LJS é a operadora" | ✅ |
| AUD-01 | `B/rotas/confirmar.test.ts:295-297` falha da auditoria: 500 e conta intacta | ✅ |
| AUD-02 | `backend/contrato/src/auditoria.test.ts:107` `aceita({acao:'evolucao.texto_livre'}) toBe(false)`; `:131` alvo fora da lista | ✅ |
| AUD-03 | `B/rotas/auditoria.test.ts:169-172` `toBe(200)`, `acoes(corpo) toEqual([...])` | ✅ |
| AUD-04 | `B/rotas/auth-2fa.test.ts:120` `eventos toEqual([...])` para `auth.login_ok` | ✅ |

### Landing, PWA, operação, P2

| Critério | Evidência | Resultado |
| --- | --- | --- |
| PUB-01 | `W/publico/landing.test.tsx:27` `getByText(/até 5 pacientes ativos/i)`; `:33-34` `getByText(/R\$\s?19,90\/mês/)`, `/sem limite de pacientes/`; `:41` `getAllByText(/14 dias/)`; `:47` link "Começar grátis" `href toBe('/cadastro')` e `:48` clique `pathname toBe('/cadastro')` | ✅ |
| PUB-02 | `W/app/shell.test.tsx:61-64` navegação do legado; `.specs/features/evolucao-segura/comparacao-visual.md` (diferenças decididas pelo usuário em 2026-10-28) | ⚠️ Lacuna de precisão: "mesmo layout" não é mensurável; a prova é conferência humana |
| PUB-03 | manifesto: `W/pwa/manifesto.test.ts:13-15` `display toBe('standalone')`, `start_url toBe('/app')`; `:19-22` ícones 192/512 maskable; precache: `W/pwa/offline.test.ts:103` `[...cache.dados.keys()].sort() toEqual(...)`; push e clique: `W/pwa/sw.test.ts:198` `Object.keys(escutas).sort() toEqual(['notificationclick','push'])`. **Instalável pelo Chrome**: sem teste automático de "instalável", mas **observei em Chrome real** que o service worker ativa e controla a página, com `/index.html` e `/offline.html` no cache sem a marca `redirected` | ⚠️ cobertura parcial: instalabilidade (critério do Lighthouse/Chrome) sem teste; o defeito do ciclo 1 está corrigido |
| PUB-04 | `W/pwa/instrucao-ios.test.tsx:37` `ehSafariIosForaDoApp() toBe(true)`; `:59` instrução com "Compartilhar" e "Adicionar à Tela de Início" | ✅ |
| PUB-05 | `B/cabecalhos.test.ts:59,66` `Cache-Control toBe('no-store')` (inclusive no 404) | ✅ |
| OPS-01 | `S/backup-workflow.test.ts:32` `schedule toEqual([{cron:'0 7 * * *'}])` (04:00 Brasília); `:42` `pg_dump -Fc --enable-row-security`; age e retenção no mesmo arquivo; M9 morto (2 falhas) | ✅ |
| OPS-02 | `S/migration-0025-backup-leitura.test.ts:126`; `docs/runbook.md` seção 5.2; **execução real minha com dados e com a role `evolucao_backup_ro`** (seção Restauração) | ⚠️ Evidência fraca no registro de produção (34 tabelas com 0 linhas, origem não comparada); reforçada por mim |
| OPS-03 | `S/deploy-workflow.test.ts:54,58,63,69,72` só `workflow_dispatch`, só `main`, environment `producao`, `cancel-in-progress toBe(false)`, ordem | ✅ |
| OPS-04 | `S/wrangler-deploy.test.ts:76,104` `arquivosComDeploy(raiz) toEqual([ARQUIVO_PERMITIDO])` e `toEqual([])` | ✅ |
| OPS-05 | `S/ci-workflow.test.ts:34-50` push e pull_request, comandos, `migrar` antes do isolamento; e2e (T208): `S/ci-e2e.test.ts:36-62` job `e2e` próprio, `pnpm e2e` por último, Postgres antes; M26 morto | ✅ |
| OPS-06 | `B/health.test.ts:18-19` `toBe(200)`, `{status:'ok'}`; `HYPERDRIVE.connectionString` lança | ✅ |
| OPS-07 | spec ajustada (tolerância de 1 requisição). `B/limite.test.ts:83-84` `passes ≥ 10` e `≤ 11`, `:85` `todasDepoisSao429 toBe(true)`; 60/min `:117-119`; webhook `:126-128` | ⚠️ Lacuna de precisão menor: o teste aceita 10 ou 11 passes (de acordo com a tolerância agora na spec) |
| OPS-08 | `B/sentry.test.ts:62-63` `release toBe('24f04e0')`, `dsn toBe(...)`; remoção de corpo/cookie/e-mail `:31-45`; app: `W/sentry.test.ts:5` | ✅ |
| OPS-09 | `B/cabecalhos.test.ts:20-31` HSTS, nosniff, no-referrer, CSP com `frame-ancestors 'none'` e `default-src 'self'` | ✅ |
| OPS-10 | `S/guardas-codigo.test.ts:34-39` `temUrlAbsolutaDoApp(...) toBe(true/false)` | ✅ |
| OPS-11 | `S/env-example.test.ts:26` toda variável do esquema aparece no `.env.example`; `B/ambiente.test.ts:4` | ✅ |
| OPS-12 | sem teste automático; por leitura: `README.md` (rodar localmente, variáveis, deploy, backup e restauração, webhook; ganhou a nota de `127.0.0.1`/`PG_PORTA`/`PG_BIN`), `docs/runbook.md` seções 1 a 5; `validacao-readme.md` | ✅ (por leitura) |
| OPS-13 | `S/hyperdrive.test.ts:21` `partes toContain('--caching-disabled')`; `S/cache-hyperdrive.test.ts:35-39` | ✅ |
| OPS-14 | `S/guardas-codigo.test.ts:72-87` `dependenciasProibidas(...)`, `arquivosComImportacaoProibida(raiz) toEqual([...])` | ✅ |
| RAS-01 | `B/rotas/rascunhos.test.ts:87-89` `toBe(200)`, `etag toBe('"1"')` | ✅ |
| RAS-02 | `B/rotas/rascunhos.test.ts:197-227` versão e 412 | ✅ |
| RAS-03 | `B/rotas/modelos-texto.test.ts:72-82` `toBe(201)`, `listar toEqual([modelo])` | ✅ |
| RAS-04 | `W/app/evolucao/evolucao.test.tsx:148-152` oferta de restaurar, nenhuma escrita automática | ✅ |
| PUSH-01 | `B/rotas/push.test.ts:73-82` `toBe(204)`, linhas | ✅ |
| PUSH-02 | `B/tarefas/push-sessao.test.ts:123` `porExecucao toEqual({'13:40':0,'13:45':1,'13:50':0,...})`; execução perdida `:128` | ✅ |
| PUSH-03 | `B/tarefas/push-pendente.test.ts:166` `porExecucao toEqual({'19:55':0,'20:00':1,'20:05':0,'20:55':0,'21:00':0})` (uma vez, às 20:00); `:277` corpo `{titulo:'Evoluções pendentes', corpo:'Você tem 3 sessões de hoje sem evolução.', url:'/app'}`; negativo `:116` `servico.chamadas toEqual([])` | ✅ |
| PUSH-04 | `B/tarefas/push-cobranca.test.ts:139-142` títulos enviados e `avisos toEqual(...)` | ✅ |
| PUSH-05 | `B/tarefas/push-cobranca.test.ts:299` `texto not.toContain(proibido)`; `B/tarefas/push-pendente.test.ts:283` | ✅ |
| PUSH-06 | `B/integracoes/push.test.ts:227-228` `'assinatura_removida'`, `existe toBe(false)` | ✅ |
| PUSH-07 | `B/integracoes/push-lotes.test.ts:92-93` `emSegundoPlano toHaveBeenCalledTimes(1)`; VAPID: `B/integracoes/push-vapid.test.ts` | ✅ |
| PUSH-08 | `W/pwa/sw.test.ts:74` `destinoDoClique(url, ORIGEM) toBe(esperado)`; `:148`, `:173`, `:182` `openWindow toHaveBeenCalledWith('/app/plano')`, `('/app')` | ✅ |

**Status**: ✅ 148 critérios cobertos com o resultado da spec; ⚠️ 7 com lacuna de precisão ou cobertura parcial, nenhuma bloqueante (PERF-08 só a cláusula do financeiro, PUB-02, PUB-03, OPS-02, OPS-07, mais o item "Neon" nos casos limite e a marcação de que ANA-08/EVO-03 foram fechados pela spec e pelos novos testes); ❌ nenhum critério sem evidência.

---

## Casos limite

- [x] Neon em autosuspend: `B/db.test.ts:186-188` (`TEMPO_LIMITE_CONEXAO_MS toBe(8_000)`, `toMatchObject({connectionTimeoutMillis: 8_000})`). A spec agora diz "dentro do timeout de conexão de 8 s configurado na API", então o teste bate com o texto; nenhum teste simula o cold start (só a configuração é verificada). ⚠️ cobertura de configuração, não de comportamento.
- [x] Resend com limite diário: `B/integracoes/resend.test.ts:103-108` `erro toMatchObject({tipo:'limite', status:429})`; 503 `mail_unavailable` em `B/rotas/auth-entrar.test.ts:230-232`; alerta no Sentry em `backend/api/src/integracoes/resend.ts:49`.
- [x] Duas abas na mesma sessão ou evolução: 409 por `row_version`, `B/rotas/series-alterar.test.ts:320` e `B/rotas/evolucoes-editar.test.ts:72`.
- [x] Webhook antes da resposta da criação: `B/rotas/webhook-pago.test.ts:155`.
- [x] Meia-noite com evolução aberta: `W/app/evolucao/evolucao.test.tsx:237-275` recusa, mantém o texto e oferece retificar.
- [x] Cron perdido: `B/tarefas/push-sessao.test.ts:128` e `B/tarefas/push-pendente.test.ts:182`.
- [x] Free com 5 ativos inativa um paciente e pode criar: `B/middleware/plano.test.ts:209-227`.

---

## Discrimination Sensor

Profundidade: **P0 completo manual** (≥ 5 mutações; auth, isolamento, dinheiro, webhook, LGPD, backup e todo o código novo da Phase 24). Cada mutação aplicada numa cópia isolada fora da árvore real; testes alvo com `pnpm exec vitest run <arquivos>`; original restaurado no `finally` e conferido.

| Mut. | Arquivo:linha | Falha injetada | Testes rodados | Morta? |
| --- | --- | --- | --- | --- |
| M1 | `backend/dominio/src/identidade/regras-acesso.ts:11` | `LIMITE_ERROS_2FA = 5` → `6` (AUTH-05) | `regras-acesso.test.ts`, `auth-2fa.test.ts` | ✅ 3 falhas ("o 4º erro mantém o desafio e o 5º o invalida") |
| M2 | `backend/scripts/migrations/0006_pacientes.ts:54` | política RLS `USING (usuario_id = ...)` → `USING (true)` em `paciente` (ISO-01/02) | `isolamento.test.ts`, `migration-0006-pacientes.test.ts` | ✅ 4 falhas ("B não lê nenhuma linha de A") |
| M3 | `backend/api/src/middleware/csrf.ts:11` | `POST` tratado como leitura (AUTH-17) | `csrf.test.ts` | ✅ 5 falhas |
| M4 | `backend/api/src/rotas/webhook-asaas.ts:82` | `timingSafeEqual(a, b)` → compara só o tamanho (PLANO-06) | `webhook-asaas.test.ts` | ✅ 2 falhas |
| M5 | `backend/scripts/migrations/0014_funcoes_webhook.ts:54` | `ON CONFLICT DO NOTHING` → `DO UPDATE` (PLANO-07) | `webhook-asaas.test.ts`, `migration-0014-funcoes-webhook.test.ts` | ✅ 3 falhas |
| M6 | `backend/dominio/src/financeiro/debitos.ts:18` | `faltou/cancelada` em débito mesmo sem `cobravel` (FIN-06) | `debitos.test.ts` (domínio e API) | ✅ 11 falhas |
| M7 | `backend/dominio/src/plano/assinatura.ts:89` | `ativos >= 5` → `ativos > 5` (PLANO-03) | `assinatura.test.ts`, `plano.test.ts` | ✅ 14 falhas |
| M8 | `backend/scripts/migrations/0023_funcoes_purga.ts:113` | remove `DELETE FROM public.pagamento` da purga (CONTA-05) | `migration-0023-funcoes-purga.test.ts`, `purga-varredura.test.ts` | ✅ morta pela varredura (`purga-varredura.test.ts:209`, violação de FK `pagamento_usuario_id_fkey`, 4 testes não rodam). Nota: `migration-0023-funcoes-purga.test.ts` sozinho **não** pega esse mutante (20 passam); quem pega é a varredura pelo catálogo |
| M9 | `.github/workflows/backup.yml:58` | remove `--enable-row-security` do `pg_dump` (OPS-01) | `backup-workflow.test.ts` | ✅ 2 falhas |
| **M10** | `backend/api/src/db.ts:345` | `set_config('app.usuario_id', ..., true)` → `false` (**o sobrevivente do ciclo 1**, ISO-01) | `db.test.ts` | ✅ **morta** (1 falha: "o usuário da primeira transação não vaza para a seguinte na mesma conexão") |
| M11 | `backend/dominio/src/agenda/conflito.ts:19` | `<` → `<=` (AGE-04) | `conflito.test.ts` | ✅ 2 falhas |
| M12 | `backend/dominio/src/identidade/regras-acesso.ts:6` | inatividade 15 → 16 min (AUTH-09) | `regras-acesso.test.ts`, `sessao.test.ts` | ✅ 4 falhas |
| M13 | `frontend/web/src/pwa/offline.ts:50` | `if (!r.redirected) return r;` → `return r;` (nunca refaz a resposta; PUB-03/T203) | `offline.test.ts` | ✅ 4 falhas |
| M14 | `frontend/web/src/pwa/offline.ts:71` | no install, `cache.put(url, resposta)` sem refazer | `offline.test.ts` | ✅ 1 falha |
| M15 | `frontend/web/src/pwa/offline.ts:115` | navegação devolve `shell` do cache sem refazer | `offline.test.ts` | ✅ 1 falha |
| M16 | `frontend/web/src/pwa/offline.ts:97` | página offline devolvida sem refazer | `offline.test.ts` | ✅ 1 falha |
| M17 | `frontend/web/src/app/inicio/inicio.tsx:83` | link "Evolução" da lista de hoje sem `?sessao=` (EVO-03/T204) | `inicio.test.tsx` | ✅ 3 falhas |
| M18 | `frontend/web/src/app/inicio/inicio.tsx:158` | link "Abrir" do alerta sem `?sessao=` | `inicio.test.tsx` | ✅ 2 falhas |
| M19 | `frontend/web/src/app/agenda/agenda.tsx:202` | link "Evolução" da agenda sem `?sessao=` (EVO-03/T205) | `agenda.test.tsx` | ✅ 2 falhas |
| M20 | `frontend/web/src/app/agenda/agenda.tsx:53` | `SEM_EVOLUCAO` deixa de excluir `remarcada` | `agenda.test.tsx` | ✅ 1 falha |
| M21 | `frontend/web/src/app/agenda/agenda.tsx:102` | privacidade só quando a leitura já terminou (carregando/erro mostram o nome; PERF-08/T210) | `agenda.test.tsx` | ✅ 2 falhas |
| M22 | `frontend/web/src/app/agenda/agenda.tsx:102` | `privacidade_agenda === true` → `=== false` | `agenda.test.tsx` | ✅ 3 falhas |
| M23 | `frontend/web/src/app/agenda/agenda.tsx:222` | `PrivacyName` sem o modo estrito (nome completo no `aria-label`) | `agenda.test.tsx` | ✅ 3 falhas |
| M24 | `backend/scripts/migrations/0003_identidade.ts:140` | remove o `PERFORM crypt(...)` do caminho de e-mail inexistente (AUTH-02/T212) | `auth-entrar.test.ts` | ✅ 4 falhas |
| M25 | `backend/api/vitest.urls.ts:8` | porta padrão `5433` → `5432` (T207) | `urls-banco-teste.test.ts` | ✅ 2 falhas |
| M26 | `.github/workflows/e2e.yml:16` | remove o gatilho `pull_request` do e2e (OPS-05/T208) | `ci-e2e.test.ts` | ✅ 1 falha |
| M27 | `backend/api/src/rotas/evolucoes.ts:102` | a evolução deixa de mudar a sessão `agendada` para `realizada` (EVO-03) | `evolucoes.test.ts` | ✅ 1 falha |

**Sensor depth**: P0-full (27 mutações).
**Resultado**: 27 de 27 mortas, **0 sobreviventes** - PASS ✅.

---

## Service worker em Chrome real (prova do defeito do ciclo 1 e da correção)

Executado numa cópia isolada, com `wrangler dev` local (porta 8788, banco descartável, apagados ao fim) e Chromium do Playwright com `serviceWorkers: 'allow'` (o e2e oficial bloqueia o service worker, por isso não o cobre). Sonda: abrir `/app`, esperar o SW ativar, ler o cache, recarregar e navegar direto a `/app/agenda`.

| Versão do `offline.ts` | Cache de `/index.html` e `/offline.html` | Navegação direta a `/app/agenda` com o SW controlando |
| --- | --- | --- |
| `d3eab8e` (antes) | `redirected: true` nos dois | **`net::ERR_FAILED`**, a página não abre |
| `2f8dc41` (agora) | `redirected: false`, status 200 nos dois | status 200, o app abre (cai em `/sessao-expirada` por não haver login, como esperado) |

Isso confirma, fora de mock, o que o ciclo 1 só tinha por leitura, e que a T203 resolve. O comentário em `e2e/playwright.config.ts` ("hoje ele quebra a navegação direta") ficou desatualizado, e o e2e continua com o SW bloqueado: nenhum teste automático do repositório exercita o SW num navegador (ressalva 3).

---

## Gate Check

- **Gate command**: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @es/web build` (comando de `tasks.md` mais o build).
- **lint**: saída 0 (eslint + prettier). **typecheck**: saída 0 (6 pacotes). **build do web**: saída 0.
- **`pnpm test` completo, duas execuções**:

| # | Resultado |
| --- | --- |
| 1 | 212 arquivos; **3361 passaram, 1 falhou**: `backend/api/test/sentry.test.ts` "Worker com o Sentry > responde ao health pelo ponto de entrada, mesmo sem DSN" (`sentry.test.ts:102-105`), `Error: Test timed out in 5000ms` na primeira chamada a `exports.default.fetch` (o primeiro uso carrega o app inteiro no workerd). Duração 329 s |
| 2 | 212 arquivos, **3362 passaram, 0 falharam, 0 pulados** (280 s) |

  O arquivo `sentry.test.ts` passou 3 vezes isoladas (8/8 em ~7 s). Causa provável: o tempo limite padrão de 5 s do vitest numa partida a frio sob carga (nesta máquina há Chrome, `wrangler dev` e Docker abertos). Não há erro de lógica. É o mesmo tipo de intermitência que o ciclo 1 apontou em `plano.test.ts:234` e que a T213 queria eliminar com `maxWorkers: 6`; o `maxWorkers` não a eliminou nesta máquina (ressalva 1).
- **Pulados**: 0 na suíte (`grep` por `.skip/.todo/.only/xit` em `backend` e `frontend`: nada). Em `e2e/` há 2 `test.skip(!process.env['ASAAS_API_KEY'], ...)` condicionais, ver Integridade.
- **Test count**: antes da feature, não se aplica; no ciclo 1: 3316 em 210 arquivos; agora **3362 em 212 arquivos (+46)**. Arquivos de teste rastreados: 198 → 200, nenhum apagado (`git diff d3eab8e..HEAD --diff-filter=D` vazio).
- **Integridade dos testes entre `d3eab8e` e `2f8dc41`** (`git diff -U0` nas linhas removidas):
  - 2 asserções de `href` em `inicio.test.tsx` (`:140`, `:179`) trocadas por versões mais estritas (`?sessao=<id>`); a mudança está registrada em `tasks.md:4112` como aprovada pelo usuário em 2026-10-29.
  - 2 `expect(process.env['ASAAS_API_KEY']).toBeTruthy()` em `e2e/plano.spec.ts` e `e2e/plano-webhook.spec.ts` viraram `test.skip(!ASAAS_API_KEY, ...)`. É **enfraquecimento declarado** (antes falhava sem a chave, agora é pulado e aparece como "skipped"); o comentário e `tasks.md:4188` o atribuem à decisão do usuário de 2026-10-29. Registro apenas; não verifico a aprovação além do que está escrito.
  - Fora isso, só acréscimos (e a troca de `lerPlano` sem captura por captura com asserção em `plano.test.ts`).
- **e2e (fora da trava, `pnpm e2e` numa cópia com a porta do Worker trocada para 8788, banco e coletor próprios, sem tocar a 8787 do usuário)**:
  - sem `ASAAS_API_KEY`: **6 passaram, 2 pulados** (`plano.spec.ts` e o teste do sandbox de `plano-webhook.spec.ts`), 18 s. Passaram: `acesso` (cadastro, confirmação, 2FA, trial), `fluxo-principal` e `fluxo-pagamento` (agenda → clique em "Evolução" → sessão realizada → débito → pagamento), `infra` ×2, webhook com token errado.
  - com `ASAAS_API_KEY` presente no ambiente (a variável existe no ambiente desta máquina): os dois testes do sandbox **falharam no cadastro** com o alerta "Muitas tentativas em pouco tempo" (limite local de 10 requisições por minuto por IP do Worker; a bateria faz seis cadastros em 31 s), **antes de falar com o Asaas**. Não usei a chave para chamar o sandbox. Ver ressalva 2.

### `trava-testes.py --rodar`

Não rodei a trava (o chamador informou a suíte verde pela trava, 3362 testes, 212 arquivos). Rodei o equivalente: `pnpm lint`, `pnpm typecheck`, `pnpm test` (duas vezes) e o build.

### Restauração do backup a partir de cópia limpa

- **Executado por mim, em cópia limpa**: banco de origem `es_vfy2_origem` criado do zero no Postgres 18.6 do Docker, **25 migrations** aplicadas por `node backend/scripts/src/migrar.ts`; semeado com 2 profissionais (com senha por `definir_senha`), 14 pacientes, 14 sessões e 2 evoluções; `pg_dump 18.6 -Fc --enable-row-security --role=evolucao_backup_ro` (a **role de backup real**, com RLS) cifrado com `age` (chave gerada só para este teste); 243.645 bytes.
- Restauração por `infra/restore-test.sh`, com `RESTORE_AGE_IDENTITY` e `RESTORE_SOURCE_URL` apontando para a origem: `etapa=restore status=ok tabelas=35`; **todas as 35 tabelas do schema `public` marcadas `OK` com contagem igual à da origem** (`usuario` 2, `credencial_senha` 2, `paciente` 14, `sessao_atendimento` 14, `evolucao` 2, `pgmigrations` 25, as outras 0), `resultado=ok`, `status=ok duracao=14s`. Os dados de linha só voltam porque a role `evolucao_backup_ro` lê as tabelas com RLS forçada (ISO-04).
- Bancos de origem e restaurado apagados; chave, dump e logs apagados.
- **Só lido**: `docs/runbook.md:373-408` registra a restauração de produção de 2026-10-29 (run `40910306123`, 233.396 bytes, 35 tabelas, `status=ok`), mas com 34 tabelas em 0 linhas e "Origem comparada: não". Esse registro prova que o pipeline roda, não que dados reais voltam íntegros; a minha execução com dados cobre a lacuna em ambiente local. Refazer a de produção quando houver usuários continua recomendado.

---

## Code Quality

| Princípio | Status |
| --- | --- |
| Testes mapeiam critério de aceite e não são rasos (amostra: ISO-01 novo, AUTH-02 novo, EVO-03, PERF-08, service worker) | ✅ asserções exatas; 27 mutantes mortos |
| Testes citam critério e nenhum teste apagado/pulado na suíte | ✅ |
| Resultado esperado da spec nas asserções | ✅ com as lacunas de precisão listadas |
| Cobertura por camada: domínio 1:1, rotas com feliz + borda + erro | ✅ |
| Teste intermitente | ⚠️ `sentry.test.ts:102` sem tempo limite próprio (1 falha em 2 execuções); o de `plano.test.ts` foi corrigido |
| Diretrizes seguidas | `.specs/projeto/` e `padrao-ljs.md`; `SPEC_DEVIATION` do `e2e.yml` registrado no próprio arquivo e em `tasks.md:4182` |
| Escopo e padrões | ✅ os 17 commits mexem só no escopo das tarefas; a cópia de `urlEvolucaoDaSessao` é um helper único usado por Início e agenda |

---

## Ressalvas e achados (não bloqueiam este PASS; cada uma pede decisão do orquestrador/usuário)

1. **`sentry.test.ts:102` intermitente (médio, teste frágil).** Falhou por `Test timed out in 5000ms` numa execução completa; verde nas outras e isoladamente. Correção sugerida: tempo limite explícito (p. ex. 30 s) nesse `it`, que é a primeira partida a frio do Worker. A T213 (`maxWorkers: 6`) não bastou nesta máquina.
2. **"Assinar (sandbox)" do critério de sucesso não foi provado por mim e o job de e2e do CI pode falhar quando o segredo entrar (médio).** Sem `ASAAS_API_KEY` os dois testes do sandbox são pulados (6 passam, 2 pulam). Com a chave presente eles falharam no cadastro por causa do limite local de 10/min por IP (a bateria faz seis cadastros em ~30 s), antes de falar com o Asaas. Quando o segredo `ASAAS_API_KEY` for cadastrado no GitHub, o job `e2e` pode quebrar pelo mesmo motivo. Sugestão: pausa ou IPs distintos entre contas do e2e, ou aumentar o limite no ambiente de e2e. O job `e2e.yml` em si só roda no GitHub: não confirmado até o primeiro push.
3. **Service worker sem teste automático em navegador (baixo/médio).** A correção foi provada por mim em Chrome real, mas o e2e oficial continua com `serviceWorkers: 'block'` e o comentário de `e2e/playwright.config.ts` ainda diz que o defeito existe. Sugestão: um spec com o SW permitido (a sonda deste relatório é a base) e atualizar o comentário. "Instalável pelo Chrome" (PUB-03) segue sem teste.
4. **PERF-08, cláusula "o financeiro continua com o nome"**: sem teste (só o Início tem). Baixo: o financeiro não lê a configuração.
5. **Restauração de produção registrada com banco vazio** (baixo): coberta por mim em ambiente local; refazer em produção quando houver dados.
6. **Mudança de comportamento do e2e sem chave**: `test.skip` no lugar de falha; registrada como decisão do usuário nos arquivos, não verificada por mim.
7. **29 tarefas acima de 2 h** (anotado). **Lacunas de precisão da spec que continuam**: PUB-02 ("mesmo layout"), PUB-03 ("instalável pelo Chrome"), a tolerância ±1 do OPS-07 (agora escrita na spec), o cold start do Neon (só configuração verificada) e as duas marcações `[A ESCLARECER]` (prazo legal de guarda e subdomínio), que a spec já declara como pré-requisitos de publicação.
8. **Tabela de rastreabilidade de `spec.md`**: continua com "Implementing/Pending"; não alterei (cabe ao orquestrador). Estado conforme esta validação: 148 requisitos "Verificados", 7 "Verificados com ressalva" (PERF-08, PUB-02, PUB-03, OPS-02, OPS-07, mais o caso limite do Neon), nenhum "Precisa de correção".

---

## Fix Plans

Nenhum bloqueante. Tarefas sugeridas se o usuário quiser fechar as ressalvas (T214 em diante):

1. **Menor, `sentry.test.ts:102`**: dar tempo limite explícito ao teste (ressalva 1).
2. **Menor, e2e com a chave**: evitar o limite de 10/min entre as contas do e2e antes de cadastrar o segredo no GitHub (ressalva 2).
3. **Menor, e2e do service worker**: spec que permite o SW e navega direto a `/app/*`; atualizar o comentário de `e2e/playwright.config.ts` (ressalva 3).

---

## Requirement Traceability Update

Não alterei `spec.md`.

| Requisito | Situação anterior | Nova situação |
| --- | --- | --- |
| ISO-01 | Precisa de correção | ✅ Verificado |
| EVO-03, ANA-08 | Verificado com ressalva | ✅ Verificado |
| PERF-08 | Verificado com ressalva | ⚠️ Verificado (cláusula do financeiro sem teste) |
| PUB-03 | Verificado com ressalva | ⚠️ Verificado com ressalva (instalável sem teste; SW comprovado em Chrome real) |
| PUB-02, OPS-02, OPS-07 | Verificado com ressalva | ⚠️ Mantido com ressalva |
| Demais 143 | Verificado | ✅ Verificado |

---

## Summary

**Overall**: ✅ Ready (com ressalvas)

**Spec-anchored check**: 148/155 critérios com a asserção igual ao resultado da spec; 7 com lacuna de precisão ou cobertura parcial; nenhum sem evidência.
**Sensor**: 27/27 mutações mortas (M10 do ciclo 1 agora morre).
**Gate**: lint, typecheck e build verdes; `pnpm test` 212 arquivos / 3362 testes, 0 pulados, verde em 1 de 2 execuções (1 timeout de 5 s em `sentry.test.ts`, ressalva 1).

**What works**: todos os seis motivos do FAIL anterior tratados e reverificados por mim; defeito do service worker reproduzido e corrigido em Chrome real; links `?sessao=` na interface com e2e por cliques verde; hash no e-mail inexistente provado sem cronômetro; privacidade da agenda com todos os estados; restauração do backup cifrado com dados e pela role de backup real, contagens iguais em 35 tabelas; nenhum teste apagado; 213 tarefas concluídas.

**Issues found**: ver Ressalvas 1 a 8 (nenhuma bloqueia).

**Next steps**: decidir se as ressalvas 1 a 3 viram tarefas (T214+) antes da integração; se não, seguir para a integração/liberação.
