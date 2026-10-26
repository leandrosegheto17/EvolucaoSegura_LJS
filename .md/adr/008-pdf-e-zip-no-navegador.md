# ADR-008: PDF do prontuário no navegador (pdfmake, chunk sob demanda)

- **Status**: Aceito
- **Data**: 2026-10-26
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), EXP-02 e EXP-03; [design](../../.specs/features/evolucao-segura/design.md), risco [P-6] e etapa 11 ("008 PDF e zip no navegador"); tarefas T123 e T124

## Contexto

O legado montava o PDF no servidor com pdfmake e fontes em arquivo. No Worker do plano Free o limite é de 10 ms de CPU por requisição, e o spike `cpu-exportacao` mediu cerca de 1 s só para a exportação inteira (AD-003). O risco [P-6] pedia confirmar o tamanho do bundle e a acentuação do pdfmake no navegador.

## Decisão

- A API devolve só o JSON do prontuário (`GET /api/pacientes/:id/prontuario`); o app monta o PDF no navegador com `pdfmake` 0.3.12 (MIT), versão fixa em `frontend/web/package.json` e no `pnpm-lock.yaml`.
- `frontend/web/src/export/pdf-prontuario.ts` importa o motor (`pdfmake/build/pdfmake`) e as fontes (`pdfmake/build/vfs_fonts`) por `import()` dinâmico. Nada de pdfmake entra no bundle principal; o Vite gera chunks separados, baixados só ao exportar. Medido no build: `pdfmake` 767,80 kB (287,77 kB gzip) e `vfs_fonts` 854,65 kB (468,59 kB gzip).
- A definição do documento é a de `record-pdf.ts` do legado, adaptada ao contrato `Prontuario`.
- Acentos: o vfs do pdfmake embute a Roboto (TrueType), que cobre o latim completo. O legado usava Inter e Source Serif 4; trocar de fonte evita empacotar arquivos extras. Um teste gera o PDF de verdade com texto acentuado.
- O `.zip` da exportação completa (T124) usa `fflate`, também sob demanda.

## Consequências

- O custo de CPU do PDF vai para o aparelho do usuário, não para o Worker.
- O primeiro PDF baixa cerca de 1,6 MB (755 kB comprimidos); depois fica em cache do navegador/PWA.
- A aparência difere um pouco do legado (fonte Roboto no lugar de Inter e Source Serif 4).
