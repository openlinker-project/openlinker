# Product Spec — #961 DPD Polska shipping integration

**Status:** phases A–E complete; Gate D = YES (build); refinement closed 2026-06-02; impl tracked via #962–#966
**Parent issue:** [#961](https://github.com/openlinker-project/openlinker/issues/961)
**Started:** 2026-06-02
**Last updated:** 2026-06-02
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

---

## 0. Framing note — is Tier 1 even required here?

DPD-courier-to-door against the existing `ShippingProviderManagerPort` (shipped
by InPost, #727/#763-#772) is arguably an **established pattern** — "a second
adapter for an existing port" — which the workflow says can skip Tier 1.

Two reasons it still gets a (lightweight) Product Design:

1. **#727 §2 explicitly pre-declared it**: *"Non-InPost couriers (DHL, DPD,
   ORLEN Paczka, GLS, FedEx) — separate future PDs per courier, each
   plugin-as-adapter against the same shared port."* The maintainer's documented
   intent is one PD per courier.
2. **There are genuine net-new product questions** that InPost's spec doesn't
   answer for DPD — chiefly *DPD Pickup-point scope* and *COD*, plus the honest
   prioritisation question (is there real demand, or is this curiosity-driven?).

**Calibration**: this spec **inherits** #727's confirmed shape (operator-controlled
per-order shipment surface, single account, manual labels v1, capability-gated
UI) wherever DPD doesn't differ, and spends its refinement budget only on the
DPD-specific deltas. It is deliberately shorter than #727.

> Note: issue #961's body was filed with premature *technical* detail (SOAP
> transport, capability mapping, file paths). That is Tier-2 content and is
> **deferred to `/plan`** on the spawned implementation issues — this spec
> governs product scope only.

---

## 1. Problem

> **Phase A — drafted 2026-06-02, pending Gate A.**

> **Phase A complete — problem statement + persona confirmed by maintainer at
> Gate A on 2026-06-02** (maintainer engaged with and expanded scope rather than
> re-framing; problem/persona accepted as written). The evidence-honesty caveat
> below carries forward as the central Phase B question.

### Problem statement

