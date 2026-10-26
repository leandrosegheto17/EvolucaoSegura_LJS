import { useQuery } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { api, definirCsrf } from '../lib/api.ts';
import { AccountMenu } from './shell/AccountMenu.tsx';
import { MAIN_ID, SkipLink } from './shell/SkipLink.tsx';
import {
  CalendarIcon,
  GearIcon,
  HomeIcon,
  PeopleIcon,
  ShieldIcon,
  WalletIcon,
} from './shell/navIcons.tsx';

// PUB-02, PERF-01: layout e navegação do app, portados de app/shell/Shell.tsx e navItems.ts do
// legado, com as rotas sob /app. Trilho lateral de 104 px no PC e barra inferior de 5 itens em até
// 860 px; cabeçalho com Configurações (só no celular) e o menu da conta.
// A guarda de perfil (PERF-01) leva qualquer rota de /app para /app/perfil enquanto faltarem nome e
// especialidade, pelo perfil.completo de GET /api/eu.

export interface NavItemDef {
  to: string;
  label: string;
  end?: boolean;
  icon: 'home' | 'calendar' | 'people' | 'wallet' | 'shield' | 'gear';
}

/** Grupo principal do trilho (RF-51a); também a barra inferior junto com Auditoria (RF-51f). */
export const NAV_ITEMS: NavItemDef[] = [
  { to: '/app', label: 'Início', end: true, icon: 'home' },
  { to: '/app/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/app/pacientes', label: 'Pacientes', icon: 'people' },
  { to: '/app/financeiro', label: 'Financeiro', icon: 'wallet' },
];

/** Rodapé do trilho (PC). Auditoria também está na barra inferior (mobile). */
export const AUDIT_ITEM: NavItemDef = { to: '/app/auditoria', label: 'Auditoria', icon: 'shield' };

/** Rodapé do trilho (PC) e cabeçalho (mobile). Fora da barra inferior. */
export const SETTINGS_ITEM: NavItemDef = {
  to: '/app/configuracoes',
  label: 'Configurações',
  icon: 'gear',
};

export const CAMINHO_PERFIL = '/app/perfil';

const ICONS = {
  home: HomeIcon,
  calendar: CalendarIcon,
  people: PeopleIcon,
  wallet: WalletIcon,
  shield: ShieldIcon,
  gear: GearIcon,
} as const;

/** Item do trilho/barra: ícone acima do rótulo; ativo = fundo + barra de 3 px (forma além da cor). */
const linkCls =
  'relative flex min-h-14 min-w-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-card px-1 text-center text-xs text-ink [overflow-wrap:anywhere] [hyphens:auto] focus-visible:outline-4 focus-visible:outline-focus aria-[current=page]:bg-pri aria-[current=page]:text-onpri before:absolute before:inset-x-2 before:top-0 before:hidden before:h-[3px] before:rounded-full before:bg-onpri aria-[current=page]:before:block min-[861px]:w-full min-[861px]:flex-none min-[861px]:text-[13px] min-[861px]:before:inset-x-auto min-[861px]:before:inset-y-2 min-[861px]:before:left-0 min-[861px]:before:h-auto min-[861px]:before:w-[3px]';

function RailLink({ item, className = linkCls }: { item: NavItemDef; className?: string }) {
  const Icon = ICONS[item.icon];
  return (
    <NavLink to={item.to} end={item.end ?? false} className={className}>
      <Icon />
      <span>{item.label}</span>
    </NavLink>
  );
}

const headerLinkCls =
  'flex min-h-11 min-w-11 items-center justify-center rounded-card px-3 text-sm text-ink focus-visible:outline-4 focus-visible:outline-focus aria-[current=page]:bg-pri aria-[current=page]:text-onpri min-[861px]:hidden';

/** Layout `body.app`: trilho lateral de 104 px no PC, barra inferior de 5 itens em <= 860 px. */
export function Shell() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <SkipLink />
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-surf p-1 min-[861px]:inset-y-0 min-[861px]:right-auto min-[861px]:w-[104px] min-[861px]:flex-col min-[861px]:border-r min-[861px]:border-t-0 min-[861px]:p-2"
      >
        {NAV_ITEMS.map((i) => (
          <RailLink key={i.to} item={i} />
        ))}
        <div className="contents min-[861px]:mt-auto min-[861px]:flex min-[861px]:flex-col min-[861px]:gap-1 min-[861px]:border-t min-[861px]:border-line min-[861px]:pt-2">
          <RailLink item={AUDIT_ITEM} />
          <RailLink item={SETTINGS_ITEM} className={`${linkCls} hidden min-[861px]:flex`} />
        </div>
      </nav>
      <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b border-line bg-surf px-3 min-[861px]:ml-[104px] min-[861px]:px-6">
        <NavLink to={SETTINGS_ITEM.to} className={headerLinkCls}>
          {SETTINGS_ITEM.label}
        </NavLink>
        <AccountMenu />
      </header>
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="scroll-mt-14 p-6 pb-24 outline-none min-[861px]:ml-[104px] min-[861px]:pb-6"
      >
        <Outlet />
      </main>
    </div>
  );
}

// Chave do GET /api/eu: quem salva o perfil a invalida para a guarda reler o perfil.completo.
export const CHAVE_EU = ['eu'] as const;

interface Eu {
  perfil: { completo: boolean };
  csrf_token?: string;
}

async function lerEu(sinal: AbortSignal): Promise<Eu> {
  const eu = await api.requisitar<Eu>('/eu', { sinal });
  if (typeof eu.csrf_token === 'string') definirCsrf(eu.csrf_token);
  return eu;
}

// PERF-01. PREMISSA: enquanto GET /api/eu não responde (ou se falha por rede), a rota pedida é
// mostrada; o redirecionamento acontece assim que a resposta diz que o perfil está incompleto. O
// 401 já leva a /sessao-expirada pelo cliente da API.
export function GuardaPerfil() {
  const { pathname } = useLocation();
  const eu = useQuery({ queryKey: CHAVE_EU, queryFn: ({ signal }) => lerEu(signal) });
  if (eu.data && !eu.data.perfil.completo && pathname !== CAMINHO_PERFIL)
    return <Navigate to={CAMINHO_PERFIL} replace />;
  return <Outlet />;
}
