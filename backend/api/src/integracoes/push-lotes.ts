import {
  type AssinaturaPush,
  type MensagemPush,
  type OpcoesEnvioPush,
  type ResultadoEnvioPush,
  enviarPush,
} from './push.ts';

// PUSH-07 (ADR-011): envio de vários pushes em lotes, em segundo plano (ctx.waitUntil). A tarefa
// do cron (ou a rota) entrega a lista e segue; o Worker continua vivo até o último lote terminar.
// - Um único waitUntil por chamada; dentro dele, os lotes vão um depois do outro e os envios de
//   um lote vão juntos. PREMISSA: 6 por lote, o limite de conexões de saída simultâneas de uma
//   execução do Worker.
// - Um envio que falha (ou lança) não impede os demais; o erro vai a capturarErro (Sentry).

export const TAMANHO_LOTE_PUSH = 6;

export interface EnvioPush {
  assinatura: AssinaturaPush;
  mensagem: MensagemPush;
}

export interface OpcoesLotesPush extends OpcoesEnvioPush {
  emSegundoPlano: (tarefa: Promise<unknown>) => void;
  capturarErro: (erro: unknown) => void;
  tamanhoLote?: number;
}

export type ResultadoLotePush = ResultadoEnvioPush | 'erro';

async function enviarTodos(
  envios: readonly EnvioPush[],
  opcoes: OpcoesLotesPush,
): Promise<ResultadoLotePush[]> {
  const tamanho = opcoes.tamanhoLote ?? TAMANHO_LOTE_PUSH;
  const resultados: ResultadoLotePush[] = [];
  for (let i = 0; i < envios.length; i += tamanho) {
    const lote = envios.slice(i, i + tamanho);
    const feitos = await Promise.allSettled(
      lote.map(({ assinatura, mensagem }) => enviarPush(assinatura, mensagem, opcoes)),
    );
    for (const feito of feitos) {
      if (feito.status === 'fulfilled') resultados.push(feito.value);
      else {
        opcoes.capturarErro(feito.reason);
        resultados.push('erro');
      }
    }
  }
  return resultados;
}

// Entrega os envios ao waitUntil e devolve a mesma promessa (nunca rejeita), para quem quiser
// esperar o resultado (testes).
export function enviarEmLotes(
  envios: readonly EnvioPush[],
  opcoes: OpcoesLotesPush,
): Promise<ResultadoLotePush[]> {
  const tarefa = enviarTodos(envios, opcoes);
  opcoes.emSegundoPlano(tarefa);
  return tarefa;
}
