# Comparação visual com o legado (rascunho)

Requisito: PUB-02 (mesmo layout do código atual do legado). Tarefas: T161, T188, T189, T190.
Estado: **RASCUNHO**. A coluna Decisão está `[A DECIDIR pelo usuário]` em todas as linhas; a sugestão é minha. Nenhuma caixa `Done when` foi marcada.

## Como foi feito

- App novo (`frontend/web`): prints reais do Worker local do e2e (banco `evolucao_segura_e2e`), conta criada pela interface, com 2 pacientes de exemplo, 2 sessões (uma realizada com evolução e preço de R$ 150,00) e dados sintéticos. PC (1280x800) e celular (390x844), página inteira.
- Legado (`EvolucaoSeguraWeb`, somente leitura): build `--mode e2e` gerado FORA da pasta dele e servido com `vite preview`; API simulada por interceptação do Playwright, com os mesmos dados sintéticos. Sem backend e sem banco do legado. Consequência: o conteúdo do legado vem do mock (datas e IPs diferem do novo por isso, não por defeito).
- Prints em `comparacao/<grupo>/novo-<tela>-<pc|cel>.png` e `legado-<tela>-<pc|cel>.png`.
- Coluna **Base**: `print` = os dois lados com print; `print + leitura` = print dos dois, mais leitura de código para o que o print não mostra; `leitura` = sem print de um dos lados (o motivo está na linha).
- Honestidade: abri e olhei os prints de PC de entrar, recuperar, landing, início, agenda, ficha, evolução, financeiro, plano e auditoria. As demais linhas de PC e todos os prints de celular foram gerados e guardados, mas as diferenças delas vêm de leitura de código e dos `SPEC_DEVIATION`, não de inspeção quadro a quadro. Conferir com o usuário.

Desvios já conhecidos reaproveitados (arquivo do web): `app/agenda/agenda.tsx`, `app/agenda/serie.tsx`, `app/anamnese/anamnese.tsx`, `app/evolucao/evolucao.tsx`, `app/evolucao/rascunho.ts`, `app/financeiro/financeiro.tsx`, `app/financeiro/pagamento.tsx`, `app/auditoria/auditoria.tsx`, `app/inicio/inicio.tsx`, `app/pacientes/ficha.tsx`, `app/pacientes/novo.tsx`, `app/plano/meu-plano.tsx`, `export/pdf-prontuario.ts`, `vite.config.ts`.

---

## T161: Acesso e telas públicas (pasta `comparacao/acesso/`)

O legado tem só o app (login em duas colunas); a landing, termos, privacidade, cadastro, redefinir e exclusão de conta são novas (sem equivalente). Nas telas de acesso o legado usa `/entrar`, `/recuperar`, `/primeiro-acesso`, `/entrar/google`, `/sessao-expirada`, `/acesso-negado`.

