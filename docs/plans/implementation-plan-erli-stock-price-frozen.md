# Implementation Plan — Erli stock & price sync + frozen-field ownership (#988)

Branch: `988-erli-stock-price-frozen` (at #985 tip). Plugin-only change; no CORE change, no
factory-signature change. Types come from the `@openlinker/core/listings` barrel; the frozen
wire shape is isolated in `erli-product.types.ts` (provisional, #992).

## Scope (locked)

| Sub-deliverable | Status | Action |
|---|---|---|
| 1. Stock push (master inventory → offer quantity) | already works | Confirm + note; add unit test if gap. |
| 2. Price-at-listing | already works (#984 `buildCreateBody`) | Confirm; **master-price propagation out of scope** (no core trigger exists). |
| 3. Frozen-field exclusion before field-update PATCH | **THE deliverable** | Implement `fetchErliProduct` + frozen filtering in `updateOfferFields`. |
| 4. Stock-restore-on-cancel | **DEFERRED / BLOCKED** | Document; needs #993 order ingestion. No dead code. |

## 1. Stock push — verified, nothing to build

Confirmed against real code:
- Core `InventorySyncService.updateOfferQuantity` (`libs/core/src/inventory/application/services/inventory-sync.service.ts`)
  resolves the `OfferManager` adapter per connection and calls `marketplace.updateOfferQuantity(item)`.
- #984's `ErliOfferManagerAdapter.updateOfferQuantity` implements that port: `PATCH products/{id} { stock }`.

The propagation chain (master inventory → core sync → port → Erli PATCH) is complete and
already covered by the existing `updateOfferQuantity` spec cases. **No new code or test** — adding
another would duplicate existing coverage.

## 2. Price — listing done, propagation out of scope

- `buildCreateBody` already maps `cmd.price` → `body.price` (verified). Price-at-listing ships.
- There is **no master-price → offer propagation path in core today**. Grep confirms the only
  `updateOfferFields` caller is `IntegrationsContentPublisherService` (description-only). Building a
  master-price trigger would be a new CORE orchestrator — out of scope and explicitly excluded.
  Documented here; no code.

## 3. Frozen-field exclusion (the deliverable)

ADR-025 §4b: "before any PATCH, fields marked `frozen` by seller-panel edits are excluded so OL
never overwrites a manual edit … per-nested-field granularity."

### 3a. Read type + wire shape (provisional #992) — `erli-product.types.ts`

Add a read-side `ErliProductResource` type with a **per-field frozen marker**. Erli's exact shape is
unconfirmed (#992 sandbox), so model the most plausible: a top-level `frozenFields: string[]`
listing the names of frozen fields (e.g. `["price","name","description","stock"]`). This is the single
reconciliation point; #989 (status) will reuse the same `fetchErliProduct` read path. Clearly marked
PROVISIONAL.

A small canonical mapping of OL patch-body keys → Erli frozen-field names lives in the adapter
(`price`, `name`, `description`, `stock`). Per-nested-field granularity = we evaluate each patch key
independently against the frozen set.

### 3b. Shared read helper — `fetchErliProduct(externalId)`

Private adapter method:
```
private async fetchErliProduct(externalId: string): Promise<ErliProductResource> {
  const res = await this.httpClient.get<ErliProductResource>(this.productPath(externalId));
  return res.data;
}
```
Reuses the existing `productPath` (validate+encode) and `IErliHttpClient.get`. #989 reuses it for
status (locked by the meta-plan).

### 3c. `updateOfferFields` — drop frozen fields before PATCH

1. Build the sparse patch from supplied fields (existing `buildPatchFromFields`).
2. `fetchErliProduct(externalOfferId)` → read `frozenFields`.
3. For each patch key, if its Erli frozen-name is in the frozen set, delete it from the body and
   `logger.debug(...)` (no PII).
4. If the body is now empty → skip the PATCH entirely (no-op; nothing to write).
5. Otherwise PATCH the surviving keys.

The GET is acceptable here: field-updates are low-frequency (operator/content edits), exactly where
seller manual edits collide.

### 3d. Quantity-path decision (justified)

`updateOfferQuantity` is the **high-frequency inventory-sync** path. Applying frozen-exclusion there
means a GET per quantity update — doubling API calls + latency on the hottest path. **Decision: do
NOT pre-fetch on the quantity path in this wave.** Rationale:
- Stock is the one field Erli **auto-mutates** (decrement on sale); a seller freezing *stock* is far
  rarer than freezing price/title/description, and the cost (2× calls on every inventory tick) is
  paid on every product on every sync.
- The reconciliation-first posture (ADR-025 §1, #989) is the correct long-term guard for stock
  drift, not a per-PATCH GET.
This keeps inventory sync single-call. If a frozen-stock requirement materializes, it becomes an
opt-in flag in a later wave — noted, not built (YAGNI).

## 4. Stock-restore-on-cancel — DEFERRED (blocked on #993)

ADR-025 §4a wants a pure-plugin compensation: on order cancellation, OL issues a stock-restore PATCH
(Erli won't restore). That trigger is the Erli order-cancel signal, which only exists once Erli order
ingestion (OrderSource / inbox poll = #993) lands. There is **no cancel signal to hook today**, so we
build **no trigger and no dead code** (YAGNI). When #993 ships, its ingestion observes the
`cancelled` event and calls the **already-existing** `updateOfferQuantity` to restore stock — #993
only needs to wire the trigger. Documented in the adapter docblock + this plan.

## Files changed

- `libs/integrations/erli/src/infrastructure/adapters/erli-product.types.ts` — add `ErliProductResource` read type + `frozenFields` (provisional).
- `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts` — `fetchErliProduct`, frozen-filter in `updateOfferFields`, docblock update (scope: §4 deferred, quantity-path decision).
- `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-offer-manager.adapter.spec.ts` — frozen-exclusion tests.

## Tests (frozen-exclusion)

- frozen field dropped (frozen `price` → not in PATCH; non-frozen `title` survives).
- non-frozen field patched (no frozen markers → full PATCH, GET shape asserted).
- all-supplied-frozen → no PATCH issued (no-op).
- the GET read shape (`fetchErliProduct` issues `GET products/{id}`).
- quantity path issues NO GET (single PATCH only) — guards the §3d decision.

## Quality gate

`pnpm --filter "@openlinker/integrations-erli^..." build` then
`pnpm --filter @openlinker/integrations-erli` type-check + lint + test.
