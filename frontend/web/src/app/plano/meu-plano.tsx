import { type EstadoPlano, esquemaCpfCnpj } from '@es/contrato/plano';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Badge, Button, Field, Input, Skeleton } from '../../ui';
import { AlertDialog, DialogShell } from '../../ui/dialogs/Dialog';
import { assinarPlano, cancelarPlano, lerPlano } from './api.ts';

// PLANO-05, PLANO-11, PLANO-14: tela "Meu plano" (/app/plano). Sem equivalente no legado e sem
// mockup: segue o estilo das telas vizinhas (financeiro, auditoria).
// - Assinar só vale em trial e free; cancelar só em ativa (os demais estados dariam 409). A API não
//   manda `pode_assinar`/`pode_cancelar`: deduz-se pelo status.
// - O CPF/CNPJ é validado no cliente pelo mesmo esquema do contrato (dígito verificador), sem cópia.
// - Pix (copia-e-cola e QR) aparece quando a API devolve cobrança em aberto, também vencida.
// - 503 `cobranca_indisponivel` (Asaas fora): "Cobrança indisponível", sem derrubar o resto.
// - Dinheiro em centavos, formatado em reais (ADR-007).
// SPEC_DEVIATION: sem mockup do plano; o layout é uma composição de componentes do guia.

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MSG_INDISPONIVEL = 'Cobrança indisponível, tente em instantes.';
const MSG_CPF = 'Informe um CPF ou CNPJ válido.';

const ROTULO_STATUS: Record<EstadoPlano, { texto: string; tom: 'ok' | 'warn' | 'err' }> = {
  trial: { texto: 'Período de teste do Pro', tom: 'ok' },
  ativa: { texto: 'Pro ativo', tom: 'ok' },
  atrasada: { texto: 'Pagamento em atraso', tom: 'err' },
  cancelada: { texto: 'Pro cancelado', tom: 'warn' },
  free: { texto: 'Plano gratuito (Free)', tom: 'warn' },
};

const dataBr = (iso: string) => {
  // AAAA-MM-DD sem deslocar fuso; ISO completo no fuso local.
  const puro = /^\d{4}-\d{2}-\d{2}$/.exec(iso);
  if (puro) return iso.split('-').reverse().join('/');
  return new Date(iso).toLocaleDateString('pt-BR');
};

const indisponivel = (e: unknown) => ehErroApi(e) && e.status === 503;

