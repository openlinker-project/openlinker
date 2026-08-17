# Implementation Plan — #2068 PrestaShop order line id

**Issue:** #2068 (#2070 closed as its duplicate)
**Branch:** `2068-prestashop-order-line-id`
**Layer:** Integration → Infrastructure (mapper). No migration, no contract change.

---

## 1. The task

`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:53`:

```ts
const items: OrderItem[] = orderRows.map((row, index) => {
  return {
    id: String(row.id || index),
```

Three defects in one expression:

1. **Array-index fallback** — the id becomes the row's *position*, so it changes if PrestaShop
   returns a different order or count on a later poll.
2. **`||` where `??` is meant** — a legitimate `row.id === 0` is falsy and falls through to the index.
3. **Collision** — an index-derived id (`"0"`, `"1"`, …) can equal a genuine `row.id` within the same
   order, producing two lines with the same `id`.

Every other order source passes a stable platform id (Allegro `lineItem.id`, Erli `String(item.id)`,
WooCommerce `String(item.id)`).

### This is already a live bug, not a latent one

The issue says `OrderItem.id` "feeds only an error message". That is wrong. It is also:

- **rendered to the operator** — `order-line-items-panel.tsx:48` prints it as the line's identifier;
- **a React key** — `order-line-items-panel.tsx:94` (`rowKey`) and `order-row-detail.tsx:187` (`key`).
  Two lines sharing an id in the same order is a duplicate-key collision **today**;
- **persisted** — `order-record.service.ts:64` writes it into the `orderSnapshot` jsonb;
- **sent outbound** — `order-sync.service.ts:81` forwards it to destination adapters in `OrderCreate`.

So the fix is worth making on its own merits, independent of #1032 / #2076.

### Non-goals

