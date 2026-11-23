/**
 * Release center access (#4146, ADR-086)
 *
 * Who may call `/release-state` at all. The API admits admin, operator and
 * viewer and refuses `packer`; `fulfillment:read` is held by exactly those
 * three roles, so it is the permission that mirrors the route. A packer and an
 * anonymous session never issue a request.
 *
 * @module features/release-center/hooks
 */
import { usePermission, useIsAdmin } from '../../../shared/auth/use-permission';
import { useSession } from '../../../shared/auth/use-session';

export interface ReleaseCenterAccess {
  /** May read state and write user-scope state (cursor, item states). */
  canRead: boolean;
  /** May write installation-wide step state (`PUT /steps`, admin only). */
  canWriteSteps: boolean;
}

export function useReleaseCenterAccess(): ReleaseCenterAccess {
  const { isReady, session } = useSession();
  const hasPermission = usePermission('fulfillment:read');
  const isAdmin = useIsAdmin();
  const canRead = isReady && session.status === 'authenticated' && hasPermission;
  return { canRead, canWriteSteps: canRead && isAdmin };
}
