import { PROBLEMA_VERSAO_DIVERGENTE } from '@es/contrato/agenda';
import {
  type ModeloAnamnese,
  PROBLEMA_ANAMNESE_NAO_ENCONTRADA,
  PROBLEMA_MODELO_BLOQUEADO,
  PROBLEMA_ROTULO_INVALIDO,
} from '@es/contrato/anamnese';
import { RESPOSTA_LOGIN_RECUSADO, esquemaProblema } from '@es/contrato/identidade';
import { describe, expect, it } from 'vitest';
import { comoAdmin, sessaoDeTeste } from '../apoio.ts';
import { type Sessao, auditoriaDe, pedir, semearPaciente } from './pacientes-apoio.ts';

// T94 / ANA-01, ANA-02, ANA-03, PERF-04, ISO-02: GET e PUT /api/modelo-anamnese.
// - GET devolve o modelo da especialidade do perfil, com os itens vigentes em ordem.
// - PUT troca as listas completas de campos e alertas. Sem anamnese registrada, tudo pode:
//   remover, renomear, reordenar e incluir. Com anamnese (ANA-03), só incluir itens novos em
//   qualquer posição; remover, renomear ou mudar a ordem relativa responde 409 MODEL_LOCKED.
// - ANA-01, ANA-02: 30 campos, 12 alertas, rótulo aparado de 1 a 60 e único sem diferenciar
//   maiúsculas, um só "Frequência": violação = 422 MODEL_LABEL_INVALID, sem ecoar o texto.
// Decisões do usuário (2026-10-26): row_version obrigatório (divergente = 409
// versao_divergente); MODEL_LOCKED como no legado; excesso de itens = MODEL_LABEL_INVALID.

const PSICOLOGIA_CAMPOS = [
  'Queixa principal',
  'Hipótese diagnóstica/CID',
  'Abordagem',
  'Frequência',
  'Medicações/psiquiatra',
  'Comorbidades',
  'Histórico de internações e crises',
];
const PSICOLOGIA_ALERTAS = [
  'Risco de suicídio',
  'Automutilação',
  'Uso de substâncias',
  'Violência doméstica',
];
const SENTINELA = 'SENTINELA-CLINICA';

async function profissional(tipo = 'psicologia'): Promise<Sessao> {
  const sessao = await sessaoDeTeste();
  const resposta = await pedir('PUT', '/api/perfil', sessao, {
    nome: 'Dra. Ana',
    especialidade: { tipo, nome: tipo === 'outra' ? 'Terapia' : null },
  });
  expect(resposta.status).toBe(200);
  return sessao;
}

const ler = async (sessao: Sessao): Promise<ModeloAnamnese> => {
  const resposta = await pedir('GET', '/api/modelo-anamnese', sessao);
  expect(resposta.status).toBe(200);
  return (await resposta.json()) as ModeloAnamnese;
};
const gravar = (sessao: Sessao, corpo: unknown) =>
  pedir('PUT', '/api/modelo-anamnese', sessao, corpo);

// Proposta igual ao modelo lido (cada item com id, rótulo e especial).
type ItemDaProposta = { id?: string; rotulo: string; especial?: 'frequencia' };
const comoProposta = (m: ModeloAnamnese) => ({
  campos: m.campos.map((c): ItemDaProposta => ({ ...c })),
  alertas: m.alertas.map((a): ItemDaProposta => ({ ...a })),
  row_version: m.row_version,
});

const itensNoBanco = (usuarioId: string) =>
  comoAdmin<{
    id: string;
    tipo: string;
    rotulo: string;
    ordem: number;
    removido: boolean;
    revisao_inclusao: number;
  }>(
    `select i.id, i.tipo, i.rotulo, i.ordem, i.removido, i.revisao_inclusao
     from modelo_anamnese_item i where i.usuario_id = $1 order by i.tipo, i.removido, i.ordem`,
    [usuarioId],
  );
const modeloNoBanco = async (usuarioId: string) =>
  (
    await comoAdmin<{ revisao: number; row_version: number }>(
      'select revisao, row_version from modelo_anamnese where usuario_id = $1',
      [usuarioId],
    )
  )[0];

async function registrarAnamnese(usuarioId: string): Promise<void> {
  const [modelo] = await comoAdmin<{ id: string }>(
    'select id from modelo_anamnese where usuario_id = $1',
    [usuarioId],
  );
  const pacienteId = await semearPaciente(usuarioId);
  await comoAdmin(
    `insert into anamnese (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao)
     values ($1, $2, $3, '2026-10-26', 1)`,
    [usuarioId, pacienteId, modelo!.id],
  );
}

