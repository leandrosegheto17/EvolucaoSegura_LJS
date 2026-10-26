import { type Especialidade, type Perfil, esquemaPerfilEntrada } from '@es/contrato/perfil';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input, Select, Skeleton, Spinner } from '../../ui';
import { CHAVE_EU } from '../shell.tsx';
import { CHAVE_PERFIL, lerPerfil, salvarPerfil } from './api.ts';

// PERF-01, PERF-02, PERF-03: tela "Meu perfil profissional", portada de features/profile do
// legado (ProfilePage, useProfileForm, profileForm, WeekendDays, RegFields e specialtyLabels).
// Mesma ordem e mesmos componentes do legado, com duas diferenças que a spec impõe:
// - Uma especialidade só (PERF-03), escolhida no próprio formulário e salva com ele no mesmo PUT.
//   O legado tinha a seção "Especialidades" à parte, com várias, cada uma com o próprio botão.
// - Sem histórico de alterações (não está na spec): o texto não promete histórico.
// Os campos seguem os limites do contrato (esquemaPerfilEntrada), conferidos antes do PUT. Erro do
// servidor na troca de especialidade (ex.: 409 SPECIALTY_HAS_ANAMNESIS, PERF-05) aparece na tela.
// O 409 de fim de semana (PERF-06) chega com a etapa da agenda.

export const TIPO_LABEL: Record<Especialidade, string> = {
  psicologia: 'Psicologia',
  nutricao: 'Nutrição',
  fisioterapia: 'Fisioterapia',
  outra: 'Outra',
};

// Limites do contrato (PERF-02, PERF-03).
export const LIMITES = {
  nome: 200,
  contato: 200,
  endereco: 300,
  especialidade_nome: 60,
  conselho: 40,
  numero_registro: 40,
  regiao: 100,
} as const;

const LABELS = {
  nome: 'Nome completo',
  contato: 'Contato (telefone ou e-mail)',
  endereco: 'Endereço do consultório',
};

const MSG = {
  nome: 'Informe o nome completo.',
  especialidade: 'Escolha a especialidade.',
  especialidadeNome: 'Informe o nome da especialidade (1 a 60 caracteres).',
  invalido: 'Confira os campos: algum valor é inválido ou longo demais.',
  anamnese: 'Esta especialidade já tem anamnese registrada e não pode ser trocada.',
  salvar: 'Não foi possível salvar agora. Tente novamente.',
};

interface Formulario {
  nome: string;
  contato: string;
  endereco: string;
  atende_sabado: boolean;
  atende_domingo: boolean;
  tipo: Especialidade | '';
  especialidade_nome: string;
  conselho: string;
  numero_registro: string;
  regiao: string;
}

const VAZIO: Formulario = {
  nome: '',
  contato: '',
  endereco: '',
  atende_sabado: false,
  atende_domingo: false,
  tipo: '',
  especialidade_nome: '',
  conselho: '',
  numero_registro: '',
  regiao: '',
};

const paraFormulario = (p: Perfil): Formulario => ({
  nome: p.nome,
  contato: p.contato ?? '',
  endereco: p.endereco ?? '',
  atende_sabado: p.atende_sabado,
  atende_domingo: p.atende_domingo,
  tipo: p.especialidade?.tipo ?? '',
  especialidade_nome: p.especialidade?.nome ?? '',
  conselho: p.especialidade?.conselho ?? '',
  numero_registro: p.especialidade?.numero_registro ?? '',
  regiao: p.especialidade?.regiao ?? '',
});

const DAYS = [
  { key: 'atende_sabado', label: 'Atendo aos sábados' },
  { key: 'atende_domingo', label: 'Atendo aos domingos' },
] as const;

type Erros = { nome?: string; especialidade?: string; especialidadeNome?: string };

