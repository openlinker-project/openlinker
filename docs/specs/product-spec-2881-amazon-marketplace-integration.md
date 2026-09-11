# Product Spec — #2881 Amazon marketplace integration (FR/DE/PL)

> **Status: DRAFT SCAFFOLD — not ready for review.** This document exists to hold the shape the final spec
> will take, following `product-spec-978-erli-marketplace-integration.md`. Several sections below are
> intentionally left as open questions rather than decisions, because the underlying spike
> (`docs/plans/analysis/SPIKE-2881-amazon-sp-api.md`) has not yet resolved the evidence they would need to
> rest on — writing a "chosen shape" or acceptance criteria ahead of that evidence would be fabricating
> confidence the research doesn't support yet. Sections are marked **RESOLVED** (spike evidence exists),
> **CARRIED FROM ISSUE** (desk claim only, unverified), or **BLOCKED** (spike question still open) so a
> reviewer can tell which parts to trust.

## 1. Problem

**CARRIED FROM ISSUE.** Amazon is a marketplace-only destination for FR, DE and PL — the highest strategic
value of the four platforms in epic #2878, and the highest cost. The cost drivers are architectural rather than
adapter-shaped: no HTTP webhooks (SQS/EventBridge only — SPIKE Evidence #9, still blocked), a 30-day PII
deletion obligation nothing in the tree currently satisfies, and no browsable category tree (product-type JSON
Schema instead of `CategoryParameter`).

## 2. Affected persona

**BLOCKED.** Not yet researched for this issue. The Erli spec's persona work (`product-spec-978`) is not
transferable — Amazon's seller base, price point and competitive position are materially different. Needs its
own Phase B/C persona pass before this section can be written honestly.

## 3. Evidence & user research

**BLOCKED**, pending:
- AC8 (commercial sanity check for FR/DE/PL) — not started.
- Cohort sizing for "is an Amazon connection worth building" — not started; this is exactly the kind of
  question the `refine-product` skill's Phase B/C would answer, and it has not been run for this issue.

## 4. Solution exploration

**BLOCKED** on multiple unresolved spike questions that directly shape the solution shape:

- **Connection grain (AC4)** — one connection per marketplace (FR/DE/PL) vs one connection with a marketplace
  axis. The spike found (unlike Amazon's eBay/TikTok siblings) no clean "natural grain" signal yet; needs
  `getMarketplaceParticipations` verified against a **real** seller account (SPIKE Evidence #1 shows this call
  returns identical canned data regardless of region in sandbox, so it cannot answer this question).
- **Public vs private app registration (AC7)** — SPIKE Evidence (Open risks) confirms Private apps cap at 10
  self-authorizations with no OAuth, which is very likely incompatible with OpenLinker's multi-operator model —
  but the annual pentest / Appstore cost of Public is still unverified from a primary source. This gates
  whether "one shared OL-owned Amazon app" or "each operator registers their own" is the right shape, which in
  turn changes almost every downstream UX decision (who sees what credentials, who bears compliance cost).
- **Category/attribute UX (T1 — ✅ RESOLVED, T5 still open).** SPIKE Evidence #10 confirms, from the complete
  path list of every current and deprecated Catalog Items / Product Type Definitions API version, that **no
  browse-node tree walk exists anywhere in SP-API**. The nearest thing (`listCatalogCategories`, deprecated v0)
  requires an existing ASIN and returns only that product's ancestor path — it cannot be used to discover the
  tree from root. **This means the wizard's shared category-picker UX (Allegro/Erli/WooCommerce pattern) does
  NOT transfer to Amazon**, and needs its own design: the likely entry point is
  `searchDefinitionsProductTypes` (keyword search over product types, since "product type" is Amazon's actual
  organizing unit, not a category tree). T5 (conditional required attributes, ADR-023's pre-recorded gap) is
  still open and now more clearly in scope regardless of the tree question, since product-type JSON Schema
  conditionals apply however a product type is *found*.
- **New-ASIN vs offer-against-existing-ASIN (P2)** — GTIN exemption is a manual, per-brand, human-approved
  Amazon process OL cannot automate. The realistic default (offer-against-existing-ASIN, new-ASIN as an
  advanced/manual path) mirrors Allegro's card-linked shape closely enough that the existing wizard blocker
  vocabulary (#2240) likely extends — but this is a hypothesis, not yet confirmed against a real GTIN-exempt
  brand.

## 5. Product specification

**BLOCKED.** Cannot write user stories or acceptance criteria responsibly until Section 4's open questions
resolve — several of them (connection grain, category UX) change what the user-visible behaviour even is, not
just its implementation.

## 6. Out of scope

**Confirmed by the epic framing (not Amazon-specific research), so statable now:**
- `ProductMaster` / `InventoryMaster` roles — SPIKE Verdict section did not find evidence to overturn the
  issue's own exclusion (Amazon owns the ASIN; FBA stock is a fulfilment location, not a ledger OL can
  propagate outward from).
- Direct-to-Consumer Shipping–gated functionality (buyer addresses, label buying, returns reports) is out of
  scope until that restricted role is granted — see SPIKE prerequisites.

## 7. Definition of done

**BLOCKED**, deferred to when Section 5 exists.

## 8. Risks

Carried directly from the SPIKE's Open Risks section (see `SPIKE-2881-amazon-sp-api.md`):
- v2026-01-01 Orders sandbox coverage may not be wired up (Evidence #6) — could force live-account-first
  development for order ingestion specifically, ahead of what the epic's other three platforms required.
- C13 (Notifications/SQS ingress) is blocked on an unresolved `invalid_scope` error with no further automated
  path — this is the architecturally riskiest single piece of the whole integration and cannot be estimated
  with confidence yet.
- The 30-day PII deletion obligation (X4) has no existing mechanism anywhere in the OpenLinker tree — sizing
  this is itself a prerequisite epic (AC5), not an implementation detail of this one.

## 9. Implementation breakdown

**BLOCKED.** Not written — would require Section 4/5 to exist first, and would currently be pure speculation
dressed as a plan.

## 10. Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-09-04 | Confirmed `sellingpartnerapi::notifications` is the correct grantless scope string (via community SDK cross-check) — narrows C13's blocker to an account/app-level restriction, not a parameter typo | Informational, does not unblock C13 |
| 2026-09-04 | Confirmed Amazon order lines carry no tax rate in either Orders API version (v0 or v2026-01-01), from the sandbox model's own documented response body | Resolves O10/D4 definitively |
| 2026-09-04 | This product-spec intentionally left as a scaffold rather than populated with placeholder decisions | Deliberate — avoids false confidence ahead of spike completion |
