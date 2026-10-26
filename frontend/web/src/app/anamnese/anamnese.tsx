import type {
  Anamnese,
  ItemDoModelo,
  ModeloAnamnese,
  ValoresAnamnese,
} from '@es/contrato/anamnese';
import { LIMITES_MODELO } from '@es/dominio/anamnese/modelo';
import { OPCOES_FREQUENCIA } from '@es/dominio/anamnese/presets';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Empty, Field, Input, Select, Skeleton, Textarea } from '../../ui';
import { ClinicalAlertBadge, EditWindowBadge } from '../../ui/new';
import { LockIcon } from '../../ui/new/icons';
import {
  CHAVE_MODELO,
  chaveAnamnese,
  criarAnamnese,
  editarAnamnese,
  gravarModelo,
  lerAnamnese,
  lerModelo,
  retificarAnamnese,
} from './api.ts';

// ANA-09 (T97): telas da anamnese do paciente e do editor do modelo, portadas de
// features/clinical/anamnesis/ (AnamnesisPage, AnamnesisForm, AnamnesisFields, RectifyForm,
// VersionsList, ModelEditor e ModelEditorSection) do legado, com o mesmo layout e os mesmos
// textos. O estado (selo "Editável hoje" ou "Registrada") e o alerta clínico vêm do servidor: o
// cliente nunca calcula a virada do dia. Mensagens de erro são fixas: nunca repetem o texto
// digitado nem o do servidor (dado clínico).
// SPEC_DEVIATION: em relação ao legado, (1) o editor do modelo é uma tela própria
// (/app/modelo-anamnese), porque a API tem rotas próprias do modelo com row_version no corpo e o
// modelo se grava sem a anamnese; (2) saem o seletor de especialidade (o profissional tem uma
// só), o rascunho automático e o aviso/confirmação de "salvar e bloquear" (o rascunho vem em
// etapa posterior; o bloqueio do modelo é mostrado no próprio editor).

const FREQUENCIA: Record<string, string> = {
  semanal: 'Semanal',
  quinzenal: 'Quinzenal',
  mensal: 'Mensal',
  outra: 'Outra',
};

// Data de hoje em America/Sao_Paulo, só para propor a data da sessão (o servidor decide a janela).
const hoje = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const formatarHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });

// ---------------------------------------------------------------------------------------------
// Valores por id de item do modelo.

type Rascunho = Record<string, { texto: string; marcado: boolean }>;

const rascunhoInicial = (modelo: ModeloAnamnese, valores: ValoresAnamnese = {}): Rascunho => {
  const r: Rascunho = {};
  for (const c of modelo.campos) {
    const v = valores[c.id];
    r[c.id] = { texto: typeof v === 'string' ? v : '', marcado: false };
  }
  for (const a of modelo.alertas) {
    const v = valores[a.id];
    r[a.id] =
      typeof v === 'object' && v !== null
        ? { texto: v.obs ?? '', marcado: v.marcado }
        : { texto: '', marcado: false };
  }
  return r;
};

const paraValores = (modelo: ModeloAnamnese, r: Rascunho): Record<string, unknown> => {
  const saida: Record<string, unknown> = {};
  for (const c of modelo.campos) {
    const t = r[c.id]?.texto.trim();
    if (t) saida[c.id] = t;
  }
  for (const a of modelo.alertas) {
    const x = r[a.id];
    if (x?.marcado) saida[a.id] = { marcado: true, obs: x.texto.trim() || null };
  }
  return saida;
};

// ANA-06: a versão vigente é a retificação de maior seq; sem retificação, a original.
const valoresVigentes = (a: Anamnese): ValoresAnamnese =>
  a.retificacoes.find((r) => r.seq === a.versao_vigente)?.valores ?? a.valores;