export function ProfilePage() {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVE_PERFIL, queryFn: ({ signal }) => lerPerfil(signal) });
  const naoSalvo = ehErroApi(consulta.error) && consulta.error.status === 404;
  const load = consulta.isPending ? 'loading' : consulta.isError && !naoSalvo ? 'error' : 'ready';

  const [salvo, setSalvo] = useState<Formulario>(VAZIO);
  const [form, setForm] = useState<Formulario>(VAZIO);
  const [erros, setErros] = useState<Erros>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle');
  const [erroServidor, setErroServidor] = useState<string>();

  useEffect(() => {
    if (!consulta.data) return;
    setSalvo(paraFormulario(consulta.data));
    setForm(paraFormulario(consulta.data));
  }, [consulta.data]);

  const incompleto = naoSalvo || (consulta.data !== undefined && !consulta.data.especialidade);
  const set =
    <K extends keyof Formulario>(k: K) =>
    (v: Formulario[K]) =>
      setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErroServidor(undefined);
    const corpo = {
      nome: form.nome,
      contato: form.contato,
      endereco: form.endereco,
      atende_sabado: form.atende_sabado,
      atende_domingo: form.atende_domingo,
      especialidade: {
        tipo: form.tipo,
        nome: form.tipo === 'outra' ? form.especialidade_nome : null,
        conselho: form.conselho,
        numero_registro: form.numero_registro,
        regiao: form.regiao,
      },
    };
    const lido = esquemaPerfilEntrada.safeParse(corpo);
    if (!lido.success) {
      const caminhos = lido.error.issues.map((i) => i.path.join('.'));
      setErros({
        ...(caminhos.includes('nome') ? { nome: form.nome.trim() ? MSG.invalido : MSG.nome } : {}),
        ...(caminhos.includes('especialidade.tipo') ? { especialidade: MSG.especialidade } : {}),
        ...(caminhos.includes('especialidade.nome')
          ? { especialidadeNome: MSG.especialidadeNome }
          : {}),
      });
      return setStatus('idle');
    }
    setErros({});
    setStatus('saving');
    try {
      const perfil = await salvarPerfil(lido.data);
      qc.setQueryData(CHAVE_PERFIL, perfil);
      void qc.invalidateQueries({ queryKey: CHAVE_EU });
      setSalvo(paraFormulario(perfil));
      setForm(paraFormulario(perfil));
      setStatus('ok');
    } catch (erro) {
      if (ehErroApi(erro) && erro.codigo === 'SPECIALTY_HAS_ANAMNESIS')
        setErroServidor(MSG.anamnese);
      else if (ehErroApi(erro) && erro.status === 422) setErroServidor(MSG.invalido);
      else if (ehErroApi(erro) && erro.status === 409) setErroServidor(erro.message);
      else setErroServidor(MSG.salvar);
      setStatus('err');
    }
  }

  function cancel() {
    setForm(salvo);
    setErros({});
    setErroServidor(undefined);
    setStatus('idle');
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold">Meu perfil profissional</h1>
        <p className="text-mut">Dados usados no cabeçalho dos documentos em PDF.</p>
      </header>

      {load === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Spinner label="Carregando perfil" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {load === 'error' && (
        <div className="flex flex-col gap-3">
          <Alert tone="err">Não foi possível carregar o perfil.</Alert>
          <Button type="button" onClick={() => void consulta.refetch()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {load === 'ready' && (
        <>
          {incompleto && (
            <Alert tone="warn">
              <b>Complete seu perfil.</b> Informe o nome e a especialidade para começar a usar o
              app.
            </Alert>
          )}
          {status === 'ok' && <Alert tone="ok">Perfil atualizado.</Alert>}
          {status === 'err' && erroServidor && <Alert tone="err">{erroServidor}</Alert>}
          <form
            onSubmit={submit}
            noValidate
            className="flex flex-col gap-4"
            aria-busy={status === 'saving'}
          >
            <Field label={LABELS.nome} error={erros.nome} required>
              {(f) => (
                <Input
                  {...f}
                  autoComplete="name"
                  maxLength={LIMITES.nome}
                  value={form.nome}
                  onChange={(e) => set('nome')(e.target.value)}
                />
              )}
            </Field>
            <Field label={LABELS.contato}>
              {(f) => (
                <Input
                  {...f}
                  autoComplete="off"
                  maxLength={LIMITES.contato}
                  value={form.contato}
                  onChange={(e) => set('contato')(e.target.value)}
                />
              )}
            </Field>
            <Field label={LABELS.endereco}>
              {(f) => (
                <Input
                  {...f}
                  autoComplete="street-address"
                  maxLength={LIMITES.endereco}
                  value={form.endereco}
                  onChange={(e) => set('endereco')(e.target.value)}
                />
              )}
            </Field>

            <fieldset className="flex flex-col gap-3">
              <legend className="font-heading text-lg font-bold">Especialidade</legend>
              <Field label="Especialidade" error={erros.especialidade} required>
                {(p) => (
                  <Select
                    {...p}
                    value={form.tipo}
                    onChange={(e) => set('tipo')(e.target.value as Especialidade | '')}
                  >
                    <option value="">Selecione</option>
                    {(Object.keys(TIPO_LABEL) as Especialidade[]).map((t) => (
                      <option key={t} value={t}>
                        {TIPO_LABEL[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                {form.tipo === 'outra' && (
                  <Field label="Nome da especialidade" error={erros.especialidadeNome} required>
                    {(p) => (
                      <Input
                        {...p}
                        maxLength={LIMITES.especialidade_nome}
                        value={form.especialidade_nome}
                        onChange={(e) => set('especialidade_nome')(e.target.value)}
                      />
                    )}
                  </Field>
                )}
                <Field label="Conselho">
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={LIMITES.conselho}
                      value={form.conselho}
                      onChange={(e) => set('conselho')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Número do registro">
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={LIMITES.numero_registro}
                      value={form.numero_registro}
                      onChange={(e) => set('numero_registro')(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Região">
                  {(p) => (
                    <Input
                      {...p}
                      maxLength={LIMITES.regiao}
                      value={form.regiao}
                      onChange={(e) => set('regiao')(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3">
              <legend className="font-heading text-lg font-bold">Dias de atendimento</legend>
              {DAYS.map((d) => (
                <div key={d.key} className="flex min-h-[44px] items-start gap-3">
                  <input
                    id={`dia-${d.key}`}
                    type="checkbox"
                    role="switch"
                    className="mt-1 h-6 w-6"
                    checked={form[d.key]}
                    aria-describedby={`ajuda-${d.key}`}
                    onChange={(e) => set(d.key)(e.target.checked)}
                  />
                  <div>
                    <label htmlFor={`dia-${d.key}`} className="font-medium">
                      {d.label}{' '}
                      <span className="text-mut">({form[d.key] ? 'ligado' : 'desligado'})</span>
                    </label>
                    <p id={`ajuda-${d.key}`} className="text-mut">
                      Mostra o dia na agenda e no Início e permite agendar nele
                    </p>
                  </div>
                </div>
              ))}
            </fieldset>

            <div className="flex gap-3">
              <Button type="submit" disabled={status === 'saving'}>
                {status === 'saving' ? <Spinner label="Salvando" /> : 'Salvar alterações'}
              </Button>
              <Button type="button" variant="outline" onClick={cancel}>
                Cancelar
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
