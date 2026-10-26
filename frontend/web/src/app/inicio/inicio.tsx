import type {
  EstadoEvolucaoInicio,
  EstadoPagamentoInicio,
  SessaoDeHoje,
} from '@es/contrato/inicio';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Badge, Empty } from '../../ui';
import { EditWindowBadge, StatCard } from '../../ui/new';
import { PlusIcon } from '../../ui/new/icons';
import { QueryFetchState } from '../../ui/new/QueryFetchState';
import { useProfileName } from '../perfil/api.ts';
import { lerResumoInicio } from './api.ts';

// INI-01, INI-02, INI-03: Início, portado de home/HomePage.tsx e home/TodayList.tsx do legado com
// o mesmo layout (saudação com a semana, "Novo paciente" e "Nova sessão", alerta de evolução
// editável sem texto, quatro contadores e a lista "Hoje"). Contadores, lista e classificação vêm
// prontos de GET /api/inicio; a tela não recalcula nada.
// SPEC_DEVIATION: o legado dava a cada sessão um chip de estado visual calculado no cliente
// (sessionVisualState) e um atalho "Pagamento" para a página de pagamento. Aqui a linha mostra os
// dois selos da spec (evolução, com quatro estados, e pagamento, com três) e o atalho de
// pagamento fica adiado com a tela de registro (context.md). O nome vem inteiro, como na agenda.

