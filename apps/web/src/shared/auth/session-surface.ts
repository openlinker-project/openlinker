/**
 * Which shell a session may use (#3096, F-9)
 *
 * A packer's whole job is the pack bench. Before this, a packer who signed in
 * landed on Analytics inside the full admin shell — fifteen nav entries whose
 * every read answered 403 — and a deep link to an order or a fulfilment task
 * rendered that shell around an error card. The API already refuses all of it;
 * this is the friendly face of the same rule, decided once, in the layouts.
 *
 * ## From permissions, never from the role name
 *
 * `docs/frontend-architecture.md` § Access Control: `permissions[]` is the only
 * authorization input the frontend reads, and `role` is never compared inline.
 * "Bench-only" is therefore defined by what the session holds: it may work the
 * bench (`bench:write`) and may read nothing of the app (`orders:read` is held
 * by every role that can — admin, operator, viewer). Today exactly one role
 * matches, and `libs/core/src/users/domain/types/role.types.spec.ts` pins that
 * equivalence so a `ROLE_PERMISSIONS` change that breaks it fails the build.
 *
 * A future role holding neither permission resolves to `app` and meets the
 * ordinary 403 states — fail-safe, because the API refuses it regardless.
 *
 * @module shared/auth
 */
import type { Session } from './session.types';
import { useSession } from './use-session';

/** `unknown` while the session hydrates — "not known yet" is not "denied". */
export type SessionSurface = 'unknown' | 'anonymous' | 'bench-only' | 'app';

export function resolveSessionSurface(isReady: boolean, session: Session): SessionSurface {
  if (!isReady) return 'unknown';
  if (session.status !== 'authenticated' || session.user === null) return 'anonymous';
  const permissions = session.user.permissions;
  return permissions.includes('bench:write') && !permissions.includes('orders:read')
    ? 'bench-only'
    : 'app';
}

export function useSessionSurface(): SessionSurface {
  const { isReady, session } = useSession();
  return resolveSessionSurface(isReady, session);
}

/** Where a bench-only session always lands. */
export const BENCH_PATH = '/bench';
