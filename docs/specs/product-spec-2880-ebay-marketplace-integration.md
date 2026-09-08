# Product Spec — #2880 eBay (GB/DE/FR/PL) marketplace integration

**Status:** Phase C (solution exploration) — grounded in a live-probed technical spike, not yet
through a market/cohort gate. **This is not a Gate-D commit and spawns no implementation issues
yet** — see §10.
**Parent issue:** [#2880](https://github.com/openlinker-project/openlinker/issues/2880), part of epic [#2878](https://github.com/openlinker-project/openlinker/issues/2878)
**Started:** 2026-09-07
**Last updated:** 2026-09-07

---

## 1. Problem

OpenLinker's marketplace reach today is Allegro-only (PL) plus the WooCommerce/PrestaShop shop
side. eBay is well documented, structurally close to Allegro's shape (an external catalogue you
link against rather than own, per-category required attributes, an offer lifecycle with its own
publish step), and — per epic #2878 — the closest of the four candidate marketplaces (Amazon,
Shopify, eBay, TikTok Shop) to something OL already knows how to build.

Two things make eBay valuable beyond "another channel", both confirmed live in
[SPIKE-2880](../plans/analysis/SPIKE-2880-ebay-sell-apis.md):

1. **`withdrawOffer` is a real, verified end-listing that preserves the offer for relisting** —
   the first shipped destination with a genuine `OfferDeactivator`, the capability #1689 deferred
   because no adapter had one. Live-probed: withdraw survives as `UNPUBLISHED`, republish mints a
   new `listingId` but keeps SKU/policies/category.
2. **The `inventory_item → offer → publishOffer` staging model** maps directly onto OL's existing
   `OfferCreationRecord` two-phase shape — confirmed end to end, including multi-variant grouping.

Against that, the same spike surfaced a real blocker this document must be honest about: **no
sandbox purchase has completed**, so the entire order/fulfilment/returns/money half of the
capability surface remains unverified, and the root cause is most likely an incomplete sandbox
seller registration rather than an eBay limitation.

## 2. Affected persona

**Not independently researched for this pass.** Epic #2878 frames the shared four-marketplace
persona as an EU/UK-domiciled seller expanding beyond Allegro/PrestaShop; no eBay-specific cohort
sizing, GMV data, or competitive-landscape research (the kind #978's Erli spec cites with named
sources) has been produced here. Unlike Erli — where PL market-share evidence anchored Gate B —
epic #2878 records only that eBay's own PL traffic estimates conflict by roughly 10x and that
neither figure is eBay's own (`AC8`). **Treat the persona section below as a working hypothesis
carried over from epic-level framing, not as evidence-backed as Erli's.**

| Axis | Value (hypothesis, unconfirmed) |
|---|---|
| **Who** | An OL operator selling into GB and/or one or more of DE/FR/PL, already running a PrestaShop/WooCommerce master and (for PL) possibly Allegro |
| **Company size** | SMB, matching the existing OL cohort |
| **Sophistication** | Operator-UI driven; not expected to hand-manage RFC 9421 signing or business-policy authoring |
| **Geographic focus** | Cross-border EU/UK — the spike's own reading of eBay's Polish marketing ("80% sprzedaży to transakcje w UE") suggests **the real PL product may be "a Polish merchant selling into DE/GB/FR"**, not eBay.pl as a domestic channel. This directly informs Out of scope (§6) and is epic #2878's still-open `AC8`.

## 3. Evidence & user research

This section is **technical evidence only** — a full 34-row live-probe table, not market research.
See [SPIKE-2880-ebay-sell-apis.md](../plans/analysis/SPIKE-2880-ebay-sell-apis.md) for the complete
Verdict → Evidence → API surface → Open risks → Recommendation writeup. Summary relevant to shape
selection below:

- **Publish confirmed production-ready-shaped.** Full `inventory_item → offer → publish` lifecycle,
  multi-variant grouping via `inventory_item_group`, `withdrawOffer` as a genuine pause primitive,
  bulk price/quantity updates (resolved: up to 25 SKUs/call, not one), GPSR regulatory-policy
  discovery, and tax-rate write refusal (`tax.vatPercentage` correctly rejects exemption codes) —
  all live-probed against a real GB inventory item and offer.
- **Webhook provisioning confirmed working end to end** (`config → destination → subscription`),
  after two undocumented prerequisites: the correct `deliveryConfig.endpoint` payload shape, and an
  app-level notification config (`PUT /commerce/notification/v1/config`) that must exist first.
- **Order ingestion is unverified, not disproven.** Two independent sandbox purchases, from two
  buyer accounts, both registered as a sale at the offer level but neither reached
  `GET /sell/fulfillment/v1/order` — both ended in `Payment failed`. The most likely cause,
  narrowed live, is that the sandbox seller was registered on `EBAY_DE` while every listing was
  published to `EBAY_GB` — the issue's own first prerequisite (verified seller registration),
  never satisfied. The recommended next step is a cheap local retest (complete registration, retry
  one purchase), not a production keyset.