async function esperarProblema(resposta: Response, problema: unknown): Promise<unknown> {
  expect(resposta.headers.get('content-type')).toContain('application/problem+json');
  const corpo = await resposta.json();
  expect(corpo).toEqual(problema);
  expect(esquemaProblema.parse(corpo)).toEqual(corpo);
  return corpo;
}

describe('exige sessão', () => {
  it('sem sessão, GET e PUT respondem 401', async () => {
    for (const metodo of ['GET', 'PUT'] as const) {
      const resposta = await pedir(
        metodo,
        '/api/modelo-anamnese',
        null,
        metodo === 'PUT' ? {} : undefined,
      );
      expect(resposta.status, metodo).toBe(401);
      expect(await resposta.json()).toEqual(RESPOSTA_LOGIN_RECUSADO);
    }
  });
});

describe('GET /api/modelo-anamnese', () => {
  it('psicologia: o modelo padrão com 7 campos e 4 alertas, revisão 1, livre', async () => {
    const sessao = await profissional();
    const modelo = await ler(sessao);
    expect(modelo).toMatchObject({
      especialidade: 'psicologia',
      revisao: 1,
      row_version: 1,
      bloqueado: false,
    });
    expect(modelo.campos.map((c) => c.rotulo)).toEqual(PSICOLOGIA_CAMPOS);
    expect(modelo.campos.filter((c) => c.especial === 'frequencia').map((c) => c.rotulo)).toEqual([
      'Frequência',
    ]);
    expect(modelo.alertas.map((a) => a.rotulo)).toEqual(PSICOLOGIA_ALERTAS);
    expect(new Set([...modelo.campos, ...modelo.alertas].map((i) => i.id)).size).toBe(11);
  });

  it('com anamnese registrada, bloqueado = true', async () => {
    const sessao = await profissional();
    await registrarAnamnese(sessao.usuarioId);
    expect((await ler(sessao)).bloqueado).toBe(true);
  });

  it('sem especialidade no perfil: 404', async () => {
    const sessao = await sessaoDeTeste();
    const resposta = await pedir('GET', '/api/modelo-anamnese', sessao);
    expect(resposta.status).toBe(404);
    await esperarProblema(resposta, PROBLEMA_ANAMNESE_NAO_ENCONTRADA);
  });

  it('especialidade definida antes do modelo existir: o padrão é criado na leitura (PERF-04)', async () => {
    const sessao = await sessaoDeTeste();
    await comoAdmin(
      `insert into perfil (usuario_id, nome, especialidade) values ($1, 'Dra. Ana', 'fisioterapia')`,
      [sessao.usuarioId],
    );
    const modelo = await ler(sessao);
    expect([modelo.especialidade, modelo.campos.length, modelo.alertas.length]).toEqual([
      'fisioterapia',
      6,
      6,
    ]);
  });

  it('cada profissional vê só o próprio modelo (ISO-02)', async () => {
    const a = await profissional('psicologia');
    const b = await profissional('nutricao');
    const modeloA = await ler(a);
    const modeloB = await ler(b);
    expect(modeloB.especialidade).toBe('nutricao');
    const idsA = new Set([...modeloA.campos, ...modeloA.alertas].map((i) => i.id));
    expect([...modeloB.campos, ...modeloB.alertas].some((i) => idsA.has(i.id))).toBe(false);
  });
});

