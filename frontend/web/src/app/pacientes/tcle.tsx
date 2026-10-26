import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, Card, Field, Input, Skeleton } from '../../ui';
import { listarTcles, registrarTcle } from './api.ts';

// PAC-05: cartão Consentimentos da ficha, portado de patients/ficha/ConsentsCard.tsx do legado
// com o mesmo layout e os mesmos textos, só com o TCLE (a seção de ciência de IA sai: fora do
// escopo). O registro é só por inclusão: não há botão de editar nem de excluir. Os campos seguem
// os limites do contrato (finalidade até 500, versão até 50, data do calendário).

const formatar = (d: string) => d.split('-').reverse().join('/');
const hoje = () => new Date().toISOString().slice(0, 10);

export function ConsentsCard({ id }: { id: string }) {
  const qc = useQueryClient();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const toggleRef = useRef<HTMLDivElement>(null);
  const lista = useQuery({
    queryKey: ['tcles', id],
    queryFn: ({ signal }) => listarTcles(id, signal),
  });
  const [aberto, setAberto] = useState(false);
  const [registrado, setRegistrado] = useState(false);
  const [finalidade, setFinalidade] = useState('');
  const [data, setData] = useState(hoje());
  const [versao, setVersao] = useState('');
  const [erro, setErro] = useState('');
  const registro = useMutation({
    mutationFn: () =>
      registrarTcle(id, { finalidade: finalidade.trim(), data, versao: versao.trim() }),
    onSuccess: () => {
      setFinalidade('');
      setVersao('');
      setErro('');
      setAberto(false);
      setRegistrado(true);
      void qc.invalidateQueries({ queryKey: ['tcles', id] });
      toggleRef.current?.querySelector('button')?.focus();
    },
  });

  useEffect(() => {
    if (aberto) formRef.current?.querySelector('input')?.focus();
  }, [aberto]);

  const alternar = () => {
    setRegistrado(false);
    if (!aberto) registro.reset();
    setAberto(!aberto);
  };

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!finalidade.trim() || !versao.trim() || !data)
      return setErro('Preencha finalidade, data e versão do termo.');
    setErro('');
    registro.mutate();
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-bold">Consentimentos</h2>
      <section aria-label="TCLE" className="flex flex-col gap-2">
        <h3 className="font-semibold">TCLE/LGPD</h3>
        {lista.isPending && <Skeleton className="h-8" />}
        {lista.isError && <Alert tone="err">Não foi possível carregar os TCLEs.</Alert>}
        {lista.data && lista.data.length === 0 && (
          <p className="text-mut">Nenhum TCLE registrado.</p>
        )}
        {lista.data && lista.data.length > 0 && (
          <ul>
            {lista.data.map((c) => (
              <li key={c.id}>
                {formatar(c.data)} · versão {c.versao} · {c.finalidade}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-mut">Registros de TCLE não podem ser editados nem excluídos.</p>
        {registrado && <Alert tone="ok">TCLE registrado.</Alert>}
        <div ref={toggleRef}>
          <Button
            variant="outline"
            aria-expanded={aberto}
            aria-controls={formId}
            onClick={alternar}
          >
            Registrar novo TCLE
          </Button>
        </div>
        <form
          ref={formRef}
          id={formId}
          hidden={!aberto}
          noValidate
          onSubmit={enviar}
          className="flex flex-col gap-2"
          aria-label="Registrar TCLE"
        >
          <Field
            label="Finalidade"
            required
            hint="Não coloque conteúdo clínico neste campo (sintomas, diagnóstico, relato). Descreva apenas a finalidade do consentimento. Texto livre, até 500 caracteres."
          >
            {(c) => (
              <Input
                {...c}
                maxLength={500}
                value={finalidade}
                onChange={(e) => setFinalidade(e.target.value)}
              />
            )}
          </Field>
          <Field label="Data do consentimento" required>
            {(c) => (
              <Input {...c} type="date" value={data} onChange={(e) => setData(e.target.value)} />
            )}
          </Field>
          <Field label="Versão do termo" required>
            {(c) => (
              <Input
                {...c}
                maxLength={50}
                value={versao}
                onChange={(e) => setVersao(e.target.value)}
              />
            )}
          </Field>
          {erro && <Alert tone="err">{erro}</Alert>}
          {registro.isError && (
            <Alert tone="err">Não foi possível registrar o TCLE. Tente novamente.</Alert>
          )}
          <Button type="submit" disabled={registro.isPending}>
            Registrar TCLE
          </Button>
        </form>
      </section>
    </Card>
  );
}
