# R5 / 7 - Red team: scope and over-engineering

Round 5, devil's advocate. Area: is the proposed bundles + gifts scope (D3a-D3f/g, a second
"fulfilment line" identity layer, new order-line fields, 4-5 adapter capabilities, a G15 extension
and a new G20 gifts epic) too big for the OMS pilot milestone, and what is the cheapest design that
still prevents real damage (oversell, wrong documents, missed packing) on the likely pilot stack:
**Allegro (routed by the OMS) + own shop PrestaShop or Shoper (also the product master) +
eparagony or Subiekt for documents, one warehouse** (the #3460 scenario quoted in #3520).

Read-only. Code evidence is `file:line` at worktree HEAD `9e35aec9d`. GitHub read with `gh issue view`.

---

## 1. What the milestone actually asked for (baseline)

The filed G15 work is already scoped and already decided. The spike proposes to grow it.

- #3520 (epic, milestone "OMS MVP: pilot readiness"): "Low priority for the pilot, but a model
  change". Children are a spec (#3606), one core issue (#3607, estimated "**L** - 1-2 weeks"), one
  frontend issue (#3624) and E2E (#3625). Priority P2. Blocked by #3511, #3512.
- D3 (2026-09-28), quoted in every child: "A bundle line is exploded into component lines at
  reservation and routing time; **the order line, the sales documents and the channel keep the
  bundle**." #3607 AC: "The order line, sales documents and channel offer keep the bundle SKU and
  price; **no document line is exploded**."
- #3606 explicitly scopes out "Pricing rules for bundles" and "Importing a master's pack composition".

The spike (`docs/plans/spike-bundles-and-gifts.md` "Decision D3: proposed amendment" and "Proposed
scope") adds, for the **pilot MVP**: D3a in-set price per component, D3b recognition of four channel
shapes, D3c a document setting defaulting to component lines when VAT differs, D3d gift as
component, D3f shipped relay only after all components ship; B-01 editor with live summary, B-10
snapshot, B-11/B-12 bench, B-14/15 documents and component returns, B-16 cost; plus a whole new G20
gifts epic (list price + reduction fields on five adapters, operator add-gift with reservation,
automation "add gift", out-of-stock policy, bench badge, list price + 100% rebate on three document
adapters), and four capability declarers (`data.ts` DECLARATIONS).

**Verdict on scope: disputed.** Two of the spike's additions (D3a/D3c, documents from in-set prices)
directly reverse a decided D3 rule ("no document line is exploded") without new client evidence -
the spike's own "Open questions: Pilot client" (which channels carry sets, eparagony or Subiekt,
pre-built gift boxes) are all unanswered. The rest are features, not damage prevention.

Rough size of the spike's pilot proposal, by counting its items against the team's S/M/L sizing
(estimate, unverified): G15 MVP 8 items (~25-40 dev-days) + G20 8 items (~25-45 dev-days) + 5
"fix regardless" items (~5-10 dev-days) = **~55-95 dev-days**, against the filed G15 of ~15-25.

---

## 2. Damage model for the pilot stack (what actually breaks today)

| # | Situation on the pilot stack | What happens today | Damage | Evidence |
|---|---|---|---|---|
| D1 | Allegro offer mapped to a **PrestaShop pack** (stock from components), OMS routes the order | Hold on the pack position; bench shows the pack SKU; sale decrement writes the **pack's own stock row**, which PrestaShop ignores for a components-mode pack | **Silent oversell** of components on the shop and every channel; pack ATP never drops | `prestashop-inventory-master.adapter.ts:219-221` "this method reports a pack's own stock row (which PrestaShop never decrements when a component sells)"; `adjustInventory` targets only `id_product`/`id_product_attribute` of the adjusted product, :906-911; pack ATP derived only in `listInventory` via `derivePackAvailability`, :400 |
| D2 | Allegro offer mapped to an ordinary master product that IS a pre-built kit (own stock) | Works as any product | none | (no special path) |
| D3 | Own-shop order (PrestaShop/Shoper) for a pack/set | Not routed (#3487 `own-shop-order` skip), the shop decrements its own pack | none new | `fulfillment-routing-eligibility.types.ts:48-50` |
| D4 | Gift arrives as its own channel line (Shoper 0.01, WooCommerce 0.00) | Own line id, flows through reservation/routing/decrement/bench as an ordinary item | Stock and packing **fine**; documents at risk via D5/D6 | r4 B-trace §0: "a gift that the channel sends as its OWN line ... already has a distinct id and is safe on every key" |
| D5 | Discount or delivery remainder on an order with a 0.00 line | The cent lands on the free line | **Wrong document** (gift becomes 0.01) | `discount-rounding.types.ts:65-67` `find((index) => result[index].quantity === 1 && toMinor(...) + gapMinor > 0)`; `delivery-line.types.ts:581-583` first qty-1 line, `grosses[index] > grosses[target]` with `target === -1` |
| D6 | A 0.00 line alone in its VAT letter on eparagony | HTTP 400 errorCode 41 before the printer | Receipt **blocked** (not wrong), cryptic to the operator | C-028 (live probe) |
| D7 | Allegro gift promised only in the offer description | Not in the order at all | **Missed packing** risk; gift stock drifts | C-008 |
| D8 | Mixed-VAT kit documented as one line at the bundle's own rate | Single-rate line | Over- or under-taxed line; **legal question, not a code defect** | spike "Tax adviser" Q4; Allegro itself sends one `tax.rate` per line (C-001) |
| D9 | Someone stores bundle components in `orderSnapshot.items` with the parent id | Routing merges them into ONE work line with the LAST variant | **Silent wrong pick + wrong decrement** | r4 B-trace #7/#8: `routing-commit.service.ts:201-203` Map keeps last variant; :524-545 merge |

Only D1 and D5 are silent damage on the pilot stack today. D6 is visible but opaque. D7 is an
operator-process gap. D8 is a tax-adviser question. D9 does not exist yet; it is the trap the design
must not walk into.

Note on D1: it is **independent of the bundle feature**. It is a live defect of "OMS routing + a
PrestaShop pack as master" that exists the moment the pilot routes an Allegro order for a pack.
Neither reading `productSet` nor any new order-line field fixes it.

---

## 3. Claim verdicts in my area

| Claim | Verdict | Note |
|---|---|---|
| C-049 decrement key collides | **probable, masked today** | Cannot collide today because routing already merged components (r4 #8, #13). With unique per-component line ids (below) it never collides. Not a reason for a second identity layer by itself. |
| C-050 unique indexes on work lines / shipment lines | **confirmed** | `1864000000000-create-fulfillment-works.ts:159-160`, `1874000000000-create-shipment-lines.ts:116-117`. Shipment lines do **not** need component grain for a one-warehouse pilot (§5). |
| C-051 `closeForOrder` closes sibling holds | **confirmed** | `reservation.service.ts:322-327`; disappears once each component has its own line id. |
| C-052 routing conservation per order line | **confirmed** | `routing.types.ts:276`; correct again per component with unique ids. |
| C-053 all-or-nothing item resolution | **confirmed**, and it **helps** scope: an Allegro `productSet` offer with no mapping parks the whole order in `awaiting_mapping` - visible, not silent. Reading `productSet` is a convenience, not damage prevention. |
| C-055 five allowlists for a new `OrderItem` field | **confirmed (code)**; argues **against** adding `composition` / `commercial` fields in the pilot. |
| C-058 / C-059 capability patterns, per-order stock effect | **confirmed**; none of the 4-5 proposed declarers is needed for routed pilot orders (§6). |
| C-060 PrestaShop `adjustInventory` writes only the pack row | **confirmed**, and it is the pilot's real bundle defect (D1). The spike lists it as B-20 but does not put it in "fix regardless". |
| Spike "fix regardless: Allegro `productSet` and Shoper `children` ingestion" | **disputed as must-have** | If recognition is "the resolved variant has an OpenLinker bundle definition", a parent-only line (Allegro, Erli, PrestaShop pack row, Shoper parent while children are ignored) needs nothing new from the adapter. The Shoper adapter does not emit children today (C-019), so there is no double count either. |
| Spike D3c "documents as components when VAT differs" | **disputed for pilot** | Reverses decided D3; needs D3a in-set prices + return matching changes + tax adviser. Defer. |

---

## 4. The synthetic-id alternative, examined both ways

The question: instead of a second identity layer (`fulfilmentLineId`), give each component its own
order line id, e.g. `{lineId}#c{n}`.

### 4a. Synthetic ids written into `orderSnapshot.items` at ingestion - rejected

What it fixes for free: every fulfilment key in r4's table (#1-#21) becomes unique per component,
`itemsById` in the decrement handler finds the component (`inventory-sale-decrement.handler.ts:90-97`).

What it breaks:
1. **Documents.** The invoice and receipt mappers build lines from `order.items`
   (`order-to-issue-invoice-command.mapper.ts:374,384`; fiscal mapper :281) and must sum to the
   total. Components on the order force a price on each component = the full D3a in-set price +
   D3c component documents, i.e. pulls the most expensive, tax-adviser-blocked part INTO the pilot
   and breaks D3 "documents keep the bundle".
2. **The channel-original invariant.** #3542: "The persisted `orderSnapshot` column is ALWAYS the
   channel original". Rewriting it with synthetic lines breaks that and the amendment diff
   (`order-amendment-diff.ts:152-160`, keyed by `items[].id`) unless both sides are expanded
   identically on every poll; any definition edit between polls produces spurious amendments.
3. **Returns.** Allegro returns key by `offerId` (C-010); the return-line resolver narrows on
   `sku`/`offerId` (`return-order-line-resolution.domain-service.ts:179,188`). With the bundle line
   gone from `items`, a return of the bundle offer finds no candidate.
4. **Order edits, analytics, search text, destination mirror** all read `order.items` and would
   start showing/pricing components (r4 #22-#25, #36-#38).

### 4b. Synthetic ids derived only for fulfilment - recommended, and it is NOT a second layer

Keep `order.items` untouched. One pure function `expandFulfilmentLines(order, expansions)` returns
one line per ordinary item with `orderLineId = item.id` (byte-identical, no backfill) and one line per
bundle component with `orderLineId = {item.id}~{componentVariantId}`. The value goes into the
**existing** `orderLineId` columns (reservations, work lines, decrement keys). No new column, no new
index, no change to any unique index. This is r2 code-B's `fulfilmentLineId` idea
(`r2/code/B-order-lines-and-documents.md:50`) minus the separate field: it is a value convention, not
a second persisted identity.

Call sites that must change (all three already share one projection each):
- reservations: `order-ingestion.service.ts:2236-2243` (`orderLineId: item.id`).
- routing: `project-order-for-routing.ts:47-52`, which serves all three callers (ingestion :1158,
  `routing-dry-run.service.ts:207`, `fulfillment-work-route.handler.ts:453`).
- decrement: `inventory-sale-decrement.handler.ts:90-97`. **This one is not optional**: with a
  derived id, `itemsById.get('L~v')` returns `undefined` and the handler logs "its stock was NOT
  lowered" and `continue`s - i.e. a silent under-decrement unless it builds its map from the same
  expansion.

Consumers that become correct by themselves once ids are unique: `closeForOrder` (r4 #3, #15),
`readClosedLineIds` (#2), master-absorbed grouping (#5), conservation (#6), variant map and merge
(#7, #8), decrement keys (#13-#16), bench (#34).

Consumers that must be **guarded, not built**, in the pilot (they take the commercial id `L` and
would no longer find the component work lines):
- operator quantity edit of a bundle line (`fulfillment-order-edit.service.ts:77-81`, `narrowForOrder`
  `reservation.service.ts:247,261`, reversal key `edit:{changeId}:{orderLineId}`): refuse with a new
  code, e.g. `LINE_IS_BUNDLE`. S.
- return restock of a bundle line and the credit-note proposal (`return-correction-matching
  .domain-service.ts:263-270`): route to manual (restock blocked with a named reason; proposal
  `no-match`), never auto. S.

### 4c. Why `#c{n}` (positional) is the wrong format

The derived id ends up in terminal reservation rows (kept forever, #2343), in
`inventory_sale_decrements.idempotencyKey` (unique, replay protection) and in work lines. A
positional index changes when a definition is reordered or a component removed; a re-poll then mints
a new hold key and a re-route a new decrement key for the same physical component (double hold,
possible double decrement). Use the component **variant id**, which is stable, and reserve a role
segment now so a later gift-as-component (D3d) with the same variant as a paid component cannot
collide: `{lineId}~c:{variantId}` (and later `~g:{variantId}`). This is the one decision in the pilot
that is genuinely expensive to change later (§7).

---

## 5. Must-have vs deferrable for the pilot

"Must" = prevents silent oversell, a wrong document, or missed packing on the pilot stack.

| Item | Pilot? | Reason |
|---|---|---|
| PrestaShop pack decrement (D1): routed decrement of a components-mode pack must not silently write the pack row | **MUST (Stage 0)** | Live silent oversell. Cheapest: adapter refuses before writing with a typed error and the decrement records it as `blocked` (attention `stock-decrement-blocked`) - S. Better: adapter decrements the components like PrestaShop's own `validateOrder` does - M, needs per-component idempotency and an `in_doubt` rule for a partial write. |
| Zero-line rounding fixes (D5): skip paid-gross-0 lines in `reconcileDiscountRounding` and `spreadDeliveryAcrossLines` | **MUST (Stage 0)** | Live wrong document; ~10 lines + tests. S. |
| eparagony error 41 surfaced with an operator cause (D6) | **MUST (Stage 0)** | Not damage, but a pilot receipt stuck with an opaque error is a support incident. S. |
| Ask the pilot client the five spike questions | **MUST before Stage 1** | Stage 1 is only worth building if the client sells OL-packed kits on routed channels. 0 dev. |
| OL bundle definition (table + admin API) | MUST if Stage 1 | D3 as filed. |
| Expansion at reservation + routing + decrement via derived ids (§4b), frozen per order once | MUST if Stage 1 | Prevents D9. Freeze in a separate insert-if-absent table (not in `orderSnapshot`, which ingestion rewrites and which has five allowlists, C-055). |
| Bundle ATP = min over components incl. OL holds, published for the bundle variant, reverse lookup on component change, stale component -> unsellable | MUST if Stage 1 | Without it the bundle offer keeps selling from a pack figure that only refreshes on the next master sweep. Compute in the publish path (`IAvailabilityService`), never write it into the master's `inventory_items` row (two writers). |
| Bench: component pick lines | MUST if Stage 1 | Comes free with component work lines; a missing component cannot be verified, so the parcel cannot close - B-12 needs no new code. "Part of: bundle" label is cosmetic (lookup in the frozen expansion). |
| Guards: refuse bundle-line quantity edits; manual restock/credit for bundle-line returns; warn when component VAT differs from the bundle's rate; warn when an OL bundle is defined over a master pack that keeps its own stock | MUST if Stage 1 | Each turns a silent wrong result into a visible refusal. S each. |
| Gift added manually by the operator as a packer note (D7) | MUST (process) | Order notes with `showToPacker` already reach the bench (`BenchParcelView.packerNotes`). Zero code. Gift SKU stock corrected via manual correction (#3566). |
| Bundle cost for margin | process only | Snapshots are "never upgraded, never replaced" (#3588), so pilot-period bundle orders without a cost stay "no-cost" forever. Mitigation: operator records the kit's cost on the bundle variant with the existing cost endpoint. Zero code. B-16 auto-sum deferred. |
| D3a in-set price | defer | Only needed for component documents, component returns and margin; none is damage while documents keep the bundle line. |
| D3c component document lines | defer | Reverses D3; tax adviser; eparagony zero-bucket rule interacts (C-028). |
| D3b channel shape ingestion (Allegro `productSet`, Shoper `children`, WooCommerce container+children, PrestaShop pack row) | defer (except WooCommerce guard) | Recognition by resolved variant covers parent-only shapes; unmapped lines are visible (C-053). WooCommerce is not on the pilot stack; if it is, children lines are already emitted and an OL definition on the container would double count - refuse such a definition. |
| D3d gift as component | defer | Feature. Reserve the id role segment now (§4c). |
| D3e no nesting | free | A rule, enforced at definition. |
| D3f shipped relay after all components | defer | One warehouse: all components of a line land in one work (routing groups by location), and the parcel cannot close short (B-12). |
| Shipment lines at component grain | defer | Keep `shipment_lines` commercial (`lineId: item.id`, `shipment-line.service.ts:113-118`); one bundle = one parcel in a one-warehouse pilot. |
| All four capability declarers | defer | Routed orders never touch `OrderCreateLineStockEffect`; `LineAdjustmentRenderingDeclarer` only matters with gift rebates on documents; `MasterBundleStockReader` can start as an operator warning. |
| G20 gifts epic (list price/reduction fields, operator add-line, automation add-gift, out-of-stock policy, document rebates) | defer to post-pilot | Differentiation, not damage. Operator add-line does not exist at all (C-057, edits only lower), so G-05 alone is an L. |
| B-01 live summary, B-18 import, B-09 variant choice, B-13 cross-warehouse, G-11/G-12/G-15 | defer | Already "later" or feature. |

---

## 6. Minimal pilot design

**Stage 0 (do now, independent of bundle scope).**
1. PrestaShop `adjustInventory`: when the target product is a pack whose stock comes from components
   (same `readPackDefinition` + `resolvePackStockMode` already used in `listInventory`,
   `prestashop-inventory-master.adapter.ts:374-390`), either refuse before writing with a typed
   `NotSupported`-style error classified as `blocked` by the sale decrement (S), or decrement the
   components (M). Recommend refusal for the pilot (visible, cheap, no partial-write semantics), and
   ask the client whether their kits are PrestaShop packs before choosing the M variant.
2. Skip paid-gross-0 lines in the two remainder allocators.
3. Operator-facing cause for eparagony error 41.
4. Document the gift process: packer note + manual stock correction; kit cost entered on the variant.

**Stage 1 (only if the client confirms OL-packed kits on routed channels) = the filed #3607/#3624,
tightened:**
- `bundle_components` (bundle variant, component variant, qty per set) + admin CRUD.
- `order_line_bundle_expansions` (order, line, frozen components, definition version), written once
  on first ingestion (insert-if-absent), read by the expansion function.
- `expandFulfilmentLines()` pure, used at the three call sites in §4b; component id
  `{lineId}~c:{variantId}`.
- Bundle ATP in the publish path + reverse lookup + stale component.
- Guards listed in §5.
- Minimal FE: definition panel and component pick lines with a "Part of" label; order-detail
  expansion is a nice-to-have.
- E2E golden path 1 only (define, order on Allegro, reserve components, pick components, invoice keeps
  the bundle line).

Recognition = "the resolved variant has a definition". No new `IncomingOrderItem` / `OrderItem`
field, no new capability, no document change.

---

## 7. Lock-in: what the minimal pilot makes expensive later

1. **The derived component id format** is persisted in terminal reservation rows, unique
   idempotency keys and work lines, and keys must never change for replay protection. Changing it
   later means a data migration across 3+ tables plus a compatibility read path. Mitigation: stable
   variant-based key with a role segment from day one (§4c).
2. **Reservation grain.** If the pilot took the shortcut of holding the bundle position and exploding
   only at routing, a held order (fraud hold, `routing-refused`) would not protect component stock,
   and an OL-only bundle variant has no position at all (`reservation.service.ts:100-102`
   `skipped.push({... reason: 'no-position'})`). Switching later is cheap (holds expire in 7 days)
   but the window is real, so do not take the shortcut: the reservation call site is one line once the
   expansion function exists.
3. **Bundle ATP owner.** If the pilot writes the derived bundle figure into `inventory_items` it fights
   the master sync (two writers). Doing it in the publish path from the start costs the same.
4. **Documents keep the bundle line.** Issued documents are immutable; later component documents
   (D3c) apply only to new orders. The real later cost is **component returns against a bundle-line
   invoice**: pilot orders have no in-set price, so a credit note for one component needs a fallback
   rule (e.g. proportional to catalogue price) forever for those orders. Mitigation: freeze the
   components' catalogue gross prices in the expansion row now (two columns, no logic), so D3a later
   has a defensible basis for pilot-period orders.
5. **No `composition` field on the order line.** Additive later (optional field), but it will pay the
   five-allowlist cost (C-055) whenever it lands; the pilot does not make that worse.
6. **Margin snapshots.** Bundle orders ingested without a variant cost stay "no-cost" permanently
   (#3588 never upgrades a snapshot). Mitigation is process-only (enter kit cost before go-live).
7. **Recognition by variant only.** A later WooCommerce/Shopify children shape needs child-line
   suppression, which needs the neutral field. Additive; the pilot guard (refuse definitions on a
   WooCommerce container) keeps it from silently double counting meanwhile.
8. **Gifts as notes.** Operators get used to notes; a later G20 add-line must import nothing from
   them (notes are free text). Low cost, but there is no history of "which orders got a gift" from the
   pilot period - G-12 cost report will start empty.

---

## 8. Staged plan with effort (one developer; S <= 2d, M <= 5d, L <= 10d)

| Stage | Content | Effort | Gate |
|---|---|---|---|
| 0 | PS pack decrement refusal (or component decrement), two allocator fixes, eparagony err 41 cause, gift/cost process note | 3-6 dev-days (refusal) / 6-9 (component decrement) | none; fixes live defects |
| 0.5 | Client answers to the spike's five pilot questions; tax adviser Q1-Q4 started in parallel | 0 dev | decides Stage 1 and Stage 3 |
| 1 | #3607/#3624 tightened: definitions + CRUD (3-4d), frozen expansion + 3 call sites + handler (3-5d), bundle ATP publish path + reverse lookup + stale (4-7d), guards (2-3d), minimal FE (3-5d), E2E golden path 1 (2-3d) | **17-27 dev-days** (#3607 alone says 5-10; core part honestly 12-19) | only if the client sells OL-packed kits on routed channels |
| 2 | D3a in-set price, D3c component documents (after tax adviser), component returns, D3b channel shapes as recognition aids, D3f relay, shipment lines per component, B-16 cost sum | 20-35 dev-days | post-pilot, tax adviser answer |
| 3 | G20 gifts: neutral list price + reduction (5 adapters + allowlists), operator add-line (new capability of edits), automation add-gift, out-of-stock policy, document rebates + `LineAdjustmentRenderingDeclarer`, bench badge | 25-45 dev-days | post-pilot; differentiation |

Pilot total: Stage 0 (3-9 days) always, Stage 1 (17-27 days) conditional - against roughly 55-95
dev-days for the spike's pilot scope.

## 9. Counterarguments against the proposed design (with alternative and cost)

1. **"Recognise channel shapes" (D3b) is the wrong first step.** Alternative: recognise by resolved
   variant + OL definition; unmapped shapes stay visible in `awaiting_mapping`. Cost: operator maps a
   `productSet` offer once by hand. Saves 4 adapter changes and the five-allowlist risk.
2. **A second identity layer is over-built.** Alternative: a derived value convention in the existing
   `orderLineId` columns (§4b). Cost: one pure function, three call sites, two guards; no migration of
   indexes.
3. **Documents from in-set prices reverse D3 without evidence.** Alternative: keep the bundle line,
   warn at definition when component rates differ, wait for the tax adviser. Cost: possibly
   over-taxed mixed-VAT kits during the pilot (seller's money, not a refusal), only if such kits exist.
4. **G20 is not pilot damage prevention.** Alternative: packer note + manual stock correction + the
   two allocator fixes. Cost: no gift trace in the order model during the pilot.
5. **Capabilities before an implementer.** ADR-048 decision 1 ("forbids an interface with no implementer", architecture-overview § Products): no interface without an
   implementer. Alternative: operator warnings now, capabilities when the first adapter needs them.
6. **The spike misses the actual pilot defect.** D1 (PrestaShop pack decrement under OMS routing) is
   silent oversell today and is not in "fix regardless". Alternative: Stage 0 item 1.