describe('PUT sem anamnese: o modelo é livre (ANA-03)', () => {
  it('remove, renomeia, reordena e inclui; sobe a revisão e audita só contagens', async () => {
    const sessao = await profissional();
    const atual = await ler(sessao);
    const [queixa, hipotese, abordagem] = atual.campos;
    const resposta = await gravar(sessao, {
      campos: [
        { id: abordagem!.id, rotulo: 'Linha teórica' },
        { id: queixa!.id, rotulo: queixa!.rotulo },
        { rotulo: `  ${SENTINELA}  ` },
      ],
      alertas: atual.alertas.slice(0, 1),
      row_version: atual.row_version,
    });
    expect(resposta.status).toBe(200);
    const novo = (await resposta.json()) as ModeloAnamnese;
    expect(novo).toMatchObject({ revisao: 2, row_version: 2, bloqueado: false });
    expect(novo.campos.map((c) => c.rotulo)).toEqual([
      'Linha teórica',
      'Queixa principal',
      SENTINELA,
    ]);
    expect(novo.campos.slice(0, 2).map((c) => c.id)).toEqual([abordagem!.id, queixa!.id]);
    expect(novo.alertas.map((a) => a.rotulo)).toEqual(['Risco de suicídio']);
    expect(await ler(sessao)).toEqual(novo);

    const itens = await itensNoBanco(sessao.usuarioId);
    expect(itens.find((i) => i.id === hipotese!.id)).toMatchObject({ removido: true });
    expect(itens.find((i) => i.rotulo === SENTINELA)).toMatchObject({
      revisao_inclusao: 2,
      removido: false,
    });

    const eventos = await auditoriaDe(sessao.usuarioId, 'modelo_anamnese.editado');
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      alvo_tipo: 'modelo_anamnese',
      campos_alterados: ['campos_3', 'alertas_1', 'revisao_2'],
    });
    expect(JSON.stringify(eventos)).not.toContain(SENTINELA);
  });

  it('troca de rótulos entre dois itens e muda o "Frequência" de item', async () => {
    const sessao = await profissional();
    const atual = await ler(sessao);
    const [a, b, , frequencia] = atual.campos;
    const proposta = comoProposta(atual);
    proposta.campos[0] = { id: a!.id, rotulo: b!.rotulo };
    proposta.campos[1] = { id: b!.id, rotulo: a!.rotulo, especial: 'frequencia' };
    proposta.campos[3] = { id: frequencia!.id, rotulo: frequencia!.rotulo };
    const resposta = await gravar(sessao, proposta);
    expect(resposta.status).toBe(200);
    const novo = (await resposta.json()) as ModeloAnamnese;
    expect(novo.campos.slice(0, 2)).toEqual([
      { id: a!.id, rotulo: b!.rotulo },
      { id: b!.id, rotulo: a!.rotulo, especial: 'frequencia' },
    ]);
    expect(novo.campos.filter((c) => c.especial === 'frequencia')).toHaveLength(1);
  });

  it('sem mudança: 200 com o modelo, sem subir a revisão nem auditar', async () => {
    const sessao = await profissional();
    const atual = await ler(sessao);
    const resposta = await gravar(sessao, comoProposta(atual));
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual(atual);
    expect(await modeloNoBanco(sessao.usuarioId)).toEqual({ revisao: 1, row_version: 1 });
    expect(await auditoriaDe(sessao.usuarioId, 'modelo_anamnese.editado')).toEqual([]);
  });
});

describe('PUT com anamnese registrada: só inclusão (ANA-03)', () => {
  it('incluir itens novos no início, no meio e no fim é aceito', async () => {
    const sessao = await profissional();
    await registrarAnamnese(sessao.usuarioId);
    const atual = await ler(sessao);
    const proposta = comoProposta(atual);
    proposta.campos = [
      { rotulo: 'Primeiro' },
      ...proposta.campos.slice(0, 3),
      { rotulo: 'Meio' },
      ...proposta.campos.slice(3),
      { rotulo: 'Último' },
    ];
    proposta.alertas = [{ rotulo: 'Novo alerta' }, ...proposta.alertas];
    const resposta = await gravar(sessao, proposta);
    expect(resposta.status).toBe(200);
    const novo = (await resposta.json()) as ModeloAnamnese;
    expect(novo.campos.map((c) => c.rotulo)).toEqual([
      'Primeiro',
      ...PSICOLOGIA_CAMPOS.slice(0, 3),
      'Meio',
      ...PSICOLOGIA_CAMPOS.slice(3),
      'Último',
    ]);
    expect(novo.alertas.map((a) => a.rotulo)).toEqual(['Novo alerta', ...PSICOLOGIA_ALERTAS]);
    expect(novo).toMatchObject({ revisao: 2, bloqueado: true });
  });

  it.each([
    [
      'remover',
      (p: ReturnType<typeof comoProposta>) => {
        p.campos.splice(1, 1);
      },
    ],
    [
      'renomear (só maiúsculas)',
      (p: ReturnType<typeof comoProposta>) => {
        p.campos[0] = { ...p.campos[0]!, rotulo: p.campos[0]!.rotulo.toUpperCase() };
      },
    ],
    [
      'mudar a ordem relativa',
      (p: ReturnType<typeof comoProposta>) => {
        [p.alertas[0], p.alertas[1]] = [p.alertas[1]!, p.alertas[0]!];
      },
    ],
    [
      'remover e ter rótulo inválido junto (o bloqueio vem primeiro)',
      (p: ReturnType<typeof comoProposta>) => {
        p.alertas.pop();
        p.campos.push({ rotulo: '' });
      },
    ],
  ])('%s responde 409 MODEL_LOCKED e nada muda', async (_rotulo, alterar) => {
    const sessao = await profissional();
    await registrarAnamnese(sessao.usuarioId);
    const atual = await ler(sessao);
    const antes = await itensNoBanco(sessao.usuarioId);
    const proposta = comoProposta(atual);
    alterar(proposta);
    const resposta = await gravar(sessao, proposta);
    expect(resposta.status).toBe(409);
    await esperarProblema(resposta, PROBLEMA_MODELO_BLOQUEADO);
    expect(await itensNoBanco(sessao.usuarioId)).toEqual(antes);
    expect(await modeloNoBanco(sessao.usuarioId)).toEqual({ revisao: 1, row_version: 1 });
  });
});

