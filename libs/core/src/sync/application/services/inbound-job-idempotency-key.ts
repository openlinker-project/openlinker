/**
 * Inbound Job Idempotency Key
 *
 * The single authoring site for the idempotency key that ties an inbound
 * trigger (webhook event) to the sync job it enqueues. `InboundRoutingPolicyService`
 * stamps this key on every enqueued job; the same value lands on the persisted
 * `SyncJob` row, so it is the durable cross-reference callers use to resolve a
 * delivery back to its concrete job (#1366).
 *
 * Keeping the format in one exported function means no other layer (the HTTP
 * lookup endpoint, and transitively the frontend that feeds it) re-encodes the
 * `{platformType}:{connectionId}:{sourceEventId}` shape — they pass the raw
 * components and let this helper assemble them, so the format can evolve here
 * without silent drift across the FE/BE boundary.
 *
 * One webhook can fan out into several jobs (a translator returning more than
 * one canonical event). Every job after the first needs a key of its own or
 * the `sync_jobs` unique index would fold it onto the first, so the optional
 * `discriminator` is appended. The PRIMARY job never passes one: its key stays
 * byte-identical to the three-part form, because the lookup endpoint and the
 * frontend rebuild exactly that form to find "the job this delivery became".
 *
 * @module application/services
 */
export function buildInboundJobIdempotencyKey(
  platformType: string,
  connectionId: string,
  sourceEventId: string,
  discriminator?: string
): string {
  const base = `${platformType}:${connectionId}:${sourceEventId}`;
  return discriminator ? `${base}:${discriminator}` : base;
}
