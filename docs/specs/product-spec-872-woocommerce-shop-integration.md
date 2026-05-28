# Product Spec — #872 WooCommerce shop integration

**Status:** phase E complete — refinement done (Gate D = YES, 2026-05-28)
**Parent issue:** [#872](https://github.com/openlinker-project/openlinker/issues/872)
**Started:** 2026-05-28
**Last updated:** 2026-05-28

---

## 1. Problem

OpenLinker today reaches PL Allegro sellers **only** if their shop runs PrestaShop — which, per Phase B telemetry, is just **~9% of PL self-hosted e-commerce stores**. The dominant platform is **WooCommerce at ~55%** (six times PS's share). An Allegro seller whose shop runs WC has no OpenLinker path; they must use BaseLinker (the SaaS we're positioning against, with recently-hiked per-order pricing), a WordPress-plugin-marketplace integration (varied quality, narrow scope, often abandoned), or hand-roll their own. The current OL adapter set reaches the smaller slice of the PL self-hosted shop market; reaching WC merchants is structurally where the market *is*, not a peripheral extension.

Adding WooCommerce as a master shop adapter at PrestaShop parity closes that gap. It extends the existing PL Allegro+shop+InPost wedge to the second-most-common PL self-hosted shop platform without drifting into a new vertical — same buyer, same marketplace, same fulfilment partner; only the master shop differs. It is also the foundational second shop adapter: building it validates that the hexagonal capability ports (`ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager`) hold under a structurally-different shop API (WC REST v3 vs PS webservice; HPOS vs WP-posts dual model; WC variations vs PS combinations) and surfaces any PS-leaking assumptions in core that need rewiring.

Phase B quantifies the PL Allegro+WC cohort and characterises the dominant pain shape (likely daily integration friction — unreliable stock sync, dropped orders, manual reconciliation). The OL value proposition for WC merchants — open-source, self-hosted, no per-order fees, no vendor lock-in — is structurally identical to the proposition for PS merchants; what differs is the alternative landscape WC merchants are choosing OL *over* (a fragmented plugin marketplace, not an agency-installed stack).

---

## 2. Affected persona

### Primary persona

PL Allegro seller running their primary shop on **WooCommerce**, **SMB (1–5 person ops team)** rather than solo merchant.

| Axis | Value |
|---|---|
| **Who** | PL Allegro seller, primary shop on WooCommerce |
| **Company size** | SMB — 1–5 person operations team |
| **Sophistication** | Comfortable installing WP plugins, managing REST API keys, and running a Docker stack on a VPS (or paying someone to). Not typically a PHP/JS developer. Operator-UI driven for daily work |
| **Volume / scale** | 50–500 SKUs per shop, 10–100 orders/day (mirrors the assumed PS-cohort scale — Phase B validates the WC-side number) |
| **Geographic focus** | Poland (same wedge as the PS adapter) |
| **Why on WC** (vs PS) | Came from a WordPress site, picked WC for plugin-ecosystem flexibility, or inherited from a WP-first developer |
| **Current integration spend** | €20–€100/mo on BaseLinker Cloud at small-volume tiers, *or* €0 on a free/cheap WP plugin (and absorbing the cost in manual reconciliation time) |

### Why SMB and not solo

The chosen capability scope is full PS-parity, which is a self-host-shaped product. SMB merchants either run their own VPS or have a developer who can; solo merchants typically can't (or won't) and need a hosted/turnkey product, which is out of this spec's scope. **Solo merchants are a secondary persona** — relevant once a hosted OL offering exists, irrelevant for this adapter's v1.

### Agency-managed vs operator-managed

WC stores skew operator-managed (vs PS, which often has an agency installer in the loop). This shifts the support model (more direct contact, less "ask your dev"), but does not change adapter behaviour itself.

---

## 3. Evidence & user research

Research conducted 2026-05-28 by the `product-researcher` subagent. Sources cited inline. **Honest gaps marked explicitly** rather than papered over with invented numbers.

### Cohort sizing

