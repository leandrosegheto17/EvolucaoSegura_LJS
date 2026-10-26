import {
  ACOES_FORA_DA_TRILHA,
  FILTROS_AUDITORIA,
  type FiltroAuditoria,
} from '@es/contrato/auditoria';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Empty, Field, Select, Table } from '../../ui';
import { QueryFetchState } from '../../ui/new/QueryFetchState';
import { listarAuditoria } from './api.ts';

// AUD-03: tela de auditoria, portada de features/audit/AuditPage.tsx do legado com o mesmo layout
// (título, aviso de somente leitura, navegação entre as visões, filtro "Tipo", tabela, "Carregar
// mais"). Paciente (?paciente=) e filtro (?filtro=) vivem na URL.
// SPEC_DEVIATION: o legado filtrava só os eventos já carregados e tinha o filtro IA; aqui o filtro
// vai ao servidor (Todos, Retificações, Exportações) e vale nas duas visões, sem o aviso de
// "só o carregado". O legado tinha duas rotas; aqui é uma só, com o paciente na URL.

const ROTULO_FILTRO: Record<FiltroAuditoria, string> = {
  todos: 'Todos os eventos',
  retificacoes: 'Retificações',
  exportacoes: 'Exportações',
};

const ROTULOS: Record<string, string> = {
  'evolucao.criada': 'Evolução registrada',
  'evolucao.editada_no_dia': 'Evolução editada no dia',
  'evolucao.retificada': 'Evolução retificada',
  'evolucao.edicao_recusada': 'Edição de evolução recusada',
  'anamnese.criada': 'Anamnese registrada',
  'anamnese.editada_no_dia': 'Anamnese editada no dia',
  'anamnese.retificada': 'Anamnese retificada',
  'anamnese.edicao_recusada': 'Edição de anamnese recusada',
  'modelo_anamnese.editado': 'Modelo de anamnese editado',
  'exportacao.concluida': 'Exportação concluída',
  'paciente.inativado': 'Paciente inativado',
  'paciente.reativado': 'Paciente reativado',
  'pagamento.registrado': 'Pagamento registrado',
  'pagamento.corrigido': 'Pagamento corrigido',
  'preco_paciente.definido': 'Preço do paciente definido',
  'preco_sessao.ajustado': 'Preço da sessão ajustado',
  'sessao.criada': 'Sessão criada',
  'sessao.editada': 'Sessão editada',
  'sessao.status_alterado': 'Status da sessão alterado',
  'serie.criada': 'Série criada',
  'serie.editada': 'Série editada',
  'serie.cancelada': 'Série cancelada',
  'auth.login_ok': 'Login',
  'auth.login_falhou': 'Falha de login',
  'auth.logout': 'Logout',
  'auth.senha_recuperada': 'Senha recuperada',
  'auth.senha_redefinida': 'Senha redefinida',
  'perfil.editado': 'Alteração do perfil',
  'configuracao.alterada': 'Alteração de configuração',
  'conta.cadastrada': 'Conta cadastrada',
  'conta.exclusao_pedida': 'Exclusão da conta pedida',
  'conta.exclusao_confirmada': 'Exclusão da conta confirmada',
  'conta.exclusao_desistida': 'Exclusão da conta desfeita',
  'assinatura.trial': 'Assinatura em teste',
  'assinatura.ativa': 'Assinatura ativa',
  'assinatura.atrasada': 'Assinatura atrasada',
  'assinatura.cancelada': 'Assinatura cancelada',
  'assinatura.free': 'Assinatura no plano gratuito',
};
const rotulo = (acao: string) => ROTULOS[acao] ?? acao;

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Tom = 'ok' | 'warn' | 'err';
const tom = (acao: string): Tom => {
  if (acao.includes('falhou') || acao.includes('recusada')) return 'err';
  if (acao.includes('retificada')) return 'warn';
  return 'ok';
};

const LINK = 'inline-flex min-h-12 items-center text-pri underline';
const LINK_ATUAL = 'inline-flex min-h-12 items-center font-semibold underline';