- **Two real, adapter-shaping defects confirmed live:** a partial `PUT /inventory_item` silently
  destroys omitted fields including the publish-required `ean` (latent — the listing keeps
  working until the next publish), and a `Content-Language`-mismatched write returns `204` while
  silently discarding the content half of the payload.
- **Two capability gaps confirmed inaccessible in this session:** the Catalog API (GTIN/EAN
  matching, `T7`/`S11`) answers `403` with every token tried; RFC 9421 request signing (`C14`,
  mandatory for EU/UK sellers on refunds/returns writes) needs a confirmed EU/GB-domicile sandbox
  buyer, not yet obtained.

## 4. Solution exploration

Same capability shape as Erli and Allegro before it — `OfferManagerPort` (+ sub-capabilities:
`CategoryBrowser`, an EAN/catalogue matcher, `OfferCreator`, `OfferFieldUpdater`,
`OfferQuantityBatchUpdater`, and now a real `OfferDeactivator`) for publish, `OrderSourcePort` +
`OrderProcessorManagerPort`-family capabilities for the order side. The open question is not *what*
to build — the ports are established — but *how much, and in what order*, given that one half is
production-ready-shaped and the other is a confirmed unknown.

### Candidate shapes

| # | Shape | v1 capabilities | What ships first |
|---|---|---|---|
| **A** | Full-parity adapter, both halves | OfferManager + OrderSource together | Everything — but ships an order-ingestion path this session could not verify works at all |
| **B** | **Publish-first, orders gated on a re-test (RECOMMENDED)** | `OfferManagerPort` v1 now; `OrderSourcePort` after the cheap local retest closes Open Risk 1 | Listing/publish adapter goes live on confirmed-working ground; order ingestion starts only once a real sandbox order has been observed end to end |
| **C** | Orders-first | `OrderSourcePort` only | Rejected outright — the one thing this spike could *not* confirm works at all, chosen as the *first* thing to ship |
| **D** | Do nothing yet — wait for a production keyset | none | Concedes eBay entirely pending an unrelated production-access blocker (`C15`) that has nothing to do with the publish half already confirmed working |

### Comparison

