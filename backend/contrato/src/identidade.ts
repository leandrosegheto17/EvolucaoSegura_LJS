import { z } from 'zod';

// CAD-01, AUTH-01 a AUTH-15: contrato das rotas públicas de identidade (cadastro, confirmação,
// entrar, 2FA e recuperação). Todo corpo é estrito: chave desconhecida é recusada. A política de
// senha (AUTH-11) fica no domínio (backend/dominio/src/identidade/politica-senha.ts); aqui a senha
// nova é só texto, para a rota responder 422 `senha_fora_da_politica` com o motivo. O token de
// e-mail também é só texto: token malformado é "link inválido" (400), nunca erro de validação.

// E-mail aparado e em minúsculas antes de validar: é a chave da conta.
export const esquemaEmail = z.string().trim().toLowerCase().max(254).pipe(z.email());

const senhaInformada = z.string().min(1).max(256);
const token = z.string().max(512);

export const esquemaCadastro = z.strictObject({
  nome: z.string().trim().min(1).max(200),
  email: esquemaEmail,
  senha: z.string(),
  aceite_termos: z.literal(true),
});
export type Cadastro = z.infer<typeof esquemaCadastro>;

// CAD-01, CAD-02, CAD-06, CAD-08: o mesmo 202 e o mesmo corpo para e-mail novo, confirmado ou
// pendente, e também quando o envio do e-mail falha.
export const RESPOSTA_CADASTRO = { status: 'aceito' } as const;

export const esquemaConfirmarEmail = z.strictObject({ token });

export const esquemaEntrar = z.strictObject({ email: esquemaEmail, senha: senhaInformada });
export const RESPOSTA_ENTRAR = { status: '2fa_required' } as const;

export const esquemaVerificar2fa = z.strictObject({
  email: esquemaEmail,
  codigo: z.string().regex(/^\d{6}$/),
});
export const esquemaReenviar2fa = z.strictObject({ email: esquemaEmail });

export const esquemaPedirRecuperacao = z.strictObject({ email: esquemaEmail });
export const esquemaConfirmarRecuperacao = z.strictObject({ token, nova_senha: z.string() });

// AUTH-11
export const MOTIVOS_SENHA = ['curta', 'longa', 'comum'] as const;
export type MotivoSenha = (typeof MOTIVOS_SENHA)[number];

// Códigos de erro das rotas de identidade e o status HTTP de cada um.
export const CODIGOS_ERRO_IDENTIDADE = [
  { codigo: 'validacao', status: 422 },
  { codigo: 'senha_fora_da_politica', status: 422 },
  { codigo: 'link_invalido', status: 400 },
  // AUTH-02, CAD-09: um só código para senha errada, e-mail inexistente, conta não confirmada ou
  // bloqueada para exclusão.
  { codigo: 'credenciais_invalidas', status: 401 },
  { codigo: 'csrf_invalido', status: 403 },
  { codigo: 'muitas_tentativas', status: 429 },
  { codigo: 'mail_unavailable', status: 503 },
] as const;
export type CodigoErroIdentidade = (typeof CODIGOS_ERRO_IDENTIDADE)[number]['codigo'];

// Corpo application/problem+json do projeto (mesmas chaves do 500 de app.ts), sem eco de dado.
export const esquemaProblema = z.strictObject({
  tipo: z.literal('about:blank'),
  titulo: z.string(),
  status: z.number().int().min(400).max(599),
  codigo: z.string().regex(/^[a-z0-9_]+$/),
  motivo: z.enum(MOTIVOS_SENHA).optional(),
  campos: z.array(z.string()).optional(),
});
export type Problema = z.infer<typeof esquemaProblema>;

export function problema(
  codigo: CodigoErroIdentidade,
  titulo: string,
  extra: Pick<Problema, 'motivo' | 'campos'> = {},
): Problema {
  const { status } = CODIGOS_ERRO_IDENTIDADE.find((c) => c.codigo === codigo)!;
  return { tipo: 'about:blank', titulo, status, codigo, ...extra };
}

// AUTH-02: corpo único do 401 de login, igual para todos os motivos.
export const RESPOSTA_LOGIN_RECUSADO: Problema = problema(
  'credenciais_invalidas',
  'Não autorizado',
);
