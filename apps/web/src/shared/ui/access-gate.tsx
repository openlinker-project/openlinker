/**
 * AccessGate
 *
 * Permission gate for *content* — an informational banner, panel, section, or
 * column that only makes sense to a session holding a given permission.
 * Renders `children` when the permission is held, and `fallback` (nothing by
 * default) when it is not.
 *
 * Deliberately **demo-mode-unaware**, which is the whole distinction from
 * `ReadOnlyLock`: a demo viewer is shown write affordances disabled, to
 * advertise that the capability exists (#1615) — but an explanation addressed
 * to someone who cannot act should not render at all. Keeping demo mode out
 * also keeps this component inside `shared/`, which may not import `features/`
 * (`useDemoMode` lives in `features/system`).
 *
 * While the session is still hydrating, `permissions` is `[]`, so a naive gate
 * would flash `fallback` and then reveal `children`. `isReady` is handled here
 * rather than at every call site, because "not known yet" is not "denied":
 * neither branch renders until the session resolves.
 *
 * For a decision that isn't a subtree — a query's `enabled:`, a computed
 * `disabled`, tooltip copy — use `usePermission` directly. There is no hook
 * counterpart to this component; it would duplicate that one.
 *
 * @module shared/ui
 * @see {@link ReadOnlyLock} for gating a write affordance instead of content
 */
import type { ReactElement, ReactNode } from 'react';
import type { Permission } from '../auth/session.types';
import { usePermission } from '../auth/use-permission';
import { useSession } from '../auth/use-session';

export interface AccessGateProps {
  /**
   * Permission the session must hold to see `children`. Typed against the
   * `Permission` union, so a typo is a compile error rather than a silently
   * closed gate.
   */
  require: Permission;
  /**
   * Rendered when the session is known and lacks the permission. Omit to
   * render nothing, which is the common case for supplementary content.
   */
  fallback?: ReactNode;
  children: ReactNode;
}

export function AccessGate({
  require: requiredPermission,
  fallback = null,
  children,
}: AccessGateProps): ReactElement | null {
  const { isReady } = useSession();
  const allowed = usePermission(requiredPermission);

  if (!isReady) {
    return null;
  }

  return <>{allowed ? children : fallback}</>;
}