| Axis | A (full) | B (publish-first) | C (orders-first) | D (wait) |
|---|---|---|---|---|
| **Evidence fit** — matches what this session actually confirmed | ❌ Commits to an unverified half alongside the verified one | ✅ Ships exactly what was proven | ❌ Ships exactly what was *not* proven | 🟡 Defers everything, including the confirmed half |
| **Risk — silent failure** | ❌ An order-ingestion bug ships behind a confident-looking PR, indistinguishable from the account-setup issue this spike found | ✅ No order-ingestion code ships until a real order has round-tripped | ❌ Builds the riskiest half first with the least evidence | ✅ No risk, no progress either |
| **Time-to-value** | 🟡 Slower — both halves gate each other | ✅ Fastest real capability shipped | 🟡 Blocked on the same retest, with nothing else to show meanwhile | ❌ Slowest — blocked on production access unrelated to publish |
| **`OfferDeactivator` promotion (#1689)** | ✅ | ✅ | ❌ Not reached in this shape | ❌ Not reached |

### Chosen shape

**Shape B — publish-first, with order ingestion explicitly gated on Open Risk 1's retest**,
mirroring the same "ship the confirmed half, don't guess at the unconfirmed one" logic #978's Erli
spec used for its offers-first sequencing, for an unrelated but structurally identical reason:
Erli's orders half was gated on sandbox *access*; eBay's is gated on sandbox *evidence* — the
sandbox exists and is reachable, but nothing purchased through it yet.

Rationale:
1. The publish half is the one half this spike actually proved production-ready-shaped, end to
   end, including two of the issue's own open questions (`S2`, `S8`) resolved by direct
   observation.
2. Shipping `OrderSourcePort` against an ingestion path that has never observed a real order is
   exactly the failure mode this spike's own methodological note warns about: a confident-looking
   implementation standing on an assumption nobody tested.
3. The retest that would close Open Risk 1 is cheap and local (complete the sandbox seller's
   registration, retry one purchase) — there is no reason to either skip it or block the whole
   adapter on it.

### Key sub-decisions carried from the spike

- **`withdrawOffer` is promoted to a real `OfferDeactivator`** (#1689's deferred capability),
  not kept as an eBay special case beside quantity-0 — it genuinely ends the listing
  (`ACTIVE → ENDED`) rather than leaving a zero-stock listing visible. The "resuming mints a new
  `listingId`" caveat must be operator-visible, never presented as a silent pause/resume.
- **Category/attribute UI must read `aspectConstraint.aspectRequired`, never `aspectUsage`** — the
  latter lies (`RECOMMENDED` even for hard-required aspects), confirmed 4/4 live.
- **A partial `PUT /inventory_item` must never be issued.** The publish-side builder needs a
  read-modify-write discipline here, not the "send only what changed" shape used elsewhere — this
  destination silently destroys omitted fields.

## 5. Product specification

**Effort estimate:** deliberately not sized here. Order-ingestion effort cannot be estimated
responsibly until the retest in Open Risk 1 either confirms the path works or surfaces a real
platform limitation; sizing the publish half alone belongs in a Tier 2 implementation plan once
Gate C-equivalent sign-off happens (§10).

### User stories (publish half only — Shape B v1)

1. **As an OL operator, I want to connect my eBay seller account to OpenLinker**, so that I can
   manage eBay as a sales channel alongside my existing shop and marketplace connections.
2. **As an OL operator, I want to list my products on eBay per target marketplace (GB/DE/FR/PL)**,
   with the correct category, required aspects, and `Content-Language` for that marketplace, so
   that a listing actually publishes instead of failing on a requirement OL didn't surface.
3. **As an OL operator, I want my multi-variant products to list on eBay as one grouped listing**,
   so that buyers see selectable variants rather than N unrelated listings.
4. **As an OL operator, I want OL to keep my eBay offer stock and price in sync with my master
   inventory**, writing both the inventory-item and offer level per eBay's two-level model, so
   that I never oversell.
5. **As an OL operator, I want to pause an eBay listing without losing its data**, so that I can
   temporarily stop a listing selling and bring it back later without re-authoring it.
6. **As an OL operator, I want OL to tell me the real, current eBay listing status**, not just
   "submitted", so I can trust OL's view instead of cross-checking the eBay seller hub.

### Acceptance criteria (user-visible only)

| Story | User-visible AC |
|---|---|
| 1. Connect | Operator enters an eBay OAuth-authorized connection per credential set → connection test passes (a cheap Taxonomy read) → connection appears Active. A revoked/expired credential surfaces as `needs_reauth`, not a silent failure. |
| 2. List | Operator lists a product on a chosen eBay marketplace → OL resolves the marketplace-specific category, reads `aspectRequired` (never `aspectUsage`) for what must be filled in, and writes the marketplace's own `Content-Language` → the listing publishes or OL reports exactly which required field is missing. |
| 3. Variant grouping | A multi-variant product appears as **one** buyer-facing eBay listing with selectable variants. |
| 4. Stock/price sync | A master stock change propagates to **both** the inventory item and the offer's `availableQuantity` within a reasonable window; a SKU at 0 shows 0 on eBay. |
| 5. Pause/resume | Operator withdraws a listing from OL → it disappears from buyer view but its offer data survives → operator republishes → listing returns, and OL tells the operator this is a *new* listing identity, not a resumed one. |
| 6. Status truth | After a publish or update, OL eventually reflects eBay's real listing status rather than only "submitted". |

Order ingestion, fulfilment writeback, returns and invoicing are **explicitly out of this
version's scope** — see §6 — pending Open Risk 1's resolution.

## 6. Out of scope (this version)

1. **Order ingestion, fulfilment, returns, money (`O`/`F`/`R`/`D` groups) — gated, not rejected.**
   The entire back half of the capability surface waits on Open Risk 1: a completed sandbox
   purchase. Building `OrderSourcePort` against an unverified path is the failure mode this spec
   exists to avoid.
2. **RFC 9421 request signing (`C14`).** Mandatory for EU/UK-domiciled sellers on refund/return
   writes — sized as its own issue per the parent issue's own `AC5`, not bundled here.
3. **Catalog API / GTIN-based catalogue matching (`T7`/`S11`).** Returned `403` in every attempt
   this session; blocked on an unidentified scope or entitlement, not a design decision.
4. **International shipping policy configuration.** Confirmed live to throw a sandbox-side `500`
   regardless of payload shape; domestic-only policies are unaffected and in scope.
5. **`EBAY_PL` as a standalone domestic channel.** Confirmed technically reachable (Taxonomy
   answers for it), but epic #2878's `AC8` — whether the commercial product is "sell domestically
   on eBay.pl" or "a Polish seller exporting into DE/GB/FR" — remains open and unresearched here.
6. **Production keyset activation / account-deletion endpoint (`C15`/`AC2`).** A real but
   separate prerequisite for going live at all; blocked on standing up a production HTTPS endpoint,
   not attempted in this pass.

## 7. Definition of done (publish-half v1)

1. **A real OL operator lists a product on at least one eBay marketplace from OL**, and it appears
   correctly in the eBay seller hub, without the operator re-authoring category/attribute data by
   hand in eBay's own UI.
2. **A multi-variant product lists as one grouped eBay listing**, not N.
3. **Stock and price stay in sync** without an operator-visible oversell incident.
4. **`withdrawOffer`-based pause/resume works as documented to the operator**, including the
   new-listing-identity caveat.
5. **No regression to the Allegro, PrestaShop or WooCommerce adapters.**
6. **Open Risk 1 is closed one way or the other** (order ingestion confirmed working, or
   confirmed as a genuine eBay/account limitation) before any `OrderSourcePort` work begins.

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R1** | **Order ingestion is unverified, not disproven — the biggest open question this doc inherits.** | Complete the sandbox seller's registration and retry one purchase (cheap, local) before committing to `OrderSourcePort` timelines. Only escalate to a production keyset or the legacy Trading API fallback if the retest still fails. |
| **R2** | **RFC 9421 signing (`C14`) is unsized effort that gates the entire returns/refunds story**, and needs a confirmed EU/GB-domicile sandbox buyer this session did not obtain. | Size as its own issue (`AC5`), decoupled from the publish-half v1 scope. |
| **R3** | **Catalog API access is unresolved** (`403` on every token tried), blocking GTIN-based matching. | Open a support/entitlement question with eBay before designing `EanCategoryMatcher`-equivalent logic around an assumption. |
| **R4** | **Taxonomy quota is 5,000 calls/day per App ID, shared across every tenant on a multi-tenant deployment (`T12`).** | The paged, resumable `expandedAt` frontier (#1979/#2061) that `DestinationCategory` already uses for Allegro is mandatory here, not optional. |
| **R5** | **`EBAY_PL`'s commercial value is unconfirmed** (`AC8`, epic #2878) — traffic estimates conflict by ~10x and neither is eBay's own figure. | Do not build a PL-specific marketing case on either number. Treat the "Polish seller exporting into DE/GB/FR" framing as the more defensible product shape until real evidence says otherwise. |
| **R6** | **Two silent-write defects confirmed live** (partial `PUT /inventory_item` destroys omitted fields including `ean`; mismatched `Content-Language` writes discard content while returning `204`) **could ship as latent adapter bugs if the builder doesn't read-modify-write.** | Treat these as hard implementation constraints in the Tier 2 plan, not general awareness — a spec that doesn't enforce them will reproduce them. |

## 9. Decision log

| Date | Phase | Decision | Rationale |
|---|---|---|---|
| 2026-09-04 | Pre-A | Issue #2880 filed as a day-0 desk-research spike, part of epic #2878's four-marketplace scan | eBay flagged as the closest-to-Allegro-shaped, best-documented of the four candidates |
| 2026-09-07 | Phase A/C (technical) | Live sandbox probe conducted against the full #2880 checklist; publish half confirmed production-ready-shaped, order half confirmed unverifiable in this sandbox, root cause narrowed to an incomplete sandbox seller registration | [SPIKE-2880-ebay-sell-apis.md](../plans/analysis/SPIKE-2880-ebay-sell-apis.md) |
| 2026-09-07 | Phase C | **Shape B — publish-first, orders gated on the Open Risk 1 retest** selected over full-parity (A), orders-first (C), and wait-for-production (D) | The spike proved one half works and could not verify the other; shipping the unverified half first (or alongside) reproduces exactly the "confident but untested" failure the spike's own methodological note flags |
| 2026-09-07 | Phase C | This document written at Phase C (solution exploration), explicitly **not** a Gate-D commit | Market/cohort research (persona economics, `AC8`'s PL commercial question) has not been performed for eBay the way it was for Erli's #978 spec — fabricating that evidence here would be worse than leaving it open |

## 10. Implementation breakdown

**Not spawned in this pass.** Unlike #978's Erli spec — which reached Gate D and spawned 18
implementation issues — this document stops at Phase C because:

1. Order-ingestion scope, effort and even feasibility depend on Open Risk 1's outcome, which is a
   cheap but *not yet performed* retest.
2. No market/cohort gate (Phase B) has been run for eBay specifically — epic #2878 carries the
   shared four-marketplace framing and an explicitly open `AC8`, not a per-marketplace verdict.

**Recommended next steps, in order:**

1. Complete the sandbox seller's registration on a matching marketplace and retry one purchase
   (closes Open Risk 1 — the cheapest, highest-information action available).
2. Depending on that outcome, either open a Tier 2 implementation plan for the publish-half v1
   (Shape B, §4) alone, or re-scope this document once the order half's feasibility is known.
3. Size RFC 9421 signing (`C14`) as its own issue, per the parent issue's `AC5`, independent of
   the above.
4. Resolve epic #2878's `AC8` (is `EBAY_PL` worth a connection, or is the real product "PL seller
   exporting into DE/GB/FR") before committing engineering time to a PL-specific connection UX.
