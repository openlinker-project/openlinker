# Implementation Plan — #989: Erli offer-status reconciliation snapshot

**Date**: 2026-06-15 · **Status**: Implemented · **Effort**: M · **Branch**: `989-erli-offer-status-recon` (off `986-erli-variant-grouping`) · **ADR**: ADR-025 §1 · Wave-4.

## Goal
Give OL trustworthy Erli offer status despite async 202 + ~20-min cache lag. After listing, OL eventually shows the real status (accepted/active/inactive/rejected), not just "submitted"; rejected offers reflect as such.

## Decisions (code-verified)
- **Reuse the platform-agnostic core snapshot infra — NO migration.** `offer_status_snapshots` + `OfferStatusSyncService` are connection-keyed and resolve the adapter via `getCapabilityAdapter<OfferManagerPort>` + `isOfferStatusReader`. Erli only (a) implements `OfferStatusReader` and (b) registers a scheduler task enqueuing the existing `marketplace.offer.statusSync` job. No new worker handler, no core change.
- **No core enum change.** Erli's `accepted/active/inactive/rejected` maps onto the closed `OfferPublicationStatus = active|activating|inactivating|inactive|ended`: `active`→`active`; `accepted` (stored, still propagating)→`activating`; `rejected`→`inactive` + reason in `validationErrors` (`OfferStatusReadResult` carries them); `inactive`/unknown→`inactive`. Avoids the data-migration risk an enum change carries (offer-status-read.types ADR-009 note).

## Implementation
1. **`erli-product.types.ts`** — `ErliProductStatus` (provisional #992) + `status?`/`statusReason?` on `ErliProductResource` (the read shape shared with #988's `fetchErliProduct`).
2. **`erli-offer-manager.adapter.ts`**:
   - `implements … OfferStatusReader`.
   - `getOfferStatus(externalOfferId)` — reuses `fetchErliProduct` (GET via `productPath`, validate+encode → hostile id fails closed); 404 → `OfferNotFoundOnMarketplaceException(externalOfferId, connectionId)` (capability contract); other transport errors propagate. Maps via `mapErliStatusToReadResult` (module fn).
   - **`createOffer` 202 stays `'draft'`** (NOT flipped to `'validating'`). Although an `OfferStatusReader` now exists, the Allegro-tuned `OfferStatusPollService` treats a GET-404 as terminal on iteration 1 and its ~9.5-min budget is shorter than Erli's ~20-min cache lag — flipping to `'validating'` would let the poller falsely fail valid-but-not-yet-readable offers. Steady-state reconciliation (the `erli-offer-status-sync` scheduler task below) is the correct mechanism to surface the real status, not the creation poller. The #984 docblock + adapter comment record this.
3. **`infrastructure/scheduler/erli-scheduler-tasks.ts`** (new) — `buildErliSchedulerTasks()` → one `SchedulerTaskConfig` `erli-offer-status-sync` (jobType `marketplace.offer.statusSync`, cursor `erli.offerStatus.scanOffset`, hourly default, `enabledEnvVar OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`). No `ConfigService` (Erli uses `createNestAdapterModule`); registered unconditionally, the env gate is re-checked by the scheduler at each tick.
4. **`erli-plugin.ts` `register(host)`** — `host.schedulerTaskRegistry.register(task)` for each.

## Tests
`getOfferStatus` mapping (active/accepted/inactive/undefined → publicationStatus; rejected → inactive + ERLI_REJECTED validationError); 404 → `OfferNotFoundOnMarketplaceException`; non-404 propagates; hostile id fails closed; `isOfferStatusReader(adapter)` true; createOffer still returns `'draft'` (see Implementation §2 — deliberately not flipped to `'validating'`); plugin registers the scheduler task. **113 erli tests green, type-check + lint clean.**

## Risks
- **#992-provisional**: Erli status field name + value set unconfirmed → isolated in `erli-product.types.ts`.
- **Status mapping lossy-ish**: `accepted` vs `active` distinction depends on Erli exposing both; if not, both collapse to `active`/`activating` — adjust the one mapping fn. Confirm at #992.
- Scheduler cron/page-size are hardcoded defaults (no ConfigService); tune via env if needed (only the enable gate is env-driven today).

## Related
- Wave-4 meta-plan · ADR-025 §1 · #816 (`offer_status_snapshots`) · #984 (createOffer) · #988 (`fetchErliProduct`)