| Tela (novo / legado) | Base | Diferença | Decisão |
|---|---|---|---|
| Entrar (`/entrar` / `/entrar`) | print | Legado: cartão branco com logo, subtítulo, botão "Entrar com Google", divisor "ou com e-mail", campos com asterisco, botão primário "Continuar", painel esquerdo "Antes · caderno" e direito "Agora · Evolução Segura". Novo: formulário solto sobre fundo bege, sem cartão, sem logo, sem Google, botão "Entrar" só com contorno, link "Criar conta". O 2FA em duas etapas existe nos dois. | [A DECIDIR pelo usuário] Sugestão: igualar ao legado (cartão, logo, botão primário e painéis); Google só se entrar no escopo, senão aceitar a ausência. |
| Recuperar acesso (`/recuperar`) | print | Legado: título, indicador de 3 passos (Pedir link, Nova senha, Concluído) e formulário. Novo: título, texto explicativo, campo e botão com contorno; sem indicador de passos, sem cartão. | [A DECIDIR pelo usuário] Sugestão: igualar ao legado (cartão e passos). |
| Redefinir senha (`/redefinir` / passo 2 de `/recuperar`) | leitura | No legado é o passo 2 da mesma página; no novo é rota própria. Print do novo guardado, sem token válido (mostra só o link inválido). | [A DECIDIR pelo usuário] Sugestão: aceitar (rota própria é exigência do link do e-mail). |
| Primeiro acesso (sem equivalente / `/primeiro-acesso`) | print (legado) | Só no legado (código por e-mail). No novo o cadastro público cumpre a função. | [A DECIDIR pelo usuário] Sugestão: aceitar. |
| Sessão expirada (`/sessao-expirada`) | print | Mesma rota. Novo sem cartão; legado com cartão. | [A DECIDIR pelo usuário] Sugestão: igualar junto com Entrar. |
| Acesso negado (sem equivalente / `/acesso-negado`) | print (legado) | Só no legado. | [A DECIDIR pelo usuário] Sugestão: aceitar, se não houver caso de uso no novo. |
| Landing (`/` / sem equivalente) | print (novo) | Nova (PUB-01): título, texto, "Começar grátis", planos Free e Pro, rodapé de links. Visual simples, sem imagem. | [A DECIDIR pelo usuário] Sugestão: manter; revisar o acabamento. |
| Termos e Privacidade | print (novo) | Novas, sem equivalente. | [A DECIDIR pelo usuário] Sugestão: manter. |
| Cadastro e Confirmar e-mail | print (novo) | Novas; mesmo visual simples de Entrar. | [A DECIDIR pelo usuário] Sugestão: seguir a decisão de Entrar. |
| Confirmar e desistir da exclusão | leitura | Novas (conta). Sem print útil: exigem token real de e-mail. | [A DECIDIR pelo usuário] Sugestão: manter. |
| Entrar com Google (sem equivalente / `/entrar/google`) | leitura | Só no legado. | [A DECIDIR pelo usuário] Sugestão: aceitar se o produto não oferece Google. |

Diferença geral: as páginas públicas do novo não usam o cartão, o logo e os painéis do legado. É a maior distância visual do app.

---

## T188: Agenda e pacientes (pasta `comparacao/agenda-pacientes/`)

| Tela (novo / legado) | Base | Diferença | Decisão |
|---|---|---|---|
| Início (`/app` / `/`) | print | Quase igual. Novo: o título é "Evolução Segura" e a saudação vai abaixo (SPEC_DEVIATION em `app/inicio/inicio.tsx`); legado usa a saudação como título e mostra o dia por extenso. Linhas de "Hoje": legado com selo único; novo com dois selos (evolução e pagamento) e "Não cobrável". | [A DECIDIR pelo usuário] Sugestão: aceitar os selos (a spec os pede); igualar o título se o teste puder mudar. |
| Agenda (`/app/agenda` / `/agenda`) | print | Grande diferença (SPEC_DEVIATION em `app/agenda/agenda.tsx`). Legado: grade semanal por hora, hoje destacado, setas e "Hoje", legenda de estados, cartões coloridos, gaveta do dia, modo privacidade. Novo: lista por dia, botões de texto "Semana anterior / Hoje / Próxima semana", ações de status em cada sessão, botão extra "Nova série", sem legenda. Sábado e domingo só com sessão. | [A DECIDIR pelo usuário] Sugestão: igualar ao legado (grade e legenda); manter as ações de status até existir a tela de detalhe. |
| Nova sessão (`/app/agenda/nova` / `/sessoes/nova`) | print + leitura | Legado: "repetir até" no mesmo formulário. Novo: série em tela própria (SPEC_DEVIATION em `app/agenda/serie.tsx`: frequência e total de 2 a 52). | [A DECIDIR pelo usuário] Sugestão: aceitar (o contrato da API separa a série). |
| Nova série (`/app/agenda/serie/nova` / sem equivalente) | print (novo) | Só no novo, pelo motivo acima. | [A DECIDIR pelo usuário] Sugestão: aceitar. |
| Detalhe da sessão (sem equivalente / `/sessoes/:id`) | print (legado) | O novo não tem a tela (falta `GET /api/sessoes/:id`, citado em `app/agenda/serie.tsx`); as ações ficam na agenda. | [A DECIDIR pelo usuário] Sugestão: igualar quando a rota existir. |
| Lista de pacientes (`/app/pacientes` / `/pacientes`) | print | Gerados, não inspecionados em detalhe. Sem SPEC_DEVIATION registrado. | [A DECIDIR pelo usuário] Sugestão: o usuário conferir os dois prints. |
| Novo paciente (`/app/pacientes/novo` / `/pacientes/novo`) | print + leitura | Novo só cria; a edição do legado saiu (SPEC_DEVIATION em `app/pacientes/novo.tsx`). | [A DECIDIR pelo usuário] Sugestão: aceitar, ou igualar se a edição entrar na spec. |
| Ficha do paciente (`/app/pacientes/:id` / `/pacientes/:id`) | print | Legado: selos Ativo e "Sem ciência de IA", aviso de alerta clínico, atalhos (Evoluções, Documentos, Histórico, Exportar, Valor da sessão), cartões Anamneses e Consentimentos com IA. Novo: só Ativo, cartões Anamnese, Evolução e Consentimentos (SPEC_DEVIATION em `app/pacientes/ficha.tsx`). Os erros de alertas e anamneses no print do legado vêm de rotas que não simulei. | [A DECIDIR pelo usuário] Sugestão: igualar os atalhos (Histórico, Exportar, Valor) conforme as telas existirem; aceitar a saída da IA. |
| Situação (ativar ou inativar) (`.../situacao`) | print | Mesma rota. Não inspecionada em detalhe. | [A DECIDIR pelo usuário] Sugestão: conferir. |
| Editar paciente (sem equivalente / `/pacientes/:id/editar`) | print (legado) | Só no legado. | [A DECIDIR pelo usuário] Sugestão: ver "Novo paciente". |

