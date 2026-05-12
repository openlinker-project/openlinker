/**
 * AppShell
 *
 * Authenticated-app chrome: persistent left nav (240 px sidebar with mobile
 * drawer fallback), top utility bar, and the main content slot. Every
 * authenticated route renders inside this shell.
 *
 * Sidebar nav items carry count badges fed by `useNavCounts` (fanning out
 * existing list queries). The topbar hosts breadcrumbs, a visual-only
 * ⌘K search placeholder (full palette tracked separately in #333), an
 * alerts trigger, and a user chip dropdown with the theme toggle.
 *
 * @module shared/ui
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSession } from '../shared/auth/use-session';
import { useNumberFormat } from '../shared/i18n';
import { mergePluginNavContributions } from '../plugins/merge-nav-contributions';
import { plugins } from '../plugins';
import { useNavCounts, type NavCounts } from './hooks/use-nav-counts';
import { Button } from '../shared/ui/button';
import { EnvironmentBadge } from '../shared/ui/environment-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../shared/ui/dropdown-menu';
import { ThemeToggle } from '../shared/ui/theme-toggle';
import { useToast } from '../shared/ui/toast-provider';

type NavCountKey = Exclude<keyof NavCounts, never>;

export interface LiveNavItem {
  countKey?: NavCountKey;
  end?: boolean;
  label: string;
  to: string;
}

interface PlannedNavItem {
  label: string;
  reason?: string;
}

export interface LiveNavGroup {
  items: LiveNavItem[];
  kind: 'live';
  label: string;
}

interface PlannedNavGroup {
  items: PlannedNavItem[];
  kind: 'planned';
  label: string;
}

export type NavGroup = LiveNavGroup | PlannedNavGroup;

interface NavGroupOptions {
  isAdmin: boolean;
}

/**
 * Build the sidebar nav composition for the current session. Admin-only
 * groups (AI) are spliced in at build time so non-admin sessions never see
 * them in the DOM — no client-side permission filtering at render.
 */
function buildNavGroups({ isAdmin }: NavGroupOptions): NavGroup[] {
  const groups: NavGroup[] = [
    {
      kind: 'live',
      label: 'Operations',
      items: [
        { to: '/', label: 'Dashboard', end: true },
        { to: '/orders', label: 'Orders', countKey: 'orders' },
        { to: '/products', label: 'Products' },
        { to: '/inventory', label: 'Inventory', countKey: 'inventory' },
        { to: '/customers', label: 'Customers', countKey: 'customers' },
        { to: '/listings', label: 'Listings', countKey: 'listings' },
      ],
    },
    {
      kind: 'live',
      label: 'Diagnostics',
      items: [
        { to: '/jobs-logs', label: 'Jobs & Logs', countKey: 'jobsFailed' },
        { to: '/webhook-deliveries', label: 'Webhooks', countKey: 'webhooksFailed' },
        { to: '/cursors', label: 'Cursors' },
      ],
    },
    {
      kind: 'live',
      label: 'Platform',
      items: [
        { to: '/connections', label: 'Connections', countKey: 'connections' },
        { to: '/adapters', label: 'Adapters' },
        { to: '/settings', label: 'Settings' },
      ],
    },
  ];

  if (isAdmin) {
    groups.push({
      kind: 'live',
      label: 'AI',
      items: [
        { to: '/ai/prompt-templates', label: 'Prompt templates' },
        { to: '/ai/provider-settings', label: 'Provider settings' },
      ],
    });
  }

  groups.push({
    kind: 'planned',
    label: 'Planned',
    items: [
      { label: 'Automations', reason: 'Coming in a future release' },
      { label: 'Shipping', reason: 'Coming in a future release' },
      { label: 'Invoices', reason: 'Coming in a future release' },
    ],
  });

  return groups;
}

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
  '/ai/prompt-templates': { group: 'AI', title: 'Prompt templates' },
  '/ai/provider-settings': { group: 'AI', title: 'Provider settings' },
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
  if (pathname.startsWith('/ai/prompt-templates/')) return { group: 'AI', title: 'Prompt template' };

  return { group: 'OpenLinker', title: '' };
}

interface SidebarNavProps {
  ariaLabel: string;
  counts: NavCounts;
  groups: NavGroup[];
  onNavigate?: () => void;
}

