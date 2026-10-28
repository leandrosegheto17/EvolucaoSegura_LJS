import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Seal,
  Select,
  Skeleton,
  Spinner,
  Steps,
  Table,
  Tabs,
  Textarea,
} from './index';

const cases: Record<string, () => ReactElement> = {
  Button: () => <Button>Salvar</Button>,
  'Button outline disabled': () => (
    <Button variant="outline" disabled full>
      Cancelar
    </Button>
  ),
  'Field+Input': () => (
    <Field label="Nome" hint="Como no documento" error="Obrigatório" required>
      {(p) => <Input {...p} />}
    </Field>
  ),
  Select: () => (
    <Field label="Tempo">
      {(p) => (
        <Select {...p}>
          <option>5 min</option>
          <option>10 min</option>
        </Select>
      )}
    </Field>
  ),
  Textarea: () => <Field label="Evolução">{(p) => <Textarea reading {...p} />}</Field>,
  Card: () => (
    <Card>
      <p>Conteúdo</p>
    </Card>
  ),
  'Alert err': () => <Alert tone="err">Falhou</Alert>,
  'Alert ok': () => <Alert tone="ok">Salvo</Alert>,
  Badge: () => <Badge tone="warn">Editável hoje</Badge>,
  Seal: () => <Seal>Entregue</Seal>,
  Steps: () => <Steps steps={['Senha', 'Código']} current={1} />,
  Tabs: () => (
    <Tabs
      label="Seções"
      tabs={[
        { id: 'a', label: 'A', panel: 'pa' },
        { id: 'b', label: 'B', panel: 'pb' },
      ]}
    />
  ),
  Table: () => <Table caption="Pacientes" columns={['Nome', 'Status']} rows={[['Ana', 'Ativo']]} />,
  Empty: () => <Empty title="Sem pacientes">Cadastre o primeiro.</Empty>,
  Skeleton: () => <Skeleton />,
  Spinner: () => <Spinner />,
};

describe.each(['light', 'dark'])('axe no tema %s', (theme) => {
  it.each(Object.keys(cases))('%s sem violacoes', async (name) => {
    document.documentElement.dataset.theme = theme;
    const { container } = render(cases[name]!());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('a11y estrutural', () => {
  it('Button: foco visivel 3 px e alvo >= 48 px', () => {
    render(<Button>Ok</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('focus-visible:outline-3');
    expect(cls).toContain('min-h-12');
  });
  it('controles de formulario tem foco 3 px e alvo 48 px', () => {
    render(<Field label="X">{(p) => <Input {...p} />}</Field>);
    const cls = screen.getByLabelText('X').className;
    expect(cls).toContain('focus-visible:outline-3');
    expect(cls).toContain('min-h-12');
  });
  it('Field liga hint e erro ao controle e marca invalido', () => {
    render(
      <Field label="Nome" hint="dica" error="erro">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Nome');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('dica erro');
    expect(screen.getByRole('alert')).toHaveTextContent('erro');
  });
  it('nenhum componente usa estilo inline', () => {
    const { container } = render(
      <>
        {Object.values(cases).map((c, i) => (
          <div key={i}>{c()}</div>
        ))}
      </>,
    );
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
  it('Tabs navega por setas e mantem roving tabindex', async () => {
    const user = userEvent.setup();
    render(cases['Tabs']!());
    await user.tab();
    expect(screen.getByRole('tab', { name: 'A' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'A' })).toHaveAttribute('tabindex', '-1');
  });
  it('Alert erro usa role=alert e demais status; Steps marca etapa atual', () => {
    render(
      <>
        <Alert tone="err">e</Alert>
        <Alert tone="ok">o</Alert>
        <Steps steps={['A', 'B']} current={1} />
      </>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('B').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});