export function AuditoriaPage() {
  const [params, setParams] = useSearchParams();
  const bruto = params.get('filtro');
  const filtro: FiltroAuditoria = FILTROS_AUDITORIA.includes(bruto as FiltroAuditoria)
    ? (bruto as FiltroAuditoria)
    : 'todos';
  const paciente = params.get('paciente') || null;
  const porPaciente = paciente !== null;

  const q = useInfiniteQuery({
    queryKey: ['auditoria', paciente, filtro],
    queryFn: ({ pageParam, signal }) => listarAuditoria(paciente, filtro, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.proximo_cursor,
  });
  // Defesa em profundidade: a API já omite paciente.consultado (AUD-03).
  const itens = (q.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (e) => !(ACOES_FORA_DA_TRILHA as readonly string[]).includes(e.acao),
  );

  function trocarFiltro(proximo: FiltroAuditoria) {
    const p = new URLSearchParams();
    if (proximo !== 'todos') p.set('filtro', proximo);
    if (paciente) p.set('paciente', paciente);
    setParams(p);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">
        {porPaciente ? 'Histórico do paciente' : 'Trilha da minha conta'}
      </h1>
      <p className="text-mut">
        Somente leitura: ninguém altera nem apaga estes registros. Guardam o evento, nunca o
        conteúdo clínico.
      </p>
      <nav aria-label="Tipo de histórico" className="flex gap-4">
        <Link to="/app/pacientes" className={LINK}>
          Por paciente
        </Link>
        <Link
          to="/app/auditoria"
          {...(!porPaciente ? { 'aria-current': 'page' as const } : {})}
          className={porPaciente ? LINK : LINK_ATUAL}
        >
          Trilha da minha conta
        </Link>
      </nav>

      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Field label="Tipo">
          {(p) => (
            <Select
              {...p}
              value={filtro}
              onChange={(e) => trocarFiltro(e.target.value as FiltroAuditoria)}
            >
              {FILTROS_AUDITORIA.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FILTRO[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>

      <QueryFetchState
        isPending={q.isPending}
        isError={q.isError}
        errorMessage="Não foi possível carregar o histórico."
        onRetry={() => void q.refetch()}
        skeletonClassName="h-32"
      />
      {q.isSuccess && itens.length === 0 && (
        <Empty
          title={filtro === 'todos' ? 'Nenhum evento registrado' : 'Nenhum evento neste filtro'}
        />
      )}
      {q.isSuccess && itens.length > 0 && (
        <Table
          caption={porPaciente ? 'Eventos do paciente' : 'Eventos da conta'}
          columns={
            porPaciente
              ? ['Data e hora', 'Evento', 'Detalhe']
              : ['Data e hora', 'Ação', 'Origem', 'Resultado']
          }
          rows={itens.map((e) => {
            const detalhe = e.campos_alterados.length
              ? `Campos: ${e.campos_alterados.join(', ')}`
              : '—';
            return porPaciente
              ? [
                  dataHora(e.ocorrido_em),
                  <Badge key="b" tone={tom(e.acao)}>
                    {rotulo(e.acao)}
                  </Badge>,
                  detalhe,
                ]
              : [
                  dataHora(e.ocorrido_em),
                  rotulo(e.acao),
                  e.origem_ip ? `IP ${e.origem_ip}` : '—',
                  e.acao.includes('falhou') ? (
                    <Badge key="r" tone="err">
                      Falha
                    </Badge>
                  ) : (
                    <Badge key="r" tone="ok">
                      Sucesso
                    </Badge>
                  ),
                ];
          })}
        />
      )}
      {q.hasNextPage && (
        <Button
          variant="outline"
          disabled={q.isFetchingNextPage}
          onClick={() => void q.fetchNextPage()}
        >
          Carregar mais
        </Button>
      )}
      {!porPaciente && (
        <p className="text-mut">
          Algo estranho?{' '}
          <Link to="/recuperar" className="text-pri underline">
            Troque sua senha
          </Link>
          .
        </p>
      )}
    </div>
  );
}
