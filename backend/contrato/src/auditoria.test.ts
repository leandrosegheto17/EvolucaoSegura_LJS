import { describe, expect, it } from 'vitest';
import {
  ACOES_AUDITORIA,
  ACOES_DO_FILTRO_AUDITORIA,
  ACOES_FORA_DA_TRILHA,
  ALVOS_AUDITORIA,
  LIMITE_PADRAO_AUDITORIA,
  esquemaConsultaAuditoria,
  esquemaEventoAuditoria,
} from './auditoria.ts';

// T31 / AUD-02: o evento de auditoria recusa ação ou alvo fora da lista e chaves extras.
// AUD-01: só nomes de campo, nunca valores. AUD-04: ações novas de acesso, cadastro, assinatura
// e exclusão. A lista vem do legado (audit-event.ts) sem IA, relatório, Google e whitelist.

const U = '6f1c1d6e-2f5b-4a39-9a51-6f0f4b1c2d3e';
const base = { usuarioId: U, ator: U, acao: 'evolucao.retificada', alvoTipo: 'evolucao' };
const aceita = (evento: unknown): boolean => esquemaEventoAuditoria.safeParse(evento).success;

describe('lista de ações', () => {
  it('é a do legado sem IA, relatório, Google e whitelist, mais as novas de AUD-04', () => {
    expect([...ACOES_AUDITORIA].sort()).toEqual(
      [
        // legado mantido
        'evolucao.criada',
        'evolucao.editada_no_dia',
        'evolucao.retificada',
        'evolucao.edicao_recusada',
        'pagamento.registrado',
        'pagamento.corrigido',
        'auth.login_falhou',
        'exportacao.concluida',
        'paciente.consultado',
        'auth.senha_recuperada',
        'auth.senha_redefinida',
        'perfil.editado',
        'configuracao.alterada',
        'sessao.criada',
        'sessao.editada',
        'sessao.status_alterado',
        'serie.criada',
        'serie.editada',
        'serie.cancelada',
        'anamnese.criada',
        'anamnese.editada_no_dia',
        'anamnese.edicao_recusada',
        'anamnese.retificada',
        'preco_paciente.definido',
        'preco_sessao.ajustado',
        'paciente.inativado',
        'paciente.reativado',
        'modelo_anamnese.editado',
        // AUD-04
        'auth.login_ok',
        'auth.logout',
        'conta.cadastrada',
        'assinatura.trial',
        'assinatura.ativa',
        'assinatura.atrasada',
        'assinatura.cancelada',
        'assinatura.free',
        // T128 / PLANO-05: decisão do usuário (2026-10-27).
        'assinatura.solicitada',
        'conta.exclusao_pedida',
        'conta.exclusao_confirmada',
        'conta.exclusao_desistida',
      ].sort(),
    );
  });

  it.each([
    'auth.login_ok',
    'auth.logout',
    'conta.cadastrada',
    'assinatura.trial',
    'assinatura.ativa',
    'assinatura.atrasada',
    'assinatura.cancelada',
    'assinatura.free',
    'assinatura.solicitada',
    'conta.exclusao_pedida',
    'conta.exclusao_confirmada',
    'conta.exclusao_desistida',
  ])('aceita a ação nova %s', (acao) => {
    expect(aceita({ ...base, acao, alvoTipo: 'conta' })).toBe(true);
  });

  it.each([
    'ia.solicitada',
    'paciente.ia_ciencia_marcada',
    'paciente.ia_ciencia_revogada',
    'relatorio.entregue',
    'relatorio.criado',
    'relatorio.editado',
    'relatorio.edicao_recusada',
    'relatorio.copiado',
    'relatorio.revisado',
    'auth.google_negado',
    'usuario.provisionado',
    'whitelist.add',
    'whitelist.remove',
  ])('recusa a ação removida do legado %s', (acao) => {
    expect(aceita({ ...base, acao })).toBe(false);
  });

  it('recusa ação fora da lista', () => {
    expect(aceita({ ...base, acao: 'evolucao.texto_livre' })).toBe(false);
  });
});

describe('lista de alvos', () => {
  it('é a do legado sem relatório e IA', () => {
    expect([...ALVOS_AUDITORIA].sort()).toEqual(
      [
        'evolucao',
        'anamnese',
        'pagamento',
        'paciente',
        'agendamento',
        'perfil',
        'modelo_anamnese',
        'configuracao',
        'conta',
        'exportacao',
        'auth',
      ].sort(),
    );
  });

  it.each(['relatorio', 'ia', 'outro'])('recusa o alvo %s', (alvoTipo) => {
    expect(aceita({ ...base, alvoTipo })).toBe(false);
  });
});

