import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ehErroApi } from '../../lib/api.ts';
import { Alert, Button, Field, Input, Spinner } from '../../ui';
import { criarPaciente } from './api.ts';

// PAC-01: novo paciente, portado de features/patients/form/PatientFormPage.tsx do legado (o
// destino do botão "Novo paciente" da lista), com o mesmo layout. Só o nome é obrigatório; os
// campos seguem os limites do contrato (nome 200, telefone 40, e-mail 254 no formato x@y, endereço
// 500). Sem botão de excluir (PAC-07). Salvar leva à ficha.
// SPEC_DEVIATION: só a criação; o modo de edição do legado sai porque a spec não pede edição dos
// dados do paciente.

const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+$/;
const ouNulo = (v: string) => (v.trim() ? v.trim() : null);

export function PatientFormPage() {
  const navegar = useNavigate();
  const qc = useQueryClient();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [endereco, setEndereco] = useState('');
  const [erros, setErros] = useState<{ nome?: string; email?: string }>({});
  const [erroForm, setErroForm] = useState<string>();
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const proximos: typeof erros = {};
    if (!nome.trim()) proximos.nome = 'Informe o nome do paciente.';
    if (email.trim() && !FORMATO_EMAIL.test(email.trim()))
      proximos.email = 'Informe um e-mail válido.';
    setErros(proximos);
    setErroForm(undefined);
    if (proximos.nome) return e.currentTarget.querySelector('input')?.focus();
    if (proximos.email) return;
    setOcupado(true);
    try {
      const p = await criarPaciente({
        nome: nome.trim(),
        telefone: ouNulo(telefone),
        email: ouNulo(email),
        endereco: ouNulo(endereco),
      });
      void qc.invalidateQueries({ queryKey: ['pacientes'] });
      navegar(`/app/pacientes/${p.id}`);
    } catch (erro) {
      if (ehErroApi(erro) && (erro.status === 400 || erro.status === 422))
        setErroForm('Confira os dados informados e tente novamente.');
      else setErroForm('Não foi possível salvar agora. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold">Novo paciente</h1>
      <p className="text-mut">Somente o nome é obrigatório.</p>
      <form onSubmit={(e) => void enviar(e)} noValidate className="flex flex-col gap-4">
        <Field label="Nome" required error={erros.nome}>
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              value={nome}
              maxLength={200}
              onChange={(e) => setNome(e.target.value)}
            />
          )}
        </Field>
        <Field label="Telefone" hint="Opcional">
          {(p) => (
            <Input
              {...p}
              type="tel"
              autoComplete="off"
              value={telefone}
              maxLength={40}
              onChange={(e) => setTelefone(e.target.value)}
            />
          )}
        </Field>
        <Field label="E-mail" hint="Opcional" error={erros.email}>
          {(p) => (
            <Input
              {...p}
              type="email"
              autoComplete="off"
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Endereço" hint="Opcional">
          {(p) => (
            <Input
              {...p}
              autoComplete="off"
              value={endereco}
              maxLength={500}
              onChange={(e) => setEndereco(e.target.value)}
            />
          )}
        </Field>
        {erroForm && <Alert tone="err">{erroForm}</Alert>}
        <div className="flex gap-3">
          <Button type="submit" disabled={ocupado}>
            {ocupado ? <Spinner label="Salvando" /> : 'Salvar'}
          </Button>
          <Link to="/app/pacientes">Cancelar</Link>
        </div>
      </form>
    </div>
  );
}