describe('422 MODEL_LABEL_INVALID (ANA-01, ANA-02)', () => {
  const novos = (n: number, prefixo: string) =>
    Array.from({ length: n }, (_, i) => ({ rotulo: `${prefixo} ${i}` }));

  it.each([
    ['rótulo vazio', { campos: [{ rotulo: '   ' }], alertas: [] }],
    ['rótulo com 61', { campos: [{ rotulo: `${SENTINELA}${'x'.repeat(44)}` }], alertas: [] }],
    [
      'rótulo repetido sem diferenciar maiúsculas',
      { campos: [{ rotulo: SENTINELA }], alertas: [{ rotulo: SENTINELA.toLowerCase() }] },
    ],
    ['31 campos', { campos: novos(31, 'Campo'), alertas: [] }],
    ['13 alertas', { campos: [], alertas: novos(13, 'Alerta') }],
    [
      'dois "Frequência"',
      {
        campos: [
          { rotulo: 'F1', especial: 'frequencia' },
          { rotulo: 'F2', especial: 'frequencia' },
        ],
        alertas: [],
      },
    ],
  ])('%s: 422 sem ecoar o texto e nada muda', async (_rotulo, listas) => {
    const sessao = await profissional();
    const antes = await itensNoBanco(sessao.usuarioId);
    const resposta = await gravar(sessao, { ...listas, row_version: 1 });
    expect(resposta.status).toBe(422);
    const corpo = await esperarProblema(resposta, PROBLEMA_ROTULO_INVALIDO);
    expect(JSON.stringify(corpo).toLowerCase()).not.toContain('sentinela');
    expect(await itensNoBanco(sessao.usuarioId)).toEqual(antes);
  });

  it('30 campos e 12 alertas no limite são aceitos', async () => {
    const sessao = await profissional();
    const resposta = await gravar(sessao, {
      campos: novos(30, 'Campo'),
      alertas: novos(12, 'Alerta'),
      row_version: 1,
    });
    expect(resposta.status).toBe(200);
    const novo = (await resposta.json()) as ModeloAnamnese;
    expect([novo.campos.length, novo.alertas.length]).toEqual([30, 12]);
  });

  it('id de item de outro profissional é desconhecido: 422 e o modelo dele fica intacto (ISO-02)', async () => {
    const outro = await profissional();
    const itemDoOutro = (await ler(outro)).campos[0]!;
    const sessao = await profissional();
    const resposta = await gravar(sessao, {
      campos: [{ id: itemDoOutro.id, rotulo: 'Tomado' }],
      alertas: [],
      row_version: 1,
    });
    expect(resposta.status).toBe(422);
    await esperarProblema(resposta, PROBLEMA_ROTULO_INVALIDO);
    expect((await ler(outro)).campos[0]).toEqual(itemDoOutro);
  });
});

describe('concorrência (decisão do usuário: row_version)', () => {
  it('row_version diferente do atual: 409 versao_divergente sem gravar', async () => {
    const sessao = await profissional();
    const atual = await ler(sessao);
    const proposta = { ...comoProposta(atual), row_version: atual.row_version + 1 };
    proposta.campos.push({ rotulo: 'Novo' });
    const resposta = await gravar(sessao, proposta);
    expect(resposta.status).toBe(409);
    await esperarProblema(resposta, PROBLEMA_VERSAO_DIVERGENTE);
    expect(await modeloNoBanco(sessao.usuarioId)).toEqual({ revisao: 1, row_version: 1 });
  });

  it('sem row_version: 422 validacao', async () => {
    const sessao = await profissional();
    const atual = await ler(sessao);
    const semVersao: Partial<ReturnType<typeof comoProposta>> = comoProposta(atual);
    delete semVersao.row_version;
    const resposta = await gravar(sessao, semVersao);
    expect(resposta.status).toBe(422);
    expect(await resposta.json()).toMatchObject({ codigo: 'validacao', campos: ['row_version'] });
  });
});
