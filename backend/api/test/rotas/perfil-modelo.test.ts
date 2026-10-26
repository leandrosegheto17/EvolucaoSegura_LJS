import { esquemaProblema } from '@es/contrato/identidade';
import { PROBLEMA_ESPECIALIDADE_COM_ANAMNESE } from '@es/contrato/perfil';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, pedir, semearPaciente } from './pacientes-apoio.ts';

// T93 / PERF-04, PERF-05, ISO-02: PUT /api/perfil e o modelo de anamnese.
// - PERF-04: definir a especialidade cria o modelo padrão dela (presets do legado): psicologia
//   com 7 campos (um deles o especial "Frequência") e 4 alertas, na revisão 1.
// - PERF-05: trocar a especialidade quando já existe anamnese registrada responde 409
//   SPECIALTY_HAS_ANAMNESIS e nada é salvo. Sem anamnese, a troca vale e cria o modelo da nova.
// - Premissa da spec ("Troca de especialidade", equivalente à desativação do legado, em que o
//   tipo era imutável): trocar é mudar o tipo; o nome de "outra" e o registro profissional
//   continuam editáveis com anamnese.

const especialidade = (tipo: string, extra: Record<string, unknown> = {}) => ({
  tipo,
  nome: tipo === 'outra' ? 'Terapia ocupacional' : null,
  ...extra,
});
const salvar = (sessao: Sessao, tipo: string, extra: Record<string, unknown> = {}) =>
  pedir('PUT', '/api/perfil', sessao, {
    nome: 'Dra. Ana',
    especialidade: especialidade(tipo, extra),
  });

const modelosDe = (usuarioId: string) =>
  comoAdmin<{ id: string; especialidade: string; revisao: number }>(
    'select id, especialidade, revisao from modelo_anamnese where usuario_id = $1 order by criado_em, id',
    [usuarioId],
  );

const itensDe = (modeloId: string) =>
  comoAdmin<{
    tipo: string;
    rotulo: string;
    especial: boolean;
    ordem: number;
    revisao_inclusao: number;
    removido: boolean;
  }>(
    `select tipo, rotulo, especial, ordem, revisao_inclusao, removido
     from modelo_anamnese_item where modelo_id = $1 order by tipo, ordem`,
    [modeloId],
  );

const linhaPerfil = async (usuarioId: string) =>
  (
    await comoAdmin<Record<string, unknown>>(
      `select especialidade, especialidade_nome, conselho, row_version from perfil
       where usuario_id = $1`,
      [usuarioId],
    )
  )[0];

const contarAuditoriaPerfil = async (usuarioId: string) =>
  Number(
    (
      await comoAdmin<{ total: string }>(
        `select count(*)::text as total from audit_log
         where usuario_id = $1 and acao = 'perfil.editado'`,
        [usuarioId],
      )
    )[0]!.total,
  );

// Anamnese registrada direto no banco (a rota de registro é de outra tarefa).
async function semearAnamnese(usuarioId: string): Promise<void> {
  const [modelo] = await modelosDe(usuarioId);
  const pacienteId = await semearPaciente(usuarioId);
  await comoAdmin(
    `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao)
     values ($1, $2, $3, '2026-10-26', 1)`,
    [usuarioId, pacienteId, modelo!.id],
  );
}

describe('definir a especialidade cria o modelo padrão (PERF-04)', () => {
  it('psicologia: modelo na revisão 1 com 7 campos e 4 alertas', async () => {
    const sessao = await sessaoDeTeste();
    expect((await salvar(sessao, 'psicologia')).status).toBe(200);

    const modelos = await modelosDe(sessao.usuarioId);
    expect(modelos.map((m) => [m.especialidade, m.revisao])).toEqual([['psicologia', 1]]);
    const itens = await itensDe(modelos[0]!.id);
    expect(
      itens.filter((i) => i.tipo === 'campo').map((i) => [i.ordem, i.rotulo, i.especial]),
    ).toEqual([
      [0, 'Queixa principal', false],
      [1, 'Hipótese diagnóstica/CID', false],
      [2, 'Abordagem', false],
      [3, 'Frequência', true],
      [4, 'Medicações/psiquiatra', false],
      [5, 'Comorbidades', false],
      [6, 'Histórico de internações e crises', false],
    ]);
    expect(itens.filter((i) => i.tipo === 'alerta').map((i) => [i.ordem, i.rotulo])).toEqual([
      [0, 'Risco de suicídio'],
      [1, 'Automutilação'],
      [2, 'Uso de substâncias'],
      [3, 'Violência doméstica'],
    ]);
    expect(new Set(itens.map((i) => `${i.revisao_inclusao}-${i.removido}`))).toEqual(
      new Set(['1-false']),
    );
  });

  it('outra: modelo só com "Queixa principal" e sem alertas', async () => {
    const sessao = await sessaoDeTeste();
    expect((await salvar(sessao, 'outra')).status).toBe(200);
    const [modelo] = await modelosDe(sessao.usuarioId);
    expect(modelo!.especialidade).toBe('outra');
    expect((await itensDe(modelo!.id)).map((i) => [i.tipo, i.rotulo])).toEqual([
      ['campo', 'Queixa principal'],
    ]);
  });

  it('salvar de novo com a mesma especialidade não cria outro modelo nem duplica itens', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'psicologia');
    expect((await salvar(sessao, 'psicologia', { conselho: 'CRP' })).status).toBe(200);
    const modelos = await modelosDe(sessao.usuarioId);
    expect(modelos).toHaveLength(1);
    expect(await itensDe(modelos[0]!.id)).toHaveLength(11);
  });

  it('perfil salvo sem especialidade não cria modelo', async () => {
    const sessao = await sessaoDeTeste();
    expect((await pedir('PUT', '/api/perfil', sessao, { nome: 'Dra. Ana' })).status).toBe(200);
    expect(await modelosDe(sessao.usuarioId)).toEqual([]);
  });
});

