# Implementation Plan — #1040 Extract destination-neutral listing orchestration

**Issue:** #1040 · **Epic:** #1005 · **ADR-024 §4** · **Branch:** `1040-neutral-listing-orchestration`

---

## Phase 1 — Understand

**Goal.** Lift the ~60% destination-neutral scaffolding out of the bulk **offer** pipeline so both `marketplace.offer.create` and the future `shop.product.publish` reuse it. Builders stay separate. Migrate the existing offer path onto the neutral primitives with **no behaviour change**.

**Layer.** CORE (`listings`) + worker wiring. **Refactor of a hot subsystem** (#726/#734/#736/#737/#742).

**AC.** Existing single + bulk offer creation green on the neutral primitives (full `pnpm test:integration`); no offer-specific names in the extracted orchestration.

**Key finding (from research).** The batch aggregate, `bulk_batch_advancements` gate, `BulkOfferCreationProgressService`, `BulkOfferCreationRetryService`, `BulkOfferCreationSubmitService` + variant expansion are **already behaviourally neutral** — they carry no Allegro/offer logic, only offer-flavoured *names* and a coupling to `OfferCreationRecord` as the "child". Genuinely offer-specific (stays): `OfferBuilderService`, `OfferCreationExecutionService`, the Allegro `CreateOfferCommand`, the V1/V2 payload + worker handler. So this is mostly **rename + introduce an `operation` discriminator + abstract the child seam** — not a behavioural rewrite.

**Non-goals.** No `shop.product.publish` implementation (that's #1041/#1042/#1043). No builder changes. No AI/description changes. No new behaviour on the offer path.

---

## Phase 2 — Research (surface map)

Neutral-in-behaviour, offer-named (→ neutralize):
- `BulkOfferCreationBatch` (entity + `BulkOfferCreationBatchOrmEntity` → table `bulk_offer_creation_batches`) + repo + port + `BulkBatchStatus` + `CreateBulkOfferCreationBatchInput`.
- `BulkBatchAdvancement` (+ ORM table `bulk_batch_advancements`) + repo + port — already neutrally named (`BulkBatch*`).
- `BulkOfferCreationProgressService` (advance/derive terminal) , `BulkOfferCreationRetryService` (reset+reopen+re-enqueue), `BulkOfferCreationSubmitService` (+ `expandVariantJobs`, master-stock resolution).
- `OfferCreationEnqueueService` — V1/V2 routing is neutral, but pre-creates an `OfferCreationRecord` (offer-named child).

Offer-specific (stays as-is):
- `OfferBuilderService`, `OfferCreationExecutionService`, `OfferCreationRecord` (carries `externalOfferId`, `classificationReport` — offer concepts), `CreateOfferCommand`, `marketplace.offer.create` V1/V2 payload + `MarketplaceOfferCreateHandler`.

Contract surface: `@openlinker/core/listings` barrel exports the bulk types/interfaces/ports/tokens; `@openlinker/core/listings/services` exports `ListingsModule` + service classes. ~58 files reference `BulkOfferCreation*`. Tokens in `listings.tokens.ts`.

Tests (regression net the AC requires green): 6 service unit specs + 2 entity specs + 2 repo specs; int-specs `listings-bulk-offer-creation.int-spec.ts`, `listings-bulk-offer-creation-retry-failed.int-spec.ts`, `listings-create-offer.int-spec.ts`; worker `marketplace-offer-create.handler.spec.ts`.

---

## Phase 3 — Design (the decisions that need your call)

The crux: the neutral progress/retry services currently couple to `OfferCreationRecord` as "the child". To be truly destination-neutral they must speak to the child through a **narrow neutral seam**, not the offer record.

**Approved approach — symbol-neutralize + `operation` discriminator + TWO neutral seams, keep physical tables:**
1. **Rename the neutral aggregate + services** `BulkOfferCreation* → BulkListing*` (`BulkListingBatch`, `BulkListingSubmitService`, `BulkListingProgressService`, `BulkListingRetryService`) + interfaces/tokens/params (`offerCreationRecordId` → `childId`). Add `operation` as **`as const` `BulkListingOperation = 'offer.create' | 'shop.publish'`**.
2. **Keep DB table names unchanged** (`bulk_offer_creation_batches`, `bulk_batch_advancements`, `offer_creation_records`) — the renamed class keeps mapping to the existing table via `@Entity('…')`, **no data-migration risk**. Only the `operation` column is added. **Exclude the historical `1797…` migration from the rename** (it's immutable history; the table-name string stays). [fork A — confirmed]
3. **Two neutral seams** (the crux):
   - **`BatchChildRepositoryPort`** — `findByBatchId`, `resetForRetry`, … — implemented by `OfferCreationRecordRepository`. Lets neutral progress/retry read/reset children without naming `Offer`.
   - **`ListingChildEnqueuerPort`** — `enqueueChild(batch, childInput)` / `reEnqueueChild(batch, child, retryWaveId)` — resolved by `batch.operation` (strategy). The offer path registers an **`OfferListingChildEnqueuer`** wrapping `OfferCreationEnqueueService` + the **V2-payload rebuild** (snapshot + batch AI flags). This is what keeps submit *and* retry neutral — both enqueue/re-enqueue through this seam, not `OfferCreation*` directly. `OfferCreationRecord` stays offer-specific. [fork B — confirmed]
4. **Migrate the offer path**: `BulkListingSubmitService` does batch-create + variant expansion + per-child `enqueueChild` via the seam; `BulkListingRetryService` resets + `reEnqueueChild` via the seam; `BulkListingProgressService` advances by `childId`. The offer wrapper supplies the enqueuer + the offer child shape. **No behaviour change** — the existing int-specs are the oracle.
5. **Barrel + tokens** updated; old `BulkOfferCreation*` names removed (the "no offer-specific names in the extracted orchestration" AC). **HTTP contract unchanged** — the bulk submit/retry controller routes + request/response **DTO field names stay byte-identical** (only internal symbols rename); an int-spec asserts the wire shape.

---

## Phase 4 — Step-by-step (high level; refined after scope decision)

1. **Migration** (only if forks decide table/column changes): add `operation` column to `bulk_offer_creation_batches` (default `'offer.create'` for existing rows). Hand-authored, next timestamp.
2. Neutral domain: `BulkListingBatch` entity + `operation` + `BulkListingOperation` `as const`; neutral types/ports; `BatchChildRepositoryPort`.
3. Neutral services (rename + de-offer the 4 services); `OfferCreationRecordRepository implements BatchChildRepositoryPort`.
4. Offer path migration: offer submit/enqueue/execute compose the neutral primitives; worker handler updated to neutral progress service.
5. Barrel + `listings.tokens.ts` + `ListingsModule` rewiring.
6. Update all ~58 references + every test (rename-through); add a neutrality assertion (no `Offer` in the extracted orchestration files).
7. Quality gate: `pnpm lint && type-check && test`; **full `pnpm test:integration`** (the AC) + `migration:show`.

---

## Phase 5 — Validate / risks / OPEN QUESTIONS (need your decision before I implement)

- **Risk: large rename across ~58 files + barrel contract surface.** Mitigated by "no behaviour change" + the existing test suite as the oracle (rename-through, run int-specs).
- **Fork A — DB tables:** **keep physical table names** (recommended, zero migration risk) vs. rename them to neutral (`listing_orchestration_batches` …) which needs a careful rename migration on a hot table. Recommendation: keep names, neutralize only code symbols + add `operation`.
- **Fork B — child record:** keep `OfferCreationRecord` offer-specific behind a neutral `BatchChildRepositoryPort` (recommended) vs. fully neutralize the child entity now (bigger, and the shop child shape isn't defined until #1042).
- **Fork C — scope size:** full extraction now (this plan) vs. the issue's stated **fallback** ("parallel copy if extraction proves riskier than duplication") — i.e. land a minimal `operation` discriminator + defer aggressive renames. Given the subsystem is already behaviourally neutral, full extraction is feasible but touches many files in one PR.

> This is a genuinely large refactor. I want your call on **A/B/C** before writing code — especially C (full neutralization in one PR vs. a smaller first slice), since it sets the PR size and risk.
