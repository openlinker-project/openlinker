import type { ReactElement } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '../auth/use-session';
import { Button } from './button';
import { Input } from './input';
import { StatusBadge, type StatusBadgeTone } from './status-badge';

interface NavigationItem {
  enabled: boolean;
  end?: boolean;
  label: string;
  to?: string;
}

interface NavigationGroup {
  items: NavigationItem[];
  label: string;
}

const navigationGroups: NavigationGroup[] = [
  {
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true, enabled: true },
      { label: 'Orders', enabled: false },
      { label: 'Products', enabled: false },
      { label: 'Inventory', enabled: false },
      { label: 'Jobs & Logs', enabled: false },
      { label: 'Automations', enabled: false },
    ],
  },
  {
    label: 'Platform',
    items: [
      { to: '/connections', label: 'Integrations', enabled: true },
      { to: '/connections/new', label: 'Add connection', enabled: true },
      { label: 'Shipping', enabled: false },
      { label: 'Invoices', enabled: false },
      { to: '/settings', label: 'Settings', enabled: true },
    ],
  },
];

export function AppShell(): ReactElement {
  const { isReady, session } = useSession();
  const sessionTone: StatusBadgeTone = isReady
    ? session.status === 'authenticated'
      ? 'success'
      : 'warning'
    : 'info';

  return (
    <div className="app-shell">
      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand__row">
              <strong className="sidebar-brand__title">OpenLinker</strong>
              <span className="context-chip">Dev</span>
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
                      {item.enabled && item.to ? (
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
                        >
                          <span>{item.label}</span>
                          <span className="nav-link__meta">Live</span>
                        </NavLink>
                      ) : (
                        <span className="nav-link nav-link--disabled">
                          <span>{item.label}</span>
                          <span className="nav-link__meta">Locked</span>
                        </span>
                      )}
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
              <span className="context-chip">Development</span>
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
                <StatusBadge tone={sessionTone} withDot>
                  {isReady ? session.status : 'loading'}
                </StatusBadge>
              </div>
            </div>
          </header>

          <main className="main-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
