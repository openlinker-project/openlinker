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
 * Uses `useIsAdmin()` (`shared/auth/use-permission.ts`) rather than an inline
 * `session.user?.role === 'admin'` check — `role` is typed `string`, so that
 * comparison compiles with a typo and silently evaluates false. `useIsAdmin`
 * is documented as "the one place the admin role name is spelled" for exactly
 * this case: a route guarded by `@Roles('admin')` with no permission to gate
 * on instead.
 *
 * @module apps/web/src/app/routes
 */
import type { ReactElement, ReactNode } from 'react';
import { useIsAdmin } from '../../shared/auth/use-permission';
import { useSession } from '../../shared/auth/use-session';
import { ErrorState } from '../../shared/ui/feedback-state';

export function RequireAdmin({ children }: { children: ReactNode }): ReactElement | null {
  const { isReady } = useSession();
  const isAdmin = useIsAdmin();

  if (!isReady) {
    return null;
  }

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
