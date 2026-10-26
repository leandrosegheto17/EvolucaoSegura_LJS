import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ERRO_IDENTIDADE,
  RESPOSTA_CADASTRO,
  RESPOSTA_ENTRAR,
  RESPOSTA_LOGIN_RECUSADO,
  esquemaCadastro,
  esquemaConfirmarEmail,
  esquemaConfirmarRecuperacao,
  esquemaEntrar,
  esquemaPedirRecuperacao,
  esquemaProblema,
  esquemaReenviar2fa,
  esquemaVerificar2fa,
  problema,
} from './identidade.ts';

// T37 / CAD-01, AUTH-02: contrato das rotas públicas de identidade. Nome de 1 a 200, e-mail
// válido e aceite dos termos obrigatório no cadastro; uma única resposta de erro de login para
// todos os motivos (senha errada, e-mail inexistente, conta não confirmada ou bloqueada); chave
// desconhecida recusada em todo corpo. A política de senha (AUTH-11) é do domínio (T38): aqui a
// senha do cadastro só precisa ser texto, para a rota responder 422 com o motivo certo.

const cadastroValido = {
  nome: 'Ana Souza',
  email: 'ana@exemplo.com.br',
  senha: 'cavalo-bateria-grampo-7',
  aceite_termos: true,
};
const aceita = (esquema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  esquema.safeParse(v).success;

describe('cadastro (CAD-01)', () => {
  it('aceita o cadastro completo', () => {
    expect(esquemaCadastro.parse(cadastroValido)).toEqual(cadastroValido);
  });

  it('aceita nome de 1 e de 200 caracteres', () => {
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: 'A' })).toBe(true);
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: 'a'.repeat(200) })).toBe(true);
  });

  it('recusa nome vazio, só com espaços ou com 201 caracteres', () => {
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: '' })).toBe(false);
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: '   ' })).toBe(false);
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: 'a'.repeat(201) })).toBe(false);
  });

  it('apara o nome antes de medir', () => {
    expect(esquemaCadastro.parse({ ...cadastroValido, nome: '  Ana  ' }).nome).toBe('Ana');
    expect(aceita(esquemaCadastro, { ...cadastroValido, nome: ` ${'a'.repeat(200)} ` })).toBe(true);
  });

  it.each(['ana', 'ana@', '@exemplo.com', 'ana @exemplo.com', 'ana@exemplo', ''])(
    'recusa e-mail inválido %j',
    (email) => {
      expect(aceita(esquemaCadastro, { ...cadastroValido, email })).toBe(false);
    },
  );

  it('normaliza o e-mail (aparado e em minúsculas)', () => {
    expect(esquemaCadastro.parse({ ...cadastroValido, email: ' Ana@Exemplo.COM.br ' }).email).toBe(
      'ana@exemplo.com.br',
    );
  });

  it('aceita e-mail de 254 caracteres e recusa o de 255', () => {
    // Domínio com rótulos de até 60 caracteres, válidos no formato; só o tamanho muda.
    const dominio = (n: number) => `${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(n)}.com.br`;
    const com254 = `${'a'.repeat(64)}@${dominio(60)}`;
    const com255 = `${'a'.repeat(64)}@${dominio(61)}`;
    expect([com254.length, com255.length]).toEqual([254, 255]);
    expect(aceita(esquemaCadastro, { ...cadastroValido, email: com254 })).toBe(true);
    expect(aceita(esquemaCadastro, { ...cadastroValido, email: com255 })).toBe(false);
  });

  it.each([false, 'true', 1, null])('recusa aceite dos termos %j', (aceite_termos) => {
    expect(aceita(esquemaCadastro, { ...cadastroValido, aceite_termos })).toBe(false);
  });

  it('recusa cadastro sem o aceite dos termos', () => {
    const semAceite: Partial<typeof cadastroValido> = { ...cadastroValido };
    delete semAceite.aceite_termos;
    expect(aceita(esquemaCadastro, semAceite)).toBe(false);
  });

  it('deixa a política de senha para o domínio: senha curta ou longa passa no contrato', () => {
    expect(aceita(esquemaCadastro, { ...cadastroValido, senha: 'curta' })).toBe(true);
    expect(aceita(esquemaCadastro, { ...cadastroValido, senha: 'x'.repeat(129) })).toBe(true);
    expect(aceita(esquemaCadastro, { ...cadastroValido, senha: 123 })).toBe(false);
  });

  it('recusa chave desconhecida', () => {
    expect(aceita(esquemaCadastro, { ...cadastroValido, plano: 'pro' })).toBe(false);
  });

  it('responde o mesmo corpo em todos os casos', () => {
    expect(RESPOSTA_CADASTRO).toEqual({ status: 'aceito' });
  });
});

