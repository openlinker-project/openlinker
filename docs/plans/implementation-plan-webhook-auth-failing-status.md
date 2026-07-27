# Implementation Plan — Distinguish "never registered" from "auth-failing" webhook status (#1814)

Stacked on `1770-infakt-webhook-config-modal` (PR #1773), which introduces `WebhookStatusService`.

## Problem

`WebhookStatusService.getStatus` derives `activation` solely from whether any `webhook_deliveries`
row exists. Auth-rejected deliveries (missing/wrong signing secret) are thrown out of
`WebhookService.processWebhook` *before* any row is written (ADR-005: `webhook_deliveries` is
reserved for verified deliveries). So a connection whose every delivery is 401-ing looks identical
to one that was never registered — both report `not-registered` / "Awaiting first event".

## Goal

Record a durable, per-connection signal of auth-rejected deliveries **outside** `webhook_deliveries`,
and expose a third `activation` state `auth-failing` so an actively-failing integration is visually
distinct from an inert one.

## Design pass (decisions)

### Storage shape — one rolling row per `(provider, connectionId)`

New table `webhook_auth_rejections`, one row per connection (composite unique key
`(provider, connectionId)`), upserted on each rejection:

- `rejectionCount` bigint — monotonic rolling counter (observability only)
- `firstRejectedAt` / `lastRejectedAt` timestamptz
- `lastReason` text — short machine reason (`invalid_signature`)

Rejected — an append-only per-attempt log (unbounded growth, needs pruning; the projection only needs
"is there a recent rejection", so a rolling row is sufficient). Rejected — a column on `connections`
(pollutes core identity with webhook telemetry) and appending to `webhook_deliveries` (forbidden by
ADR-005; an eventId-keyed `rejected` row would also block legitimate retries via the unique constraint).

### Provider-genericity — generic, keyed on `(provider, connectionId)`

Recording lives in the provider-agnostic `WebhookService`, so the signal is captured for every
provider (inFakt, PrestaShop, InPost, Erli), mirroring `webhook_deliveries`. The FE surface is
inFakt-only today, but the signal and the status service stay generic.

### What counts as a rejection

Only **signature-verification failure** (`verifyResult.ok === false` — the missing/wrong-secret case
the issue targets). Excluded: `assertConnectionUsable` failures (an inactive/misrouted connection
isn't "registered but failing") and replay failures (a valid signature with a stale timestamp — the
secret is correct). Recording is **non-fatal** (try/catch + `logger.warn`, mirroring `recordDelivery`)
— it must never change the 401 response.

### Retention / reset — recency window + delivery-recency precedence (self-healing)

`WebhookStatusService` derives activation as:

1. `auth-failing` — a rejection exists, `lastRejectedAt` is within a 24h freshness window, AND it is
   newer than the last verified delivery (or there is no delivery).
2. else `verified` — a `webhook_deliveries` row exists.
3. else `not-registered`.

This self-heals: once a real delivery lands after the fix, `verified` wins; if rejections stop, the
state reverts to `not-registered` after the window. `rejectionCount` never resets (informative only);
derivation keys on timestamps.

### ADR

No ADR — the invariant "`webhook_deliveries` = verified deliveries only" is pre-existing (ADR-005);
this change *upholds* it by putting the new signal in a separate table. Documented in
architecture-overview's webhook-flow section.

## Steps

### Core (`libs/core/src/webhooks`) — mirrors the `webhook_deliveries` layout
1. `domain/entities/webhook-auth-rejection.entity.ts` — anemic readonly entity.
2. `domain/ports/webhook-auth-rejection-repository.port.ts` — `recordRejection(input)` + `find(provider, connectionId)`.
3. `infrastructure/persistence/entities/webhook-auth-rejection.orm-entity.ts`.
4. `infrastructure/persistence/repositories/webhook-auth-rejection.repository.ts` — raw parameterized
   `INSERT … ON CONFLICT DO UPDATE` incrementing the counter (avoids the #1511 InsertQueryBuilder trap).
5. `webhooks.tokens.ts` — add `WEBHOOK_AUTH_REJECTION_REPOSITORY_TOKEN`.
6. `webhooks-core.module.ts` — register ORM entity + repo, export the token.
7. `index.ts` — export entity + port.

### Migration
8. `apps/api/src/migrations/<ts>-add-webhook-auth-rejections.ts` — create table + unique key.

### Recording (`apps/api/src/webhooks`)
9. `webhook.service.ts` — inject the rejection repo; on `!verifyResult.ok`, record (non-fatal) then throw.

### Status projection (`apps/api/src/integrations`)
10. `application/types/webhook-status.types.ts` — add `'auth-failing'` to `WebhookActivationValues`.
11. `application/services/webhook-status.service.ts` — inject the rejection repo; derive the third state.
    (`webhook-status-response.dto.ts` picks up the new value automatically via `WebhookActivationValues`.)

### Cross-context allow-list
12. `scripts/check-cross-context-imports.mjs` — add `WebhookAuthRejectionRepositoryPort` entries for the
    two consuming files + their specs (same pattern as `WebhookDeliveryRepositoryPort`).

### Frontend (`apps/web`)
13. `features/connections/api/connections.types.ts` — add `'auth-failing'` to `WebhookActivation`.
14. `features/connections/components/infakt-webhook-config.tsx` — `activationLabel` returns an
    `error`-tone badge for `auth-failing`; add an inline alert guiding the operator to re-check the secret.

### Tests
15. Core repo behaviour is covered by the integration path; add a focused unit spec for the repository upsert if cheap.
16. `webhook.service.spec.ts` — records a rejection on signature failure; still non-fatal if the write throws.
17. `webhook-status.service.spec.ts` — `auth-failing` when recent rejection newer than delivery; `verified` wins when a newer delivery exists; stale rejection → not-registered.
18. `infakt-webhook-config.test.tsx` — renders the failing badge for `auth-failing`.
19. `pnpm --filter @openlinker/api migration:show` reports no pending migrations.