OpenLinker shipped its first OL-managed carrier (InPost, #727) so PL operators
can dispatch labels without leaving OL. **DPD is one of the top courier networks
in Poland** for to-the-door parcel delivery — many PL shops run DPD as their
*courier* carrier (alongside or instead of InPost paczkomat for locker
delivery). A shop whose carrier is DPD currently cannot generate a DPD waybill
from OL: they fall back to DPD's own portal (or BaseLinker), which re-opens the
exact "leave OL to ship" context-switch that the shipping context was built to
close.

Today's workflow for a DPD-shipping shop:
1. See order in OL
2. **Leave OL** → log into DPD's web portal / their DPD-enabled tool
3. Re-enter recipient + parcel data
4. Generate waybill + label
5. Copy tracking number back into Allegro + PrestaShop manually

For the same 10–200 orders/day persona as #727, this is the same per-shipment
context-switching tax — just for the subset of orders that ship via DPD.

### Why now / why DPD next

- **Pre-declared in #727 §2** as the next per-courier PD after InPost.
- **DPD is a top-tier PL courier** — the natural "courier-to-door" complement to
  InPost's "paczkomat-dominant" coverage. A shop offering both
  locker + courier can't be fully served by InPost alone.
- **A public sandbox exists** (`dpdservicesdemo.dpd.com.pl`, public test creds),
  so the integration is buildable without a signed contract for the spike.

### ⚠️ Evidence honesty (to be tested in Phase B)

This PD was triggered by a maintainer sandbox-availability check ("does a DPD
sandbox exist?"), **not** by a cited seller request. There is currently **no
recorded user asking specifically for DPD**. The justification is structural
(pre-declared per-courier PD + DPD's PL market position), i.e. a **hypothesis**.
Phase B must find real signal (design-partner shops that ship DPD, forum/support
demand) — otherwise the honest Gate-D outcome may be **DEFER until a DPD-shipping
design partner exists**, exactly as the workflow's "default to don't build"
principle prescribes.

---

## 2. Affected persona

> **Phase A — drafted 2026-06-02, pending Gate A.**

### Primary persona: PL shop owner with own DPD courier contract

Same wedge persona as #727, narrowed to the DPD-courier subset:

- **Role:** in-house operator at a PL e-commerce shop (non-technical)
- **Company size:** 1–30 people
- **Volume:** 100–1,000 SKUs; 10–200 orders/day, a meaningful share shipping via
  **DPD courier to-the-door** (mix with InPost varies by shop)
- **Sophistication:** operator-level — comfortable with admin UIs, not technical
- **Geography:** PL domestic (DPD also does heavy EU/international — explicitly
  out of v1, see ambiguity D3)
- **Existing DPD setup:** has own B2B agreement with DPD Polska (a **FID** +
  web-service login/password), generates labels today via DPD's portal

### Explicitly someone else's problem

- **InPost paczkomat/kurier shops** → #727 (shipped)
- **Allegro Delivery / Allegro One (P2/P3 broker-shipping)** → [#732](https://github.com/openlinker-project/openlinker/issues/732)
- **Other couriers** (DHL, ORLEN Paczka, GLS, FedEx) → their own future PDs

---

## 3. Gate A resolutions

> **Phase A complete — confirmed by maintainer at Gate A on 2026-06-02.**

The maintainer **expanded v1 scope beyond #727's first cut**: both delivery
modes, bulk, and COD are all in v1. This makes DPD a fuller-featured v1 than
InPost was, with corresponding effort.

| ID | Question | Decision | Implication |
|---|---|---|---|
| **D1 — Delivery modes** | DPD Pickup point selection, or courier-to-door only? | **BOTH in v1** — courier-to-door **and** DPD Pickup (parcel-shop) point selection. | v1 mirrors #727's pickup-point handling: read DPD Pickup point from Allegro/PS order where present, manual point picker as fallback, plus plain courier-to-door at the buyer address. Two delivery methods supported. |
| **D2 — Account model** | Single DPD account (one FID) per deployment? | **Yes** — single account per connection; connectionId-first so v2 multi-account is a clean FE/registry change. | = #727 A1. |
| **D3 — Geography** | PL domestic only in v1? | **Yes — PL domestic, and explicitly the *DPD Polska* national product.** | DPD is a pan-European brand with **per-country APIs**; this integration targets the **DPD Polska** national web service specifically. EU/international DPD = separate future scope. The integration and UI must be labelled "DPD Polska", not generic "DPD". |
| **D4 — Label cadence** | Manual per-order, or bulk too? | **BOTH in v1** — manual per-order **and** bulk (generate labels for N selected orders). | Diverges from #727 A5 (which deferred bulk to v2). |
| **D5 — COD** | Cash-on-delivery in or out? | **IN scope for v1.** | COD ("pobranie") is core to PL courier delivery. v1 must carry COD amount through to the DPD shipment and surface it in the shipment UI. Diverges from #727 A6. |
| **D6 — Integration target** | Official DPD web service (no portal scraping)? | **Yes — official DPD Polska web service.** | Product-level confirmation; transport mechanics (SOAP shape, two-step label flow, tracking service) are Tier-2 `/plan`. |

### Scope-expansion note

Relative to #727, v1 adds **three** capability areas InPost deferred:
pickup-point selection *plus* courier (D1 = both), bulk labels (D4), and COD
(D5). Phase B must confirm each is (a) supported by the DPD Polska web service
and (b) actually demanded — and Phase C/D effort must reflect the larger surface.

---

## 4. Evidence & user research

> **Phase B complete — 2026-06-02.** Conducted by `product-researcher` subagent.
> Mirrors #727 §3. All claims cited inline; field-level API shapes are Tier-2
> concerns and flagged UNVERIFIED where not product-relevant.

### 4.1 DPD market position — strong support

DPD Polska is the **#2 courier by both volume and revenue** behind InPost, and
the **#1 courier-to-door** operator (InPost's lead is locker-driven). 2024
value-added: InPost 7.2 bn PLN, **DPD 5.1 bn**, DHL eCommerce 3.5 bn. Top-5 by
volume: InPost, **DPD**, Allegro, ORLEN Paczka, GLS. "DPD courier alongside
InPost lockers" is the common pattern — corroborated by an official PrestaShop
DPD module and multiple WooCommerce DPD plugins existing.

Sources: [Bankier KEP report](https://www.bankier.pl/wiadomosc/Kurierzy-wypracowali-0-68-polskiego-PKB-InPost-i-DPD-na-czele-zestawienia-9060048.html), [WNP top-10 operators](https://www.wnp.pl/logistyka/10-najwiekszych-operatorow-ma-ponad-99-proc-rynku-przesylek-kurierskich,1030813.html), [PrestaShopCorp/dpdpoland](https://github.com/PrestaShopCorp/dpdpoland).

### 4.2 COD ("pobranie") — table-stakes, supported (validates D5)

~61% of PL shops offer COD; 27–39% of buyers used pay-on-delivery in 2024
(declining as BLIK rises, but still majority-offered). DPD's web service supports
COD as an additional service on `generatePackageNumbers`; funds settle to the
sender's account, requires a COD annex to the DPD contract. A named seller
demanded DPD-COD via BaseLinker→Allegro and hit a bug ([allegro-api #4673](https://github.com/allegro/allegro-api/issues/4673)).
**Verdict: D5-in-scope is correct — a DPD integration without pobranie reads as
incomplete.** COD cap conflict (15 000 PLN domestic vs 1000 EUR international)
and exact COD field names are Tier-2 / contract-specific.

Sources: [IAB/Gemius E-commerce 2024](https://www.iab.org.pl/aktualnosci/zakupy-zagraniczne-produkty-uzywane-i-platnosci-blikiem-raport-e-commerce-w-polsce-2024/), [Shoper Learn — pobranie](https://www.shoper.pl/learn/artykul/platnosc-za-pobraniem-czym-jest-jak-dziala-i-czy-warto-stosowac-w-sklepie-internetowym), [t3ko/dpd-pl-api-php](https://github.com/t3ko/dpd-pl-api-php).

### 4.3 DPD Pickup + auto-fill (validates D1, with a fork)

DPD Pickup ≈ **33k points** (~12k lockers) — a credible #2 pickup network.
Auto-fill of the chosen point from the source order:

- **Allegro — PROVEN.** `GET /order/checkout-forms/{id}` exposes
  `delivery.pickupPoint.id`; Allegro's own DPD example point id is `PL11033`.
  **This is the same field OL already reads for InPost paczkomat (#458)** — so
  Allegro DPD-point auto-fill needs no new Allegro surface.
- **PrestaShop — QUALIFIED.** PS DPD checkout modules save the chosen point to
  the order, but the field is **module-dependent** (no single canonical field
  like Allegro's). Scope as best-effort + operator-manual fallback (mirrors
  #727's PS-paczkomat hybrid).

**New product boundary surfaced (the #1 forum pain): Allegro-Delivery-DPD vs
own-contract-DPD.** DPD sold through Allegro's "Wysyłam z Allegro" is
**Allegro-billed** and dispatched via Allegro's tool — *not* the seller's own
DPD FID. OL targets **own-contract DPD**. Reading a buyer-chosen point and
shipping it on the seller's own FID works at the data level, but sellers who
picked an *Allegro-Delivery* DPD method are expected to dispatch through Allegro;
doing it on own-contract causes mis-billing / "smart service refused" errors seen
in forums. **This is a product-positioning decision** (see Gate B question 2).

> **Resolved at Gate B (2026-06-02):** OL's existing **source-brokered routing
> (#732, shipped — `allegro-delivery-shipping.adapter.ts` + `fulfillment-routing.service.ts`)**
> already handles "ship via Allegro." Routing maps each source delivery method →
> a processor, constrained by **adapter-declared compatibility**
> (`getSupportedMethods()`). An Allegro-brokered DPD method is compatible with the
> **Allegro Delivery** processor, **not** the own-contract DPD adapter — so the
> routing UI won't offer own-contract DPD for it, and the mis-billing path is
> prevented **by construction**, not by a warning. **Implication for #961:** the
> DPD adapter must simply declare its `getSupportedMethods()` compatibility for
> own-contract-appropriate methods only; the Allegro-vs-own-contract boundary is
> **inherited from #732**, not a net-new DPD product decision.

Sources: [Allegro Dev — Wysyłam z Allegro tutorial](https://developer.allegro.pl/tutorials/jak-zarzadzac-przesylkami-przez-wysylam-z-allegro-LRVjK7K21sY), [DPD Pickup official](https://www.dpd.com/pl/en/dpd-pickup/), [Allegro DPD Pick-up seller info](https://help.allegro.com/en/sell/a/allegro-dpd-pick-up-information-for-sellers-nnk5WxxKvI7), [EasyUploader DPD thread](https://www.easyuploader.pl/forum/viewtopic.php?t=9279).

### 4.4 Bulk labels — justified (validates D4)

DPD web service is natively batch-shaped (`generatePackagesNumbersV1–V4`,
`generateSpedLabelsV1–V4` take arrays; the DPD **protocol/handover** doc is
itself a bulk artifact). At 100–200 orders/day the upper persona band needs
batch + one daily protocol; competitors present DPD bulk as a headline feature.
Cheap to include because the API is batch-native. (Phaseable if scope pressure
appears, but evidence supports v1.)

Sources: [dbojdo/dpd-client WSDL](https://github.com/dbojdo/dpd-client/blob/master/tests/DPDServices/Client/dpd.wsdl), [BaseLinker DPD](https://base.com/pl-PL/pomoc/wiedza/dpd/).

### 4.5 Competitors — expanded scope = market parity, not gold-plating

All SaaS competitors integrate DPD with **COD + Pickup + bulk on the seller's own
contract, behind a subscription**: BaseLinker (individual+bulk, auto pickup-fill,
COD), Apilo (own-contract login/**masterFID**/password, DPD Pickup, subscription
+ trial), WP Desk / SellIntegro (COD, Pickup, bulk). **The maintainer's expanded
v1 scope is exactly this parity bar** — calibrated to the market. OL's edge:
OSS, self-hosted, no recurring fee, identical own-contract auth model.

Sources: [base.com DPD](https://base.com/pl-PL/pomoc/wiedza/dpd/), [Apilo DPD](https://apilo.com/pl/integracje/dpd-polska/), [WP Desk WooCommerce DPD](https://www.wpdesk.pl/docs/woocommerce-dpd-docs/).

### 4.6 Demand honesty — parity-driven, NOT pull-driven ⚠️

Generic demand for DPD-in-a-multichannel-tool is overwhelming (DPD #2; every
competitor ships it; active forum dispatch threads). But there is **no cited
OpenLinker / OSS-self-hosted-specific request** for DPD — the PD was
sandbox-triggered. The case for building **now** rests on *competitive parity*
("a PL multichannel tool without DPD is an outlier"), not on a user pulling for
it. Per "default to don't build", this is the one weak leg and the crux of the
Gate-D decision: **build now on parity strategy, or DEFER until a DPD-on-own-
contract design partner exists?**

Sources: [allegro-api #4673](https://github.com/allegro/allegro-api/issues/4673), [Allegro community — Baselinker DPD dispatch](https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/baselinker-nadanie-dpd/td-p/490560).

> **Resolved at Gate B (2026-06-02):** the demand gap is closed — **a potential
> OpenLinker customer requires DPD**. This is a concrete pull signal, not just
> market parity. The Gate-D timing argument no longer rests on parity strategy
> alone; build-now is justified by a named prospective customer. DEFER is off
> the table.

### 4.7 DPD-specific pain corpus → AC seeds

Recurring PL-forum DPD pain (mirrors how InPost pain seeded #727 ACs):
1. Label-validation failures from bad recipient data (postcode, `+48` phone, weight/dims).
2. Reference-number field rejection (charset/length constraints).
3. **COD shipments failing where plain labels succeed** — COD path needs its own validation + error mapping.
4. **Allegro-Delivery-vs-own-contract confusion** → mis-billing (the §4.3 boundary).
5. Three-way blame loops (DPD / Allegro / tool) → surface the **raw DPD fault** to the operator.

Sources: [base.com dispatch errors](https://base.com/pl-PL/pomoc/wiedza/bledy-przy-nadawaniu-paczek-omowienie/), [base.com kurierzy FAQ](https://base.com/pl-PL/pomoc/faq/kurierzy/), [Allegro — błąd DPD pobranie](https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/b%C5%82%C4%85d-w-baselinkerze-kurier-dpd-pobranie/td-p/803649).

### 4.8 Impact on Gate A decisions

| Gate A decision | Phase B impact |
|---|---|
| D1 — both delivery modes | ✅ Allegro pickup auto-fill PROVEN (= InPost mechanism); PS auto-fill QUALIFIED (module-dependent, manual fallback). |
| D2 — single account | ✅ Matches competitor own-contract model. |
| D3 — PL domestic / DPD **Polska** | ✅ Confirmed; own-contract auth = login/**masterFID**/password. |
| D4 — bulk in v1 | ✅ Native batch ops + competitor parity; cheap to include. |
| D5 — COD in v1 | ✅ Strongly confirmed table-stakes. |
| D6 — official web service | ✅ Confirmed (DPDPackageObjServices). |

### 4.9 Open questions (non-blocking, for Phase C / Tier-2)

- **OQ-B1**: Exact COD/pickup field names in DPDPackageObjServices XSD — Tier-2 (`...?xsd=1` against demo).
- **OQ-B2**: COD cap (15 000 PLN domestic vs 1000 EUR intl) — confirm against seller's DPD annex.
- **OQ-B3**: PS DPD-point order field per checkout module — needed for PS auto-fill path.
- **OQ-B4**: Tracking — DPDPackageObjServices has no tracking op (separate DPDInfoServices) — Tier-2.

## 5. Solution exploration

> **Phase C — drafted 2026-06-02, pending Gate C.**

### 5.1 The shape is largely inherited — this is a sequencing decision

DPD does **not** need a new solution shape. It reuses two shipped foundations:

- **#727 Shape II — operator-controlled shipment surface**: per-order Shipment
  panel (status, point, tracking, "Generate label"), `/shipments` rollup,
  cancel/re-issue, capability-gated UI. DPD is a new connection + adapter behind
  the same surface.
- **#732 routing model**: `(source method → processor)` mapping, adapter-declared
  compatibility, unified status. DPD own-contract = a new **OL-managed carrier**
  (branch 2) adapter, exactly like InPost. Pickup-point selection reuses the
  existing `PickupPointFinder` capability + manual-picker modal (#766/#769).

So Phase C is really: **what's the v1 cut and sequencing** of the four
maintainer-chosen scope areas (courier-to-door, DPD Pickup, COD, bulk), given (a)
a net-new **SOAP transport** (Tier-2 risk) and (b) a **specific customer** whose
exact DPD usage should anchor the MVP.

### 5.2 Candidate shapes

| # | Shape | What ships | Effort | Excludes |
|---|---|:---:|---|---|
| **A** | **Full-parity v1** (maintainer's Gate-A scope) | courier-to-door **+** DPD Pickup (Allegro auto-fill + manual picker; PS best-effort) **+** COD **+** bulk, all at once | **~L–XL** | nothing in scope; intl, multi-account = v2 |
| **B** | **Courier + COD first, pickup + bulk fast-follow** | v1.0: courier-to-door + COD + per-order labels + tracking; v1.1: DPD Pickup auto-fill/picker + bulk | **v1.0 ~M, v1.1 ~M** | v1.0 excludes pickup + bulk |
| **C** | **Thin proof adapter** | courier-to-door only, no COD/pickup/bulk — prove SOAP transport | ~S–M | COD, pickup, bulk (contradicts Gate A + customer need) |
| **D** | **Do nothing / point to Allegro Delivery** | — | 0 | everything (customer needs *own-contract* DPD; Allegro Delivery ≠ own-contract) |

### 5.3 Comparison

- **Problem fit**: A and B both fully solve it; B delivers the highest-confidence,
  highest-pain slice (courier + COD — §4.2, §4.7) first. C under-delivers vs the
  customer need. D doesn't solve it.
- **Customer fit**: depends on what the customer actually ships (see Gate C
  question). If they're courier-COD-centric, B's v1.0 already covers them and
  pickup/bulk become demand-validated fast-follows. If they need lockers + high
  volume day-one, A is required.
- **Risk**: the SOAP transport is the main unknown — both A and B front-load a
  **sandbox spike** to de-risk it. B contains blast radius by shipping the
  smaller surface first; A is bigger-bang. Bulk and pickup each add surface
  (bulk = batch label + handover protocol UX; pickup = point directory + picker).
- **Strategic fit**: A matches the full competitor-parity bar in one release; B
  reaches the same place in two, sequenced by confidence.

### 5.4 Recommendation

**Shape A (full-parity v1) is the committed direction per Gate A and the named
customer — recommend it, but anchor the cut to the customer's real usage and
keep B as the de-risking fallback.** Concretely: run the **SOAP sandbox spike
first** (validate `generatePackagesNumbersV1` create + label fetch + a COD
shipment + a point shipment against the demo WSDL); if the spike or the
customer's timeline puts full-parity at risk, fall back to B's sequencing
(courier+COD v1.0 → pickup+bulk v1.1) without re-architecting — the shipping
surface and routing model carry both.

### 5.5 "Do nothing" honest check

Rejected. The customer needs **own-contract DPD**; Allegro Delivery (#732) is a
different contractual path and can't fulfil it. Not building means the customer
can't ship DPD from OL — the exact gap this PD exists to close.

### 5.6 Effort (rough order-of-magnitude)

Shape A ≈ **~L–XL** (bigger than #727's ~4–5wk because SOAP transport is net-new
*and* COD + bulk + both delivery modes ship together). Reuse of the shipping
surface + routing model offsets some of it. Day-level breakdown is Tier-2.

### 5.7 Chosen shape (Gate C — 2026-06-02)

**Shape A — full-parity v1**, confirmed against the potential customer's real
usage: they ship **both** courier-to-door **and** DPD Pickup, **COD is a
must-have**, and they need **bulk day-one**. No phasing. The SOAP sandbox spike
still runs first as the de-risking step (it's an early implementation task, not a
scope change).

## 6. Product specification

> **Phase D — drafted 2026-06-02, pending Gate D.** User-visible only; engineering
> AC (SOAP envelope shape, COD/point XSD fields, retry/tracking mechanics) is
> Tier-2.

### 6.1 User stories

**US-1 — Connect DPD Polska**
> As a shop owner, I want to connect my DPD Polska B2B account to OL by entering
> my web-service credentials (login + masterFID + password) and sender address,
> so OL can generate DPD labels without me using the DPD portal.

**US-2 — Configure when labels are generated**
> As a shop owner, I want to choose per-connection whether labels generate
> manually, automatically (on paid / on shipped), or in batches, so the workflow
> matches my shop's conventions. *(inherits #727 US-2)*

**US-3 — Generate a courier-to-door label for any order**
> As a shop owner, I want to click "Generate label" on an order shipping by DPD
> courier and get a DPD waybill PDF, so I never leave OL to ship a to-the-door
> parcel.

**US-4 — Ship to a DPD Pickup point**
> As a shop owner, I want DPD Pickup point to auto-fill from Allegro orders that
> carry one, and a point picker for orders that don't, so I can ship to a DPD
> parcel-shop as easily as to a door.

**US-5 — Cash on delivery (pobranie)**
> As a shop owner, I want COD orders to carry the collection amount through to the
> DPD shipment and show it in the shipment panel, so I can ship pay-on-delivery
> parcels — which a large share of my buyers choose.

**US-6 — Bulk label generation**
> As a shop owner, I want to select many orders and generate all their DPD labels
> plus a single handover protocol in one action, so I can dispatch my daily
> volume without per-order clicking.

**US-7 — Tracking auto-updates**
> As a shop owner, I want DPD shipment status + tracking to update automatically
> in OL and propagate to Allegro and PrestaShop, so I don't mark anything shipped
> by hand. *(inherits #727 US-8)*

**US-8 — Find shipments**
> As a shop owner, I want the `/shipments` page to show and filter my DPD
> shipments (status, date, courier vs pickup, COD, has-tracking), so I can find
> what's pending or failed. *(inherits #727 US-9)*

**US-9 — Non-DPD users see no DPD terminology**
> As an OL user with no DPD connection, I want DPD-specific terms to not appear in
> my UI, so PL-courier concepts don't pollute my workflow. *(inherits #727 US-10
> capability-gated pattern)*

### 6.2 Acceptance criteria (user-visible)

**AC-1** (US-1): operator creates a "DPD Polska" connection by entering login +
masterFID + password + sender address; a connection-test confirms the credentials
reach the DPD web service (sandbox or production per connection setting).

**AC-2** (US-2): connection settings expose a "Trigger model" dropdown (`Manual` /
`Auto on paid` / `Auto on shipped` / `Batched`); selection persists per connection
and affects only future orders.

**AC-3** (US-3): order detail shows a Shipment panel (status badge, delivery mode,
COD amount if any, tracking + link once generated, "Generate label" button) with
inline validation warnings (missing/invalid postcode, phone, weight/dims,
reference charset) **before** submission; clicking generates a DPD courier label
returned as a downloadable PDF and sets status `generated`.

**AC-4** (US-4): Allegro orders carrying a DPD Pickup point auto-fill it (read from
`delivery.pickupPoint.id`, the same field used for InPost). Orders without one open
a DPD Pickup **point picker** (search by city/street) on label generation.
PrestaShop orders auto-fill the point **where the shop's DPD module exposes it**
(best-effort); otherwise they use the picker.

**AC-5** (US-5): for COD orders, the Shipment panel shows the COD amount; generating
the label submits the COD service to DPD with that amount. COD validation errors
from DPD are surfaced verbatim (COD path validated independently of plain labels).

**AC-6** (US-6): operator selects multiple orders (from `/shipments` or order list)
and triggers bulk label generation; OL produces each label and a single DPD
**handover protocol** for the batch, surfacing per-order success/failure.

**AC-7** (US-7): DPD shipment status + tracking auto-update in OL (no manual
marking) and propagate to Allegro (status + tracking) and PrestaShop, on a
conservative cadence.

**AC-8** (US-8): `/shipments` lists DPD shipments with columns (status, date, order,
customer, courier/pickup, COD flag, tracking) and URL-shareable filters; row →
order detail.

**AC-9** (US-9): if no connection declares a DPD-courier / DPD-pickup shipping
capability, DPD-specific terminology does not appear anywhere in the UI (same
capability-conditional pattern as #727 AC-11 / #728 KSeF).

## 7. Out of scope

> **Phase D — 2026-06-02.** Top items someone might actually ask about (Stage-1 cap).

| Item | Reason |
|---|---|
| **Label cancel / re-issue** | DPDPackageObjServices exposes **no cancel operation** (unlike InPost ShipX DELETE). Pending Tier-2 spike; if unavailable, "re-issue" = generate a new shipment. Not promised in v1. |
| **International / EU DPD** | D3 locked: PL-domestic *DPD Polska* national product only. EU = separate future scope. |
| **Multi-account per deployment** | D2 locked: single DPD account per connection; connectionId-first keeps v2 multi-account a clean add. |
| **PS pickup-point auto-fill for every DPD checkout module** | Module-dependent (§4.3). v1 = best-effort for the common module + manual picker fallback for the rest. |
| **Multi-parcel single order** (1 order → N parcels on one waybill) | Bulk (N orders) is in; splitting one order across parcels is v2 if demand surfaces. |
| **COD settlement / reconciliation tracking** | OL generates the COD label; fund settlement + reconciliation stays in DPD's portal/accounting. v1 doesn't track payout. |

## 8. Definition of done

> **Phase D — 2026-06-02.** Stage-1 qualitative bullets (no invented metrics).

- **The potential customer ships DPD from OL in production for ≥30 days** —
  courier + pickup + COD + bulk — without falling back to the DPD portal.
- **COD shipments work end-to-end** for that customer (label carries the amount;
  DPD accepts it) — validated independently of plain labels.
- **The customer's daily bulk run works** — N labels + one handover protocol in
  one action, with clear per-order failure surfacing.
- **DPD Pickup auto-fills from Allegro** for point orders; the picker covers the
  rest; PrestaShop best-effort behaves predictably.
- **Tracking auto-updates** (no manual marking) and propagates to Allegro + PS.
- **Capability-gated UI proven**: a non-DPD deployment shows zero DPD terminology.

If any prove false within 60 days of the customer going live, this PD returns to
Phase A.

## 9. Risks

> **Phase D — 2026-06-02.** Top product-direction risks. Engineering risks (SOAP
> envelope fidelity, XSD field shapes, tracking-service auth, retry semantics) →
> Tier-2 plans.

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | **Single-customer validation** — the only cited demand is one prospect; their DPD FID config (which services are enabled) may not generalize to other shops. | Ship for the customer first; treat their setup as the v1 reference; broaden only as more DPD shops appear. Accept narrow v1 validation knowingly. |
| **R2** | **COD expectation gap** — operators may expect COD *settlement/reconciliation* visibility, not just label generation. | Set expectation explicitly in UI/docs: OL generates the COD label; payout tracking stays in DPD's tooling (out of scope §7). |
| **R3** | **Cancel not available via the DPD API** — operators used to InPost cancel/re-issue may expect it. | Confirm in the spike; if absent, document "re-issue = new shipment" and don't surface a cancel affordance for DPD. |
| **R4** | **PrestaShop pickup auto-fill is module-dependent** — degraded UX for shops on a non-standard DPD checkout module. | Manual picker is always-available fallback; fast-follow a reader for the customer's actual PS module if they use one. |
| **R5** | **Scope is bigger than #727 in one release** (courier+pickup+COD+bulk + net-new SOAP) — abandonment/over-run risk. | SOAP sandbox spike first; Shape B phasing held in reserve (§5.4) as a no-rearchitect fallback if the spike reveals risk. |

## 10. Implementation breakdown

> **Phase E complete — 2026-06-02. Gate D = YES.**

Five implementation issues spawned, each linked to #961 via `Part of #961`.
Engineering risks + effort detail live in each issue + Tier-2 `/plan` outputs.

| # | Title | Effort | Blocks |
|---|---|:---:|---|
| [#962](https://github.com/openlinker-project/openlinker/issues/962) | DPD adapter package + SOAP transport (courier-to-door + COD) — incl. sandbox spike | L | #963, #964, #965, #966 |
| [#963](https://github.com/openlinker-project/openlinker/issues/963) | DPD Pickup — `PickupPointFinder` + ship-to-point + Allegro auto-fill | M | — |
| [#964](https://github.com/openlinker-project/openlinker/issues/964) | DPD bulk label generation + handover protocol | L | — |
| [#965](https://github.com/openlinker-project/openlinker/issues/965) | DPD tracking via DPDInfoServices + worker registration | M | — |
| [#966](https://github.com/openlinker-project/openlinker/issues/966) | FE — DPD connection settings + COD/pickup panel + capability-gated terminology | M | — |

**Critical path:** #962 → {#963, #964, #965, #966} (the four dependents are
parallelizable once #962 lands).

**ADRs likely during Tier-2:**
- **SOAP transport pattern** (first SOAP integration in the codebase) — during #962.
- **Bulk-shipment-dispatch seam** (core-vs-adapter-local) — during #964; #727
  deferred bulk so this may be net-new core surface.

**Next step per issue:** `/plan #962` (non-trivial: SOAP + ADR), then `/work`.
#964 also warrants `/plan` (bulk-dispatch seam). #963/#965/#966 likely go
straight to `/work` once #962 lands (established pattern).

## 11. Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-06-02 | Pre-A | Refinement opened in worktree `961-dpd-polska-product-design` (branch `961-dpd-polska-refinement`). #961's premature technical body deferred to Tier 2. | `/refine-product 961`; DPD is the per-courier PD pre-declared in #727 §2. | @piotrswierzy |
| 2026-06-02 | Gate D / E | **Gate D = YES** (build) — justified by a named prospective customer pull. Phase E: spawned 5 impl issues (#962–#966), linked via `Part of #961`; PD #961 closed (refinement complete). | Maintainer commit | @piotrswierzy |
| 2026-06-02 | D | Phase D spec: 9 user stories, 9 user-visible ACs, 6 out-of-scope items, qualitative DoD (Stage-1), 5 product risks. Cancel flagged out-of-scope pending API confirmation (no cancel op in DPDPackageObjServices). | See §6–§9 | @piotrswierzy |
| 2026-06-02 | Gate C | Gate C passed. **Shape A (full-parity v1) committed** and customer-validated: both delivery modes, COD must-have, bulk day-one. No phasing; SOAP spike runs first as de-risking step. Shape B held as no-rearchitect fallback. | See §5.7 | @piotrswierzy |
| 2026-06-02 | Gate B | Gate B passed. **Demand resolved: a potential OpenLinker customer requires DPD** → build-now justified by a named pull, not parity alone; DEFER off the table. Allegro-vs-own-contract boundary **resolved as inherited from #732** — source-brokered routing already dispatches Allegro-brokered methods via Allegro; adapter-declared compatibility prevents mis-routing own-contract DPD by construction (no "warn" needed). | See §4.3, §4.6 | @piotrswierzy |
| 2026-06-02 | B | Phase B research complete (product-researcher). DPD = PL #2 courier / #1 to-door; COD table-stakes (~61% shops) & web-service-supported; DPD Pickup ~33k pts, **Allegro point auto-fill PROVEN** (same `delivery.pickupPoint.id` as InPost), PS auto-fill module-dependent; bulk native; all competitors ship COD+Pickup+bulk on own-contract behind subscription. Expanded scope = **market parity**. ⚠️ Demand is **parity-driven, not pull-driven** — no cited OL user request. New boundary surfaced: **Allegro-Delivery-DPD vs own-contract-DPD**. | See §4 | product-researcher + @piotrswierzy |
| 2026-06-02 | A→B | Gate A confirmed. Problem + persona accepted. Scope **expanded vs #727**: D1 both delivery modes (courier + DPD Pickup), D2 single account, D3 PL-domestic (DPD **Polska** national product specifically), D4 manual **and** bulk, D5 **COD in scope**, D6 official DPD web service. | Maintainer decisions at Gate A | @piotrswierzy |