describe('evento', () => {
  it('aceita o evento completo', () => {
    const evento = {
      ...base,
      alvoId: U,
      camposAlterados: ['texto', 'valor_centavos'],
      ip: '203.0.113.77',
      userAgent: 'Mozilla/5.0 (X11)',
    };
    expect(esquemaEventoAuditoria.parse(evento)).toEqual(evento);
  });

  it.each(['sistema', 'admin-cli', U])('aceita o ator %s', (ator) => {
    expect(aceita({ ...base, ator })).toBe(true);
  });

  it('recusa chave extra (conteúdo clínico no evento)', () => {
    expect(aceita({ ...base, texto: 'paciente relata ansiedade' })).toBe(false);
  });

  it.each([
    ['usuarioId inválido', { ...base, usuarioId: 'x' }],
    ['ator inválido', { ...base, ator: 'joao' }],
    ['alvoId inválido', { ...base, alvoId: 'abc' }],
    ['valor em vez de nome de campo', { ...base, camposAlterados: ['Paciente relata dor'] }],
    [
      'mais de 50 campos',
      { ...base, camposAlterados: Array.from({ length: 51 }, (_, i) => `c${i}`) },
    ],
    ['sem ação', { usuarioId: U, ator: U, alvoTipo: 'evolucao' }],
  ])('recusa %s', (_rotulo, evento) => {
    expect(aceita(evento)).toBe(false);
  });

  it('aceita até 50 nomes de campo', () => {
    expect(
      aceita({ ...base, camposAlterados: Array.from({ length: 50 }, (_, i) => `c${i}`) }),
    ).toBe(true);
  });
});

// T118 / AUD-03: consulta da trilha (GET /api/auditoria). Filtro Todos, Retificações ou
// Exportações; páginas de 50 por padrão com cursor (id do último evento da página); visão do
// paciente por paciente_id. Parâmetro desconhecido ou valor inválido = recusa (400 na rota).
describe('consulta da trilha (AUD-03)', () => {
  const consulta = (q: Record<string, string>) => esquemaConsultaAuditoria.safeParse(q);

  it('sem parâmetros: filtro todos, página de 50, sem cursor nem paciente', () => {
    expect(esquemaConsultaAuditoria.parse({})).toEqual({
      filtro: 'todos',
      limit: LIMITE_PADRAO_AUDITORIA,
      cursor: null,
      paciente_id: null,
    });
    expect(LIMITE_PADRAO_AUDITORIA).toBe(50);
  });

  it.each(['todos', 'retificacoes', 'exportacoes'])('aceita o filtro %s', (filtro) => {
    expect(consulta({ filtro }).data?.filtro).toBe(filtro);
  });

  it('aceita cursor, limit e paciente_id', () => {
    expect(consulta({ cursor: '123', limit: '3', paciente_id: U }).data).toEqual({
      filtro: 'todos',
      limit: 3,
      cursor: '123',
      paciente_id: U,
    });
  });

  it.each([
    ['filtro fora da lista', { filtro: 'pagamentos' }],
    ['filtro vazio', { filtro: '' }],
    ['cursor não numérico', { cursor: 'x' }],
    ['cursor negativo', { cursor: '-1' }],
    ['cursor vazio', { cursor: '' }],
    ['cursor com mais de 18 dígitos', { cursor: '1234567890123456789' }],
    ['limit 0', { limit: '0' }],
    ['limit acima de 100', { limit: '101' }],
    ['limit não inteiro', { limit: '2.5' }],
    ['parâmetro desconhecido', { usuario_id: U }],
  ])('recusa %s', (_rotulo, q) => {
    expect(consulta(q).success).toBe(false);
  });

  it('Retificações são as ações *.retificada e Exportações as exportacao.*', () => {
    expect([...ACOES_DO_FILTRO_AUDITORIA.retificacoes].sort()).toEqual([
      'anamnese.retificada',
      'evolucao.retificada',
    ]);
    expect([...ACOES_DO_FILTRO_AUDITORIA.exportacoes]).toEqual(['exportacao.concluida']);
  });

  it('a consulta de ficha fica fora da trilha', () => {
    expect(ACOES_FORA_DA_TRILHA).toEqual(['paciente.consultado']);
  });
});