describe('troca de especialidade (PERF-05)', () => {
  it('sem anamnese: a troca vale e cria o modelo da nova especialidade', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'psicologia');
    const resposta = await salvar(sessao, 'nutricao');
    expect(resposta.status).toBe(200);
    expect(
      ((await resposta.json()) as { especialidade: { tipo: string } }).especialidade.tipo,
    ).toBe('nutricao');
    const modelos = await modelosDe(sessao.usuarioId);
    expect(modelos.map((m) => m.especialidade)).toEqual(['psicologia', 'nutricao']);
    const itens = await itensDe(modelos[1]!.id);
    expect([
      itens.filter((i) => i.tipo === 'campo').length,
      itens.filter((i) => i.tipo === 'alerta').length,
    ]).toEqual([11, 4]);
  });

  it('com anamnese registrada: 409 SPECIALTY_HAS_ANAMNESIS e nada é salvo', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'psicologia', { conselho: 'CRP' });
    await semearAnamnese(sessao.usuarioId);
    const perfilAntes = await linhaPerfil(sessao.usuarioId);
    const auditoriaAntes = await contarAuditoriaPerfil(sessao.usuarioId);

    const resposta = await pedir('PUT', '/api/perfil', sessao, {
      nome: 'Outro nome',
      especialidade: especialidade('fisioterapia'),
    });
    expect(resposta.status).toBe(409);
    expect(resposta.headers.get('content-type')).toContain('application/problem+json');
    const corpo = await resposta.json();
    expect(corpo).toEqual(PROBLEMA_ESPECIALIDADE_COM_ANAMNESE);
    expect(corpo).toMatchObject({ status: 409, codigo: 'SPECIALTY_HAS_ANAMNESIS' });
    expect(esquemaProblema.parse(corpo)).toEqual(corpo);

    expect(await linhaPerfil(sessao.usuarioId)).toEqual(perfilAntes);
    expect(await contarAuditoriaPerfil(sessao.usuarioId)).toBe(auditoriaAntes);
    expect((await modelosDe(sessao.usuarioId)).map((m) => m.especialidade)).toEqual(['psicologia']);
  });

  it('com anamnese, manter o tipo e mudar o registro profissional é aceito', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'psicologia', { conselho: 'CRP' });
    await semearAnamnese(sessao.usuarioId);
    const resposta = await salvar(sessao, 'psicologia', { conselho: 'CRP-06' });
    expect(resposta.status).toBe(200);
    expect((await linhaPerfil(sessao.usuarioId))!['conselho']).toBe('CRP-06');
  });

  it('com anamnese, mudar o nome da especialidade "outra" é aceito', async () => {
    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'outra');
    await semearAnamnese(sessao.usuarioId);
    const resposta = await salvar(sessao, 'outra', { nome: 'Musicoterapia' });
    expect(resposta.status).toBe(200);
    expect((await linhaPerfil(sessao.usuarioId))!['especialidade_nome']).toBe('Musicoterapia');
  });

  it('a anamnese de outro profissional não bloqueia a troca (ISO-02)', async () => {
    const outro = await sessaoDeTeste();
    await salvar(outro, 'psicologia');
    await semearAnamnese(outro.usuarioId);

    const sessao = await sessaoDeTeste();
    await salvar(sessao, 'psicologia');
    expect((await salvar(sessao, 'fisioterapia')).status).toBe(200);
    expect((await linhaPerfil(sessao.usuarioId))!['especialidade']).toBe('fisioterapia');
  });
});
