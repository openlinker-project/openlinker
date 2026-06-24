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
