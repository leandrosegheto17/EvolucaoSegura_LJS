import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Badge, Button, Empty, Field, Select, Table } from '../../ui';
import { QueryFetchState } from '../../ui/new/QueryFetchState';
import { type FiltroDebitos, listarDebitos, lerPendencias } from './api.ts';

// FIN-07: tela de financeiro, portada de billing/debts/DebtsPage.tsx do legado com o mesmo
// layout (título, filtro "Situação financeira", tabela com situação, sessões e valor pendente,
// seção "Sessões pendentes" do paciente). Filtro (?status=) e paciente aberto (?paciente=) vivem
// na URL. Valores chegam em centavos (ADR-007) e são formatados em reais aqui.
// SPEC_DEVIATION: o legado tinha o modo privacidade (iniciais) e o link "Registrar pagamento" para
// uma página própria; a spec só pede a lista, o filtro e o total (FIN-07), e a agenda daqui já
// mostra o nome completo. Registro de pagamento e preço pela tela ficam em item adiado
// (context.md).

const FILTROS: FiltroDebitos[] = ['todos', 'em_debito', 'em_dia'];
const ROTULO: Record<FiltroDebitos, string> = {
  todos: 'Todos',
  em_debito: 'Em débito',
  em_dia: 'Em dia',
};
const ROTULO_SESSAO: Record<string, string> = {
  realizada: 'Realizada',
  faltou: 'Faltou',
  cancelada: 'Cancelada',
};

/** Centavos inteiros em reais, no formato pt-BR. */
export const emReais = (centavos: number): string =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function FinanceiroPage() {
  const [params, setParams] = useSearchParams();
  const bruto = params.get('status');
  const filtro: FiltroDebitos = FILTROS.includes(bruto as FiltroDebitos)
    ? (bruto as FiltroDebitos)
    : 'todos';
  const paciente = params.get('paciente');

  const debitos = useQuery({
    queryKey: ['debitos', filtro],
    queryFn: ({ signal }) => listarDebitos(filtro, signal),
  });
  const pendencias = useQuery({
    queryKey: ['debitos', 'paciente', paciente],
    queryFn: ({ signal }) => lerPendencias(paciente!, signal),
    enabled: paciente !== null && paciente !== '',
  });

  function atualizar(proximoFiltro: FiltroDebitos, proximoPaciente: string | null) {
    const p = new URLSearchParams();
    if (proximoFiltro !== 'todos') p.set('status', proximoFiltro);
    if (proximoPaciente) p.set('paciente', proximoPaciente);
    setParams(p);
  }

  const itens = debitos.data?.items ?? [];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Financeiro</h1>

      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label="Situação financeira">
          {(p) => (
            <Select
              {...p}
              value={filtro}
              onChange={(e) => atualizar(e.target.value as FiltroDebitos, paciente)}
            >
              {FILTROS.map((f) => (
                <option key={f} value={f}>
                  {ROTULO[f]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>

      <QueryFetchState
        isPending={debitos.isPending}
        isError={debitos.isError}
        errorMessage="Não foi possível carregar o financeiro."
        onRetry={() => void debitos.refetch()}
        skeletonClassName="h-32"
      />
      {debitos.isSuccess && (
        <p className="font-semibold">
          Total pendente:{' '}
          <span data-testid="total-pendente">{emReais(debitos.data.total_pendente)}</span>
        </p>
      )}
      {debitos.isSuccess && itens.length === 0 && (
        <Empty title={filtro === 'todos' ? 'Ninguém em débito' : 'Nenhum paciente nesta situação'}>
          <p>
            {filtro === 'todos'
              ? 'Todas as sessões cobráveis estão pagas.'
              : 'Ajuste o filtro para ver outros pacientes.'}
          </p>
        </Empty>
      )}
      {debitos.isSuccess && itens.length > 0 && (
        <Table
          caption="Situação financeira dos pacientes"
          columns={['Paciente', 'Situação', 'Sessões pendentes', 'Valor pendente', 'Ações']}
          rows={itens.map((d) => [
            d.nome,
            d.status === 'em_debito' ? (
              <Badge tone="warn">Em débito</Badge>
            ) : (
              <Badge tone="ok">Em dia</Badge>
            ),
            String(d.sessoes_pendentes),
            emReais(d.valor_pendente),
            <Button
              key="a"
              variant="outline"
              aria-label={`Ver pendências de ${d.nome}`}
              onClick={() => atualizar(filtro, d.paciente_id)}
            >
              Ver pendências
            </Button>,
          ])}
        />
      )}

      {paciente && (
        <section aria-labelledby="pend-h" className="flex flex-col gap-3 rounded-card border-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 id="pend-h" className="font-heading text-xl font-bold">
              Sessões pendentes{pendencias.data ? ` de ${pendencias.data.nome}` : ''}
            </h2>
            <Button variant="outline" onClick={() => atualizar(filtro, null)}>
              Fechar
            </Button>
          </div>
          <QueryFetchState
            isPending={pendencias.isPending}
            isError={pendencias.isError}
            errorMessage="Não foi possível carregar as pendências do paciente."
            onRetry={() => void pendencias.refetch()}
            skeletonClassName="h-20"
          />
          {pendencias.isSuccess && pendencias.data.sessoes.length === 0 && (
            <Empty title="Nenhuma sessão pendente" />
          )}
          {pendencias.isSuccess && pendencias.data.sessoes.length > 0 && (
            <>
              <Table
                caption="Sessões pendentes de pagamento"
                columns={['Data', 'Situação da sessão', 'Valor']}
                rows={pendencias.data.sessoes.map((s) => [
                  dataHora(s.inicio),
                  ROTULO_SESSAO[s.status] ?? s.status,
                  s.valor === null ? 'Sem preço' : emReais(s.valor),
                ])}
              />
              <p>
                Total: {pendencias.data.total_sessoes} sessões,{' '}
                {emReais(pendencias.data.valor_pendente)}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
