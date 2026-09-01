/**
 * isAdminSession
 *
 * The single place the literal `'admin'` is compared against
 * `SessionUser.role` in the frontend.
 *
 * `role` is typed `string` (it mirrors a backend column, not a closed union),
 * so an inline `session.user?.role === 'admin'` typo compiles and silently
 * evaluates false - `frontend-architecture.md § Access Control` bans the
 * inline comparison for exactly that reason. Permission-gated affordances
 * should still use `usePermission` / `useWriteAccess`; this helper is only for
 * a surface whose server-side gate is `@Roles('admin')` itself and for which
 * no `Permission` exists (today: the sales-document manual override, and the
 * admin-only nav entries).
 *
 * Client-side this is a VISIBILITY decision, never enforcement: the write
 * paths behind it are guarded server-side, so a wrong answer here hides a
 * control, it never opens one.
 *
 * @module shared/auth
 */
import type { Session } from './session.types';

/** The one occurrence of the role literal in `apps/web`. */
const ADMIN_ROLE = 'admin';

export function isAdminSession(session: Session): boolean {
  return session.status === 'authenticated' && session.user?.role === ADMIN_ROLE;
}
