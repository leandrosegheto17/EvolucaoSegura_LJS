import { VALOR_MAXIMO_CENTAVOS } from '@es/contrato/financeiro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input, Skeleton } from '../../ui';
import { type EscopoPreco, type PrecoLido, lerPreco, salvarPreco } from './api.ts';

// FIN-09: telas de preço do paciente e da sessão, portadas de billing/price (PriceEditor,
// usePriceEditor, PatientPricePage) do legado com o mesmo layout (valor atual, campo em reais com
// "até 2 casas decimais", Salvar, aviso de conflito). O valor trafega em centavos inteiros
// (ADR-007): o campo é em reais e é convertido aqui, sem passar por ponto flutuante.
// - GET 404 = sem preço: o PUT vai sem row_version (cria); GET 200 = o PUT leva o row_version lido.
// - 409 `versao_divergente`: recarrega o valor atual, avisa e mantém o que foi digitado.

const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const emReais = (centavos: number) => REAIS.format(centavos / 100);
const MENSAGEM_FAIXA = `Informe um valor entre R$ 0,00 e ${emReais(VALOR_MAXIMO_CENTAVOS)}, com até 2 casas decimais.`;

/**
 * Reais digitados ("1.234,56", "150,5", "150.50", "R$ 10") em centavos inteiros; null se o formato
 * for inválido, tiver mais de 2 casas decimais ou passar do teto.
 */
export function paraCentavos(texto: string): number | null {
  const s = texto.replace(/R\$|\s/g, '');
  const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s) ?? /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const inteiro = (m[1] ?? '').replaceAll('.', '');
  const centavos = Number(inteiro) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(centavos) && centavos <= VALOR_MAXIMO_CENTAVOS ? centavos : null;
}

/** Centavos no formato do campo ("120,00"). */
export const centavosParaCampo = (centavos: number): string =>
  (centavos / 100).toFixed(2).replace('.', ',');

const ROTULO: Record<EscopoPreco, string> = {
  paciente: 'Valor padrão da sessão',
  sessao: 'Ajuste desta sessão (exceção ao valor padrão)',
};
const TITULO: Record<EscopoPreco, string> = {
  paciente: 'Valor da sessão do paciente',
  sessao: 'Valor desta sessão',
};

function PrecoPage({ escopo }: { escopo: EscopoPreco }) {
  const { id = '' } = useParams();
  const cliente = useQueryClient();
  const chave = ['preco', escopo, id];
  const consulta = useQuery({
    queryKey: chave,
    // 404 = ainda sem preço: não é erro, é o formulário de criação.
    queryFn: async ({ signal }): Promise<PrecoLido | null> => {
      try {
        return await lerPreco(escopo, id, signal);
      } catch (e) {
        if (ehErroApi(e) && e.status === 404) return null;
        throw e;
      }
    },
  });
  const atual = consulta.data ?? null;
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [erroLocal, setErroLocal] = useState(false);
  const [conflito, setConflito] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroApi, setErroApi] = useState(false);

  // O campo nasce com o valor lido e nunca é sobrescrito depois (409 não perde o digitado).
  useEffect(() => {
    if (consulta.isSuccess && rascunho === null)
      setRascunho(atual === null ? '' : centavosParaCampo(atual.valor));
  }, [consulta.isSuccess, atual, rascunho]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const centavos = paraCentavos(rascunho ?? '');
    if (centavos === null) {
      setErroLocal(true);
      return;
    }
    setErroLocal(false);
    setErroApi(false);
    setSalvando(true);
    try {
      const salvo = await salvarPreco(
        escopo,
        id,
        atual === null ? { valor: centavos } : { valor: centavos, row_version: atual.row_version },
      );
      setConflito(false);
      setRascunho(centavosParaCampo(salvo.valor));
      cliente.setQueryData(chave, salvo);
    } catch (erro) {
      if (ehErroApi(erro) && erro.status === 409) {
        setConflito(true);
        await consulta.refetch();
      } else if (ehErroApi(erro) && (erro.status === 422 || erro.status === 400)) {
        setErroLocal(true);
      } else {
        setErroApi(true);
      }
    } finally {
      setSalvando(false);
    }
  }

  const semValor =
    escopo === 'sessao' ? 'Esta sessão usa o valor padrão do paciente.' : 'Sem valor definido.';
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">{TITULO[escopo]}</h1>
      {consulta.isPending && <Skeleton className="h-32" />}
      {consulta.isError && (
        <Alert tone="err">
          Não foi possível carregar o valor.{' '}
          <Button onClick={() => void consulta.refetch()}>Tentar novamente</Button>
        </Alert>
      )}
      {consulta.isSuccess && (
        <form onSubmit={(e) => void enviar(e)} noValidate className="flex max-w-md flex-col gap-3">
          <p aria-live="polite">
            {atual === null ? semValor : `Valor atual: ${emReais(atual.valor)}`}
          </p>
          {conflito && (
            <Alert tone="warn">
              <p>
                O valor foi alterado em outra sessão e o valor atual foi recarregado. O que você
                digitou foi mantido: revise e salve novamente.
              </p>
              {atual !== null && (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => {
                    setRascunho(centavosParaCampo(atual.valor));
                    setConflito(false);
                  }}
                >
                  Usar o valor atual
                </Button>
              )}
            </Alert>
          )}
          {erroApi && <Alert tone="err">Não foi possível salvar o valor. Tente novamente.</Alert>}
          <Field
            label={ROTULO[escopo]}
            hint="Em reais, com até 2 casas decimais."
            error={erroLocal ? MENSAGEM_FAIXA : undefined}
          >
            {(p) => (
              <Input
                {...p}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={rascunho ?? ''}
                onChange={(e) => setRascunho(e.target.value)}
              />
            )}
          </Field>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={salvando}>
              Salvar
            </Button>
            <Link to="/app/financeiro" className="font-semibold text-pri underline">
              Voltar ao financeiro
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

export const PrecoPacientePage = () => <PrecoPage escopo="paciente" />;
export const PrecoSessaoPage = () => <PrecoPage escopo="sessao" />;
