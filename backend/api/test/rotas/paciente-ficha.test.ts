import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_PACIENTE_NAO_ENCONTRADO } from '@es/contrato/pacientes';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { auditoriaDe, pedir, type Sessao, semearPaciente } from './pacientes-apoio.ts';

// T72 / PAC-06, ISO-02: GET /api/pacientes/:id abre a ficha e cada abertura audita
// paciente.consultado (alvo paciente, sem campos nem conteúdo), na mesma transação. Paciente de
// outro profissional, inexistente ou com id malformado: o mesmo 404, sem auditar. A listagem não
// audita. Casos do T-030 do legado (backend/test/patients.spec.ts) vêm junto.

const abrir = (sessao: Sessao | null, id: string) => pedir('GET', `/api/pacientes/${id}`, sessao);

const consultasDe = (usuarioId: string) => auditoriaDe(usuarioId, 'paciente.consultado');

describe('abrir a ficha (PAC-06)', () => {
  it('sem sessão responde 401 e não audita', async () => {
    const dono = await sessaoDeTeste();
    const id = await semearPaciente(dono.usuarioId);

    const resposta = await abrir(null, id);

    expect(resposta.status).toBe(401);
    expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    expect(await consultasDe(dono.usuarioId)).toEqual([]);
  });

  it('devolve o paciente e audita paciente.consultado sem conteúdo', async () => {
    const sessao = await sessaoDeTeste();
    const [linha] = await comoAdmin<{ id: string }>(
      `insert into paciente (usuario_id, nome, telefone, email, endereco)
       values ($1, 'Maria Silva', '11 9999', 'm@x.com', 'Rua A, 1') returning id`,
      [sessao.usuarioId],
    );
    const id = linha!.id;

    const resposta = await abrir(sessao, id);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      id,
      nome: 'Maria Silva',
      telefone: '11 9999',
      email: 'm@x.com',
      endereco: 'Rua A, 1',
      ativo: true,
      row_version: 1,
      criado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(await consultasDe(sessao.usuarioId)).toEqual([
      {
        usuario_id: sessao.usuarioId,
        ator: sessao.usuarioId,
        acao: 'paciente.consultado',
        alvo_tipo: 'paciente',
        alvo_id: id,
        campos_alterados: [],
        origem_ua: 'Mozilla/5',
      },
    ]);
  });

  it('cada abertura grava a sua auditoria, inclusive de paciente inativo', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId, { ativo: false });

    for (let vez = 0; vez < 3; vez += 1) expect((await abrir(sessao, id)).status).toBe(200);

    expect(await consultasDe(sessao.usuarioId)).toHaveLength(3);
  });

  it('listar não audita paciente.consultado', async () => {
    const sessao = await sessaoDeTeste();
    await semearPaciente(sessao.usuarioId);

    await pedir('GET', '/api/pacientes', sessao);

    expect(await consultasDe(sessao.usuarioId)).toEqual([]);
  });
});

describe('isolamento (ISO-02)', () => {
  it('paciente de outro profissional: o mesmo 404 do inexistente e sem auditar', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const id = await semearPaciente(a.usuarioId);

    for (const alvo of [id, crypto.randomUUID(), 'nao-e-uuid']) {
      const resposta = await abrir(b, alvo);
      expect(resposta.status, alvo).toBe(404);
      expect(resposta.headers.get('content-type')).toContain('application/problem+json');
      expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_NAO_ENCONTRADO);
    }
    expect(await consultasDe(a.usuarioId)).toEqual([]);
    expect(await consultasDe(b.usuarioId)).toEqual([]);
  });
});
