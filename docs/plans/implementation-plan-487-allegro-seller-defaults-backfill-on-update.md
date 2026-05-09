# Implementation Plan — #487 Allegro: auto-backfill `sellerDefaults` on partial offer-update PATCH

## 1. Understand the task

**Goal**: When `AllegroOfferManagerAdapter.updateOfferFields` builds the `PATCH /sale/product-offers/{id}` body, opportunistically merge connection-level `sellerDefaults` into fields the caller did not supply, so a description-only update does not 422 because the offer happens to be missing GPSR `responsibleProducer` / `safetyInformation` / `location`.

**Layer**: Integration / Allegro adapter (Infrastructure). Single-file behavioural change. No CORE port-contract change. No FE change.

**Explicit non-goals**:
- **No** `UpdateOfferFieldsCommand.skipSellerDefaultsBackfill` flag — issue #487 says "no flag needed today; the only consumer is the content publisher". Add only when a consumer requires it.
- **No** changes to `createOffer` preflight (`collectMissingSellerDefaultsFields`) — that path still rejects fast on incomplete defaults; backfill is an *update-only* convenience.
- **No** auto-creation of policies on Allegro's side. Operators still configure upstream.
- **No** retry-on-422 with backfill. If Allegro rejects on a field we can't backfill, surface via #486 (already merged) — don't paper over with a second PATCH.
- **No** after-sales policy backfill in this PR. After-sales policy IDs (`returnPolicyId`, `warrantyId`, `impliedWarrantyId`) currently flow through the create-wizard's `cmd.overrides.platformParams`, not `Connection.config.allegro.sellerDefaults`. The backfill helper is structured so adding them later is a one-field extension on `AllegroSellerDefaultsConfig` plus one branch in the helper; documented inline. The acceptance criterion for after-sales is satisfied vacuously today (condition "sellerDefaults has policy ids configured" is never true) and becomes live once that storage lands.

## 2. Research / existing patterns

| Concern | Finding | Reuse |
|---|---|---|
| Where defaults live | `AllegroSellerDefaultsConfig` at `libs/integrations/allegro/src/domain/types/allegro-seller-defaults.types.ts` carries `location`, `responsibleProducerId`, `safetyInformation`. | Helper consumes this exact shape. |
| Adapter holds the value | Constructor param `private readonly sellerDefaults: AllegroSellerDefaultsConfig \| undefined`. | Read directly in helper. |
| Existing create-time wiring | `applyPlatformParams` writes `body.productSet = [{ product, responsibleProducer: { id }, safetyInformation }]` and `buildCreateOfferRequest` writes `body.location` from defaults. (`allegro-offer-manager.adapter.ts:1268,1402-1410`) | Mirror the same shape on the PATCH body. |
| Existing `updateOfferFields` | Builds `AllegroOfferFieldsPatchBody` with only `name` / `sellingMode` / `description`. Skips HTTP when body is empty. (`adapter.ts:870-934`) | Insert backfill *before* the "skip when empty" check so the merged body is what gets the empty test, not just the caller fields. |
| PATCH body type | `AllegroOfferFieldsPatchBody` (`allegro-api.types.ts:453-469`) only declares `name`, `sellingMode`, `description`. Indexed signature `extends Record<string, unknown>` allows extra keys, but adding typed fields lets the helper return a typed slice. | Extend the type with optional `location`, `productSet`, `afterSalesServices`. |
| Existing per-field missing-check | `collectMissingSellerDefaultsFields` already enumerates the "is this complete?" rules. | Helper does *not* call this — backfill writes whichever fields are present (partial config still helps); the create-time preflight remains the all-or-nothing gate. |
| Logger conventions | `engineering-standards.md §Logging` — operational detail uses `debug()`, not `log()`. | Backfill emits a single `debug` line listing merged fields when at least one was added. |
| Existing test fixture | `DEFAULT_SELLER_DEFAULTS` already provided at top of spec; existing `updateOfferFields` tests run with defaults configured. | Update existing assertions only where they would conflict; add the four new specs covering the backfill matrix. |

## 3. Design

### Helper: `buildSellerDefaultsPatch`

