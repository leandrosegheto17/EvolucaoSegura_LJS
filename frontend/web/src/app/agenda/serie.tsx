import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MudancaStatus, Sessao, StatusSessao } from '@es/contrato/agenda';
import { TRANSICOES } from '@es/dominio/agenda/sessao';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { type ErroApi, ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input, Spinner } from '../../ui';
import { AlertDialog, DialogShell } from '../../ui/dialogs/Dialog';
import {
  AgendaPage,
  CamposSessao,
  type ErrosSessao,
  LINK_SECUNDARIO,
  VALORES_INICIAIS,
  ehConflito,
  mensagemDeErro,
  montarSessao,
  segundaDe,
} from './agenda.tsx';
import { criarSerie, mudarStatus } from './api.ts';

// AGE-04, AGE-07, AGE-10, AGE-13, AGE-14: criação de série, diálogo de conflito e mudança de
// status na agenda, portados de features/scheduling/new (RepeatFields, ConflictAlert) e
// features/scheduling/detail/SessionDetailPage.tsx do legado.
// SPEC_DEVIATION: no legado a repetição era um campo da "Nova sessão" ("repetir até"); aqui a
// série tem tela própria porque o contrato separa POST /api/series e pede frequência e total de
// ocorrências (2 a 52) em vez da data final. As ações de status ficam na lista da semana, pois
// ainda não existe a tela de detalhe (falta GET /api/sessoes/:id).

const pad = (n: number) => String(n).padStart(2, '0');
const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type CorpoSerie = Parameters<typeof criarSerie>[0];

export function NovaSeriePage() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [valores, setValores] = useState(VALORES_INICIAIS);
  const [frequencia, setFrequencia] = useState<CorpoSerie['frequencia']>('semanal');
  const [total, setTotal] = useState('4');
  const [erros, setErros] = useState<ErrosSessao & { total?: string }>({});
  const [erroForm, setErroForm] = useState<string>();
  const [pendente, setPendente] = useState<CorpoSerie | null>(null);
  const [colisoes, setColisoes] = useState<NonNullable<ErroApi['colisoes']> | null>(null);
  const envio = useMutation({
    mutationFn: criarSerie,
    onSuccess: (_r, corpo) => {
      setColisoes(null);
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      navegar(`/app/agenda?semana=${chaveSemana(corpo.inicio)}`);
    },
    onError: (erro, corpo) => {
      if (ehConflito(erro) && ehErroApi(erro)) {
        setPendente(corpo);
        return setColisoes(erro.colisoes ?? []);
      }
      setColisoes(null);
      setErroForm(mensagemDeErro(erro));
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    setErroForm(undefined);
    const { erros: proximos, corpo } = montarSessao(valores);
    const n = Number(total);
    const faixa: { total?: string } =
      Number.isInteger(n) && n >= 2 && n <= 52 ? {} : { total: 'Informe de 2 a 52 ocorrências.' };
    setErros({ ...proximos, ...faixa });
    if (corpo && !faixa.total) envio.mutate({ ...corpo, frequencia, ocorrencias: n });
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold">Nova série</h1>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        {erroForm && <Alert tone="err">{erroForm}</Alert>}
        <CamposSessao
          valores={valores}
          erros={erros}
          onChange={(p) => setValores((v) => ({ ...v, ...p }))}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="font-semibold">Repetição</legend>
          {(
            [
              ['semanal', 'Toda semana'],
              ['quinzenal', 'A cada 15 dias'],
            ] as const
          ).map(([v, rotulo]) => (
            <label key={v} className="flex items-center gap-2">
              <input
                type="radio"
                name="frequencia"
                checked={frequencia === v}
                onChange={() => setFrequencia(v)}
              />{' '}
              {rotulo}
            </label>
          ))}
        </fieldset>
        <Field
          label="Ocorrências"
          hint="De 2 a 52, contando a primeira sessão."
          error={erros.total}
          required
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              inputMode="numeric"
              min={2}
              max={52}
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          )}
        </Field>
        <div className="flex gap-3">
          <Button type="submit" disabled={envio.isPending}>
            {envio.isPending ? <Spinner label="Agendando" /> : 'Agendar série'}
          </Button>
          <Link to="/app/agenda" className={LINK_SECUNDARIO}>
            Cancelar
          </Link>
        </div>
      </form>

      <DialogShell
        open={colisoes !== null}
        onEscape={() => setColisoes(null)}
        title="Já existem sessões nestes horários"
        description={
          <>
            <p>Nada foi criado. As ocorrências abaixo coincidem com sessões existentes:</p>
            <ul className="mt-2 list-disc pl-5">
              {(colisoes ?? []).map((c) => (
                <li key={`${c.ocorrencia}-${c.sessao_id}`}>
                  Ocorrência {c.ocorrencia}: {dataHora(c.inicio)}
                </li>
              ))}
            </ul>
          </>
        }
      >
        <AlertDialog.Cancel asChild>
          <Button variant="outline" onClick={() => setColisoes(null)}>
            Escolher outro horário
          </Button>
        </AlertDialog.Cancel>
        <Button
          disabled={envio.isPending}
          onClick={() => pendente && envio.mutate({ ...pendente, confirmar_conflito: true })}
        >
          Criar mesmo assim
        </Button>
      </DialogShell>
    </div>
  );
}