---

## T189: Anamnese, evoluções e rascunhos (pasta `comparacao/anamnese-evolucoes/`)

| Tela (novo / legado) | Base | Diferença | Decisão |
|---|---|---|---|
| Evolução do paciente (`.../evolucao` / `.../evolucoes`) | print | Muito próximas: título, selo "Editável hoje", "Você pode editar até 23:59", "Salvo", caixa serifada, botão Salvar. Legado: sem menu lateral, com botão "Sair do modo foco". Novo: dentro do menu e com link "Modelos de texto". Novo: lista paginada com "Carregar mais", retificações embutidas, modelo acrescenta ao texto (SPEC_DEVIATION em `app/evolucao/evolucao.tsx`). | [A DECIDIR pelo usuário] Sugestão: igualar o modo foco se for valor para quem escreve; aceitar o restante. |
| Modelos de texto (`/app/modelos-texto` / sem equivalente) | print (novo) | Tela nova (o legado não tinha tela de modelos de texto). | [A DECIDIR pelo usuário] Sugestão: manter. |
| Rascunho da evolução (dentro da tela) | leitura | Legado restaurava sozinho com "Rascunho restaurado"; novo oferece restaurar (SPEC_DEVIATION em `app/evolucao/rascunho.ts`, RAS-04). Autosave de 2 s. Não provado em print (depende de digitar e recarregar). | [A DECIDIR pelo usuário] Sugestão: aceitar (nunca trocar texto sem aceite). |
| Anamnese (`.../anamnese`) | print + leitura | Legado sem dados simulados de anamnese: o print dele só mostra o estado de erro, então o formulário é comparado por leitura. Diferenças (SPEC_DEVIATION em `app/anamnese/anamnese.tsx`): sai o seletor de especialidade, sai o rascunho automático e a confirmação de "salvar e bloquear". | [A DECIDIR pelo usuário] Sugestão: aceitar; o rascunho volta em etapa posterior. |
| Editor do modelo de anamnese (`/app/modelo-anamnese` / dentro da anamnese) | leitura | Tela própria no novo; no legado era parte da anamnese. | [A DECIDIR pelo usuário] Sugestão: aceitar (a API tem rotas próprias do modelo). |
| Documentos (sem equivalente / `.../documentos`) | print (legado, com erro de dados) | O novo não tem a tela de documentos (relatórios e resumos, com IA). | [A DECIDIR pelo usuário] Sugestão: aceitar, se documentos estiverem fora do escopo. |

