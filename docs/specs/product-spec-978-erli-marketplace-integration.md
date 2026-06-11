# Product Spec — #978 Erli marketplace integration

**Status:** phase E complete — refinement done (Gate D = YES, 2026-06-05)
**Parent issue:** [#978](https://github.com/openlinker-project/openlinker/issues/978)
**Started:** 2026-06-05
**Last updated:** 2026-06-05

---

## 1. Problem

OpenLinker today reaches PL sellers on a single marketplace: **Allegro**. An OL operator running the Allegro + PrestaShop + InPost wedge has no path to a *second* marketplace — every additional sales channel they run (Erli, Empik, Kaufland, …) lives outside OL, with its orders never entering OL's unified pipeline and its offers managed by hand or through a competing SaaS (BaseLinker, xSale).

[Erli](https://erli.pl/) is a Polish marketplace positioned on low/zero seller commission, aimed at exactly the SMB merchant cohort OL already serves. It has a **public, documented REST Shop API** ([erli.pl/svc/shop-api/doc](https://erli.pl/svc/shop-api/doc/)) covering offers, orders (webhook + inbox poll), categories, and stock — i.e., the same `OrderSource` + `OfferManager` capability shape OL already implements for Allegro.

Adding Erli as a marketplace adapter extends the existing PL wedge to a **second marketplace on the same buyer/shop/fulfilment stack** — same merchant, same PrestaShop master, same InPost/DPD fulfilment; only the sales channel differs. It is also the **foundational second marketplace adapter**: building it validates that the marketplace capability ports (`OrderSourcePort`, `OfferManagerPort` + sub-capabilities) hold under a structurally-different marketplace API, the way the WooCommerce adapter (#872) validated the shop-side ports against a second shop.

**Why Erli specifically, why now (hypothesis):** Erli's API accepts **Allegro category and parameter IDs directly** (`source:"allegro"`) — an OL operator already integrated with Allegro can reuse their existing category/parameter mappings to list on Erli with uniquely low friction. No other PL marketplace offers that Allegro-compatibility shortcut. That makes Erli the *cheapest-to-reach* second marketplace for OL's exact existing audience — a differentiator BaseLinker doesn't lean on.

**The honest open question (for Phase B):** is the Erli *seller cohort* large enough to justify a full-parity integration? Erli is far smaller than Allegro; the WooCommerce bet rested on hard market-share data (WC = 55% of PL self-hosted shops), and the Erli equivalent — how many PL SMB sellers actually list on Erli, and how many of those overlap OL's Allegro+PS audience — is not yet quantified. Phase B must establish this before Gate D; it is the single biggest "default to don't build" risk.

---

## 2. Affected persona

### Primary persona (hypothesis)

PL Allegro seller, primary shop on PrestaShop, **adding Erli as a second marketplace** — SMB (1–5 person ops team), not solo.

| Axis | Value |
|---|---|
| **Who** | PL multichannel seller already on Allegro + PrestaShop via OL, expanding to Erli |
| **Company size** | SMB — 1–5 person operations team |
| **Sophistication** | Operator-UI driven; comfortable managing marketplace seller panels + API keys; not a developer |
| **Volume / scale** | 50–500 SKUs per shop, 10–100 orders/day (mirrors the assumed Allegro-cohort scale; Erli volume is typically a *fraction* of the seller's Allegro volume — a secondary channel, not primary) |
| **Geographic focus** | Poland (same wedge as Allegro) |
| **Why on Erli** | Diversifying off Allegro dependence; chasing Erli's lower commission; incremental sales at low marginal effort *if* listing is cheap |
| **Current Erli handling** | Manual order processing + manual listing in the Erli seller panel, or a third-party multichannel tool (BaseLinker, xSale) |

### Why SMB, not solo

Full-parity marketplace management (list offers + ingest orders + sync stock) is a self-host-shaped product the same way the WC adapter is. Solo merchants who'd want a turnkey hosted product are a **secondary persona**, out of scope for this adapter's v1.

### Key persona nuance — Erli is a *secondary* channel

Unlike WooCommerce (which is the merchant's *primary* shop), Erli is almost always an operator's **secondary or tertiary marketplace**, behind Allegro. This shapes the value proposition: the win is **low marginal effort to add a channel** (reuse Allegro mappings, orders flow into the same OL pipeline), not "replace your primary tool." It also caps the upside — Erli order volume per seller is small — and raises the bar on *listing friction*: if adding Erli offers isn't near-free given existing Allegro data, the marginal channel isn't worth the operator's time.

---

## 3. Evidence & user research

Research conducted 2026-06-05 by the `product-researcher` subagent (market-side; the API surface was characterised in a separate pass — see §4). Sources cited inline. Honest caveats kept rather than papered over.

### Cohort sizing — the "is Erli worth it" question

- **Erli is the clear #2 PL-domestic marketplace by seller count and GMV.** FY2025 **GMV ~PLN 1.8bn (+45% YoY)**, revenue PLN 264.9mn (+54%); **34,000 sellers** as of 9M2025 (+5,300 over three quarters), 6M+ registered buyers ([Erli press office, 9M2025](https://biuroprasowe.erli.pl/aktualnosci/erli-z-rekordowym-wzrostem-ponad-1-29-mld-zl-gmv-po-9-miesiacach-2025-roku-trzeci-kwartal-z-50-dynamika-i-najwyzsza-w-historii-rentownoscia); [ISBnews FY2025](https://pl.investing.com/news/stock-market-news/erli-zwiekszylo-przychody-o-54-do-2649-mln-zl-gmv-o-45-do-18-mld-zl-w-2025-r-1293450)). Multi-year ramp: ~PLN 0.7bn → 1.2bn → 1.8bn.
- **Outranks the other "second marketplace" candidates by seller channel:** Empik Marketplace ~PLN 1bn GMV ([BRIEF](https://brief.pl/rekordowe-wyniki-grupy-empik-za-2025-r-16-proc-wzrost-gmv-r-r-i-ponad-miliard-zlotych-sprzedazy-marketplace/)); Kaufland.pl **only ~3,000 sellers** ([retailnet](https://retailnet.pl/2025/09/18/kaufland-marketplace-podsumowuje/)); Amazon.pl growing slower than expected and a heavier/more-international API+persona bet. **34k sellers > Empik > Kaufland.pl** for the PL-SMB cohort.
- **vs Allegro:** not close — Allegro 2024 GMV >PLN 60bn, so **Erli ≈ 3% of Allegro's GMV** ([XYZ.pl](https://xyz.pl/poland-unpacked/polands-e-commerce-showdown-erli-vs-allegro-2274/)). Erli is a real but distinctly *secondary* channel, exactly as Phase A framed.

### The single most important finding — the cohort IS the OL wedge

Every major PL multichannel vendor positions Erli as a **second channel for existing Allegro sellers** — Sellasist's "sell on both, stop choosing" ([Sellasist](https://sellasist.pl/blog/erli-vs-allegro/)), Apilo's dedicated Allegro→Erli dual-channel page ([Apilo](https://apilo.com/pl/integracje/allegro/erli/)). Erli works **exclusively with PL sellers**, new goods, SMB-skewed ([naszeopinie.net](https://naszeopinie.net/opinie-erlipl/)). No source publishes a hard overlap %, but the framing + PL-SMB profile make **near-total overlap with OL's Allegro+PrestaShop base** the reasonable inference. **Erli's cohort is OL's existing cohort — not a new audience to acquire.** This is the strongest argument for the bet.

### Competitive landscape — Erli is table-stakes, not a differentiator

**Every major PL multichannel tool already supports Erli**: BaseLinker ([help](https://baselinker.com/pl-PL/pomoc/faq/moduly-marketplace/erli/)), Apilo ([integration](https://apilo.com/pl/integracje/erli/)), xSale, Sellasist (incl. Erli↔PrestaShop), IdoSell, Base.com. Erli actively courts integration partners (it even built its BaseLinker connector from the Erli side). Tools fold Erli into a flat channel-module fee — **not monetised as a premium add-on**. Implication: for a PL multichannel tool, **lacking Erli is a visible gap**; integrating it **closes parity rather than opening a lead**.

### Demand signal — a solved expectation, not a burning cry

An active "how to sell on Erli" / "Erli vs Allegro" agency-content economy exists (Dealavo, Vinson, Sellasist, Apilo, ifirma…), consistently framing Erli as an **additional** channel. Notably, there's **no loud "please add Erli" forum chorus** for tools like OL — because the incumbents already shipped it, the demand is already absorbed. Absence of the cry is itself signal: it's an expected baseline, not an unmet need.

### Honest caveats (kept so the spec survives scrutiny)

1. **"0% commission" is marketing.** Effective rate is **5–10%** in practice ([Sellasist](https://sellasist.pl/blog/erli-vs-allegro/), [webwavecms](https://webwavecms.com/blog/alternatywa-dla-allegro)); "from 0%" is a promo/category floor. Still below Allegro's 1–17% + PLN 39/mo, but don't over-state the differentiation.
2. **Similarweb shows a -12.7% MoM web-visit dip (Apr 2026)** against company-reported +45–57% GMV/transaction growth ([Similarweb](https://www.similarweb.com/website/erli.pl/)). Likely app-driven buying (4.8/5 app) that Similarweb undercounts + single-month noise — but unresolved.
3. **Founder-controlled, a reported 2025 shareholder governance dispute** ([Wiadomości Handlowe](https://www.wiadomoscihandlowe.pl/e-commerce-i-e-grocery/biznesmani-powiazani-z-marketplace-m-erli-w-konflikcie-prezes-w-sporze-z-bylymi-udzialowcami-2507553)). KPIs through FY2025 unaffected; improving profitability lowers "could vanish" risk. Note as a low continuity risk.
4. **Buyer-side platform-maturity complaints** (post-sale service, returns friction) — tempers the "rocket" narrative, but not a reason against integrating.

### Phase B synthesis — what we now know

- ✅ **Cohort is real and on-wedge.** 34k PL SMB sellers, near-totally overlapping OL's Allegro+PS audience. Not thin. The "default to don't build" risk from Gate A is **substantially resolved.**
- ✅ **Erli is the lowest-risk, highest-cohort-fit second-marketplace bet** vs Empik / Kaufland.pl / Amazon.pl.
- ✅ **Erli courts integrators + has a documented REST API** → low integration risk.
- ⚠️ **Reframe vs Phase A:** the bet is **parity-closing** ("be a credible PL multichannel tool"), **not differentiation**. Every competitor already has Erli. The Allegro-ID-reuse angle is a nice implementation efficiency, not a market moat.
- ❓ **The remaining product judgement is not "is Erli viable" (it is) but "is parity-closing the right use of ~5–6 weeks now, vs a differentiating bet?"** — a maintainer call, not a research finding. Surfaced at Gate D.

## 4. Solution exploration

Erli's capability shape mirrors Allegro: `OrderSourcePort` (ingest orders) + `OfferManagerPort` and its sub-capabilities (list/update offers). The solution space is therefore not *what* to build — the ports are established — but *how much* and *in what order*. Five candidate shapes evaluated against problem fit / persona fit / strategic fit / risk.

### A re-examination Phase B forced: which half is more valuable for a *secondary* channel?

For WooCommerce (#872) the shop is the merchant's *primary* system of record, so order ingestion + writeback dominate. Erli is the opposite — a **secondary, low-volume sales channel**. That inverts the usual intuition:

- **Offer listing** is the higher-leverage half here. The operator's actual pain is "get my products onto Erli cheaply"; Erli's Allegro-ID compatibility makes that near-free *only through an integration*. Listing is what generates the sales — and therefore the orders.
- **Order ingestion** of a low-volume secondary channel is valuable (unified fulfilment, OL as system of record) but *low absolute volume per seller*, and an operator can limp along processing a handful of Erli orders manually.

This reopens the "order ingestion first" framing from issue-creation — surfaced as the key sub-decision at Gate C.

### Candidate shapes

| # | Shape | v1 capabilities | Effort | What ships first |
|---|---|---|---|---|
| **A** | **Full-parity adapter, both halves** | OrderSource + OfferManager (+ sub-caps) | ~L (≈5–6 wk) | Complete Erli channel: list offers (Allegro-ID reuse) + ingest orders into OL pipeline |
| **B** | Sliced — **orders first**, offers v2 | OrderSource v1; OfferManager v2 | ~M (≈2.5–3 wk v1) | Erli orders flow into OL fulfilment; operator still lists on Erli by hand / other tool |
| **C** | Sliced — **offers first**, orders v2 | OfferManager v1; OrderSource v2 | ~M (≈3 wk v1) | Operator lists on Erli from OL reusing Allegro mappings; orders handled in Erli panel until v2 |
| **D** | Order-ingestion only, **permanent** | OrderSource only | ~M (≈2.5–3 wk) | Erli as a read-only order source; never list from OL |
| **E** | Do nothing — point users at BaseLinker | none | 0 | OL stays single-marketplace; concede the parity gap |

### Comparison

| Axis | A (full) | B (orders-first) | C (offers-first) | D (orders-only) | E (nothing) |
|---|---|---|---|---|---|
| **Problem fit** — credible "one tool for Erli" | ✅ Full | 🟡 Half — can't list | 🟡 Half — orders manual | ❌ Listing (the real pain) unsolved | ❌ |
| **Persona fit** — secondary low-volume channel | ✅ Matches how they'd use it | 🟡 Solves the lower-leverage half first | ✅ Solves the higher-leverage half first | ❌ Misses the listing pain | ❌ |
| **Strategic fit** — PL-channel parity | ✅ True parity | 🟡 Partial | 🟡 Partial | 🟡 Partial, and atypical | ❌ Concedes wedge |
| **Risk — implementation** | 🟡 Volume of work real; shape known (Allegro reference) | ✅ Smaller v1 | ✅ Smaller v1 | ✅ Smallest coherent v1 | ✅ |
| **Risk — adoption** | ✅ Operator can fully switch their Erli ops to OL | ❌ Keeps another tool for listing → no real switch | 🟡 Lists via OL but processes orders elsewhere | ❌ Still needs another tool to list | ❌ |
| **Sandbox-blocker exposure** | 🟡 Order-mapping + buyer-PII gated on sandbox (see sub-decisions) | 🟡 Same, on the critical path | ✅ Offers half is *not* PII-gated → can ship without sandbox | 🟡 Fully gated on sandbox | ✅ |

### Per-shape detail

**A — Full-parity adapter (RECOMMENDED).** Ships both halves. Operator lists Erli offers from OL (reusing Allegro category/parameter mappings, near-free) and Erli orders flow into the same OL pipeline that already handles Allegro/PS — unified fulfilment, OL as system of record. Effort ~L. The only shape where the operator can move their *entire* Erli operation into OL and drop the parallel tool — the whole point of an orchestration layer. Internal build sequencing (which half first) is a delivery detail, resolved as a sub-decision, not a separate product.

**B — Orders first, offers v2.** Lands order ingestion as v1, defers listing. **Reason to be cautious as v1:** for a secondary channel this ships the *lower-leverage* half first — the operator still needs another tool (or the Erli panel) to actually *list*, and listing is what drives the sales. They haven't escaped the parallel tool. (This was the issue-creation default; Phase B's secondary-channel insight is what reopens it.)

**C — Offers first, orders v2.** Lands listing as v1 — the higher-leverage half for a secondary channel — and defers order ingestion. **Bonus:** the offers half is **not blocked by the sandbox/buyer-PII unknown** (that gates order mapping + customer identity), so C can ship without waiting on support-gated sandbox access. **Reason to be cautious:** orders processed in the Erli panel until v2 means OL isn't yet the system of record for Erli sales — partial.

**D — Order-ingestion only, permanent.** Treat Erli as a read-only order source forever. **Reason to reject:** leaves the actual pain (cheap listing) unsolved and is an atypical, half-a-marketplace posture that doesn't match how the persona wants to use a secondary channel.

**E — Do nothing.** Honest counter-position. **Reason to reject:** Phase B confirms Erli is table-stakes for a credible PL multichannel tool; conceding it keeps OL single-marketplace. (The counter-counter, from Gate B: parity isn't differentiation — so E is a legitimate "spend the weeks elsewhere" choice if the maintainer prioritises a differentiating bet. Carried to Gate D.)

### Chosen shape

**Shape A — Full-parity Erli marketplace adapter**, implementing `OrderSourcePort` + `OfferManagerPort` (and the sub-capabilities `OfferCreator`, `OfferFieldUpdater`, `updateOfferQuantity`, category/parameter handling, variant grouping, offer-status reconciliation) against Erli's REST Shop API.

**Build sequencing: offers first** (Gate C decision). Build `OfferManager` while support-gated sandbox access is pending — the offers half doesn't depend on a live order payload or buyer-PII resolution — then `OrderSource` once sandbox access lands and the order schema + buyer-PII shape are confirmed.

Rationale:
1. Erli is a *secondary* channel; listing is the higher-leverage half (drives the sales, reuses Allegro mappings near-free). Shipping it first delivers value soonest.
2. The offers half is **not blocked by the sandbox unknown**; the orders half is. Offers-first means real progress without waiting on Erli support to provision a sandbox.
3. Only full parity lets the operator drop the parallel tool — partial cuts (B/C as terminal states) leave them straddling two systems for a low-volume channel, where the straddle cost outweighs the channel.

### Key sub-decisions

- **Build sequencing: offers first, orders second** — chosen at Gate C (rationale above).
- **Allegro-ID reuse** for category/parameter resolution (`source:"allegro"`) — locked as a design constraint at issue creation.
- **Async/reconciliation posture:** Erli writes are HTTP 202 + ~20-min cache lag; no-retry 5 s webhooks. The adapter is *reconciliation-first* (snapshot-based offer status, inbox poll as mandatory order backstop), not synchronous-confirmation like Allegro. Tier 2 / ADR decision (see [ADR-025](../architecture/adrs/025-erli-marketplace-adapter.md)), flagged here because it shapes the "manage offers" UX promise.

## 5. Product specification

**Rough effort estimate:** ~L (≈5–6 weeks at order-of-magnitude resolution). Day-by-day breakdown belongs in Tier 2 implementation plans.

### User stories

1. **As a PL Allegro+PrestaShop seller, I want to connect my Erli seller account to OpenLinker** (paste my Erli API key), so that I can manage Erli as a sales channel from the same place I run Allegro and PrestaShop.
2. **As a PL seller, I want to list my products on Erli from OL reusing my existing Allegro category and parameter mappings**, so that adding the Erli channel costs me almost no extra catalog/taxonomy work.
3. **As a PL seller, I want my multi-variant products to list on Erli as a grouped offer**, so that buyers see one listing with selectable variants, the same as on Allegro.
4. **As a PL seller, I want OL to keep my Erli offer stock and price in sync with my master inventory**, so that I don't oversell or show stale prices on Erli, and I don't update stock in two places.
5. **As a PL seller, I want my Erli orders to appear in OL's unified order pipeline**, so that I fulfil and track Erli sales the same way I do Allegro/PS orders — without logging into the Erli panel.
6. **As a PL seller, I want OL to push fulfilment status (and, where applicable, tracking) back to Erli as I process an order**, so that the buyer sees accurate status and I don't duplicate status updates across systems.
7. **As a PL seller, I want OL to reflect Erli's live offer status back to me** (active / inactive / what Erli actually accepted after its async processing), so that I can trust OL's view of what's really live on Erli despite Erli's delayed write propagation.

### Acceptance criteria (user-visible only)

Engineering AC — rate-limit/429 handling, 202-retry/reconciliation semantics, identifier-mapping internals, inbox-cursor mechanics, capability-port wiring — belongs in Tier 2 implementation plans, not here.

| Story | User-visible AC |
|---|---|
| 1. Connect | Operator enters their Erli API key in OL Admin → connection test passes → connection appears Active in the connections list. Invalid key → a clear validation error, no connection created. |
| 2. List (Allegro reuse) | Operator selects products and lists them on an Erli connection → OL submits offers that carry the products' existing Allegro category + parameter IDs → operator does **not** re-enter Erli-specific taxonomy → within Erli's processing window the offers appear in the Erli seller panel. |
| 3. Variant grouping | A multi-variant product listed on Erli appears as **one** buyer-facing listing with selectable variants (not N unrelated listings). |
| 4. Stock/price sync | Operator's master stock for a mapped SKU changes → within a reasonable window the Erli offer quantity updates to match; a price change propagates the same way. A SKU that goes to 0 lists as 0 on Erli (no oversell). |
| 5. Order ingest | An Erli order is placed → within a reasonable window it appears in OL's order list, distinguishable as Erli-sourced, with correct line items, totals, and (where Erli provides it) buyer/shipping details → it flows into the same fulfilment path as Allegro/PS orders. |
| 6. Status writeback | Operator advances an Erli-sourced order in OL (e.g. marks shipped) → OL reflects that to Erli (status, and tracking where the carrier isn't Erli-managed) → operator does not re-enter it in the Erli panel. |
| 7. Offer-status truth | After listing or updating an Erli offer, OL eventually shows the offer's **real** Erli status (accepted / active / inactive / rejected) rather than only "submitted" — so the operator can trust OL's view despite Erli's ~20-min propagation. |

"Within a reasonable window" reflects operator expectation, not a measured SLA, and is deliberately loose given Erli's documented async (HTTP 202 + up to ~20-min cache lag) write model. Definition of done (§7) catches whether this feels acceptable in production.

## 6. Out of scope

Picked because someone might *actually ask* — not an exhaustive future-feature catalog.

1. **Marketplace-source returns / warranty ingestion** — Erli supports returns/warranty, but OL's port surface doesn't model marketplace-side returns yet (true for Allegro too). A cross-cutting product decision of its own.
2. **Erli-native taxonomy authoring** — v1 leans on Allegro-ID reuse (`source:"allegro"`). Mapping products that have *no* Allegro category/parameter data onto Erli's own categories is a follow-up; v1 targets the operator who already has Allegro data.
3. **Erli promotions / discounts / advertising / Smart-badge equivalents** — channel scope is offers + stock/price + orders. Merchandising stays in the Erli panel.
4. **Erli-managed shipment label generation** — for Erli-managed shipments OL must *omit* tracking (Erli owns it); OL doesn't generate Erli's shipping labels. OL pushes tracking only for non-Erli-managed carriers.
5. **`frozen`-field conflict UI** — Erli marks seller-panel-edited fields `frozen` (API writes won't overwrite them). v1 respects frozen fields but does not build an operator-facing conflict-resolution surface for them.
6. **Multi-currency** — v1 assumes PLN (Erli is PL-only); no multi-currency handling.

## 7. Definition of done

Stage 1 calibration: qualitative, no metric theatre (no instrumentation to measure "% adoption" honestly).

1. **At least one real PL Allegro+PrestaShop SMB operator runs Erli through OL in production for ≥30 days** — listing offers *and* processing orders — without reverting to a parallel tool for Erli.
2. **That operator lists a new product on Erli reusing their existing Allegro category/parameter mapping** without re-doing taxonomy work — the Allegro-ID-reuse promise is real in practice, not just on paper.
3. **Erli orders appear in OL's unified pipeline** and are fulfilled indistinguishably from Allegro/PS orders (same status flow, same fulfilment).
4. **OL's view of Erli offer status is trustworthy** despite the async write model — the operator doesn't have to cross-check the Erli panel to know what's live.
5. **No regression to the Allegro or PrestaShop adapters** — the second-marketplace work didn't leak Erli assumptions into core or break the existing channels.

## 8. Risks

Top product-direction risks only. Engineering risks (rate limits, 202 reconciliation, schema drift, retry semantics) belong in the Tier 2 plan.

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **Parity, not differentiation.** Every PL competitor already ships Erli; integrating it closes a gap rather than opening a lead. The ~5–6 weeks buy *credibility*, not a moat. | Accept consciously (Gate B/D). Sequence Erli relative to differentiating bets deliberately — don't let "table-stakes" work crowd out the thing competitors *lack*. The low marginal cost (Allegro reference + ID reuse) is what justifies it despite no moat. |
| **R2** | **Low per-seller volume → weak adoption pull.** Erli is a secondary channel (~3% of Allegro GMV); an operator may not bother wiring up OL for a handful of Erli orders/month if listing isn't genuinely near-free. | The whole bet rests on Allegro-ID reuse making listing near-free. If DoD #2 (reuse works in practice) fails, the value proposition collapses — treat it as the make-or-break acceptance criterion, not a nice-to-have. |
| **R3** | **Sandbox access is support-gated and may stall the orders half.** OL has no Erli credentials yet; the order schema + buyer-PII shape can't be finalised without a live sandbox payload. | Offers-first sequencing (Gate C) de-risks this — real progress ships without sandbox. Request sandbox access *now*, in parallel, so it's available by the time the orders half starts. |
| **R4** | **Erli platform continuity.** Founder-controlled with a reported 2025 shareholder dispute; a secondary marketplace could stall or pivot. | Low/structural — KPIs through FY2025 are healthy and profitability is improving. The adapter is isolated behind the plugin contract; if Erli fades, the cost was bounded and core is untouched. |

## 9. Implementation breakdown

18 implementation issues spawned 2026-06-05 (Gate D = YES). Sized S–L; no XL. Sequenced **offers-first** per Gate C — the foundation + offers half can proceed immediately; the orders half is gated on the sandbox-access spike (#992).

### Foundation

| Issue | Title | Size | Blocked by |
|---|---|---|---|
| [#980](https://github.com/openlinker-project/openlinker/issues/980) | Plugin skeleton + static manifest + host registration | **S** | — |
| [#981](https://github.com/openlinker-project/openlinker/issues/981) | ErliHttpClient (bearer, keep-alive, 429 backoff) | **M** | #980 |
| [#982](https://github.com/openlinker-project/openlinker/issues/982) | Connection: API-key auth + shape validators + tester | **M** | #980, #981 |
| [#983](https://github.com/openlinker-project/openlinker/issues/983) | ADR: reconciliation-first posture, API-key auth, Allegro-ID reuse | **S** | — (early) |

### Offers half (built first)

| Story | Issue | Title | Size | Blocked by |
|---|---|---|---|---|
| 2 | [#984](https://github.com/openlinker-project/openlinker/issues/984) | ErliOfferManager: single-PATCH product (Creator/FieldUpdater/quantity) | **L** | #981, #982 |
| 2 | [#985](https://github.com/openlinker-project/openlinker/issues/985) | Category & parameter mapping via Allegro-ID reuse | **M** | #984 + Allegro resolver |
| 3 | [#986](https://github.com/openlinker-project/openlinker/issues/986) | Multi-variant grouping (`externalVariantGroup`) | **M** | #984 |
| 4 | [#988](https://github.com/openlinker-project/openlinker/issues/988) | Stock & price sync + frozen-field ownership | **M** | #984 |
| 7 | [#989](https://github.com/openlinker-project/openlinker/issues/989) | Offer-status reconciliation snapshot (async 202 / lag) | **M** | #984 |
| 1 | [#990](https://github.com/openlinker-project/openlinker/issues/990) | FE: Erli connection setup UI + web plugin registration | **M** | #982 |
| — | [#991](https://github.com/openlinker-project/openlinker/issues/991) | Offers vertical-slice integration tests | **M** | #984, #985, #986, #988, #989 |

### Orders half (built second; gated on the sandbox spike)

| Story | Issue | Title | Size | Blocked by |
|---|---|---|---|---|
| — | [#992](https://github.com/openlinker-project/openlinker/issues/992) | **Verification spike: sandbox + live order/inbox payload (BLOCKING)** | **S** | external creds |
| 5 | [#994](https://github.com/openlinker-project/openlinker/issues/994) | Order → `IncomingOrder` mapper (COD, line items, addresses) | **M** | #992 |
| 5 | [#993](https://github.com/openlinker-project/openlinker/issues/993) | ErliOrderSourceAdapter: inbox feed + getOrder + scheduled poll | **M** | #981, #982, #992, #994 |
| 5 | [#995](https://github.com/openlinker-project/openlinker/issues/995) | Buyer identity resolution (identity mode + email normalization) | **M** | #992, #994 |
| 5 | [#996](https://github.com/openlinker-project/openlinker/issues/996) | Inbound webhooks: translator + routing + provisioning | **M** | #980, #992 |
| 6 | [#997](https://github.com/openlinker-project/openlinker/issues/997) | Order status & fulfilment writeback (omit tracking for Erli shipments) | **M** | #993 |
| — | [#998](https://github.com/openlinker-project/openlinker/issues/998) | Orders vertical-slice integration tests | **M** | #993, #994, #996 |

**Critical path (offers):** #980 → #981 → #982 → #984 → {#985, #986, #988, #989} → #991.
**Critical path (orders):** #992 → #994 → #993 → #997 / #998.
#983 (ADR) and #990 (FE) parallelise off the critical path. Request Erli sandbox access (for #992) in parallel with the offers build so the orders half isn't stalled when it starts.

## 10. Decision log

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-06-05 | Pre-A | File Product Design issue #978 as maintainer-initiated marketplace expansion; no originating feature request | Erli is the cheapest-to-reach second PL marketplace for OL's existing Allegro+PS audience (Allegro-ID reuse); validates the marketplace plugin contract against a second marketplace API |
| 2026-06-05 | Pre-A | Scope intent at issue-creation: **full parity** (OrderSource + OfferManager), order ingestion as first build phase | User choice during issue framing; revisited in Phase C |
| 2026-06-05 | Pre-A | Design constraint: **reuse Allegro category/parameter resolution** (`source:"allegro"`) rather than a fresh Erli taxonomy | User choice during issue framing |
| 2026-06-05 | Gate A | Problem statement + persona confirmed (incl. "Erli = secondary channel" framing). Proceed to Phase B with genuine cohort sizing — a "don't build / defer" verdict remains on the table per workflow default | Maintainer confirmed |
| 2026-06-05 | Gate B | Cohort confirmed real + on-wedge (34k PL sellers, PLN 1.8bn GMV, near-total overlap with OL's Allegro+PS base). "Don't build" risk substantially resolved. Proceed to Phase C. Reframe accepted: bet is **parity-closing, not differentiation** — carried to Gate D | Maintainer: "continue" |
| 2026-06-05 | Gate C | **Shape A — full-parity adapter** selected over orders-first (B), offers-first-terminal (C), orders-only (D), do-nothing (E). **Build sequencing: offers first** (higher-leverage for a secondary channel + not sandbox-blocked), orders second | Maintainer selected A + offers-first |
| 2026-06-05 | Gate D | **YES — commit engineering time.** Spawn impl issues, close PD parent | Cohort confirmed on-wedge; lowest-risk second-marketplace bet; Allegro reference + ID reuse make listing near-free. Parity-not-differentiation accepted consciously |
| 2026-06-05 | Phase E | Spawned 18 impl issues #980–#998 (offers-first sequenced); closed parent #978 (`completed`) | Foundation (4) + offers half (7) proceed immediately; orders half (7) gated on sandbox spike #992. No XL — sizing held |