export function MeuPlanoPage() {
  const cliente = useQueryClient();
  const consulta = useQuery({
    queryKey: ['plano'],
    queryFn: ({ signal }) => lerPlano(signal),
  });
  const [nome, setNome] = useState('');
  const [documento, setDocumento] = useState('');
  const [erroDocumento, setErroDocumento] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const assinar = useMutation({ mutationFn: assinarPlano });
  const cancelar = useMutation({ mutationFn: cancelarPlano });

  const recarregar = () => cliente.invalidateQueries({ queryKey: ['plano'] });

  async function enviarAssinatura(e: FormEvent) {
    e.preventDefault();
    setAviso(null);
    const doc = esquemaCpfCnpj.safeParse(documento);
    if (!doc.success || nome.trim() === '') {
      setErroDocumento(!doc.success);
      if (doc.success) setAviso('Informe o seu nome.');
      return;
    }
    setErroDocumento(false);
    try {
      await assinar.mutateAsync({ nome: nome.trim(), cpf_cnpj: doc.data });
      await recarregar();
    } catch (erro) {
      if (indisponivel(erro)) setAviso(MSG_INDISPONIVEL);
      else if (ehErroApi(erro) && erro.status === 422) setErroDocumento(true);
      else if (ehErroApi(erro) && erro.status === 409) {
        setAviso('A assinatura não permite esta operação agora. A tela foi atualizada.');
        await recarregar();
      } else setAviso('Não foi possível assinar. Tente novamente.');
    }
  }

  async function confirmarCancelamento() {
    setConfirmando(false);
    setAviso(null);
    try {
      await cancelar.mutateAsync();
      await recarregar();
    } catch (erro) {
      if (indisponivel(erro)) setAviso(MSG_INDISPONIVEL);
      else if (ehErroApi(erro) && erro.status === 409) {
        setAviso('A assinatura não pode ser cancelada agora. A tela foi atualizada.');
        await recarregar();
      } else setAviso('Não foi possível cancelar. Tente novamente.');
    }
  }

  const plano = consulta.data;
  const podeAssinar = plano?.status === 'trial' || plano?.status === 'free';
  const podeCancelar = plano?.status === 'ativa';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Meu plano</h1>
      {consulta.isPending && <Skeleton className="h-32" />}
      {consulta.isError &&
        (indisponivel(consulta.error) ? (
          <Alert tone="warn">{MSG_INDISPONIVEL}</Alert>
        ) : (
          <Alert tone="err">
            Não foi possível carregar o plano.{' '}
            <Button onClick={() => void consulta.refetch()}>Tentar novamente</Button>
          </Alert>
        ))}
      {aviso !== null && <Alert tone="err">{aviso}</Alert>}
      {plano !== undefined && (
        <>
          <section aria-label="Plano atual" className="flex flex-col gap-2">
            <p>
              Plano atual: <strong>{plano.plano === 'pro' ? 'Pro' : 'Free'}</strong>{' '}
              <Badge tone={ROTULO_STATUS[plano.status].tom}>
                {ROTULO_STATUS[plano.status].texto}
              </Badge>
            </p>
            {plano.data !== null && (
              <p>
                {plano.data.tipo === 'renovacao'
                  ? `Renovação em ${dataBr(plano.data.em)}.`
                  : `O Pro vai até ${dataBr(plano.data.em)}.`}
              </p>
            )}
          </section>

          {plano.pix !== null && (
            <section aria-label="Pagamento por Pix" className="flex max-w-md flex-col gap-2">
              <h2 className="font-heading text-xl font-bold">Pagamento por Pix</h2>
              <p>
                Valor: {REAIS.format(plano.pix.valor_centavos / 100)}. Vencimento:{' '}
                {dataBr(plano.pix.vencimento)}.
              </p>
              <img
                alt="QR code do Pix"
                width={200}
                height={200}
                src={`data:image/png;base64,${plano.pix.qr_code_png_base64}`}
              />
              <Field label="Pix copia e cola">
                {(p) => <Input {...p} readOnly value={plano.pix?.copia_e_cola ?? ''} />}
              </Field>
              <Button
                variant="outline"
                onClick={() => void navigator.clipboard?.writeText(plano.pix?.copia_e_cola ?? '')}
              >
                Copiar código Pix
              </Button>
            </section>
          )}

          {podeAssinar && (
            <form
              onSubmit={(e) => void enviarAssinatura(e)}
              noValidate
              aria-label="Assinar o Pro"
              className="flex max-w-md flex-col gap-3"
            >
              <h2 className="font-heading text-xl font-bold">Assinar o Pro</h2>
              <Field label="Nome completo">
                {(p) => (
                  <Input
                    {...p}
                    autoComplete="name"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label="CPF ou CNPJ"
                hint="Exigido para gerar a cobrança por Pix."
                error={erroDocumento ? MSG_CPF : undefined}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="text"
                    autoComplete="off"
                    value={documento}
                    onChange={(e) => setDocumento(e.target.value)}
                  />
                )}
              </Field>
              <div>
                <Button type="submit" disabled={assinar.isPending}>
                  Assinar
                </Button>
              </div>
            </form>
          )}

          {podeCancelar && (
            <div>
              <Button
                variant="outline"
                disabled={cancelar.isPending}
                onClick={() => setConfirmando(true)}
              >
                Cancelar assinatura
              </Button>
            </div>
          )}
        </>
      )}

      <DialogShell
        open={confirmando}
        onEscape={() => setConfirmando(false)}
        title="Cancelar a assinatura?"
        description={
          <p>O Pro continua até o fim do período já pago; depois a conta volta ao plano Free.</p>
        }
      >
        <AlertDialog.Cancel asChild>
          <Button variant="outline">Manter assinatura</Button>
        </AlertDialog.Cancel>
        <Button onClick={() => void confirmarCancelamento()}>Cancelar assinatura</Button>
      </DialogShell>
    </div>
  );
}