---

## T190: Financeiro, plano, auditoria e conta (pasta `comparacao/financeiro-plano-auditoria-conta/`)

| Tela (novo / legado) | Base | Diferença | Decisão |
|---|---|---|---|
| Financeiro (`/app/financeiro` / `/financeiro`) | print | Mesmo layout (filtro, tabela). Novo: linha "Total pendente", ordem alfabética e link "Registrar pagamento" (SPEC_DEVIATION em `app/financeiro/financeiro.tsx`). Legado tinha modo privacidade (iniciais). | [A DECIDIR pelo usuário] Sugestão: aceitar. |
| Pagamento (`.../pagamento/:sessaoId` / `/sessoes/:id/pagamento`) | print + leitura | Novo não lista o histórico de correções e o ajuste de preço tem rota própria; não afirma se já foi pago (SPEC_DEVIATION em `app/financeiro/pagamento.tsx`). | [A DECIDIR pelo usuário] Sugestão: aceitar, ou igualar o histórico se o usuário quiser. |
| Valor da sessão (preço do paciente e da sessão) | print | Novo tem duas rotas (paciente e sessão); legado `/pacientes/:id/valor` e dentro do pagamento. Não inspecionada em detalhe. | [A DECIDIR pelo usuário] Sugestão: conferir. |
| Auditoria (`/app/auditoria` / `/auditoria`) | print | Mesmo layout (título, texto, abas, tabela). Legado: caixa "Tipo" e filtro IA sobre os eventos já carregados; novo: no print a caixa "Tipo" aparece com "Todos os eventos", e o filtro vai ao servidor (SPEC_DEVIATION em `app/auditoria/auditoria.tsx`). Os rótulos do print do legado vêm do mock. | [A DECIDIR pelo usuário] Sugestão: aceitar. |
| Histórico do paciente (`/app/auditoria` com paciente / `/pacientes/:id/historico`) | leitura | Unificado na mesma tela no novo. Print do novo dessa rota não gerado. | [A DECIDIR pelo usuário] Sugestão: aceitar. |
| Meu plano (`/app/plano` / sem equivalente) | print (novo) | Tela nova, sem mockup: composição de componentes do guia (SPEC_DEVIATION em `app/plano/meu-plano.tsx`). Selo de período de teste, formulário de nome e CPF/CNPJ, botão Assinar. O estado com Pix não foi gerado (exige o sandbox do Asaas). | [A DECIDIR pelo usuário] Sugestão: manter; usuário aprovar o visual, já que não há referência. |
| Perfil (`/app/perfil` / `/perfil`) | print | Gerados, não inspecionados (o legado tem especialidades, fim de semana e histórico). | [A DECIDIR pelo usuário] Sugestão: conferir. |
| Configurações (`/app/configuracoes` / `/configuracoes`) | print | Gerados, não inspecionados. Novo inclui notificações push; legado tinha IA e privacidade da agenda. | [A DECIDIR pelo usuário] Sugestão: conferir. |
| Exportar (`/app/exportar` / `/exportar`) | print | Gerados. O PDF do novo usa Roboto no lugar de Inter e Source Serif 4 (SPEC_DEVIATION em `export/pdf-prontuario.ts`); o PDF em si não foi gerado nem comparado. | [A DECIDIR pelo usuário] Sugestão: aceitar a fonte, salvo pedido de igualar. |
| Excluir conta (`/app/conta/excluir` / sem equivalente) | print (novo) | Nova. | [A DECIDIR pelo usuário] Sugestão: manter. |

---

## Perguntas para o usuário

1. As telas públicas devem ganhar o cartão, o logo e os painéis do login legado? (Recomendado: sim, é a maior distância visual.)
2. A agenda volta à grade por hora do legado antes do lançamento, ou a lista por dia basta por enquanto?
3. O login com Google, o primeiro acesso e os documentos com IA do legado ficam fora do produto novo?
