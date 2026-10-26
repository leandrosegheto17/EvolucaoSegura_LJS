import { env } from 'cloudflare:workers';
import { criarApp } from '../../src/app.ts';
import type { sessaoDeTeste } from '../apoio.ts';
import { comoAdmin, ipUnico } from '../apoio.ts';

// Apoio dos testes das rotas de pacientes e TCLE (T69 a T72): requisição autenticada, paciente
// semeado direto no banco e leitura da auditoria pelo superusuário.

export type Sessao = Awaited<ReturnType<typeof sessaoDeTeste>>;

export const app = criarApp({ capturarErro: () => {} });

export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0';

export function pedir(
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  caminho: string,
  sessao: Sessao | null,
  corpo?: unknown,
) {
  return app.request(
    caminho,
    {
      method: metodo,
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': USER_AGENT,
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
      },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    },
    env,
  );
}

// Paciente semeado pelo superusuário (sem passar pela rota de criação).
export async function semearPaciente(
  usuarioId: string,
  dados: { nome?: string; ativo?: boolean } = {},
): Promise<string> {
  const [linha] = await comoAdmin<{ id: string }>(
    'insert into paciente (usuario_id, nome, ativo) values ($1, $2, $3) returning id',
    [usuarioId, dados.nome ?? 'Maria Silva', dados.ativo ?? true],
  );
  return linha!.id;
}

export const linhaPaciente = async (id: string) =>
  (
    await comoAdmin<Record<string, unknown>>(
      `select usuario_id, nome, telefone, email, endereco, ativo, row_version, atualizado_em
       from paciente where id = $1`,
      [id],
    )
  )[0];

export const auditoriaDe = (usuarioId: string, acao: string) =>
  comoAdmin<{
    usuario_id: string;
    ator: string;
    acao: string;
    alvo_tipo: string;
    alvo_id: string;
    campos_alterados: string[];
    origem_ua: string | null;
  }>(
    `select usuario_id, ator, acao, alvo_tipo, alvo_id, campos_alterados, origem_ua
     from audit_log where usuario_id = $1 and acao = $2 order by id`,
    [usuarioId, acao],
  );
