# Resultado: cpu-exportacao

- **Situação**: concluído
- **Tempo gasto**: cerca de 7 minutos (22:08 a 22:15) de 2 horas · **Tentativas**: 2 de 2

## O que foi feito

1. Reaproveitou o projeto Neon `es-spike-s1`, o Hyperdrive `es-spike-s1` (cache desligado) e criou o Worker `es-spike-cpu` (`nodejs_compat`, mesmo binding), sem alterar o `es-spike-s1`.
2. Criou 6 tabelas com esquema parecido com o do produto e populou com `generate_series`: 300 pacientes, 15.000 sessões, 15.000 evoluções de 1.500 caracteres, 300 anamneses, 15.000 pagamentos e 30.000 eventos de auditoria (`node setup.mjs`).
3. Tentativa 1: rota `/exportar?modo=full` lê todas as tabelas numa transação e faz um `JSON.stringify` do objeto inteiro. 20 chamadas sequenciais com `wrangler tail --format json` em paralelo.
4. Tentativa 2: rota `?modo=stream` com `TransformStream`, tabela a tabela, `JSON.stringify` por lote de 1.000 linhas. Mesmas 20 chamadas.

Sem diferença em relação ao método planejado.

## Medições

CPU lida do campo `cpuTime` de cada evento do `wrangler tail` (fonte real da Cloudflare, plano Free).

| Medição | Valor | Condições | Comando | Conferida pela sessão |
|---|---|---|---|---|
| Tentativa 1 (JSON inteiro): CPU das 20 execuções | 947, 870, 221 e depois 10 ms (teto) nas 17 restantes; mediana 10 ms; máximo 947 ms | volume acima, Hyperdrive real | `npx wrangler tail es-spike-cpu --format json > tail_full.jsonl` com `node chamar.mjs full` | sim (valores relidos em `tail_full.jsonl`) |
| Tentativa 1: execuções encerradas por limite de CPU | 18 de 20 (`exceededCpu`, HTTP 503) | idem | idem | sim |
| Tentativa 2 (streaming): CPU das 20 execuções | 1074, 955 e 10 ms (teto) nas 18 restantes; mediana 10 ms; máximo 1074 ms | idem | `... tail_stream.jsonl` com `node chamar.mjs stream` | sim (valores relidos em `tail_stream.jsonl`) |
| Tentativa 2: execuções encerradas por limite de CPU | 19 de 20 (corpo truncado) | idem | idem | sim |
| Tamanho do JSON completo | 39,65 MB | idem | `cham_full.txt` | sim |

A mediana de 10 ms é o teto do plano Free (a execução é cortada ali), não o consumo real. O consumo real das execuções que terminaram foi de cerca de 0,9 a 1,1 s.

## Observações

- **Surpresas**: só as 2 primeiras execuções de cada tentativa chegaram a gastar cerca de 1 s de CPU sem serem cortadas de imediato; depois tudo bateu no teto de 10 ms. Causa não investigada.
- **Obstáculos**: `wrangler tail` imprime JSON multilinha, não JSONL; o agente separou os eventos manualmente. O `taskkill` foi negado pelo classificador de permissões e o tail foi encerrado por `timeout`.
- **Comportamentos inesperados**: o JSON completo tem 39,65 MB, acima do limite de 25 MB do EXP-04; os 15.000 textos de 1.500 caracteres somam cerca de 22 MB e o resto vem de uuids e nomes de chaves repetidos.
- **Esforço real**: bem menor que o previsto.
- **Perguntas novas**: quanto de CPU custa uma página de exportação de tamanho limitado (por exemplo, 300 evoluções)? Vira outro spike ou o primeiro teste da tarefa de exportação.
