# Implementation Plan: OMS configuration-surface route audit (#3017 step 1)

**Date**: 2026-09-09
**Status**: Ready for Review
**Estimated Effort**: 0.5 day (research + write-up only; no code)

---

## 1. Task Summary

**Objective**: Complete step 1 of issue [#3017](https://github.com/openlinker-project/openlinker/issues/3017)'s Proposed Solution — a full route-by-route audit of `apps/api/src/{oms,bench,fulfillment,fulfillment-authority,inventory,operational-settings,returns}`, recording every route's verb, `@Roles`/`@Public`/`@AnyRole` decorator, and its `apps/web/src` caller (or an explicit **NOT CALLED**). The audit re-verifies every finding #3017 already asserted against the tree at `0906ceb41`, against the current tree (`42cc86dde`, 207 commits later), and extends the same method to the remaining controllers #3017 did not enumerate individually.

**Context**: #3017 found that the OMS backend (Waves 0–3a + the Wave 3b pack bench) is fully built but four features have zero frontend caller, three surfaces are unreachable in practice, and the failure modes compound in a fixed dependency order — an operator cannot switch the OMS on without `curl`. Before writing the product spec (#3017 step 2, explicitly deferred by the user to a later pass), the audit must be current: the issue was filed against a tree 207 commits behind `main`, and several of the named areas (`fulfillment-authority`, `returns`) have shipped substantial frontend work in the interim (the who-decides page, most returns custody actions) that could have silently closed part of the gap.

**Classification**: Documentation / Research (no production code; the deliverable is this audit, embedded below as § 6).

---

## 2. Scope & Non-Goals

### In Scope
- Every `@Get`/`@Post`/`@Patch`/`@Put`/`@Delete` route in the seven named `apps/api/src/` directories.
- Confirming or refuting, against current `main`, each of the seven findings #3017 lists under "Four shipped features have zero UI" and "Three reachability defects."
- Confirming the two tracker facts #3017's Dependencies/Assumptions sections rest on (#2954 open, the #2869 manual-route-producer remainder uncovered).
- A `NOT CALLED` verdict is **route-level**, not endpoint-family-level — a controller with 6 routes and 4 callers is reported as 4 CALLED + 2 NOT CALLED, never rolled up.

### Out of Scope
- Writing `docs/specs/product-spec-oms-configuration-surface.md` (#3017 step 2) — explicitly deferred by the user ("reszta później").
- Producing mockups (#3017 step 3) or filing implementation issues (#3017 step 4).
- Any production code change, in `apps/api`, `apps/web`, or `libs/core`.
- Auditing routes *outside* the seven named directories (e.g. `apps/api/src/shipping`, `apps/api/src/mappings/http/fulfillment-routing.controller.ts` — the latter is referenced only because #3017's spec-step bullet names a naming collision with it; its own routes are not re-audited here since they are not "OMS-adjacent" in the sense #3017 scoped).

### Constraints
- No `pnpm test` (per user's standing instruction — this machine cannot run the suite; not needed here regardless, since no code changes).
- The audit must be reproducible from grep/read commands a reviewer can re-run — no reliance on memory or the issue's own (now up-to-206-commits-stale) claims.

---

## 3. Architecture Mapping

**Target Layer**: None (research/documentation pass; no ports, adapters, services, or components are created or modified).

**Capabilities Involved**: N/A.

**Existing Services Reused**: N/A — the audit reads existing controllers and frontend feature modules; it does not call or modify them.

**New Components Required**: One markdown artifact (this plan, doubling as the audit deliverable).

**Core vs Integration Justification**: N/A — no CORE or Integration code is touched.

---

## 4. External / Domain Research

### Internal Patterns
- #3017's own audit method: for each route, grep the literal path fragment (or its template-literal-built equivalent) across `apps/web/src`, and read the calling file to confirm the call is real (not a comment, test fixture, or dead code) and covers create/edit/delete parity, not just list/read.
- Precedent for "escape hatch" platform-picker gating: `apps/web/src/features/connections/components/platform-picker.tsx` filters candidates on `p.setupCard !== undefined` — confirmed still the mechanism (§ 6.2).
- Precedent for role-gated nav items: `apps/web/src/app/nav-registry.ts` / `nav-registry.types.ts`'s `RoleValues = ['admin', 'operator']` — confirmed the bench's `packer` role (used backend-side via `@Roles('admin', 'operator', 'packer')`) has no FE-nav-eligible counterpart today, which is a fact the later product spec will need when it designs bench discoverability (§ 6.2, finding 3.1).

### Tracker facts checked live (via `gh api`)
- #2954 ("OMS routing — no dry-run surface; `FulfillmentRouterPort.evaluate()` has no caller") — **still open**. Confirms #3017's "Dependencies" bullet.
- #2869 ("Fulfillment — let an operator route a parcel to the in-house bench by hand") — **closed**. Its own admissibility primitive (`manual-route-admissibility.types.ts`) ships with a docblock stating *"Nothing calls this today. #2869's manual-route producer does not exist"* — confirmed still true by grep (§ 6.2, "Also surfaced"). A tracker search for "manual-route producer" and adjacent titles (#2955, #2942, both closed) turns up **no open issue** covering this specific remainder — confirms #3017's claim.

---

## 5. Questions & Assumptions

### Open Questions
- Whether #2955 ("`fulfillment.work.dispatch` has no producer, so routed work never reaches a bench," closed) or #2942 ("OMS routing cannot be enabled — `resolveFulfillmentRouter` is never wired," closed) already closed part of what #3017 calls "the manual-route producer" gap. Read narrowly, both closed issues concern the **automatic** router's dispatch path, not the **manual** hand-routing action #2869/M3 describes; the audit found the admissibility primitive still uncalled from any service, so the manual half remains unbuilt regardless. This is a distinction for the product-spec author to state explicitly (per #3017's own acceptance criterion "the spec states explicitly whether the manual-route producer left unbuilt by #2869 is in or out of scope, and an issue exists either way") — flagging it here rather than resolving it, since resolving it is spec work.

### Assumptions
- "OMS-adjacent surface" is read as exactly the seven directories #3017 names, per its own step-1 instruction ("extend the same route-by-route method... across the remaining OMS-adjacent surface" — read as *the remaining controllers within those seven directories*, since #3017's own file list already names one controller per directory and the audit found several more per directory it did not individually enumerate).
- A route's `apps/web/src` caller must be **live production code** (a `*.api.ts` client function invoked by a hook a component actually renders) — a `*.test.ts`/`*.test.tsx` reference alone does not count as CALLED. No such case was found in this audit (every route found only in a test file was also independently confirmed absent from any `*.api.ts`), so this distinction did not change any verdict, but is recorded as the rule applied.
- Where #3017 already produced a verdict verified unchanged, that is stated as "**Confirmed unchanged**" rather than re-deriving the reasoning from scratch — the underlying grep is still shown so the confirmation is reproducible.

### Documentation Gaps
- None found specific to this audit — `docs/architecture-overview.md` §§ 20/26 (Fulfillment Authority, Fulfillment) and `docs/frontend-architecture.md` § Platform Plugins / § Dependency Rules gave complete-enough context for every finding below.

---

## 6. Proposed Implementation Plan

### Phase 1: Route inventory (the audit itself)

**Goal**: Produce the complete route table with caller verdicts.

#### Step 1 — Enumerate every controller and route
- **Files**: all 12 `*.controller.ts` files under the 7 named directories (listed in § 6.1).
- **Action**: `grep -n` for `@Controller(`, `@Get(`/`@Post(`/`@Patch(`/`@Put(`/`@Delete(`, `@Roles(`/`@Public(`/`@AnyRole(`, and the handler method name, in source order.
- **Acceptance**: Every route decorator in every controller file appears exactly once in the table, with its full path (class prefix + method path) and its nearest-preceding role decorator (class-level for `oms-sourcing-rules.controller.ts`, which sets `@Roles('admin')` once for the whole class).

#### Step 2 — Confirm or refute each caller
- **Files**: relevant `apps/web/src/features/**/api/*.api.ts` files (one per corresponding FE feature — `bench-work.api.ts`, `who-decides.api.ts`, `fulfillment.api.ts`, `inventory.api.ts`, `operational-settings.api.ts`, `returns.api.ts`; `oms` has none).
- **Action**: grep the literal path string (or the template-literal function that builds it) in each `*.api.ts`, then read enough surrounding code to confirm the call is real and reaches every verb the controller exposes (not just `GET`).
- **Acceptance**: Every route in the Step 1 table gets exactly one of: a caller file:line, or the literal string `NOT CALLED`.

### 6.1 — Full route inventory

| # | Verb & Path | Roles | Handler | `apps/web/src` caller |
|---|---|---|---|---|
| | **`oms/http/oms-sourcing-rules.controller.ts`** — class-level `@Roles('admin')` | | | |
| 1 | `GET /connections/:connectionId/sourcing-rules` | admin | `list` | **NOT CALLED** |
| 2 | `POST /connections/:connectionId/sourcing-rules` | admin | `create` | **NOT CALLED** |
| 3 | `PUT /connections/:connectionId/sourcing-rules/order` | admin | `reorder` | **NOT CALLED** |
| 4 | `GET /connections/:connectionId/sourcing-rules/:ruleId` | admin | `get` | **NOT CALLED** |
| 5 | `PATCH /connections/:connectionId/sourcing-rules/:ruleId` | admin | `update` | **NOT CALLED** |
| 6 | `DELETE /connections/:connectionId/sourcing-rules/:ruleId` | admin | `remove` | **NOT CALLED** |
| | **`bench/http/bench-work.controller.ts`** — `@Controller('bench')` | | | |
| 7 | `GET /bench/work` | admin, operator, packer | `listBenchWork` | `features/bench/api/bench-work.api.ts:95` |
| | **`bench/http/bench-parcel.controller.ts`** — `@Controller('bench/work')` | | | |
| 8 | `GET /bench/work/:workId/parcel` | admin, operator, packer | `getParcel` | `bench-work.api.ts:105` |
| 9 | `POST /bench/work/:workId/verifications` | admin, operator, packer | `verifyUnit` | `bench-work.api.ts:109` |
| 10 | `POST /bench/work/:workId/reopen` | admin, operator, packer | `reopenParcel` | `bench-work.api.ts:118` |
| | **`bench/http/bench-documents.controller.ts`** — `@Controller('bench')` | | | |
| 11 | `GET /bench/work/:workId/documents` | admin, operator, packer | `getDocuments` | `bench-work.api.ts:125` |
| 12 | `GET /bench/work/:workId/documents/invoice` | admin, operator, packer | `downloadInvoice` | `bench-work.api.ts:128` |
| 13 | `GET /bench/unlabelled-parcels` | admin, operator, packer | `listUnlabelled` | `bench-work.api.ts:131` |
| | **`fulfillment-authority/http/fulfillment-authority.controller.ts`** — `@Controller('fulfillment-authority')` | | | |
| 14 | `GET /fulfillment-authority/status` | admin, operator, viewer | `getStatus` | `features/fulfillment-authority/api/who-decides.api.ts:67` |
| 15 | `POST /fulfillment-authority/presets/preview` | admin, operator, viewer | `previewPreset` | `who-decides.api.ts:71` |
| 16 | `PUT /fulfillment-authority/presets` | admin | `applyPreset` | `who-decides.api.ts:79` |
| | **`fulfillment/http/fulfillment-work.controller.ts`** — `@Controller('fulfillment/works')` | | | |
| 17 | `GET /fulfillment/works` | admin, operator, viewer | `list` | `features/fulfillment/api/fulfillment.api.ts:73` (path built at `:68`) |
| 18 | `GET /fulfillment/works/:workId` | admin, operator, viewer | `get` | `fulfillment.api.ts:84` |
| 19 | `POST /fulfillment/works/:workId/actions/:action` | admin, operator | `applyAction` | `fulfillment.api.ts:90` |
| | **`inventory/http/inventory.controller.ts`** — `@Controller('inventory')` | | | |
| 20 | `GET /inventory` | `@AnyRole()` | `listInventory` | `features/inventory/api/inventory.api.ts:59` |
| 21 | `GET /inventory/availability` | `@AnyRole()` | `getAvailability` | `inventory.api.ts:63` |
| 22 | `GET /inventory/duplicate-positions` | admin | `getDuplicatePositions` | **NOT CALLED** |
| | **`inventory/http/inventory-locations.controller.ts`** — `@Controller('inventory/locations')` | | | |
| 23 | `GET /inventory/locations` | admin, operator, viewer | `list` | Partial — only the degenerate probe `inventory.api.ts:66` (`?status=active&limit=1`, reads `total` only). No list-rendering surface. |
| 24 | `GET /inventory/locations/:id` | admin, operator, viewer | `get` | **NOT CALLED** |
| 25 | `POST /inventory/locations` | admin | `create` | **NOT CALLED** |
| 26 | `POST /inventory/locations/bootstrap` | admin | `bootstrap` | `inventory.api.ts:69` |
| 27 | `PATCH /inventory/locations/:id` | admin | `update` | **NOT CALLED** |
| 28 | `DELETE /inventory/locations/:id` | admin | `remove` | **NOT CALLED** |
| | **`operational-settings/http/operational-settings.controller.ts`** — `@Controller('operational-settings')` | | | |
| 29 | `GET /operational-settings` | admin | `get` | `features/settings/api/operational-settings.api.ts:27` |
| 30 | `PUT /operational-settings` | admin | `update` | `operational-settings.api.ts:30` |
| | **`returns/http/returns.controller.ts`** — `@Controller('returns')` | | | |
| 31 | `GET /returns` | `@AnyRole()` | `listReturns` | `features/returns/api/returns.api.ts:249` |
| 32 | `GET /returns/ingestion-availability` | `@AnyRole()` | `getIngestionAvailability` | `returns.api.ts:269` |
| 33 | `GET /returns/events` (list-by-order) | admin, operator, viewer | `listReturnEvents` | `returns.api.ts:360` |
| 34 | `GET /returns/:returnId/events` | admin, operator, viewer | `listReturnEventsForReturn` | `returns.api.ts:353` |
| 35 | `GET /returns/:returnId` | `@AnyRole()` | `getReturn` | `returns.api.ts:274` |
| | **`returns/http/return-actions.controller.ts`** — `@Controller('returns')` | | | |
| 36 | `POST /returns/:returnId/decline` | admin, operator | `decline` | `returns.api.ts:280` |
| | **`returns/http/return-writes.controller.ts`** — `@Controller('returns')` | | | |
| 37 | `POST /returns/record` | admin, operator | `record` | **NOT CALLED** |
| 38 | `POST /returns/:returnId/authorize` | admin, operator | `authorize` | **NOT CALLED** |
| 39 | `POST /returns/:returnId/match-order` | admin, operator | `matchOrder` | **NOT CALLED** |
| 40 | `POST /returns/:returnId/lines/:lineId/receive` | admin, operator | `receiveLine` | `returns.api.ts:299` (via `linePath(…, 'receive')`) |
| 41 | `POST /returns/:returnId/lines/:lineId/mark-not-returned` | admin, operator | `markLineNotReturned` | `returns.api.ts:323` |
| 42 | `POST /returns/:returnId/lines/:lineId/dispose` | admin, operator | `disposeLine` | `returns.api.ts:307` |
| 43 | `POST /returns/:returnId/lines/:lineId/mark-stock-handled` | admin, operator | `markStockHandled` | `returns.api.ts:331` |
| 44 | `POST /returns/:returnId/refund` | admin, operator | `confirmRefund` | `returns.api.ts:339` |
| 45 | `GET /returns/:returnId/correction-proposal` | admin, operator, viewer | `previewCorrectionProposal` | `returns.api.ts:367` |
| 46 | `POST /returns/:returnId/correction-proposal` | admin, operator | `recordCorrectionProposal` | **NOT CALLED** |

**Totals**: 46 routes across 7 directories / 12 controllers. **13 NOT CALLED** (routes 1–6, 22, 24, 25, 27, 28, 37–39, 46), **1 partial** (route 23). 32 fully wired.

### 6.2 — Findings vs. #3017's claims (re-verified against `42cc86dde`)

**A. Four shipped features with zero UI**

1. **Sourcing-rules authoring — confirmed unchanged.** All 6 routes NOT CALLED (table rows 1–6). `grep -rn "sourcing-rules" apps/web/src` still returns zero hits; the only `sourcing` hits in the tree are the unrelated `fulfillment-authority` "who decides sourcing" row (a different concept — see `who-decides.copy.ts:282`, `'sourcing': 'Where does an order ship from?'`, an authority *question*, not a rule CRUD). `apps/api/src/oms/http/` still contains exactly one controller.
2. **Inventory locations CRUD — confirmed unchanged**, and now precisely characterized: only the degenerate `?status=active&limit=1` probe (row 23, partial) and `bootstrap` (row 26) are called; full list, single-item read, create, update, delete (rows 24, 25, 27, 28) remain **NOT CALLED**.
3. **Duplicate-position detection — confirmed unchanged.** Zero hits for `duplicate-position` anywhere in `apps/web/src` (row 22).
4. **Returns authorize / match-order — confirmed unchanged for those two**, but the surrounding picture has moved substantially since #3017 was filed: `receiveLine`, `disposeLine`, `markLineNotReturned`, `markStockHandled`, `confirmRefund`, and `decline` (rows 36, 40–44) are now **all wired** — this is new since the issue's `0906ceb41` snapshot. Two additional NOT-CALLED routes surfaced that #3017 did not name individually: `POST /returns/record` (row 37, the operator-authored return create) and `POST /returns/:returnId/correction-proposal` (row 46, the write/confirm half — its `GET` sibling, the preview, **is** called at row 45). So the returns-write gap is narrower than #3017 described but not closed: **authorize, match-order, record, and correction-proposal-confirm are the four remaining uncalled returns-write routes**, and `match-order` is still the sharp one — the only exit from the #2332 orphan bucket, monotonic and irreversible, with no confirmation surface to put in front of it.

**B. Three reachability defects**

1. **`/bench` has no nav entry — confirmed unchanged.** `apps/web/src/app/nav-registry.ts` has zero `bench` references. The route module's own docblock (`bench.route.tsx`) states the omission explicitly and names its own follow-up (#2416, closed — but for "Surfaces B + C: the work list, and scanner-first operation," not for nav discoverability) and notes a nav entry "would also need `RoleValues` widened, since it is `['admin','operator']` today" — confirmed: `apps/web/src/app/nav-registry.types.ts:26` still declares `RoleValues = ['admin', 'operator']`, with no `'packer'` or `'viewer'` member, even though the backend `@Roles` decorators on every bench route include `packer`. This is a concrete, previously-unstated blocker for a future nav entry: **before a "Pack bench" nav item can exist, `RoleValues` must grow a `packer` member**, or the item must be gated some other way.
2. **No guided setup card for the OMS connection — confirmed unchanged.** `apps/web/src/plugins/oms/index.ts` still ships no `setupCard`, with its own docblock stating *"Deliberately minimal: no `setupCard`... that is #2407"* (note: `#2407` in that comment is the inventory-locations-bootstrap issue per `docs/architecture-overview.md` § Inventory, not a guided-flow issue — the comment is imprecise about which issue owns "a guided flow to run yet"; worth flagging to whoever writes the product spec, since it currently reads as if a guided-flow issue already exists when none does). `platform-picker.tsx:17-18` confirmed still filters candidates on `p.setupCard !== undefined` — 10 of 11 in-tree plugins have one; only `oms` doesn't.
3. **Bench's remediation copy points at a dead end — confirmed unchanged.** `apps/web/src/features/bench/lib/bench-work.copy.ts:102` still reads *"Someone with an administrator account turns on packing in OpenLinker under Settings, on the page that says who decides what."* `apps/api/src/fulfillment-authority/application/authority-presets.ts` confirmed unchanged: `leave-as-they-are` → `keepAsIs` (writes nothing), `openlinker-decides` → `disableClaimsPreservingAssignment` (disables only), `keep-other-system` → `available: false` (Wave-4 gated, rendered disabled). No preset can enable packing.

**C. "Also surfaced" tracker facts**

- **Manual-route producer still does not exist**, confirmed by direct read of `libs/core/src/fulfillment/domain/types/manual-route-admissibility.types.ts` (its docblock verbatim: *"Nothing calls this today. #2869's manual-route producer does not exist"*) and by grep: the only two files referencing the type at all are the barrel re-export (`libs/core/src/fulfillment/index.ts`) and the type file itself — zero service call sites. #2869 itself is **closed**. A tracker search for adjacent titles found #2955 ("`fulfillment.work.dispatch` has no producer...") and #2942 ("`resolveFulfillmentRouter` is never wired..."), both closed — but both concern the **automatic** router's dispatch path, not #2869/M3's **manual** hand-routing admissibility check, so neither appears to close this specific gap. **No open issue names it.** Confirms #3017's claim; flagged as an Open Question above (§ 5) for the product-spec author to state explicitly per #3017's own acceptance criterion.
- **#2954 (routing dry-run) — confirmed still open** via live `gh api` lookup.

---

## 7. Alternatives Considered

### Alternative 1: Re-run the audit only for the four features/three defects #3017 already named, without extending to unenumerated controllers in the same directories
- **Description**: Treat #3017's own file list as the complete scope and only re-verify those specific claims.
- **Why Rejected**: #3017's own step-1 instruction explicitly says to "extend the same route-by-route method... across the remaining OMS-adjacent surface," and its acceptance criterion demands "every route... is listed" — a narrower audit would miss real gaps this pass found (`POST /returns/record`, `POST /returns/:returnId/correction-proposal`, the granular inventory-locations CRUD breakdown, the `fulfillment/works` and `fulfillment-authority` surfaces, which turned out to be fully wired and are worth recording as confirmed-healthy so the product spec doesn't waste time re-auditing them).
- **Trade-offs**: A full audit costs more up-front reading time; it pays for itself by giving the spec author (next pass) a single source of truth instead of a partially-stale issue plus scattered re-verification.

### Alternative 2: Skip the live tracker checks (#2954, #2869, adjacent issues) and rely on the issue body's own claims
- **Description**: Treat #3017's Dependencies/Assumptions section as already correct and not re-query GitHub.
- **Why Rejected**: The whole premise of this pass is that #3017 was filed 207 commits behind `main`; tracker state can move as fast as code. The check cost three `gh api` calls and one `gh api search/issues` call — cheap insurance against citing a stale "still open" claim in the eventual spec.
- **Trade-offs**: None significant; the checks were fast and each returned an unambiguous state.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ N/A — no architectural surface is touched by this pass (read-only audit).

### Naming Conventions
- ✅ N/A — no new code.

### Existing Patterns
- ✅ The audit method mirrors #3017's own (grep the route string, read the caller). No deviation.

### Risks
- **Grep false negatives on dynamically-built paths**: a route path assembled from string concatenation in an unusual shape could evade a literal-string grep. Mitigated by reading each `*.api.ts` file in full (all six were read completely, not just grepped) rather than trusting grep alone — see § 6.1's per-route line citations, all confirmed by direct file inspection.
- **A route could be called from a non-`*.api.ts` location** (e.g. a raw `fetch()` in a component). Mitigated by `docs/frontend-architecture.md`'s own stated rule that raw `fetch()` is ESLint-blocked outside shared API client modules in `shared/`, `features/`, `pages/`, `plugins/` — so a stray direct call would be a lint violation, making the `*.api.ts`-only search sound for this codebase specifically.
- **Tracker state can move again before the product spec is written** (next pass, deferred per the user). This audit is a snapshot at `42cc86dde` / 2026-09-09; the spec author should re-run the two tracker checks (§ 4) if meaningful time elapses.

### Edge Cases
- Route 33 (`GET /returns/events`, list-by-order-id) and route 34 (`GET /returns/:returnId/events`) are two *distinct* routes on the same verb+prefix, disambiguated only by whether a path segment follows `/returns/`; both were confirmed called from distinct call sites (`returns.api.ts:360` and `:353` respectively) rather than assuming one caller covers both.
- Route 23 is marked **partial** rather than folded into either CALLED or NOT CALLED, because collapsing it either way would misstate the finding: the endpoint IS reached, but only for a read the operator never sees (a boolean-shaped probe for `router-readiness-panel.tsx`), so no operator-facing list exists. This is the shape #3017's own table already used ("Only `POST /inventory/locations/bootstrap`... and a degenerate... probe"); this pass preserves that distinction rather than simplifying it away.

### Backward Compatibility
- ✅ N/A — no code changes; nothing to break.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests / Integration Tests
- N/A — this is a documentation-only pass with no production code. No test files are added or modified.

### Acceptance Criteria (mapped to #3017's own step-1 acceptance criterion)
- [x] Every route in `apps/api/src/{oms,bench,fulfillment,fulfillment-authority,inventory,operational-settings,returns}` is listed with its verb, roles decorator, and its `apps/web/src` caller or an explicit NOT-CALLED (§ 6.1, 46 rows).
- [x] Every finding #3017 asserted is re-verified against current `main` and marked confirmed-unchanged, confirmed-partially-closed, or confirmed-with-new-detail (§ 6.2).
- [x] The two tracker facts #3017 rests on (#2954 open; #2869 closed with its manual-route-producer remainder uncovered by any open issue) are checked live via `gh api` (§ 4, § 6.2.C).
- [x] The plan/audit is saved as a markdown file understandable without additional context.
- [ ] *(Explicitly deferred by the user)* The product spec at `docs/specs/product-spec-oms-configuration-surface.md`, the mockups, and the per-surface implementation issues are **not** produced in this pass — they are #3017 steps 2–4, to follow in a later session.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A, no code.
- [x] Respects CORE vs Integration boundaries — N/A, no code.
- [x] Uses existing patterns (no unnecessary abstractions) — audit method mirrors #3017's own.
- [x] Idempotency considered — N/A, read-only.
- [x] Event-driven patterns used where applicable — N/A.
- [x] Rate limits & retries addressed — N/A.
- [x] Error handling comprehensive — N/A.
- [x] Testing strategy complete — N/A for a documentation pass; stated explicitly above.
- [x] Naming conventions followed — plan filename matches `implementation-plan-{feature-name}.md`.
- [x] File structure matches standards — saved under `docs/plans/`.
- [x] Plan is execution-ready — the audit (§ 6) is itself the completed deliverable for #3017 step 1; the next session can proceed straight to step 2 (product spec) using § 6 as its source of truth.
- [x] Plan is saved as markdown file.

---

## Related Documentation

- [#3017](https://github.com/openlinker-project/openlinker/issues/3017) — the parent issue this audit completes step 1 of.
- [Architecture Overview](../architecture-overview.md) — §§ 20 (Fulfillment Authority), 26 (Fulfillment) for the OMS bounded-context shape referenced in § 4/§ 6.2.
- [Frontend Architecture](../frontend-architecture.md) — § Platform Plugins, § Dependency Rules (raw-`fetch()` ESLint ban, cited under Risks).
