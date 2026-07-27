import { useSession } from './use-session';
import type { Permission } from './session.types';

/**
 * Returns true when the authenticated user holds the given permission.
 *
 * Always returns false for anonymous sessions. Drives write-control
 * visibility in the UI (#1124); every create/edit/delete/sync/publish
 * affordance should be gated via this hook rather than an inline
 * `role === 'admin'` check so the permission model stays in one place.
 *
 * The `Permission` type catches typos at compile time — `'connection:write'`
 * (singular) vs the correct `'connections:write'` is a type error, not a
 * silent runtime false.
 *
 * @example
 * const canWrite = usePermission('connections:write');
 * // <button disabled={!canWrite}>New Connection</button>
 */
export function usePermission(permission: Permission): boolean {
  const { session } = useSession();
  return session.user?.permissions.includes(permission) ?? false;
}

/**
 * Write-access decision for a permission-gated affordance, aware of demo mode.
 *
 * Splits the two "can't write" cases that used to collapse into a single
 * hidden control (#1615):
 *
 * - `canWrite` — the session holds the permission; render enabled.
 * - `demoReadOnly` — the session lacks the permission **but** the deployment is
 *   a public demo, so the affordance still renders (disabled, with a read-only
 *   tooltip) to advertise that the capability exists. This is the relaxation
 *   scoped to demo read-only viewers.
 * - neither — genuinely unauthorized non-demo session; `visible` is false and
 *   the caller keeps the existing hide-when-missing behaviour.
 *
 * `demoMode` is passed in (rather than read here) so this hook stays in the
 * `shared` layer without importing the `features/system` demo-mode hook — call
 * sites resolve it via `useDemoMode()`.
 *
 * @example
 * const demoMode = useDemoMode();
 * const write = useWriteAccess('connections:write', demoMode);
 * // {write.visible && <Button disabled={write.demoReadOnly}>Disable</Button>}
 */
export interface WriteAccess {
  /** Session holds the permission — full write access. */
  canWrite: boolean;
  /** Write blocked, but the control still renders (disabled) — demo viewer. */
  demoReadOnly: boolean;
  /** Whether the write affordance should render at all. */
  visible: boolean;
}

export function useWriteAccess(permission: Permission, demoMode: boolean): WriteAccess {
  const canWrite = usePermission(permission);
  const demoReadOnly = !canWrite && demoMode;
  return { canWrite, demoReadOnly, visible: canWrite || demoReadOnly };
}