function SidebarNav({ ariaLabel, counts, groups, onNavigate }: SidebarNavProps): ReactElement {
  // i18n seam (#612): nav-item counts follow the active locale instead of
  // being pinned to en-US. v1 maps `'en'` → BCP 47 `'en-US'`, so today this
  // is a behavioural no-op; future locales pick up the right grouping
  // separators automatically.
  const numberFormatter = useNumberFormat();
  const formatCount = (value: number | null): string | null =>
    value === null ? null : numberFormatter.format(value);
  return (
    <nav className="shell-nav" aria-label={ariaLabel}>
      {groups.map((group) => (
        <section key={group.label} className="shell-nav__group">
          <p className="shell-nav__label">{group.label}</p>
          <ul className="shell-nav__list">
            {group.kind === 'live'
              ? group.items.map((item) => {
                  const countText = item.countKey ? formatCount(counts[item.countKey]) : null;
                  return (
                    <li key={item.label}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          isActive ? 'shell-nav__link shell-nav__link--active' : 'shell-nav__link'
                        }
                      >
                        <span className="shell-nav__link-label">{item.label}</span>
                        {countText !== null ? (
                          <span className="shell-nav__link-count mono-text">{countText}</span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })
              : group.items.map((item) => (
                  <li key={item.label}>
                    <span
                      className="shell-nav__link shell-nav__link--disabled"
                      role="link"
                      aria-disabled="true"
                      tabIndex={-1}
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
      <EnvironmentBadge compact />
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

function TopbarSearchPlaceholder(): ReactElement {
  return (
    <button
      type="button"
      className="shell-topbar__search"
      title="Global search — coming soon"
      aria-label="Global search — coming soon"
      aria-disabled="true"
      onClick={(event) => event.preventDefault()}
    >
      <span className="shell-topbar__search-icon" aria-hidden="true">
        ⌕
      </span>
      <span className="shell-topbar__search-placeholder">
        Search orders, products, connections…
      </span>
      <kbd className="shell-topbar__search-kbd" aria-hidden="true">
        ⌘K
      </kbd>
    </button>
  );
}

function initialsFrom(username: string): string {
  const parts = username.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface UserChipProps {
  email?: string | null;
  onLogout: () => void;
  username: string;
}

function UserChip({ email, onLogout, username }: UserChipProps): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="shell-user-chip" aria-label={`Account menu for ${username}`}>
          <span className="shell-user-chip__avatar" aria-hidden="true">
            {initialsFrom(username)}
          </span>
          <span className="shell-user-chip__name">{username}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="shell-user-chip__menu">
        <DropdownMenuLabel>
          <div className="shell-user-chip__menu-name">{username}</div>
          {email ? <div className="shell-user-chip__menu-email">{email}</div> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="shell-user-chip__menu-section">
          <div className="shell-user-chip__menu-section-label">Theme</div>
          <ThemeToggle />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: PropsWithChildren): ReactElement {
  const { isReady, session, clearSession } = useSession();
  const { showToast } = useToast();
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  const username = session.user?.username;
  const email = session.user?.email ?? null;
  const counts = useNavCounts();
  const isAdmin =
    isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  const groups = useMemo(() => {
    const baseGroups = buildNavGroups({ isAdmin });
    const contributions = plugins.flatMap((plugin) => plugin.navItems ?? []);
    return mergePluginNavContributions(baseGroups, contributions);
  }, [isAdmin]);

  const closeDrawer = useCallback((): void => {
    drawerRef.current?.close();
  }, []);

  const openDrawer = useCallback((): void => {
    drawerRef.current?.showModal();
  }, []);

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
      <div className="shell-sidebar">
        <SidebarBrand />
        <SidebarNav ariaLabel="Primary" counts={counts} groups={groups} />
        <WorkspaceFooter
          username={username}
          onLogout={username ? handleLogout : undefined}
        />
      </div>

      <dialog ref={drawerRef} className="shell-drawer" aria-label="Primary navigation (mobile)">
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
          <SidebarNav
            ariaLabel="Primary (mobile)"
            counts={counts}
            groups={groups}
            onNavigate={closeDrawer}
          />
          <WorkspaceFooter
            username={username}
            onLogout={username ? handleLogout : undefined}
          />
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

          <TopbarSearchPlaceholder />

          <div className="shell-topbar__spacer" />

          <Button tone="ghost" className="shell-topbar__alerts">
            Alerts <span aria-hidden="true">0</span>
            <span className="sr-only">(0 new)</span>
          </Button>

          {username ? (
            <UserChip username={username} email={email} onLogout={handleLogout} />
          ) : null}
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
