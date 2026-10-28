import { env } from 'cloudflare:workers';
import type { criarApp } from '../../src/app.ts';
import { csrfDaSessao, gerarToken } from '../../src/tokens.ts';
import { comoAdmin, criarConta, ipUnico } from '../apoio.ts';

// Apoio dos testes da exclusão de conta (T149 a T151): conta com senha (bcrypt pela função do
// banco) e sessão aberta, exportação completa concluída semeada como evento de auditoria (o que a
// rota da T173 grava ao servir a última página) e leitura de tokens e eventos.

export type App = ReturnType<typeof criarApp>;

export interface ContaComSessao {
  usuarioId: string;
  email: string;
  senha: string;
  cookie: string;
  csrf: string;
}

export async function abrirSessao(usuarioId: string): Promise<{ cookie: string; csrf: string }> {
  const { token, hash } = await gerarToken();
  await comoAdmin('insert into sessao (usuario_id, token_hash) values ($1, $2)', [usuarioId, hash]);
  return { cookie: `__Host-sid=${token}`, csrf: await csrfDaSessao(token) };
}

export async function contaComSessao(): Promise<ContaComSessao> {
  const conta = await criarConta();
  return {
    usuarioId: conta.id,
    email: conta.email,
    senha: conta.senha,
    ...(await abrirSessao(conta.id)),
  };
}

// Exportação completa concluída há `horasAtras` horas (evento exportacao.concluida, T173).
export async function semearExportacao(usuarioId: string, horasAtras = 1): Promise<void> {
  await comoAdmin(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo, criado_em)
     values ($1::uuid, $1::text, 'exportacao.concluida', 'exportacao',
             now() - make_interval(secs => $2))`,
    [usuarioId, horasAtras * 3600],
  );
}

export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0';

export function postar(
  app: App,
  caminho: string,
  corpo: unknown,
  sessao: { cookie: string; csrf: string } | null = null,
) {
  return app.request(
    caminho,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': ipUnico(),
        'User-Agent': USER_AGENT,
        ...(sessao ? { cookie: sessao.cookie, 'x-csrf-token': sessao.csrf } : {}),
      },
      body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    },
    env,
  );
}

export interface LinhaToken {
  token_hash: Buffer;
  tipo: string;
  criado_em: Date;
  expira_em: Date;
  usado_em: Date | null;
  invalidado_em: Date | null;
}

export const tokensDe = (usuarioId: string, tipo: string) =>
  comoAdmin<LinhaToken>(
    'select * from token_email where usuario_id = $1 and tipo = $2 order by criado_em',
    [usuarioId, tipo],
  );

export const eventosDe = (usuarioId: string, prefixo = 'conta.exclusao_') =>
  comoAdmin<{
    ator: string;
    acao: string;
    alvo_tipo: string;
    alvo_id: string | null;
    campos_alterados: string[];
    origem_ip: string | null;
    origem_ua: string | null;
  }>(
    `select ator, acao, alvo_tipo, alvo_id, campos_alterados, origem_ip, origem_ua
     from audit_log where usuario_id = $1 and acao like $2 || '%' order by id`,
    [usuarioId, prefixo],
  );
