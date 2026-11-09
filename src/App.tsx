import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { BarChart3, Cable, FileText, LogOut, Megaphone, Rows3, Sparkles, Users, Waypoints } from 'lucide-react';
import { api, setUnauthorizedHandler } from './lib/api.ts';
import { useHashRoute } from './lib/hooks.ts';
import { closeLive, useLiveStatus } from './lib/live.ts';
import { SessionCtx, can, useSession, type Session } from './lib/session.tsx';
import { Avatar, cx } from './components/ui.tsx';
import { ROLE_LABEL, type Role, type User } from '../shared/types.ts';
import Login from './views/Login.tsx';
import Dashboard from './views/Dashboard.tsx';
import Leads from './views/Leads.tsx';
import Channels from './views/Channels.tsx';
import Investments from './views/Investments.tsx';
import UsersView from './views/Users.tsx';
import Integration from './views/Integration.tsx';
import Reports from './views/Reports.tsx';
import Creatives from './views/Creatives.tsx';

interface NavItem {
  id: string;
  label: string;
  short?: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  min: Role;
  view: ComponentType;
}

const NAV: NavItem[] = [
  { id: 'painel', label: 'Painel', icon: BarChart3, min: 'operator', view: Dashboard },
  { id: 'leads', label: 'Leads', icon: Rows3, min: 'operator', view: Leads },
  { id: 'canais', label: 'Canais', icon: Waypoints, min: 'operator', view: Channels },
  { id: 'criativos', label: 'Criativos', icon: Sparkles, min: 'manager', view: Creatives },
  { id: 'investimentos', label: 'Investimentos', short: 'Invest.', icon: Megaphone, min: 'manager', view: Investments },
  { id: 'relatorios', label: 'Relatórios', short: 'Relatór.', icon: FileText, min: 'manager', view: Reports },
  { id: 'usuarios', label: 'Usuários', icon: Users, min: 'admin', view: UsersView },
  { id: 'integracao', label: 'Integração', short: 'Ajustes', icon: Cable, min: 'manager', view: Integration },
];

export default function App() {
  const [state, setState] = useState<{ loading: boolean; user: User | null; needsSetup: boolean }>({
    loading: true,
    user: null,
    needsSetup: false,
  });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      closeLive();
      setState((s) => ({ ...s, user: null }));
    });
    api
      .get<{ user: User | null; needs_setup: boolean }>('/auth/me')
      .then((r) => setState({ loading: false, user: r.user, needsSetup: r.needs_setup }))
      .catch(() => setState({ loading: false, user: null, needsSetup: false }));
  }, []);

  const session = useMemo<Session | null>(
    () =>
      state.user
        ? {
            user: state.user,
            setUser: (u) => setState((s) => ({ ...s, user: u })),
            logout: async () => {
              closeLive();
              await api.post('/auth/logout').catch(() => {});
              setState((s) => ({ ...s, user: null }));
            },
          }
        : null,
    [state.user],
  );

  if (state.loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <img src="/icon.svg" alt="" className="size-12 animate-pulse rounded-[12px]" />
      </div>
    );
  }
  if (!session) {
    return <Login setup={state.needsSetup} onDone={(user) => setState({ loading: false, user, needsSetup: false })} />;
  }
  return (
    <SessionCtx.Provider value={session}>
      <Shell />
    </SessionCtx.Provider>
  );
}

function Shell() {
  const { user, logout } = useSession();
  const items = NAV.filter((n) => can(user, n.min));
  const [route, go] = useHashRoute(items[0].id);
  const current = items.find((n) => n.id === route) ?? items[0];
  const View = current.view;

  useEffect(() => {
    document.title = `${current.label} · ChatAnalytics`;
    window.scrollTo({ top: 0 });
  }, [current]);

  return (
    <div className="min-h-full">
      {/* Barra lateral (desktop) */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-separator bg-[var(--sidebar)] backdrop-blur-2xl backdrop-saturate-150 lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-6">
          <img src="/icon.svg" alt="" className="size-8 rounded-[9px] shadow-sm" />
          <div className="leading-tight">
            <div className="display text-[16px] font-semibold">ChatAnalytics</div>
            <div className="text-[12px] text-label-3">Leads e conversões</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-3" aria-label="Principal">
          {items.map((n) => {
            const active = n.id === current.id;
            return (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex h-9 w-full items-center gap-3 rounded-[10px] px-3 text-[14px] font-medium transition-colors',
                  active ? 'bg-fill text-label' : 'text-label-2 hover:bg-fill-2 hover:text-label',
                )}
              >
                <n.icon className={cx('size-[18px]', active ? 'text-accent' : '')} strokeWidth={2} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <LiveBadge />
        <div className="m-3 mt-1 flex items-center gap-3 rounded-[14px] p-2.5 hover:bg-fill-2">
          <Avatar name={user.name} size={34} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="truncate text-[12px] text-label-3">{ROLE_LABEL[user.role]}</div>
          </div>
          <button onClick={logout} aria-label="Sair" title="Sair" className="rounded-full p-1.5 text-label-3 transition hover:bg-fill hover:text-label">
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Topo (celular) */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-separator bg-[var(--sidebar)] px-4 py-3 backdrop-blur-2xl lg:hidden">
        <div className="flex items-center gap-2">
          <img src="/icon.svg" alt="" className="size-7 rounded-[8px]" />
          <span className="display text-[16px] font-semibold">ChatAnalytics</span>
        </div>
        <button onClick={logout} className="text-[14px] font-medium text-accent">Sair</button>
      </header>

      <main className="px-4 pb-28 pt-6 sm:px-8 lg:ml-[248px] lg:px-10 lg:pb-12 lg:pt-10">
        <div key={current.id} className="animate-fade-up mx-auto max-w-[1280px]">
          <View />
        </div>
      </main>

      {/* Barra de abas (celular) */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-separator bg-[var(--sidebar)] pb-[env(safe-area-inset-bottom)] backdrop-blur-2xl lg:hidden" aria-label="Principal">
        {items.map((n) => {
          const active = n.id === current.id;
          return (
            <button key={n.id} onClick={() => go(n.id)} className={cx('flex min-w-[64px] flex-1 shrink-0 flex-col items-center gap-0.5 py-2 text-[10px] font-medium', active ? 'text-accent' : 'text-label-3')}>
              <n.icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
              {n.short ?? n.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}


function LiveBadge() {
  const on = useLiveStatus();
  return (
    <div className="mx-6 flex items-center gap-2 text-[12px] text-label-3" title={on ? 'As telas se atualizam sozinhas' : 'Reconectando…'}>
      <span className="relative flex size-2">
        {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-fill opacity-60" />}
        <span className={cx('relative inline-flex size-2 rounded-full', on ? 'bg-green-fill' : 'bg-label-3')} />
      </span>
      {on ? 'Ao vivo' : 'Reconectando…'}
    </div>
  );
}
