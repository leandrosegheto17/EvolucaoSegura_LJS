import { RESPOSTA_PEDIR_EXCLUSAO } from '@es/contrato/conta';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.ts';
import { comoAdmin, emailSimulado } from '../apoio.ts';
import {
  type ContaComSessao,
  contaComSessao,
  eventosDe,
  postar,
  semearExportacao,
  tokensDe,
} from './conta-apoio.ts';

// T149 / CONTA-01: POST /api/conta/excluir recusa com 422 o pedido sem exportação completa servida
// nas últimas 24 horas, sem a declaração de guarda do prontuário marcada ou com senha errada,
// indicando cada requisito que falta. O pedido recusado não grava nada.

const LENTO = { timeout: 30_000 };

function montar() {
  const correio = emailSimulado();
  const pendentes: Promise<unknown>[] = [];
  const app = criarApp({
    capturarErro: () => {},
    email: () => correio.cliente,
    emSegundoPlano: (tarefa) => void pendentes.push(tarefa),
  });
  const pedir = async (conta: ContaComSessao | null, corpo: unknown) => {
    const resposta = await postar(app, '/api/conta/excluir', corpo, conta);
    await Promise.all(pendentes);
    return resposta;
  };
  return { pedir, correio };
}

const completo = (conta: ContaComSessao) => ({ senha: conta.senha, declaracao_guarda: true });

async function esperarFaltando(resposta: Response, requisitos: string[]) {
  expect(resposta.status).toBe(422);
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = esquemaProblema.parse(await resposta.json());
  expect(corpo).toMatchObject({ codigo: 'requisitos_exclusao', status: 422, requisitos });
}

async function semEfeito(conta: ContaComSessao) {
  expect(await tokensDe(conta.usuarioId, 'exclusao')).toEqual([]);
  expect(await eventosDe(conta.usuarioId)).toEqual([]);
  const [linha] = await comoAdmin<{ bloqueado_exclusao_em: Date | null }>(
    'select bloqueado_exclusao_em from usuario where id = $1',
    [conta.usuarioId],
  );
  expect(linha!.bloqueado_exclusao_em).toBeNull();
}

describe('autenticação', () => {
  it('sem sessão responde 401', async () => {
    const { pedir } = montar();
    const resposta = await pedir(null, { senha: 'x', declaracao_guarda: true });
    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
  });

  it('sem o token CSRF responde 403', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    const resposta = await pedir({ ...conta, csrf: 'outro' }, completo(conta));
    expect(resposta.status).toBe(403);
  });
});

describe('com todos os requisitos (CONTA-01)', LENTO, () => {
  it('aceita o pedido com 202', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId, 1);
    const resposta = await pedir(conta, completo(conta));
    expect(resposta.status).toBe(202);
    expect(await resposta.json()).toEqual(RESPOSTA_PEDIR_EXCLUSAO);
  });

  it('exportação concluída há 23 horas ainda vale', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId, 23);
    expect((await pedir(conta, completo(conta))).status).toBe(202);
  });
});

describe('cada requisito que falta é indicado no 422 (CONTA-01)', LENTO, () => {
  it('sem exportação completa', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await esperarFaltando(await pedir(conta, completo(conta)), ['exportacao']);
    await semEfeito(conta);
  });

  it('exportação concluída há mais de 24 horas não vale', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId, 24.1);
    await esperarFaltando(await pedir(conta, completo(conta)), ['exportacao']);
  });

  it('a exportação de outro profissional não vale', async () => {
    const { pedir } = montar();
    const outro = await contaComSessao();
    await semearExportacao(outro.usuarioId, 1);
    const conta = await contaComSessao();
    await esperarFaltando(await pedir(conta, completo(conta)), ['exportacao']);
  });

  it('outro evento recente (não a exportação completa concluída) não vale', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await comoAdmin(
      `insert into audit_log (usuario_id, ator, acao, alvo_tipo)
       values ($1::uuid, $1::text, 'paciente.consultado', 'paciente')`,
      [conta.usuarioId],
    );
    await esperarFaltando(await pedir(conta, completo(conta)), ['exportacao']);
  });

  it.each([
    ['ausente', undefined],
    ['desmarcada', false],
  ])('declaração de guarda %s', async (_caso, declaracao) => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId);
    const resposta = await pedir(conta, { senha: conta.senha, declaracao_guarda: declaracao });
    await esperarFaltando(resposta, ['declaracao_guarda']);
    await semEfeito(conta);
  });

  it.each([
    ['errada', (s: string) => `${s}x`],
    ['vazia', () => ''],
    ['ausente', () => undefined],
  ])('senha %s', async (_caso, senha) => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await semearExportacao(conta.usuarioId);
    const resposta = await pedir(conta, { senha: senha(conta.senha), declaracao_guarda: true });
    await esperarFaltando(resposta, ['senha']);
    await semEfeito(conta);
  });

  it('a senha de outra conta não vale', async () => {
    const { pedir } = montar();
    const outro = await contaComSessao();
    const conta = await contaComSessao();
    await comoAdmin('select definir_senha($1, $2)', [outro.usuarioId, 'outra-senha-forte-9']);
    await semearExportacao(conta.usuarioId);
    const resposta = await pedir(conta, { senha: 'outra-senha-forte-9', declaracao_guarda: true });
    await esperarFaltando(resposta, ['senha']);
  });

  it('todos faltando: os três, na ordem exportação, declaração e senha', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    await esperarFaltando(await pedir(conta, {}), ['exportacao', 'declaracao_guarda', 'senha']);
    await semEfeito(conta);
  });

  it('o pedido recusado não envia e-mail', async () => {
    const { pedir, correio } = montar();
    const conta = await contaComSessao();
    await pedir(conta, completo(conta));
    expect(correio.enviadas).toEqual([]);
  });
});

describe('corpo fora do formato', () => {
  it.each([
    [
      'declaração que não é booleana',
      { senha: 'x', declaracao_guarda: 'sim' },
      'declaracao_guarda',
    ],
    ['senha que não é texto', { senha: 123, declaracao_guarda: true }, 'senha'],
    ['chave desconhecida', { senha: 'x', declaracao_guarda: true, outra: 1 }, 'outra'],
  ])('%s responde 422 validacao', async (_caso, corpo, campo) => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    const resposta = await pedir(conta, corpo);
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: [campo] });
    await semEfeito(conta);
  });

  it('JSON inválido responde 422 validacao', async () => {
    const { pedir } = montar();
    const conta = await contaComSessao();
    const resposta = await pedir(conta, '{');
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao' });
  });
});
