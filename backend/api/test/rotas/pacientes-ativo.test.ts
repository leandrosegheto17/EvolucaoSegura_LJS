import { RESPOSTA_LOGIN_RECUSADO } from '@es/contrato/identidade';
import { PROBLEMA_PACIENTE_NAO_ENCONTRADO } from '@es/contrato/pacientes';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { comoAdmin, ipUnico, sessaoDeTeste } from '../apoio.ts';
import {
  app,
  auditoriaDe,
  linhaPaciente,
  pedir,
  type Sessao,
  semearPaciente,
} from './pacientes-apoio.ts';

// T70 / PAC-03, PAC-04, ISO-02: POST /api/pacientes/:id/inativar e /reativar. Só o flag `ativo`
// muda (com row_version), sem tocar em nenhum outro dado do profissional (prontuário, sessões
// futuras), e a troca audita paciente.inativado ou paciente.reativado, só com o nome do campo.
// Pedir o estado que o paciente já tem responde sucesso sem subir row_version nem auditar.
// Paciente de outro profissional, inexistente ou com id malformado: o mesmo 404, sem auditar.

const trocar = (sessao: Sessao, id: string, acao: 'inativar' | 'reativar') =>
  pedir('POST', `/api/pacientes/${id}/${acao}`, sessao);

// Retrato de todas as linhas do profissional em cada tabela de negócio (com usuario_id e RLS
// forçada, lida pelo catálogo, então inclui as tabelas de agenda e prontuário quando existirem),
// fora a auditoria e o próprio paciente. As tabelas de identidade (sessão etc.) ficam de fora.
// Serve para provar que a troca do flag não mexe em mais nada.
async function retratoDoResto(usuarioId: string): Promise<Record<string, string>> {
  const tabelas = await comoAdmin<{ tabela: string }>(
    `select c.relname as tabela from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = c.oid and a.attname = 'usuario_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity
       and c.relname not in ('audit_log', 'paciente')
     order by 1`,
  );
  const retrato: Record<string, string> = {};
  for (const { tabela } of tabelas) {
    const [linha] = await comoAdmin<{ md5: string | null }>(
      `select md5(string_agg(t::text, '|' order by t::text)) as md5
       from public.${tabela} t where usuario_id = $1`,
      [usuarioId],
    );
    retrato[tabela] = linha!.md5 ?? 'vazia';
  }
  return retrato;
}

describe('exigem sessão e CSRF', () => {
  it('sem sessão responde 401', async () => {
    const dono = await sessaoDeTeste();
    const id = await semearPaciente(dono.usuarioId);
    for (const acao of ['inativar', 'reativar']) {
      const resposta = await pedir('POST', `/api/pacientes/${id}/${acao}`, null);
      expect(resposta.status, acao).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
    expect(await linhaPaciente(id)).toMatchObject({ ativo: true, row_version: 1 });
  });

  it('sem x-csrf-token responde 403 e nada muda', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    const resposta = await app.request(
      `/api/pacientes/${id}/inativar`,
      { method: 'POST', headers: { 'CF-Connecting-IP': ipUnico(), cookie: sessao.cookie } },
      env,
    );
    expect(resposta.status).toBe(403);
    expect(await linhaPaciente(id)).toMatchObject({ ativo: true, row_version: 1 });
  });
});

