import {
  useCallback,
  useEffect,
  useRef,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../auth/use-session';
import { Button } from './button';
import { EnvironmentBadge } from './environment-badge';
import { Input } from './input';
import { useToast } from './toast-provider';

interface LiveNavItem {
  end?: boolean;
  label: string;
  to: string;
}

interface PlannedNavItem {
  label: string;
  reason?: string;
}

interface LiveNavGroup {
  items: LiveNavItem[];
  kind: 'live';
  label: string;
}

interface PlannedNavGroup {
  items: PlannedNavItem[];
  kind: 'planned';
  label: string;
}

type NavGroup = LiveNavGroup | PlannedNavGroup;

/**
 * Nav IA (FE-002 / #238)
 *
 * Three active groups sorted by frequency of use, plus a disabled Planned
 * footer. "Live"/"Planned" pills removed from live items; Planned items are
 * non-interactive and carry a tooltip.
 *
 * Naming contract: we use "Connections" everywhere (nav, URL, page title,
 * API) to resolve the legacy "Integrations vs Connections" drift.
 *
 * See docs/frontend-ui-style-guide.md §Shell Layout → Left Navigation.
 */
const navGroups: NavGroup[] = [
  {
    kind: 'live',
    label: 'Operations',
    items: [
      { to: '/', label: 'Dashboard', end: true },
      { to: '/orders', label: 'Orders' },
      { to: '/products', label: 'Products' },
      { to: '/inventory', label: 'Inventory' },
      { to: '/customers', label: 'Customers' },
      { to: '/listings', label: 'Listings' },
    ],
  },
  {
    kind: 'live',
    label: 'Diagnostics',
    items: [
      { to: '/jobs-logs', label: 'Jobs & Logs' },
      { to: '/webhook-deliveries', label: 'Webhooks' },
      { to: '/cursors', label: 'Cursors' },
    ],
  },
  {
    kind: 'live',
    label: 'Platform',
    items: [
      { to: '/connections', label: 'Connections' },
      { to: '/adapters', label: 'Adapters' },
      { to: '/settings', label: 'Settings' },
    ],
  },
  {
    kind: 'planned',
    label: 'Planned',
    items: [
      { label: 'Automations', reason: 'Coming in a future release' },
      { label: 'Shipping', reason: 'Coming in a future release' },
      { label: 'Invoices', reason: 'Coming in a future release' },
    ],
  },
];

/**
 * Topbar crumb resolution.
 *
 * Static map for known routes; simple fallbacks for dynamic detail routes
 * (`/orders/:id`, `/connections/:id`, etc.). Keeps the topbar grounded
 * in the current route without requiring every page to publish its own
 * crumb — Phase 3's PageHeader primitive can replace this with a more
 * declarative API if needed.
 */
const staticCrumbs: Record<string, { group: string; title: string }> = {
  '/': { group: 'Operations', title: 'Dashboard' },
  '/orders': { group: 'Operations', title: 'Orders' },
  '/orders/failed': { group: 'Operations', title: 'Failed orders' },
  '/products': { group: 'Operations', title: 'Products' },
  '/inventory': { group: 'Operations', title: 'Inventory' },
  '/customers': { group: 'Operations', title: 'Customers' },
  '/listings': { group: 'Operations', title: 'Listings' },
  '/jobs-logs': { group: 'Diagnostics', title: 'Jobs & Logs' },
  '/webhook-deliveries': { group: 'Diagnostics', title: 'Webhooks' },
  '/cursors': { group: 'Diagnostics', title: 'Cursors' },
  '/connections': { group: 'Platform', title: 'Connections' },
  '/connections/new': { group: 'Platform', title: 'New connection' },
  '/connections/new/allegro': { group: 'Platform', title: 'Connect Allegro' },
  '/connections/new/prestashop': { group: 'Platform', title: 'Connect PrestaShop' },
  '/connections/new/advanced': { group: 'Platform', title: 'Advanced setup' },
  '/adapters': { group: 'Platform', title: 'Adapters' },
  '/settings': { group: 'Platform', title: 'Settings' },
};

function resolveCrumbs(pathname: string): { group: string; title: string } {
  const exact = staticCrumbs[pathname];
  if (exact) return exact;

  if (pathname.startsWith('/orders/')) return { group: 'Operations', title: 'Order' };
  if (pathname.startsWith('/products/')) return { group: 'Operations', title: 'Product' };
  if (pathname.startsWith('/inventory/')) return { group: 'Operations', title: 'Inventory item' };
  if (pathname.startsWith('/customers/')) return { group: 'Operations', title: 'Customer' };
  if (pathname.startsWith('/listings/')) return { group: 'Operations', title: 'Listing' };
  if (pathname.startsWith('/jobs-logs/')) return { group: 'Diagnostics', title: 'Job' };
  if (pathname.startsWith('/connections/')) return { group: 'Platform', title: 'Connection' };

  return { group: 'OpenLinker', title: '' };
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }): ReactElement {
  return (
    <nav className="shell-nav" aria-label="Primary">
      {navGroups.map((group) => (
        <section key={group.label} className="shell-nav__group">
          <p className="shell-nav__label">{group.label}</p>
          <ul className="shell-nav__list">
            {group.kind === 'live'
              ? group.items.map((item) => (
                  <li key={item.label}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        isActive ? 'shell-nav__link shell-nav__link--active' : 'shell-nav__link'
                      }
                    >
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))
              : group.items.map((item) => (
                  <li key={item.label}>
                    <span
                      className="shell-nav__link shell-nav__link--disabled"
                      aria-disabled="true"
                      title={item.reason}
                    >
                      {item.label}
                    </span>
                  </li>
                ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function SidebarBrand(): ReactElement {
  return (
    <div className="shell-brand">
      <span className="shell-brand__mark" aria-hidden="true">
        OL
      </span>
      <span className="shell-brand__name">OpenLinker</span>
    </div>
  );
}

interface WorkspaceFooterProps {
  onLogout?: () => void;
  username?: string;
}

function WorkspaceFooter({ onLogout, username }: WorkspaceFooterProps): ReactElement {
  return (
    <div className="shell-workspace">
      <div className="shell-workspace__header">
        <strong className="shell-workspace__name">Default organization</strong>
        <EnvironmentBadge compact />
      </div>
      {username ? (
        <div className="shell-workspace__user">
          <span className="shell-workspace__username">{username}</span>
          {onLogout ? (
            <Button tone="ghost" onClick={onLogout} className="shell-workspace__logout">
              Sign out
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: PropsWithChildren): ReactElement {
  const { session, clearSession } = useSession();
  const { showToast } = useToast();
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const username = session.user?.username;

  const closeDrawer = useCallback((): void => {
    drawerRef.current?.close();
  }, []);

  const openDrawer = useCallback((): void => {
    drawerRef.current?.showModal();
  }, []);

  // Auto-close the drawer when the route changes (mobile navigation UX).
  useEffect(() => {
    closeDrawer();
  }, [location.pathname, closeDrawer]);

  const handleLogout = useCallback((): void => {
    void (async (): Promise<void> => {
      await clearSession();
      showToast({ tone: 'info', description: 'You have been logged out.' });
    })();
  }, [clearSession, showToast]);

  const crumbs = resolveCrumbs(location.pathname);

  return (
    <div className="shell">
      <aside className="shell-sidebar" aria-label="Primary navigation">
        <SidebarBrand />
        <SidebarNav />
        <WorkspaceFooter username={username} onLogout={username ? handleLogout : undefined} />
      </aside>

      {/* Mobile drawer — hidden above 1024 px via CSS; native <dialog> handles
          focus trap, esc, and backdrop click. Same nav content as the sidebar. */}
      <dialog ref={drawerRef} className="shell-drawer" aria-label="Primary navigation">
        <div className="shell-drawer__inner">
          <div className="shell-drawer__header">
            <SidebarBrand />
            <Button
              tone="ghost"
              onClick={closeDrawer}
              aria-label="Close menu"
              className="shell-drawer__close"
            >
              ✕
            </Button>
          </div>
          <SidebarNav onNavigate={closeDrawer} />
          <WorkspaceFooter username={username} onLogout={username ? handleLogout : undefined} />
        </div>
      </dialog>

      <div className="shell-main">
        <header className="shell-topbar">
          <button
            type="button"
            onClick={openDrawer}
            aria-label="Open menu"
            className="shell-topbar__hamburger"
          >
            <span aria-hidden="true">☰</span>
          </button>

          <nav aria-label="Breadcrumb" className="shell-crumbs">
            <span className="shell-crumbs__group">{crumbs.group}</span>
            {crumbs.title ? (
              <>
                <span className="shell-crumbs__sep" aria-hidden="true">
                  /
                </span>
                <span className="shell-crumbs__current">{crumbs.title}</span>
              </>
            ) : null}
          </nav>

          <div className="shell-topbar__spacer" />

          <label className="shell-search">
            <span className="sr-only">Search</span>
            <Input type="search" placeholder="Search orders, products, jobs…" />
          </label>

          <Button tone="ghost" className="shell-topbar__alerts" aria-label="Alerts (0 new)">
            Alerts 0
          </Button>
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
