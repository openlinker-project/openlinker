# Implementation Plan - Erli buyable problems: read the reason, route it to the right surface (#2231)

## 1. Understand the task

Erli answers `GET /products/{externalId}` with `buyableProblems` - an 18-value enum naming exactly why
an offer cannot be bought - and `archived`. OpenLinker reads neither. `mapErliStatusToReadResult` reads
`product.status` only, so `OfferStatusReadResult.validationErrors` is always `[]` for Erli, so
`resolveOfferLifecycle` routes every blocked Erli offer to `Draft` and the `Invalid` bucket can never
contain one. The frontend already has the slots (`listingRowAlert`, `OfferPublicationStatusPanel`) and
renders nothing.

Three defects, one cause:

1. **Dropped at the adapter** - `buyableProblems` / `archived` have no reference anywhere in
   `libs/integrations/erli`.
2. **Dead branches and a field that does not exist** - `ErliProductStatus` declares
   `'accepted' | 'active' | 'inactive' | 'rejected'`, but Erli's schema declares
   `status: enum ["active","inactive"], nullable`. `statusReason` is not a property of `ProductResponse`
   at all, and it is the only thing the (unreachable) `rejected` branch put into `validationErrors`.
3. **Nothing to render** - the FE slots receive an empty message list.

**Layers**: Integration (adapter) + CORE (neutral problem vocabulary, persistence of it, read
projections) + Frontend (row line, panel, connection banner).

**Non-goals**
- No change to `resolveOfferLifecycle` (verified: populating `validationErrors` moves the row into
  `Invalid` through the rule that already exists).
- No new HTTP endpoint. The connection-level banner is derived from the list read the page already makes.
- No migration: `offer_status_snapshots.statusDetails` is `jsonb`, so the structured detail is additive.
- No Allegro-side behaviour change beyond the shared muted-row rule (stated below).
- Enabling Erli's status-sync scheduler task is sibling issue #2230, not this change.

## 2. Research - what already exists and is reused

| Existing seam | Reused how |
|---|---|
| `CreateOfferValidationError { field?, code, message }` | The neutral error the adapter already emits; gains two optional fields |
| `OfferStatusSnapshotDetails.validationMessages?: string[]` | Kept and still written - it is what `HAS_VALIDATION_MESSAGES_SQL` and `readValidationMessages` read, so the lifecycle rule and the tab counts are untouched |
| `readValidationMessages` (runtime-guarded jsonb read) | Pattern copied for `readValidationProblems` |
| `OfferMappingChannelStatus` / `OfferPublicationStatusView` | Both gain the structured list beside the existing messages |
| `shared/ui/alert` (`Alert`, tone `error`) | The connection-level banner - matches the underlay's `.notice` treatment, so no new CSS |
| `.listing-cell__reason` | The row's one attention line; gains a `--muted` modifier |
| `applyPricingRule` / `applyStockSafetyBuffer` / `resolveOfferLifecycle` | Precedent for a pure, unit-testable helper living beside the domain types |

## 3. Design

### 3.1 The seam: an adapter-declared scope, not a core-held platform list

Three of Erli's reasons (`shop-activity`, `shopKyc`, `blocked`) describe the **shop**, not the product.
When one is live it appears on every offer, so per-row rendering stamps the same sentence on every row
and buries the one actionable fact.

Core cannot learn that split from a hardcoded list of Erli strings - that would put marketplace
vocabulary in `libs/core`. So the **adapter declares the scope** on the neutral error, and core splits
on the neutral field:

```ts
// libs/core/src/listings/domain/types/offer-validation-problem.types.ts
export const OfferValidationScopeValues = ['offer', 'account'] as const;
export type OfferValidationScope = (typeof OfferValidationScopeValues)[number];

export interface OfferValidationProblem {
  code: string;                    // the platform's own value, verbatim
  summary?: string;                // one short line, for a single-line row
  message: string;                 // the operator-facing sentence
  scope: OfferValidationScope;     // 'account' => the seller account, not this offer
}
```

`CreateOfferValidationError` gains `summary?: string` and `scope?: OfferValidationScope` (both optional,
so every existing adapter compiles and behaves unchanged; an omitted scope normalises to `'offer'`).

Pure helpers in the same file, beside `offer-lifecycle.types.ts`:
- `toOfferValidationProblem(error)` - normalise an adapter error (defaults `scope: 'offer'`).
- `readValidationProblems(statusDetails)` - runtime-guarded read off the unconstrained `jsonb`, mirroring
  `readValidationMessages` element-by-element (a malformed blob yields `[]`, never a half-typed object).
- `splitOfferValidationProblems(problems)` - `{ offerProblems, accountProblems }`.

### 3.2 Persistence

`OfferStatusSnapshotDetails` gains `validationProblems?: OfferValidationProblem[]`.
`OfferStatusSyncService.toStatusDetails` writes **both** keys off the same input:
`validationMessages` (unchanged shape, unchanged readers) and `validationProblems`. `OfferStatusObservation`
gains an optional `validationProblems`, and `refreshOne` threads the adapter's errors through it - without
that the manual "Refresh" action would silently downgrade a snapshot to messages-only.

### 3.3 Read projections

- `OfferMappingChannelStatus.validationProblems: readonly OfferValidationProblem[]` (list read, backs row + banner).
- `OfferPublicationStatusView.validationProblems: OfferValidationProblem[]` (per-product read, backs the panel).
- Both DTOs mapped field by field, as the controller already does.