function Campos({
  modelo,
  r,
  travado = false,
  alterar,
}: {
  modelo: ModeloAnamnese;
  r: Rascunho;
  travado?: boolean;
  alterar: (id: string, p: Partial<Rascunho[string]>) => void;
}) {
  return (
    <>
      {modelo.campos.map((c) => (
        <Field key={c.id} label={c.rotulo}>
          {(p) =>
            c.especial === 'frequencia' ? (
              <Select
                {...p}
                value={r[c.id]?.texto ?? ''}
                disabled={travado}
                onChange={(e) => alterar(c.id, { texto: e.target.value })}
              >
                <option value="">Não informada</option>
                {OPCOES_FREQUENCIA.map((v) => (
                  <option key={v} value={v}>
                    {FREQUENCIA[v]}
                  </option>
                ))}
              </Select>
            ) : (
              <Textarea
                reading
                {...p}
                rows={4}
                value={r[c.id]?.texto ?? ''}
                readOnly={travado}
                onChange={(e) => alterar(c.id, { texto: e.target.value })}
              />
            )
          }
        </Field>
      ))}
      {modelo.alertas.length > 0 && (
        <fieldset className="flex flex-col gap-3">
          <legend className="font-semibold">Alertas críticos</legend>
          {modelo.alertas.map((a) => {
            const marcado = r[a.id]?.marcado ?? false;
            return (
              <div key={a.id} className="flex flex-col gap-2">
                <label className="flex min-h-12 items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-6"
                    checked={marcado}
                    disabled={travado}
                    onChange={(e) => alterar(a.id, { marcado: e.target.checked })}
                  />
                  {a.rotulo}
                </label>
                {marcado && (
                  <Field label={`Observação: ${a.rotulo}`}>
                    {(p) => (
                      <Textarea
                        reading
                        {...p}
                        rows={3}
                        value={r[a.id]?.texto ?? ''}
                        readOnly={travado}
                        onChange={(e) => alterar(a.id, { texto: e.target.value })}
                      />
                    )}
                  </Field>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
    </>
  );
}

function useRascunho(modelo: ModeloAnamnese, valores?: ValoresAnamnese) {
  const [r, setR] = useState<Rascunho>(() => rascunhoInicial(modelo, valores));
  const alterar = (id: string, p: Partial<Rascunho[string]>) =>
    setR((prev) => ({ ...prev, [id]: { texto: '', marcado: false, ...prev[id], ...p } }));
  return [r, alterar] as const;
}

// ---------------------------------------------------------------------------------------------
// Anamnese do paciente.

type Estado = 'ocioso' | 'salvo' | 'fechada' | 'existe' | 'invalida' | 'divergente' | 'erro';

const MENSAGEM_SALVAR: Record<Exclude<Estado, 'ocioso' | 'salvo'>, string> = {
  fechada: 'O prazo de edição acabou: use a retificação. Recarregue a página para continuar.',
  existe: 'O paciente já tem anamnese. Recarregue a página.',
  invalida:
    'Há valor inválido na anamnese ou o modelo mudou. Recarregue a página e confira o texto.',
  divergente: 'A anamnese foi alterada em outro lugar. Recarregue a página e refaça a alteração.',
  erro: 'Não foi possível salvar a anamnese. Seu texto foi mantido nesta tela.',
};

function FormularioAnamnese({
  pacienteId,
  modelo,
  existente,
  aoSalvar,
}: {
  pacienteId: string;
  modelo: ModeloAnamnese;
  existente: Anamnese | null;
  aoSalvar: (a: Anamnese) => void;
}) {
  const travado = existente?.estado === 'registrada';
  const [r, alterar] = useRascunho(modelo, existente ? valoresVigentes(existente) : undefined);
  const [data, setData] = useState(existente?.data_sessao ?? hoje());
  const [erroData, setErroData] = useState<string>();
  const [estado, setEstado] = useState<Estado>('ocioso');
  const salvar = useMutation({
    mutationFn: () => {
      const valores = paraValores(modelo, r);
      return existente
        ? editarAnamnese(existente.id, {
            modelo_revisao: modelo.revisao,
            valores,
            row_version: existente.row_version,
          })
        : criarAnamnese(pacienteId, {
            data_sessao: data,
            modelo_revisao: modelo.revisao,
            valores,
          });
    },
    onSuccess: (a) => {
      setEstado('salvo');
      aoSalvar(a);
    },
    onError: (e) => {
      if (!ehErroApi(e)) return setEstado('erro');
      if (e.codigo === 'EDIT_WINDOW_CLOSED') setEstado('fechada');
      else if (e.codigo === 'ANAMNESIS_EXISTS') setEstado('existe');
      else if (e.codigo === 'ANAMNESIS_VALUE_INVALID') setEstado('invalida');
      else if (e.codigo === 'versao_divergente') setEstado('divergente');
      else setEstado('erro');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const dataValida = /^\d{4}-\d{2}-\d{2}$/.test(data);
    setErroData(dataValida ? undefined : 'Informe a data da sessão.');
    if (!dataValida) return;
    setEstado('ocioso');
    salvar.mutate();
  };

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Anamnese"
      aria-busy={salvar.isPending}
      className="flex flex-col gap-4"
    >
      {existente && (
        <div className="flex flex-wrap items-center gap-3">
          <EditWindowBadge estado={existente.estado} />
          <ClinicalAlertBadge alertas={existente.alertas.map((a) => a.rotulo)} />
        </div>
      )}
      {existente && !travado && (
        <p className="text-mut">Você pode editar até 23:59 de hoje. Depois, só retificação.</p>
      )}
      {travado && <p className="text-mut">Anamnese registrada: conteúdo somente leitura.</p>}
      {estado === 'salvo' && <Alert tone="ok">Anamnese salva.</Alert>}
      {estado !== 'ocioso' && estado !== 'salvo' && (
        <Alert tone="err">{MENSAGEM_SALVAR[estado]}</Alert>
      )}
      <Field label="Data da sessão" required error={erroData}>
        {(p) => (
          <Input
            {...p}
            type="date"
            value={data}
            disabled={travado || existente !== null}
            onChange={(e) => setData(e.target.value)}
          />
        )}
      </Field>
      <Campos modelo={modelo} r={r} travado={travado} alterar={alterar} />
      {!travado && (
        <div>
          <Button type="submit" disabled={salvar.isPending}>
            {salvar.isPending ? 'Salvando...' : 'Salvar anamnese'}
          </Button>
        </div>
      )}
    </form>
  );
}

type EstadoRetificacao = 'ocioso' | 'aberta' | 'sem_conteudo' | 'conflito' | 'invalida' | 'erro';

const MENSAGEM_RETIFICAR: Record<Exclude<EstadoRetificacao, 'ocioso'>, [string, 'warn' | 'err']> = {
  aberta: ['A anamnese ainda pode ser editada hoje. Cancele e salve pela edição normal.', 'warn'],
  sem_conteudo: [
    'A retificação precisa alterar o conteúdo em relação à versão vigente e ter um motivo.',
    'err',
  ],
  conflito: [
    'Outra retificação foi salva antes desta. Recarregue a anamnese e refaça a retificação.',
    'warn',
  ],
  invalida: [
    'O modelo da anamnese mudou ou há valor inválido. Recarregue a página e refaça a retificação.',
    'err',
  ],
  erro: ['Não foi possível salvar a retificação. Seu texto foi mantido nesta tela.', 'err'],
};

function FormularioRetificacao({
  anamnese,
  modelo,
  aoConcluir,
  aoCancelar,
}: {
  anamnese: Anamnese;
  modelo: ModeloAnamnese;
  aoConcluir: (a: Anamnese) => void;
  aoCancelar: () => void;
}) {
  const [r, alterar] = useRascunho(modelo, valoresVigentes(anamnese));
  const [motivo, setMotivo] = useState('');
  const [erroMotivo, setErroMotivo] = useState<string>();
  const [estado, setEstado] = useState<EstadoRetificacao>('ocioso');
  const retificar = useMutation({
    mutationFn: () =>
      retificarAnamnese(anamnese.id, {
        modelo_revisao: modelo.revisao,
        valores: paraValores(modelo, r),
        motivo: motivo.trim(),
      }),
    onSuccess: aoConcluir,
    onError: (e) => {
      if (!ehErroApi(e)) return setEstado('erro');
      if (e.codigo === 'EDIT_WINDOW_OPEN') setEstado('aberta');
      else if (e.codigo === 'RECTIFICATION_CONFLICT') setEstado('conflito');
      else if (e.codigo === 'sem_conteudo_novo') setEstado('sem_conteudo');
      else if (e.status === 422) setEstado('invalida');
      else setEstado('erro');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const ok = motivo.trim() !== '';
    setErroMotivo(ok ? undefined : 'Informe o motivo da retificação.');
    if (!ok) return;
    setEstado('ocioso');
    retificar.mutate();
  };

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Retificar anamnese"
      aria-busy={retificar.isPending}
      className="flex flex-col gap-4"
    >
      <h2 className="font-heading text-lg font-bold">Retificar anamnese</h2>
      <p className="text-mut">
        A versão original é preservada. Sua retificação cria uma nova versão com o motivo.
      </p>
      {estado !== 'ocioso' && (
        <Alert tone={MENSAGEM_RETIFICAR[estado][1]}>{MENSAGEM_RETIFICAR[estado][0]}</Alert>
      )}
      <Field label="Motivo da retificação" required error={erroMotivo}>
        {(p) => (
          <Textarea
            reading
            {...p}
            rows={3}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        )}
      </Field>
      <Campos modelo={modelo} r={r} alterar={alterar} />
      <div className="flex gap-3">
        <Button type="submit" disabled={retificar.isPending}>
          {retificar.isPending ? 'Salvando...' : 'Salvar retificação'}
        </Button>
        <Button type="button" variant="outline" onClick={aoCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

// Só mostra os itens que a versão de fato preenche: campo incluído depois não aparece nas
// versões antigas (sem "vazio" espúrio). Rótulos vêm do modelo, por id.
function ValoresDaVersao({
  modelo,
  valores,
}: {
  modelo: ModeloAnamnese;
  valores: ValoresAnamnese;
}) {
  const campos = modelo.campos.filter(
    (c) => typeof valores[c.id] === 'string' && valores[c.id] !== '',
  );
  const alertas = modelo.alertas.filter((a) => {
    const v = valores[a.id];
    return typeof v === 'object' && v.marcado;
  });
  return (
    <dl className="flex flex-col gap-2">
      {campos.map((c) => {
        const v = String(valores[c.id]);
        return (
          <div key={c.id}>
            <dt className="font-semibold">{c.rotulo}</dt>
            <dd className="max-w-[68ch] whitespace-pre-wrap font-reading text-lg leading-[1.75]">
              {c.especial === 'frequencia' ? (FREQUENCIA[v] ?? v) : v}
            </dd>
          </div>
        );
      })}
      {alertas.map((a) => {
        const v = valores[a.id];
        return (
          <div key={a.id}>
            <dt className="font-semibold">Alerta: {a.rotulo}</dt>
            <dd className="whitespace-pre-wrap font-reading">
              {typeof v === 'object' ? (v.obs ?? '') : ''}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// Original sempre visível mais todas as retificações, da mais antiga para a mais nova.
function Versoes({ anamnese, modelo }: { anamnese: Anamnese; modelo: ModeloAnamnese }) {
  return (
    <section aria-label="Versões da anamnese" className="flex flex-col gap-4">
      <h2 className="font-heading text-lg font-bold">Versões</h2>
      <ol className="flex flex-col gap-4">
        <li>
          <article
            aria-label="Versão original"
            className="flex flex-col gap-2 rounded-card border border-line p-4"
          >
            <h3 className="font-semibold">Original — {formatarHora(anamnese.criado_em)}</h3>
            <ValoresDaVersao modelo={modelo} valores={anamnese.valores} />
          </article>
        </li>
        {anamnese.retificacoes.map((v) => (
          <li key={v.seq}>
            <article
              aria-label={`Retificação ${v.seq}`}
              className="flex flex-col gap-2 rounded-card border border-line p-4"
            >
              <h3 className="font-semibold">
                Retificação {v.seq} — {formatarHora(v.criado_em)}
                {v.seq === anamnese.versao_vigente ? ' (vigente)' : ''}
              </h3>
              <p>
                <span className="font-semibold">Motivo:</span>{' '}
                <span className="whitespace-pre-wrap">{v.motivo}</span>
              </p>
              <ValoresDaVersao modelo={modelo} valores={v.valores} />
            </article>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AnamnesePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const modelo = useQuery({ queryKey: CHAVE_MODELO, queryFn: ({ signal }) => lerModelo(signal) });
  const anamnese = useQuery({
    queryKey: chaveAnamnese(id),
    queryFn: ({ signal }) => lerAnamnese(id, signal),
  });
  const [iniciando, setIniciando] = useState(false);
  const [retificando, setRetificando] = useState(false);

  const titulo = <h1 className="font-heading text-2xl font-bold">Anamnese</h1>;
  if (modelo.isPending || anamnese.isPending) {
    return (
      <div className="flex flex-col gap-6">
        {titulo}
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (modelo.isError || anamnese.isError) {
    return (
      <div className="flex flex-col gap-3">
        {titulo}
        <Alert tone="err">Não foi possível carregar a anamnese.</Alert>
        <Button
          onClick={() => {
            void modelo.refetch();
            void anamnese.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }

  const existente = anamnese.data;
  const colocar = (a: Anamnese) => qc.setQueryData(chaveAnamnese(id), a);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {titulo}
        <Link to="/app/modelo-anamnese" className="font-semibold underline">
          Editar modelo da anamnese
        </Link>
      </header>
      {!existente && !iniciando && (
        <Empty title="Anamnese ainda não registrada">
          <Button onClick={() => setIniciando(true)}>Registrar anamnese</Button>
        </Empty>
      )}
      {(existente || iniciando) && (
        <FormularioAnamnese
          key={existente ? `${existente.versao_vigente}` : 'nova'}
          pacienteId={id}
          modelo={modelo.data}
          existente={existente}
          aoSalvar={colocar}
        />
      )}
      {existente?.estado === 'registrada' && !retificando && (
        <div>
          <Button onClick={() => setRetificando(true)}>Retificar</Button>
        </div>
      )}
      {existente?.estado === 'registrada' && retificando && (
        <FormularioRetificacao
          anamnese={existente}
          modelo={modelo.data}
          aoCancelar={() => setRetificando(false)}
          aoConcluir={(a) => {
            colocar(a);
            setRetificando(false);
          }}
        />
      )}
      {existente?.estado === 'registrada' && <Versoes anamnese={existente} modelo={modelo.data} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor do modelo (ANA-01, ANA-02, ANA-03).

type Tipo = 'campo' | 'alerta';
interface Item {
  chave: string;
  id?: string;
  rotulo: string;
  especial?: 'frequencia';
}

const TEXTOS = {
  campo: {
    plural: 'campos',
    sing: 'campo',
    art: 'Campo',
    max: LIMITES_MODELO.maxCampos,
    novo: 'Novo campo',
    adicionar: 'Adicionar campo',
    titulo: 'Campos',
  },
  alerta: {
    plural: 'alertas',
    sing: 'alerta',
    art: 'Alerta',
    max: LIMITES_MODELO.maxAlertas,
    novo: 'Novo alerta',
    adicionar: 'Adicionar alerta',
    titulo: 'Alertas',
  },
} as const;

const normalizar = (s: string) => s.trim().toLocaleLowerCase('pt-BR');

// Erro de rótulo (sem eco do texto digitado). O rótulo é único no modelo todo, campos e alertas
// juntos (ANA-01); `proprio` = item ignorado na comparação.
function erroDeRotulo(rotulo: string, todos: Item[], proprio: Item | null): string | undefined {
  const t = rotulo.trim();
  if (t.length < LIMITES_MODELO.rotuloMin) return 'Informe um nome.';
  if (t.length > LIMITES_MODELO.rotuloMax)
    return `Use no máximo ${LIMITES_MODELO.rotuloMax} caracteres.`;
  if (todos.some((x) => x !== proprio && normalizar(x.rotulo) === normalizar(t)))
    return 'Já existe um item com este nome.';
  return undefined;
}

let contador = 0;
const deItemDoModelo = (i: ItemDoModelo): Item => ({
  chave: i.id,
  id: i.id,
  rotulo: i.rotulo,
  ...(i.especial ? { especial: i.especial } : {}),
});
const itemNovo = (rotulo: string): Item => ({ chave: `novo-${contador++}`, rotulo });
const paraEnvio = (l: Item[]) =>
  l.map((x) => ({
    ...(x.id ? { id: x.id } : {}),
    rotulo: x.rotulo.trim(),
    ...(x.especial ? { especial: x.especial } : {}),
  }));

const MENSAGEM_MODELO = {
  MODEL_LOCKED:
    'A estrutura já está bloqueada: campos e alertas existentes não podem ser removidos nem renomeados; só incluir. Recarregue a página.',
  MODEL_LABEL_INVALID:
    'Rótulo inválido: use de 1 a 60 caracteres, sem repetir nomes, até 30 campos e 12 alertas.',
  versao_divergente:
    'O modelo foi alterado em outro lugar. Recarregue a página e refaça a alteração.',
  erro: 'Não foi possível salvar o modelo. Seus itens foram mantidos nesta tela.',
} as const;

function EditorDoModelo({
  modelo,
  aoSalvar,
}: {
  modelo: ModeloAnamnese;
  aoSalvar: (m: ModeloAnamnese) => void;
}) {
  const bloqueado = modelo.bloqueado;
  const [listas, setListas] = useState<Record<Tipo, Item[]>>({
    campo: modelo.campos.map(deItemDoModelo),
    alerta: modelo.alertas.map(deItemDoModelo),
  });
  const [rascunhos, setRascunhos] = useState<Record<Tipo, string>>({ campo: '', alerta: '' });
  const [erroAdd, setErroAdd] = useState<Record<Tipo, string | undefined>>({
    campo: undefined,
    alerta: undefined,
  });
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroServidor, setErroServidor] = useState<keyof typeof MENSAGEM_MODELO>();

  const todos = [...listas.campo, ...listas.alerta];
  const fixo = (it: Item) => bloqueado && it.id !== undefined;
  const movivel = (l: Item[], i: number, dir: -1 | 1) => {
    const vizinho = l[i + dir];
    return !fixo(l[i]!) && vizinho !== undefined && !fixo(vizinho);
  };
  const mudar = (tipo: Tipo, fn: (l: Item[]) => Item[]) =>
    setListas((p) => ({ ...p, [tipo]: fn(p[tipo]) }));

  const adicionar = (tipo: Tipo) => {
    if (listas[tipo].length >= TEXTOS[tipo].max) return;
    const erro = erroDeRotulo(rascunhos[tipo], todos, null);
    if (erro) return setErroAdd((p) => ({ ...p, [tipo]: erro }));
    mudar(tipo, (l) => [...l, itemNovo(rascunhos[tipo].trim())]);
    setRascunhos((p) => ({ ...p, [tipo]: '' }));
    setErroAdd((p) => ({ ...p, [tipo]: undefined }));
  };
  const mover = (tipo: Tipo, i: number, dir: -1 | 1) =>
    mudar(tipo, (l) => {
      if (!movivel(l, i, dir)) return l;
      const n = [...l];
      [n[i], n[i + dir]] = [n[i + dir]!, n[i]!];
      return n;
    });

  const gravar = useMutation({
    mutationFn: () =>
      gravarModelo({
        row_version: modelo.row_version,
        campos: paraEnvio(listas.campo),
        alertas: paraEnvio(listas.alerta),
      }),
    onSuccess: aoSalvar,
    onError: (e) => {
      const codigo = ehErroApi(e) ? e.codigo : '';
      setErroServidor(
        codigo in MENSAGEM_MODELO ? (codigo as keyof typeof MENSAGEM_MODELO) : 'erro',
      );
    },
  });

  const salvar = () => {
    const novos: Record<string, string> = {};
    for (const it of todos) {
      const erro = erroDeRotulo(it.rotulo, todos, it);
      if (erro) novos[it.chave] = erro;
    }
    setErros(novos);
    setErroServidor(undefined);
    if (Object.keys(novos).length === 0) gravar.mutate();
  };

  const secao = (tipo: Tipo) => {
    const t = TEXTOS[tipo];
    const lista = listas[tipo];
    const cheio = lista.length >= t.max;
    const cabecalho = `modelo-${tipo}`;
    return (
      <section aria-labelledby={cabecalho} className="flex flex-col gap-3">
        <h2 id={cabecalho} className="font-semibold">
          {t.titulo}
        </h2>
        <p className="text-sm text-mut">
          {lista.length} de {t.max} {t.plural}
        </p>
        <ul className="flex flex-col gap-3">
          {lista.map((it, i) => (
            <li key={it.chave} className="flex flex-col gap-2 rounded-card border border-field p-3">
              {fixo(it) ? (
                <>
                  <p className="flex items-center gap-2 font-semibold">
                    <LockIcon />
                    <span>{it.rotulo}</span>
                  </p>
                  <p className="text-sm text-mut">
                    Este {t.sing} não pode ser removido nem renomeado.
                  </p>
                </>
              ) : (
                <>
                  <Field label={`Nome do ${t.sing} ${i + 1}`} error={erros[it.chave]}>
                    {(p) => (
                      <Input
                        {...p}
                        value={it.rotulo}
                        onChange={(e) =>
                          mudar(tipo, (l) =>
                            l.map((x) => (x === it ? { ...x, rotulo: e.target.value } : x)),
                          )
                        }
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={!movivel(lista, i, -1)}
                      aria-label={`Subir ${t.sing} ${i + 1}`}
                      onClick={() => mover(tipo, i, -1)}
                    >
                      Subir
                    </Button>
                    <Button
                      variant="outline"
                      disabled={!movivel(lista, i, 1)}
                      aria-label={`Descer ${t.sing} ${i + 1}`}
                      onClick={() => mover(tipo, i, 1)}
                    >
                      Descer
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={`Remover ${t.sing} ${i + 1}`}
                      onClick={() => {
                        mudar(tipo, (l) => l.filter((x) => x !== it));
                        setErros({});
                      }}
                    >
                      Remover
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
        <Field
          label={t.novo}
          {...(cheio ? { hint: `Limite de ${t.max} ${t.plural} atingido.` } : {})}
          error={erroAdd[tipo]}
        >
          {(p) => (
            <Input
              {...p}
              value={rascunhos[tipo]}
              disabled={cheio}
              onChange={(e) => {
                setRascunhos((x) => ({ ...x, [tipo]: e.target.value }));
                setErroAdd((x) => ({ ...x, [tipo]: undefined }));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  adicionar(tipo);
                }
              }}
            />
          )}
        </Field>
        <div>
          <Button variant="outline" disabled={cheio} onClick={() => adicionar(tipo)}>
            {t.adicionar}
          </Button>
        </div>
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {bloqueado && (
        <p className="text-sm text-mut">
          Modelo bloqueado: itens já gravados não podem ser removidos nem renomeados; você pode
          incluir novos e mover os que incluir.
        </p>
      )}
      {secao('campo')}
      {secao('alerta')}
      {erroServidor && <Alert tone="err">{MENSAGEM_MODELO[erroServidor]}</Alert>}
      <div>
        <Button disabled={gravar.isPending} onClick={salvar}>
          Salvar modelo
        </Button>
      </div>
    </div>
  );
}

export function ModeloAnamnesePage() {
  const qc = useQueryClient();
  const modelo = useQuery({ queryKey: CHAVE_MODELO, queryFn: ({ signal }) => lerModelo(signal) });
  const [salvo, setSalvo] = useState(false);

  const titulo = <h1 className="font-heading text-2xl font-bold">Modelo da anamnese</h1>;
  if (modelo.isPending) {
    return (
      <div className="flex flex-col gap-6">
        {titulo}
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (modelo.isError) {
    return (
      <div className="flex flex-col gap-3">
        {titulo}
        <Alert tone="err">Não foi possível carregar o modelo.</Alert>
        <Button onClick={() => void modelo.refetch()}>Tentar novamente</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {titulo}
      {salvo && <Alert tone="ok">Modelo salvo.</Alert>}
      <EditorDoModelo
        key={modelo.data.row_version}
        modelo={modelo.data}
        aoSalvar={(m) => {
          qc.setQueryData(CHAVE_MODELO, m);
          setSalvo(true);
        }}
      />
    </div>
  );
}
