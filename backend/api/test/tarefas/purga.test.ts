import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import type { ContextoTarefa } from '../../src/tarefas/despachar.ts';
import { tarefaPurga } from '../../src/tarefas/purga.ts';
import { comoAdmin, emailSimulado } from '../apoio.ts';
import { contaComSessao, postar } from '../rotas/conta-apoio.ts';

// T152 / CONTA-05: a tarefa de purga, pela função tarefas.purgar_contas (migration 0023), apaga
// todas as linhas do profissional 30 dias depois da confirmação (bloqueado_exclusao_em) e guarda
// só conta_excluida (id, data do pedido, data da purga). Antes de 30 dias nada é apagado.
// Isolamento no banco de teste compartilhado: as contas daqui são bloqueadas no passado (1990 e
// 1999) e a tarefa roda com `agora` nessas datas, então as contas bloqueadas hoje pelos outros
// arquivos nunca são purgadas por ela. O bloqueio é gravado por último, depois de semear tudo.

const LENTO = { timeout: 30_000 };
const DIA = 24 * 60 * 60_000;
const TRINTA_DIAS = 30 * DIA;

const ctx = (agora: Date): ContextoTarefa => ({
  agora,
  desde: null,
  // Folga para contas antigas que tenham sobrado de execuções interrompidas.
  limite: 1000,
  env,
  emSegundoPlano: () => {},
  capturarErro: () => {},
});

const purgar = (agora: Date) => tarefaPurga().executar(ctx(agora));

async function contaComDados() {
  const conta = await contaComSessao();
  const [p] = await comoAdmin<{ id: string }>(
    `insert into paciente (usuario_id, nome) values ($1, 'Paciente') returning id`,
    [conta.usuarioId],
  );
  await comoAdmin(
    `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento,
                                     versao_termo)
     values ($1, $2, 'atendimento', '1990-01-01', '1.0')`,
    [conta.usuarioId, p!.id],
  );
  return conta;
}

async function pedirEm(usuarioId: string, quando: Date) {
  await comoAdmin(
    `insert into audit_log (usuario_id, ator, acao, alvo_tipo, alvo_id, criado_em)
     values ($1::uuid, $1::text, 'conta.exclusao_pedida', 'conta', $1::uuid, $2)`,
    [usuarioId, quando],
  );
}

const bloquearEm = (usuarioId: string, quando: Date) =>
  comoAdmin('update usuario set bloqueado_exclusao_em = $2 where id = $1', [usuarioId, quando]);

async function linhasDe(usuarioId: string) {
  const [r] = await comoAdmin<Record<string, number>>(
    `select (select count(*)::int from usuario where id = $1) as usuario,
            (select count(*)::int from credencial_senha where usuario_id = $1) as credencial,
            (select count(*)::int from sessao where usuario_id = $1) as sessoes,
            (select count(*)::int from paciente where usuario_id = $1) as pacientes,
            (select count(*)::int from consentimento_tcle where usuario_id = $1) as tcle,
            (select count(*)::int from audit_log where usuario_id = $1) as auditoria`,
    [usuarioId],
  );
  return r!;
}

const excluida = (id: string) =>
  comoAdmin<{ id: string; pedido_em: Date; purgado_em: Date }>(
    'select * from conta_excluida where id = $1',
    [id],
  );

describe('purga de contas (CONTA-05)', LENTO, () => {
  it('antes de 30 dias nada é apagado', async () => {
    const conta = await contaComDados();
    const bloqueio = new Date('1999-06-01T12:00:00.000Z');
    await pedirEm(conta.usuarioId, new Date(bloqueio.getTime() - 60_000));
    await bloquearEm(conta.usuarioId, bloqueio);
    const antes = await linhasDe(conta.usuarioId);

    await purgar(new Date(bloqueio.getTime() + TRINTA_DIAS - 1));

    expect(await linhasDe(conta.usuarioId)).toEqual(antes);
    expect(antes).toEqual({
      usuario: 1,
      credencial: 1,
      sessoes: 1,
      pacientes: 1,
      tcle: 1,
      auditoria: 1,
    });
    expect(await excluida(conta.usuarioId)).toEqual([]);
  });

  it('30 dias depois: apaga as linhas do profissional e guarda só conta_excluida', async () => {
    const conta = await contaComDados();
    const pedido = new Date('1990-05-01T12:00:00.000Z');
    const bloqueio = new Date(pedido.getTime() + 10 * 60_000);
    await pedirEm(conta.usuarioId, pedido);
    await bloquearEm(conta.usuarioId, bloqueio);
    const agora = new Date(bloqueio.getTime() + TRINTA_DIAS);

    await purgar(agora);

    expect(await linhasDe(conta.usuarioId)).toEqual({
      usuario: 0,
      credencial: 0,
      sessoes: 0,
      pacientes: 0,
      tcle: 0,
      auditoria: 0,
    });
    expect(await excluida(conta.usuarioId)).toEqual([
      { id: conta.usuarioId, pedido_em: pedido, purgado_em: agora },
    ]);
  });

  it('depois da purga a conta não entra mais', async () => {
    const conta = await contaComDados();
    const bloqueio = new Date('1990-06-01T12:00:00.000Z');
    await bloquearEm(conta.usuarioId, bloqueio);

    await purgar(new Date(bloqueio.getTime() + TRINTA_DIAS + DIA));

    const app = criarApp({
      capturarErro: () => {},
      email: () => emailSimulado().cliente,
      emSegundoPlano: () => {},
    });
    const entrar = await postar(app, '/api/auth/entrar', {
      email: conta.email,
      senha: conta.senha,
    });
    expect(entrar.status).toBe(401);
    const sessao = await app.request('/api/eu', { headers: { cookie: conta.cookie } }, env);
    expect(sessao.status).toBe(401);
  });
});
