# Implementation Plan: Shoper REST API Spike (#3638)

**Date**: 2026-09-29
**Status**: Ready for Review
**Estimated Effort**: 2-3 hours (writing up already-completed live research)

---

## 1. Task Summary

**Objective**: Write `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`, formalizing the live research already completed against a real Shoper trial shop (`sklep729770.shoparena.pl`) and the official 365-endpoint Shoper Postman collection, in the exact format of `docs/plans/analysis/SPIKE-2879-shopify-admin-api.md` (environment section, provisional verdict, Live/Desk evidence tables grouped by capability area).

**Context**: OpenLinker has no adapter for Shoper, a Polish SaaS e-commerce platform architecturally analogous to PrestaShop/WooCommerce (`ProductMasterPort` + `InventoryMasterPort` + `OrderProcessorManagerPort`), not a marketplace. The requested scope mirrors what the Subiekt GT integration delivers (`openlinker-subiekt-bridge#7`, `#3365`), minus sales documents. This spike is issue #1 of the "Shoper Integration" milestone (#5 on the milestones API) and its doc is the evidence base for the six follow-on capability mini-epics (#3639-#3644), each already filed and each citing `Depends on: #3638`.

**Classification**: Documentation (research write-up; no code, no tests, no migration).

---

## 2. Scope & Non-Goals

### In Scope
- Writing the SPIKE doc itself, with every finding backed by its actual live evidence (curl transcripts, webhook.site captures, admin-panel screenshots described) or Postman-collection static analysis, clearly labelled `Live` vs `Desk` per the `SPIKE-2879` convention.
- A provisional verdict section (lean ADOPT — the scope is demonstrably implementable, with named gaps).
- An explicit list of open items that remain unresolved after this spike (the `x-webhook-sha1` signing algorithm; the real sustained rate-limit ceiling; whether the admin panel auto-generates any sales document server-side outside the API — already checked and confirmed absent, but worth stating as a closed question rather than silently omitted).

