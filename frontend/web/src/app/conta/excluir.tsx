import { DIAS_ATE_PURGA, type RequisitoExclusao } from '@es/contrato/conta';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input } from '../../ui';
import { useExportacaoCompleta } from '../exportar/exportar.tsx';

// T153 / CONTA-01, CONTA-02: tela /app/conta/excluir, aberta pelas Configurações. O fluxo traz os
// três requisitos do pedido, em ordem: (1) a exportação completa, feita aqui mesmo com a mesma
// rotina da tela de exportação; (2) a declaração de guarda do prontuário; (3) a senha. O botão de
// pedir só fica ativo com os três. O servidor confere tudo de novo (a exportação tem de ter sido
// servida nas últimas 24 horas) e, se recusar, a tela mostra cada requisito do 422.
// PREMISSA: a tela não sabe de exportação feita antes, noutra aba ou noutro dia (a API não expõe
// esse estado); o requisito da tela é exportar aqui. PREMISSA: textos escritos pelo implementador;
// não há mockup (.specs/mockup/ não existe), segue-se o padrão das Configurações e da exportação.

const MENSAGEM_REQUISITO: Record<RequisitoExclusao, string> = {
  exportacao:
    'Não encontramos uma exportação completa nas últimas 24 horas. Exporte seus dados de novo.',
  declaracao_guarda: 'Marque a declaração de guarda do prontuário.',
  senha: 'A senha está incorreta.',
};

const ehRequisito = (r: string): r is RequisitoExclusao => r in MENSAGEM_REQUISITO;

function mensagensDoErro(erro: unknown): string[] {
  if (ehErroApi(erro) && erro.status === 422 && erro.codigo === 'requisitos_exclusao') {
    const mensagens = (erro.requisitos ?? []).filter(ehRequisito).map((r) => MENSAGEM_REQUISITO[r]);
    if (mensagens.length > 0) return mensagens;
  }
  if (ehErroApi(erro) && erro.status === 429)
    return ['Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.'];
  return ['Não foi possível pedir a exclusão agora. Tente novamente.'];
}

export function ExcluirContaPage() {
  const exportacao = useExportacaoCompleta();
  const [declaracao, setDeclaracao] = useState(false);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [enviado, setEnviado] = useState(false);

  const podePedir = exportacao.concluida && declaracao && senha.length > 0 && !enviando;

  async function pedir() {
    setErros([]);
    setEnviado(false);
    setEnviando(true);
    try {
      await api.requisitar('/conta/excluir', {
        metodo: 'POST',
        corpo: { senha, declaracao_guarda: declaracao },
      });
      setEnviado(true);
      setSenha('');
    } catch (e) {
      setErros(mensagensDoErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold">Excluir minha conta</h1>
        <p className="text-mut">
          Depois de confirmar pelo e-mail, a conta fica bloqueada por {DIAS_ATE_PURGA} dias. Nesse
          prazo você pode desistir pelo link que enviaremos. Passado o prazo, todos os dados da
          conta são apagados de forma definitiva, inclusive os prontuários.
        </p>
      </header>

      <section aria-labelledby="excluir-exportar" className="flex flex-col gap-3">
        <h2 id="excluir-exportar" className="font-heading text-lg font-bold">
          1. Exporte seus dados
        </h2>
        <p className="text-mut">
          Baixe a cópia completa (dados e um PDF de prontuário por paciente) antes de pedir a
          exclusão.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportacao.exportar()}
            disabled={exportacao.ocupado}
          >
            {exportacao.ocupado ? 'Exportando…' : 'Exportar meus dados'}
          </Button>
        </div>
        <div role="status" aria-live="polite" className="text-mut">
          {exportacao.progresso}
        </div>
        {exportacao.concluida && (
          <Alert tone="ok">Exportação concluída. O arquivo foi baixado.</Alert>
        )}
        {exportacao.erro !== null && <Alert tone="err">{exportacao.erro}</Alert>}
      </section>

      <section aria-labelledby="excluir-guarda" className="flex flex-col gap-3">
        <h2 id="excluir-guarda" className="font-heading text-lg font-bold">
          2. Guarda do prontuário
        </h2>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={declaracao}
            onChange={(e) => setDeclaracao(e.target.checked)}
          />
          <span>
            Declaro que guardo a cópia exportada e assumo a guarda do prontuário dos meus pacientes
            pelo prazo exigido pelo meu conselho profissional.
          </span>
        </label>
      </section>

      <section aria-labelledby="excluir-senha" className="flex flex-col gap-3">
        <h2 id="excluir-senha" className="font-heading text-lg font-bold">
          3. Confirme com a sua senha
        </h2>
        <Field label="Senha">
          {(controle) => (
            <Input
              {...controle}
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          )}
        </Field>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => void pedir()} disabled={!podePedir}>
          Pedir a exclusão
        </Button>
        <Link to="/app/configuracoes" className="underline">
          Voltar às Configurações
        </Link>
      </div>

      {enviado && (
        <Alert tone="ok">
          Enviamos um link de confirmação para o seu e-mail. Ele vale por 30 minutos; a exclusão só
          começa quando você abrir o link e confirmar.
        </Alert>
      )}
      {erros.length > 0 && (
        <Alert tone="err">
          <ul className="list-disc pl-5">
            {erros.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
