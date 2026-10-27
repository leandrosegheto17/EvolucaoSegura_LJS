import { describe, expect, it } from 'vitest';
import { esquemaAssinarEntrada } from './plano.ts';

// T128 / PLANO-05: assinar pede nome e CPF/CNPJ validado pelo dígito verificador antes de chamar
// o Asaas. Documento inválido, nome vazio ou campo extra são recusados (a rota responde 422).

const ler = (corpo: unknown) => esquemaAssinarEntrada.safeParse(corpo);

describe('CPF/CNPJ pelo dígito verificador', () => {
  it.each([
    ['12345678909', '12345678909'],
    ['529.982.247-25', '52998224725'],
    ['11222333000181', '11222333000181'],
    ['11.222.333/0001-81', '11222333000181'],
    // CNPJ alfanumérico (exemplo da Receita Federal).
    ['12.ABC.345/01DE-35', '12ABC34501DE35'],
  ])('aceita %s e normaliza para %s', (entrada, normalizado) => {
    const r = ler({ nome: 'Ana Souza', cpf_cnpj: entrada });
    expect(r.success && r.data.cpf_cnpj).toBe(normalizado);
  });

  it.each([
    '12345678900', // dígito errado
    '52998224724',
    '11111111111', // repetido
    '1234567890', // 10 dígitos
    '11222333000180',
    '00000000000000',
    '12ABC34501DE34',
    '1234567890A', // letra em CPF
    '',
  ])('recusa %j', (entrada) => {
    expect(ler({ nome: 'Ana Souza', cpf_cnpj: entrada }).success).toBe(false);
  });
});

describe('corpo', () => {
  it('apara o nome e recusa nome vazio, campo ausente e campo extra', () => {
    const r = ler({ nome: '  Ana Souza ', cpf_cnpj: '12345678909' });
    expect(r.success && r.data).toEqual({ nome: 'Ana Souza', cpf_cnpj: '12345678909' });
    expect(ler({ nome: '  ', cpf_cnpj: '12345678909' }).success).toBe(false);
    expect(ler({ nome: 'Ana Souza' }).success).toBe(false);
    expect(ler({ nome: 'Ana', cpf_cnpj: '12345678909', plano: 'pro' }).success).toBe(false);
  });
});
