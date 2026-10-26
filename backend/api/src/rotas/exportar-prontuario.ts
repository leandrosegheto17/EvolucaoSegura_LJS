import {
  type AnamneseProntuario,
  type CampoProntuario,
  type ConsultaProntuario,
  type EvolucaoProntuario,
  PROBLEMA_PERIODO_INVALIDO,
  PROBLEMA_PRONTUARIO_NAO_ENCONTRADO,
  type ProfissionalProntuario,
  type Prontuario,
  type VersaoAnamneseProntuario,
  esquemaConsultaProntuario,
} from '@es/contrato/exportacao';
import { versaoVigente } from '@es/dominio/anamnese/valores';
import { Hono } from 'hono';
import { sql } from 'kysely';
import type { Trx } from '../db.ts';
import { type AmbienteAutenticado, autenticada } from '../middleware/autenticada.ts';
import { registrarAuditoria } from '../repositorios/auditoria.ts';
import { idValido } from '../repositorios/pacientes.ts';
import { responderProblemaAgenda as responderProblema } from '../repositorios/sessoes.ts';

// EXP-01, EXP-06, EXP-07, ISO-02: GET /api/pacientes/:id/prontuario?de=&ate=, rota autenticada e
// só de leitura (fora a auditoria). Adaptado de record-export.service.ts do legado: lá a API
// montava o PDF; aqui devolve o JSON e o app monta o PDF no navegador (EXP-02).
// - Id malformado: 404; período inválido: 400 periodo_invalido; paciente inexistente ou de outro
//   profissional: 404, o mesmo do id malformado (ordem do legado). Nenhum dos três audita.
// - Anamnese sempre; evoluções do período pelo dia do cadastro em America/Sao_Paulo, em ordem
//   de cadastro. Cada versão da anamnese traz só os itens que existiam na revisão dela.
// - Servida a exportação, audita exportacao.concluida com alvo paciente, sem conteúdo (EXP-06),
//   na mesma transação da leitura.
// - O limite de exportações (EXP-05) fica para a T122, que inicia a contagem pela exportação
//   completa.
// Além do RLS, toda consulta filtra por usuario_id.

const FUSO = 'America/Sao_Paulo';
const dia = (coluna: string) =>
  sql<string>`to_char(${sql.ref(coluna)} at time zone ${FUSO}, 'YYYY-MM-DD')`;
const iso = (instante: Date) => new Date(instante).toISOString();

const origem = (c: { req: { header: (nome: string) => string | undefined } }) => ({
  ip: c.req.header('CF-Connecting-IP') ?? null,
  userAgent: c.req.header('User-Agent') ?? null,
});

// "conselho número — região", como registroDe do legado; sem conselho e número, null.
const registroDe = (p: {
  conselho: string | null;
  numero_registro: string | null;
  regiao: string | null;
}): string | null => {
  const base = [p.conselho, p.numero_registro].filter(Boolean).join(' ');
  return base ? [base, p.regiao].filter(Boolean).join(' — ') : null;
};

async function profissional(trx: Trx, usuarioId: string): Promise<ProfissionalProntuario | null> {
  const perfil = await trx
    .selectFrom('perfil')
    .select([
      'nome',
      'contato',
      'endereco',
      'especialidade',
      'especialidade_nome',
      'conselho',
      'numero_registro',
      'regiao',
    ])
    .where('usuario_id', '=', usuarioId)
    .executeTakeFirst();
  if (!perfil) return null;
  return {
    nome: perfil.nome,
    contato: perfil.contato,
    endereco: perfil.endereco,
    especialidade: perfil.especialidade,
    especialidade_nome: perfil.especialidade_nome,
    registro: registroDe(perfil),
  };
}

