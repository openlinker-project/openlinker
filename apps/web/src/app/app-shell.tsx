/**
 * AppShell
 *
 * Authenticated-app chrome: persistent left nav (240 px sidebar with mobile
 * drawer fallback), top utility bar, and the main content slot. Every
 * authenticated route renders inside this shell.
 *
 * Sidebar nav items carry count badges fed by `useNavCounts` (fanning out
 * existing list queries). The topbar hosts breadcrumbs, a live ⌘K command
 * palette trigger (CommandPaletteTrigger → CommandPaletteProvider, #333),
 * an alerts trigger, and a user chip dropdown with the theme toggle.
 *
 * @module shared/ui
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { NavLink, useLocation, useMatches } from 'react-router-dom';
import { useSession } from '../shared/auth/use-session';
import { useNumberFormat } from '../shared/i18n';
import { resolveCrumbFromMatches } from './breadcrumbs';
import { buildNavGroups } from './nav-registry';
import type { NavGroup } from './nav-registry.types';
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
import { DensityToggle, useDensity } from '../shared/ui/density-toggle';
import { useToast } from '../shared/ui/toast-provider';
import { CommandPaletteProvider, useCommandPalette } from './command-palette-provider';
import { CommandPaletteTrigger } from '../shared/ui/command-palette';
import { DemoBanner } from '../shared/ui/demo-banner';
import { useSystemConfigQuery } from '../features/system';
import {
  disableDemoAnalytics,
  getDemoAnalyticsConsent,
  initDemoIntegrations,
  setDemoAnalyticsConsent,
  type DemoAnalyticsConsent,
} from '../features/demo';

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
  // Shared render for a greyed-out, non-clickable nav item (planned items and
  // demo-locked `restricted` groups use the same treatment; only the tooltip
  // source differs — per-item `reason` for planned, group-level for restricted).
  // `locked` items also show a lock glyph so the state reads without hovering.
  const renderDisabledItem = (
    label: string,
    reason: string | undefined,
    locked: boolean,
  ): ReactElement => (
    <li key={label}>
      <span
        className="shell-nav__link shell-nav__link--disabled"
        role="link"
        aria-disabled="true"
        tabIndex={-1}
        title={reason}
      >
        {locked ? (
          <>
            <span className="shell-nav__link-label">{label}</span>
            <span className="shell-nav__link-lock" aria-hidden="true">
              🔒
            </span>
          </>
        ) : (
          label
        )}
      </span>
    </li>
  );
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
              : group.kind === 'restricted'
                ? group.items.map((item) => renderDisabledItem(item.label, group.reason, true))
                : group.items.map((item) => renderDisabledItem(item.label, item.reason, false))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function SidebarBrand(): ReactElement {
  return (
    <div className="shell-brand">
      <img
        className="shell-brand__mark"
        src="/openlinker-logo.svg"
        alt=""
        aria-hidden="true"
        width={26}
        height={26}
      />
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

function TopbarSearchTrigger(): ReactElement {
  const { open } = useCommandPalette();
  return <CommandPaletteTrigger onClick={open} />;
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
        <div className="shell-user-chip__menu-section">
          <div className="shell-user-chip__menu-section-label">Density</div>
          <DensityToggle />
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
  const systemConfigQuery = useSystemConfigQuery();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;
  const posthogConfig = systemConfigQuery.data?.demoIntegrations?.posthog;
  const [analyticsConsent, setAnalyticsConsent] = useState<DemoAnalyticsConsent | null>(() =>
    getDemoAnalyticsConsent(),
  );
  const hasInitializedAnalyticsRef = useRef(false);
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  // Initialize density at boot so <html data-density="..."> is set before
  // any .data-table renders (avoids a flash of cozy-density rows for
  // users who selected compact). useDensity is a no-op hook for the
  // shell itself — we only call it to drive its useEffect.
  useDensity();
  const username = session.user?.username;
  const email = session.user?.email ?? null;
  const counts = useNavCounts();
  const isAdmin =
    isReady && session.status === 'authenticated' && session.user?.role === 'admin';
  // Demo mode's "write actions are disabled" claim is only true for a
  // viewer-role session — RolesGuard lets admin/operator write fine, so
  // showing the banner to them is actively misleading during a live
  // walkthrough (#1468).
  const isViewerOnly =
    isReady && session.status === 'authenticated' && session.user?.role === 'viewer';
  const groups = useMemo(() => buildNavGroups({ isAdmin, demoMode }), [isAdmin, demoMode]);
  const matches = useMatches();

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

  // Demo-only analytics (#1301) — attempt init once the config query has
  // settled and again whenever the visitor grants consent. The loader's own
  // guards (demoMode, config presence, consent) make repeat calls a no-op,
  // but hasInitializedAnalyticsRef avoids a redundant dynamic import.
  useEffect(() => {
    if (!systemConfigQuery.isSuccess || hasInitializedAnalyticsRef.current) {
      return;
    }
    if (analyticsConsent !== 'accepted') {
      return;
    }
    hasInitializedAnalyticsRef.current = true;
    void initDemoIntegrations(systemConfigQuery.data);
  }, [systemConfigQuery.isSuccess, systemConfigQuery.data, analyticsConsent]);

  const handleAnalyticsConsentChange = useCallback((consent: DemoAnalyticsConsent): void => {
    setDemoAnalyticsConsent(consent);
    setAnalyticsConsent(consent);
    if (consent === 'declined') {
      disableDemoAnalytics();
    }
  }, []);

  const crumbs = resolveCrumbFromMatches(matches);

  return (
    <CommandPaletteProvider>
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

          <TopbarSearchTrigger />

          <div className="shell-topbar__spacer" />

          <Button tone="ghost" className="shell-topbar__alerts">
            Alerts <span aria-hidden="true">0</span>
            <span className="sr-only">(0 new)</span>
          </Button>

          {username ? (
            <UserChip username={username} email={email} onLogout={handleLogout} />
          ) : null}
        </header>

        {demoMode && isViewerOnly ? (
          <DemoBanner
            consentPending={Boolean(posthogConfig?.key) && analyticsConsent === null}
            consentAccepted={Boolean(posthogConfig?.key) && analyticsConsent === 'accepted'}
            onConsentChange={handleAnalyticsConsentChange}
          />
        ) : null}

        {/* `key={location.pathname}` retriggers the .shell-content
            cross-fade animation on every route change (#775). */}
        <main key={location.pathname} className="shell-content">{children}</main>
      </div>
    </div>
    </CommandPaletteProvider>
  );
}
