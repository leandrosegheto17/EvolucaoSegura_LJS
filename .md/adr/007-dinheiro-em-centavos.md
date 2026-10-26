# ADR-007: Dinheiro em centavos inteiros

- **Status**: Aceito
- **Data**: 2026-10-26
- **Supersedes**: nenhum
- **Origem**: [spec](../../.specs/features/evolucao-segura/spec.md), FIN-01 a FIN-08 e Convenções dos critérios ("Dinheiro em centavos inteiros"); [design](../../.specs/features/evolucao-segura/design.md), etapa 10 ("Centavos × decimal do legado") e reaproveitamento do domínio financeiro; tarefas T107 e T108

## Contexto

O legado grava preço e pagamento em `numeric(10,2)` e trafega reais com até duas casas no JSON (`150.5`). No caminho até o navegador o valor vira `number` de ponto flutuante. Somas de débitos precisam de `Math.round(x * 100) / 100`, e a validação de "no máximo 2 casas" depende de tolerância (`1e-6`). O PostgreSQL devolve `numeric` como texto, e cada camada converte de um jeito diferente. A recriação refaz o banco do zero (D-03), então dá para escolher a representação sem migrar dado.

## Decisão

- **Banco**: os valores são `bigint` em centavos (`valor_centavos`), com `CHECK (valor_centavos BETWEEN 0 AND 9999999999)`. É o mesmo teto do `numeric(10,2)` do legado (R$ 99.999.999,99). Valem para `preco_paciente`, `preco_sessao` e `pagamento` (migration 0010).
- **Contrato e API**: o campo `valor` (e os totais `valor_pendente` e `total_pendente`) é um inteiro em centavos. O Zod usa `z.number().int().min(0).max(9_999_999_999)`. Decimal, texto e valor fora da faixa respondem 422 `validacao`. O teto cabe com folga em `Number.MAX_SAFE_INTEGER`, então o JSON segue com `number`.
- **Leitura do banco**: o driver `pg` devolve `bigint` como texto. O repositório converte com `Number()` só depois de ler, e as somas são feitas em inteiros, no SQL ou no domínio.
- **Tela**: o app formata os centavos em reais (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`) e converte a digitação em reais para centavos antes de enviar. Nenhuma conta com dinheiro é feita em ponto flutuante.

## Consequências

- Somas e comparações são exatas: o total pendente é a soma de inteiros, sem arredondamento.
- O formato difere do legado: quem lê a API recebe `15000`, não `150`. As telas portadas do legado precisam converter na entrada e na saída.
- O assinante do Pro (1990 centavos, PLANO-05) e o Asaas usam a mesma convenção do lado do produto. A integração converte para o formato que o Asaas pede, só na borda.
- A troca de representação está registrada: o domínio copiado de `debts.ts`, `payment.ts` e `price.ts` perde o `toFixed(2)` e o arredondamento por 100.