### Out of Scope
- Designing or implementing any of the six capability mini-epics (#3639-#3644) — this spike leaves them a foundation, not a design.
- Resolving the `x-webhook-sha1` signature algorithm — recorded as an open item for the Webhook Reconciliation mini-epic (#3644), not blocking here.
- Any code change to `libs/integrations/`, `libs/core/`, or `apps/*` — this is a pure documentation deliverable.
- Multi-warehouse implementation detail — documented as a confirmed Premium-plan gate, not designed further here.

### Constraints
- The trial Shoper account is time-boxed (14-day trial); all live evidence was gathered within that window and is already captured in this conversation's transcript — nothing further needs to be re-verified live for this write-up.
- Must match the `SPIKE-2879-shopify-admin-api.md` structure closely enough that a reader moving between the two marketplace/shop-platform spikes finds the same section shapes.

---

## 3. Architecture Mapping

**Target Layer**: Documentation (`docs/plans/analysis/`) — no `libs/core`, `libs/integrations`, or `apps/*` changes.

**Capabilities Involved** (documented, not implemented): `ProductMasterPort`, `InventoryMasterPort`, `OrderProcessorManagerPort` (+ its `OrderFulfillmentUpdater`-shaped writeback). No `OfferManagerPort`/`OrderSourcePort` — Shoper is a destination shop platform in this scope, not a marketplace or an order source for this milestone.

**Existing Services Reused**: None (no code in this issue). The doc references existing precedents by name for the follow-on epics to reuse: the `#2047` invoicing per-order lock shape (for the future OrderProcessorManager idempotency guard), the existing `OrderLifecycleRelay` (`#1157`/ADR-027) for fulfillment writeback, and PrestaShop's full-enumeration sweep pattern (ADR-048) for catalog sync, since Shoper has no bulk modified-since primitive.

**New Components Required**: One markdown file.

**Core vs Integration Justification**: N/A — this issue produces no code. The eventual adapter (mini-epics #3639-#3644) will live in `libs/integrations/shoper/`, following the existing PrestaShop/WooCommerce integration package shape; this spike's job is only to leave that future work an accurate foundation.

**Reference**: [Architecture Overview - Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure)

---

## 4. External / Domain Research

### External System — Shoper REST API

- **Authentication**: static Bearer token issued per-integration from the shop's own "Dodaj integrację" admin panel (Client ID + Token API) — confirmed live, works directly with no OAuth exchange. Full OAuth2 (`authorization_code`/`refresh_token` via `/webapi/rest/oauth/token`) also exists in the API, for App-Store-distributed public apps — not the right fit for this connection-per-shop model.
- **Rate Limits**: `x-shop-api-calls`/`x-shop-api-limit` headers present on every response; real ceiling not hit in a 25-request burst against the trial shop — the doc records this as unresolved and recommends a longer sustained test before any production launch, not before this spike closes.
- **API Documentation**: `developers.shoper.pl/docs/` (JS-SPA-rendered, could not be fetched programmatically) plus the official downloadable Postman collection (`shoper-api.postman_collection.json`, 365 endpoints across 14 top-level folders) — used as the primary desk-research source, cross-checked against live calls throughout.
- **Data Models**: `products` (header) + `product-stocks` (the real variant/EAN/price/stock grain) for catalog; `orders` (header) + `order-products` (lines) + `users` (customer) for orders; `parcels` for fulfillment writeback; `webhooks` for the event subscription model.
- **Error Handling**: clean, structured JSON errors throughout (`{"error": "...", "error_description": "..."}`), confirmed for `401` (bad token), `403` (insufficient scope), `404` (deleted/missing resource), and `400` (validation, including a full field-by-field listing on a malformed `POST /orders`).
- **Known Pitfalls** (the spike's core value): no order-create idempotency at all (a caller-supplied `code` neither dedupes nor round-trips); orders require an existing `user_id` (no guest auto-provisioning); stock auto-decrements the instant an order line is created; multi-warehouse is Premium-plan-gated; modified-since sync has no bulk primitive; the webhook signature algorithm is unverified.

### Internal Patterns

- **Similar Implementations**: `libs/integrations/prestashop/` and `libs/integrations/woocommerce/` are the closest architectural precedents (shop-platform destination, not marketplace) — the doc references their shape rather than the marketplace-adapter shape (Allegro/Erli) that most other `SPIKE-*` docs in this repo analyze.
- **Reusable Components**: the `#2047` invoicing guard (per-order lock pattern, for the future idempotency gap), the existing `OrderLifecycleRelay`, ADR-048's bounded-sweep full-enumeration pattern, ADR-010's "EAN on the variant" convention (which Shoper's `product-stocks` grain already matches with zero impedance mismatch), and ADR-063's tax-rate vocabulary (which Shoper's `/taxes` resource already matches almost exactly).
- **Existing Patterns**: the `SPIKE-2879-shopify-admin-api.md` document itself is the direct structural template (environment / verdict / Live-Desk evidence tables by capability group).

---

## 5. Questions & Assumptions

### Open Questions
- Exact `x-webhook-sha1` signing algorithm — 13 live-verified candidate formulas ruled out, none matched. Left as an explicit open item in the doc, assigned to the Webhook Reconciliation mini-epic (#3644), not resolved here.
- Real sustained rate-limit ceiling — not hit in a 25-request burst; the doc states this needs a longer test before production launch rather than asserting a number that wasn't actually observed.

### Assumptions
- The trial-shop findings (auth, resource shapes, validation behavior) generalize to any Shoper-hosted shop, since Shoper is a single-vendor SaaS platform (not a self-hosted, version-fragmented platform like PrestaShop) — there is no "which Shoper version" axis to worry about the way there is for PrestaShop.
- The admin-panel-only confirmation that multi-warehouse is Premium-gated (not merely disabled on this one trial account by coincidence) is treated as reliable given the explicit "PREMIUM" badge and upsell copy shown in the UI.

### Documentation Gaps
- `developers.shoper.pl/docs/` could not be fetched by an automated tool (client-side-rendered SPA behind a `#fragment` router) — all desk research instead came from the official Postman collection, which is complete enough for every capability this milestone needs, but the doc notes the docs-site gap explicitly rather than silently relying on Postman alone without saying so.

---

## 6. Proposed Implementation Plan

### Phase 1: Draft the SPIKE doc structure
**Goal**: Stand up the file with the right shape before filling in content, so the structure itself gets reviewed against `SPIKE-2879`'s shape early.

**Steps**:
1. **Create the file skeleton**
   - **File**: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md`
   - **Action**: Title, sources-of-record preamble (live trial shop + Postman collection), Environment section (trial shop domain, Postman collection version/download date, auth model used for live calls), provisional Verdict section
   - **Acceptance**: Structure visually matches `SPIKE-2879-shopify-admin-api.md`'s top-level sections
   - **Dependencies**: None

### Phase 2: Write the Live/Desk evidence tables
**Goal**: Transcribe every finding from this conversation into the doc's evidence-table format, grouped by capability area, each row citing its real evidence.

**Steps**:
1. **Group C — Connect**
   - **File**: same doc, `## C — Connection, onboarding & auth` section
   - **Action**: auth model, scope enforcement (403 confirmed), rate-limit headers, bad-token error shape
   - **Acceptance**: every row cites a real curl transcript or a specific admin-panel screenshot description
2. **Group M — Catalogue & Inventory**
   - **Action**: `products`/`product-stocks` variant grain, EAN round-trip, category tree, `/taxes` vocabulary, `object-mtime` per-object-only finding, deletion detection, absolute-write inventory semantics, Premium-gated multi-warehouse
   - **Acceptance**: the EAN-write-then-read transcript and the `object-mtime` 500→200 debugging sequence are both represented, not just the final answer
3. **Group O — Orders in**
   - **Action**: required-fields validation error, `user_id` guest-rejection, native email-dedup, real-price-passthrough test, the `code`-field duplicate-order finding, the stock-auto-decrement finding, the B2B/NIP timing test
   - **Acceptance**: the duplicate-order finding is stated as a confirmed gap (two orders, two ids), not hedged
4. **Group F — Fulfil**
   - **Action**: `parcels`/tracking, auto status-advance, the full partial-shipment two-parcel sequence
   - **Acceptance**: the partial-shipment finding includes the actual before/after `products[]` contents observed
5. **Group X — Operate / Webhooks**
   - **Action**: webhook CRUD, live event catalog vs Postman gap, full-object payload confirmation (webhook.site capture), the 13 ruled-out signature candidates
   - **Acceptance**: the signature section states plainly "unresolved" rather than guessing a best-fit
6. **Sales documents — explicit exclusion**
   - **Action**: state the triple-confirmed absence (Postman grep, `application-config` grep, admin-panel screenshot) as its own clearly-labelled subsection, not buried inside Group D since there effectively is no Group D content for Shoper
   - **Acceptance**: a reader skimming only this subsection understands the scope boundary without reading the rest of the doc

### Phase 3: Finalize verdict and open items
**Goal**: Close the doc with an honest, evidence-grounded verdict.

**Steps**:
1. **Write the verdict**
   - **Action**: lean ADOPT — every capability in the requested scope (catalog, inventory, order push with real price, fulfillment writeback, webhook trigger) is demonstrably implementable, with three real gaps that need explicit handling in the OrderProcessorManager mini-epic (no order idempotency, no guest auto-provisioning, auto stock-decrement) and one Premium-plan scope boundary (multi-warehouse)
   - **Acceptance**: the verdict names the six mini-epics (#3639-#3644) this doc feeds and does not re-design them

### Implementation Details

**New Components**: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md` only.

**Configuration Changes**: None.

**Database Migrations**: None.

**Events**: None emitted or consumed — no code in this issue.

**Error Handling**: N/A — documented findings only, no runtime error handling introduced.

**Reference**: [Engineering Standards - Project Structure](../engineering-standards.md#project-structure)

---

## 7. Alternatives Considered

### Alternative 1: Skip the formal SPIKE doc and go straight to implementing mini-epic #3639
- **Description**: Start coding the Connection & Auth adapter directly, relying on this conversation's transcript as the record.
- **Why Rejected**: the repo convention (five prior `SPIKE-*` docs, e.g. `SPIKE-2879`) is to leave a durable, reviewable artifact separate from a chat transcript, specifically so the six follow-on mini-epics (which may be picked up by a different engineer or a future session with no access to this conversation) have a citable, structured source of truth rather than "ask the person who ran the spike."
- **Trade-offs**: slightly more upfront writing time; buys long-term reusability and review-ability, and matches every other spike in the repo.

### Alternative 2: One combined doc covering both the spike AND a design for all six mini-epics
- **Description**: Write a single large document that both reports findings and designs the capability ports.
- **Why Rejected**: mixes two different review concerns (is the evidence accurate? vs is the design right?) into one artifact, and the user has explicitly asked for incremental, independently-shippable mini-epics — a combined doc would recreate the "one big PR" problem the milestone structure exists to avoid.
- **Trade-offs**: the six mini-epics will each need their own short design pass when picked up (drawing on this doc), rather than having one upfront; this is the intended shape per the milestone plan.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No code changes — nothing to violate hexagonal boundaries.

### Naming Conventions
- ✅ Filename follows `SPIKE-{issue-number}-{slug}.md` convention (`SPIKE-3638-shoper-rest-api.md`), matching `SPIKE-2879-shopify-admin-api.md` et al.

### Existing Patterns
- ✅ Structure mirrors `SPIKE-2879-shopify-admin-api.md` exactly (environment / verdict / grouped evidence tables).

### Risks
- **Evidence staleness**: the trial shop is time-boxed (14 days) and may become inaccessible before the doc is reviewed. Mitigation: every finding is transcribed with enough concrete detail (exact curl bodies, exact response fields, exact error strings) that the doc stands on its own even if the trial account later expires.
- **Incomplete webhook-signature finding**: leaving `x-webhook-sha1` unresolved could be mistaken for an oversight rather than a deliberate, exhaustively-tested open item. Mitigation: the doc states the 13 ruled-out candidates explicitly, not just "unresolved."

### Edge Cases
- N/A — no runtime behavior in this issue.

### Backward Compatibility
- ✅ N/A — new file only, nothing existing is touched.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- N/A — documentation only.

### Integration Tests
- N/A — documentation only.

### Mocking Strategy
- N/A.

### Acceptance Criteria
- [ ] `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md` exists, follows the `SPIKE-2879-shopify-admin-api.md` format
- [ ] Every finding from this conversation (auth, catalog/variant/EAN/category/tax, inventory write semantics + Premium gate, order creation constraints + all three gaps, fulfillment writeback + partial shipment, webhooks + open signature item, sales-document exclusion) is represented with its real evidence
- [ ] The verdict section names the six mini-epic issues (#3639-#3644) it feeds
- [ ] `pnpm lint` / `pnpm type-check` / `pnpm test` pass unaffected (no code touched — sanity check only)

**Reference**: [Testing Guide](../testing-guide.md)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — no code)
- [x] Respects CORE vs Integration boundaries (N/A — no code)
- [x] Uses existing patterns (no unnecessary abstractions) — reuses the `SPIKE-2879` doc shape
- [x] Idempotency considered (documented as an open gap for #3642, not solved here)
- [x] Event-driven patterns used where applicable (webhook findings documented, not implemented)
- [x] Rate limits & retries addressed (documented as needing a longer real test, honestly)
- [x] Error handling comprehensive (N/A — no code)
- [x] Testing strategy complete (N/A — documentation)
- [x] Naming conventions followed (`SPIKE-3638-shoper-rest-api.md`)
- [x] File structure matches standards (`docs/plans/analysis/`)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [SPIKE-2879 — Shopify Admin GraphQL API](./analysis/SPIKE-2879-shopify-admin-api.md) (structural template)
