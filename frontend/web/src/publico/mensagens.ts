import type { MotivoSenha } from '@es/contrato/identidade';

// Textos de tela para os códigos de erro do contrato (backend/contrato/src/identidade.ts).

// AUTH-11: motivo do 422 senha_fora_da_politica.
export const MENSAGEM_MOTIVO_SENHA: Record<MotivoSenha, string> = {
  curta: 'A senha precisa ter pelo menos 12 caracteres.',
  longa: 'A senha pode ter no máximo 128 caracteres.',
  comum: 'Essa senha é comum ou fácil de adivinhar. Escolha outra.',
};

export const MENSAGEM_MUITAS_TENTATIVAS =
  'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.';

export const MENSAGEM_ERRO_GENERICO = 'Não foi possível concluir agora. Tente novamente.';

// CAD-05, AUTH-15: 400 link_invalido.
export const MENSAGEM_LINK_INVALIDO = 'Este link é inválido, expirou ou já foi usado.';
