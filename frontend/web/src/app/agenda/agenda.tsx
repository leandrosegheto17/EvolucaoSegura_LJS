import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Sessao } from '@es/contrato/agenda';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Badge, Button, Empty, Field, Input, Select, Skeleton, Spinner } from '../../ui';
import { listarPacientes } from '../pacientes/api.ts';
import { criarSessao, listarSessoes } from './api.ts';

// AGE-01, AGE-02, AGE-03: agenda da semana e nova sessão, portadas de
// scheduling/agenda/AgendaPage.tsx e features/scheduling/new/NewSessionPage.tsx do legado com o
// mesmo layout (título "Agenda", "Nova sessão", navegação da semana, formulário Paciente, Data,
// Hora, Duração e Link). A semana vive na URL (?semana=AAAA-MM-DD) e começa na segunda-feira.
// SPEC_DEVIATION: em relação ao legado, a semana é uma lista por dia (nome do paciente, horário e
// situação), sem a grade por hora, a gaveta do dia, a legenda e o modo privacidade; sábado e
// domingo só aparecem com sessão (o perfil ainda não é lido aqui). Voltam em tarefa própria.

const NOMES_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
export const DURACOES = [30, 45, 50, 60, 90] as const;
export const DURACAO_PADRAO = '50';

const pad = (n: number) => String(n).padStart(2, '0');
const chave = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hora = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function lerChave(texto: string | null): Date | null {
  const m = texto === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return chave(d) === texto ? d : null;
}

export function segundaDe(d: Date): Date {
  return somarDias(d, -((d.getDay() + 6) % 7));
}

const ROTULO_STATUS: Record<Sessao['status'], string> = {
  agendada: 'Agendada',
  realizada: 'Realizada',
  faltou: 'Faltou',
  cancelada: 'Cancelada',
  remarcada: 'Remarcada',
};
const TOM_STATUS: Record<Sessao['status'], 'ok' | 'warn' | 'err'> = {
  agendada: 'warn',
  realizada: 'ok',
  faltou: 'err',
  cancelada: 'err',
  remarcada: 'warn',
};

export const LINK_PRIMARIO =
  'inline-flex min-h-12 min-w-12 items-center justify-center rounded-card border-2 border-pri bg-pri px-4 font-semibold text-onpri focus-visible:outline-2 focus-visible:outline-offset-2';
const LINK_SECUNDARIO =
  'inline-flex min-h-12 min-w-12 items-center justify-center rounded-card border-2 border-pri px-4 font-semibold text-pri focus-visible:outline-2 focus-visible:outline-offset-2';

/** Texto de um erro do contrato da agenda (AGE-01, AGE-04, AGE-06, AGE-12). */
export function mensagemDeErro(erro: unknown): string {
  if (ehErroApi(erro)) {
    if (erro.codigo === 'WEEKDAY_UNAVAILABLE')
      return 'Você não atende neste dia da semana. Ajuste os dias de atendimento no Perfil ou escolha outra data.';
    if (erro.codigo === 'PATIENT_INACTIVE')
      return 'Este paciente está inativo. Reative-o ou escolha outro paciente.';
    if (erro.status === 400 || erro.status === 422)
      return 'Confira data, hora e link: algum valor é inválido.';
  }
  return 'Não foi possível agendar agora. Nada foi criado. Tente novamente.';
}

export const ehConflito = (erro: unknown) =>
  ehErroApi(erro) && erro.status === 409 && erro.codigo === 'SCHEDULE_CONFLICT';

export function usarNomes() {
  return useQuery({
    queryKey: ['agenda', 'nomes'],
    queryFn: async ({ signal }) =>
      new Map(
        (await listarPacientes({ q: '', filtro: 'todos' }, signal)).map((p) => [p.id, p.nome]),
      ),
  });
}

