# Implementation plan — #2240 bulk offer wizard: product-level category, honest blocker copy, seller-details preflight

## Goal

A multi-variant product whose barcodes miss the destination catalogue must be listable without
per-variant archaeology, and every blocker must name its cause, its consequence and an action that
works. Frontend only (`apps/web`); no API, core or adapter change.

## Non-goals

- A distinct `lookup-failed` resolve outcome (backend; separate issue). Until it exists a failed
  request keeps arriving as `no-match`, so the copy for that id must not claim the catalogue was read.
- A cache-bypassing "check barcode again" (backend; a successful empty result is cached 24 h, so an
  FE-only re-check would be a no-op).
- Live chip clearing while typing in the editor. Variant edits are modal-local state committed on
  save; chips settle on save.
- Making Allegro seller-detail fields required at connection-save time. Changing save-time validation
  for existing connections is a separate behavioural decision; this PR adds the pre-submit warning,
  which is the part that prevents the wasted batch.

## Steps

### 1. `bulk-blockers.ts` — vocabulary
- Relabel `no-ean` → `no barcode`, `no-match` → `no catalog match`, `multi-match` → `multiple matches`.
- Add `invalid-barcode` (a supplied barcode failing its check digit — today folded into `no-ean`).
- Add `unknown-category-result` for the exhaustive branch in step 3.
- Add `CATEGORY_EFFECT_CHIP` (`category not set`) — rendered only in the editor, alongside the cause.
  It is deliberately NOT a blocker id: one id per cause keeps the descriptor map 1:1 and keeps the
  effect claim out of the Review table, where a row already carries up to four chips.
- `isVariantScopeFixable` gains `invalid-barcode` (the barcode field is in the variant panel).
- New `isCategoryBlocker(id)` so call sites route the CTA without re-listing ids.

### 2. `bulk-blocker-copy.ts` (new) — one copy source
`describeBlocker(blocker, ctx)` → `{ title, detail, effect? }`, where `ctx` carries the barcode, the
destination display name, the variant count and whether the destination resolves the category at
submit. Descriptors stay in `bulk-blockers.ts`; sentences live here so the Review table (tooltip) and
the editor (banner) cannot drift.

### 3. `bulk-policy.ts` — the readiness chain
- `ComputeBlockersInput.productCategoryId?: string | null`; `hasCategoryOverride` consults it.
- `recomputeVariantBlockers`: submit category becomes
  `variant.override → row.override → variant.resolved → row.resolved`, the order the submit's family
  pin already uses. This is the defect: readiness read the variant tier only.
- Invalid-GTIN pushes `invalid-barcode`, not `no-ean`. Ungated by destination: an invalid barcode is
  invalid everywhere. Only the `category not set` effect is gated on
  `!destinationResolvesCategoryAtSubmit`.
- Final `else` on the outcome chain → `unknown-category-result`. Today unreachable; it is what makes
  shipping a new backend outcome safe.

### 4. `bulk-resolve-step.tsx`
Pass `productCategoryId`; emit `invalid-barcode`.

### 5. `bulk-wizard.tsx`
- `noCardCategoryIds` uses the same widened chain, so a product-tier category fetches its
  required-parameter schema (otherwise `missing parameters` can never fire and the create 422s).
- Compute batch issues from the plugin (step 7) and thread them to Review.
- Pass blocked + already-listed counts to the confirm modal.

### 6. `bulk-edit-modal.tsx`
- Variant panel: the category block moves out of the `Override base title / description / category`
  disclosure into an always-visible block, showing provenance (own / inherited / from the card).
- Banner: `describeBlocker` copy; for a category blocker the primary action is **Set category for all
  N variants** (base scope + picker), the secondary is **Only this variant** (existing split warning).
  `Fix on base` no longer appears for a category blocker.
- Head category bar reads `Set category` when unset.

### 7. Seller-details preflight
- `plugin.types.ts`: `OfferBatchValidationInput { connectionConfig }`, `OfferBatchIssue { id, title,
  detail }`, optional `validateBatch` on `OfferValidationContribution`.
- `allegro-offer-validation.ts`: read `config.sellerDefaults` (`location`, `responsibleProducerId`,
  `safetyInformation`) and report one issue naming what is missing.
- `bulk-review-step.tsx`: render the issues as one batch-level Alert. Never a per-row chip — it is a
  connection-level fact a row cannot observe.

### 8. `bulk-confirm-modal.tsx`
`blockedCount` + `alreadyListedCount`, distinguished in the copy, and correct singular at 1.

## Tests
- `bulk-policy.test.ts`: product-tier fallback clears the blocker; unknown outcome blocks; invalid
  barcode emits `invalid-barcode`.
- `allegro-offer-validation.test.ts`: `validateBatch` for empty / partial / complete seller defaults.
- `bulk-confirm-modal.test.tsx`: counts + plural.
- `bulk-edit-modal.test.tsx`: category block is visible without expanding the disclosure.

## Risks
- The chip relabelling touches strings asserted in existing specs — update them in the same commit.
- `bulk-edit-modal.tsx` is ~3.5k lines; the category move must not disturb the shop branch, which
  shares the shell.
