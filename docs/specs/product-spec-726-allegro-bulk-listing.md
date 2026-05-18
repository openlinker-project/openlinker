# Product Spec — #726 Allegro bulk listing creation (+ Smart! support)

**Status:** phase A complete; phase B complete; phase C complete; phase D complete; Gate D = YES (build); phase E complete; ready for implementation
**Parent issue:** [#726](https://github.com/openlinker-project/openlinker/issues/726)
**Started:** 2026-05-15
**Last updated:** 2026-05-15
**Workflow:** [`docs/contributors/refinement-workflow.md`](../contributors/refinement-workflow.md)

---

## 1. Problem

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-15**

### Problem statement

PL e-commerce shops running on PrestaShop and selling on Allegro can create only **one Allegro offer at a time** through OpenLinker today. For shops with 50–1,000 SKU catalogs, this forces them to either:

1. Use BaseLinker Cloud for bulk operations — losing the data unification benefit of consolidating in OpenLinker, paying per-order pricing that compounds painfully past 200 orders/day, and accepting vendor lock-in
2. Work outside OpenLinker via the Allegro seller panel (manual data re-entry, ~5 min × 100 SKUs = 8 operator-hours per onboarding) or via custom Allegro-API scripts (technical operators only)

Both workarounds friction-out adoption: an agency or merchant who can't onboard a 100-SKU catalog efficiently won't adopt OpenLinker for ongoing operations either.

**Secondary problem — Allegro Smart! eligibility:** Allegro's "Smart!" buyer subscription gives free shipping above 45 zł threshold; eligible offers see materially better conversion. Seller-side requirement is a properly-configured delivery method. OpenLinker today has no surface for the operator to choose which delivery configuration applies to a new offer, leaving operators unable to opt offers into Smart! without leaving the wizard. **Whether Smart! belongs in the same product design as bulk listing, or is a separate sibling refinement, is a Phase C decision.**

### Why now

- Q1 wedge defined as "PL Allegro + PrestaShop + InPost — complete end-to-end workflow" (strategy session 2026-05-15)
- Without a bulk listing story, OpenLinker is unusable for any new-shop onboarding beyond ~10 SKUs, blocking the first 3-5 design partner agencies the strategy depends on
- Pre-refinement codebase audit (`docs/plans/implementation-plan-726-allegro-smart-bulk.md`) confirmed that all atomic primitives (single-offer creation, fan-out pattern, AI description) already exist — bulk is composition work, not a new architectural concept

### Gate A resolutions (2026-05-15)

The four ambiguity points surfaced in Phase A were resolved as follows:

#### A1. Bulk-listing shape — **inline multi-select on Products page**

**Decision:** rather than a separate wizard route, the operator gets a **checkbox column on the existing Products page** with a "Create Allegro offers" action that triggers a shared-config modal/sidebar over the selected items. Each selected product produces one offer-creation job using the existing fan-out pattern.

**Why this shape (over the alternatives originally surfaced):**

- A separate multi-step wizard adds UX overhead the primary persona (shop owner — see §2) doesn't need
- Inline multi-select matches the muscle memory of every product-list operator workflow (file manager, mail client, ecommerce admin)
- Lower implementation effort than full wizard; reuses existing Products page state, filters, search
- Rule-engine "auto-list on PS publish" (Option B in original ambiguity list) and CSV upload (Option C) are explicitly deferred — they remain candidate future features but are out of this Product Design's scope

#### A2. Allegro Smart! support scope — **deferred to Phase B research**

**Decision:** the right scope for Smart! support cannot be decided in Phase A without understanding the actual mechanics of Allegro Smart! enrollment, the seller-side configuration model, and what changes in the order flow when an offer is Smart-eligible. Phase B will research this and feed evidence into Phase C scope decisions.

**Research questions for Phase B (delegated to `product-researcher` subagent):**
- How does a seller turn on Allegro Smart! eligibility — account-level toggle, per-shipping-config, per-offer, or automatic?
- What changes in the buyer/seller/OpenLinker order flow when an offer is Smart-eligible? (buyer experience, seller fees, order events, shipping responsibilities)
- What does the Allegro API expose to sellers about Smart eligibility — flags, endpoints, webhook events?
- What are common seller-side issues with Smart! surfaced in PL e-commerce communities?

#### A3. Primary persona — **shop owner**

**Decision:** the primary persona is the **shop owner** (single-shop in-house operator). Agency-operator is no longer the primary persona; if agencies use OpenLinker on behalf of clients, they will use the same UX as the shop owner — there is no separate agency-optimized flow.

**Why:** OpenLinker's product surface is for end users (shop owners). Agency-delivery is a go-to-market channel, not a UX target. Optimizing for shop-owner UX yields a product that agencies can also deploy without modification; optimizing for agency-operator first would produce a product that shop owners find too technical.

#### A4. UVP framing — **dropped at feature level**

**Decision:** unique-value-proposition framing is a product/marketing concern at the OpenLinker level, not a per-feature concern. At feature level, the relevant question is simply: **"does this clearly deliver value to the target user?"** — yes/no. This product spec will not justify the feature against BaseLinker; OpenLinker's overall positioning answers that question separately.

---

## 2. Affected persona

> **Phase A complete — confirmed by maintainer at Gate A on 2026-05-15**

### Primary persona: shop owner

- **Role:** in-house operator (often the shop owner themselves) at a PL e-commerce shop running PrestaShop and selling on Allegro
- **Company size:** small to mid-sized — 1 to ~30 people
- **Catalog volume:** 100–1,000 SKUs; occasional bulk listing during seasonal launches (1–4 times/year) plus continuous incremental listing for new products (5–30/month)
- **Sophistication:** non-technical to operator-level — comfortable with admin UIs and standard SaaS patterns; low tolerance for technical error messages, API references, or developer-facing terminology
- **Geography:** PL primary
- **What they value:**
  - UX hand-holding (bulk listing is occasional — they'll forget how between launches)
  - Preview before submit (this is publishing publicly; mistakes are visible to buyers)
  - Visual feedback during submission (especially when listing 50+ products)
  - Clear error recovery when something fails partway through a batch
- **Trigger events:**
  - Initial shop launch on Allegro (one-time onboarding of existing catalog)
  - New product range / seasonal collection launch (occasional, 20–100 SKUs)
  - Migration from BaseLinker or other tool (one-time, full catalog)

### Agency-delivery context (not a separate persona)

Agencies will install OpenLinker on behalf of shop-owner clients. They use **the same UX** as shop owners — there is no separate agency-mode. This means:

- Bulk listing UX optimizes for the shop owner's mental model and tolerance
- Agencies benefit from this when they hand the shop over to the owner post-installation
- If agencies want bulk-onboarding efficiency for repeat use, they get it via the same UX shop owners use (no agency-specific shortcuts in v1)

---

## 3. Evidence & user research

> **Phase B complete — 2026-05-15**. Confirmed at Gate B by maintainer (pending).

### 3.1 Existing internal evidence

Pre-refinement draft (`docs/plans/implementation-plan-726-allegro-smart-bulk.md`) contains:

- **Codebase audit** confirming that all atomic primitives for bulk creation already exist:
  - `OfferBuilderService`, `OfferCreationExecutionService`, `marketplace.offer.create` job handler, fan-out pattern (`MasterProductSyncAllHandler`), AI description infra (`ContentSuggestionService`), per-product idempotency via `OfferCreationRecord`
  - Verdict: **bulk listing is composition work, not a new architectural concept**
- **Initial Allegro Smart! hypothesis** (later revised in §3.2 below) that Smart support required a "delivery configuration picker + pre-submit validation" of ~1 week effort
- **Reusable as evidence**: codebase audit findings. **Discarded as evidence**: original Smart! scope hypothesis (replaced by §3.2 research findings)

### 3.2 Allegro Smart! research findings (external)

Conducted by `product-researcher` subagent, 2026-05-15. Full report archived (see decision log §10). Citations and confidence assessments at:
- [Allegro Help: Smart! for business sellers](https://help.allegro.com/en/sell/a/allegro-smart-on-allegro-pl-information-for-sellers-with-a-business-account-LR8j8Y26GTR)
- [Allegro Help: Allegro Delivery program](https://help.allegro.com/en/sell/a/the-allegro-delivery-program-information-for-sellers-MR7exl1wYS4)
- [Allegro Help: free delivery & commission](https://help.allegro.com/en/sell/a/free-delivery-why-it-is-worth-enabling-it-in-your-offers-and-how-to-do-it-2YbEaeZxoiB)
- [Allegro Developer changelog (2026-04-28 `smartDeliveryMethods` deprecation)](https://developer.allegro.pl/changelog)
- [Media Allegro: nowy próg 49.90 zł od 2026-03-02](https://media.allegro.pl/446561-smart-jeszcze-prostszy-allegro-wprowadzi-jeden-prog-darmowej-dostawy-dla-wszystkich-przesylek-allegro-smart)
- PL seller community signal: [Społeczność Allegro – prawdziwe koszty Smart](https://spolecznosc.allegro.pl/t5/smart-dla-sprzedawc%C3%B3w/prawdziwe-koszty-smart/td-p/876738), [pawelkasza.pl blog](https://pawelkasza.pl/blog/17/jak-nie-poplynac-z-allegro-smart-nowy-kosztowny-standard), [Subiektywnie o Finansach](https://subiektywnieofinansach.pl/sprzedaz-na-allegro-jest-coraz-trudniejsza/)

**Key findings that change Phase A assumptions:**

1. **Smart! is automatic, not a per-offer toggle.** A seller cannot "enable Smart" on individual offers. Eligibility is *derived server-side by Allegro* from the offer's shipping-rate composition and seller-account quality conditions. The seller's only direct lever is which shipping-rate package (`shippingRates.id`) the offer uses.

2. **The create-offer payload has no Smart field.** `POST /sale/product-offers` does not accept any Smart-related parameter. Setting a Smart-eligible shipping-rate package is the entire indirect path. This **collapses Phase A option A2 (i) — "delivery configuration picker" — to "the picker we'd need for bulk creation anyway"**.

3. **Smart classification is read-only and post-hoc.** Allegro exposes `GET /sale/offers/{offerId}/smart` returning:
   - `classification.fulfilled: boolean`
   - `conditions[]` with `code`, `description`, `fulfilled`, plus the specific `failedDeliveryMethods[]` that caused a fail
   - `scheduledForReclassification: boolean`
   
   **This is a high-value, cheap surface for OpenLinker**: one API call after offer creation, one DB column, one UI badge. Lets the seller see "this offer didn't qualify for Smart because deliveryMethodPrices on courier exceeds limit" without leaving OL.

4. **The order payload appears NOT to surface Smart membership.** `GET /order/checkout-forms/{id}` and order webhooks don't carry a Smart flag, per absent mention in Allegro help docs. **Open question** — needs a real Smart-buyer test purchase to definitively verify. If correct, OL has no order-side Smart integration to do.

5. **Seller-account-level Smart eligibility exists.** `GET /sale/smart` exposes whether the seller account itself meets the conditions (sales quality, on-time payments, return address, return terms). A cheap pre-bulk-submit guard: warn the seller "your account does not currently meet Smart conditions — offers will not earn the badge".

6. **Seller pain on Smart! is structural (cost), not API friction.** Forum signal consistently shows seller complaints about returns absorbed by seller, weight-surcharges arriving weeks later, "can't opt out per-offer" frustration. **None of these are bulk-creation scope.** They are real product opportunities for OL, but they belong in separate future features (returns analytics, cost-attribution reports), not this Product Design.

7. **Competitor gap.** Neither BaseLinker nor ChannelEngine surfaces `/sale/offers/{id}/smart` classification + failure reasons in their UI per public docs. Low-cost differentiator if OL does.

8. **March 2026 threshold change.** Single 49.90 PLN free-shipping threshold replaces the old 45 / 65 PLN split as of 2026-03-02. No known API impact, but worth noting for any UI copy that references the threshold.

### 3.3 Phase B impact on problem statement and persona

- **Problem statement (§1):** strengthened. The "shop owner can't bulk-list from OL" problem is unchanged; the Smart! secondary problem is materially smaller than originally hypothesized (almost no new work) and one part of it (post-create Smart classification) becomes an unexpected small win.
- **Affected persona (§2):** unchanged. Shop owner remains primary.
- **No persona change. No problem-statement re-frame. Gate B is a forward gate, not a regression gate.**

### 3.4 Phase B round 2 — operational mechanics

Round 1 left three open questions about how Smart actually works contractually. Round 2 research (2026-05-15) resolved all three and surfaced a new fundamental scope question.

**Three contractual paths exist for Smart-eligible shipping** (this was not surfaced in round 1):

| Path | Contract structure | Label generation | InPost integration relevance |
|---|---|---|---|
| **(P1) Own-contract carrier** | Seller has own InPost / DPD / DHL agreement; uses their own account | Seller uses own carrier panel (e.g., InPost Manager Paczek) — covered by [#727 InPost integration](https://github.com/openlinker-project/openlinker/issues/727) | ✅ Fully covered by #727 |
| **(P2) Allegro Delivery (Allegro Dostawa)** | Seller's contract is with **Allegro**; Allegro holds InPost/DPD/DHL/ORLEN agreements and bills seller monthly | Labels generated **only** via Allegro's `/shipment-management/*` REST API ("Wysyłam z Allegro") | ❌ NOT covered by #727 — requires new Allegro shipment-management integration |
| **(P3) Allegro One** (Punkt / Box / Kurier) | Allegro's own last-mile network — only accessible *within* Allegro Delivery | Labels mandatory via `/shipment-management/*` | ❌ NOT covered by #727 — same |

Sources: [Allegro Help — Delivery for sellers](https://help.allegro.com/en/sell/a/the-allegro-delivery-program-information-for-sellers-MR7exl1wYS4), [Help — Allegro One within Delivery](https://help.allegro.com/en/sell/a/the-allegro-one-delivery-options-within-allegro-delivery-5LaWAD2AAfg), [developer.allegro.pl — Wysyłam z Allegro tutorial](https://developer.allegro.pl/tutorials/jak-zarzadzac-przesylkami-przez-wysylam-z-allegro-LRVjK7K21sY).

**Resolution of round 1 open questions:**

- **OQ-B1 RESOLVED**: `GET /order/checkout-forms/{id}` returns `delivery.smart: boolean` per [developer.allegro.pl orders tutorial](https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR). `true` = buyer used Smart on this order. **Confirmed: OL can tag every ingested order accurately with Smart status.** No buyer-subscription-level flag exists; only per-order.

- **OQ-B2 PARTIALLY RESOLVED**: `smartDeliveryMethods` removal date is **2026-07-28** (not 2026-04-28 as originally noted — that was the changelog announcement). The endpoint `/sale/offers/{offerId}/smart` itself **stays**; only the per-delivery-method ID arrays go away. Replacement contract is **not yet documented publicly** — requires direct API probe near the deadline. **Risk for OL**: low — we wouldn't depend on per-method enumeration for the bulk-create v1 anyway, only the offer-level `classification.fulfilled` boolean.

- **OQ-B3 RESOLVED**: not relevant in this form. Smart eligibility is server-side derived; OL doesn't need to maintain a delivery-method-to-Smart mapping.

### 3.5 Implications for product scope (fundamental)

**The new scope question Phase B surfaced** (this is the most important Phase C input):

**Which contractual path does this Product Design support?**

- **(S1) P1 only — own-contract carriers**: bulk listing works; shipment generation happens in seller's own carrier panel via #727 (InPost) and future courier integrations. Smart eligibility is automatic for offers in Smart-eligible price lists. Sellers using Allegro Delivery (P2) **cannot use this version of OL for end-to-end Smart fulfillment** — they'd list via OL but generate labels in Allegro panel. Acceptable cut for v1.

- **(S2) P1 + P2 — both**: bulk listing PLUS new `/shipment-management/*` integration enabling label generation through Allegro for Allegro Delivery sellers. Materially larger scope; likely a separate Product Design issue (sibling to #726 / #727).

- **(S3) P2-first**: optimize for Allegro Delivery sellers, defer own-carrier flow. Doesn't match the Q1 wedge (#727 already targets own-InPost).

**Hypothesis**: S1 fits the Q1 wedge (PL Allegro + PrestaShop + InPost own-contract). Allegro Delivery integration (`/shipment-management/*`) is a real future need but separate Product Design.

### 3.6 Net effect on Smart!-in-this-Product-Design scope

After both research rounds, here is what's **legitimately in scope for #726 regarding Smart!**:

| Item | In scope? | Reason | Effort |
|---|:---:|---|---|
| Operator picks shipping-rate package in bulk wizard | ✅ | Required for offer create regardless of Smart | — |
| OL surfaces post-create Smart classification (`/sale/offers/{id}/smart`) per offer | ✅ | Cheap differentiator — one API call, one badge, one column | ~1-2 days |
| OL tags incoming Allegro orders with `delivery.smart` boolean | ✅ | Trivial lift in `AllegroOrderSourceAdapter`; unlocks future Smart-aware features | ~0.5 day |
| Pre-bulk-submit account-level Smart eligibility check (`GET /sale/smart`) | ⚠️ Optional | Nice-to-have; can be Phase D scope decision | ~0.5 day |
| Smart-specific delivery rate guidance in wizard ("this rate WILL/WON'T qualify") | ❌ Out | Requires `/sale/offers/{id}/smart` against draft offers — adds complexity, low value vs. just showing post-create classification | — |
| **Ship with Allegro (`/shipment-management/*`)** integration for P2/P3 sellers | ❌ Out | **Separate Product Design issue** — material scope, distinct from bulk listing | — |
| Smart returns analytics | ❌ Out | Separate future feature | — |
| Smart top-up fee tracking | ❌ Out | Settlement-level, not order-level | — |

---

## 4. Solution exploration

> **Phase C complete — 2026-05-15**. Confirmed at Gate C by maintainer.

### 4.1 Chosen shape — "Approval flow with EAN auto-match"

The bulk listing workflow uses the following flow:

```
Products page (multi-select)
  → "Proceed" (lightweight config: Allegro connection + shipping rate package)
  → Auto-match (background: EAN→Allegro category resolution, account-level Smart check)
  → Review table (one row per product, edit-via-modal per row)
  → "Approve all" (enabled when all rows valid)
  → Progress page (real-time per-product job status)
  → Final summary (counts, retry per failed)
```

**Key feature:** EAN-based category auto-match. For each selected product with a valid EAN, OL queries Allegro's `/sale/products?phrase={ean}` (reusing existing #431 smart-link infrastructure) and auto-fills:
- Allegro category from the matched product card
- Allegro product card link (avoids re-creating cards — cheaper for seller, better Allegro positioning)
- Suggested parameter values (brand, manufacturer, etc.) from the card

For products without EAN match (no EAN, no match, or multi-match), the row is flagged for manual category pick via the edit modal.

### 4.2 Detailed flow

1. **Selection** — multi-select checkboxes on the existing Products page; bulk action bar appears: "Create Allegro offers (N)"
2. **Lightweight config modal** — Allegro connection (auto if single), shipping rate package (with Smart-eligibility badge per rate)
3. **Auto-match background resolution** — throttled-parallel EAN lookups + `GET /sale/smart` account-level check; partial-blocking UI up to ~15s
4. **Review table** — one row per product with status icons:
   - ✅ matched — auto-filled, ready to submit
   - ⚠️ multi-match — modal opens with candidate cards (top match preselected, alternatives expandable)
   - ❌ no-match / no-ean — manual category pick required via modal
   - ⚠️ Smart-eligibility warning per row (if applicable)
5. **Edit modal per row** — full Allegro listing detail form (reuses single-offer wizard components): title, category, description (with per-product AI toggle), price, stock, parameters, images, variant matrix preview
6. **Approve** — button disabled while any ⚠️ or ❌ rows remain; confirmation modal before submit
7. **Progress page** — real-time status, retry per failed offer
8. **Final summary** — succeeded/failed counts, links to created offers, Smart classification badge per offer

### 4.3 Confirmed sub-decisions

| ID | Decision | Reasoning |
|---|---|---|
| SC-1 | AI description: per-product toggle in edit modal (default OFF) | Modal already has all editing controls; per-product granularity matches the "approve each row" gate; defaults preserve user control |
| SC-2 | Variants: auto-collapse PS product → 1 Allegro offer with Allegro variant matrix | Matches existing single-offer behavior; per-variant separate offers is v2 if demand |
| SC-3 | Failure semantics: partial-failure with per-job retry | Aligns with existing `OfferCreationExecutionService` outcome semantics; user retries individual failures from summary |
| SC-4 | Account-level Smart check: included in v1 | Half-day work; prevents user-confusion when offers fail to get Smart badge |

### 4.4 Resolved open questions

| ID | Question | Resolution |
|---|---|---|
| OQ-C1 | Multi-match EAN UX | **(B)** Top match by Allegro relevance ranking preselected; alternatives expandable in modal |
| OQ-C2 | Auto-match timeout behavior | **(B)** Partial-blocking spinner up to ~15s; then show partial results with un-resolved rows flagged ❌ |
| OQ-C3 | Auto-match result caching | **(B)** Per-connection Redis cache with 24h TTL |
| OQ-C4 | Fallback for products without EAN | **(A)** Always manual category pick (AI category suggestion is v2 polish) |

### 4.5 EAN auto-match — implementation notes (for Tier 2)

- **Reuse**: `libs/integrations/allegro/src/infrastructure/util/resolve-allegro-product-card-by-ean.ts` (#431) as primitive
- **New service**: `resolveCategoriesForBatchByEan` — batch wrapper with throttled-parallel + Redis cache + per-EAN result envelope (`matched | multi-match | no-ean | no-match`)
- **Performance**: throttle to ~5-10 req/sec via existing `AllegroHttpClient` patterns; 50-product batch resolves in 5-15s
- **Caching**: Redis key `allegro:ean-match:{connectionId}:{ean}` → JSON result; 24h TTL; invalidate-on-product-card-update is v2 polish (not in v1)
- **Bonus side-effect**: matched offers smart-link to existing Allegro product cards — no card re-creation, better Allegro positioning, lower listing rejection rate

### 4.6 Effort estimate

- Domain (BulkOfferCreationBatch + repository): ~5 days
- Auto-match service (batch wrapper + cache + throttling): ~3 days
- HTTP API (bulk-create + progress endpoints): ~3 days
- Worker handler (bulk-aware + AI description integration): ~2 days
- FE Products page multi-select: ~2 days
- FE review table + per-row edit modal: ~5 days
- FE progress + summary page: ~3 days
- Polish (error handling, integration tests, documentation): ~3 days

**Total: ~5-6 weeks wall-clock with 1 backend + 1 FE dev in parallel.**

---

## 5. Product specification

> **Phase D complete — 2026-05-15**. Pending Gate D approval to commit engineering time.

### 5.1 User stories

**US-1 — Bulk selection and submission**

> As a shop owner, I want to select multiple products on the Products page and create Allegro offers for all of them in one workflow, so that I can onboard my catalog or expand it without doing 50 separate offer creations.

**US-2 — Automatic category resolution**

> As a shop owner, I want OL to automatically suggest the Allegro category for each selected product based on its EAN, so that I don't have to manually pick categories for products that already exist in Allegro's catalog.

**US-3 — Per-product review and edit**

> As a shop owner, I want to review and edit each product's Allegro listing details before submitting, so that I have full control over what gets published.

**US-4 — Real-time progress feedback**

> As a shop owner, I want to see real-time progress when offers are being created, so that I know which products succeeded and which failed without having to refresh the page.

**US-5 — Retry only failed offers**

> As a shop owner, I want to retry only the failed offers from a batch, so that I don't have to re-submit successful ones or re-do the whole batch.

**US-6 — Smart classification visibility**

> As a shop owner, I want to see Allegro Smart eligibility status for each created offer, so that I know which offers will benefit from Smart buyer visibility — and which won't, and why.

**US-7 — Pre-submit account-level Smart warning**

> As a shop owner, I want to be warned before bulk submit if my Allegro account doesn't meet Smart conditions, so that I'm not surprised when no offers in my batch qualify for the Smart badge.

**US-8 — AI-assisted descriptions per product**

> As a shop owner, I want to optionally use AI to generate an Allegro-optimized description when editing an individual offer, so that I save time on description writing without losing per-product control over the output.

### 5.2 Acceptance criteria

User-visible criteria (technical AC will be defined per implementation issue in Tier 2).

**AC-1** (covers US-1): operator can select 1–100 products on the Products page via checkbox column; "Create Allegro offers" action appears in bulk action bar; clicking opens a lightweight modal asking for Allegro connection (if multiple available) and shipping rate package; clicking "Proceed" triggers the review table flow.

**AC-2** (covers US-2): when the review table opens, OL has already attempted EAN-based category resolution for every selected product; products with a single Allegro product card match have category auto-filled; products with multiple matches show ⚠️ icon with "Pick a card" link in the row; products without EAN match show ❌ icon with "Manual category required".

**AC-3** (covers US-3): clicking the Edit button in any row opens a modal showing the full Allegro listing details for that product (title, category, description, price, stock, parameters, images, variants preview); saving the modal returns to the review table with the row updated; cancel discards changes.

**AC-4** (covers US-1+US-3): "Approve all" button on the review table is disabled while any row has ⚠️ or ❌ status; clicking when enabled shows confirmation modal "Create N Allegro offers?" with publish-now / publish-as-draft toggle; submit redirects to the batch progress page.

**AC-5** (covers US-4): the batch progress page polls every 5 seconds and shows per-product status (pending → running → succeeded with Allegro offer URL link, or failed with error message); page also shows aggregate counts and overall batch status.

**AC-6** (covers US-5): when a row shows status `failed`, a "Retry" button is visible inline; clicking re-enqueues only that single offer-creation job; "Retry all failed" button at the top of the page re-enqueues all failed offers in the batch.

**AC-7** (covers US-6): after each row enters status `succeeded`, OL calls `GET /sale/offers/{offerId}/smart` and stores the result; the row in progress + summary view shows a Smart badge: ✅ green if `classification.fulfilled === true`, ⚠️ amber with failure reasons (from `classification.conditions[].description`) if not.

**AC-8** (covers US-7): if `GET /sale/smart` (account-level) returns `eligible: false` during pre-submit auto-match, a banner appears at the top of the review table: "Your Allegro account does not currently meet Smart conditions — these offers will not earn the Smart badge regardless of shipping configuration. [Show why]" — operator can still proceed if they wish.

**AC-9** (covers US-8): the per-row edit modal has a "Generate description with AI" toggle in the description field area; toggle is OFF by default; when toggled ON, OL calls `ContentSuggestionService.suggestDescription` with `channel='allegro'` for that product and replaces the description field with AI output; operator can edit the AI output before saving the modal.

> *(AC-10 and AC-11 from earlier drafts moved to implementation plans — they were engineering concerns (rate-limit handling, order payload field propagation) dressed as user-visible AC. The `delivery.smart` order propagation is captured as a separate implementation issue (#726.5 in the implementation breakdown).)*

---

## 6. Out of scope

> **Phase D complete — 2026-05-15**. Top items someone might actually ask about. Not an exhaustive future-feature catalog (per [Stage 1 calibration](../contributors/refinement-workflow.md#project-stage-calibration)).

| Item | Reason |
|---|---|
| **CSV import** as input source | Shop catalog is the input. CSV adds parsing/validation complexity without proportional value at this stage. |
| **Auto-list on PrestaShop product publish** (rule engine) | Different solution shape (event-driven, not user-initiated); separate Product Design if demand surfaces |
| **Bulk update of existing offers** (price, stock, parameters) | Different workflow operating on existing mappings, not shop catalog. Separate Product Design. |
| **Per-PS-variant separate Allegro offers** | v1 collapses to Allegro variant matrix (SC-2); "split variants" mode is v2 if demand |
| **AI-suggested categories** for products without EAN match | OQ-C4 — manual pick in v1. AI category suggestions only if EAN auto-match accuracy is provably insufficient |
| **Shipment generation / label printing** | Covered by [#727 InPost integration](https://github.com/openlinker-project/openlinker/issues/727) (P1) and [#732 Wysyłam z Allegro integration](https://github.com/openlinker-project/openlinker/issues/732) (P2/P3) |
| **OMP (PrestaShop) update on offer creation** | Listing creation does not change PS state — PS owns the product, OL creates the Allegro mirror. (Shipment-on-OMP-update IS in scope of #727/#732 via shared ADR.) |

---

## 7. Definition of done

> **Phase D complete — 2026-05-15**. Stage 1 qualitative bullets — quantitative metrics deferred until OL has telemetry infra and a measurable user base ([calibration](../contributors/refinement-workflow.md#project-stage-calibration)).

The feature is considered successfully delivered when:

- **The maintainer (or a co-maintainer) has used it for their own real shop** to list ≥20 products in one batch, without falling back to manual Allegro panel listing for any product
- **At least 2 design-partner shops have used it in production** for ≥30 days without abandonment (i.e., they continue using OL for new offer creation, not switching back to BaseLinker or manual)
- **No Smart-related confusion** surfaces from those users — they understand why each offer did/didn't get the Smart badge
- **EAN auto-match feels useful in practice** — design partners report it saves time vs picking categories manually for the majority of their products
- **AI description toggle is preserved (not overwritten) by users who enable it** more often than not — qualitative observation, no instrumentation

If any of these prove false within 60 days of release to design partners, this Product Design returns to Phase A for re-review.

---

## 8. Risks

> **Phase D complete — 2026-05-15**. Product-direction risks only. Engineering risks (rate limits, API drift, schema migrations) belong in Tier 2 implementation plans.

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | Shop owners find the edit modal too complex and abandon mid-flow | Modal reuses existing single-offer wizard components — the operator has already used this UX for single offers. Validate with 2-3 design partners before broader release. |
| **R2** | EAN auto-match accuracy too low — most rows need manual fix anyway, feature delivers no value over single-offer creation | Reusing established #431 smart-link primitive (Allegro's own product card lookup). Worst case: feature still beats no-bulk because per-row modal is still faster than N separate single-offer creations. |
| **R3** | Shop owners on Allegro Delivery (P2/P3) hit a wall at shipment generation after listing — broken end-to-end flow | [#732 Wysyłam z Allegro integration](https://github.com/openlinker-project/openlinker/issues/732) explicitly tracks this gap. v1 ships with a status banner warning Allegro Delivery sellers that label generation isn't yet supported. Communication in release notes. |
| **R4** | AI description quality too low — operators turn it off, we wasted dev time | Incremental cost is just the modal toggle (AI infra already exists). If preservation rate proves consistently low, the toggle can be removed without losing core feature value. |

---

## 9. Implementation breakdown

> **Phase E complete — 2026-05-15**. Gate D = YES.

Nine implementation issues spawned, each independently shippable. Engineering risks and detailed effort breakdowns live in each issue + Tier 2 `/plan` outputs.

| # | Title | Effort | Blocks |
|---|---|:---:|---|
| [#734](https://github.com/openlinker-project/openlinker/issues/734) | `BulkOfferCreationBatch` domain entity + repository + migration | S (~5d) | #736, #737 |
| [#735](https://github.com/openlinker-project/openlinker/issues/735) | EAN-based bulk category auto-match service | S (~3d) | #740 |
| [#736](https://github.com/openlinker-project/openlinker/issues/736) | Bulk submission service + HTTP API + progress endpoint | S (~3d) | #740, #741 |
| [#737](https://github.com/openlinker-project/openlinker/issues/737) | Bulk-aware `marketplace.offer.create` handler + AI description + Smart classification readback | M (~3d) | #741 |
| [#738](https://github.com/openlinker-project/openlinker/issues/738) | Propagate `delivery.smart` from order payload to `OrderRecord` | S (~0.5–1d) | — (independent) |
| [#739](https://github.com/openlinker-project/openlinker/issues/739) | Products page multi-select + bulk action bar | S (~2d) | #740 |
| [#740](https://github.com/openlinker-project/openlinker/issues/740) | Bulk listing wizard (config modal + review table + per-row edit modal) | M (~5d) | #741 |
| [#741](https://github.com/openlinker-project/openlinker/issues/741) | Batch progress page + final summary | S (~3d) | #742 |
| [#742](https://github.com/openlinker-project/openlinker/issues/742) | Retry-failed endpoint + integration tests + polish | S (~3d) | — (last child) |

**Critical path:** #734 → #736 → #737 / #740 → #741 → #742. Parallelizable: #735 (auto-match), #738 (delivery.smart), #739 (multi-select) can start immediately.

**Total wall-clock estimate:** 5–6 weeks with 1 backend + 1 FE dev in parallel.

**Sibling Product Design:** [#732 — Wysyłam z Allegro integration (P2/P3 shipping)](https://github.com/openlinker-project/openlinker/issues/732) — closes the end-to-end flow for Allegro Delivery sellers, separate from this spec.

**ADRs to file during implementation** (only if architectural reviewer requests):
- ADR-XXX: Bulk offer creation as application-layer fan-out (not adapter capability) — filed during #734 if needed
- Existing ADR practice introduced via #725

---

## 10. Decision log

| Date | Phase | Decision | Reasoning | Decider |
|---|---|---|---|---|
| 2026-05-15 | Pre-A | Convert #726 from discovery/refinement issue to Product Design issue under new workflow | Demonstrates two-tier refinement on a real, in-flight issue; preserves pre-refinement research as Phase B evidence input | @piotrswierzy (via collaborative workflow design) |
| 2026-05-15 | Pre-A | Pre-refinement draft preserved at `docs/plans/implementation-plan-726-allegro-smart-bulk.md` with not-authoritative warning | Codebase audit and Allegro Smart! research are reusable as evidence; product scope decisions in the draft are hypotheses to be re-validated | @piotrswierzy |
| 2026-05-15 | A→B | Phase A confirmed; primary persona = shop owner; bulk shape = inline multi-select on Products page (not separate wizard); Smart! scope deferred to Phase B research; UVP framing dropped at feature level | See §1 ambiguity resolutions A1-A4 | @piotrswierzy |
| 2026-05-15 | B | Phase B round 1: Allegro Smart! is automatic (not per-offer toggle), driven by shipping-rate composition. Create-offer payload has no Smart field. Read-only classification available via `/sale/offers/{id}/smart` | See §3.2 research findings | product-researcher subagent + @piotrswierzy |
| 2026-05-15 | B | Phase B round 2 surfaced 3 contractual paths (P1/P2/P3). `delivery.smart` boolean confirmed on order payload. `smartDeliveryMethods` deprecation date corrected to 2026-07-28 | See §3.4 contractual paths table | product-researcher subagent + @piotrswierzy |
| 2026-05-15 | B→C | Product-level coverage decision: P1+P2+P3 required. P2/P3 Wysyłam z Allegro integration extracted as separate Product Design [#732](https://github.com/openlinker-project/openlinker/issues/732). #726 stays focused on bulk listing CREATION (which works across all 3 paths automatically) | Bulk listing creation is path-agnostic at the offer level; shipping integration is the path-dependent concern | @piotrswierzy |
| 2026-05-15 | B→C | Cross-cutting decision: when OL generates labels (in #727 or #732), OMP (PrestaShop) MUST be updated with shipment status + tracking#. Pattern to be captured in shared ADR ("Shipment lifecycle event propagation pattern") so #727, #732, and future courier integrations follow same convention | Standard fulfillment-status-sync pattern; OMP authoritativeness for downstream order state requires it | @piotrswierzy |
| 2026-05-15 | Gate B | Gate B passed. Evidence supports problem statement; persona unchanged; scope clarified. Proceeding to Phase C. | All Phase B open questions resolved or deferred non-blockingly | @piotrswierzy |
| 2026-05-15 | C | Shape chosen: Candidate E — "Approval flow with EAN auto-match". Multi-select on Products page → lightweight config → background auto-match → review table → per-row modal edit → approve → progress → summary | Highest listing quality + concrete value-add via EAN auto-match (reuses #431 smart-link); modal-per-row matches operator mental model | @piotrswierzy |
| 2026-05-15 | C | Sub-decisions SC-1 through SC-4 confirmed: AI description per-product toggle in modal (default OFF); auto-collapse variants to Allegro matrix; partial-failure with per-job retry; v1 includes account-level Smart check | See §4.3 reasoning | @piotrswierzy |
| 2026-05-15 | C | Open questions OQ-C1 through OQ-C4 resolved: top match preselected with alternatives expandable; partial-blocking spinner up to 15s; Redis cache 24h TTL; manual category pick for no-EAN/no-match products in v1 | See §4.4 | @piotrswierzy |
| 2026-05-15 | Gate C | Gate C passed. Shape locked, sub-decisions confirmed. Proceeding to Phase D specification. | — | @piotrswierzy |
| 2026-05-15 | D | Phase D specification written: 8 user stories, 9 acceptance criteria, 7 explicit out-of-scope items, qualitative definition of done, 4 product-direction risks | See §5-§8 | @piotrswierzy |
| 2026-05-15 | D-revision | Trimmed Phase D output for Stage-1-OSS calibration (introduced in workflow doc as part of this PR). Removed: persona-fit verification subsection (circular), AC-10/AC-11 (engineering concerns dressed as user-visible AC), exhaustive 20-item out-of-scope list, quantitative success metrics with %s (no telemetry to measure them), anti-metrics (same), 10-risk catalog including engineering risks. Kept: user stories, user-visible AC, top-7 out-of-scope, qualitative definition of done, top-4 product risks. Same conviction, less compliance theatre. | Stage-1 calibration: filler sections are worse than missing sections | @piotrswierzy |
