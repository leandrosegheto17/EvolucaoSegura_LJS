import { describe, expect, it } from 'vitest';
import { esquemaProblema } from './identidade.ts';
import {
  PROBLEMA_CONSULTA_INVALIDA,
  PROBLEMA_PACIENTE_NAO_ENCONTRADO,
  esquemaListagemPacientes,
  esquemaPacienteEntrada,
  esquemaTcleEntrada,
} from './pacientes.ts';
import { PROBLEMA_PERFIL_NAO_ENCONTRADO } from './perfil.ts';

// T68 / PAC-01, PAC-02, PAC-05: contrato de pacientes nos dois lados de cada limite. Paciente:
// nome aparado de 1 a 200 (obrigatório), telefone até 40, e-mail até 254 no formato x@y sem
// espaços, endereço até 500, vazio vira null e campo extra é recusado. Listagem: q (nome),
// ativo true/false, limit de 1 a 100 (padrão 50) e offset >= 0. TCLE: finalidade de 1 a 500,
// versão de 1 a 50 e data YYYY-MM-DD de calendário. Os casos do domínio do legado
// (backend/test/patients.spec.ts e domain/consent.ts) vêm junto.

const paciente = (corpo: unknown) => esquemaPacienteEntrada.safeParse(corpo).success;
const listagem = (consulta: unknown) => esquemaListagemPacientes.safeParse(consulta).success;
const tcle = (corpo: unknown) => esquemaTcleEntrada.safeParse(corpo).success;

describe('paciente (PAC-01)', () => {
  it('só o nome é obrigatório; apara e grava vazio como null (legado)', () => {
    expect(esquemaPacienteEntrada.parse({ nome: ' Ana ', telefone: ' ' })).toEqual({
      nome: 'Ana',
      telefone: null,
      email: null,
      endereco: null,
    });
    expect(
      esquemaPacienteEntrada.parse({ nome: 'Ana', telefone: '', email: '  ', endereco: null }),
    ).toEqual({ nome: 'Ana', telefone: null, email: null, endereco: null });
  });

  it('nome de 1 a 200 depois de aparado', () => {
    expect(paciente({ nome: 'x' })).toBe(true);
    expect(paciente({ nome: 'x'.repeat(200) })).toBe(true);
    expect(paciente({ nome: ` ${'x'.repeat(200)} ` })).toBe(true);
    expect(paciente({ nome: 'x'.repeat(201) })).toBe(false);
    expect(paciente({ nome: '   ' })).toBe(false);
    expect(paciente({ telefone: '1' })).toBe(false);
    expect(paciente({ nome: null })).toBe(false);
  });

  it('telefone até 40, e-mail até 254 e endereço até 500', () => {
    const email254 = `${'x'.repeat(250)}@a.b`;
    expect(
      paciente({ nome: 'A', telefone: 'x'.repeat(40), email: email254, endereco: 'x'.repeat(500) }),
    ).toBe(true);
    expect(paciente({ nome: 'A', telefone: 'x'.repeat(41) })).toBe(false);
    expect(paciente({ nome: 'A', email: `x${email254}` })).toBe(false);
    expect(paciente({ nome: 'A', endereco: 'x'.repeat(501) })).toBe(false);
  });

  it('e-mail no formato x@y, sem espaços', () => {
    expect(esquemaPacienteEntrada.parse({ nome: 'A', email: ' a@b ' }).email).toBe('a@b');
    expect(paciente({ nome: 'A', email: 'x' })).toBe(false);
    expect(paciente({ nome: 'A', email: 'a b@c' })).toBe(false);
    expect(paciente({ nome: 'A', email: '@c' })).toBe(false);
    expect(paciente({ nome: 'A', email: 'a@' })).toBe(false);
    expect(paciente({ nome: 'A', email: 'a@b@c' })).toBe(false);
  });

  it('campo extra recusado (ativo, usuario_id, ia_ciencia_em)', () => {
    expect(paciente({ nome: 'A', ativo: false })).toBe(false);
    expect(paciente({ nome: 'A', usuario_id: '11111111-1111-4111-8111-111111111111' })).toBe(false);
    expect(paciente({ nome: 'A', ia_ciencia_em: null })).toBe(false);
  });

  it('tipos errados recusados', () => {
    expect(paciente({ nome: 5 })).toBe(false);
    expect(paciente({ nome: 'A', telefone: 11 })).toBe(false);
  });
});

