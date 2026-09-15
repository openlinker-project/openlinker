/**
 * RequireAdmin
 *
 * Route-level guard for a page whose backing endpoint is `@Roles('admin')`
 * server-side but has no fitting `Permission` for `LiveNavItem.requiresPermission`
 * (#2358 review I5's per-item gate) — a new admin-only `Permission` would
 * expand `libs/core/src/users/domain/types/role.types.ts`'s vocabulary for a
 * single read-only diagnostic page, which is out of this feature's scope.
 *
 * Renders neither branch while the session is still hydrating (`isReady`
 * false) — "not known yet" is not "denied", the same rule `AccessGate` follows.
 * For a non-admin session it renders a plain access-restricted message and
 * never fires the page's own queries, so a non-admin never reaches the raw
 * 403 `ErrorState` the backing endpoint would otherwise produce.
 *
 * `session.user?.role === 'admin'` (never a helper) matches the existing
 * `isAdmin` derivation in `app-shell.tsx` / `command-palette-provider.tsx` —
 * `role` is typed `string` there too, so this stays consistent with the
 * codebase's one established admin-check shape rather than inventing a
 * second one.
 *
 * @module apps/web/src/app/routes
 */
import type { ReactElement, ReactNode } from 'react';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';

export function RequireAdmin({ children }: { children: ReactNode }): ReactElement | null {
  const session = useSession();

  if (!session.isReady) {
    return null;
  }

  const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';

  if (!isAdmin) {
    return (
      <ErrorState
        eyebrow="Access restricted"
        title="Admin access required"
        message="This diagnostic is available to admin accounts only."
      />
    );
  }

  return <>{children}</>;
}
