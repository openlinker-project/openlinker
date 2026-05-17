# Product Spec — #727 InPost integration

**Status:** phase A-E complete; Gate D = YES (build); refinement closed 2026-05-17; ready for implementation (impl tracked via #763-#772)
**Parent issue:** [#727](https://github.com/SilkSoftwareHouse/openlinker/issues/727)
**Started:** 2026-05-17
**Last updated:** 2026-05-17
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

---

## 1. Problem

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-17**

### Problem statement

PL e-commerce overwhelmingly uses **InPost** (Paczkomaty + Kurier InPost) as the dominant shipping method — it's the de facto last-mile standard for PL D2C commerce. OpenLinker today has **zero** courier/shipping integration. For PL shops, this means OL is a half-product: orders come in, but operators must leave OL to ship them.

Today's shop-owner workflow per shipment:
1. See order in OL
2. **Leave OL** → log into InPost Manager / ShipX panel
3. Re-enter customer + paczkomat data
4. Generate label
5. Copy tracking number
6. Paste tracking back into Allegro + PrestaShop manually

For a typical shop with 10-50 shipments/day, this is **2-4 operator-hours/day of manual context-switching** between OL and InPost. Errors (wrong paczkomat copy-pasted, tracking number forgotten) compound.

This blocks the **Q1 wedge promise** of "complete end-to-end workflow inside OL". Without InPost (P1 = own-contract carrier path per [#726](https://github.com/SilkSoftwareHouse/openlinker/issues/726) Phase B research), OL is a sync tool, not an orchestration platform — the "I bring my orders in, ship them, and let OL handle the rest" loop is broken at the shipping step.

### Why now

- **Q1 wedge timing** — needs all three legs (listings ✅ refined, invoicing ✅ refined, shipping ❌ blocking)
- **Sibling issue [#732](https://github.com/SilkSoftwareHouse/openlinker/issues/732)** covers P2/P3 sellers via Allegro Delivery; #727 covers P1 sellers via own-contract InPost. Both needed for full PL market coverage.
- **No fiscal urgency** like KSeF for #728 — but waiting more means shops continue using BaseLinker for shipping and resist switching their other workflows to OL.

### Gate A resolutions (2026-05-17)

All six ambiguities resolved per maintainer's hypothesis confirmations:

| ID | Decision | Implication |
|---|---|---|
| **A1** | **Single InPost account per OL deployment** | Matches solo-shop primary persona; multi-account deferred to v2 if agency-operator demand surfaces. Connection config takes one set of InPost credentials. |
| **A2** | **All three paczkomat-selection flows in v1** | (1) Read paczkomat ID from Allegro paczkomatowa order payload, (2) read from PrestaShop module payload, (3) operator-manual picker UI for orders without buyer's choice. Picker UI uses InPost ShipX paczkomat search. |
| **A3** | **ShipX REST API as primary integration target** | Modern OAuth-based REST. No InPost Manager portal scraping. Manager web UI remains the seller's account-management surface (configured outside OL). |
| **A4** | **PL domestic InPost only in v1** | Paczkomaty 24/7 + Kurier InPost domestic. CZ/SK/IT international is v2 if demand emerges. Matches PL-only persona target. |
| **A5** | **Manual per-order label generation in v1; bulk = v2** | Persona's 10-50 shipments/day pace fits manual one-at-a-time. Bulk becomes important at 100+/day. v2 candidate if real volume + demand. |
| **A6** | **COD (Cash on Delivery) OUT in v1** | Adds material complexity (return-of-funds flow, COD-specific UI fields, accounting integration). v1 = prepaid shipments only. v2 if PL shops can't operate without it (some rely on COD heavily — would need real signal). |

---

## 2. Affected persona

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-17**

### Primary persona: PL shop owner with own InPost contract (P1)

- **Role:** in-house operator at a PL e-commerce shop (same primary persona as [#726](https://github.com/SilkSoftwareHouse/openlinker/issues/726), [#728](https://github.com/SilkSoftwareHouse/openlinker/issues/728))
- **Company size:** 1–30 people
- **Volume:** 100–1,000 SKUs; 10–200 orders/day, ~70-90% shipping via InPost (paczkomat dominant, kurier secondary)
- **Sophistication:** operator-level — comfortable with admin UIs, NOT technical
- **Geography:** PL only (domestic InPost coverage; international shipping is separate workstream)
- **Existing InPost setup:** has own B2B agreement with InPost, has their own paczkomat/kurier rates negotiated, generates labels today via InPost Manager web UI

### Explicitly NOT covered by #727 (covered elsewhere or future)

- **PL sellers on Allegro Delivery (P2/P3)** — covered by [#732 Wysyłam z Allegro integration](https://github.com/SilkSoftwareHouse/openlinker/issues/732)
- **Non-InPost couriers** (DHL, DPD, ORLEN Paczka, GLS, FedEx) — separate future PDs per courier, each plugin-as-adapter against the same shared port
- **International shipping** (CZ/SK/IT InPost, international courier) — v2 / separate future PDs
- **Allegro One delivery methods** (Box / Punkt / Kurier) — covered by [#732](https://github.com/SilkSoftwareHouse/openlinker/issues/732) (P3 = subset of P2)

---

## 3. Evidence & user research

> **Phase B complete — 2026-05-17**. Conducted by `product-researcher` subagent + codebase audit.

### 3.1 ShipX REST API surface — confirmed viable

- **Base URLs**: production `https://api-shipx-pl.easypack24.net`; **sandbox** `https://sandbox-api-shipx-pl.easypack24.net` (separate token from `sandbox-manager.paczkomaty.pl/`)
- **Auth**: OAuth 2.0 / 2.1 client-credentials. Self-service token generation from Manager portal for typical setups; integration team contact for advanced
- **Endpoints covering v1 scope:**
  - `POST /v1/organizations/:organization_id/shipments` — create shipment (parcel-locker / courier / Allegro InPost)
  - Label download — PDF, **up to 100 shipments per request** (bulk is essentially free at the API level — v2 bulk UX is a thin overlay)
  - `GET /v1/points` — paczkomat search (for the manual-picker flow per A2)
  - Tracking resource per shipment id
  - Status-management endpoint for cancel before label
- **Rate limits**: NOT publicly documented. Forum chatter mentions throttling exists; conservative client posture (jittered retry, 429-aware) — same shape as Allegro adapter.

Sources: [API ShipX Confluence](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/622754/API+ShipX), [Sandbox](https://dokumentacja-inpost.atlassian.net/wiki/spaces/PL/pages/28639247), [InPost Developers Portal — Authentication](https://developers.inpost-group.com/authentication), [imper86/php-inpost-api reference SDK](https://github.com/imper86/php-inpost-api).

### 3.2 Webhooks — fit OL infrastructure cleanly

- **Webhooks exist** for shipment-status changes
- **Signature scheme**: `x-inpost-signature` + `x-inpost-timestamp` headers, HMAC-SHA256 (or RSA), signed payload `{timestamp}.{body}` — **matches OL's existing pattern (#711) almost exactly**. Adapter work is small.
- **Replay protection**: timestamp is in signed payload — OL's existing replay-window enforcement plugs in directly.
- **Provisioning friction**: webhook setup is **manual via InPost account manager / integration team today**. Self-service portal "under development". Document this in v1 setup runbook; don't promise self-service.
- **Event-type catalogue**: not fully enumerated publicly — obtain from InPost during sandbox onboarding.

Sources: [Webhook Signature Verification](https://developers.inpost-group.com/webhook-signature-verification), [Webhooks](https://developers.inpost-group.com/webhooks).

### 3.3 Commercial precedents — validates OSS wedge

All major PL integrators bridge InPost via ShipX, all SaaS, all pricing per-shipment or per-month:

| Competitor | Pricing | Approach | Multi-account |
|---|---|---|---|
| BaseLinker | 89/189/389/789 PLN/mo by volume | ShipX, bulk dispatch | **Unlimited** InPost accounts, multi-sender-address support |
| Apilo | 79+ PLN/mo | ShipX | TBD |
| SellIntegro | ~50 PLN/mo per plugin | ShipX | TBD |
| Sellasist | varies | ShipX | TBD |
| presta-mod.pl, prestahelp, official InPost PS module | one-off license | ShipX (migrated from legacy paczkomaty API) | n/a (PS-side modules) |

**OL's edge confirmed**: OSS + self-hosted + zero recurring fee + capability-native UI. Real differentiation, not just feature parity.

Sources: [BaseLinker InPost integration](https://baselinker.com/en-US/integrations/shopee/inpostkurier), [PL integrator comparison](https://kcmobile.pl/baza-wiedzy/porownania/baselinker-vs-inne-integratory-por%C3%B3wnanie/), [Comarch's migration to ShipX](https://pomoc.comarchesklep.pl/artykul/zmiana-api-dla-paczkomatow-inpost/).

### 3.4 PL shop owner pain signals — validate three-flow design

Recurring complaints from PS / Allegro / WP-Desk forums:

- **Label failures from missing dims, phone, invalid postcode** — most common PS InPost ticket category. Implication: **OL must front-load validation before calling ShipX**.
- **Paczkomat ID stale / disabled** — operators report submitting labels rejected because the paczkomat is temporarily closed. Implication: **cache paczkomat list with reasonable TTL; surface "paczkomat unavailable" cleanly in the manual picker**.
- **Buyer wants to change paczkomat after payment** — high-volume thread topic. Workflow today: buyer messages seller → seller cancels label → re-creates against new paczkomat. Implication: **support label-cancel + re-issue from order view**; v1 manual picker UI handles this if caught before label generation.
- **Token expiration / re-auth** — pattern OL's existing connection refresh handles.

Sources: [PrestaShop InPost forum](https://www.prestashop.com/forums/topic/631205-modu%C5%82-inpost-nie-wy%C5%9Bwietla-mapy/), [WP Desk — InPost common problems](https://www.wpdesk.pl/docs/inpost-najczestsze-problemy/), [Allegro community — paczkomat change](https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zmiana-paczkomatu-i-danych-wysy%C5%82ki-przez-kupuj%C4%85cego-po-op%C5%82aceniu/td-p/734487).

### 3.5 Multi-account real demand — A1 stands but discipline required

- **BaseLinker explicitly supports unlimited InPost accounts** (and same account multiple times, e.g. for different sender addresses per warehouse)
- **Why operators want it**: per-warehouse sender addresses, per-brand accounting separation, agency-managing-multiple-clients
- **Verdict for OL**: A1 "single account per deployment" is defensible for the **solo-shop wedge persona**, but it IS a real gap vs. BaseLinker for agencies / multi-warehouse sellers. 
- **Design discipline**: don't hard-code "the InPost connection" anywhere in core; treat it as `connectionId` from day one so v2 multi-account is an FE/registry change, not a core-refactor.

Sources: [BaseLinker multi-account InPost](https://baselinker.com/en-US/integrations/shopee/inpostkurier), [apaczka.pl — BaseLinker carrier integrations](https://www.apaczka.pl/integracje/baselinker/).

### 3.6 Allegro paczkomatowa payload — already wired in OL

`GET /order/checkout-forms/{id}` returns `delivery.pickupPoint.id` (format `LOD31A`, `POZ08A`, etc.). **OL already extracts this** in `AllegroOrderSourceAdapter.resolvePickupPoint()` and ships it on `IncomingOrder.pickupPoint` (per #458, closed). **The Allegro side of #727's three flows requires no Allegro adapter work** — only OL's invoice/shipping consumer reads from existing data.

Sources: codebase `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:318`, `libs/core/src/orders/domain/types/order.types.ts:98-126`, [Allegro Developer Portal — orders](https://developer.allegro.pl/orders/).

### 3.7 PrestaShop module — paczkomat reader GAP (critical implementation finding)

Codebase audit revealed:

- **OL's PS module sends minimal-payload outbox events**: for orders it ships only `orderId` + status IDs in `payload_json`. Full order data is *not* in webhook payload; OL's API re-fetches via PS webservice.
- **OL's PS module does NOT extract paczkomat IDs from the PS-side InPost module** — zero `paczkomat`/`pickup`/`inpost` references in the PS module's PHP code.
- **In OL's PS order processor**, `pickupPoint` is **consumed on the destination side** (Allegro orders being created in PS) — written into PS, not read from PS.
- **Where paczkomat ID lives on PS direct orders**: depends on which InPost-for-PS module the shop uses. The presta-mod.pl and official InPost modules typically write the paczkomat code into the order's shipping-address `address2` or a module-specific column on `ps_orders` / `ps_address`. **OL would need to add a PS-side reader.**

**Resolved at Gate B (2026-05-17): hybrid approach.**

PS-InPost module landscape: there isn't one "PS InPost module" — there are 4+ in the wild, each with different schemas:

| Module | Vendor | Market share |
|---|---|---|
| **InPost PS module** | InPost (official, free) | Largest |
| **InPost Paczkomaty Pro** | presta-mod.pl | Mid |
| **InPost** | prestahelp.com | Mid-small |
| **WP-Desk / Other** | various | Small |

**v1 approach:**
- **Primary path**: read paczkomat ID from **the official InPost PS module** (free, InPost-supplied, largest install base) — exact field/column TBD during implementation
- **Fallback path (always available)**: manual picker UI in OL (same picker as flow #3) for shops using presta-mod, prestahelp, or other modules
- **Operator setting in connection config**: "Which InPost-for-PS module are you using?" dropdown — `Official InPost module` → auto-read, `Other / none` → manual picker only. Explicit > auto-detection (PS DB introspection is fragile)

**v1.1+ post-v1 polish:** add reader support for presta-mod.pl + prestahelp modules per real demand from design partners (each ~3 days of dev)

**v2+ optional:** publish a "PS InPost integration contract" documenting a recommended field/format so future PS InPost module authors can conform natively.

Sources: codebase `apps/prestashop-module/openlinker/openlinker.php` (payload construction at lines 1205/1281/1347-1376), `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-address-provisioner.ts`, `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts:256`.

### 3.8 Phase B impact on Phase A decisions

| Phase A decision | Phase B impact |
|---|---|
| A1 — single account per deployment | ⚠️ **Defensible but real gap vs. BL**. Don't revise; do hold design discipline (connectionId-first) for clean v2 upgrade |
| A2 — three paczkomat-selection flows | ✅ Strengthened. ShipX `/v1/points` for manual picker. Allegro flow already wired. PS flow needs new sub-task (§3.7) |
| A3 — ShipX REST as target | ✅ Strongly confirmed. Modern, sandbox available, all major competitors use it |
| A4 — PL domestic only v1 | ✅ Confirmed. Matches forum pain points (all PL-specific) |
| A5 — manual per-order labels v1 | ✅ Strengthened. ShipX bulk-label endpoint supports up to 100 — v2 bulk UX is a thin overlay, not new architecture |
| A6 — COD out v1 | ✅ Confirmed. No forum signal that COD is urgent for the wedge persona |

### 3.9 Open questions for Phase C / implementation

Non-blocking but flagged:

- **OQ-B1**: Exact ShipX rate-limit numbers — requires sandbox probing or InPost integration team confirmation
- **OQ-B2**: Self-service webhook provisioning ETA — currently "under development" per InPost docs; track for v1.1 sequencing
- **OQ-B3**: Webhook event-type catalogue — full list not public; obtain from InPost during sandbox onboarding
- **OQ-B4**: PS-side paczkomat field location for each major InPost-for-PS module — needed only if we choose Option A in §3.7
- **OQ-B5**: Cancel-window semantics — at what shipment status does cancel become "label voided, no balance impact" vs. "balance impact"? Needs sandbox validation

---

## 4. Solution exploration

> **Phase C complete — 2026-05-17**.

### 4.1 Chosen shape — Shape II "Operator-controlled shipment surface"

```
Order detail
  ↓ "Shipment" panel: status, paczkomat, tracking, "Generate label" button
  ↓ Pre-flight validation (dims, phone, postcode) inline
  ↓ Click "Generate label"
  ↓ Paczkomat known? → ShipX submit
  ↓ Paczkomat unknown? → Picker modal → ShipX submit
  ↓ Label PDF returned, tracking# recorded, status badge updated
  ↓ "Cancel + re-issue" available while not yet dispatched

/shipments page (cross-order rollup)
  ↓ Filters: status, date, connection, paczkomat/kurier, has-tracking
  ↓ Click row → order detail

Connection settings
  ↓ ShipX OAuth credentials (Bearer token)
  ↓ Sender address
  ↓ PS InPost module: "Official InPost" / "Other / none"
  ↓ Trigger model: manual / auto-on-paid / auto-on-shipped / batched
  ↓ Webhook setup runbook ("contact integration@inpost.pl with this URL")
```

### 4.2 Three paczkomat-selection flows (locked at A2 + B Q7)

1. **Allegro paczkomatowa** → read from `delivery.pickupPoint.id` (OL already extracts — #458 done)
2. **PS direct order, operator uses "Official InPost" module** → OL PS module reads from official module's schema → passes via PS webservice
3. **All other orders** → manual paczkomat picker modal in OL (ShipX `/v1/points` search)

### 4.3 Confirmed sub-decisions

| ID | Decision | Reasoning |
|---|---|---|
| SC-1 | **Configurable trigger model per-connection** (manual / auto-on-paid / auto-on-shipped / batched) | Matches #728 invoicing pattern (UX consistency); covers every shop convention |
| SC-2 | **Redis-cached paczkomat list, 24h TTL, background refresh** | Matches existing OL infra patterns; persistence across restarts |
| SC-3 | **Single sender address per connection in v1**; connectionId-first design allows clean v2 multi-sender upgrade | Matches A1 single-account discipline |
| SC-4 | **Webhook preferred + polling fallback automatic** when webhook isn't provisioned | Robust degradation; addresses Phase B finding that webhook provisioning is manual via InPost team |
| SC-5 | **4 capabilities declared in v1**: `paczkomat-shipment`, `kurier-domestic-shipment`, `tracking-webhooks`, `cancel-shipment`. Bulk = NOT declared (v2 per A5) | Capability vocabulary pattern matches #728's `regulatory-transmission-tracking` style |

### 4.4 Effort estimate

**~4-5 weeks wall-clock** with 1 backend + 1 FE dev in parallel. Bulk label generation (v2 candidate) is roughly +1-1.5 weeks if added later — cheap because Shape II's groundwork (validation, job dispatch, error mapping) carries.

### 4.5 "Do nothing" honest evaluation

If we don't build #727:
- Q1 wedge promise of "complete e-commerce workflow in OL" remains unfulfilled
- PL shops continue using BaseLinker / manual InPost Manager → 2-4 operator-hours/day lost
- OL stays a "sync tool", never an orchestration platform for the PL market
- Sibling #732 (Allegro Delivery) covers a different segment but doesn't replace #727 for P1 shops

**Verdict**: "do nothing" cuts OL out of the largest segment of PL SMB e-commerce. Not viable for Q1 wedge.

---

## 5. Product specification

> **Phase D complete — 2026-05-17**.

### 5.1 User stories

**US-1 — Connect InPost**

> As a shop owner, I want to connect my InPost B2B account to OL by entering ShipX credentials and selecting which PS InPost module I use, so that OL can generate labels and track shipments without me copy-pasting between tools.

**US-2 — Configure when labels are generated**

> As a shop owner, I want to choose per-connection whether labels are generated automatically (on paid / on shipped status), manually (button per order), or in batches, so that the workflow matches my shop's conventions.

**US-3 — Generate label for any order (manual path)**

> As a shop owner, I want to click "Generate label" on any order in OL, picking paczkomat if not already known from the order, so that I never need to leave OL to ship a package.

**US-4 — Auto-fill paczkomat for Allegro orders**

> As a shop owner, I want paczkomat ID to be auto-filled from Allegro paczkomatowa orders, so that I don't re-enter buyer's choice manually.

**US-5 — Auto-fill paczkomat for PS direct orders (official module)**

> As a shop owner using the official InPost PS module, I want paczkomat ID to be auto-read from my PS InPost data, so that PS direct orders ship with the same one-click ease as Allegro orders.

**US-6 — Manual paczkomat picker fallback**

> As a shop owner whose order doesn't carry a paczkomat (using a non-official PS InPost module, or shipping without paczkomatowa), I want a clear paczkomat picker in OL, so that I can complete shipment without going to InPost Manager.

**US-7 — Cancel + re-issue label**

> As a shop owner, I want to cancel a generated label and re-issue with a different paczkomat from the order detail, so that I can handle "buyer wants to change paczkomat" cases within OL.

**US-8 — Tracking auto-updates**

> As a shop owner, I want shipment status to update automatically in OL (and propagate to Allegro and PrestaShop) when InPost dispatches / delivers the package, so that I don't need to manually mark anything shipped.

**US-9 — Filter shipments**

> As a shop owner, I want a /shipments page with filters (status, date, paczkomat vs kurier, has-tracking), so that I can quickly find what's pending or what failed.

**US-10 — International users see only what applies to them**

> As a shop owner using OL outside Poland (no InPost connection), I want to NOT see InPost-specific terminology (Paczkomat, ShipX, Kurier InPost) in my UI, so that PL-specific concepts don't pollute my workflow.

### 5.2 Acceptance criteria

User-visible. Engineering AC (rate limits, retry policies, exact ShipX field mappings, schema migrations) belong in Tier 2 implementation plans.

**AC-1** (US-1): operator creates InPost connection by providing ShipX OAuth credentials + selecting "PS InPost module" from dropdown (`Official InPost` / `Other / none`) + sender address; connection-test calls ShipX `/me` (or equivalent) and confirms reachability + valid token.

**AC-2** (US-2): connection settings include a "Trigger model" dropdown: `Manual` / `Auto on order paid` / `Auto on order shipped status` / `Batched (operator-initiated)`. Selection persists per connection; changing it affects only future orders, not historical.

**AC-3** (US-3): order detail shows a "Shipment" panel with: status badge (`none` / `pending` / `generated` / `dispatched` / `in-transit` / `delivered` / `failed`), paczkomat ID + name (if applicable), tracking number + link to InPost tracking page (if generated), "Generate label" button (enabled when status is `none` and prerequisites met), validation warnings inline (missing dims, missing phone, invalid postcode) before generation.

**AC-4** (US-4): Allegro paczkomatowa orders auto-populate paczkomat ID from `delivery.pickupPoint.id` on the source order payload. Operator sees paczkomat info in the Shipment panel without any picker interaction.

**AC-5** (US-5): PS direct orders, when operator's connection is configured with "PS InPost module: Official InPost", auto-populate paczkomat ID from the official module's schema.

**AC-6** (US-6): for orders without auto-populated paczkomat, clicking "Generate label" opens a paczkomat picker modal — search by city / street, status badge per result (active / temporarily-unavailable), pick goes into shipment data.

**AC-7** (US-3 + US-7): clicking "Generate label" calls ShipX → label PDF returned within 5 seconds, downloadable from order panel; status updates to `generated`. While status is `generated` (not yet dispatched), "Cancel + re-issue" button is available; clicking voids the existing label and re-opens the generation flow for the same order.

**AC-8** (US-8): tracking number and shipment status auto-propagate to Allegro (via `OrderProcessorManagerPort.updateOrderStatus` or equivalent) and PrestaShop (order status + tracking field) when label is generated and when InPost webhook events fire.

**AC-9** (US-8): when InPost webhook signals `delivered` (or equivalent terminal event), OL updates Shipment status, propagates to source platforms, no operator action required. If webhook isn't provisioned, OL polls tracking endpoint at a conservative cadence.

**AC-10** (US-9): `/shipments` page lists all shipments with columns: status, document date, order link, customer, paczkomat or kurier (icon), tracking number, regulatory/capability badge if applicable. Filters: status, date range, connection, paczkomat vs kurier, has-tracking. Filters are URL-shareable. Click row → order detail.

**AC-11** (US-10): if no connection in the OL instance has an adapter declaring `paczkomat-shipment` or `kurier-domestic-shipment` capability, InPost-specific terminology (Paczkomat, ShipX, Kurier InPost) does NOT appear anywhere in the UI. Same capability-conditional pattern used in #728 for KSeF.

---

## 6. Out of scope

> **Phase D — 2026-05-17**. Top items someone might actually ask about (Stage 1 calibration).

| Item | Reason |
|---|---|
| **Bulk label generation** ("generate labels for N selected") | A5 locked: manual per-order in v1; bulk = v2. ShipX bulk endpoint supports 100/request natively, so v2 add is cheap (~1-1.5 weeks). |
| **COD (Cash on Delivery)** | A6 locked: adds material complexity (return-of-funds, COD-specific UI, accounting integration). v2 if real demand emerges. |
| **International InPost (CZ / SK / IT)** | A4 locked: PL domestic only in v1. Separate impl issue if PL shops shipping internationally surface as real demand. |
| **Multi-account per OL deployment** | A1 locked: single InPost account per connection in v1. v2 multi-account is a clean FE/registry change thanks to connectionId-first discipline. |
| **Reader support for presta-mod.pl + prestahelp + WP-Desk PS InPost modules** | v1.1 polish — added per actual design-partner module distribution data. v1 ships official InPost module reader + manual picker fallback for everything else. |
| **Multi-package shipments** (1 order → N parcels) | v2 if real demand. Most PL shop orders are single-parcel. |
| **Allegro Delivery / Allegro One paczkomatowa (P2/P3 shipping)** | Covered by sibling [#732](https://github.com/SilkSoftwareHouse/openlinker/issues/732) — different contractual path (Allegro as logistics broker), different API (`/shipment-management/*`), separate Product Design. |

---

## 7. Definition of done

> **Phase D — 2026-05-17**. Stage-1 qualitative bullets.

The feature is considered successfully delivered when:

- **The maintainer (or a co-maintainer) has used it for their own PL shop** for ≥30 days without falling back to InPost Manager for routine shipments
- **At least 2 design-partner shops have used it in production** with no InPost-related support tickets escalating to "the integration is unusable"
- **≥80% of paczkomat shipments auto-fill the paczkomat ID** for those operators using Allegro paczkomatowa or the official InPost PS module (qualitative observation, not measured)
- **Cancel + re-issue workflow is exercised** at least once by every design-partner shop — real validation that the buyer-changes-paczkomat scenario is captured (Phase B pain signal)
- **Capability-conditional rendering proves out**: a DACH or non-PL deployment without InPost connection shows ZERO Paczkomat / ShipX / Kurier InPost terminology
- **Webhook OR polling tracking works** end-to-end — operator doesn't have to manually update order status when InPost delivers

If any of these prove false within 60 days of release to design partners, this Product Design returns to Phase A for re-review.

---

## 8. Risks

> **Phase D — 2026-05-17**. Top product-direction risks. Engineering risks (rate limits, ShipX schema drift, webhook event-type ambiguity, paczkomat cache staleness) belong in Tier 2 implementation plans.

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | Most design-partner shops use a non-official PS InPost module (presta-mod / prestahelp / WP-Desk) — manual picker fallback feels like degraded UX | Survey first 3 design-partner shops to learn which modules they run, fast-track v1.1 reader for the most-common alternative within ~1 month of v1 release. Manual picker is functional fallback (not blocking), just less polished. |
| **R2** | Webhook provisioning friction kills onboarding — operator can't figure out how to email InPost integration team, gives up | Clear runbook in connection setup UI with copy-paste email template + InPost contact address. Polling fallback (SC-4=c) ensures tracking works without webhook setup, just at lower freshness. |
| **R3** | Multi-account gap eliminates agencies / multi-warehouse from consideration — single-account v1 closes the door | connectionId-first discipline (no hard-coded "the InPost connection" anywhere) keeps v2 multi-account a clean add. Communicate v1 limitation explicitly in docs to set agency-tier expectations. |
| **R4** | Operators want bulk label gen and v1 doesn't have it (A5 cut) — perceived as "incomplete vs BaseLinker" | A5 holds for v1; bulk is cheap v1.1 add (~1-1.5 weeks given Shape II groundwork). If 3+ design partners ask for bulk in first month, fast-track v1.1. |

---

## 9. Implementation breakdown

> **Phase E complete — 2026-05-17**. Gate D = YES.

Ten implementation issues spawned, each independently shippable. Engineering risks and detailed effort breakdowns live in each issue + Tier 2 `/plan` outputs.

| # | Title | Effort | Blocks |
|---|---|:---:|---|
| [#763](https://github.com/SilkSoftwareHouse/openlinker/issues/763) | `ShippingProviderManagerPort` + capability declarations + `Shipment` / `PickupPoint` / `ShippingMethod` entities + migration | S (~3-5d) | #764, #765, #766, #767, #768, #769, #770, #771, #772 |
| [#764](https://github.com/SilkSoftwareHouse/openlinker/issues/764) | InPost adapter plugin — ShipX REST implementation of `ShippingProviderManagerPort` | M (~5-7d) | #768, #769, #771, #772 |
| [#765](https://github.com/SilkSoftwareHouse/openlinker/issues/765) | `FakeInpostShippingAdapter` for Mac/Linux dev | S (~2-3d) | — (enables #764 dev) |
| [#766](https://github.com/SilkSoftwareHouse/openlinker/issues/766) | Paczkomat caching service (Redis 24h TTL + background refresh) | S (~2-3d) | #769 |
| [#767](https://github.com/SilkSoftwareHouse/openlinker/issues/767) | Read paczkomat ID from official InPost PS module on direct orders | S (~3d) | — |
| [#768](https://github.com/SilkSoftwareHouse/openlinker/issues/768) | InPost shipment status webhook ingestion + signature verification + propagation to Allegro/PS | M (~3-5d) | — |
| [#769](https://github.com/SilkSoftwareHouse/openlinker/issues/769) | FE: order detail Shipment panel + manual buttons + paczkomat picker modal | M (~4-5d) | — |
| [#770](https://github.com/SilkSoftwareHouse/openlinker/issues/770) | FE: `/shipments` page with filters | S (~3d) | — |
| [#771](https://github.com/SilkSoftwareHouse/openlinker/issues/771) | FE: InPost connection settings (ShipX OAuth + PS module dropdown + trigger config + webhook runbook) | S (~3d) | — |
| [#772](https://github.com/SilkSoftwareHouse/openlinker/issues/772) | Polling fallback for InPost tracking status (when webhook not provisioned) | S (~2-3d) | — |

**Critical path:** #763 → #764 / #767 → #768 / #769 / #771 / #772

**Parallelizable from day 1:** #763 (domain), #767 (PS reader — independent of adapter), #765 (fake adapter — independent)

**Total wall-clock estimate:** ~4-5 weeks with 1 BE + 1 FE dev in parallel.

**ADRs likely to be filed during Tier 2** (only when architectural reviewer requests):
- Capability-declaring port pattern (`ShippingProviderManagerPort.getCapabilities()`) — second usage of pattern after #728's `InvoicingPort.getCapabilities()`. ADR may already be filed during #751 work.
- Shipment lifecycle event propagation pattern — cross-cutting with #732 (Wysyłam z Allegro). Worth a shared ADR.
- Capability-conditional FE rendering pattern — third usage if FE patterns from #728's #759 are reused

**Cross-cutting concern with sibling #732 (Wysyłam z Allegro):** the `ShippingProviderManagerPort` defined in #763 will eventually have a sibling adapter for P2/P3 Allegro Delivery. Port shape should accommodate both (`paczkomat-shipment` and `allegro-one-shipment` etc. as separate capabilities under one port).

---

## 10. Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-05-16 | Pre-A | #727 converted from legacy discovery/refinement format to Product Design issue under workflow (during PR #761 audit) | Same conversion pattern as #726 and #728; legacy issue style, content preserved as Phase B evidence input | @piotrswierzy (audit-driven cleanup) |
| 2026-05-17 | Pre-A | Refinement session opened in worktree `727-inpost-integration-refinement`. Lifecycle docs (`refinement-workflow.md`, `product-design.md` template, `refine-product.md` skill, `specs/README.md`) re-applied — they had been dropped from main during PR #761 merge (commit `4cb31ef` not included in merge). Workflow-doc fix ships in same PR as #727 spec. | Workflow consistency: docs must match actual practice established for #726 and #728 (close on Phase E) | @piotrswierzy |
| 2026-05-17 | Pre-A | Added "Setup — Worktree & branch" section to `/refine-product` skill so workflow is self-contained (matches `/work` skill's pattern) | DX improvement: skill should explain how to set up its own working environment | @piotrswierzy |
| 2026-05-17 | A→B | Phase A confirmed: P1 own-contract InPost shop-owner persona; single account per deployment; all 3 paczkomat-selection flows in v1; ShipX REST as target; PL domestic only; manual per-order labels v1 (bulk = v2); COD out v1 | See §1 Gate A resolutions | @piotrswierzy |
| 2026-05-17 | B | Phase B research complete. Key findings: (1) ShipX sandbox + production confirmed viable, OAuth, endpoints covering all v1 needs; (2) webhooks fit OL infra exactly (HMAC-SHA256, x-inpost-timestamp + x-inpost-signature pattern matches #711); (3) commercial precedents (BL 89-789 PLN/mo, Apilo, SellIntegro) all SaaS — validates OSS edge; (4) forum pain points (label failure validation, stale paczkomat ID, change-after-payment) become Phase D AC; (5) multi-account is real BL strength — A1 single-account holds for v1 but requires connectionId-first design discipline for clean v2 upgrade; (6) Allegro paczkomatowa already wired (#458, OL extracts pickupPoint.id); (7) **PS module GAP**: OL's PS module doesn't read paczkomat ID from PS direct orders; (8) webhook provisioning is manual today (no self-service); (9) sandbox + rate-limit numbers are sandbox-probe TODOs | See §3 | product-researcher subagent + @piotrswierzy |
| 2026-05-17 | Gate B | Gate B passed. PS-paczkomat handling: hybrid — v1 reads from official InPost PS module, manual picker fallback for other PS InPost modules, operator-explicit module choice in connection settings (no auto-detection). v1.1 adds support for presta-mod + prestahelp. Multi-account discipline (connectionId-first) confirmed for Phase D AC. | See §3.7 update | @piotrswierzy |
| 2026-05-17 | C | Shape II ("operator-controlled shipment surface") chosen. Per-order Shipment panel + manual buttons + /shipments page + cancel/re-issue from order panel + capability-conditional rendering. Shape III (with bulk) considered and rejected — bulk not in Phase B top pain signals; A5 holds; bulk is cheap v1.1 add (~1-1.5 wk) | See §4.1-§4.4 | @piotrswierzy |
| 2026-05-17 | C | Sub-decisions resolved: SC-1 configurable trigger per-connection; SC-2 Redis 24h TTL paczkomat cache; SC-3 single sender v1 (connectionId-first for v2 upgrade); SC-4 webhook preferred + polling fallback automatic; SC-5 4 capabilities in v1 (paczkomat-shipment, kurier-domestic-shipment, tracking-webhooks, cancel-shipment) | See §4.3 | @piotrswierzy |
| 2026-05-17 | Gate C | Gate C passed. Proceeding to Phase D specification | All Gate C decisions confirmed by maintainer | @piotrswierzy |
| 2026-05-17 | D | Phase D specification: 10 user stories, 11 user-visible acceptance criteria, 7 explicit out-of-scope items, qualitative DoD (Stage-1 calibration), 4 product-direction risks | See §5-§8 | @piotrswierzy |