describe('listagem (PAC-02)', () => {
  it('padrão: sem busca, sem filtro, limit 50 e offset 0', () => {
    expect(esquemaListagemPacientes.parse({})).toEqual({
      q: null,
      ativo: null,
      limit: 50,
      offset: 0,
    });
  });

  it('q aparado; vazio vira null', () => {
    expect(esquemaListagemPacientes.parse({ q: '  ana ' }).q).toBe('ana');
    expect(esquemaListagemPacientes.parse({ q: '   ' }).q).toBeNull();
  });

  it('ativo só true ou false', () => {
    expect(esquemaListagemPacientes.parse({ ativo: 'true' }).ativo).toBe(true);
    expect(esquemaListagemPacientes.parse({ ativo: 'false' }).ativo).toBe(false);
    for (const valor of ['x', '1', '0', 'TRUE', '', 'sim'])
      expect(listagem({ ativo: valor }), valor).toBe(false);
  });

  it('limit de 1 a 100, inteiro', () => {
    expect(esquemaListagemPacientes.parse({ limit: '1' }).limit).toBe(1);
    expect(esquemaListagemPacientes.parse({ limit: '100' }).limit).toBe(100);
    for (const valor of ['0', '101', '-1', '1.5', 'abc', '', '1e2'])
      expect(listagem({ limit: valor }), valor).toBe(false);
  });

  it('offset inteiro >= 0', () => {
    expect(esquemaListagemPacientes.parse({ offset: '0' }).offset).toBe(0);
    expect(esquemaListagemPacientes.parse({ offset: '250' }).offset).toBe(250);
    for (const valor of ['-1', '1.5', 'abc', ''])
      expect(listagem({ offset: valor }), valor).toBe(false);
  });
});

describe('TCLE (PAC-05)', () => {
  const valido = { finalidade: 'Atendimento psicológico', data: '2026-10-01', versao: 'v1' };

  it('aceita o registro válido, aparado', () => {
    expect(
      esquemaTcleEntrada.parse({ finalidade: ' Atendimento ', data: '2026-10-01', versao: ' v1 ' }),
    ).toEqual({ finalidade: 'Atendimento', data: '2026-10-01', versao: 'v1' });
  });

  it('finalidade de 1 a 500', () => {
    expect(tcle({ ...valido, finalidade: 'x' })).toBe(true);
    expect(tcle({ ...valido, finalidade: 'x'.repeat(500) })).toBe(true);
    expect(tcle({ ...valido, finalidade: 'x'.repeat(501) })).toBe(false);
    expect(tcle({ ...valido, finalidade: '  ' })).toBe(false);
  });

  it('versão de 1 a 50', () => {
    expect(tcle({ ...valido, versao: 'x' })).toBe(true);
    expect(tcle({ ...valido, versao: 'x'.repeat(50) })).toBe(true);
    expect(tcle({ ...valido, versao: 'x'.repeat(51) })).toBe(false);
    expect(tcle({ ...valido, versao: '' })).toBe(false);
  });

  it('data YYYY-MM-DD e de calendário', () => {
    expect(tcle({ ...valido, data: '2024-02-29' })).toBe(true);
    for (const data of [
      '2026-02-29',
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2026-1-01',
      '01/10/2026',
      '2026-10-01T00:00:00Z',
      '',
    ])
      expect(tcle({ ...valido, data }), data).toBe(false);
  });

  it('todos os campos obrigatórios e campo extra recusado', () => {
    expect(tcle({ finalidade: 'x', data: '2026-10-01' })).toBe(false);
    expect(tcle({ ...valido, paciente_id: '11111111-1111-4111-8111-111111111111' })).toBe(false);
  });
});

describe('problemas', () => {
  it('404 do paciente idêntico ao de qualquer recurso inexistente', () => {
    expect(esquemaProblema.parse(PROBLEMA_PACIENTE_NAO_ENCONTRADO)).toEqual(
      PROBLEMA_PERFIL_NAO_ENCONTRADO,
    );
  });

  it('consulta inválida responde 400', () => {
    expect(esquemaProblema.parse(PROBLEMA_CONSULTA_INVALIDA)).toMatchObject({ status: 400 });
  });
});
