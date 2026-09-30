/**
 * Bench app layout
 *
 * The pack bench's chrome: the application's own `ShellTopbar`, with no
 * sidebar. The bench used to carry a topbar of its own (#3423), which drifted
 * from the rest of the app and left out the logo; it now renders the same bar
 * every other page does, with the brand mark in it because there is no sidebar
 * to carry one.
 *
 * ## Why this is not `AuthenticatedAppLayout`
 *
 * `/bench` stays a standalone route (`bench-route-placement.test.ts`): the idle
 * lock clears the session on purpose, and that layout answers an anonymous
 * session by navigating to `/login`, which would unmount the bench mid-parcel.
 * This layout therefore never reacts to the session on its own.
 *
 * ## Signing out is different from locking
 *
 * An idle lock keeps the bench mounted and shows its own locked screen. An
 * explicit "Sign out" from the user menu is a person leaving, so it goes to
 * `/login` like it does everywhere else. The query cache is cleared too, as the
 * bench's own lock does, because a shared terminal must not show the next
 * person what the last one was looking at.
 *
 * ## No search for a packer
 *
 * A packer is sent back to `/bench` from every other page, so a search across
 * orders, products and connections offers them only dead ends - and the
 * palette's own reads (`GET /orders`, `/connections`, `/sync-jobs`) answer a
 * packer with 403. So for a packer, and for a locked bench with nobody signed
 * in, the palette is not mounted at all: no trigger, no Cmd/Ctrl+K, no reads.
 *
 * The provider wraps the TOPBAR only, never `children`. Wrapping the page and
 * swapping the wrapper on the session would remount the bench body the moment
 * the idle lock clears the session - destroying the half-packed box that the
 * lock exists to protect (A3). Only the topbar may remount here.
 *
 * @module app/layouts
 */
import { useCallback, type PropsWithChildren, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { useSession } from '../../shared/auth/use-session';
import { useDensity } from '../../shared/ui/density-toggle';
import { useToast } from '../../shared/ui/toast-provider';
import { ShellTopbar } from '../app-shell';
import { CommandPaletteProvider } from '../command-palette-provider';
import { navRoleOf } from '../nav-registry';

export function BenchAppLayout({ children }: PropsWithChildren): ReactElement {
  const { session, clearSession } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  useDensity();

  const handleLogout = useCallback((): void => {
    void (async (): Promise<void> => {
      try {
        await clearSession();
      } finally {
        queryClient.clear();
        void navigate('/login', { replace: true });
        showToast({ tone: 'info', description: 'You have been logged out.' });
      }
    })();
  }, [clearSession, navigate, queryClient, showToast]);

  const role = navRoleOf(session);
  const showSearch = role !== undefined && role !== 'packer';

  return (
    <div className="shell shell--no-sidebar">
      <div className="shell-main">
        {showSearch ? (
          <CommandPaletteProvider>
            <ShellTopbar showBrand onLogout={handleLogout} />
          </CommandPaletteProvider>
        ) : (
          <ShellTopbar showBrand showSearch={false} onLogout={handleLogout} />
        )}
        <main className="shell-content shell-content--flush">{children}</main>
      </div>
    </div>
  );
}