### 3.4 Adapter

- `ErliProductStatus` narrows to `'active' | 'inactive'`; `statusReason` is deleted; the `accepted` and
  `rejected` branches go. The `default:` arm stays - `status` is `nullable`.
- `ErliProductResource` gains `buyableProblems?: string[]` and `archived?: boolean`.
- `ErliBuyableProblemValues` (the 18 values, verbatim from the swagger) + `ErliBuyableProblem` union.
- `erli-buyable-problem.mapper.ts` owns the copy map: per code a `summary` (row line), `message`
  (panel sentence), `scope`, and a `priority` used to order the emitted list so the row's first line is
  the most consequential problem. An unrecognised code is emitted with the raw value visible, never dropped.
  A spec asserts every enum value has an entry, so a future Erli addition fails the build.
- `archived: true` -> `publicationStatus: 'ended'` (an archived Erli product cannot be bought and vanishes
  from the seller panel - and `ended` is the only bucket `countByConnectionAndVariants` treats as re-listable).
- `status: 'active'` keeps `publicationStatus: 'active'` even when problems are present: `publicationStatus`
  reports what Erli says about publication, and inventing `inactive` would put words in the marketplace's
  mouth. The problems still ride along, so the row still carries its reason line.

### 3.5 Frontend

- **Row** (`listingRowAlert`): offer-scoped problems only. First problem's `summary` (falling back to its
  `message`) plus `· +N more problem(s)`; `title` carries the full list. One line - `.listing-cell__reason`
  is single-line by design.
- **Row, muted**: `inactive` with no offer-scoped problems renders muted copy instead of the red line, so
  the red line always means work. Two cases: no problems at all, and offer-scoped-empty but shop-blocked
  (points at the banner). New `.listing-cell__reason--muted` modifier.
- **Panel**: every problem under the offer row - sentence for the seller, mono `code` for whoever checks
  it against the platform's docs.
- **Banner**: derived from the rows already on the page (`listing-connection-notices.ts`, pure) - one
  `Alert` per affected connection, naming the connection and how many of the listings shown it affects.
  Shop-level problems are then excluded from row rendering entirely.

Wording is platform-neutral in the frontend ("the channel", not "Erli"); the platform-specific sentences
come from the adapter's copy map, over the wire.

## 4. Steps

1. `libs/core/src/listings/domain/types/offer-validation-problem.types.ts` - new: scope union, problem
   shape, three pure helpers. Export from the listings barrel.
2. `offer-create.types.ts` - `CreateOfferValidationError` gains `summary?` / `scope?`.
3. `offer-status-snapshot.types.ts` - details blob gains `validationProblems?`.
4. `offer-status-sync.service.{interface.,}ts` - persist both keys; thread problems through `refreshOne`.
5. `offer-mapping.types.ts` + `offer-mapping.repository.ts` - list projection carries the problems.
6. `offer-status-read.types.ts` + `offer-status-read.service.ts` - per-product view carries them.
7. `apps/api/.../dto/offer-mapping-response.dto.ts`, `offer-publication-status-response.dto.ts`,
   `listings.controller.ts` - wire shapes.
8. `libs/integrations/erli/.../erli-product.types.ts` - narrow status, drop `statusReason`, add
   `buyableProblems` / `archived` / the enum union.
9. `libs/integrations/erli/.../erli-buyable-problem.mapper.ts` - new: copy map + mapping + ordering.
10. `erli-offer-manager.adapter.ts` - `mapErliStatusToReadResult` rewritten around the mapper.
11. `apps/web/src/features/listings/api/listings.types.ts` - FE types.
12. `apps/web/src/features/listings/lib/listing-row-state.ts` - row line + muted variant.
13. `apps/web/src/features/listings/lib/listing-connection-notices.ts` - new: pure banner derivation.
14. `apps/web/src/features/listings/components/offer-publication-status-panel.tsx` - problem list.
15. `apps/web/src/pages/listings/listings-list-page.tsx` - render the banner above the table; muted line.
16. `apps/web/src/index.css` - `.listing-cell__reason--muted`, panel problem-line styles.
17. Docs: `docs/architecture-overview.md` § Listings (surgical - only the sentences this makes false) and
    the `Draft` docblock in `offer-lifecycle.types.ts` (one clause).
18. Specs: adapter mapper (full enum coverage, unknown code, archived, ordering), core helpers (split,
    guarded read), FE row-state and notice derivation.

## 5. Validation

- **Architecture**: no Erli value reaches `libs/core` - the only new core vocabulary is `'offer' | 'account'`,
  declared by whichever adapter knows its own taxonomy. `check:invariants` cross-context rules untouched.
- **Naming**: `*.types.ts` for types, `*.mapper.ts` for the copy map, `*.spec.ts` / `*.test.tsx` for tests.
- **No migration**: `statusDetails` is `jsonb`; the new key is additive and every reader is guarded.
- **Backwards compatibility**: `validationMessages` keeps being written first, so the lifecycle rule, the
  SQL tab counts and every existing consumer behave identically on a snapshot written by this build.
- **Risk**: a snapshot written before this change carries no `validationProblems`. The row falls back to
  `validationMessages` so it degrades to today's behaviour rather than going blank.
