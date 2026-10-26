# Contexto: Evolução Segura

**Levantado em:** 2026-10-24
**Spec:** `.specs/features/evolucao-segura/spec.md`
**Situação:** pronto para o Design

---

## Limite da feature

O app inteiro, recriado no padrão LJS: tudo do legado menos Google, IA e relatórios (D-01), mais cadastro aberto, planos Free/Pro com Asaas, push, exclusão de conta, landing, PWA e a operação (backup, CI/CD). As decisões D-01 a D-19 estão em `.specs/produto/necessidade.md`.

---

## Decisões de implementação (perguntas respondidas pelo usuário em 2026-10-24)

### Plano Free e cobrança

- D-20: no Free com 5 ou mais pacientes ativos, bloqueia só criar e reativar paciente; tudo o que existe continua editável. Substitui o "excedente somente leitura" de D-07.
- D-21: Pix vencido fica 7 dias em `atrasada`, com aviso; depois cai para `free`.
- D-26: conta Asaas ainda não existe; construir e testar no sandbox. A conta de produção é pré-requisito só para publicar a cobrança.

### Notificações e Início

- D-22: push "sessão próxima" 15 min antes.
- D-23: push "evolução pendente" às 20:00 (America/Sao_Paulo). O Início mostra só hoje, como o código do legado (sem navegação por dia).

### Pacientes

- D-24: inativar não mexe nas sessões futuras (comportamento do legado).

### Domínio e e-mail

- D-25: a zona `evolucaosegura.com.br` já está na Cloudflare. O subdomínio exato fica para a implantação, sem colidir com o legado em `app.`.
- D-27: remetente `@evolucaosegura.com.br`, verificado no Resend (usa 1 dos 3 domínios do plano gratuito, compartilhados com os outros apps LJS).

### Exclusão de conta

- D-28: desistir da exclusão pelo link do e-mail, válido pelos 30 dias até a purga.

### Liberdade do agente

Padrões escolhidos pelo agente e registrados na spec como premissas: D-29 (zip da exportação), D-30 (exportação nas últimas 24 h antes de excluir), D-31 (purga total com registro mínimo), comportamento do cadastro com e-mail repetido, primeiro uso pelo perfil, troca de especialidade, aviso de fim de semana com `confirmar`, cancelamento do Pro, push sem dado clínico, eventos de auditoria novos e troca do Lighthouse PWA por "instalável".

### Áreas não discutidas → premissas

Comportamento de `privacidade_agenda` (manter o do legado, a confirmar ao portar a tela) e a exigência de CPF/CNPJ pelo Asaas (provar no sandbox). As duas estão na tabela de premissas da spec.

---

## Referências específicas

- Layout: o código atual de `frontend/src` do legado é a fonte de verdade (D-04).
- Comportamentos: mapa do legado levantado em 2026-10-24, citado na spec como `legado:arquivo:linha`.

---

## Ideias adiadas

- Encerrar outras sessões pelo usuário (não existe no legado).
- Navegação por dia no Início.
- Exportação completa em CSV.
- UI de alterar e cancelar série (AGE-15 e AGE-16; os endpoints existem desde a T85 e a T86), junto da tela de detalhe da sessão (GET `/api/sessoes/:id`) e, se valer, da grade por hora do legado.