Private method on `AllegroOfferManagerAdapter`. Returns the slice of `AllegroOfferFieldsPatchBody` that the connection's `sellerDefaults` is willing to provide. Returns `{ patch: {}, fields: [] }` when `this.sellerDefaults` is `undefined`. Each subfield is independently gated:

```ts
private buildSellerDefaultsPatch(): {
  patch: Pick<AllegroOfferFieldsPatchBody, 'location' | 'productSet'>;
  fields: string[];
}
```

- `defaults.location` set → `patch.location = { ...defaults.location }`, push `'location'`.
- `defaults.responsibleProducerId` set → push entry under `productSet[0].responsibleProducer`, push `'productSet[0].responsibleProducer'`.
- `defaults.safetyInformation` set → push entry under `productSet[0].safetyInformation`, push `'productSet[0].safetyInformation'`.
- `productSet[0]` is built once across the two GPSR keys so we don't emit two array entries.

GPSR fields sit at `productSet[0].responsibleProducer` and `productSet[0].safetyInformation` — entry-level siblings — to mirror the create path (`applyPlatformParams` at `allegro-offer-manager.adapter.ts:1402-1410`). The issue text's `productSet[0].product.…` path is editorial; the wire shape used by the working create POST is the source of truth.

After-sales backfill is **deferred** — comment in the helper notes the slot and references this issue.

### Merge in `updateOfferFields`

```ts
const callerBody = /* … existing build … */;
const { patch: defaultsPatch, fields: backfilled } = this.buildSellerDefaultsPatch();
const body = { ...defaultsPatch, ...callerBody };
```

- Plain spread is enough: defaults' top-level keys (`location`, `productSet`) don't overlap with today's caller keys (`name`, `sellingMode`, `description`), and on any future overlap the caller-side spread wins by JS semantics. No `stripFieldsCallerProvided` helper.
- `backfilled.length > 0` → emit one `debug` line matching the existing peer log format (`adapter.ts:891-895`): ``Allegro updateOfferFields backfilled from sellerDefaults: offerId=… connection=… fields=[…]`` — offerId first, `connection=` second, fields list last.

### Empty-body guard

The existing guard fires when the caller passes an empty `fields` object. Two options:
- **A**: Run the guard *before* backfill — preserves today's "empty fields → no HTTP call" semantics. Description-only update still merges defaults because at least one caller field is present.
- **B**: Run the guard *after* backfill — `updateOfferFields({ fields: {} })` with defaults configured would emit a "republish-with-defaults" PATCH. That changes today's contract and risks an unintended write.

**Pick A**. The empty-fields case is the existing "no-op" call site; backfill is opportunistic on existing partial updates, not a fresh "republish" surface.

### Type extensions

`AllegroOfferFieldsPatchBody` gains:

```ts
location?: AllegroProductOfferCreateRequest['location'];
productSet?: AllegroProductSetEntry[];
afterSalesServices?: AllegroProductOfferCreateRequest['afterSalesServices'];
```

Reusing the existing types keeps the shape identical to the create path, which is what Allegro accepts.

### Risks / open questions

- **PATCH shape for `productSet[0]`**: the create path writes `productSet[0].product = { name, parameters? }` *plus* the GPSR siblings. On PATCH we ship only the GPSR siblings (no `product.name`) — matches Allegro's "merge with current offer" semantics on `productSet[]`. If sandbox testing reveals Allegro requires `product.name` even on partial update, fall back to populating `product.name` from a fresh `GET /sale/product-offers/{id}` (or the connection's stored product name). PR description will flag the live-test step explicitly.
- **`safetyInformation: { type: 'NO_SAFETY_INFORMATION' }`**: the discriminated union allows this variant. Backfilling it is correct — operators who set "no safety info" want that to keep applying to future updates.
- **Caller-already-supplied `productSet`**: today `UpdateOfferFieldsCommand.fields` doesn't expose `productSet`, so we can't reach this. Helper still strips overlapping keys defensively.

## 4. Step-by-step plan