describe('entrar (AUTH-01, AUTH-02)', () => {
  const entrar = { email: 'ana@exemplo.com.br', senha: 'cavalo-bateria-grampo-7' };

  it('aceita e-mail e senha e normaliza o e-mail', () => {
    expect(esquemaEntrar.parse({ ...entrar, email: 'ANA@exemplo.com.br' })).toEqual(entrar);
  });

  it('recusa senha vazia, e-mail inválido e chave desconhecida', () => {
    expect(aceita(esquemaEntrar, { ...entrar, senha: '' })).toBe(false);
    expect(aceita(esquemaEntrar, { ...entrar, email: 'ana' })).toBe(false);
    expect(aceita(esquemaEntrar, { ...entrar, lembrar: true })).toBe(false);
  });

  it('responde 202 com status 2fa_required', () => {
    expect(RESPOSTA_ENTRAR).toEqual({ status: '2fa_required' });
  });

  it('tem uma única resposta de erro de login, sem motivo', () => {
    expect(RESPOSTA_LOGIN_RECUSADO).toEqual({
      tipo: 'about:blank',
      titulo: 'Não autorizado',
      status: 401,
      codigo: 'credenciais_invalidas',
    });
    expect(esquemaProblema.parse(RESPOSTA_LOGIN_RECUSADO)).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(CODIGOS_ERRO_IDENTIDADE.filter((c) => c.status === 401)).toEqual([
      { codigo: 'credenciais_invalidas', status: 401 },
    ]);
  });
});

describe('2FA (AUTH-03 a AUTH-06)', () => {
  it('aceita código de exatamente 6 dígitos', () => {
    expect(aceita(esquemaVerificar2fa, { email: 'ana@exemplo.com.br', codigo: '012345' })).toBe(
      true,
    );
  });

  it.each(['12345', '1234567', '12345a', ' 123456', ''])('recusa o código %j', (codigo) => {
    expect(aceita(esquemaVerificar2fa, { email: 'ana@exemplo.com.br', codigo })).toBe(false);
  });

  it('recusa código numérico (não texto) e chave desconhecida', () => {
    expect(aceita(esquemaVerificar2fa, { email: 'ana@exemplo.com.br', codigo: 123456 })).toBe(
      false,
    );
    expect(
      aceita(esquemaVerificar2fa, { email: 'ana@exemplo.com.br', codigo: '123456', x: 1 }),
    ).toBe(false);
  });

  it('reenvio pede só o e-mail', () => {
    expect(aceita(esquemaReenviar2fa, { email: 'ana@exemplo.com.br' })).toBe(true);
    expect(aceita(esquemaReenviar2fa, { email: 'ana@exemplo.com.br', codigo: '1' })).toBe(false);
  });
});

describe('confirmação e recuperação (CAD-05, AUTH-13, AUTH-15)', () => {
  it('pedido de recuperação pede só o e-mail', () => {
    expect(aceita(esquemaPedirRecuperacao, { email: 'ana@exemplo.com.br' })).toBe(true);
    expect(aceita(esquemaPedirRecuperacao, { email: 'ana@exemplo.com.br', nome: 'x' })).toBe(false);
  });

  it('token em qualquer formato passa no contrato (a rota responde 400 link_invalido)', () => {
    expect(aceita(esquemaConfirmarEmail, { token: 'lixo' })).toBe(true);
    expect(aceita(esquemaConfirmarRecuperacao, { token: 'lixo', nova_senha: 'curta' })).toBe(true);
  });

  it('recusa chave desconhecida e token ausente', () => {
    expect(aceita(esquemaConfirmarEmail, { token: 'a', email: 'x' })).toBe(false);
    expect(aceita(esquemaConfirmarEmail, {})).toBe(false);
    expect(aceita(esquemaConfirmarRecuperacao, { token: 'a', nova_senha: 'b', c: 1 })).toBe(false);
  });
});

describe('códigos de erro problem+json', () => {
  it('lista os códigos de identidade com o status de cada um', () => {
    expect(CODIGOS_ERRO_IDENTIDADE).toEqual([
      { codigo: 'validacao', status: 422 },
      { codigo: 'senha_fora_da_politica', status: 422 },
      { codigo: 'link_invalido', status: 400 },
      { codigo: 'credenciais_invalidas', status: 401 },
      { codigo: 'csrf_invalido', status: 403 },
      { codigo: 'muitas_tentativas', status: 429 },
      { codigo: 'mail_unavailable', status: 503 },
    ]);
  });

  it('monta o corpo do problema com o status do código', () => {
    expect(problema('link_invalido', 'Link inválido')).toEqual({
      tipo: 'about:blank',
      titulo: 'Link inválido',
      status: 400,
      codigo: 'link_invalido',
    });
  });

  it('leva o motivo da política de senha e os campos da validação', () => {
    expect(
      problema('senha_fora_da_politica', 'Senha fora da política', { motivo: 'comum' }),
    ).toMatchObject({ status: 422, motivo: 'comum' });
    expect(problema('validacao', 'Dados inválidos', { campos: ['nome'] })).toMatchObject({
      status: 422,
      campos: ['nome'],
    });
  });

  it('o código aceita letras maiúsculas e minúsculas, dígitos e sublinhado (decisão 2026-10-26)', () => {
    const base = problema('validacao', 'Dados inválidos');
    for (const codigo of ['SCHEDULE_CONFLICT', 'WEEKEND_DAY_HAS_SESSIONS', 'nao_encontrado', 'X1'])
      expect(aceita(esquemaProblema, { ...base, codigo }), codigo).toBe(true);
    for (const codigo of ['', 'com-hifen', 'com espaço', 'ação', 'x.y'])
      expect(aceita(esquemaProblema, { ...base, codigo }), codigo).toBe(false);
  });

  it('o esquema do problema recusa chave desconhecida e motivo fora da lista', () => {
    const base = problema('validacao', 'Dados inválidos');
    expect(aceita(esquemaProblema, { ...base, detalhe: 'senha errada' })).toBe(false);
    expect(aceita(esquemaProblema, { ...base, motivo: 'fraca' })).toBe(false);
  });
});
