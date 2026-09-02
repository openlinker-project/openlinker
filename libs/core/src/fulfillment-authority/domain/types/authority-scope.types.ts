/**
 * Authority Scope (#2304, ADR-052)
 *
 * An authority is granted over a *scope*, never globally by default, because
 * scope is physical control: A6 is scoped to the payment instrument because
 * only the credential holder CAN refund; A3 to the work object because only the
 * party with stock in hand CAN ship.
 *
 * Every identifier here is an **opaque string**. In particular `locationId`
 * refers to a row in the `inventory_locations` table (ADR-058, Wave 1b) that
 * does not exist yet — carrying it as a string is what keeps this leaf free of
 * a sibling-context edge, and locations stay rows rather than jsonb precisely so
 * per-location partitioning does not degrade to string comparison in config
 * (DESIGN §3 adjudication 2).
 *
 * @module libs/core/src/fulfillment-authority/domain/types
 * @see docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md
 */

import type { AuthorityKind } from './authority-kind.types';

/** The scope discriminators, in the order DESIGN §2.1 lists them. */
export const AuthorityScopeKindValues = [
  'global',
  'location',
  'channel',
  'order',
  'work',
] as const;

export type AuthorityScopeKind = (typeof AuthorityScopeKindValues)[number];

/**
 * What an authority claim covers.
 *
 * - `global`   — every scope of that kind. The enclosing tier: an exact-scope
 *   claimant always beats a `global` one (see `selectAuthorityHolder`).
 * - `location` — one `inventory_locations` row (A1).
 * - `channel`  — one source/destination connection. A2/A5 configuration hangs
 *   on the source connection, since real sellers split by channel.
 * - `order`    — one order (A2/A4/A6 resolve per order).
 * - `work`     — one `FulfillmentWork` object (A3, minted by routing).
 */
export type AuthorityScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'location'; readonly locationId: string }
  | { readonly kind: 'channel'; readonly connectionId: string }
  | { readonly kind: 'order'; readonly orderId: string }
  | { readonly kind: 'work'; readonly workId: string };

/**
 * A stable, comparable key for one scope.
 *
 * Pure and total — used to compare two claims for "same scope" without
 * per-kind branching at every call site. The `kind:` prefix keeps a location id
 * and an order id that happen to share a value from colliding.
 */
export function authorityScopeKey(scope: AuthorityScope): string {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'location':
      return `location:${scope.locationId}`;
    case 'channel':
      return `channel:${scope.connectionId}`;
    case 'order':
      return `order:${scope.orderId}`;
    case 'work':
      return `work:${scope.workId}`;
  }
}

/** Narrow an untrusted value to an `AuthorityScope`, id shape included. */
export function isAuthorityScope(value: unknown): value is AuthorityScope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { kind?: unknown; [key: string]: unknown };
  switch (candidate.kind) {
    case 'global':
      return true;
    case 'location':
      return typeof candidate.locationId === 'string' && candidate.locationId.length > 0;
    case 'channel':
      return typeof candidate.connectionId === 'string' && candidate.connectionId.length > 0;
    case 'order':
      return typeof candidate.orderId === 'string' && candidate.orderId.length > 0;
    case 'work':
      return typeof candidate.workId === 'string' && candidate.workId.length > 0;
    default:
      return false;
  }
}

/**
 * One resolved grant: this connection holds this authority over this scope.
 *
 * A record of a resolution's OUTPUT, not a persisted row — authority assignment
 * is `Connection.config` jsonb in v1, never a table (DESIGN §3 adjudication 3),
 * so there is no migration behind this type.
 */
export interface AuthorityAssignment {
  readonly kind: AuthorityKind;
  readonly scope: AuthorityScope;
  readonly connectionId: string;
}
