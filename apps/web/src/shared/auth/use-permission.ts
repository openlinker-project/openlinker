import { useSession } from './use-session';

/**
 * Returns true when the authenticated user holds the given permission.
 *
 * Always returns false for anonymous sessions. Drives write-control
 * visibility in the UI (#1124); every create/edit/delete/sync/publish
 * affordance should be gated via this hook rather than an inline
 * `role === 'admin'` check so the permission model stays in one place.
 *
 * @example
 * const canWrite = usePermission('connections:write');
 * // <button disabled={!canWrite}>New Connection</button>
 */
export function usePermission(permission: string): boolean {
  const { session } = useSession();
  return session.user?.permissions.includes(permission) ?? false;
}
