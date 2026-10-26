import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import {
  AutosaveIndicator, ClinicalAlertBadge, DocStatusBadge, EditWindowBadge, PrivacyName, StatCard,
} from './index';

const cases: Record<string, () => ReactElement> = {
  'Edit editavel': () => <EditWindowBadge estado="editavel_hoje" />,
  'Edit registrada': () => <EditWindowBadge estado="registrada" />,
  'Doc rascunho': () => <DocStatusBadge estado="rascunho" />,
  'Doc entregue': () => <DocStatusBadge estado="entregue" entregueEm="10/09/2026 14:30" />,
  Alert: () => <ClinicalAlertBadge alertas={['Alergia a penicilina']} />,
  'Autosave salvo': () => <AutosaveIndicator estado="salvo" salvoAs="14:30" />,
  'Autosave nao salvo': () => <AutosaveIndicator estado="nao_salvo" />,
  PrivacyName: () => <PrivacyName nome="Maria da Silva" privado />,
  StatCard: () => <StatCard label="Sessões da semana" value={12} hint="2 a mais" />,
};

describe('novos: axe', () => {
  it.each(Object.keys(cases))('%s sem violacoes', async (name) => {
    const { container } = render(cases[name]!());
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('novos: comportamento', () => {
  it('badges tem texto e icone oculto', () => {
    const { container } = render(<><EditWindowBadge estado="editavel_hoje" /><EditWindowBadge estado="registrada" /></>);
    expect(screen.getByText('Editável hoje')).toBeInTheDocument();
    expect(screen.getByText('Registrada')).toBeInTheDocument();
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBe(2);
  });
  it('DocStatusBadge deriva do estado', () => {
    const { rerender } = render(<DocStatusBadge estado="rascunho" />);
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    rerender(<DocStatusBadge estado="entregue" entregueEm="10/09 14:30" />);
    expect(screen.getByText('Entregue em 10/09 14:30')).toBeInTheDocument();
  });
  it('ClinicalAlertBadge some sem alertas e abre lista', async () => {
    const { container, rerender } = render(<ClinicalAlertBadge alertas={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ClinicalAlertBadge alertas={['Alergia']} />);
    const btn = screen.getByRole('button', { name: /Alerta clínico/ });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(btn);
    expect(screen.getByText('Alergia')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Alergia')).toBeNull();
  });
  it('AutosaveIndicator textos', () => {
    const { rerender } = render(<AutosaveIndicator estado="salvo" salvoAs="14:30" />);
    expect(screen.getByText(/Salvo às 14:30/)).toBeInTheDocument();
    rerender(<AutosaveIndicator estado="salvando" />);
    expect(screen.getByText(/Salvando\.\.\./)).toBeInTheDocument();
    rerender(<AutosaveIndicator estado="nao_salvo" />);
    expect(screen.getByText(/Não salvo/)).toBeInTheDocument();
  });
  it('PrivacyName: iniciais com aria-label do nome completo', () => {
    const { rerender } = render(<PrivacyName nome="Maria da Silva" privado />);
    const el = screen.getByLabelText('Maria da Silva');
    expect(el).toHaveTextContent('M. D. S.');
    rerender(<PrivacyName nome="Maria da Silva" />);
    expect(screen.getByText('Maria da Silva')).toBeInTheDocument();
  });
});