- Changing `OrderItem.id`'s meaning, or any consumer of it.
- Touching any other adapter.
- The deferred `InvoiceLine` line reference (#2076) — it *depends* on this, but is not this.

---

## 2. The issue's open question, answered

> Can `order_detail.id` actually be absent or `0` in a PrestaShop webservice response? If it is
> always present and non-zero, the fallback is dead code and the honest fix is to drop it and fail
> loudly.

**Not for a well-formed response — but "well-formed" is a convention here, not an invariant.**

| Evidence | Strength |
|---|---|
| `display=full` is the query default (`prestashop-query.builder.ts:71-72`) and `fetchOrderRows` passes no `display` override (`prestashop-order-source.adapter.ts:392-395`), so full row bodies come back | **Load-bearing, but a call-site convention.** `PrestashopQueryFilters.display` is overridable and *is* overridden elsewhere — `prestashop-product-master.adapter.ts:265` uses `display: '[id]'`. Nothing stops a future edit to `fetchOrderRows` from doing the same. |
| The value is `ps_order_detail.id_order_detail`, an AUTO_INCREMENT PK | Strong — it is never `0` and never null in the table. |
| ~~`id` is declared required in `prestashop.mapper.interface.ts:113`~~ | **Not evidence.** That is a TypeScript declaration over an `unknown` wire payload reached through a bare `as T[]` cast in `normalizeCollection` (`prestashop-webservice.client.ts:703-760`). The compiler has verified nothing at runtime. |

There is also one code path that *contradicts* unreachability: `PrestashopResponseParser` explicitly expects ids to arrive as an XML **attribute** — `if ('id' in valueObj || '@_id' in valueObj)`
(`prestashop-response.parser.ts:193`). With `attributeNamePrefix: '@_'`, `<order_detail id="7"/>` parses to
`{ '@_id': 7 }` and `row.id` is `undefined`. Under `display=full` PrestaShop emits `<id>` as a child element,
so this shouldn't fire on this path — but the parser proves the shape exists in this API surface.

**Conclusion: the fallback is unreachable for a well-formed `display=full` response, but that is exactly why a
guard belongs here — it is what catches the regression if the convention ever changes.** The design below
reads `@_id` before giving up, so the one known contradicting shape is handled rather than rejected.

Every existing fixture supplies a non-empty `id`; no fixture uses `0` or `''`.

---

## 3. Design

**Drop the fallback. `??` for the `0` case. Read `@_id` as the one known alternate shape. Throw otherwise.**

```ts
// per row — `@_id` is the XML-attribute shape the response parser expects
const rawId = row.id ?? row['@_id'];
if (rawId === undefined || rawId === null || String(rawId).trim() === '') {
  throw new PrestashopParseException(
    `PrestaShop order_details row ${position} for order ${orderId} has no id`,
  );
}
id: String(rawId)
```

`PrestashopParseException` already exists (`domain/exceptions/prestashop-parse.exception.ts`) and
means exactly "the response is not the shape we contract for".

**`responseBody` is deliberately left `undefined`.** Its own docblock says it "carries the **full**
upstream body — it is intentionally unbounded", and this message propagates through
`SyncJobExecutionError` into `sync_jobs` storage and operator-visible error text. The message names the
order and the row position; it must not serialise the row, whose shape is `[key: string]: unknown`.
This is the first call site to pass message-only — every existing one is a JSON/XML decode failure in
`prestashop-response.parser.ts` that legitimately carries the body. The divergence is intentional: this
is a *schema* violation, not a *decode* failure.

### Why no synthetic id is acceptable — including the one the issue prefers

The issue's **first** preference is a content-derived `${product_id}:${product_attribute_id ?? '0'}`.
**Reject it: it is not collision-free.** `ps_order_detail` legitimately holds two rows with an identical
`(product_id, product_attribute_id)` in one order:

- **Customisation** — `id_customization` distinguishes rows; the same combination ordered with two
  different customisations is two rows. OL is not customisation-aware anywhere (`grep` finds no
  reference), so it cannot even see the distinguishing column.
- **Free-gift / promo lines** — a cart-rule gift for a product already in the cart adds a second row at price 0.
- **Warehouse splits** — advanced stock management splits one line across warehouses into separate rows.
- **Partial re-invoicing** — rows carry `id_order_invoice`; a split shipment yields distinct rows per invoice.

That reproduces the exact collision this issue exists to fix, by a different route.

The issue's **second** option, `String(row.id ?? \`idx:${index}\`)`, is unstable across polls by
construction and — per § 1 — would be **rendered to the operator** in the SKU column.

So every synthesis option is unsafe, which leaves failing loudly.

### The sharpest argument

`InvoiceService.applyCorrectionDeltas` (`invoice.service.ts:180-208`) keys correction deltas by 1-based
`originalLineNumber` — array position — today. #2076's deferred follow-up replaces that positional key
with `OrderItem.id`. **If that id is itself positional, the migration is a no-op that looks like a fix.**

### The risk, stated honestly

`mapOrder` is called **uncaught** at `prestashop-order-source.adapter.ts:175`, inside `getOrder`, which
`order-ingestion.service.ts:215` calls **before** `getOrCreateInternalId` (:218) and before any
`orderRecordService` write. So a throw means **no order record is created at all** — no row in the
orders list, no snapshot, nothing to inspect. Only a dead sync job.

That is strictly less recoverable than the codebase's own pattern for a related case: at
`order-ingestion.service.ts:325-340`, an unresolvable *item* calls `markItemResolutionFailure` to persist
the honest record state (`awaiting_mapping` / `source_deleted`) and only *then* throws.

**The asymmetry is accepted, on this argument:** that path handles a *data-resolution* failure — the
response was valid, OL just can't map a product. A row with no primary key is a *contract* failure: the
payload is not the shape the adapter contracts for, which is precisely what `PrestashopParseException`
already signals from the parser. There is no honest partial record to persist, because OL cannot trust
the payload it would build one from. Half-persisting an order whose lines have unknown identity is worse
than not persisting it.

**If a real PrestaShop deployment turns out to return id-less `order_details` rows, revisit this** — and
the failure will say so loudly rather than corrupting a line id quietly.

### Scope decision: the sibling index fallback stays

`prestashop-order-source.adapter.ts:202-209` synthesises `` `${externalOrderId}-item-${index}` `` for
`productRef.externalId`, and `:198` re-correlates `mapped.items[index] ↔ orderRows[index]` positionally.
Same shape, **deliberately out of scope**: `externalId` identifies a *product* for mapping resolution, not
a *line*, and its failure mode is a visible mapping miss (`awaiting_mapping`), not a silent wrong id. It
needs its own analysis of what an id-less row should resolve to. Noted here so it is not mistaken for an
oversight; the positional coupling gets a code comment, since this change must keep `mapOrder` strictly
1:1 and order-preserving for that correlation to stay sound.

---

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `prestashop-order.mapper.ts` | Replace `String(row.id \|\| index)` with the guarded `??` form; throw `PrestashopParseException` on an absent/empty id | `row.id === 0` → `"0"`; no index ever reaches an id |
| 2 | `prestashop-order.mapper.ts` | Drop the now-unused `index` parameter if nothing else uses it | No unused-parameter lint error |
| 3 | `__tests__/prestashop-order.mapper.spec.ts` | Four cases: `row.id === 0`; two rows never collide; same payload twice → identical ids; absent id throws | All four fail if the guard is removed |

---

## 5. Validation

- **Architecture:** infrastructure mapper only; the exception is a plugin-owned domain exception, not
  a core type — no CORE ↔ Integration boundary crossed.
- **Naming / standards:** existing file, existing exception class, no new type.
- **Security:** none — no user input, no secrets, no SQL.
- **Testing:** unit only, and **no existing spec newly throws** — verified, not assumed. Every `mapOrder`
  fixture supplies a non-empty `id` (`prestashop-order.mapper.spec.ts:61,70,237`;
  `prestashop-order-source.adapter.spec.ts:267`); all other calls pass `[]`. No `*.int-spec.ts` drives
  PrestaShop as an *order source* — `prestashop-order-fulfillment-update.int-spec.ts:269` ingests from
  **Allegro** with PrestaShop as the destination, so it never reaches this mapper.
- **Coverage gap, noted:** PS-as-order-source has no integration coverage at all, which is why "is the
  fallback reachable?" could only be answered from schema reasoning above. Not opened here.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| A real PS deployment returns id-less rows → ingestion fails, and (§ 3) **no order record is created at all** | The fallback is unreachable for a well-formed `display=full` response (§ 2), and the `@_id` shape is now read rather than rejected. If it still fires, the exception names the order and row position, so diagnosis is immediate — and § 3 documents the decision to revisit. |
| A consumer relies on the current index-derived ids for already-ingested orders | `item.id` **is** durably persisted (`order-record.service.ts:64`, into `orderSnapshot`) and forwarded outbound (`order-sync.service.ts:81`) — so this is not a no-op. It is safe because the snapshot is rebuilt on every re-pull with no merge or diff of the `items` array, so these ids already churn silently today. (Note `:130-135`: `fulfillmentState` / `cancelledAt` are deliberately *excluded* from the upsert — the snapshot is not wholesale. `items` is.) Nothing **keys** on them yet, which is precisely why this is the moment to fix it. |