| # | File | Change | AC |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | Extend `AllegroOfferFieldsPatchBody` with optional `location`, `productSet`, `afterSalesServices` (reusing `AllegroProductOfferCreateRequest` field types and `AllegroProductSetEntry`). JSDoc on the new fields notes "populated by `buildSellerDefaultsPatch` on PATCH only — never set by callers via `UpdateOfferFieldsCommand`" so readers don't conclude the public command shape grew. | `pnpm type-check` clean; field types match the create-path shape. |
| 2 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | Add private `buildSellerDefaultsPatch()` returning `{ patch, fields }`. Inline JSDoc references #487 and the after-sales deferral. | Returns `{ patch: {}, fields: [] }` when `sellerDefaults` is `undefined`; otherwise emits `location` / `productSet[0]` slice. |
| 3 | Same file | In `updateOfferFields`: build caller body, run `buildSellerDefaultsPatch`, strip overlap, merge with caller-wins, emit one `debug` log when at least one field was backfilled. Empty-fields guard runs *before* backfill (no behaviour change for that path). | Description-only update with default fixture sends `description`, `productSet[0]`, `location`. No-defaults adapter sends today's body exactly. |
| 4 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Add `describe('updateOfferFields → sellerDefaults backfill (#487)')` with: (a) defaults present + description-only → `productSet[0]` + `location` merged; (b) no defaults adapter → body matches today's shape (regression guard for connections without `sellerDefaults`); (c) caller's documented fields (`name` / `description` / `sellingMode`) survive the merge unchanged when defaults are present — sanity check that backfill doesn't clobber caller values via the actual contract surface; (d) debug log lists exactly the backfilled fields; (e) empty fields → no HTTP and no backfill. Update existing `updateOfferFields` cases that assert `not.toHaveProperty(...)` only if they actually conflict (review pass). | All five new specs pass; existing specs unmodified except where unavoidable. |
| 5 | Quality gate | `pnpm lint && pnpm type-check && pnpm test`. | Zero errors / failures. |
| 6 | Self-review | Re-read against `docs/code-review-guide.md`: hexagonal boundaries (Integration only — yes), naming conventions, no `any`, no `console.log`, debug log uses `Logger`, no port-contract drift, no test-DB mocks (unit tests, no DB involved). | No BLOCKING / IMPORTANT findings outstanding. |
| 7 | Commit + PR | Conventional commit `fix(allegro): backfill sellerDefaults on offer-field updates`. PR body explicitly notes the after-sales deferral and the sandbox-verification AC closer. | PR opened against `main` with `Closes #487` in body. |

## 5. Validation against project standards

- **Hexagonal**: change is fully in `libs/integrations/allegro/src/infrastructure/adapters/`. No CORE port touched. No reverse import added. ✅
- **Naming**: helper is private on the adapter, no new file or token. ✅
- **Types**: extended `AllegroOfferFieldsPatchBody` in the existing `*.types.ts`; no inline-in-implementation type. ✅
- **Logging**: single `debug` line; uses `Logger` from `@openlinker/shared/logging`. ✅
- **Testing**: unit-only, mocking `IAllegroHttpClient`. No integration test required (no DB / no Testcontainers). ✅
- **Security**: no new external input parsed; no secret handling. ✅
- **Backwards compat**: connections without `sellerDefaults` send today's body byte-for-byte (asserted in spec). ✅

## 6. Acceptance criteria mapping (issue #487)

| AC | Met by |
|---|---|
| `updateOfferFields` includes `afterSalesServices` when caller didn't and defaults has it | Helper has the slot; condition currently false for all connections (storage doesn't exist yet). Documented in PR body as deferred. |
| `updateOfferFields` includes `productSet[0].responsibleProducer` when caller didn't and `responsibleProducerId` is set | Step 2 + 3 |
| `updateOfferFields` includes `productSet[0].safetyInformation` when caller didn't and `safetyInformation` is configured | Step 2 + 3 |
| Caller-supplied fields win on overlap | Step 3 (`{ ...defaults, ...caller }` ordering) |
| No `sellerDefaults` → today's PATCH body shape | Step 3 (helper returns `{}`) + Step 4 spec (b) |
| Each backfill emits a structured debug log naming fields | Step 3 |
| Operator description-only publish on offer missing required fields succeeds end-to-end | Sandbox-verification step in the PR description (cannot run from this env) |
| Adapter unit tests cover the four cases | Step 4 |
| No backend port-contract changes unless a consumer needs the opt-out | Confirmed — no `UpdateOfferFieldsCommand` change |
| Existing `assertSellerDefaultsConfigured` preflight on offer-create unchanged | Confirmed — `createOffer` path untouched |