describe('inativar e reativar (PAC-03)', () => {
  it('inativar troca só o flag, sobe row_version e audita paciente.inativado', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId, { nome: 'Maria Silva' });
    const antes = await linhaPaciente(id);

    const resposta = await trocar(sessao, id, 'inativar');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({
      id,
      nome: 'Maria Silva',
      ativo: false,
      row_version: 2,
    });
    expect(await linhaPaciente(id)).toMatchObject({
      ...antes,
      ativo: false,
      row_version: 2,
      atualizado_em: expect.any(Date),
    });
    expect(await auditoriaDe(sessao.usuarioId, 'paciente.inativado')).toEqual([
      {
        usuario_id: sessao.usuarioId,
        ator: sessao.usuarioId,
        acao: 'paciente.inativado',
        alvo_tipo: 'paciente',
        alvo_id: id,
        campos_alterados: ['ativo'],
        origem_ua: 'Mozilla/5',
      },
    ]);
  });

  it('reativar volta o flag, sobe row_version e audita paciente.reativado', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId, { ativo: false });

    const resposta = await trocar(sessao, id, 'reativar');

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ id, ativo: true, row_version: 2 });
    expect(await linhaPaciente(id)).toMatchObject({ ativo: true, row_version: 2 });
    expect(await auditoriaDe(sessao.usuarioId, 'paciente.reativado')).toEqual([
      expect.objectContaining({
        acao: 'paciente.reativado',
        alvo_tipo: 'paciente',
        alvo_id: id,
        campos_alterados: ['ativo'],
      }),
    ]);
    expect(await auditoriaDe(sessao.usuarioId, 'paciente.inativado')).toEqual([]);
  });

  it('o paciente inativado sai da lista de ativos e aparece na de inativos', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId, { nome: 'Joana' });

    await trocar(sessao, id, 'inativar');

    const lista = async (ativo: string) =>
      (
        (await (await pedir('GET', `/api/pacientes?ativo=${ativo}`, sessao)).json()) as {
          items: { id: string }[];
        }
      ).items.map((p) => p.id);
    expect(await lista('true')).toEqual([]);
    expect(await lista('false')).toEqual([id]);
  });

  it('não toca em nenhum outro dado do profissional (prontuário, sessões futuras)', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);
    await pedir('PUT', '/api/perfil', sessao, {
      nome: 'Dra. Ana',
      especialidade: { tipo: 'psicologia' },
    });
    await comoAdmin(
      `insert into consentimento_tcle (usuario_id, paciente_id, finalidade, data_consentimento,
         versao_termo) values ($1, $2, 'Atendimento', '2026-10-01', 'v1')`,
      [sessao.usuarioId, id],
    );
    const antes = await retratoDoResto(sessao.usuarioId);

    await trocar(sessao, id, 'inativar');
    await trocar(sessao, id, 'reativar');

    expect(await retratoDoResto(sessao.usuarioId)).toEqual(antes);
  });
});

describe('repetir o mesmo estado (PAC-04)', () => {
  it.each([
    ['inativar', false],
    ['reativar', true],
  ] as const)(
    '%s quando já está assim responde 200 sem subir row_version nem auditar',
    async (acao, ativo) => {
      const sessao = await sessaoDeTeste();
      const id = await semearPaciente(sessao.usuarioId, { ativo });
      const antes = await linhaPaciente(id);

      const resposta = await trocar(sessao, id, acao);

      expect(resposta.status).toBe(200);
      expect(await resposta.json()).toMatchObject({ id, ativo, row_version: 1 });
      expect(await linhaPaciente(id)).toEqual(antes);
      const evento = acao === 'inativar' ? 'paciente.inativado' : 'paciente.reativado';
      expect(await auditoriaDe(sessao.usuarioId, evento)).toEqual([]);
    },
  );

  it('inativar duas vezes audita uma só e row_version sobe uma só', async () => {
    const sessao = await sessaoDeTeste();
    const id = await semearPaciente(sessao.usuarioId);

    await trocar(sessao, id, 'inativar');
    await trocar(sessao, id, 'inativar');

    expect(await linhaPaciente(id)).toMatchObject({ ativo: false, row_version: 2 });
    expect(await auditoriaDe(sessao.usuarioId, 'paciente.inativado')).toHaveLength(1);
  });
});

describe('isolamento (ISO-02)', () => {
  it('paciente de outro profissional: o mesmo 404 do inexistente, nada muda nem é auditado', async () => {
    const a = await sessaoDeTeste();
    const b = await sessaoDeTeste();
    const id = await semearPaciente(a.usuarioId);

    for (const acao of ['inativar', 'reativar'] as const) {
      const deA = await trocar(b, id, acao);
      const inexistente = await trocar(b, crypto.randomUUID(), acao);
      const malformado = await trocar(b, 'nao-e-uuid', acao);
      for (const resposta of [deA, inexistente, malformado]) {
        expect(resposta.status, acao).toBe(404);
        expect(resposta.headers.get('content-type')).toContain('application/problem+json');
        expect(await resposta.json()).toEqual(PROBLEMA_PACIENTE_NAO_ENCONTRADO);
      }
    }
    expect(await linhaPaciente(id)).toMatchObject({ ativo: true, row_version: 1 });
    for (const sessao of [a, b])
      for (const evento of ['paciente.inativado', 'paciente.reativado'])
        expect(await auditoriaDe(sessao.usuarioId, evento)).toEqual([]);
  });
});
