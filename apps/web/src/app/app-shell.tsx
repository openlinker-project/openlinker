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
 * an alerts trigger, and a user chip dropdown with the theme, density and
 * language controls.
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
import { interpolate, useMessages, useNumberFormat, usePlural } from '../shared/i18n';
import { resolveCrumbFromMatches } from './breadcrumbs';
import { buildNavGroups, navRoleOf, sessionNeedsOmsRouting } from './nav-registry';
import { useOmsRoutingState } from '../features/fulfillment-authority';
import type { NavGroup } from './nav-registry.types';
import { useNavCounts, type NavCounts } from './hooks/use-nav-counts';
import { Button } from '../shared/ui/button';
import { LanguageMenuList, restoreFocusAfterLanguageChange } from '../features/language';
import { EnvironmentBadge } from '../shared/ui/environment-badge';
import {
  DropdownMenu,
  DropdownMenuAnimatedContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../shared/ui/dropdown-menu';
import { ThemePicker } from '../features/appearance';
import { DensityToggle, useDensity } from '../shared/ui/density-toggle';
import { useToast } from '../shared/ui/toast-provider';
import { CommandPaletteProvider, useCommandPalette } from './command-palette-provider';
import { CommandPaletteTrigger } from '../shared/ui/command-palette';
import { DemoBanner } from '../shared/ui/demo-banner';
import { useSystemConfigQuery } from '../features/system';
import { captureDemoEvent, initDemoIntegrations } from '../features/demo';

interface SidebarNavProps {
  ariaLabel: string;
  counts: NavCounts;
  groups: NavGroup[];
  onNavigate?: () => void;
  /**
   * Marks the item with this `to` active instead of matching the URL. Only the
   * login page's background preview (#4029) sets it: it renders this nav on
   * `/login`, where no item would otherwise be active.
   */
  activeTo?: string;
}

export function SidebarNav({
  ariaLabel,
  counts,
  groups,
  onNavigate,
  activeTo,
}: SidebarNavProps): ReactElement {
  // i18n seam (#612): nav-item counts follow the active locale instead of
  // being pinned to en-US. `'en'` maps to BCP 47 `'en-GB'` and `'pl'` to
  // `'pl-PL'`, so each language gets its own grouping separators.
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
    locked: boolean
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
                          (activeTo === undefined ? isActive : activeTo === item.to)
                            ? 'shell-nav__link shell-nav__link--active'
                            : 'shell-nav__link'
                        }
                      >
                        <span className="shell-nav__link-label" title={item.label}>
                          {item.label}
                        </span>
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

export function SidebarBrand({ className = '' }: { className?: string }): ReactElement {
  const copy = useMessages('app');
  return (
    <div className={['shell-brand', className].filter(Boolean).join(' ')}>
      <img
        className="shell-brand__mark"
        src="/openlinker-logo.svg"
        alt=""
        aria-hidden="true"
        width={26}
        height={26}
      />
      <span className="shell-brand__name">{copy.brand.name}</span>
      <EnvironmentBadge />
    </div>
  );
}

interface WorkspaceFooterProps {
  onLogout?: () => void;
  username?: string;
  location: 'sidebar_footer' | 'mobile_drawer_footer';
  demoMode: boolean;
}

function WorkspaceFooter({
  onLogout,
  username,
  location,
  demoMode,
}: WorkspaceFooterProps): ReactElement {
  const copy = useMessages('app');
  return (
    <div className="shell-workspace">
      <div className="shell-workspace__header">
        <strong className="shell-workspace__name">{copy.shell.organization}</strong>
      </div>
      {demoMode ? (
        <a
          className="shell-workspace__github-link"
          href="https://github.com/openlinker-project/openlinker"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => captureDemoEvent('demo_opensource_link_clicked', { location })}
        >
          {copy.shell.viewOnGithub} <span aria-hidden="true">↗</span>
        </a>
      ) : null}
      {username ? (
        <div className="shell-workspace__user">
          <span className="shell-workspace__username">{username}</span>
          {onLogout ? (
            <Button tone="ghost" onClick={onLogout} className="shell-workspace__logout">
              {copy.userMenu.signOut}
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
  const copy = useMessages('app').userMenu;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A language picked in this menu remounts the app; focus comes back here.
  useEffect(() => {
    restoreFocusAfterLanguageChange(triggerRef.current);
  }, []);
  const themeCopy = useMessages('ui').theme;
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="shell-user-chip"
          aria-label={interpolate(copy.accountMenu, { username })}
        >
          <span className="shell-user-chip__avatar" aria-hidden="true">
            {initialsFrom(username)}
          </span>
          <span className="shell-user-chip__name">{username}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuAnimatedContent
        open={open}
        align="end"
        sideOffset={6}
        className="shell-user-chip__menu"
      >
        <DropdownMenuLabel>
          <div className="shell-user-chip__menu-name">{username}</div>
          {email ? <div className="shell-user-chip__menu-email">{email}</div> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="shell-user-chip__menu-section">
          <div className="shell-user-chip__menu-section-label">{copy.language}</div>
          <LanguageMenuList />
        </div>
        <div className="shell-user-chip__menu-section">
          <div className="shell-user-chip__menu-section-label">{themeCopy.label}</div>
          <ThemePicker />
        </div>
        <div className="shell-user-chip__menu-section">
          <div className="shell-user-chip__menu-section-label">{copy.density}</div>
          <DensityToggle />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onLogout}>{copy.signOut}</DropdownMenuItem>
      </DropdownMenuAnimatedContent>
    </DropdownMenu>
  );
}

export interface ShellTopbarProps {
  /**
   * Opens the mobile navigation drawer. Omitted by a layout with no sidebar
   * (the pack bench, #3401 follow-up) - a menu button that opens nothing is a
   * control shaped like one that is not.
   */
  readonly onOpenMenu?: () => void;
  /**
   * Renders the brand mark at the start of the bar. Only a layout with no
   * sidebar needs it: everywhere else the sidebar carries the logo.
   */
  readonly showBrand?: boolean;
  /**
   * Renders the command-palette trigger. A layout that does not mount a
   * `CommandPaletteProvider` must pass `false`, since the trigger reads that
   * context.
   */
  readonly showSearch?: boolean;
  readonly onLogout: () => void;
}

/**
 * The application's one topbar. Exported so a layout that deliberately has no
 * sidebar (`BenchAppLayout`) renders the SAME bar rather than a look-alike that
 * drifts. Must sit inside a `CommandPaletteProvider` unless `showSearch` is
 * `false`.
 */
export function ShellTopbar({
  onOpenMenu,
  showBrand = false,
  showSearch = true,
  onLogout,
}: ShellTopbarProps): ReactElement {
  const { session } = useSession();
  const username = session.user?.username;
  const email = session.user?.email ?? null;
  const copy = useMessages('app');
  const plural = usePlural();
  const crumbs = resolveCrumbFromMatches(useMatches(), copy);

  return (
    <header className="shell-topbar">
      {onOpenMenu ? (
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label={copy.shell.openMenu}
          className="shell-topbar__hamburger"
        >
          <span aria-hidden="true">☰</span>
        </button>
      ) : null}

      {/* On an ultrawide screen the brand moves out of the sidebar box into
          the bar, above the sidebar; CSS shows this copy only there. */}
      {showBrand ? <SidebarBrand /> : <SidebarBrand className="shell-brand--wide" />}

      <nav aria-label={copy.shell.breadcrumb} className="shell-crumbs">
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

      {showSearch ? <TopbarSearchTrigger /> : null}

      <div className="shell-topbar__spacer" />

      <Button tone="ghost" className="shell-topbar__alerts">
        {copy.shell.alerts} <span aria-hidden="true">0</span>
        <span className="sr-only">{plural(0, copy.shell.alertsNew)}</span>
      </Button>

      {username ? <UserChip username={username} email={email} onLogout={onLogout} /> : null}
    </header>
  );
}

export function AppShell({ children }: PropsWithChildren): ReactElement {
  const { isReady, session, clearSession } = useSession();
  const copy = useMessages('app');
  const { showToast } = useToast();
  const systemConfigQuery = useSystemConfigQuery();
  const demoMode = systemConfigQuery.data?.demoMode ?? false;
  const hasInitializedAnalyticsRef = useRef(false);
  const location = useLocation();
  const drawerRef = useRef<HTMLDialogElement>(null);
  // Until the session and the system config are known, the layout fills the
  // shell with a "Preparing workspace" placeholder. It stays invisible for a
  // short check (`.shell--pending`), and the shell fades in once it is settled.
  const settled = isReady && !systemConfigQuery.isPending;
  // Initialize density at boot so <html data-density="..."> is set before
  // any .data-table renders (avoids a flash of cozy-density rows for
  // users who selected compact). useDensity is a no-op hook for the
  // shell itself — we only call it to drive its useEffect.
  useDensity();
  const username = session.user?.username;
  const counts = useNavCounts();
  // The session's own role string, and the ONLY place this file reads it.
  //
  // Role-gated nav items (#3108) — e.g. "Pack bench" — need the raw string,
  // since `packer`'s ROLE_PERMISSIONS grant is deliberately empty (ADR-071)
  // and so carries no permission a `requiresPermission` gate could check
  // instead. `navRoleOf` is shared with ⌘K (#3108 review) so the two cannot
  // drift, and its docblock records why it needs no `isReady`: the provider
  // sets session and readiness in one batched callback, so no render observes
  // `authenticated` with `isReady` false and an unresolved session already
  // yields `undefined`.
  //
  // The two booleans below derive from it rather than re-spelling the same
  // expression a third and fourth time (#3204 review). They are a different
  // QUESTION from the nav gate — shell behaviour, not item visibility — but
  // they were the same DERIVATION, which is what the extraction was for. Note
  // the return type is `string | undefined`, not `Role | undefined`: `viewer`
  // is deliberately absent from the FE `Role` union (see `nav-registry.types`),
  // so `isViewerOnly` can only be expressed against the raw string.
  const role = navRoleOf(session);
  const isAdmin = role === 'admin';
  // Demo mode's "write actions are disabled" claim is only true for a
  // viewer-role session — RolesGuard lets admin/operator write fine, so
  // showing the banner to them is actively misleading during a live
  // walkthrough (#1468).
  const isViewerOnly = role === 'viewer';
  // Permission-gated nav items (#2358 review I5) need the session's permission
  // list, not just the admin flag — `/automations` is admin + operator.
  const permissions = session.user?.permissions;
  // `requiresOms` entries (#3505) follow the routing state; the read is only
  // issued for a session that could see one of them.
  const omsRouting = useOmsRoutingState({ enabled: sessionNeedsOmsRouting(permissions, role) });
  const groups = useMemo(
    () => buildNavGroups({ isAdmin, demoMode, permissions, role, omsRouting, copy }),
    [isAdmin, demoMode, permissions, role, omsRouting, copy],
  );

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
      showToast({ tone: 'info', description: copy.shell.loggedOut });
    })();
  }, [clearSession, showToast, copy]);

  // Demo-only analytics (#1301) — attempt init once the config query has
  // settled and the account's consent is known. Consent comes from the session
  // (#1938): it is decided at registration or on `/consent`, and a demo viewer
  // without it never reaches this shell. The loader's own guards (demoMode,
  // config presence, consent) make repeat calls a no-op, but
  // hasInitializedAnalyticsRef avoids a redundant dynamic import.
  useEffect(() => {
    if (!systemConfigQuery.isSuccess || hasInitializedAnalyticsRef.current) {
      return;
    }
    if (!isReady || session.status !== 'authenticated') {
      return;
    }
    if (session.user?.analyticsConsent !== true) {
      return;
    }
    hasInitializedAnalyticsRef.current = true;
    void initDemoIntegrations(systemConfigQuery.data, true);
  }, [systemConfigQuery.isSuccess, systemConfigQuery.data, isReady, session]);

  return (
    <CommandPaletteProvider>
      <div className={settled ? 'shell shell--app' : 'shell shell--pending'}>
        <div className="shell-sidebar">
          <SidebarBrand />
          <SidebarNav ariaLabel={copy.shell.navPrimary} counts={counts} groups={groups} />
          <WorkspaceFooter
            username={username}
            onLogout={username ? handleLogout : undefined}
            location="sidebar_footer"
            demoMode={demoMode}
          />
        </div>

        <dialog ref={drawerRef} className="shell-drawer" aria-label={copy.shell.mobileNavigation}>
          <div className="shell-drawer__inner">
            <div className="shell-drawer__header">
              <SidebarBrand />
              <Button
                tone="ghost"
                onClick={closeDrawer}
                aria-label={copy.shell.closeMenu}
                className="shell-drawer__close"
              >
                ✕
              </Button>
            </div>
            <SidebarNav
              ariaLabel={copy.shell.navPrimaryMobile}
              counts={counts}
              groups={groups}
              onNavigate={closeDrawer}
            />
            <WorkspaceFooter
              username={username}
              onLogout={username ? handleLogout : undefined}
              location="mobile_drawer_footer"
              demoMode={demoMode}
            />
          </div>
        </dialog>

        <div className="shell-main">
          <ShellTopbar onOpenMenu={openDrawer} onLogout={handleLogout} />

          {demoMode && isViewerOnly ? <DemoBanner /> : null}

          {/* `key={location.pathname}` retriggers the .shell-content
            cross-fade animation on every route change (#775). */}
          <main key={location.pathname} className="shell-content">
            {children}
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}