const chaveSemana = (iso: string) => {
  const d = segundaDe(new Date(iso));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const ACAO: Record<StatusSessao, string> = {
  agendada: 'Voltar para agendada',
  realizada: 'Marcar como realizada',
  faltou: 'Marcar falta',
  cancelada: 'Cancelar sessão',
  remarcada: 'Marcar como remarcada',
};
const COBRAVEIS: readonly StatusSessao[] = ['faltou', 'cancelada'];

function mensagemStatus(erro: unknown): string {
  if (ehErroApi(erro)) {
    if (erro.codigo === 'SESSION_HAS_RECORDS')
      return 'Esta sessão tem evolução ou pagamento e não pode ser cancelada.';
    if (erro.codigo === 'transicao_invalida') return 'Esta mudança de situação não é permitida.';
    if (erro.codigo === 'versao_divergente')
      return 'Alguém alterou esta sessão. Recarregue a agenda e tente de novo.';
    if (erro.codigo === 'WEEKDAY_UNAVAILABLE' || erro.codigo === 'PATIENT_INACTIVE')
      return mensagemDeErro(erro);
  }
  return 'Não foi possível alterar a sessão. Tente novamente.';
}

/** Ações de uma sessão: só as transições válidas (AGE-07), "Cobrar" em falta e cancelamento. */
export function AcoesSessao({ sessao }: { sessao: Sessao }) {
  const qc = useQueryClient();
  const [cobrar, setCobrar] = useState(sessao.cobravel);
  const [erro, setErro] = useState<string>();
  const [conflito, setConflito] = useState<MudancaStatus | null>(null);
  const atualizar = () => void qc.invalidateQueries({ queryKey: ['agenda'] });

  const status = useMutation({
    mutationFn: (corpo: MudancaStatus) => mudarStatus(sessao.id, corpo),
    onSuccess: () => {
      setErro(undefined);
      setConflito(null);
      atualizar();
    },
    onError: (e, corpo) => {
      if (ehConflito(e)) return setConflito(corpo);
      setConflito(null);
      setErro(mensagemStatus(e));
    },
  });
  const mudar = (para: StatusSessao): MudancaStatus => ({
    status: para,
    row_version: sessao.row_version,
    // AGE-10: falta e cancelamento gravam cobravel = falso, salvo "Cobrar".
    ...(COBRAVEIS.includes(para) ? { cobravel: cobrar } : {}),
  });
  const mostraCobrar =
    COBRAVEIS.includes(sessao.status) ||
    TRANSICOES[sessao.status].some((s) => COBRAVEIS.includes(s));

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {TRANSICOES[sessao.status].map((para) => (
          <Button
            key={para}
            variant="outline"
            disabled={status.isPending}
            onClick={() => status.mutate(mudar(para))}
          >
            {ACAO[para]}
          </Button>
        ))}
        {mostraCobrar && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cobrar}
              disabled={status.isPending}
              onChange={(e) => {
                setCobrar(e.target.checked);
                // Já faltou ou cancelada: o "Cobrar" muda a própria sessão (mesmo status).
                if (COBRAVEIS.includes(sessao.status))
                  status.mutate({
                    status: sessao.status,
                    cobravel: e.target.checked,
                    row_version: sessao.row_version,
                  });
              }}
            />{' '}
            Cobrar
          </label>
        )}
      </div>
      {erro && <Alert tone="err">{erro}</Alert>}
      {conflito && (
        <Alert tone="warn">
          <b>Já existe sessão neste horário.</b> Nada foi alterado.
          <div className="mt-2 flex gap-3">
            <Button
              disabled={status.isPending}
              onClick={() => status.mutate({ ...conflito, confirmar_conflito: true })}
            >
              Confirmar mesmo assim
            </Button>
            <Button variant="outline" onClick={() => setConflito(null)}>
              Deixar como está
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}

/** A agenda da semana com as ações de status em cada sessão (rota /app/agenda). */
export function AgendaComAcoes() {
  return <AgendaPage acoes={(s) => <AcoesSessao sessao={s} />} />;
}