- **PL self-hosted e-commerce platform mix** (telemetry from [ShopRank, March 2026](https://shoprank.com/countries/poland), n=137.4k PL stores): **WooCommerce 54.7%** (~106k stores), Custom 11.0%, **PrestaShop 9.2%**. Among PL stores with physical delivery: WooCommerce 37.0% (~47k), PrestaShop 13.1%. Methodology is plugin/fingerprint scraping (BuiltWith-class), so treat numbers as order-of-magnitude — but the *ratio* (WC ≫ PS) is robust.
- **Allegro+WC integration plugin install counts** as a proxy for the cohort already actively trying to integrate:
  - [BaseLinker WC plugin](https://wordpress.org/plugins/baselinker-woo/) — **4,000+ active installs**, last updated April 2026
  - [WP Desk Allegro WooCommerce](https://wpdesk.net/products/allegro-woocommerce/) — paid, **~3,000 active installs**
  - [wphocus "My auctions allegro" PRO](https://wordpress.org/plugins/my-auctions-allegro-free-edition/) (free edition: 500+) — paid PRO covers bidirectional sync
  - [dotandl integration-allegro-woocommerce](https://github.com/dotandl/integration-allegro-woocommerce) (OSS) — 3 GitHub stars, vestigial
- **Order-of-magnitude estimate**: paid-plugin install floor ~7–8k; PL WC stores doing physical delivery ceiling ~47k; **SMB sub-cohort (50–500 SKU, 10–100 orders/day) plausibly in the low single-digit thousands**. Mid-cohort — not a niche, not "tens of thousands of OL-shaped buyers" either.
- **BaseLinker customer-mix data**: not published. They cite 27k companies worldwide on the plugin page; no PL- or WC-specific breakdown surfaced.

### Competitive landscape

| Alternative | Pricing | Coverage | Notable issues |
|---|---|---|---|
| [**BaseLinker**](https://base.com/pl-PL/integracje/allegro/woocommerce/) (incumbent) | Freemium → **Business 99 PLN/mo + 0.59 PLN/order to 1k**, then 0.19 PLN/order to 10k. Enterprise auto-triggered at 5k orders/mo or 1M PLN GMV (**5,000 PLN/mo min** or % of GMV). Per [orbis-software](https://orbis-software.pl/blog/rozszyfrowujemy-cennik-baselinker-jak-optymalnie-wybrac-plan-dla-twojego-e-biznesu) | Full breadth — product/stock/price sync, bidirectional orders, offer creation, shipping labels, 300+ marketplaces, 150+ carriers | Stock sync is **poll-based, not real-time** → overselling on low-stock SKUs (recurring complaint, [GoWP](https://gowp.pl/synchronizacja-stanow-magazynowych-woocommerce-z-allegro-i-baselinkerem/)); large-catalogue sync crashes; Dec 2024 **price hike** triggered active "alternatives" agency discourse ([Invette](https://invette.pl/blog/baselinker-podnosi-ceny-czy-warto-szukac-alternatyw/), [Develtio](https://develtio.pl/blog/wiedza/baselinker-cennik-znow-rosnie-ale-jest-alternatywa/)); one Trustpilot user reports yearly spend €80 → €256 → €980 → projected €12k |
| [**WP Desk Allegro WooCommerce**](https://wpdesk.net/products/allegro-woocommerce/) | Per-WC-license, no per-order fee | Offer listing/relisting, bidirectional price sync, shipping labels, Allegro→WC order import | Active subscription needed for updates/support; positioned as "BaseLinker alternative for one-tool simplicity" |
| [**wphocus My auctions allegro PRO**](https://wordpress.org/plugins/my-auctions-allegro-free-edition/) | Paid PRO (free edition is teaser) | Allegro→WC orders, status sync, 2-way stock, template-based offer creation, multi-account | Reviews: **"Dead plug-in do not use it"** (Feb 2023, allegedly 9 months without support response); **abandonment anxiety** is part of the pain shape |
| **OSS GitHub** | Free | None viable | Search `woocommerce allegro` returns 3 repos total; dotandl (3 stars, stock-sync-only) is the only one not vestigial. **No serious OSS competitor exists** |

### Pain shape signal

Themes that **recur across independent sources** (signal, not one-off rants):

1. **Stock sync is poll-based → overselling.** BaseLinker syncs "every few-to-fifteen minutes" ([GoWP](https://gowp.pl/synchronizacja-stanow-magazynowych-woocommerce-z-allegro-i-baselinkerem/)); failure mode is low-stock SKUs (1–2 units). Trustpilot: *"Each morning starts with dread, wondering how many orders have been oversold overnight."* [Orbis Software](https://orbis-software.pl/blog/synchronizacja-stanow-magazynowych-5-bledow-kosztujacych-e-commerce-50-000-pln-miesiecznie-subiekt-gt-base) frames this as a 50k-PLN/month-loss pattern.
2. **Large-catalogue / variant-heavy syncs crash.** Dec 2025 BaseLinker WP plugin 1-star review: plugin tries to sync all 10k products in one pass with no diff-check, crashes server.
3. **Allegro category/parameter mapping is the operator time-sink.** Every PL "how to integrate" tutorial ([Cyberiusz](https://cyberiusz.pl/woocommerce-integracja-z-allegro), [Brandly360](https://brandly360.com/pl/blog/integracja-allegro-z-woocommerce-jak-to-zrobic-i-ktora-wtyczke-wybrac/)) flags this as the initial friction — not one tool's failure, the API's intrinsic shape.
4. **Plugin abandonment risk.** Multiple wphocus reviews cite long silence + missing bulk-operations. Single-vendor abandonment anxiety is part of the buy decision.
5. **Pricing-shock toward SaaS.** Polish agency blog discourse 2024–25 frames BaseLinker price hikes as an active market signal. *That this discourse exists at all is the signal.*

**Hypothesis "operators experience daily friction" — substantially confirmed** for the BaseLinker incumbent path; the overselling/large-catalogue/abandonment pattern recurs across independent sources.

### HPOS adoption

WooCommerce 8.2+ (Oct 2023) introduced **High Performance Order Storage** — orders moved out of `wp_posts` into custom tables. Per [WPFactory 2025 stats](https://wpfactory.com/blog/woocommerce-statistics-2025/) + [magecomp 2026 trends](https://magecomp.com/blog/woocommerce-statistics-trends/): **~78% of WC stores have migrated to HPOS**. HPOS is **default for new stores** since WC 8.2 ([WooCommerce dev docs](https://developer.woocommerce.com/docs/features/high-performance-order-storage/)).

The remaining ~22% are typically larger/older stores blocked by legacy-plugin incompatibility — skews **away** from the 50–500 SKU SMB persona we target.

**Verdict**: HPOS-only v1 is safe. OL only speaks REST; storage-mode is largely invisible at the API surface anyway.

### WC REST API capability check

Authoritative source: [WC REST API v3 docs](https://woocommerce.github.io/woocommerce-rest-api-docs/v3.html).

| OL capability | WC REST coverage | Notes / gotchas |
|---|---|---|
| **ProductMaster** | `GET/POST/PUT/DELETE /products`, `/products/{id}/variations`, `/products/categories`, `/products/attributes`; search via `?search=` and SKU lookup via `?sku=`; batch via `/products/batch` | Full coverage |
| **InventoryMaster** | `stock_quantity` field on products + variations; PUT writes set absolute value | **Set-absolute only — no delta/adjust primitive.** OL adapter reads current → computes → writes (mirrors PrestaShop adapter). Bulk endpoint `/products/{id}/variations/batch` is **scoped per parent** — cross-product bulk requires N requests ([rudrastyh guide](https://rudrastyh.com/woocommerce/bulk-update-product-stock-quantities.html), [GH #29341](https://github.com/woocommerce/woocommerce/issues/29341)) |
| **OrderSource** | `GET /orders?modified_after=<RFC3339>` polling watermark; pagination via `?page` + `X-WP-Total`; webhooks for `order.created` / `order.updated` / `order.deleted` | **No event-journal endpoint with monotonic cursor** — `modified_after` watermark is the same shape as PS adapter's `date_upd`. `order.updated` [is known to fire on creation too](https://github.com/woocommerce/woocommerce/issues/43019) → adapter dedupes by `id+status`. Maps cleanly to `OrderSourcePort.listOrderFeed` + `getOrder` |
| **OrderProcessorManager** | `POST /orders` (create), `PUT /orders/{id}` (update status, line items), `POST /orders/{id}/refunds` | Full coverage. No explicit "cancel" verb — status update to `cancelled` is the convention |

**No blocking gaps for any of the four capabilities.** The set-absolute-stock and `modified_after`-watermark constraints mirror the PrestaShop adapter's existing posture; they're quality-of-implementation issues, not feasibility blockers.

### Allegro-side sanity check

No new ground. Allegro adapter today serves `OrderSourcePort` (event journal `GET /order/events` with persisted `lastEventId` cursor) and `OfferManagerPort` against the same PL marketplace these merchants sell on. **Nothing changes Allegro-side.** Per project memory: Allegro auto-derives multi-variant grouping from the Product Catalog since 14 Apr 2026 — the WC adapter inherits that simplification.

### Phase B synthesis — what we now know vs what's still hypothesis

- ✅ **Cohort is real and mid-tier.** ~47k PL WC stores doing physical delivery; ~7–8k actively running paid Allegro plugins; SMB sub-cohort plausibly low single-digit thousands. Not niche, not "tens of thousands of OL-shaped buyers".
- ✅ **WC is the dominant PL self-hosted shop platform**, six times PrestaShop's share. The current OL adapter set reaches the *smaller* slice.
- ✅ **Pricing is the strongest wedge.** BaseLinker's Dec 2024 price hike triggered an active "alternatives" market signal; per-order pricing punishes exactly the 10–100 orders/day persona we've targeted (a 50-orders/day shop pays ~890 PLN/mo on Business plan post-hike). OL self-hosted has no per-order cost.
- ✅ **Pain shape confirms daily-friction hypothesis.** Overselling, large-catalogue crashes, plugin abandonment recur across independent sources.
- ✅ **WC REST API is unconstrained for v1 scope.** Set-absolute stock writes, `modified_after` watermark, webhook dedup for `order.updated` — all match PS adapter patterns. No core changes needed.
- ✅ **HPOS-only v1 is safe.** ~78% adoption today, default for new stores since Oct 2023.
- ❓ **Biggest remaining unknown — decision driver: price or trust/control?** Both are plausible motivations and likely segment the cohort. Affects messaging more than scope; **falsifiable only via merchant conversations, not desk research**. Deferred to post-MVP discovery interviews. *Does not gate Phase C* — both decision-driver hypotheses point at the same product (a self-hosted, no-per-order-fee, real-time-sync WC↔Allegro adapter at PS parity).

## 4. Solution exploration

Five candidate solution shapes were considered against the four axes (problem fit / persona fit / strategic fit / risk). Comparison table first, per-shape detail follows, chosen shape last.

### Candidate shapes

| # | Shape | Capabilities in v1 | Effort | What it ships first |
|---|---|---|---|---|
| **A** | **Full PS-parity adapter** | PM + IM + OS + OPM | ~L (≈6 wk) | All four capabilities behind one flag |
| **B** | Sliced rollout (stock+orders first) | IM + OS v1; PM + OPM v2 | ~M (≈4 wk for v1) | Real-time stock sync + Allegro order ingest into WC; ProductMaster + OrderProcessor as follow-up |
| **C** | InventoryMaster-only minimal cut | IM only | ~S (≈2 wk) | Single-capability wedge: "stop the overselling" |
| **D** | WC plugin + REST adapter combo | PM + IM + OS + OPM, plus an OL-authored WC plugin emitting real-time webhooks | ~L+ (≈8 wk) | Same surface as A, but with real-time event signal from a maintained WC-side plugin |
| **E** | Do nothing / point users at BaseLinker | none | 0 | OL accepts not reaching the majority of PL self-hosted merchants |

### Comparison

| Axis | A (full parity) | B (sliced) | C (IM-only) | D (plugin combo) | E (do nothing) |
|---|---|---|---|---|---|
| **Problem fit** — solves daily friction + pricing escape | ✅ Full | 🟡 Partial — operator can't list new products from WC | 🟡 Single pain only — "I still need BaseLinker for orders" | ✅✅ Plus solves the polling-latency overselling pain definitively | ❌ |
| **Persona fit** — SMB, 50–500 SKUs, 10–100 orders/day | ✅ Mirrors how SMBs actually use BaseLinker today | 🟡 SMBs would need to retain BaseLinker for the missing half | 🟡 SMBs would need to retain BaseLinker for orders + listings | ✅ Best fit for the overselling-anxiety segment | ❌ |
| **Strategic fit** — OSS BaseLinker alternative for the dominant PL platform | ✅ Reaches the 55% slice fully | 🟡 Half a story | ❌ Signals "we're not serious about WC" | ✅ Differentiator on real-time | ❌ Concedes the wedge |
| **Risk — implementation** | 🟡 PS reference adapter de-risks; volume of work is real but shape is known | ✅ Smaller v1; faster signal | ✅✅ Smallest v1 | ❌ Plugin maintenance is a new code asset on a foreign stack (PHP/WP), with its own update cadence + WP.org compliance |
| **Risk — adoption** | ✅ Covers the operator workflow end-to-end → switching from BaseLinker is realistic | ❌ Operator switches *partially* → keeps BaseLinker → no actual escape | ❌ Same: operator can't fully switch | ✅ Real-time stock is a story that sells itself | ❌ n/a |
| **Risk — scope creep** | 🟡 Four capabilities = four chances to miss-time a sub-feature | ✅ Tight | ✅ Tightest | ❌ Plugin scope tends to expand (settings UI, debug tools, WP.org review cycle) | ✅ |

### Per-shape detail

**A — Full PS-parity adapter (RECOMMENDED).** WC adapter ships all four capabilities at v1, mirroring what PrestaShop adapter does today. Operator can run their master shop on WC, sync products/inventory to Allegro, ingest both WC-native and Allegro orders, and write order-lifecycle updates back to WC. Effort estimate ~L (≈6 weeks rough order-of-magnitude — not a commitment, refined in Tier 2 implementation plans). Out-of-scope items remain as listed in the parent issue (no WC Subscriptions/Bookings extensions; one connection per WP subsite; no OL-authored WC-side plugin; vanilla WC only; HPOS-only at v1).

**B — Sliced rollout: InventoryMaster + OrderSource first.** Land the "kill the daily friction" story first: real-time-ish stock sync (WC → OL → Allegro) + Allegro order ingest into WC. Defer ProductMaster (operator creates products in WC manually + lists on Allegro via existing Allegro adapter's offer-creation wizard) and OrderProcessor (no OL writes back to WC for status updates). v1 ≈4 weeks. v2 fills the gap. **Reason to reject as v1**: operator who keeps BaseLinker for the missing half hasn't actually escaped the pain or the price — partial is worse than nothing here, because the migration cost is the same.

**C — InventoryMaster-only minimal cut.** Even narrower: single capability, "fix the overselling pain". v1 ≈2 weeks. **Reason to reject**: doesn't move the needle on the pricing-escape wedge. Operator still pays BaseLinker for orders, listings, and everything else. The cohort that would adopt OL just-for-stock-sync is much smaller than the cohort that would adopt OL for the whole workflow.

**D — WC plugin + REST adapter combo.** Like A, plus an OL-authored WordPress plugin installed on the operator's WC instance, emitting signed webhooks for stock/order events to OL in real-time. Solves the #1 confirmed pain (overselling from poll-based sync) definitively. **Reason to reject for v1**: out-of-scope per the parent issue body, and the plugin becomes a code asset OL must maintain on a foreign stack (WP.org compliance, plugin-update cadence, PHP version compatibility, WP-multilingual-environment testing). Real-time signal is achievable later via WC native webhooks (REST API exposes them) without owning the plugin. Worth revisiting in v2/v3 if polling latency is the gating complaint.

**E — Do nothing / point users at BaseLinker.** Honest counter-position. **Reason to reject**: WC is 55% of PL self-hosted; conceding the wedge after explicitly positioning as "the OSS BaseLinker alternative" undercuts the strategy. Even with cohort sizing in the low single-digit thousand SMBs, that's the addressable market — not building means OL stays a PS-only orchestration tool, which is a structurally smaller play.

### Chosen shape

**Shape A — Full PS-parity WooCommerce adapter at v1.**

Implementing `ProductMaster`, `InventoryMaster`, `OrderSource`, and `OrderProcessorManager` capabilities against WC REST API v3, HPOS-only at v1, vanilla WC only, one OL connection per WP subsite, no OL-authored WC-side plugin.

Rationale:
1. WC is the dominant PL self-hosted platform — a half-capability v1 (B or C) signals OL isn't serious about WC, undercutting the strategic value of doing the work at all.
2. Operator workflows couple the four capabilities (an SMB can't usefully run on a half-adapter and keep BaseLinker for the rest; the switching cost is the same, the value delta is smaller).
3. PrestaShop is a working reference for all four capability shapes — implementation risk is the volume of work, not the shape.
4. WC REST has no blocking gaps (Phase B confirmed). Set-absolute stock writes and `modified_after` watermark mirror PS adapter posture exactly.
5. Real-time stock signal via OL-authored WC plugin (Shape D) is appealing but doubles the maintenance surface on a foreign stack and is explicitly out-of-scope per the parent issue. Native WC webhooks are available via REST when polling latency becomes the gating complaint.

### Key sub-decisions

- **HPOS-only at v1.** ~78% adoption, default for new stores since WC 8.2 (Oct 2023), and OL only speaks REST anyway — storage mode is invisible at the API surface. Legacy `wp_posts` support is a post-v1 question if real cohort signal demands it.
- **Polling-based OrderSource v1, native WC webhooks deferred.** PS adapter pattern, well-understood, no new infra. Webhooks-as-fast-path is a v2 optimisation if polling latency surfaces as a real operator complaint. Adapter must already dedupe by `id+status` because WC's `order.updated` fires on creation (confirmed Phase B).
- **Set-absolute stock writes** (read current → compute → write). Mirrors PS adapter; no delta primitive available in WC REST.
- **Per-WP-subsite connection model.** Mirrors how multiple PS shops are handled; aligns with WC's per-site REST credential scope.
- **WC-authored plugin: explicitly deferred to a future spec** (post-v1, conditional on real operator demand for real-time stock-sync signal that polling can't satisfy).

### Resolved open questions (from parent issue body)

| Question (from issue #872) | Resolved? | Resolution |
|---|---|---|
| Cohort sizing | ✅ Phase B | Low single-digit thousand SMBs (paid-plugin install floor ~7–8k; PL WC delivery-fulfilling ceiling ~47k) |
| HPOS support | ✅ Phase B + Phase C | HPOS-only at v1; ~78% adoption + REST hides storage mode |
| Why WC merchants pick OL over WP-native plugin | ✅ Phase B | OL displaces both BaseLinker (pricing escape) *and* the fragile WP-marketplace plugins (overselling, large-catalogue crashes, abandonment risk). Differentiator is OSS + self-hosted + no per-order fee + workflow-complete (matches BaseLinker breadth in this slice, not just one plugin's slice) |
| Test/dev access to a real WC store | 🟡 Tier 2 | Add WC to `docker-compose.yml` dev stack — implementation-plan concern, not spec-level |
| HTTP Basic Auth + consumer key/secret | ✅ Phase B | WC REST auth fits OL's credentials-shape model without new abstractions; mirrors PrestaShop's API-key auth pattern |
| Capability sub-port gaps | ✅ Phase B | No blocking gaps for the four capabilities. Implementation-quality issues (set-absolute stock, no monotonic order cursor) match PS adapter posture |
| Persona validation | ✅ Phases A + B | SMB primary (locked at Gate A); cohort confirmed real (Phase B). Live discovery interviews with 2–3 PL Allegro+WC SMBs remain post-MVP — characterise the price-vs-trust-decision-driver question, do not gate v1 ship |

## 5. Product specification

**Rough effort estimate:** ~L (≈6 weeks at order-of-magnitude resolution). Day-by-day breakdown belongs in Tier 2 implementation plans, not here.

### User stories

1. **As a PL Allegro seller running WooCommerce, I want to connect my WC shop to OpenLinker**, so that I can use OL as the orchestration layer between WC and Allegro without paying BaseLinker's per-order fees.
2. **As a PL Allegro seller, I want OL to read my full WC product catalog** (products, variations, SKUs, barcodes, categories), so that I have a unified inventory view across WC and Allegro and can use those products as the source for Allegro listings.
3. **As a PL Allegro seller, I want WC stock levels to propagate to my Allegro offers automatically**, so that I stop overselling SKUs the way BaseLinker's poll-based sync has caused historically.
4. **As a PL Allegro seller, I want Allegro orders to appear in my WC admin as customer orders**, so that my existing WC fulfilment workflow (pack / ship / invoice via existing WC plugins) works for both Allegro and WC-native orders without context-switching.
5. **As a PL Allegro seller, I want OL to ingest my native WC orders alongside Allegro orders**, so that OL has the complete order picture and downstream OL features (shipping label generation, status sync) work uniformly across both channels.
6. **As a PL Allegro seller, I want WC order status changes (shipped, cancelled, refunded) to propagate where it matters**, so that I don't manually duplicate status updates across systems.
7. **As a PL Allegro seller, I want OL's existing bulk-listing wizard to work against my WC connection**, so that adding new SKUs to Allegro from WC is the same workflow that already exists for PrestaShop merchants.
8. **As a PL Allegro seller, I want OL to write product changes back to WC when an OL workflow generates them** (e.g., AI-generated descriptions from OL's content tools, programmatic price updates), so that WC remains the authoritative master record without me having to apply the same change in both places.

### Acceptance criteria (user-visible only)

Engineering AC — rate-limit handling, retry semantics, identifier-mapping internals, capability-port wiring — belongs in Tier 2 implementation plans, not here.

| Story | User-visible AC |
|---|---|
| 1. Connect | Operator enters their WC site URL and REST consumer key/secret in OL Admin → connection test passes → connection appears as Active in the connections list → operator can view connection metadata (last-seen timestamp, WC version detected, HPOS status) |
| 2. Catalog read | Operator triggers initial catalog sync from OL UI → within a reasonable window (target ~5 min for a 500-SKU shop), all WC products and variations appear in OL's product browser → product counts match between WC admin and OL → product details (SKU, EAN, price, categories, attributes) match |
| 3. Stock propagation | Operator changes stock for a SKU in WC admin → within a reasonable window (target ~5 min on default polling cadence), the change is visible in OL → if the SKU is mapped to an Allegro offer, the Allegro offer quantity updates to match |
| 4. Allegro order → WC | An Allegro order is placed → within a reasonable window (target ~5 min), the order appears in WC admin as a customer order with correct line items, shipping address, customer details, and totals → operator can fulfil it through the standard WC workflow |
| 5. WC order ingest | An order placed natively in WC appears in OL's order list within the same window → it's distinguishable from Allegro-sourced orders in OL's UI |
| 6. Status propagation | Operator marks a WC order as completed → if the order is Allegro-sourced, OL marks it as shipped on Allegro. Operator cancels a WC order → if Allegro-sourced, OL cancels the corresponding Allegro order |
| 7. Bulk wizard | Operator opens the bulk-listing wizard, picks a WC connection, selects WC products → the wizard produces Allegro offers using the same Resolve/Match/Submit flow that exists for PS merchants → bulk-creation batch progress is visible in the same UI surface |
| 8. Master writeback | An OL workflow updates a product (e.g., operator publishes an AI-generated description from OL's content tools, or a price-rule triggers) → OL writes the change to WC via REST → within a reasonable window the change is visible in WC admin → WC's product detail (description, price, attribute, etc.) matches what OL has |

The phrasing "within a reasonable window (target ~5 min)" reflects operator expectation, not an SLA we have telemetry to measure. Stage 1: no measurable promise — Definition of done (§7) catches whether this actually feels acceptable in production.

## 6. Out of scope

Items below are out-of-scope for v1, picked because someone might *actually ask* about them — not an exhaustive future-feature catalog.

1. **WC Subscriptions / Bookings / Memberships** — vanilla WooCommerce only. Specialised extensions are post-v1 and would each need their own product-direction decision.
2. **WordPress Multisite as a single OL connection** — each subsite is its own OL connection (mirrors how multiple PS shops are handled today). No multi-subsite-aware connection model.
3. **OL-authored WordPress plugin for real-time webhooks** — Shape A rejected the WC-plugin-combo approach (Shape D). REST polling only at v1. Native WC webhooks via REST may be evaluated as a v2 latency optimisation if poll cadence becomes the gating complaint.
4. **Legacy `wp_posts` order storage** (pre-HPOS) — HPOS-only at v1. ~78% adoption + REST hides storage mode anyway; legacy support is conditional on real cohort signal.
5. **WC-side write of content from Allegro** — content flow direction matches PS adapter (operator authors in WC, OL ships to Allegro; not the reverse).
6. **WC shipping zones / tax rules / coupon import** — scope is products + inventory + orders + customers. Shipping/tax/coupon management stays in WC admin; OL doesn't mirror or override it.
7. **Multi-currency stores** — v1 assumes single currency per connection (mirrors PS adapter posture). Multi-currency is its own product question.

## 7. Definition of done

Stage 1 calibration: no metric theatre (no instrumentation to measure "% adoption in 7 days" claims honestly). Qualitative bullets — what does the maintainer subjectively need to see/feel before declaring v1 a success?

1. **At least one real PL Allegro+WC SMB merchant runs the OL+WC+Allegro+InPost stack in production for ≥30 consecutive days** without abandoning OL or rolling back to BaseLinker.
2. **That operator subjectively reports they've stopped checking BaseLinker daily** — i.e., OL is their primary control surface for Allegro listing and order management, not a parallel-running secondary tool.
3. **No stock-sync overselling incidents reported by the test operator in the first month.** This is the #1 confirmed pain shape from Phase B; if OL's poll-based sync produces the same complaint pattern as BaseLinker, the v1 didn't differentiate.
4. **The PrestaShop adapter continues working without regression** — the WC work didn't bleed PS-specific assumptions out, or worse, leak WC-specific assumptions into core. Existing PS merchants don't notice WC shipped.
5. **A new operator can complete onboarding (connect WC → connect Allegro → first product listed on Allegro) without OL maintainer hand-holding.** If onboarding needs a maintainer in a Discord DM every time, the v1 isn't shippable as OSS even if the code works.

## 8. Risks

Top product-direction risks only. Engineering risks (rate limits, schema migrations, retry semantics, runtime races, HPOS edge-case handling) belong in the Tier 2 implementation plan, not here.

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **No PL Allegro+WC SMB merchant actually adopts.** Cohort is real (Phase B), but OSS-self-hosted adoption is typically slow; estimated cohort is "low single-digit thousand" SMBs and adoption capture from that is a fraction | Conduct 2–3 post-MVP discovery interviews with real merchants in the cohort before declaring DoD met. Validate the price-vs-trust decision-driver question (Phase B's biggest remaining unknown) and ensure go-to-market messaging hits |
| **R2** | **Existing BaseLinker users won't switch.** Sunk cost, workflow muscle memory, and feature-set breadth mean operators stable on BaseLinker may not migrate even to a better/cheaper alternative | Target v1 toward operators *currently shopping for alternatives* — the PL agency-blog "BaseLinker alternative" audience surfaced in Phase B — not stable BaseLinker users. Don't measure success by "displaced BaseLinker customers" |
| **R3** | **"WC is 55%" doesn't translate to OL-shaped buyers.** WC's dominance includes many solo merchants (excluded by SMB-primary persona); the SMB sub-cohort within that may be smaller than the low-single-digit-thousand estimate | Track adoption against the cohort estimate. If signal is weaker than expected, the *spec* was right (the cohort estimate was high), not the strategy. Use this to inform whether a hosted/turnkey OL is the next bet to reach solo merchants |
| **R4** | **Allegro side-effect risk.** Allegro periodically changes API behaviour (variant grouping in 2026 was an example); if Allegro adds first-party WC integration or similar, OL's value contracts. Structural risk | Not mitigable except by execution speed. OL exists because platform-side integrations are insufficient; that's the bet |
| **R5** | **Maintenance burden grows non-linearly.** Adding a second master shop doubles the surface for "wait, this works on PS but not WC" support questions and forces every future feature to consider two shop platforms | Invest in capability-port test kits (in-memory adapter conformance tests) before adding a *third* shop adapter. Document any PS-specific quirks discovered during WC work in capability-port contract docs |

## 9. Implementation breakdown

Seven implementation issues spawned 2026-05-28. Sized S–L; no XL (none required splitting).

| Story | Issue | Title | Size | Blocked by |
|---|---|---|---|---|
| 1 | [#873](https://github.com/openlinker-project/openlinker/issues/873) | WC plugin scaffold + connection + credentials + tester | **S** | — |
| 2 | [#874](https://github.com/openlinker-project/openlinker/issues/874) | WC ProductMasterPort (read) | **M** | #873 |
| 3 | [#875](https://github.com/openlinker-project/openlinker/issues/875) | WC InventoryMasterPort + Allegro stock propagation | **M** | #873, #874 |
| 5 | [#876](https://github.com/openlinker-project/openlinker/issues/876) | WC OrderSourcePort (modified_after polling) | **M** | #873 |
| 4 + 6 | [#877](https://github.com/openlinker-project/openlinker/issues/877) | WC OrderProcessorManagerPort (create + status + cancel + refund) | **L** | #873, #874 |
| 7 | [#878](https://github.com/openlinker-project/openlinker/issues/878) | WC bulk-listing wizard E2E + Dockerized WC dev stack | **M** | #873, #874, #875, #876, #877 |
| 8 | [#879](https://github.com/openlinker-project/openlinker/issues/879) | WC ProductMasterPort (write) | **S** | #873, #874 |

**Critical path** (longest chain): #873 → #874 → #877 → #878. Three of the capability adapters (#875, #876, #877) can be parallelised once #873 + #874 land. #879 (ProductMaster write) is the only impl that can ship without blocking anything else and can be deferred if v1 ship pressure mounts.

## 10. Decision log

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-05-28 | Pre-A | File Product Design issue #872 as maintainer-initiated strategic expansion; no originating feature request | WC is the second-most-common PL self-hosted shop platform; adding it extends the existing PL Allegro+shop+InPost wedge to its natural neighbour, and validates the hexagonal plugin contract against a second, structurally-different shop API |
| 2026-05-28 | Pre-A | Scope intent at issue-creation: **full PS-parity capabilities** (PM + IM + OS + OPM) | User choice during issue framing. Will be revisited in Phase C alongside narrower cuts |
| 2026-05-28 | Pre-A | Persona scope: **same PL wedge, swap PS→WC** (not international / not English-speaking SMB) | User choice during issue framing. Keeps the wedge tight; defers the "WC as global product" framing to a possible future spec |
| 2026-05-28 | Gate A | Problem statement + persona locked. Conviction call: "we need this integration" — DEFER taken off the table at Phase A | Maintainer asserted strategic conviction; Phase B will quantify cohort + characterise pain shape but is not gating on a no-go answer |
| 2026-05-28 | Gate A | Primary persona = **SMB** (1–5 ops), not solo merchant | Full PS-parity capability scope is a self-host-shaped product; solo merchants need a hosted/turnkey offering (out of this spec's scope). Solo recorded as secondary |
| 2026-05-28 | Gate B | Phase A §1 "growing share" framing **revised to "dominant share"** based on Phase B telemetry (WC 54.7% vs PS 9.2% of PL self-hosted) | ShopRank March 2026 data inverts the implicit assumption that PS is the dominant PL platform; OL today reaches the *smaller* slice. Strengthens the "why now" — not just "next obvious adapter" but "the adapter that reaches the majority of the market" |
| 2026-05-28 | Gate B | Phase B confirms cohort + pain shape + API feasibility; **proceed to Phase C** | No blockers found: cohort real (low single-digit thousand SMBs), pain shape confirms daily friction, WC REST has no blocking gaps for the four capabilities, HPOS-only v1 is safe. Decision-driver question (price vs trust/control) doesn't gate Phase C — both motivations point at the same product |
| 2026-05-28 | Gate C | **Shape A — Full PS-parity WC adapter** selected over sliced rollout (B), single-capability cut (C), WC-plugin combo (D), do-nothing (E) | A maximises problem fit + adoption fit at acceptable risk (PS adapter is a working reference). Partial cuts (B, C) leave operator paying for BaseLinker on the missing half — switching cost is the same, value delta smaller. Plugin combo (D) doubles maintenance surface on a foreign stack and is out-of-scope per parent issue. Do-nothing (E) concedes the wedge after explicitly positioning OL as "OSS BaseLinker alternative" |
| 2026-05-28 | Gate C | Sub-decisions locked: **HPOS-only v1**, **polling-based OrderSource v1** (native WC webhooks deferred), **set-absolute stock writes**, **per-WP-subsite connection model**, **no OL-authored WC plugin at v1** | Each justified in §4 "Key sub-decisions" |
| 2026-05-28 | Phase D | Added User Story #8 (OL writes product changes back to WC) — missing in initial draft | Caught during Gate D presentation: spec called for "full PS parity" but no user story explicitly covered the ProductMaster *write* half (createProduct / updateProduct / etc.). Story 8 closes the gap |
| 2026-05-28 | Gate D | **YES — commit engineering time.** Spawn impl issues, close PD parent | All 8 user stories sized; effort ~L (≈6 wk); no blocking risks surfaced. Phase B confirmed cohort, pain shape, and WC REST feasibility; Shape A maximises problem-fit at acceptable risk |
| 2026-05-28 | Phase E | Spawned 7 impl issues #873–#879; closed parent #872 (`state_reason: completed`); refinement done | One impl per coherent vertical (scaffold, PM read, Inventory, OrderSource, OrderProcessor, bulk-wizard E2E, PM write). No XL — sizing held. Critical path #873 → #874 → #877 → #878 |