interface Item {
  id: string;
  tipo: 'campo' | 'alerta';
  rotulo: string;
  revisao_inclusao: number;
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// Itens da revisão dada que têm valor, com o rótulo do modelo; item incluído depois não aparece.
function camposDaVersao(itens: Item[], revisao: number, valores: unknown): CampoProntuario[] {
  if (!ehObjeto(valores)) return [];
  const campos: CampoProntuario[] = [];
  for (const item of itens) {
    if (item.revisao_inclusao > revisao) continue;
    const valor = valores[item.id];
    if (item.tipo === 'campo' && typeof valor === 'string')
      campos.push({ item_id: item.id, tipo: 'campo', rotulo: item.rotulo, texto: valor });
    else if (item.tipo === 'alerta' && ehObjeto(valor) && typeof valor['marcado'] === 'boolean')
      campos.push({
        item_id: item.id,
        tipo: 'alerta',
        rotulo: item.rotulo,
        marcado: valor['marcado'],
        obs: typeof valor['obs'] === 'string' ? valor['obs'] : null,
      });
  }
  return campos;
}

async function anamnese(
  trx: Trx,
  usuarioId: string,
  pacienteId: string,
): Promise<AnamneseProntuario | null> {
  const linha = await trx
    .selectFrom('anamnese as a')
    .innerJoin('modelo_anamnese as m', (j) =>
      j.onRef('m.id', '=', 'a.modelo_id').onRef('m.usuario_id', '=', 'a.usuario_id'),
    )
    .select([
      'a.id',
      'a.modelo_id',
      'm.especialidade',
      sql<string>`a.data_sessao::text`.as('data_sessao'),
      'a.modelo_revisao',
      'a.valores',
      'a.criado_em',
      dia('a.criado_em').as('dia'),
    ])
    .where('a.usuario_id', '=', usuarioId)
    .where('a.paciente_id', '=', pacienteId)
    .executeTakeFirst();
  if (!linha) return null;
  // Todos os itens do modelo, também os removidos: o rótulo vale para o valor já gravado.
  const itens: Item[] = await trx
    .selectFrom('modelo_anamnese_item')
    .select(['id', 'tipo', 'rotulo', 'revisao_inclusao'])
    .where('usuario_id', '=', usuarioId)
    .where('modelo_id', '=', linha.modelo_id)
    .orderBy(sql`tipo = 'alerta'`)
    .orderBy('ordem')
    .orderBy('criado_em')
    .orderBy('id')
    .execute();
  const retificacoes = await trx
    .selectFrom('anamnese_retificacao')
    .select(['seq', 'motivo', 'modelo_revisao', 'valores', 'criado_em', dia('criado_em').as('dia')])
    .where('usuario_id', '=', usuarioId)
    .where('anamnese_id', '=', linha.id)
    .orderBy('seq')
    .execute();
  const versao = (v: { modelo_revisao: number; valores: unknown }): VersaoAnamneseProntuario => ({
    modelo_revisao: v.modelo_revisao,
    campos: camposDaVersao(itens, v.modelo_revisao, v.valores),
  });
  const vigente = versaoVigente(
    { modelo_revisao: linha.modelo_revisao, valores: linha.valores },
    retificacoes,
  );
  return {
    id: linha.id,
    especialidade: linha.especialidade,
    data_sessao: linha.data_sessao,
    criado_em: iso(linha.criado_em),
    dia: linha.dia,
    original: versao(linha),
    retificacoes: retificacoes.map((r) => ({
      seq: r.seq,
      motivo: r.motivo,
      criado_em: iso(r.criado_em),
      dia: r.dia,
      ...versao(r),
    })),
    versao_vigente: retificacoes.reduce((maior, r) => Math.max(maior, r.seq), 0),
    vigente: versao(vigente),
  };
}

async function evolucoes(
  trx: Trx,
  usuarioId: string,
  pacienteId: string,
  { de, ate }: ConsultaProntuario,
): Promise<EvolucaoProntuario[]> {
  let busca = trx
    .selectFrom('evolucao')
    .select(['id', 'sessao_id', 'texto', 'criado_em', dia('criado_em').as('dia')])
    .where('usuario_id', '=', usuarioId)
    .where('paciente_id', '=', pacienteId);
  // Do início do dia `de` ao fim do dia `ate`, em America/Sao_Paulo.
  if (de !== null)
    busca = busca.where(sql<boolean>`criado_em >= (${de}::date::timestamp at time zone ${FUSO})`);
  if (ate !== null)
    busca = busca.where(
      sql<boolean>`criado_em < ((${ate}::date + 1)::timestamp at time zone ${FUSO})`,
    );
  const linhas = await busca.orderBy('criado_em').orderBy('id').execute();
  const ids = linhas.map((l) => l.id);
  const retificacoes =
    ids.length === 0
      ? []
      : await trx
          .selectFrom('evolucao_retificacao')
          .select([
            'evolucao_id',
            'seq',
            'texto',
            'motivo',
            'criado_em',
            dia('criado_em').as('dia'),
          ])
          .where('usuario_id', '=', usuarioId)
          .where('evolucao_id', 'in', ids)
          .orderBy('seq')
          .execute();
  return linhas.map((linha) => {
    const dela = retificacoes.filter((r) => r.evolucao_id === linha.id);
    const vigente = dela.at(-1);
    return {
      id: linha.id,
      sessao_id: linha.sessao_id,
      criado_em: iso(linha.criado_em),
      dia: linha.dia,
      texto: linha.texto,
      versao_vigente: vigente?.seq ?? 0,
      texto_vigente: vigente?.texto ?? linha.texto,
      retificacoes: dela.map((r) => ({
        seq: r.seq,
        texto: r.texto,
        motivo: r.motivo,
        criado_em: iso(r.criado_em),
        dia: r.dia,
      })),
    };
  });
}

export const rotasExportarProntuario = new Hono<AmbienteAutenticado>().get(
  '/pacientes/:id/prontuario',
  ...autenticada,
  async (c) => {
    const { trx, usuarioId } = c.var;
    const pacienteId = c.req.param('id');
    if (!idValido(pacienteId)) return responderProblema(c, PROBLEMA_PRONTUARIO_NAO_ENCONTRADO);
    const consulta = esquemaConsultaProntuario.safeParse(c.req.query());
    if (!consulta.success) return responderProblema(c, PROBLEMA_PERIODO_INVALIDO);
    const periodo = consulta.data;
    const paciente = await trx
      .selectFrom('paciente')
      .select(['id', 'nome'])
      .where('usuario_id', '=', usuarioId)
      .where('id', '=', pacienteId)
      .executeTakeFirst();
    if (!paciente) return responderProblema(c, PROBLEMA_PRONTUARIO_NAO_ENCONTRADO);

    const corpo: Prontuario = {
      paciente: { id: paciente.id, nome: paciente.nome },
      periodo,
      profissional: await profissional(trx, usuarioId),
      anamnese: await anamnese(trx, usuarioId, paciente.id),
      evolucoes: await evolucoes(trx, usuarioId, paciente.id, periodo),
    };
    await registrarAuditoria(trx, {
      usuarioId,
      ator: usuarioId,
      acao: 'exportacao.concluida',
      alvoTipo: 'paciente',
      alvoId: paciente.id,
      ...origem(c),
    });
    return c.json(corpo);
  },
);
