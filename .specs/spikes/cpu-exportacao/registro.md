# Registro do spike: a exportação completa de um profissional com volume realista cabe em 10 ms de CPU no Worker do plano Free?

- **Slug**: cpu-exportacao · **Data**: 2026-10-24 · **Chamado por**: tarefa T12 (spike S1, parte de CPU) de `.specs/features/evolucao-segura/tasks.md` · **Usar em**: `design.md` (Risks & Concerns), tarefa T122 (exportação completa), ADR-008
- **Veredito**: não (deu errado pelo critério congelado: mediana acima de 10 ms e 18 a 19 de 20 execuções encerradas por limite de CPU)
- **Confiança**: alta de que a exportação completa em uma resposta não cabe. Pesam a favor: CPU lida de fonte real, duas abordagens diferentes com o mesmo resultado, valores relidos pela sessão nos arquivos brutos, volume realista. Pesam contra: volume falso (PREMISSA), causa do corte imediato após as 2 primeiras execuções não investigada.
- **Destino do código**: descartado (2026-10-24)

## Resposta

Não. Serializar uma exportação de 39,65 MB gasta cerca de 0,9 a 1,1 s de CPU, cem vezes o limite de 10 ms do plano Free, tanto com `JSON.stringify` do objeto inteiro quanto com streaming por lotes de 1.000 linhas. O critério "deu certo" (mediana de 5 ms, máximo de 8 ms) ficou muito longe, e o "deu errado" (mediana acima de 10 ms) foi atendido.

## Método e resultado

- **Método**: Worker de teste com Hyperdrive real e volume falso de 5 anos de consultório cheio; 20 chamadas em cada abordagem, CPU lida do `wrangler tail`.
- **Medições principais**: CPU de 0,9 a 1,1 s quando a execução termina, corte no teto de 10 ms nas demais; JSON de 39,65 MB (detalhe em `resultado.md`).
- **Tempo gasto**: cerca de 7 minutos de 2 horas.

## Explicações concorrentes e sem resposta

- O volume proposto pode ser maior que o do cliente típico; cliente pequeno cabe. Mas o produto precisa funcionar para o consultório cheio (a exclusão de conta exige exportação, CONTA-01).
- Não se sabe o custo de CPU de uma página pequena: estimando ~25 ms por MB serializado, uma página de cerca de 0,3 MB caberia em 10 ms, mas isso é extrapolação e precisa de teste.
- Não se investigou por que as 2 primeiras execuções passaram de 10 ms sem corte.

## Riscos descobertos

| Risco | Impacto | O que fazer |
|---|---|---|
| Exportação completa numa só resposta estoura o CPU do Free (EXP-03, CONTA-01) | alto: bloqueia a exclusão de conta | Mudar o desenho: a API entrega a exportação em páginas pequenas por tabela (cursor), o navegador junta e monta o `dados.json` e o `.zip`; atualizar EXP-03, EXP-04 e T122 antes da etapa 11 |
| JSON completo de 39,65 MB passa de 25 MB (EXP-04) | médio | O limite passa a valer por página, não pelo total; revisar o texto do EXP-04 |
| Mesmo a página pode estourar se for grande | médio | Primeiro teste da T122: medir CPU de uma página de tamanho fixo (ex.: 300 evoluções) no Hyperdrive real; se passar, fixar o tamanho; senão, novo spike |

## Trechos de referência (não copiar: reescrever com testes)

Sem trecho que valha guardar. A conclusão é o número: cerca de 25 ms de CPU por MB de JSON serializado neste ambiente.

## Links

- Limites do Workers no plano Free (10 ms de CPU por requisição), conforme `padrao-ljs.md` seção 2
