import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Empty, Field, Input, Select, Table } from '../../ui';
import { QueryFetchState } from '../../ui/new/QueryFetchState';
import { type FiltroAtivos, listarPacientes } from './api.ts';

// PAC-02, PAC-03: lista de pacientes, portada de patients/list/PatientsListPage.tsx do legado
// com o mesmo layout (título, "Novo paciente", busca por nome, filtro de situação, tabela com
// nome, contato e selo de situação). Busca e filtro vivem na URL (?q=&filtro=), com replace:
// recarregar ou compartilhar o link restaura a lista. Ativos por padrão. Sem ação de excluir.
// Rotas sob /app (PUB-02).

const FILTROS: FiltroAtivos[] = ['ativos', 'inativos', 'todos'];
const ROTULO: Record<FiltroAtivos, string> = {
  ativos: 'Ativos',
  inativos: 'Inativos',
  todos: 'Todos',
};

const LINK_PRIMARIO =
  'inline-flex min-h-12 min-w-12 items-center rounded-card border-2 border-pri bg-pri px-4 font-semibold text-onpri focus-visible:outline-2 focus-visible:outline-offset-2';

export function PatientsListPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const bruto = params.get('filtro');
  const filtro: FiltroAtivos = FILTROS.includes(bruto as FiltroAtivos)
    ? (bruto as FiltroAtivos)
    : 'ativos';
  const [rascunho, setRascunho] = useState(q);
  useEffect(() => setRascunho(q), [q]);

  const consulta = useQuery({
    queryKey: ['pacientes', { q, filtro }],
    queryFn: ({ signal }) => listarPacientes({ q, filtro }, signal),
  });

  function atualizar(proximo: { q?: string; filtro?: FiltroAtivos }) {
    const p = new URLSearchParams();
    const nq = (proximo.q ?? q).trim();
    const nf = proximo.filtro ?? filtro;
    if (nq) p.set('q', nq);
    if (nf !== 'ativos') p.set('filtro', nf);
    setParams(p, { replace: true });
  }
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    atualizar({ q: rascunho });
  };

  const itens = consulta.data ?? [];
  const buscando = q !== '' || filtro !== 'ativos';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold">Pacientes</h1>
        <Link to="/app/pacientes/novo" className={LINK_PRIMARIO}>
          Novo paciente
        </Link>
      </div>

      <form role="search" onSubmit={enviar} className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <Field label="Buscar por nome">
            {(p) => (
              <Input
                {...p}
                type="search"
                autoComplete="off"
                maxLength={200}
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div>
          <Field label="Situação">
            {(p) => (
              <Select
                {...p}
                value={filtro}
                onChange={(e) => atualizar({ filtro: e.target.value as FiltroAtivos })}
              >
                {FILTROS.map((f) => (
                  <option key={f} value={f}>
                    {ROTULO[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Button type="submit">Buscar</Button>
      </form>

      <QueryFetchState
        isPending={consulta.isPending}
        isError={consulta.isError}
        errorMessage="Não foi possível carregar os pacientes."
        onRetry={() => void consulta.refetch()}
        skeletonClassName="h-32"
      />
      {consulta.isSuccess && itens.length === 0 && (
        <Empty title={buscando ? 'Nenhum paciente encontrado' : 'Você ainda não tem pacientes'}>
          {buscando ? (
            <p>Ajuste a busca ou a situação para ver outros resultados.</p>
          ) : (
            <Link to="/app/pacientes/novo" className="font-semibold text-pri underline">
              Cadastrar o primeiro paciente
            </Link>
          )}
        </Empty>
      )}
      {consulta.isSuccess && itens.length > 0 && (
        <Table
          caption="Lista de pacientes"
          columns={['Nome', 'Contato', 'Situação']}
          rows={itens.map((p) => [
            <Link
              key="n"
              to={`/app/pacientes/${p.id}`}
              className="inline-flex min-h-12 items-center font-semibold text-pri underline"
            >
              {p.nome}
            </Link>,
            p.telefone ?? p.email ?? '—',
            p.ativo ? <Badge tone="ok">Ativo</Badge> : <Badge tone="warn">Inativo</Badge>,
          ])}
        />
      )}
    </div>
  );
}
