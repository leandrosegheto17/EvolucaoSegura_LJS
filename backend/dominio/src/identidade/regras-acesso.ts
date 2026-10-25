// AUTH-05, AUTH-06, AUTH-07, AUTH-09: regras puras de acesso. O "agora" é sempre parâmetro (na
// API ele vem do relógio do banco); nenhuma função lê o relógio do processo.

const MINUTO = 60_000;

export const INATIVIDADE_SESSAO_MS = 15 * MINUTO;
export const DURACAO_MAXIMA_SESSAO_MS = 12 * 60 * MINUTO;
export const LIMITE_FALHAS_LOGIN = 5;
export const JANELA_FALHAS_MS = 15 * MINUTO;
export const DURACAO_BLOQUEIO_MS = 15 * MINUTO;
export const LIMITE_ERROS_2FA = 5;
export const INTERVALO_REENVIO_MS = 60_000;

// AUTH-09: a sessão encerra 15 min depois do último uso ou 12 h depois do login, o que vier
// primeiro. No instante exato do limite ela já está encerrada.
export interface MarcosSessao {
  criadaEm: Date;
  ultimoUsoEm: Date;
}

export function expiracaoSessao({ criadaEm, ultimoUsoEm }: MarcosSessao): Date {
  return new Date(
    Math.min(
      ultimoUsoEm.getTime() + INATIVIDADE_SESSAO_MS,
      criadaEm.getTime() + DURACAO_MAXIMA_SESSAO_MS,
    ),
  );
}

export function sessaoExpirada(sessao: MarcosSessao, agora: Date): boolean {
  return agora.getTime() >= expiracaoSessao(sessao).getTime();
}

// AUTH-07: estado guardado em tentativa_login, por e-mail e por IP. A janela de 15 min começa na
// primeira falha; a 5ª falha dentro dela bloqueia por 15 min a partir dessa falha. Tentativas
// durante o bloqueio são recusadas antes de conferir a senha, então não contam.
export interface EstadoFalhas {
  falhas: number;
  janelaInicio: Date | null;
  bloqueadoAte: Date | null;
}

export const ESTADO_SEM_FALHAS: EstadoFalhas = {
  falhas: 0,
  janelaInicio: null,
  bloqueadoAte: null,
};

export type Bloqueio = { bloqueado: false } | { bloqueado: true; retryAfterSegundos: number };

export function bloqueioLogin(estado: EstadoFalhas, agora: Date): Bloqueio {
  const restante = (estado.bloqueadoAte?.getTime() ?? 0) - agora.getTime();
  if (restante <= 0) return { bloqueado: false };
  return { bloqueado: true, retryAfterSegundos: Math.ceil(restante / 1000) };
}

export function aposFalhaLogin(estado: EstadoFalhas, agora: Date): EstadoFalhas {
  if (bloqueioLogin(estado, agora).bloqueado) return estado;
  const janelaVencida =
    estado.janelaInicio === null ||
    agora.getTime() - estado.janelaInicio.getTime() >= JANELA_FALHAS_MS;
  if (janelaVencida) return { falhas: 1, janelaInicio: agora, bloqueadoAte: null };
  const falhas = estado.falhas + 1;
  return {
    falhas,
    janelaInicio: estado.janelaInicio,
    bloqueadoAte:
      falhas >= LIMITE_FALHAS_LOGIN ? new Date(agora.getTime() + DURACAO_BLOQUEIO_MS) : null,
  };
}

// AUTH-05: o 5º código errado no mesmo desafio o invalida; dali em diante, todo código é recusado.
export function desafio2faInvalidado(erros: number): boolean {
  return erros >= LIMITE_ERROS_2FA;
}

export function aposErro2fa(erros: number): { erros: number; invalidado: boolean } {
  const total = erros + 1;
  return { erros: total, invalidado: desafio2faInvalidado(total) };
}

// AUTH-06: novo código só se o último envio tiver MAIS de 60 s (aos 60 s exatos, ainda não).
export function podeReenviarCodigo(ultimoEnvioEm: Date, agora: Date): boolean {
  return agora.getTime() - ultimoEnvioEm.getTime() > INTERVALO_REENVIO_MS;
}
