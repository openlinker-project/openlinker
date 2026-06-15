# ADR-025: Erli marketplace adapter — reconciliation-first posture, API-key auth, Allegro-ID taxonomy reuse

- **Status**: Accepted
- **Date**: 2026-06-12
- **Authors**: @norbert-kulus-blockydevs

## Context

Erli is the second PL marketplace OpenLinker integrates (product spec #978, issues #980–#998). Its Shop API differs from Allegro's in ways that would silently break assumptions baked into the Allegro adapter if copied:

- **Async writes**: create/update requests return HTTP **202** — validated and stored, but propagated with a ~20-minute cache lag. Read-after-write lies.
- **Fragile webhooks**: order webhooks are fire-once with a 5-second timeout and **no retry**; a missed webhook is silently lost.
- **Static API key**: one bearer key from the seller panel — no OAuth2, no refresh, no expiry signal.
- **Allegro-sourced taxonomy**: Erli accepts category/parameter ids tagged `source:"allegro"` and resolves them against Allegro's own taxonomy (names ignored, only ids processed).
- **Asymmetric stock**: Erli auto-decrements stock on purchase but does **not** restore it on cancellation; seller-panel manual edits mark fields `frozen`, and API writes must not overwrite frozen **content** fields (`price`/`name`/`description`) — nor frozen `stock` on the quantity-sync path (#1066). See §4b.

## Decision

1. **Reconciliation-first posture.** No Erli write is treated as confirmed by its 202 response. Offer state is reconciled from snapshot reads (mirroring the `offer_status_snapshots` model of [ADR-009](./009-persisted-offer-status-snapshots.md)); order ingestion uses webhooks only as a low-latency *trigger* with a scheduled **inbox poll as the mandatory backstop** (the same trigger-vs-reconciliation split as PrestaShop's #904), converging idempotently on `OrderIngestionService.syncOrderFromSource`.
2. **Static API-key bearer auth.** Credentials are a single `apiKey` in the encrypted `integration_credentials` store, resolved via `host.credentialsResolver`. No OAuth completion port, no token-refresh service.
3. **Allegro-ID taxonomy reuse.** Erli offers are populated with the product's already-resolved **Allegro** category/parameter ids, tagged `source:"allegro"` (the concrete field names are pinned by the implementing PR, #984+). OL builds no Erli-native taxonomy path in v1; products without Allegro taxonomy data are skipped with a clear error (spec #978 §6).
4. **Adapter-level stock/ownership invariants.** The adapter owns two Erli-specific compensations: (a) on order cancellation OL issues a stock-restore PATCH (because Erli won't) — **deferred to #993**, as core has no order-cancellation orchestration yet (`OrderProcessorManagerPort` only has `createOrder`); and (b) on the field-update path (`updateOfferFields` — `price`/`name`/`description`) the adapter reads the live resource and excludes any field the seller marked `frozen`, so OL never overwrites a manual edit. Frozen `stock` is also honored on the hot quantity path (`updateOfferQuantity`) **without** adding a per-tick GET (#1066): the steady-state reconciliation sweep (`getOfferStatus`, #989) already reads each offer, so it caches a per-offer "stock frozen" flag; the quantity path consults only that cached flag (a sub-ms cache read) and skips the PATCH when set. A freeze landing between reconciliation passes is overwritten at most once until the next sweep refreshes the flag — eventual-consistency consistent with §1. The cancel-restore PATCH (a) remains **deferred to #993**, as core has no order-cancellation orchestration yet (`OrderProcessorManagerPort` only has `createOrder`).

## Alternatives considered

- **Trust 202 as write confirmation (Allegro-style synchronous semantics)**: rejected — the ~20-min cache lag would show operators "live" offers that Erli later rejects; reconciliation is the only honest source of truth.
- **Webhook-only order ingestion**: rejected — no-retry/5 s webhooks guarantee silent order loss under any downtime; the inbox poll (cursor = newest-read inbox message id) is required for correctness, webhooks only improve latency.
- **Erli-native taxonomy authoring**: rejected for v1 — duplicates the category/parameter mapping effort the operator already invested for Allegro and kills the near-free-listing value proposition (spec #978 risk R2). Revisit only for products with no Allegro data.
- **OAuth-style credential rotation layer**: rejected — Erli has no OAuth; wrapping a static key in a rotation abstraction adds machinery with nothing to rotate. The auth-failure classifier ([ADR-008](./008-auth-failure-classifier-connection-reauth.md)) covers revoked-key detection.

## Consequences

**Pros:**
- Operator-visible state is always reconciled truth, never optimistic 202 echo.
- Order ingestion survives webhook loss by construction.
- Listing onto Erli reuses Allegro mappings — the integration's core economic bet.

**Cons / trade-offs:**
- Status freshness is bounded by poll/reconcile cadence (minutes, not seconds).
- Allegro-ID reuse couples Erli listing quality to the operator's Allegro taxonomy hygiene; products without Allegro data cannot list in v1.
- Frozen-field exclusion means OL silently skips fields the seller edited manually — **content** fields (`price`/`name`/`description`) on the field-update path and frozen `stock` on the quantity path (#1066) — with no conflict UI in v1 (spec #978 §6). Frozen `stock` honoring is bounded by the reconciliation cadence (a freeze may be overwritten once before the next sweep caches it). The cancel-restore PATCH remains a v1 follow-up (#993).

## References

- Related issues: #978 (product spec), #980–#998 (implementation), #983 (this ADR)
- Related ADRs: [ADR-009](./009-persisted-offer-status-snapshots.md), [ADR-008](./008-auth-failure-classifier-connection-reauth.md), [ADR-015](./015-inbound-event-routing-capability-translated.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
- Product spec: [docs/specs/product-spec-978-erli-marketplace-integration.md](../../specs/product-spec-978-erli-marketplace-integration.md)
- Erli Shop API documentation: https://erli.pl/svc/shop-api/doc/
