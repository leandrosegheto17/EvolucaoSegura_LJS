import { VERSAO_PRIVACIDADE, VERSAO_TERMOS } from '@es/contrato/identidade';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Pagina } from './componentes.tsx';

// CONTA-06, CAD-07 (T154): /termos e /privacidade. As versões vêm do contrato, as mesmas gravadas
// no aceite; mudar o texto exige versão nova lá. A data é a da última alteração do texto.
// PREMISSA: texto escrito pelo implementador, base para revisão jurídica (não é parecer jurídico).
export const DATA_TEXTOS = '28/10/2026';

function Revisao() {
  return (
    <p role="note" className="rounded border p-3 text-sm">
      Texto-base, sujeito a revisão jurídica antes da abertura ao público.
    </p>
  );
}

function Cabecalho({ versao }: { versao: string }) {
  return (
    <p className="text-sm">
      Versão {versao}, de {DATA_TEXTOS}.
    </p>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

export function Termos() {
  return (
    <Pagina titulo="Termos de uso">
      <Cabecalho versao={VERSAO_TERMOS} />
      <Revisao />
      <Secao titulo="Quem é quem">
        <p>
          O profissional é o controlador dos dados dos seus pacientes: decide quais dados registrar
          e para quê. A LJS é a operadora: guarda e processa esses dados em nome do profissional,
          seguindo as instruções dele e estes termos.
        </p>
      </Secao>
      <Secao titulo="O serviço">
        <p>
          O Evolução Segura é um sistema para registrar pacientes, sessões, anamnese, evolução e
          cobranças. Há o plano Free, com até 5 pacientes ativos, e o plano Pro, pago por mês. Todo
          cadastro novo começa com 14 dias de teste do Pro.
        </p>
      </Secao>
      <Secao titulo="Responsabilidades do profissional">
        <p>
          Manter a senha e o segundo fator em segurança, ter base legal para registrar os dados dos
          pacientes e cumprir o sigilo e as normas do seu conselho profissional.
        </p>
      </Secao>
      <Secao titulo="Exclusão da conta">
        <p>
          O profissional pode pedir a exclusão da conta em Configurações. Antes, deve exportar os
          dados, pois a guarda do prontuário é dele. Os dados são apagados em definitivo 30 dias
          depois da confirmação.
        </p>
      </Secao>
      <p>
        Veja também a <Link to="/privacidade">política de privacidade</Link>.
      </p>
    </Pagina>
  );
}

export function Privacidade() {
  return (
    <Pagina titulo="Política de privacidade">
      <Cabecalho versao={VERSAO_PRIVACIDADE} />
      <Revisao />
      <Secao titulo="Controlador e operadora">
        <p>
          O profissional é o controlador dos dados dos pacientes. A LJS é a operadora desses dados e
          a controladora apenas dos dados da conta do próprio profissional (nome, e-mail e cobrança
          da assinatura).
        </p>
      </Secao>
      <Secao titulo="Dados tratados">
        <p>
          Dados da conta do profissional, dados de pacientes, sessões, anamneses e evoluções
          registrados por ele, dados de pagamento da assinatura e registros de segurança.
        </p>
      </Secao>
      <Secao titulo="Seus direitos">
        <p>
          Você pode exportar seus dados e pedir a exclusão da conta em Configurações, nos termos da
          LGPD.
        </p>
      </Secao>
      <Secao titulo="Exclusão e retenção">
        <p>
          Após a exclusão, os dados podem permanecer nos backups por até 30 dias. Os dados de
          cobrança continuam no cliente cadastrado no Asaas, nosso provedor de pagamentos, conforme
          a política dele.
        </p>
      </Secao>
      <p>
        Veja também os <Link to="/termos">termos de uso</Link>.
      </p>
    </Pagina>
  );
}