export function AgendaPage() {
  const [params, setParams] = useSearchParams();
  const segunda = segundaDe(lerChave(params.get('semana')) ?? new Date());
  const fim = somarDias(segunda, 7);
  const consulta = useQuery({
    queryKey: ['agenda', chave(segunda)],
    queryFn: ({ signal }) => listarSessoes(segunda, fim, signal),
  });
  const nomes = usarNomes();
  const ir = (d: Date) => setParams(new URLSearchParams({ semana: chave(d) }));

  const porDia = new Map<string, Sessao[]>();
  for (const s of consulta.data ?? []) {
    const k = chave(new Date(s.inicio));
    porDia.set(k, [...(porDia.get(k) ?? []), s]);
  }
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i)).filter(
    (d) => (d.getDay() >= 1 && d.getDay() <= 5) || porDia.has(chave(d)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold">Agenda</h1>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/agenda/nova" className={LINK_PRIMARIO}>
            Nova sessão
          </Link>
        </div>
      </div>

      <nav aria-label="Semana" className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => ir(somarDias(segunda, -7))}>
          Semana anterior
        </Button>
        <Button variant="outline" onClick={() => ir(segundaDe(new Date()))}>
          Hoje
        </Button>
        <Button variant="outline" onClick={() => ir(somarDias(segunda, 7))}>
          Próxima semana
        </Button>
        <span className="font-semibold">
          {chave(segunda).split('-').reverse().join('/')} a{' '}
          {chave(somarDias(segunda, 6)).split('-').reverse().join('/')}
        </span>
      </nav>

      {consulta.isPending && <Skeleton className="h-64" />}
      {consulta.isError && (
        <Alert tone="err">
          <p>Não foi possível carregar a agenda.</p>
          <Button variant="outline" className="mt-2" onClick={() => void consulta.refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      )}
      {consulta.isSuccess && consulta.data.length === 0 && (
        <Empty title="Nenhuma sessão nesta semana.">
          <Link to="/app/agenda/nova" className="font-semibold text-pri underline">
            Nova sessão
          </Link>
        </Empty>
      )}
      {consulta.isSuccess &&
        consulta.data.length > 0 &&
        dias.map((d) => {
          const lista = [...(porDia.get(chave(d)) ?? [])].sort((a, b) =>
            a.inicio.localeCompare(b.inicio),
          );
          return (
            <section
              key={chave(d)}
              aria-label={`${NOMES_DIA[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`}
            >
              <h2 className="mb-2 font-heading text-lg font-bold">
                {NOMES_DIA[d.getDay()]}, {pad(d.getDate())}/{pad(d.getMonth() + 1)}
              </h2>
              {lista.length === 0 ? (
                <p className="text-mut">Sem sessões neste dia</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {lista.map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-3 rounded-card border-2 border-line p-3"
                    >
                      <span className="font-semibold">
                        {hora(s.inicio)}–{hora(s.fim)}
                      </span>
                      <span>{nomes.data?.get(s.paciente_id) ?? 'Paciente'}</span>
                      <Badge tone={TOM_STATUS[s.status]}>{ROTULO_STATUS[s.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
    </div>
  );
}

export interface ValoresSessao {
  paciente: string;
  data: string;
  hora: string;
  duracao: string;
  link: string;
}
export interface ErrosSessao {
  paciente?: string;
  data?: string;
  hora?: string;
  link?: string;
}
export const VALORES_INICIAIS: ValoresSessao = {
  paciente: '',
  data: '',
  hora: '',
  duracao: DURACAO_PADRAO,
  link: '',
};

/** Valida o formulário e monta início e fim em ISO com offset (AGE-01); null com erros. */
export function montarSessao(v: ValoresSessao): {
  erros: ErrosSessao;
  corpo?: { paciente_id: string; inicio: string; fim: string; link: string | null };
} {
  const erros: ErrosSessao = {};
  if (!v.paciente) erros.paciente = 'Escolha o paciente.';
  if (!v.data) erros.data = 'Escolha uma data.';
  if (!v.hora) erros.hora = 'Informe a hora.';
  if (v.link.trim() && !/^https?:\/\/\S+$/i.test(v.link.trim()))
    erros.link = 'Informe um link começando com http:// ou https://.';
  if (Object.keys(erros).length) return { erros };
  const inicio = new Date(`${v.data}T${v.hora}`);
  return {
    erros,
    corpo: {
      paciente_id: v.paciente,
      inicio: inicio.toISOString(),
      fim: new Date(inicio.getTime() + Number(v.duracao) * 60_000).toISOString(),
      link: v.link.trim() || null,
    },
  };
}

export function CamposSessao({
  valores,
  erros,
  onChange,
}: {
  valores: ValoresSessao;
  erros: ErrosSessao;
  onChange: (proximo: Partial<ValoresSessao>) => void;
}) {
  const pacientes = useQuery({
    queryKey: ['pacientes', { q: '', filtro: 'ativos' }],
    queryFn: ({ signal }) => listarPacientes({ q: '', filtro: 'ativos' }, signal),
  });
  if (pacientes.isPending) return <Spinner label="Carregando pacientes" />;
  if (pacientes.isError)
    return (
      <Alert tone="err">
        <p>Não foi possível carregar os pacientes.</p>
        <Button variant="outline" className="mt-2" onClick={() => void pacientes.refetch()}>
          Tentar novamente
        </Button>
      </Alert>
    );
  return (
    <>
      <Field label="Paciente" error={erros.paciente} required>
        {(p) => (
          <Select
            {...p}
            value={valores.paciente}
            onChange={(e) => onChange({ paciente: e.target.value })}
          >
            <option value="">Selecione</option>
            {pacientes.data.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Data" error={erros.data} required>
          {(p) => (
            <Input
              {...p}
              type="date"
              value={valores.data}
              onChange={(e) => onChange({ data: e.target.value })}
            />
          )}
        </Field>
        <Field label="Hora" error={erros.hora} required>
          {(p) => (
            <Input
              {...p}
              type="time"
              value={valores.hora}
              onChange={(e) => onChange({ hora: e.target.value })}
            />
          )}
        </Field>
        <Field label="Duração">
          {(p) => (
            <Select
              {...p}
              value={valores.duracao}
              onChange={(e) => onChange({ duracao: e.target.value })}
            >
              {DURACOES.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Link de videochamada (opcional, externo)" error={erros.link}>
        {(p) => (
          <Input
            {...p}
            inputMode="url"
            placeholder="https://exemplo.invalid/sala"
            value={valores.link}
            onChange={(e) => onChange({ link: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

export function NovaSessaoPage() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [valores, setValores] = useState(VALORES_INICIAIS);
  const [erros, setErros] = useState<ErrosSessao>({});
  const [conflito, setConflito] = useState<ReturnType<typeof montarSessao>['corpo'] | null>(null);
  const [erroForm, setErroForm] = useState<string>();
  const envio = useMutation({
    mutationFn: criarSessao,
    onSuccess: (_s, corpo) => {
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      navegar(`/app/agenda?semana=${chave(segundaDe(new Date(corpo.inicio)))}`);
    },
    onError: (erro, corpo) => {
      if (ehConflito(erro)) return setConflito(corpo);
      setConflito(null);
      setErroForm(mensagemDeErro(erro));
    },
  });
  useEffect(() => {
    if (conflito) document.getElementById('confirmar-conflito')?.focus();
  }, [conflito]);

  function enviar(e: FormEvent) {
    e.preventDefault();
    setConflito(null);
    setErroForm(undefined);
    const { erros: proximos, corpo } = montarSessao(valores);
    setErros(proximos);
    if (corpo) envio.mutate(corpo);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold">Nova sessão</h1>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        {erroForm && <Alert tone="err">{erroForm}</Alert>}
        {conflito && (
          <Alert tone="warn">
            <b>Já existe sessão neste horário.</b> O horário coincide com outra sessão. Nada foi
            alterado ou sobrescrito.
            <div className="mt-2 flex gap-3">
              <Button
                id="confirmar-conflito"
                disabled={envio.isPending}
                onClick={() => envio.mutate({ ...conflito, confirmar_conflito: true })}
              >
                Agendar mesmo assim
              </Button>
              <Button variant="outline" onClick={() => setConflito(null)}>
                Escolher outro horário
              </Button>
            </div>
          </Alert>
        )}
        <CamposSessao
          valores={valores}
          erros={erros}
          onChange={(p) => setValores((v) => ({ ...v, ...p }))}
        />
        <div className="flex gap-3">
          <Button type="submit" disabled={envio.isPending}>
            {envio.isPending ? <Spinner label="Agendando" /> : 'Agendar'}
          </Button>
          <Link to="/app/agenda" className={LINK_SECUNDARIO}>
            Cancelar
          </Link>
        </div>
      </form>
    </div>
  );
}
