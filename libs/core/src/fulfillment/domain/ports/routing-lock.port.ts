/**
 * Routing Lock Port (#2395, `W3a-6`)
 *
 * The narrow slice of distributed locking the routing commit needs.
 *
 * ## Why this is re-declared instead of imported
 *
 * `SyncLockPort` in `@openlinker/core/sync` is the same shape and is the
 * implementation every caller will pass. It is not imported because
 * `fulfillment` is a registered zero-sibling-edge leaf: `barrel-purity.spec.ts`
 * authorizes exactly two TYPE-ONLY specifiers for this context, and a token
 * import would be a VALUE edge, which that spec forbids unconditionally.
 *
 * So the port is declared here and `SyncLockPort` satisfies it **structurally** —
 * `acquire(key, ttlMs) => Promise<string | null>` and
 * `release(key, token) => Promise<boolean>` match member for member. The host
 * passes its injected `SyncLockPort` straight in; no adapter, no wrapper and no
 * import is needed in either direction. TypeScript's structural typing is doing
 * real architectural work here rather than being worked around.
 *
 * `extend` is deliberately NOT included. The routing lock is single-shot for the
 * same reason the invoicing one is: the window it must cover is
 * guard-read -> `claimIntent`, and past that point a persisted `live` decision
 * row is what protects the order. There is nothing left for a heartbeat to
 * protect, and offering one would invite a caller to hold the lock across the
 * router call and mistake that for the guarantee.
 *
 * @module libs/core/src/fulfillment/domain/ports
 */
export interface RoutingLockPort {
  /** A token when acquired, `null` when someone else holds it. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  /** Compare-and-delete. `false` means the lock was no longer ours. */
  release(key: string, token: string): Promise<boolean>;
}