const pad = (n: number) => String(n).padStart(2, '0');
const hora = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const diaMes = (chave: string) => `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;

function saudacao(agora: Date): string {
  const h = agora.getHours();
  if (h < 12) return 'Bom dia';
  return h < 18 ? 'Boa tarde' : 'Boa noite';
}

const BOTAO =
  'inline-flex min-h-12 min-w-12 items-center gap-2 rounded-card border-2 border-pri px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2';
const LINK_SESSAO =
  'inline-flex min-h-11 min-w-11 items-center rounded-card border-2 border-pri px-4 font-semibold text-pri focus-visible:outline-2 focus-visible:outline-offset-2';

function SeloEvolucao({ estado }: { estado: EstadoEvolucaoInicio }) {
  if (estado === 'editavel_hoje' || estado === 'registrada')
    return <EditWindowBadge estado={estado} />;
  return (
    <Badge tone="warn">
      {estado === 'sem_registro' ? 'Sem registro' : 'Editável hoje, sem texto'}
    </Badge>
  );
}

function SeloPagamento({ estado }: { estado: EstadoPagamentoInicio }) {
  if (estado === 'pago') return <Badge tone="ok">Pago</Badge>;
  if (estado === 'pendente') return <Badge tone="warn">Pagamento pendente</Badge>;
  return <span className="text-sm text-mut">Não cobrável</span>;
}

function ListaDeHoje({ sessoes, total }: { sessoes: SessaoDeHoje[]; total: number }) {
  return (
    <section
      aria-labelledby="hoje"
      className="flex flex-col gap-2 rounded-card border border-(--line) bg-(--surf) p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="hoje" className="font-heading text-xl font-bold">
          Hoje
        </h2>
        <Link to="/app/agenda" className="font-semibold text-pri underline">
          Abrir agenda
        </Link>
      </div>
      {sessoes.length === 0 ? (
        <p className="text-mut">Nenhuma sessão hoje.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessoes.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-semibold">{hora(s.inicio)}</span>
              <span>{s.paciente.nome}</span>
              <SeloEvolucao estado={s.evolucao} />
              <SeloPagamento estado={s.pagamento} />
              <Link to={`/app/pacientes/${s.paciente.id}/evolucao`} className={LINK_SESSAO}>
                Evolução
              </Link>
            </li>
          ))}
        </ul>
      )}
      {total > sessoes.length && (
        <Link to="/app/agenda" className="font-semibold text-pri underline">
          Ver todas ({total})
        </Link>
      )}
    </section>
  );
}

export function Inicio() {
  const consulta = useQuery({
    queryKey: ['inicio'],
    queryFn: ({ signal }) => lerResumoInicio(signal),
  });
  const { primeiroNome } = useProfileName();
  // Resposta sem a semana (corpo fora do contrato) não derruba a tela: some o resumo, fica o cabeçalho.
  const resumo = consulta.data?.semana !== undefined ? consulta.data : undefined;
  const semTexto = resumo?.alerta.editavel_hoje_sem_texto ?? 0;
  const primeira = resumo?.hoje.find((s) => s.evolucao === 'editavel_hoje_sem_texto');
  const saudar = saudacao(new Date());

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* SPEC_DEVIATION: o legado usava a saudação como h1; aqui o h1 segue "Evolução Segura"
              (PUB-02, rotas.test.tsx e shell.test.tsx já fixam esse título) e a saudação vai abaixo. */}
          <h1 className="font-heading text-2xl font-bold">Evolução Segura</h1>
          <p className="text-mut">{primeiroNome ? `${saudar}, ${primeiroNome}` : saudar}</p>
          {resumo && (
            <p className="text-mut">
              Semana de {diaMes(resumo.semana.inicio)} a {diaMes(resumo.semana.fim)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/pacientes/novo" className={`${BOTAO} bg-transparent text-pri`}>
            <PlusIcon />
            Novo paciente
          </Link>
          <Link to="/app/agenda/nova" className={`${BOTAO} bg-pri text-onpri`}>
            <PlusIcon />
            Nova sessão
          </Link>
        </div>
      </header>

      <QueryFetchState
        isPending={consulta.isPending}
        isError={consulta.isError}
        errorMessage="Não foi possível carregar o resumo da semana."
        onRetry={() => void consulta.refetch()}
        skeletonClassName="h-32"
      />

      {resumo && semTexto > 0 && (
        <Alert tone="warn">
          <p>
            <EditWindowBadge estado="editavel_hoje" /> Você tem {semTexto}{' '}
            {semTexto === 1 ? 'evolução editável' : 'evoluções editáveis'} hoje ainda sem texto.
            Depois das 23:59, só retificação.{' '}
            {primeira && (
              <Link
                to={`/app/pacientes/${primeira.paciente.id}/evolucao`}
                className="font-semibold underline"
              >
                Abrir
              </Link>
            )}
          </p>
        </Alert>
      )}

      {resumo && resumo.semana.total === 0 && (
        <Empty title="Você ainda não tem sessões nesta semana." />
      )}

      {resumo && resumo.semana.total > 0 && (
        <>
          <section aria-labelledby="semana" className="flex flex-col gap-2">
            <h2 id="semana" className="font-heading text-xl font-bold">
              Esta semana
            </h2>
            <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
              <StatCard
                label="Sessões na semana"
                value={resumo.semana.total}
                complemento={`${resumo.hoje_total} hoje`}
              />
              <StatCard
                label="Realizadas"
                value={`${resumo.semana.realizadas} de ${resumo.semana.total}`}
                progresso={{ feito: resumo.semana.realizadas, total: resumo.semana.total }}
              />
              <StatCard
                label="Evoluções a registrar"
                value={resumo.semana.pendentes_evolucao}
                {...(resumo.semana.pendentes_evolucao > 0
                  ? {
                      atencao: {
                        texto: 'Evoluções pendentes',
                        destino: '/app/agenda',
                        acao: 'Registrar agora',
                        descricao: 'as evoluções pendentes',
                      },
                    }
                  : {})}
              />
              <StatCard
                label="Pagamentos em aberto"
                value={resumo.semana.pendentes_pagamento}
                {...(resumo.semana.pendentes_pagamento > 0
                  ? {
                      atencao: {
                        texto: 'Pagamentos em aberto',
                        destino: '/app/financeiro',
                        acao: 'Ver no Financeiro',
                        descricao: 'os pagamentos em aberto',
                      },
                    }
                  : {})}
              />
            </div>
          </section>
          <ListaDeHoje sessoes={resumo.hoje} total={resumo.hoje_total} />
        </>
      )}
    </div>
  );
}
