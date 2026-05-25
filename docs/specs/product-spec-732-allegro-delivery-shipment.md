# Product Spec — #732 Wysyłam z Allegro (Allegro Delivery / Allegro One) shipment integration

**Status:** phases A–E complete; Gate D = YES (build); refinement closed 2026-05-25; impl tracked via #832–#839 (+ deferred PDs #827, #831)
**Parent issue:** [#732](https://github.com/openlinker-project/openlinker/issues/732)
**Started:** 2026-05-25
**Last updated:** 2026-05-25
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)
**Sibling specs:** [#727 InPost (P1, own-contract)](./product-spec-727-inpost-integration.md) · [#726 Allegro bulk listing](./product-spec-726-allegro-bulk-listing.md) · [#728 invoicing](./product-spec-728-invoicing-integration.md)

---

## 1. Problem

> **Phase A — DRAFT, pending Gate A confirmation**

### Problem statement

A growing share of PL Allegro sellers ship through the **Allegro Delivery program (Allegro Dostawa)** or **Allegro One** delivery methods (One Box / One Punkt / One Kurier). These sellers have **no direct carrier contract** — their contract is with **Allegro**, which acts as logistics broker and subcontracts to InPost, DPD, DHL, ORLEN Paczka, and its own Allegro One network.

For these sellers, labels **must** be generated through Allegro's `/shipment-management/*` REST API ("Wysyłam z Allegro"). There is no alternative: own-carrier credentials don't work when shipping is routed through Allegro Delivery, and Allegro One has **no own-contract option at all**.

OpenLinker's only shipping path today is the **own-contract carrier path (P1)** being built in [#727 (InPost)](https://github.com/openlinker-project/openlinker/issues/727). That path is structurally unavailable to P2/P3 sellers. So today their per-shipment workflow is:

1. See the order in OL
2. **Leave OL** → log into the Allegro seller panel ("Wysyłam z Allegro" web UI)
3. Generate the label there (choosing the Allegro Delivery service)
4. Copy tracking back / mark shipped manually

This breaks the **Q1 wedge promise** of "complete end-to-end workflow inside OL" for a meaningful and *growing* segment of the target market. OL lists their offers (#726) but can't ship them — the orchestration loop is broken at the shipping step, exactly as it is for P1 sellers without #727.

### Why this segment is growing

Allegro economically steers sellers toward Allegro Delivery / Allegro One via the **Smart! commission structure**: since 2026-03-02, Smart top-up fees for Allegro One deliveries are **0.99–2.99 zł** vs **5–9.99 zł** for non-Allegro-One Smart deliveries. Newer sellers — and those who don't want to administer separate carrier contracts — increasingly land on this path by default. *(Pricing figures from the #732 issue body; to re-verify against current Allegro Smart docs in Phase B.)*

### The three contractual paths (resolved during #726 Phase B research)

| Path | Contract | Label generation | OL coverage |
|---|---|---|---|
| **P1 — Own-contract carrier** | Seller ↔ InPost/DPD/DHL direct | Carrier's own API (ShipX, etc.) | 🔜 via [#727](https://github.com/openlinker-project/openlinker/issues/727) (in flight — PR #812) |
| **P2 — Allegro Delivery** | Seller ↔ **Allegro**; Allegro ↔ carriers | **Allegro `/shipment-management/*` API** | ❌ **this issue** |
| **P3 — Allegro One** (Box/Punkt/Kurier) | Subset of P2 — Allegro's own network | Same as P2 (mandatory) | ❌ **this issue** |

### Terminology: "carrier" vs "shipping method" (and OL's three concepts)

**Generally:** a **carrier** is the company that physically moves the parcel (InPost, DPD, DHL, ORLEN Paczka, Poczta Polska; Allegro One is Allegro's own network). A **shipping / delivery method** is a specific *service* — usually carrier × modality (× options): "InPost Paczkomat", "DPD Classic", "Allegro One Box". One carrier offers many methods. **Modality** = locker (paczkomat) vs courier-to-door (kurier) vs PUDO.

**In OL there are three distinct concepts — easily conflated:**

| OL concept | Layer | What it is | Example |
|---|---|---|---|
| **Source delivery method** — `OrderShipping.methodId` (+ `methodName`) | orders ctx, on the order | the marketplace service the buyer chose; the **carrier-mapping lookup key** *and* the **routing key** | Allegro `delivery.method.id` for "Allegro One Box" |
| **Destination carrier** — `prestashopCarrierId` via `CarrierMapping` | mappings ctx | the **OMP's** carrier entity a source method maps to (branch-1 / OMP-fulfilled) | PS `id_carrier` = "InPost Paczkomaty" |
| **Shipping shape / modality** — `ShippingMethod` = `paczkomat \| kurier` | shipping ctx, `getSupportedMethods()` / `generateLabel` | adapter-internal: which **label-endpoint shape** to produce | `paczkomat` |

So "method" is overloaded today: `OrderShipping.methodId` (a source *service id*) ≠ `ShippingMethod` (a coarse *modality*). And "carrier" in OL currently means the **PrestaShop (destination) carrier**, via `CarrierMapping`. The routing model is keyed on the **source delivery method**; modality is an adapter-internal detail; the destination carrier matters only for the OMP-fulfilled branch.

### How shipping is routed — a general model (NOT Allegro↔PS-specific)

An order flows **Order Source → OL → Order Destination (OMP)**. Independently of which source and which destination, each order's shipment is handled by one of three **processor kinds**, and **OL is the single status pane across all three**. The model is **source-, carrier-, and OMP-agnostic by design** — Allegro / PrestaShop / InPost are today's *instances*, not the shape. Future order sources (Amazon, eBay, …) and carrier integrations (DPD, DHL, …) must drop into the same model without rework:

| Processor kind | Who fulfills | OL's role | Today's instance |
|---|---|---|---|
| **OMP-fulfilled** | the destination OMP ships externally via its own carrier setup | OL maps the source method → an OMP carrier and **reads status back** | PrestaShop — `CarrierMapping` (`allegroDeliveryMethodId → prestashopCarrierId`) **exists today** |
| **OL-managed carrier** | OL drives an own-contract carrier integration | OL generates the label; order mirrored to OMP | InPost ShipX — [#727](https://github.com/openlinker-project/openlinker/issues/727) (in flight) |
| **Source-brokered** | OL drives the **order source's own** shipping brokerage (a marketplace offering shipping as a capability) | OL calls the source to ship; order mirrored to OMP | Allegro Delivery / One via `/shipment-management/*` — **this issue** |

**Key finding:** today's `CarrierMapping` hardcodes the *OMP-fulfilled* branch for the *Allegro→PS* pair — no axes for order source, processor kind, or destination. The general routing model needs all four (`Source × Method × Processor × OMP`). **Discipline:** design the abstraction generically; **implement only today's real connections** (Allegro source, PS OMP, InPost carrier, Allegro Delivery processor) — no speculative adapters for sources/carriers we don't yet have. The routing model is **cross-cutting with #727** (its InPost path is the *OL-managed carrier* branch); per Gate A it lives in #732 and #727 retrofits onto it (decision (a)).

### Is this three capabilities, or one? (architecture check — 2026-05-25)

Checked `ShippingProviderManagerPort` (#763): `generateLabel` + `getTracking` + `getSupportedMethods`, with `ShipmentCanceller` / `PickupPointFinder` as co-located sub-capabilities, resolved **per-connection** through OL's capability registry. Findings:

- **OL-managed carrier (branch 2) and source-brokered (branch 3) are the SAME capability — different adapters.** Allegro's `/shipment-management/*` (create-shipment → id, label, tracking, cancel) maps onto the existing port verbatim; the port header already names "#732 Allegro Delivery" as a future implementer. Branch 3 is **not a new capability type** — it's a new `ShippingProviderManagerPort` adapter, hosted on the **Allegro (source) connection** rather than a dedicated carrier connection. Allegro One just adds `ShippingMethod` values + entries in that adapter's `getSupportedMethods()`.
- **So routing is not "3 mechanisms."** It's **one capability, many adapters, per-connection resolution.** Routing = map `(orderSource, sourceDeliveryMethod) → a shipping-capable connectionId (+ OMP destination)`, constrained only by each connection's **declared compatibility** (the `getSupportedMethods()` seed) — not forced rules (Allegro One is compatible with the Allegro connection alone because only that adapter declares support). A future DPD/DHL carrier or a second marketplace broker is just **another adapter** — zero routing-model change. That is the generality the maintainer asked for.
- **Branch 1 (OMP-fulfilled) is the one genuine fork.** It never calls `generateLabel` and has no OL-driven `providerShipmentId`, so it doesn't fit `getTracking({providerShipmentId})` cleanly. Two defensible models — **(i)** a *degenerate* PS adapter implementing the same port (generateLabel = assign-carrier/no-op, getTracking = read PS), unifying everything to "route to a shipping-capable connection"; or **(ii)** a distinct "delegate-to-OMP" mode using the existing `OrderProcessorManagerPort` + `CarrierMapping` + a **new small fulfillment-status-reader capability** for the read-back, with only branches 2/3 being `ShippingProviderManagerPort`. **ADR-worthy Tier-2 decision — explicitly NOT settled in this product spec.** Phase C frames the trade-off; the routing-model child issue + a shared ADR decide the shape.

So the "three processor kinds" above are a **descriptive taxonomy of where the shipping-capable connection sits**, not three distinct mechanisms. The product question is "route each `(source, method)` to a fulfilling connection + surface unified status"; the capability-boundary question (is branch 1 a degenerate adapter or a separate mode?) is Tier 2.

**Scope constraint that falls out of this:** a "Wysyłam z Allegro" shipment is created against an Allegro **checkout form**, so **#732 applies to Allegro-sourced orders only** — a PrestaShop-direct order has no Allegro counterpart to ship against. This distinguishes #732 from #727, which can fulfill *any* order.

**Two refinements to the routing model (maintainer, 2026-05-25):**

- **OL is the single pane for shipment status across all three branches — including branch 1.** Even when PrestaShop (branch 1) or Allegro (branch 3) is the fulfiller, OL must surface the shipment's status + tracking in its own `/shipments` view. For branch 1 this means OL **reads status back** from the fulfiller (PrestaShop, or the Allegro order's fulfillment state) rather than generating it. *Where branch-1 status truth lives is a Phase B research question.*
- **Routing is fully configurable, constrained only by *declared compatibility* — not forced rules.** The operator freely maps each source delivery method → a processor; the config offers only processors **compatible** with that method, where compatibility is **declared by each adapter** (the `getSupportedMethods()` seed on `ShippingProviderManagerPort`), never hardcoded. "Allegro One → Allegro Delivery" is therefore *not* a forced rule — it's that only the Allegro Delivery adapter declares it can fulfil Allegro-brokered methods (InPost/PS can't produce an Allegro One label). If exactly one processor is compatible, the UI shows one — by compatibility, not by force. **Open (Phase C):** today's `getSupportedMethods()` is coarse (`paczkomat | kurier`) — too coarse to distinguish "InPost *own-contract* paczkomat" from "*Allegro One* paczkomat". The **granularity/shape of the compatibility key** (modality vs carrier×modality vs source-method metadata) is a Phase C design question.

**Routing-config home (A6 — resolved: part of #732).** The general "who fulfills?" routing model is **in scope for this spec**. The leading candidate shape (maintainer-proposed, to develop in Phase C) is a **mapping UI keyed on four axes**: `Order Source` × `Shipment method` × `Shipment processor` × `Order Destination (OMP)` — generalizing today's `CarrierMapping` (which collapses these into just `Allegro method → PS carrier`). Because the model governs all three processor kinds, it is **cross-cutting with #727** (whose InPost path is the *OL-managed carrier* branch). **Gate A decision (a):** #732 defines the routing model; #727's InPost path retrofits onto it — so #727's remaining FE (connection settings #771, order Shipment panel #769) should align with / wait on this foundation rather than inventing a parallel one. Phase E will likely spawn a **general foundational routing-model child issue** that the Allegro Delivery processor and the InPost path both consume; a shared ADR records the shape.

### Why now

- **Q1 wedge timing** — #727 (P1) + #732 (P2/P3) together give full PL Allegro-shipping coverage. #727 alone leaves the Allegro Delivery segment unable to ship from OL.
- **The port to extend now exists** — `ShippingProviderManagerPort` foundation landed (#763 → #800), and the first consumer (InPost adapter, #764/#765) is in flight (PR #812). The "extend the existing port vs. new port" question now has real precedent to reason against (a Phase C / Tier 2 question, not Phase A).
- **API deprecation clock** — Allegro is removing `smartDeliveryMethods` fields on **2026-07-28** (~2 months out as of 2026-05-25). *If* this integration reads those fields for delivery-method validation, the replacement contract was undocumented at #726 Phase B and needs a live probe. This is a sequencing flag, not a blocker.

### Illustrative end-to-end flows (shared understanding)

> Product-level walkthroughs of the agreed model — *not* technical design. They illustrate how the **one-capability / compatibility-routed / unified-status** model behaves across the three branches. Open forks (branch-1 modeling, A3/A7) are marked inline.

**Setup (config-time) — the generalized routing/mapping UI.** Per `Order Source`, for each **source delivery method** seen on incoming orders, the operator configures: **Processor** (dropdown of only *compatible* processors) + **OMP destination** + (branch-1 only) the **destination carrier** + **trigger model** (manual / auto-on-paid / …). Compatibility is adapter-declared:
- `Allegro One Box` → only **Allegro Delivery** is compatible → one option.
- `Paczkomaty InPost` → **PrestaShop (→ PS InPost carrier)** *and* **InPost (OL-managed)** are both compatible → operator chooses.

**Flow A — `Allegro One Box` → source-brokered (branch 3, the core #732 case):**
1. Buyer picks Allegro One Box (locker `WAW123`), pays.
2. OL ingests the Allegro order: `OrderShipping.methodId` = Allegro One Box, `pickupPoint.id` = `WAW123` *(read from payload — A3)*.
3. OL mirrors the order to PrestaShop (OMP, system of record); PS does **not** fulfil.
4. Routing → **Allegro Delivery** processor; a `Shipment` is created (`draft`).
5. Trigger (manual button / auto) → OL calls Allegro `/shipment-management/*` against the order's **checkout form** with the pickup point.
6. Allegro returns shipment id + label PDF → `Shipment` = `generated`; operator downloads label in OL.
7. Status (webhook/poll) advances dispatched → delivered; OL propagates to PS (status + tracking). Allegro already knows (it's the broker).
8. Operator saw the whole lifecycle in OL — never left.

**Flow B — `Paczkomaty InPost`, shop has own InPost contract → OL-managed carrier (branch 2, the #727 path under this model):**
1. Buyer picks InPost Paczkomat (`POZ08A`), pays.
2. OL ingests: `methodId` = Paczkomaty InPost, `pickupPoint.id` = `POZ08A`.
3. OL mirrors to PS (OMP).
4. Routing → **InPost (OL-managed)** (operator chose this over PS because of their own contract/rates); `Shipment` = `draft`, modality `paczkomat`.
5. Trigger → OL calls **InPost ShipX** `generateLabel` (paczkomat) for `POZ08A`.
6. ShipX returns shipment id + tracking + label → `Shipment` = `generated`.
7. Status (InPost webhook/poll) → OL propagates to **both Allegro** (mark shipped + tracking) **and PS**.
8. Same operator UX as Flow A; different processor; OL must push tracking back to Allegro (in A, Allegro already knew).

**Flow C — `Kurier DPD` the shop fulfils in PrestaShop → OMP-fulfilled (branch 1):**
1. Buyer picks a courier the shop ships via its existing PS + DPD setup, pays.
2. OL ingests: `methodId` = Kurier DPD.
3. Routing → **PrestaShop (OMP-fulfilled)**, mapped to PS carrier "DPD".
4. OL mirrors the order to PS **with the mapped PS carrier set**; OL calls **no** label API. *(Branch-1 modeling — degenerate adapter vs delegate-to-OMP+status-reader — is the Tier-2 fork; either way OL doesn't generate the label.)*
5. The shop's existing PS workflow generates the label & ships (outside OL).
6. **Status read-back** *(A7 — source of truth TBD in Phase B)*: OL reads the shipment status/tracking back and surfaces it in `/shipments` as a shipment whose processor = "PrestaShop".
7. Operator sees this shipment **alongside** branches A/B in the single pane — OL didn't ship it, but tracks it.

**Flow D — one method, multiple compatible processors → operator chooses (configurability):** `Paczkomaty InPost` is compatible with both branch 1 (PS InPost carrier) and branch 2 (OL-managed InPost). The operator picks per their contract; switching later (e.g. after signing an own-InPost contract) is a **config change, not code**. Contrast Flow A, where exactly one processor is compatible. This is "everything configurable, constrained only by declared compatibility" in action.

### "Dispatch" decomposed — who does what (OL never does physical handover)

"Dispatch" is not one step; the flows above gloss it. It decomposes as:

| Step | Branch 3 — Allegro Delivery | Branch 2 — OL InPost | Branch 1 — PS-fulfilled |
|---|---|---|---|
| **1. Create shipment + label** | OL → Allegro `/shipment-management/*` | OL → InPost ShipX | PrestaShop (shop workflow) |
| **2. Physical handover** (drop at locker / courier pickup) | **Operator, physical** | **Operator, physical** | Operator/shop, physical |
| **3. Dispatch protocol / manifest** | Allegro panel — **v1 manual, v2 in OL** | InPost — **v1 manual, v2 in OL** | PS — outside OL |
| **4. `dispatched` status in OL** | observed (Allegro webhook/poll) | observed (InPost webhook/poll) | **read-back** (A7) |
| **5. Mark order "sent" on source + OMP** | Allegro already knows; OL updates PS | **OL pushes** shipped+tracking to Allegro **and** PS | OL/PS — TBD |

Takeaways: (a) OL's active role is **steps 1 + 5 only**; physical handover (step 2) is **always the operator**, never OL. (b) **Step 3 (protocol/manifest) is v1-out-of-scope** — operator generates it in the carrier/Allegro panel; OL automation is v2 (matches #732's out-of-scope list + #727). (c) **Step 4 (`dispatched`) is observed, not performed** — via tracking signal or read-back. (d) **Where steps 1/5 live inside OL** = a worker job kicked off by the per-connection **trigger model** (manual / auto-on-paid / auto-on-shipped / batched, #727 SC-1); job mechanics are Tier-2.

**Open (Phase B/C):** does v1 need an explicit **"Dispatch / Mark as sent"** action *distinct* from "Generate label" (for Allegro buyer-facing dispatch + on-time-dispatch metrics)? For branch 3, does creating the Allegro Delivery shipment **auto-mark** the Allegro order sent, or is a separate notification required? *Verify against Allegro docs in Phase B — don't guess.*

### Forward-compat: operator fulfillment-workflow statuses (OOS — deferred to #827)

Operator-set warehouse-workflow states (`picking` / `packed` / `waiting-for-carrier`) are **out of scope for #732** — they're a cross-cutting OMS concern spanning all orders/branches, not Allegro-Delivery-specific, and the shipment status `generated` already serves as a read-only "packed / awaiting dispatch" signal in the unified pane. **But #732 must design around the future layer so it plugs in cleanly:** keep **shipment status**, **order status**, and a future **operator-set fulfillment-workflow status** as *three separate axes* — don't overload shipment status with operator-workflow semantics, and don't assume order status is the only place workflow state can live. Filed as Product Design **[#827](https://github.com/openlinker-project/openlinker/issues/827)**.

---

## 2. Affected persona

> **Phase A — DRAFT, pending Gate A confirmation**

### Primary persona: PL Allegro seller shipping via Allegro Delivery / Allegro One (P2/P3)

Same **base persona** as the sibling shipping/listing/invoicing specs (#726/#727/#728) — distinguished by the *contractual path of their shipments*, not a different kind of business:

- **Role:** in-house operator at a PL e-commerce shop
- **Company size:** 1–30 people
- **Volume:** 100–1,000 SKUs; 10–200 orders/day
- **Sophistication:** operator-level — comfortable with admin UIs, NOT technical
- **Geography:** PL only
- **Distinguishing trait:** ships through Allegro Delivery / Allegro One, so the carrier relationship is *with Allegro*, not a direct carrier contract. Often newer sellers or those who deliberately avoid administering separate carrier contracts.
- **Trigger event:** receives an order where the buyer chose an Allegro Delivery / Allegro One delivery method → operator needs to dispatch the package.

### Relationship to #727 and PrestaShop-fulfilled shipping — additive, 3-branch routing

A single shop frequently uses **all three fulfillment branches at once** (see §1 "How shipping is routed today"):
- some Allegro orders are left to **PrestaShop** to fulfill via mapped carrier (branch 1, exists today),
- some ship via the shop's **own InPost contract** through OL (branch 2, #727),
- some ship via **Allegro Delivery / One** through OL (branch 3, #732).

These are not mutually-exclusive seller types — they're three routing branches that **coexist within one shop**, chosen per Allegro delivery method. #732 is therefore **additive** to #727 and to today's PS-fulfilled path, never a replacement. The seller needs a way to say, per Allegro delivery method, *which branch applies* — and that routing config is **cross-cutting with #727** (see A2 / A6).

### Explicitly NOT this persona (covered elsewhere / future)

- **PL sellers shipping on their own carrier contract (P1)** — covered by [#727](https://github.com/openlinker-project/openlinker/issues/727)
- **Allegro One Fulfillment** (Allegro-stored, fulfilled-by-Allegro inventory) — separate Allegro program, distinct API surface, out of scope
- **International / non-PL shipping** — separate future workstream

---

## 3. Evidence & user research

> **Phase B — 2026-05-25.** External API/competitor research by `product-researcher` subagent (cited below); OL-side facts by codebase audit. Confidence flags preserved: `confirmed-by-docs` / `partial` (extracted, verify in `swagger.yaml`/sandbox) / `needs-sandbox-probe`.

### 3.1 `/shipment-management/*` API surface — viable, async-command-based

The resource family is real (replaced `/parcel-management/*`, shut off 2025-01-31) and covers every v1 need. Confirmed endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /shipment-management/delivery-services` | The seller's **Allegro-Delivery-eligible** services (`deliveryMethodId`, `carrierId`, `additionalServices[]`) |
| `POST /shipment-management/shipments/create-commands` | **Async** create (client `commandId` UUID for idempotency) |
| `GET .../shipments/create-commands/{commandId}` | Poll create result (`Retry-After`-paced) |
| `GET /shipment-management/shipments/{shipmentId}` | Read shipment state (`packages[].transportingInfo[]` → `carrierId`, `carrierWaybill`) |
| `POST .../shipments/cancel-commands` + poll | Async cancel/void |
| `POST /shipment-management/label` | Label PDF (`shipmentIds[]`, `pageSize`) |
| `POST /shipment-management/protocol` | Dispatch/handover protocol PDF |
| `POST .../pickup-proposals`, `.../pickups/create-commands` | Courier pickup scheduling |

Auth = same OAuth; dedicated scopes `allegro:api:shipments:read/write` (`partial`). **Design constraint (Tier 2):** create is **async** (POST command → poll status), *not* a synchronous "create → get label." Confidence: paths `confirmed-by-docs`; exact field/enum spellings `partial` (verify in `swagger.yaml`). Sources: [tutorial](https://developer.allegro.pl/tutorials/jak-zarzadzac-przesylkami-przez-wysylam-z-allegro-LRVjK7K21sY), [news](https://developer.allegro.pl/news/udostepnilismy-nowe-zasoby-do-tworzenia-i-zarzadzania-przesylkami-w-ramach-wysylam-z-allegro-BvGe1loe7tk), [allegro/allegro-api#12047](https://github.com/allegro/allegro-api/issues/12047).

### 3.2 Carrier-neutral — one API, per-carrier quirks (A1 ✅)

**One unified API across all Allegro Delivery carriers** (Allegro One Box/Punkt/Kurier, InPost-via-Allegro, DPD, DHL, ORLEN, Packeta, UPS, Poczta) — carrier selected via `deliveryMethodId`. **But not "write once, identical":** per-carrier `additionalServices`/`additionalProperties` (InPost `sendingMethod` → neutral `sendingAtPoint` from 2026-03-01), batch limits (DPD/WEDO ~10 `partial`), Allegro One sender-zip service-area validation that errors on create. **Don't hardcode a carrier list — read `/delivery-services` per seller.** Confidence: single-API `confirmed-by-docs`; per-carrier keys `partial`.

### 3.3 Delivery-method taxonomy + the load-bearing namespace question (A2/A6)

Order carries `delivery.method.id` (UUID) + `delivery.method.name` (e.g. `"Allegro Paczkomaty InPost 24/7"`). **There is NO documented boolean flag** marking a method as Allegro-Delivery-eligible. The robust eligibility signal = **order `delivery.method.id` ∈ the `GET /shipment-management/delivery-services` set**. ⚠️ **#1 sandbox probe:** whether `delivery.method.id` shares a namespace with `delivery-services[].deliveryMethodId` is **unconfirmed** and is the riskiest assumption in the whole design.

**OL-side (codebase):** OL already extracts `delivery.method.id/name → OrderShipping.methodId/methodName` (`AllegroOrderSourceAdapter.resolveShipping`) and already fetches a *different* catalogue, `GET /sale/delivery-methods` (`listDeliveryMethods()`, #474/#496), used today for carrier-mapping dropdown labels. **Two distinct endpoints** (`/sale/delivery-methods` = label catalogue; `/shipment-management/delivery-services` = Allegro-Delivery-eligible set) — reconciling them, and whether the compatibility key is the *seller's dynamic delivery-services set* (not a static modality), is the **compatibility-granularity Phase C question**, now sharpened. Confidence: field paths `partial`; namespace equality `needs-sandbox-probe`. Sources: [orders tutorial](https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR); codebase `allegro-order-source.adapter.ts:301`, `allegro-api.types.ts:718`.

### 3.4 Pickup point on the order — already wired, guard for nulls (A3 ✅)

`delivery.pickupPoint` (`id`, `name`, `description`, `address`) is present for pickup-point methods, **shared shape across carriers** (Allegro One Box, InPost, ORLEN). **OL already extracts it** (`resolvePickupPoint`, `delivery.pickupPoint.address` since #458). Caveats (live GitHub issues): Allegro One Box point data has had accuracy bugs ([#6492](https://github.com/allegro/allegro-api/issues/6492)); ORLEN format churned post-2026-02-13 ([#13059](https://github.com/allegro/allegro-api/issues/13059)); `pickupPoint`/`cost` can be **null at `FILLED_IN`** ([#3186](https://github.com/allegro/allegro-api/issues/3186)) → guard + re-fetch. Confidence: shape `partial`; instability `confirmed-by-docs`; always-present `needs-sandbox-probe`.

### 3.5 `smartDeliveryMethods` deprecation — non-issue for shipping (A5 ✅ RESOLVED)

Confirmed via canonical [allegro/allegro-api#13334](https://github.com/allegro/allegro-api/issues/13334): the deprecation is **offer-side** (`GET /sale/offers/{id}/smart`), removing `smartDeliveryMethods` / `passed`/`failedDeliveryMethods` (empty arrays 2026-05-28, removed 2026-07-28). **Shipment label generation does NOT depend on it.** And the OL-side audit shows **OL already omits those fields** (`allegro-api.types.ts:770-772` — "intentionally omitted — slated for removal 2026-07-28"). So A5 is a **non-issue for #732** and even for OL's smart-classification reader. The 2026-07-28 "timing pressure" from Phase A is **dropped**. Confidence: `confirmed-by-docs`.

### 3.6 Status is poll-based, not webhook — fits OL's cursor pattern (A7)

**No webhook** for `/shipment-management` shipment-status. Poll create-command status + `GET /shipments/{id}` + `GET /order/carriers/{carrierId}/tracking`. The **order event journal** (`GET /order/events`) carries `FULFILLMENT_STATUS_CHANGED` (`partial`) — order-fulfillment, not carrier state. **Maps cleanly onto OL's existing cursor-poll pattern** (offer-status sync #816, order events). **Branch-1 status (A7):** Allegro tracks only shipments it brokered, so a PS-fulfilled order's shipment status still comes from **PS read-back** (or, coarsely, the Allegro fulfillment status if the operator set it) — exact source remains a Tier-2 detail, but no Allegro shipment-webhook exists to lean on. Confidence: poll-not-webhook `confirmed-by-docs`; event names `partial`.

### 3.7 Dispatch / "mark as sent" is an explicit step (A8 ✅)

Creating a shipment does **NOT** auto-mark the order sent. Two separate order-side calls: `PUT /order/checkout-forms/{id}/fulfillment` (`NEW · PROCESSING · READY_FOR_SHIPMENT · SENT · READY_FOR_PICKUP · PICKED_UP`, `partial`) and `POST /order/checkout-forms/{id}/shipments` (attach `carrierId` + `waybill`). Full flow: **create-shipment → poll → attach waybill → set fulfillment `SENT`**. So **v1 must perform an explicit dispatch step**; whether OL auto-sets `SENT` on label creation or leaves it to the operator is a **product decision** (Phase C / A8). Note: this is also the **same propagation path branch 2 (#727) uses** to push shipped+tracking back to Allegro — a shared Allegro-order capability, not branch-specific. **OL-side:** OL's existing Allegro order-status type is the *checkout* enum (`BOUGHT · FILLED_IN · READY_FOR_PROCESSING · CANCELLED`) — **fulfillment status is a separate axis OL doesn't model yet**. Confidence: separate-calls `confirmed-by-docs`; enum set `partial`; metric timing `needs-sandbox-probe`. Source: [orders tutorial](https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR).

### 3.8 Label formats (A4)

`POST /shipment-management/label` → PDF, `pageSize` A4/A6; **ZPL/thermal is chosen at *create* time** (`labelFormat` in create body, immutable after). Open bugs: A6 sometimes returns A4 ([#10120](https://github.com/allegro/allegro-api/issues/10120)); render glitches with cutline ([#9942](https://github.com/allegro/allegro-api/issues/9942)). Confidence: A4/A6 + ZPL-at-create `confirmed-by-docs`; per-carrier matrix `needs-sandbox-probe`.

### 3.9 Competitor pattern — validates OSS positioning

BaseLinker / Base.com implements "Wysyłam z Allegro" as a standard per-account courier integration: create+print labels, **dispatch manifest (protokół)**, cancel, **courier pickup**, buyer sees tracking. **Billing is settled with Allegro** (no separate carrier contract — that's the program's point); BaseLinker is a *control surface*, not the biller (own surcharge `needs-confirmation`). Apilo/Sellasist similar (`partial`). **Takeaway:** label-making is table-stakes; OL's differentiator is **no per-shipment SaaS markup + data ownership**. **Competitors set the expectation that manifest + pickup + cancel ship together** — a real v1-scope question (Phase C/D). Sources: [base.com help](https://base.com/pl-PL/pomoc/wiedza/wysylam-z-allegro/), [baselinker integracje](https://baselinker.com/pl-PL/integracje/allegro/allegrokurier/).

### 3.10 Phase B impact on Phase A decisions

| Decision | Phase B impact |
|---|---|
| **A1** carrier-neutral | ✅ Confirmed — one API; per-carrier quirks are adapter-internal detail |
| **A2/A6** compatibility/routing | ✅ Strengthened — eligibility = order method ∈ seller's `/delivery-services`; compatibility key is likely **dynamic/seller-scoped**, not static modality. ⚠️ namespace-equality probe is the top risk |
| **A3** pickup read | ✅ Confirmed + **already wired** in OL; add null-at-`FILLED_IN` guard + re-fetch |
| **A4** v1 cuts (mirror #727) | ✅ Holds. Note competitor parity pressure on manifest/pickup (3.9) — revisit at Gate C/D |
| **A5** `smartDeliveryMethods` | ✅ **Resolved — non-issue.** Offer-side only; OL already omits the fields. 2026-07-28 timing pressure dropped |
| **A7** branch-1 status | Poll-based; no Allegro shipment webhook; branch-1 = PS read-back. Tier-2 detail |
| **A8** explicit dispatch | ✅ Confirmed **yes** — explicit `fulfillment` + waybill-attach; auto-vs-operator is a Phase C product call |

### 3.11 Open questions → Phase C / sandbox probes

- **OQ-B1 (top risk):** does order `delivery.method.id` share a namespace with `/shipment-management/delivery-services[].deliveryMethodId`? Eligibility detection rests on this. `needs-sandbox-probe`.
- **OQ-B2:** exact field/enum spellings (create-command body, fulfillment-status set, command-status enum) — verify in `swagger.yaml`/sandbox.
- **OQ-B3:** per-carrier `additionalServices`/`additionalProperties` + Allegro One sender-zip validation behaviour.
- **OQ-B4:** A6/thermal label reliability (open A6→A4 bug) if thermal is a requirement.
- **OQ-B5:** does OL auto-set fulfillment `SENT`, and how does that interact with Allegro's on-time-dispatch seller metric?
- **OQ-B6 (scope):** v1 feature parity vs competitors — label-only, or manifest + pickup + cancel together?

## 4. Solution exploration

> **Phase C — 2026-05-25.** Phase A pre-settled the architecture skeleton (one `ShippingProviderManagerPort` capability + per-connection adapters; compatibility-declared routing; unified status; #732 owns the routing model, #727 retrofits). So the live Phase C choice is the **v1 scope + sequencing shape** and the **competitor-parity cut**, not the mechanism.

### 4.1 Candidate shapes

| Shape | What ships in v1 | Effort | Trade-off |
|---|---|:---:|---|
| **1 — Label-only, routing-lite** | Minimal routing (extend `CarrierMapping` with a processor axis, just enough to send Allegro methods to the Allegro Delivery processor; branch-1 unchanged; #727 wiring deferred). Allegro Delivery adapter: create→label→track(poll)→cancel + auto-dispatch. Reuse #727 FE. | ~M | Fastest to the #732 user value, but **under-delivers the Phase A "general routing model"** and defers the cross-cutting foundation + #727 convergence — risks needing a rework when #727/future sources land. |
| **2 — Routing foundation + Allegro Delivery processor (label-only)** ⭐ | The **general routing/compatibility model** (`Source × Method × Processor × OMP`, compatibility from `/delivery-services`) + **unified status incl. branch-1 read-back** as the foundation. Allegro Delivery adapter (create→label→track→cancel + explicit dispatch). #727 InPost retrofits; branch-1 PS read-back. Full #727-style FE (per-order Shipment panel, `/shipments`, cancel/re-issue, capability-conditional, trigger model). | ~L | Delivers the committed Phase A scope; high leverage; clean #727 convergence. Larger — the foundation is most of the work. Honest v1 cuts (no manifest/pickup/bulk). |
| **3 — Full "Wysyłam z Allegro" parity** | Shape 2 **+ dispatch protocol (protokół) + courier pickup scheduling**. | ~XL | Closes the perceived gap vs BaseLinker day one — but **contradicts A4** (#727-aligned cuts), and manifest/pickup are #732's own stated v2 candidates. Scope-creep risk on an already-XL initiative. |
| **4 — Do nothing** | P2/P3 sellers keep using the Allegro seller panel for labels. | 0 | Leaves the Q1 wedge broken for the growing Allegro Delivery segment; OL stays half a product for them. Contradicts the whole #732 rationale. |

### 4.2 Comparison

- **Problem fit:** Shapes 2 & 3 fully solve it; Shape 1 solves the surface symptom but leaves the foundation half-built; Shape 4 doesn't.
- **Persona fit:** the operator just wants "ship my Allegro Delivery orders from OL." All of 1/2/3 deliver that; manifest/pickup (3) matter more for *courier* methods than for *locker drop-off* (One Box) — and the persona skews locker-heavy.
- **Strategic fit:** Shape 2 best — it builds the **general multi-source/processor/OMP routing** the maintainer explicitly asked for, with Allegro Delivery as the proving case and #727 converging onto it. Shape 1 accrues debt against that vision.
- **Risk:** Shape 3's scope-creep + Shape 1's rework-debt are the main risks; Shape 2 balances them. The cross-cutting OQ-B1 (delivery-method namespace) probe applies equally to 1/2/3.

### 4.3 Recommendation (not a decision)

**Shape 2.** It honours the Phase A commitment (general routing model + Allegro Delivery processor + #727 convergence + unified status), leverages the #727 groundwork that's already in flight, and keeps honest v1 cuts (manifest/pickup/bulk deferred) consistent with A4. The competitor-parity items from §3.9 (manifest, courier pickup) are tracked as PD **[#831](https://github.com/openlinker-project/openlinker/issues/831)** (v2 parity), fast-tracked if design-partner demand surfaces — cheap because Shape 2's groundwork (create/label/cancel, dispatch, status) carries them.

**The one product call to confirm at Gate C:** the **v1 parity cut** — label-only (Shape 2) vs include manifest + pickup (Shape 3)? My read: **label-only**, because (a) the locker-skewed persona needs manifest least, (b) it matches A4 + #732's own out-of-scope, (c) it keeps an XL initiative from sliding to XXL. But it's a real call given competitors bundle them.

### 4.4 Success-metric direction (→ Stage-1 DoD in Phase D)

Qualitative, to be finalised in Phase D: a P2/P3 seller generates an **Allegro One / Allegro Delivery label from inside OL** without touching the Allegro panel; the **routing config** lets an operator point each Allegro delivery method at the right processor (with incompatible ones not offered); the **#727 InPost path runs on the same routing model**; **shipment status is visible in OL across all branches** including PS-fulfilled.

### 4.5 "Do nothing" — honest evaluation

Already covered as Shape 4: cuts OL out of the Allegro Delivery segment (growing, Smart!-incentivised), leaving the Q1 wedge structurally incomplete for those sellers. Not viable if #732's premise holds.

## 5. Product specification

> **Phase D — 2026-05-25.** Shape 2, label-only. User-visible only; engineering AC (async command polling, exact Allegro endpoints/fields, retry, migrations) belongs in Tier-2 plans.

### 5.1 User stories

**US-1 — Configure shipment routing**
> As an operator, I want to map each **Allegro delivery method** to a **fulfillment processor** (PrestaShop / my own InPost / Allegro Delivery) and a destination, choosing only from processors *compatible* with that method, so that each order ships the right way without per-order decisions.

**US-2 — Generate an Allegro Delivery / Allegro One label from OL**
> As a P2/P3 seller, I want to generate a "Wysyłam z Allegro" label for an Allegro order inside OL, so that I never leave OL to ship via Allegro Delivery / Allegro One.

**US-3 — Auto-filled pickup point**
> As an operator, I want the buyer's chosen Allegro One Box/Punkt (or other pickup point) pre-filled from the order, so that I don't re-enter it.

**US-4 — Configure when shipments are created**
> As an operator, I want to choose per-connection whether shipments are created manually or automatically (on paid / on shipped), so that it matches my shop's workflow.

**US-5 — Dispatch: mark sent + tracking back**
> As an operator, I want OL to attach the waybill and mark the Allegro order sent once it's dispatched, so that the buyer sees tracking and I don't update Allegro by hand.

**US-6 — Cancel + re-issue**
> As an operator, I want to cancel a not-yet-dispatched Allegro Delivery shipment and re-issue it (e.g. buyer changed the pickup point), so that I can fix mistakes within OL.

**US-7 — Unified shipment status across all branches**
> As an operator, I want one `/shipments` view showing every shipment's status + tracking — whether OL shipped it via Allegro Delivery, via my own InPost, or PrestaShop fulfilled it — so that I have a single pane for what's shipped / pending / failed.

**US-8 — Capability-conditional UI**
> As an operator without an Allegro Delivery connection, I want to NOT see Allegro Delivery / Allegro One terminology, so that PL-specific concepts don't clutter my UI.

### 5.2 Acceptance criteria

**AC-1** (US-1): A shipment-routing config screen lists the seller's Allegro delivery methods; per method the operator picks a **processor from only the compatible options** + an **OMP destination** (and, for the PS-fulfilled branch, the destination carrier). Saving persists per connection; incompatible processors are never offered (e.g. Allegro One shows only Allegro Delivery).

**AC-2** (US-2): An order's **Shipment panel** shows a "Generate label" action for orders routed to Allegro Delivery. Triggering it creates the shipment via Allegro and returns a **downloadable label PDF**; because creation is asynchronous, the panel shows a clear pending/working state until the label is ready, then status → `generated`. Failures surface a readable reason (e.g. sender-zip outside the Allegro One service area).

**AC-3** (US-3): Allegro One / pickup-point orders show the buyer's pickup point **pre-filled** from the order — no picker needed. If pickup data isn't yet available at ingest, the panel shows a clear "pickup not yet available — retrying" state rather than failing silently.

**AC-4** (US-4): Connection settings include a **trigger** dropdown (`Manual` / `Auto on paid` / `Auto on shipped`); the selection persists and affects only future orders.

**AC-5** (US-5): When a shipment is **dispatched**, OL attaches the waybill to the Allegro order and marks it **sent** (buyer sees tracking), and propagates tracking + status to PrestaShop. Whether dispatch happens automatically on label generation or as an explicit "Mark as sent" action follows the connection's trigger setting.

**AC-6** (US-6): While a shipment is `generated` (not yet dispatched), a **"Cancel + re-issue"** action voids the Allegro Delivery shipment and re-opens generation (e.g. against a new pickup point).

**AC-7** (US-7): A `/shipments` page lists shipments **across all branches** with status, **processor** (Allegro Delivery / OL-InPost / PrestaShop), tracking, and order link; filters by status, date, processor, has-tracking; PS-fulfilled rows show **read-back** status. Click-through to order detail.

**AC-8** (US-8): If no connection in the instance declares an Allegro-Delivery shipping capability, Allegro Delivery / Allegro One terminology does **not** appear anywhere in the UI (same capability-conditional pattern as #727).

## 6. Out of scope

> **Phase D — 2026-05-25.** Top items someone might actually ask about (Stage-1 cap).

| Item | Reason |
|---|---|
| **Dispatch manifest / protocol (protokół)** | Shape-2 cut → tracked as PD **[#831](https://github.com/openlinker-project/openlinker/issues/831)** (v2 parity). Cheap on Shape 2's groundwork. |
| **Courier pickup scheduling** | Shape-2 cut → tracked as PD **[#831](https://github.com/openlinker-project/openlinker/issues/831)** (v2 parity). Locker-skewed persona needs it least. |
| **Bulk label generation** | v2 (mirrors #727 A5). Manual per-order in v1. |
| **COD (Cash on Delivery)** | v2 (mirrors #727 A6) — return-of-funds + accounting complexity. |
| **Operator fulfillment-workflow statuses** (packed / picking / waiting-for-carrier) | Separate OMS concern → **[#827](https://github.com/openlinker-project/openlinker/issues/827)**. #732 keeps the three status axes separable so it plugs in later. |
| **Allegro Delivery for PrestaShop-direct orders** | Structurally impossible — a "Wysyłam z Allegro" shipment needs an Allegro checkout form. PS-direct orders ship via #727 or PS. |
| **Allegro One Fulfillment / returns** | Separate Allegro program / separate returns workstream. |

## 7. Definition of done

> **Phase D — 2026-05-25.** Stage-1 qualitative bullets (no metric theatre).

The feature is successfully delivered when:

- A **P2/P3 seller generates Allegro Delivery / Allegro One labels from inside OL** for ≥30 days without falling back to the Allegro seller panel for routine shipments.
- **≥2 design-partner shops** use it in production with no "the integration is unusable" escalation.
- The **routing config** is used to point each Allegro delivery method at the right processor, and **incompatible processors are never offered** (the compatibility model proves out).
- The **#727 InPost path runs on the same routing model** — no parallel routing mechanism (convergence proven).
- The **`/shipments` view shows shipments across all three branches**, including PS-fulfilled read-back.
- **Allegro One pickup auto-fill works**, and the buyer sees tracking without the operator updating Allegro by hand.
- **Capability-conditional rendering proves out**: a non-Allegro-Delivery deployment shows zero Allegro Delivery / One terminology.

If any prove false within 60 days of design-partner release, this Product Design returns to Phase A for re-review.

## 8. Risks

> **Phase D — 2026-05-25.** Top product-direction risks. Engineering risks (async-command orchestration, Allegro payload instability, label A6→A4 bug, rate limits) belong in Tier-2 plans.

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | **OQ-B1 wrong** — order `delivery.method.id` does *not* share a namespace with `/shipment-management/delivery-services`, breaking eligibility/compatibility detection. | **Sandbox-probe OQ-B1 first** in Tier-2; design the compatibility signal behind an abstraction so its source can change without reworking the routing model. |
| **R2** | **Perceived incompleteness vs BaseLinker** — no manifest / courier pickup in v1. | Tracked as PD [#831](https://github.com/openlinker-project/openlinker/issues/831); cheap on Shape 2's groundwork; locker-skewed persona needs manifest least; fast-track if ≥2 design partners ask. |
| **R3** | **XL scope stalls** — routing foundation + adapter + #727 convergence + branch-1 read-back is a lot. | Phase E slices into independently-shippable issues; ship the routing foundation first, the Allegro Delivery adapter behind it; branch-1 read-back can land last. |
| **R4** | **#727 coordination** — #727's FE (#769/#771) is mid-flight; if it ships a parallel routing/settings UI before #732's foundation, rework. | Gate A decision (a): #727 FE **aligns with / waits on** #732's routing foundation; sequence the foundation early and communicate to the #727 work. |

## 9. Implementation breakdown

> **Phase E complete — 2026-05-25. Gate D = YES (build).** Eight implementation issues, foundation-first (per R3). Each is independently shippable; engineering detail lives in each issue + Tier-2 `/plan`.

| # | Issue | Layer | Effort | Blocked by |
|---|---|---|:---:|---|
| E1 | [#832](https://github.com/openlinker-project/openlinker/issues/832) — fulfillment-routing model + compatibility (**+ branch-1 ADR**) | Core | L | — |
| E2 | [#833](https://github.com/openlinker-project/openlinker/issues/833) — Allegro Delivery shipping adapter (`/shipment-management/*`) | Integration (allegro) | L | #832 |
| E3 | [#837](https://github.com/openlinker-project/openlinker/issues/837) — order-side dispatch (fulfillment `SENT` + waybill) + tracking propagation | Integration (allegro) | M | #833 |
| E4 | [#838](https://github.com/openlinker-project/openlinker/issues/838) — shipment-status poll sync (cursor, #816 mold) | Core + worker | M | #832, #833 |
| E5 | [#834](https://github.com/openlinker-project/openlinker/issues/834) — branch-1 (PS-fulfilled) status read-back | Core + integration (ps) | S–M | #832 |
| E6 | [#835](https://github.com/openlinker-project/openlinker/issues/835) — #727 InPost convergence onto the routing model | Core + integration | S–M | #832 |
| E7 | [#836](https://github.com/openlinker-project/openlinker/issues/836) — routing-config FE | Frontend | M | #832 |
| E8 | [#839](https://github.com/openlinker-project/openlinker/issues/839) — Allegro Delivery FE surface (extends #727 #769/#770/#771) | Frontend | M | #833, #836 |

**Critical path:** #832 → #833 → {#837, #838, #839}; #834 / #835 / #836 parallelize off #832.
**Top Tier-2 action:** sandbox-probe **OQ-B1** (delivery-method namespace) before committing #833's eligibility design.
**Deferred scope (separate PDs):** [#831](https://github.com/openlinker-project/openlinker/issues/831) (manifest + courier pickup — v2 parity), [#827](https://github.com/openlinker-project/openlinker/issues/827) (operator workflow statuses).

---

## Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-05-25 | Setup | Refinement opened in worktree `732-allegro-delivery-shipment-refinement`. Spec skeleton created; Phase A drafted. | #732 confirmed `product-design` labelled; no prior spec/sub-issues/comments — refinement untouched. `pnpm install` skipped (doc-only refinement). | @piotrswierzy (assisted) |
| 2026-05-25 | A | Reframed Phase A around the **3-branch fulfillment-routing model** (PS-fulfilled / OL-own-contract / OL→Allegro) after maintainer clarification. Verified branch 1 exists today (`CarrierMapping` = `allegroDeliveryMethodId → prestashopCarrierId`, no fulfillment-target axis). Added scope constraint: #732 = Allegro-sourced orders only. Routing-config home flagged as cross-cutting with #727. | Maintainer surfaced the three real order/shipment scenarios; grounded against `libs/core/src/mappings`. | @piotrswierzy |
| 2026-05-25 | A | **A6 resolved: routing model is part of #732.** Added two routing refinements: (1) OL surfaces shipment status across **all** branches incl. branch-1 read-back; (2) routing is **constrained** — some source methods (Allegro One) force branch 3. Leading Phase-C candidate recorded: 4-axis mapping UI (`Source × Method × Processor × OMP`). Scope-growth + #727 coordination flagged. | Maintainer: "Part of 732"; Allegro One has no own-contract/PS-carrier option; proposed the 4-axis mapping shape. | @piotrswierzy |
| 2026-05-25 | A | **Generalized the routing model — NOT Allegro↔PS-specific.** Three branches reframed as source/carrier/OMP-agnostic *processor kinds* (OMP-fulfilled / OL-managed carrier / source-brokered); Allegro+PS+InPost are today's instances. Discipline: design generic, implement only real connections. **Gate A decision (a) confirmed:** #732 defines routing model, #727 retrofits onto it. | Maintainer: "should be general functionality… multiple order sources, multiple carrier/shipment integrations"; chose (a). | @piotrswierzy |
| 2026-05-25 | A/B | **Architecture check (maintainer-prompted): not 3 capabilities, 1.** Read `ShippingProviderManagerPort` (#763). Branches 2 & 3 = same port, different adapters (Allegro Delivery adapter hosted on the source connection); routing = "one capability, many adapters, per-connection resolution," not 3-way. Branch 1 (OMP-fulfilled) is the only fork: degenerate-adapter vs delegate-to-OMP+status-reader — **deferred to Tier-2 ADR**, not the product spec. | Maintainer: "Shouldn't each be a separate implementation of the same OL capability? … Are we really just having a 3-way routing? Check the architecture." | @piotrswierzy |
| 2026-05-25 | A | **Operator fulfillment-workflow statuses (packed/picking/waiting-for-carrier) → OOS, deferred to new PD [#827](https://github.com/openlinker-project/openlinker/issues/827).** Cross-cutting OMS concern, not Allegro-specific; shipment `generated` already covers "packed/awaiting dispatch". #732 must keep shipment-status / order-status / future workflow-status as **3 separable axes** so #827 plugs in without rework. | Maintainer: "OOS but have in mind that it will be there and design around it… create a design issue for it." | @piotrswierzy |
| 2026-05-25 | A | **Added illustrative end-to-end flows (A/B/C/D)** + a **"dispatch decomposed"** table after maintainer asked "where/how is the shipment dispatched?". Clarified OL never does physical handover; OL's active role = create-label (branches 2/3) + status propagation; protocol/manifest = v1-out-of-scope; `dispatched` = observed. New open question (A8): does v1 need an explicit "Dispatch / Mark as sent" action distinct from "Generate label"? | Maintainer: "Showcase a few end-to-end flows"; "where/How is the Shipment dispatched? Where does that process live?" | @piotrswierzy |
| 2026-05-25 | A/B | **No forced rules — compatibility-declared configuration.** Routing is fully operator-configurable, constrained only by adapter-declared compatibility (`getSupportedMethods()` seed). "Allegro One → Allegro Delivery" emerges from compatibility, not a hardcoded rule. Added terminology glossary distinguishing OL's three conflated concepts: source delivery method (`OrderShipping.methodId`, the routing key) vs destination carrier (`prestashopCarrierId`/`CarrierMapping`) vs shipping modality (`ShippingMethod` = paczkomat\|kurier). Flagged compatibility-key **granularity** as a Phase C question (coarse modality is insufficient). | Maintainer: "everything should be configurable, but we should know which implementations are compatible with which shipping methods"; "what's the difference between shipping method and carrier?" | @piotrswierzy |
| 2026-05-25 | Gate A | **Gate A PASSED — Phase A locked.** Problem, persona, and ambiguities A1–A8 confirmed (interpretations stand pending Phase B verification). Proceeding to Phase B research. | Maintainer: "start phase B". | @piotrswierzy |
| 2026-05-25 | D | **Shape 3 deferred-scope (manifest + courier pickup) filed as PD [#831](https://github.com/openlinker-project/openlinker/issues/831).** Mirrors #827 treatment — deferred parity scope tracked as a refinement candidate, fast-tracked on design-partner demand (R2). | Maintainer: "What about Shape 3… do we have a product design issue for that?" | @piotrswierzy |
| 2026-05-25 | Gate D / E | **Gate D = YES (build).** Spawned 8 impl issues #832–#839 (foundation-first), linked under #732; #732 closed as refinement-complete. Spec committed. | Maintainer: "yes" (commit) + confirmed E1–E8 slicing. | @piotrswierzy |
| 2026-05-25 | D | **Phase D spec written** — 8 user stories, 8 user-visible acceptance criteria, 7 out-of-scope items, qualitative Stage-1 DoD, 4 product-direction risks. Status → pending Gate D. | — | @piotrswierzy |
| 2026-05-25 | Gate C | **Gate C PASSED — Shape 2** (routing foundation + Allegro Delivery processor, **label-only**). Manifest + courier pickup → v2 fast-follow. Proceed to Phase D. | Maintainer: chose Shape 2; confirmed label-only parity cut. | @piotrswierzy |
| 2026-05-25 | B | **Phase B research complete** (`product-researcher` subagent + codebase audit). Resolved: A1 (carrier-neutral ✅), A3 (pickup already wired in OL ✅), A5 (`smartDeliveryMethods` offer-side only — non-issue; OL already omits fields ✅ — **2026-07-28 timing pressure dropped**), A8 (explicit dispatch step ✅). New findings: API is **async command-based**; status is **poll-not-webhook** (fits OL cursor pattern); **eligibility = order method ∈ `/delivery-services`** with the `delivery.method.id` namespace as the **#1 sandbox probe (OQ-B1)**; competitors ship manifest+pickup+cancel together (v1-scope pressure). See §3. | — | @piotrswierzy + subagent |
