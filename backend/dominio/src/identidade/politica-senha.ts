import type { MotivoSenha } from '@es/contrato/identidade';

// AUTH-11: política de senha. Copiada de backend/src/identity/domain/password-policy.ts do legado
// (lista local de 124 senhas comuns; nada é enviado a serviço externo). O tamanho é medido na
// senha como digitada; a comparação com a lista e a checagem de caractere repetido usam a forma
// normalizada (NFKC, minúsculas e sem espaços).

export const SENHA_MIN_CARACTERES = 12;
export const SENHA_MAX_CARACTERES = 128;

// prettier-ignore
export const SENHAS_COMUNS: readonly string[] = [
  '123456789012', '1234567890123', 'qwertyuiop12', 'qwertyuiopas', 'qwertyuiopasdf',
  'password1234', 'password12345', 'passw0rd1234', 'senha1234567', 'senha12345678',
  'senhasenhasenha', 'mudar123456', 'mudar1234567', 'administrador', 'administrator',
  'abcdefghijkl', 'abcdefghijklm', 'abc123456789', 'iloveyou1234', 'letmein12345',
  'welcome12345', 'welcome123456', 'changeme1234', 'changeme12345', 'trustno1trustno1',
  '111111111111', '000000000000', 'aaaaaaaaaaaa', 'brasil123456', 'brasilbrasil',
  'evolucaosegura', 'evolucao12345', 'psicologia123', 'fisioterapia1', 'qazwsxedcrfv',
  '1q2w3e4r5t6y', '1qaz2wsx3edc', 'zaq12wsxcde3', 'football12345', 'mynameis12345',
  'passwordpassword', 'admin1234567', 'admin12345678', 'p@ssw0rd1234', 'q1w2e3r4t5y6',
  'senhasegura12', 'minhasenha123', 'minhasenha1234', 'corinthians12', 'flamengo12345',
  'iloveyou12345', 'qwerty123456', 'qwerty1234567', 'abcd12345678', 'password2024!',
  'password2025!', 'password2026!', 'senha@123456', 'brasil@123456', 'mudar@123456',
  'trocar123456', 'ninguem123456', 'qwertyuiop123', '123456789abc', '12345678910111',
  '1234567890123456', '123456789123', '123123123123', '112233445566', '654321654321',
  'asdfghjkl123', 'asdfghjklqwe', 'zxcvbnm12345', 'qwertyasdfgh', '1q2w3e4r5t6y7u',
  'password@123', 'passw0rd@123', 'p@ssw0rd@123', 'admin@123456', 'root12345678',
  'letmein123456', 'welcome@1234', 'iloveyou@123', 'monkey123456', 'dragon123456',
  'master123456', 'superman1234', 'batman123456', 'sunshine1234', 'princess1234',
  'football1234', 'baseball1234', 'starwars1234', 'whatever1234', 'trustno11234',
  'senha@2024', 'senha@2025', 'senha@2026', 'senha123456789', 'senhaforte123',
  'minhasenha@123', 'meunomeE12345', 'amoazul12345', 'te@mo123456', 'teamo1234567',
  'eununcasei123', 'palmeiras123', 'santos1234567', 'gremio1234567', 'saopaulo1234',
  'vasco12345678', 'cruzeiro1234', 'botafogo1234', 'evoluçãosegura',
  'psicologo1234', 'psicologa1234', 'paciente12345', 'terapia123456', 'clinica123456',
  'consultorio1', 'prontuario123', 'saude1234567', 'medico123456', 'hospital12345',
];

const normalizar = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const COMUNS = new Set(SENHAS_COMUNS.map(normalizar));

// Motivo da recusa, ou null se a senha é aceitável.
export function avaliarSenha(senha: string): MotivoSenha | null {
  if (senha.length < SENHA_MIN_CARACTERES) return 'curta';
  if (senha.length > SENHA_MAX_CARACTERES) return 'longa';
  const normalizada = normalizar(senha);
  if (COMUNS.has(normalizada)) return 'comum';
  if (/^(.)\1+$/u.test(normalizada)) return 'comum';
  return null;
}
