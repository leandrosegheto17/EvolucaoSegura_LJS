import type { Evolucao, ModeloTexto } from '@es/contrato/clinico';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Field,
  Input,
  ModeloOptions,
  Select,
  Skeleton,
  Textarea,
} from '../../ui';
import { ConflictDialog } from '../../ui/dialogs';
import { AutosaveIndicator, EditWindowBadge } from '../../ui/new';
import {
  CHAVE_MODELOS_TEXTO,
  chaveEvolucoes,
  criarEvolucao,
  criarModeloTexto,
  editarEvolucao,
  editarModeloTexto,
  listarEvolucoes,
  listarModelosTexto,
  retificarEvolucao,
} from './api.ts';
import { useRascunhoTexto } from './rascunho.ts';

// EVO-01, EVO-04, EVO-05, RAS-03, RAS-04 (T106): telas da evolução do paciente e dos modelos de
// texto, portadas de features/clinical/evolution/ (EvolutionPage, EvolutionEditor,
// NewEvolutionForm, RectifyForm, RegisteredEvolution, VersionHistory, ModeloSelect) do legado,
// com o mesmo layout e os mesmos textos. O estado (selo "Editável hoje" ou "Registrada") vem do
// servidor: o cliente nunca calcula a virada do dia. Mensagens de erro são fixas: nunca repetem o
// texto digitado nem o do servidor (dado clínico).
// SPEC_DEVIATION: em relação ao legado, (1) a lista é paginada (50 por vez, "Carregar mais"),
// porque a API pagina; (2) o histórico das versões vem embutido na evolução (`retificacoes`), sem
// rota de versões; (3) entra a tela de modelos de texto (listar, criar, editar, arquivar), que no
// legado não tinha tela; (4) o rascunho do formulário de nova evolução também é guardado (ref =
// sessão, ou paciente quando não há sessão); (5) escolher um modelo acrescenta o corpo ao texto,
// em vez de substituí-lo, para não perder o que já foi digitado.

const formatar = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  });

// EVO-05: a versão vigente é a retificação de maior seq; sem retificação, a original.
const textoVigente = (e: Evolucao): string =>
  e.retificacoes.find((r) => r.seq === e.versao_vigente)?.texto ?? e.texto;

const acrescentar = (atual: string, corpo: string) =>
  atual.trim() === '' ? corpo : `${atual}\n\n${corpo}`;

// ---------------------------------------------------------------------------------------------
// Campo de texto com seleção de modelo (ModeloSelect do legado).

