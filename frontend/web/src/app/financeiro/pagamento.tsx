import { MEIOS_PAGAMENTO, type Pagamento } from '@es/contrato/financeiro';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input, Select } from '../../ui';
import { registrarPagamento } from './api.ts';
import { paraCentavos } from './preco.tsx';

// FIN-09: registrar ou corrigir o pagamento de uma sessão, portado de billing/payment/PaymentPage.tsx
// do legado com o mesmo layout (data, meio, "Marcar como pago", alerta de duplicidade com "Corrigir
// lançamento" e "Cancelar", aviso de sessão sem valor). Valor opcional, em reais, enviado em
// centavos (ADR-007); vazio = a API usa o preço da sessão ou do paciente.
// - 422 PRICE_REQUIRED: pede o valor. 422 PAYMENT_DUPLICATE: pede confirmação explícita e só então
//   reenvia com confirmar_duplicidade: true.
// SPEC_DEVIATION: o legado listava o histórico de correções e ajustava o preço na própria página;
// aqui o ajuste de preço tem rota própria (T166) e o link leva a ela. Não existe GET de pagamento
// (decisão do usuário): a tela não afirma se a sessão já foi paga, a duplicidade vem do 422.
// O cliente `api` não expõe o status HTTP; 201 x 200 é deduzido: sem confirmar_duplicidade a API só
// responde sucesso criando (201); com ele, corrige (200).

const ROTULO_MEIO: Record<(typeof MEIOS_PAGAMENTO)[number], string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao: 'Cartão',
  transferencia: 'Transferência',
  outro: 'Outro',
};
const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MENSAGEM_VALOR =
  'Informe um valor entre R$ 0,00 e R$ 99.999.999,99, com até 2 casas decimais.';

/** Hoje (AAAA-MM-DD) em America/Sao_Paulo, independente do fuso do aparelho. */
export const hojeSaoPaulo = (agora: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);

const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

interface Resultado {
  pagamento: Pagamento;
  corrigido: boolean;
}

export function PagamentoPage() {
  const { sessaoId = '' } = useParams();
  const [data, setData] = useState(hojeSaoPaulo());
  const [meio, setMeio] = useState('');
  const [valor, setValor] = useState('');
  const [erros, setErros] = useState<{ data?: string; meio?: string; valor?: string }>({});
  const [ocupado, setOcupado] = useState(false);
  const [duplicado, setDuplicado] = useState(false);
  const [semPreco, setSemPreco] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function enviar(confirmar: boolean) {
    const centavos = valor.trim() === '' ? undefined : paraCentavos(valor);
    if (centavos === null) {
      setErros({ valor: MENSAGEM_VALOR });
      return;
    }
    setOcupado(true);
    setAviso(null);
    setSemPreco(false);
    try {
      const pagamento = await registrarPagamento(sessaoId, {
        data,
        meio: meio as (typeof MEIOS_PAGAMENTO)[number],
        ...(centavos !== undefined ? { valor: centavos } : {}),
        ...(confirmar ? { confirmar_duplicidade: true } : {}),
      });
      setResultado({ pagamento, corrigido: confirmar });
      setDuplicado(false);
    } catch (e) {
      if (ehErroApi(e) && e.status === 422 && e.codigo === 'PAYMENT_DUPLICATE') setDuplicado(true);
      else if (ehErroApi(e) && e.status === 422 && e.codigo === 'PRICE_REQUIRED') {
        setDuplicado(false);
        setSemPreco(true);
      } else if (ehErroApi(e) && e.status === 404) setAviso('Sessão não encontrada.');
      else setAviso('Não foi possível salvar o pagamento. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  function aoEnviar(e: FormEvent) {
    e.preventDefault();
    const proximos = {
      ...(data ? {} : { data: 'Informe a data.' }),
      ...(meio ? {} : { meio: 'Informe o meio de pagamento.' }),
    };
    setErros(proximos);
    setResultado(null);
    if (Object.keys(proximos).length > 0) return;
    void enviar(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Pagamento da sessão</h1>
      <p className="text-mut">
        Controle só cadastral: sessão paga ou não. Sem Pix, cobrança automática ou recibo.
      </p>

      {resultado && (
        <Alert tone="ok">
          <b>{resultado.corrigido ? 'Pagamento corrigido' : 'Sessão marcada como paga'}</b> em{' '}
          {dia(resultado.pagamento.data)} ({ROTULO_MEIO[resultado.pagamento.meio]}),{' '}
          {REAIS.format(resultado.pagamento.valor / 100)}.
        </Alert>
      )}
      {aviso && <Alert tone="err">{aviso}</Alert>}
      {semPreco && (
        <Alert tone="err">
          Informe o valor: não há preço definido para esta sessão nem para o paciente. Digite o
          valor abaixo ou ajuste o preço da sessão.{' '}
          <Link
            to={`/app/financeiro/preco/sessao/${encodeURIComponent(sessaoId)}`}
            className="font-semibold underline"
          >
            Ajustar valor desta sessão
          </Link>
        </Alert>
      )}
      {duplicado && (
        <Alert tone="warn">
          <p>
            <b>Esta sessão já tem pagamento registrado.</b> Corrigir mantém o lançamento original no
            histórico.
          </p>
          <div className="mt-2 flex gap-2">
            <Button disabled={ocupado} onClick={() => void enviar(true)}>
              Corrigir lançamento
            </Button>
            <Button variant="outline" onClick={() => setDuplicado(false)}>
              Cancelar
            </Button>
          </div>
        </Alert>
      )}

      <form onSubmit={aoEnviar} noValidate className="flex max-w-md flex-col gap-3">
        <Field label="Data do pagamento" required error={erros.data}>
          {(p) => (
            <Input {...p} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          )}
        </Field>
        <Field label="Meio de pagamento" required error={erros.meio}>
          {(p) => (
            <Select {...p} value={meio} onChange={(e) => setMeio(e.target.value)}>
              <option value="">Selecione</option>
              {MEIOS_PAGAMENTO.map((m) => (
                <option key={m} value={m}>
                  {ROTULO_MEIO[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Valor (opcional)"
          hint="Em reais. Vazio usa o valor da sessão ou o padrão do paciente."
          error={erros.valor}
        >
          {(p) => (
            <Input
              {...p}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          )}
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={ocupado}>
            Marcar como pago
          </Button>
          <Link to="/app/financeiro" className="font-semibold text-pri underline">
            Voltar ao financeiro
          </Link>
        </div>
      </form>
    </div>
  );
}
