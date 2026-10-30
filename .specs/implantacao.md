# Implantação: Evolução Segura

- **Data**: 2026-10-30 · **Versão**: commit `b145d87` (Worker versão `4f97b653-17d7-43be-baca-964902570986`) · **Suíte**: 3429 passaram, 0 falharam (trava de testes no `b145d87`; CI e e2e verdes no GitHub)
- **Destino**: nuvem gratuita, Cloudflare Workers + Neon Free via Hyperdrive. **Ensaio, sem usuários reais.**
- **Endereço**: `https://evolucao-segura.prod-ljs.workers.dev` (sem `routes` no `wrangler.jsonc`). `URL_PUBLICA` vale `https://app.evolucaosegura.com.br`, que ainda não aponta para o Worker.
- **Implantar**: `gh workflow run deploy.yml --ref main` (único lugar que roda `wrangler deploy`; dump cifrado, `pnpm migrar --alvo producao`, deploy)
- **Voltar à versão anterior**: como é o primeiro deploy, não há versão anterior do Worker. Para voltar o banco: restaurar o dump cifrado `dump-pre-deploy-41078285722` (artefato do GitHub, 30 dias) pelo `docs/runbook.md` seção 5.3. Para voltar o código: reverter o commit na `main` e rodar o deploy de novo (nas próximas versões, `wrangler rollback <id>`).
- **Backup**: diário às 04:00 BRT no GitHub Actions (`backup.yml`), `pg_dump -Fc` cifrado com `age`, retenção de 30 dias. Rodado à mão em 2026-10-30 (execução 41078630954, artefato `backup-41078630954`, 233966 bytes, verde). Último teste de restauração: registrado em 2026-10-29 no runbook (seção 5); não repetido neste deploy.
- **Limites do plano** (nuvem): Workers Free 100.000 requisições/dia e 10 ms de CPU; Neon Free 1 GB e autosuspend de 5 min (primeira requisição depois da pausa fica lenta) — `necessidade.md` seção 4, consulta de 2026-10-24 pelo agente pesquisador.
- **Segredos**: no environment `producao` do GitHub e no Worker (`wrangler secret`); nunca no git

## Teste de fumaça (2026-10-30)

| Item | Resultado |
|---|---|
| Passos do `deploy.yml` (18) | todos verdes; migração 0026 aplicada (1 migration nesta execução) |
| `GET /api/health` | 200, `{"status":"ok"}` |
| `/`, `/termos`, `/sw.js` | 200 (html, html, javascript) |
| Cabeçalhos | HSTS, CSP e `nosniff` presentes |
| Backup manual | gerou artefato, verde |

## Pendências antes de abrir ao público

- [ ] **Fumaça de isolamento no Hyperdrive** (runbook seção 9): pede duas contas de teste e os cookies de sessão, feito por você; **não executado**.
- [ ] **Login completo** pelo app (2FA por e-mail) no endereço publicado: **não executado**.
- [ ] Seção 6 do runbook: Asaas de produção e chave Pix, domínio/rota do Worker e `URL_PUBLICA` coerentes, DKIM do Resend, revisão jurídica dos termos.
- [ ] Environment `producao` sem revisor obrigatório (só restringe a branch): decidir se exige aprovação.
- [ ] Bancos temporários antigos no Postgres do Docker local e checagens do Chrome (T156, PUB-03), da `STATE.md`.

## Histórico

| Data | Versão | Observação |
|---|---|---|
| 2026-10-30 | `b145d87` | Primeiro deploy no Neon e na Cloudflare reais (ensaio); migration 0026 aplicada |