function CampoTexto({
  rotulo,
  valor,
  aoMudar,
  modelos,
  erro,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  modelos: ModeloTexto[];
  erro?: string | undefined;
}) {
  return (
    <>
      {modelos.length > 0 && (
        <Field label="Modelo">
          {(p) => (
            <Select
              {...p}
              value=""
              onChange={(e) => {
                const m = modelos.find((x) => x.id === e.target.value);
                if (m) aoMudar(acrescentar(valor, m.corpo));
              }}
            >
              <ModeloOptions vazio="Evolução livre" modelos={modelos} />
            </Select>
          )}
        </Field>
      )}
      <Field label={rotulo} error={erro}>
        {(p) => (
          <Textarea
            reading
            {...p}
            rows={8}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

// Aviso de rascunho (RAS-04) e de conflito (RAS-02), comuns ao editor e ao formulário novo.
function AvisosDoRascunho({
  r,
  aoRestaurar,
}: {
  r: ReturnType<typeof useRascunhoTexto>;
  aoRestaurar: (texto: string) => void;
}) {
  return (
    <>
      <AutosaveIndicator estado={r.estado} {...(r.salvoAs ? { salvoAs: r.salvoAs } : {})} />
      {r.oferta && (
        <Alert tone="warn">
          <p>Há um rascunho não salvo desta evolução, de {formatar(r.oferta.atualizado_em)}.</p>
          <div className="mt-2 flex gap-3">
            <Button
              onClick={() => {
                const t = r.restaurar();
                if (t !== null) aoRestaurar(t);
              }}
            >
              Restaurar rascunho
            </Button>
            <Button variant="outline" onClick={r.descartar}>
              Descartar rascunho
            </Button>
          </div>
        </Alert>
      )}
      <ConflictDialog
        open={r.conflito}
        onReload={() => void r.recarregar()}
        onClose={r.fecharConflito}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Nova evolução (NewEvolutionForm).

function NovaEvolucao({
  pacienteId,
  sessaoId,
  modelos,
  vazia,
  aoCriar,
}: {
  pacienteId: string;
  sessaoId: string | undefined;
  modelos: ModeloTexto[];
  vazia: boolean;
  aoCriar: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string>();
  const [aviso, setAviso] = useState<string>();
  const rascunho = useRascunhoTexto(sessaoId ?? pacienteId, texto, '');
  const criar = useMutation({
    mutationFn: () =>
      criarEvolucao({ paciente_id: pacienteId, sessao_id: sessaoId ?? null, texto }),
    onSuccess: async () => {
      await rascunho.alinhar('');
      aoCriar();
    },
    onError: (e) => {
      if (ehErroApi(e) && e.codigo === 'EVOLUTION_EXISTS')
        setAviso('Esta sessão já tem evolução. Recarregue a página.');
      else if (ehErroApi(e) && e.status === 422)
        setAviso('O texto é inválido ou grande demais. Seu texto foi mantido nesta tela.');
      else setAviso('Não foi possível registrar. Seu texto foi mantido nesta tela.');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const ok = texto.trim() !== '';
    setErro(ok ? undefined : 'Escreva o texto da evolução.');
    if (!ok) return;
    setAviso(undefined);
    criar.mutate();
  };

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Registrar evolução"
      aria-busy={criar.isPending}
      className="flex flex-col gap-4"
    >
      {vazia && <Empty title="Nenhuma evolução registrada" />}
      {aviso && <Alert tone="err">{aviso}</Alert>}
      <AvisosDoRascunho r={rascunho} aoRestaurar={setTexto} />
      <CampoTexto
        rotulo="Texto da evolução"
        valor={texto}
        aoMudar={setTexto}
        modelos={modelos}
        erro={erro}
      />
      <Alert tone="warn">
        Atenção: a evolução pode ser editada até 23:59 de hoje. Depois disso não poderá ser editada
        nem apagada; só retificada, mantendo o original visível.
      </Alert>
      <div>
        <Button type="submit" disabled={criar.isPending}>
          {criar.isPending ? 'Registrando...' : 'Registrar evolução'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Retificação (RectifyForm).

const MENSAGEM_RETIFICAR = {
  aberta: ['A evolução ainda pode ser editada hoje. Cancele e salve pela edição normal.', 'warn'],
  sem_conteudo: [
    'A retificação precisa alterar o texto em relação à versão vigente e ter um motivo.',
    'err',
  ],
  conflito: [
    'Outra retificação foi salva antes desta. Recarregue a página e refaça a retificação.',
    'warn',
  ],
  invalida: ['O texto ou o motivo é inválido ou grande demais. Seu texto foi mantido.', 'err'],
  erro: ['Não foi possível retificar. Seu texto foi mantido nesta tela.', 'err'],
} as const;

function FormularioRetificacao({
  evolucaoId,
  textoInicial,
  aoConcluir,
  aoCancelar,
}: {
  evolucaoId: string;
  textoInicial: string;
  aoConcluir: () => void;
  aoCancelar: () => void;
}) {
  const [texto, setTexto] = useState(textoInicial);
  const [motivo, setMotivo] = useState('');
  const [erros, setErros] = useState<{ texto?: string; motivo?: string }>({});
  const [falha, setFalha] = useState<keyof typeof MENSAGEM_RETIFICAR>();
  const retificar = useMutation({
    mutationFn: () => retificarEvolucao(evolucaoId, { texto, motivo }),
    onSuccess: aoConcluir,
    onError: (e) => {
      if (!ehErroApi(e)) return setFalha('erro');
      if (e.codigo === 'EDIT_WINDOW_OPEN') setFalha('aberta');
      else if (e.codigo === 'RECTIFICATION_CONFLICT') setFalha('conflito');
      else if (e.codigo === 'sem_conteudo_novo') setFalha('sem_conteudo');
      else if (e.status === 422) setFalha('invalida');
      else setFalha('erro');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const novos: { texto?: string; motivo?: string } = {};
    if (texto.trim() === '') novos.texto = 'Escreva o texto retificado.';
    if (motivo.trim() === '') novos.motivo = 'Informe o motivo da retificação.';
    setErros(novos);
    if (novos.texto || novos.motivo) return;
    setFalha(undefined);
    retificar.mutate();
  };

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Retificar evolução"
      aria-busy={retificar.isPending}
      className="flex flex-col gap-4"
    >
      <p className="text-mut">
        A versão original é preservada. Sua retificação cria uma nova versão com o motivo.
      </p>
      {falha && <Alert tone={MENSAGEM_RETIFICAR[falha][1]}>{MENSAGEM_RETIFICAR[falha][0]}</Alert>}
      <Field label="Texto retificado" error={erros.texto}>
        {(p) => (
          <Textarea
            reading
            {...p}
            rows={8}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        )}
      </Field>
      <Field label="Motivo da retificação" error={erros.motivo}>
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

// ---------------------------------------------------------------------------------------------
// Edição no dia do cadastro (EvolutionEditor).

type EstadoEdicao = 'ocioso' | 'sem_texto' | 'fechada' | 'divergente' | 'invalida' | 'erro';

const MENSAGEM_EDITAR: Record<Exclude<EstadoEdicao, 'ocioso' | 'fechada'>, string> = {
  sem_texto: 'Escreva o texto da evolução.',
  divergente:
    'A evolução foi alterada em outro lugar. Recarregue a página para ver a versão atual.',
  invalida: 'O texto é inválido ou grande demais. Seu texto foi mantido nesta tela.',
  erro: 'Não foi possível salvar. Seu texto foi mantido nesta tela.',
};

function EditorDoDia({
  evolucao,
  modelos,
  aoSalvar,
  aoRetificar,
}: {
  evolucao: Evolucao;
  modelos: ModeloTexto[];
  aoSalvar: () => void;
  aoRetificar: () => void;
}) {
  const [atual, setAtual] = useState(evolucao);
  const [base] = useState(evolucao.texto);
  const [texto, setTexto] = useState(evolucao.texto);
  const [estado, setEstado] = useState<EstadoEdicao>('ocioso');
  const fechada = estado === 'fechada';
  const rascunho = useRascunhoTexto(evolucao.id, texto, base, !fechada);
  const salvar = useMutation({
    mutationFn: () => editarEvolucao(atual.id, texto, atual.row_version),
    onSuccess: async (u) => {
      setAtual(u);
      setEstado('ocioso');
      await rascunho.alinhar(texto);
      aoSalvar();
    },
    onError: (e) => {
      if (!ehErroApi(e)) return setEstado('erro');
      if (e.codigo === 'EDIT_WINDOW_CLOSED') setEstado('fechada');
      else if (e.codigo === 'versao_divergente') setEstado('divergente');
      else if (e.status === 422) setEstado('invalida');
      else setEstado('erro');
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (texto.trim() === '') return setEstado('sem_texto');
    setEstado('ocioso');
    salvar.mutate();
  };

  // EVO-04: virou a meia-noite com a tela aberta. O servidor recusou a gravação; o texto fica na
  // tela e o formulário de retificação já abre com ele.
  if (fechada) {
    return (
      <section aria-label="Retificar evolução do dia" className="flex flex-col gap-4">
        <Alert tone="err">
          O prazo de edição terminou à 00:00. Seu texto foi mantido; salve como retificação
          informando o motivo.
        </Alert>
        <FormularioRetificacao
          evolucaoId={atual.id}
          textoInicial={texto}
          aoCancelar={() => setEstado('ocioso')}
          aoConcluir={aoRetificar}
        />
      </section>
    );
  }

  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label="Editar evolução"
      aria-busy={salvar.isPending}
      className="flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold">Evolução de hoje</h2>
        <EditWindowBadge estado="editavel_hoje" />
      </div>
      <p className="text-mut">Você pode editar até 23:59 de hoje.</p>
      <AvisosDoRascunho r={rascunho} aoRestaurar={setTexto} />
      {estado !== 'ocioso' && <Alert tone="err">{MENSAGEM_EDITAR[estado]}</Alert>}
      <CampoTexto rotulo="Texto da evolução" valor={texto} aoMudar={setTexto} modelos={modelos} />
      <div>
        <Button type="submit" disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Evolução registrada, com retificação e histórico (RegisteredEvolution e VersionHistory).

function Historico({ evolucao }: { evolucao: Evolucao }) {
  return (
    <ol aria-label="Histórico de versões" className="flex flex-col gap-3">
      <li className="rounded-card border border-line p-3">
        <p className="text-mut">
          Original · {formatar(evolucao.criado_em)}
          {evolucao.versao_vigente === 0 ? ' · Vigente' : ''}
        </p>
        <div className="max-w-[68ch] whitespace-pre-wrap font-reading text-lg leading-[1.75]">
          {evolucao.texto}
        </div>
      </li>
      {evolucao.retificacoes.map((v) => (
        <li key={v.seq} className="rounded-card border border-line p-3">
          <p className="text-mut">
            Retificação {v.seq} · {formatar(v.criado_em)}
            {v.seq === evolucao.versao_vigente ? ' · Vigente' : ''}
          </p>
          <p>
            <span className="font-semibold">Motivo:</span>{' '}
            <span className="whitespace-pre-wrap">{v.motivo}</span>
          </p>
          <div className="max-w-[68ch] whitespace-pre-wrap font-reading text-lg leading-[1.75]">
            {v.texto}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Registrada({ evolucao, aoRetificar }: { evolucao: Evolucao; aoRetificar: () => void }) {
  const [retificando, setRetificando] = useState(false);
  const [historico, setHistorico] = useState(false);
  return (
    <section
      aria-label={`Evolução registrada em ${formatar(evolucao.criado_em)}`}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold">
          Evolução de {formatar(evolucao.criado_em)}
        </h2>
        <EditWindowBadge estado="registrada" />
      </div>
      <div className="max-w-[68ch] whitespace-pre-wrap font-reading text-lg leading-[1.75]">
        {textoVigente(evolucao)}
      </div>
      {!retificando && (
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setRetificando(true)}>
            Retificar
          </Button>
          <Button
            variant="outline"
            aria-expanded={historico}
            onClick={() => setHistorico((h) => !h)}
          >
            {historico ? 'Ocultar histórico de versões' : 'Ver histórico de versões'}
          </Button>
        </div>
      )}
      {retificando && (
        <FormularioRetificacao
          evolucaoId={evolucao.id}
          textoInicial={textoVigente(evolucao)}
          aoCancelar={() => setRetificando(false)}
          aoConcluir={() => {
            setRetificando(false);
            setHistorico(true);
            aoRetificar();
          }}
        />
      )}
      {historico && <Historico evolucao={evolucao} />}
      <p className="text-mut">
        Registrada em {formatar(evolucao.criado_em)}. Não há opção de editar ou apagar.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Página da evolução do paciente (EvolutionPage).

const AVISO_RETIFICADA = 'Retificação registrada. O original continua no histórico.';

export function EvolucaoPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const sessaoId = params.get('sessao') ?? undefined;
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string>();
  const evolucoes = useInfiniteQuery({
    queryKey: chaveEvolucoes(id),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => listarEvolucoes(id, pageParam, signal),
    getNextPageParam: (ultima) =>
      ultima.items.length >= ultima.limit ? ultima.offset + ultima.limit : undefined,
  });
  // Sem modelos a tela segue: o seletor só não aparece.
  const modelos = useQuery({
    queryKey: [...CHAVE_MODELOS_TEXTO, false],
    queryFn: ({ signal }) => listarModelosTexto(false, signal),
  });

  const titulo = <h1 className="font-heading text-2xl font-bold">Evolução</h1>;
  if (evolucoes.isPending) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        {titulo}
        <Skeleton className="h-10" />
      </div>
    );
  }
  if (evolucoes.isError) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {titulo}
        <Alert tone="err">Não foi possível carregar as evoluções.</Alert>
        <Button onClick={() => void evolucoes.refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const itens = evolucoes.data.pages.flatMap((p) => p.items);
  const editaveis = itens.filter((e) => e.estado === 'editavel_hoje');
  const registradas = itens.filter((e) => e.estado !== 'editavel_hoje');
  const recarregar = (mensagem: string) => {
    setAviso(mensagem);
    void qc.invalidateQueries({ queryKey: chaveEvolucoes(id) });
  };
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        {titulo}
        <Link to="/app/modelos-texto" className="font-semibold underline">
          Modelos de texto
        </Link>
      </header>
      {aviso && <Alert tone="ok">{aviso}</Alert>}
      {editaveis.map((e) => (
        <EditorDoDia
          key={e.id}
          evolucao={e}
          modelos={modelos.data ?? []}
          aoSalvar={() => recarregar('Evolução salva.')}
          aoRetificar={() => recarregar(AVISO_RETIFICADA)}
        />
      ))}
      {editaveis.length === 0 && (
        <NovaEvolucao
          pacienteId={id}
          sessaoId={sessaoId}
          modelos={modelos.data ?? []}
          vazia={itens.length === 0}
          aoCriar={() => recarregar('Evolução registrada.')}
        />
      )}
      {registradas.map((e) => (
        <Registrada key={e.id} evolucao={e} aoRetificar={() => recarregar(AVISO_RETIFICADA)} />
      ))}
      {evolucoes.hasNextPage && (
        <div>
          <Button
            variant="outline"
            disabled={evolucoes.isFetchingNextPage}
            onClick={() => void evolucoes.fetchNextPage()}
          >
            Carregar mais evoluções
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Modelos de texto (RAS-03): listar, criar, editar e arquivar.

const MENSAGEM_MODELO = {
  TEMPLATE_NAME_EXISTS: 'Já existe um modelo com este nome.',
  validacao: 'Nome (1 a 200 caracteres) ou texto (até 50.000) inválido.',
  erro: 'Não foi possível salvar o modelo. Seu texto foi mantido nesta tela.',
} as const;

function FormularioModelo({
  inicial,
  rotuloBotao,
  aoSalvar,
  aoCancelar,
}: {
  inicial?: ModeloTexto;
  rotuloBotao: string;
  aoSalvar: (nome: string, corpo: string) => Promise<unknown>;
  aoCancelar?: () => void;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? '');
  const [corpo, setCorpo] = useState(inicial?.corpo ?? '');
  const [erroNome, setErroNome] = useState<string>();
  const [falha, setFalha] = useState<keyof typeof MENSAGEM_MODELO>();
  const gravar = useMutation({
    mutationFn: () => aoSalvar(nome.trim(), corpo),
    onSuccess: () => {
      if (!inicial) {
        setNome('');
        setCorpo('');
      }
    },
    onError: (e) => {
      if (ehErroApi(e) && e.codigo === 'TEMPLATE_NAME_EXISTS') setFalha('TEMPLATE_NAME_EXISTS');
      else if (ehErroApi(e) && e.status === 422) setFalha('validacao');
      else setFalha('erro');
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const ok = nome.trim() !== '';
    setErroNome(ok ? undefined : 'Informe o nome do modelo.');
    if (!ok) return;
    setFalha(undefined);
    gravar.mutate();
  };
  return (
    <form
      onSubmit={enviar}
      noValidate
      aria-label={inicial ? `Editar modelo ${inicial.nome}` : 'Novo modelo'}
      className="flex flex-col gap-3"
    >
      {falha && <Alert tone="err">{MENSAGEM_MODELO[falha]}</Alert>}
      <Field label="Nome do modelo" required error={erroNome}>
        {(p) => <Input {...p} value={nome} onChange={(e) => setNome(e.target.value)} />}
      </Field>
      <Field label="Texto do modelo">
        {(p) => (
          <Textarea
            reading
            {...p}
            rows={6}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
          />
        )}
      </Field>
      <div className="flex gap-3">
        <Button type="submit" disabled={gravar.isPending}>
          {rotuloBotao}
        </Button>
        {aoCancelar && (
          <Button type="button" variant="outline" onClick={aoCancelar}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}

export function ModelosTextoPage() {
  const qc = useQueryClient();
  const [arquivados, setArquivados] = useState(false);
  const [editando, setEditando] = useState<string>();
  const modelos = useQuery({
    queryKey: [...CHAVE_MODELOS_TEXTO, arquivados],
    queryFn: ({ signal }) => listarModelosTexto(arquivados, signal),
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: CHAVE_MODELOS_TEXTO });
  const arquivar = useMutation({
    mutationFn: (m: ModeloTexto) =>
      editarModeloTexto(m.id, { nome: m.nome, corpo: m.corpo, arquivado: !m.arquivado }),
    onSuccess: atualizar,
  });

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold">Modelos de texto</h1>
        <Link to="/app/agenda" className="font-semibold underline">
          Voltar à agenda
        </Link>
      </header>
      <section aria-label="Novo modelo" className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-bold">Novo modelo</h2>
        <FormularioModelo
          rotuloBotao="Criar modelo"
          aoSalvar={async (nome, corpo) => {
            await criarModeloTexto(nome, corpo);
            await atualizar();
          }}
        />
      </section>
      <label className="flex min-h-12 items-center gap-2">
        <input
          type="checkbox"
          className="size-6"
          checked={arquivados}
          onChange={(e) => setArquivados(e.target.checked)}
        />
        Mostrar arquivados
      </label>
      {arquivar.isError && (
        <Alert tone="err">Não foi possível alterar o modelo. Tente novamente.</Alert>
      )}
      {modelos.isPending && <Skeleton className="h-10" />}
      {modelos.isError && (
        <div className="flex flex-col gap-3">
          <Alert tone="err">Não foi possível carregar os modelos.</Alert>
          <Button onClick={() => void modelos.refetch()}>Tentar novamente</Button>
        </div>
      )}
      {modelos.data?.length === 0 && <Empty title="Nenhum modelo de texto" />}
      <ul className="flex flex-col gap-3">
        {modelos.data?.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 rounded-card border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{m.nome}</h2>
              {m.arquivado && <Badge tone="warn">Arquivado</Badge>}
            </div>
            {editando === m.id ? (
              <FormularioModelo
                inicial={m}
                rotuloBotao="Salvar modelo"
                aoCancelar={() => setEditando(undefined)}
                aoSalvar={async (nome, corpo) => {
                  await editarModeloTexto(m.id, { nome, corpo, arquivado: m.arquivado });
                  await atualizar();
                  setEditando(undefined);
                }}
              />
            ) : (
              <>
                <p className="max-w-[68ch] whitespace-pre-wrap font-reading">{m.corpo}</p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    aria-label={`Editar ${m.nome}`}
                    onClick={() => setEditando(m.id)}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    aria-label={`${m.arquivado ? 'Desarquivar' : 'Arquivar'} ${m.nome}`}
                    disabled={arquivar.isPending}
                    onClick={() => arquivar.mutate(m)}
                  >
                    {m.arquivado ? 'Desarquivar' : 'Arquivar'}
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
