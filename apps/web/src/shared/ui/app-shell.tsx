import type { PropsWithChildren, ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useSession } from '../auth/use-session';
import { Button } from './button';
import { EnvironmentBadge } from './environment-badge';
import { Input } from './input';
import { StatusBadge, type StatusBadgeTone } from './status-badge';
import { useToast } from './toast-provider';

interface NavigationItem {
  end?: boolean;
  label: string;
  state: 'live' | 'planned';
  to: string;
}

interface NavigationGroup {
  items: NavigationItem[];
  label: string;
}

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true, state: 'live' },
      { to: '/orders', label: 'Orders', state: 'live' },
      { to: '/products', label: 'Products', state: 'live' },
      { to: '/inventory', label: 'Inventory', state: 'live' },
      { to: '/customers', label: 'Customers', state: 'live' },
      { to: '/listings', label: 'Listings', state: 'live' },
      { to: '/cursors', label: 'Cursors', state: 'live' },
      { to: '/jobs-logs', label: 'Jobs & Logs', state: 'planned' },
      { to: '/webhook-deliveries', label: 'Webhooks', state: 'live' },
      { to: '/automations', label: 'Automations', state: 'planned' },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/connections', label: 'Integrations', state: 'live' },
      { to: '/adapters', label: 'Adapters', state: 'live' },
      { to: '/connections/new', label: 'Add connection', state: 'live' },
      { to: '/shipping', label: 'Shipping', state: 'planned' },
      { to: '/invoices', label: 'Invoices', state: 'planned' },
      { to: '/settings', label: 'Settings', state: 'live' },
    ],
  },
];

export function AppShell({ children }: PropsWithChildren): ReactElement {
  const { isReady, session, clearSession } = useSession();
  const { showToast } = useToast();
  const sessionTone: StatusBadgeTone = isReady
    ? session.status === 'authenticated'
      ? 'success'
      : 'warning'
    : 'info';

  const handleLogout = (): void => {
    void (async (): Promise<void> => {
      await clearSession();
      showToast({ tone: 'info', description: 'You have been logged out.' });
    })();
  };

  return (
    <div className="app-shell">
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand__row">
              <strong className="sidebar-brand__title">OpenLinker</strong>
              <EnvironmentBadge compact />
            </div>
            <span className="sidebar-brand__org">Default organization</span>
          </div>

          <nav aria-label="Primary">
            {navigationGroups.map((group) => (
              <section key={group.label} className="nav-group">
                <p className="nav-group__label">{group.label}</p>
                <ul className="nav-list">
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
                      >
                        <span>{item.label}</span>
                        <span className="nav-link__meta">{item.state === 'live' ? 'Live' : 'Planned'}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <div className="topbar__context">
              <span className="topbar__label">Workspace</span>
              <strong>Default organization</strong>
              <EnvironmentBadge />
            </div>

            <div className="topbar__actions">
              <label className="search-field">
                <span className="sr-only">Search</span>
                <Input type="search" placeholder="Search orders, products, jobs..." />
              </label>
              <Button tone="secondary">
                Alerts 0
              </Button>
              <Button>Quick action</Button>
              <div className="session-status">
                {session.user ? (
                  <span className="session-status__user">{session.user.username}</span>
                ) : null}
                <StatusBadge tone={sessionTone} withDot>
                  {isReady ? session.status : 'loading'}
                </StatusBadge>
                {session.status === 'authenticated' ? (
                  <Button tone="ghost" onClick={handleLogout}>
                    Logout
                  </Button>
                ) : null}
              </div>
            </div>
          </header>

          <main className="main-content">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
