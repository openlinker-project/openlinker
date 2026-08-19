# Implementation Plan: Sales Documents — Country Index & Routing Dialog

**Date**: 2026-08-19
**Status**: Draft
**Estimated Effort**: 4–6 days (grew from the initial 3–4 with the acknowledgment marker + migration and the Reset-country action)
**Tracking issue**: #2184 (sub-issue of epic #2154 / ADR-041)
**Design source**: reviewed, interactive mockup — https://claude.ai/code/artifact/73b5db99-ad42-41a4-9a1c-2a6e2e2fdcad (8 rounds of review; read its critique panels for the reasoning behind each decision below, including a real app-wide audit — see §2 Context)

---

## 1. Task Summary

**Objective**: Replace the rule engine's flat, free-text country selector on Settings → Sales documents with a scannable country index (one row per configured country, plus a pinned "★ Rest of world" row) that opens a routing dialog per country, reusing the components that already exist rather than rebuilding them.

**Context**: #2170 shipped the country-agnostic rule engine's backend (tables, service, controller) and a working — but not yet merged to `main` — frontend on branch `2154-sales-document-routing-adr041`. That frontend already has a real `SalesDocumentRuleComposerDialog` (Radix `Dialog`, multi-condition composer, capability-scoped connection picker, server-sourced conflict errors) and a `SalesDocumentCountrySelector`. The selector is the actual weak point the mockup review found: it mixes two quick-pick chips with a free-text "type a code + press Go" field for the same choice, and — because there is no backend endpoint to list which countries actually have rules or defaults — the page cannot show an operator "here's everything you've configured" at a glance. This plan closes that gap.

**Classification**: Frontend (Interface layer, `apps/web`), with one small CORE + Interface addition (a new read endpoint) required to make the country index possible at all — see §5 Open Questions for why this wasn't caught until this plan's research phase.

---

## 2. Scope & Non-Goals

### Context: how this fits the rest of the app (verified, not assumed)
A real, code-grounded audit (both `main` and the unmerged epic branch) checked where "no integration configured for this routing outcome" already surfaces outside this page, so this plan doesn't duplicate or contradict something that already exists:
- **Orders list** (`OrderInvoicingCell`) already renders a real row badge per block reason ("Not routed", "No primary", "Manual only" — keeps its CTA, "Batched") plus a real, additive "Invoicing blocked {n}" filter chip. Live today, nothing to change.
- **Order detail** (`SalesDocumentPanel`) already has correctly-written copy for exactly the two outcomes this plan's rule engine produces ("no rules configured for this country", "currency doesn't match the rule's threshold") — inert only because #2173 hasn't wired the rule engine into the live auto-issue gate yet. This plan does not need to write that copy; it already exists.
- Two real gaps surfaced, both explicitly **out of scope** here (see below): no fiscal-receipt equivalent of the invoice row badge, and the engine's AND-only condition model (no OR/NOT).

### In Scope
- A new `GET /sales-documents/countries` endpoint (core service + controller) that lists every country with at least one rule or country default, each with a rule count and its two defaults — the aggregation the FE needs and does not have today.
- A country index component replacing `SalesDocumentCountrySelector`'s free-text-plus-chips control.
- A routing dialog per country (reusing `SalesDocumentRulesList`, `SalesDocumentCountryDefaults`, and `SalesDocumentRuleComposerDialog` almost as-is, moved inside the new dialog instead of rendered flat on the page).
- `★ Rest of world`'s own dialog rendering a 3-tier view (no self-referencing "falls to ★ Rest of world" tier) instead of reusing the 4-tier country template verbatim.
- An inline warning when a country has both an Invoice and a Receipt default set with no rule to disambiguate between them (a real, currently-silent gap the mockup review flagged).
- **A "Reset country" action** inside the routing dialog — clears every rule, both defaults, and any acknowledgment for that country in one confirmed action, returning it to the pristine "Not configured" state. No new backend endpoint: it's a client-side sequence over the already-existing per-id `deleteRule` / `deleteCountryDefault` / clear-acknowledgment calls, gated behind a destructive-action confirmation (see §6 Phase 2).
- **A third, explicit country status: "No document — by design."** Today the mechanism has only two states an operator can land in — *configured* (has a rule or default) or *silence* (nothing exists, which the resolver would read as `no-configuration-for-country`). Those two states look identical on the index: an operator can't tell "we haven't gotten to Germany yet" apart from "we looked at Germany, we have no invoicing/fiscalization integration that covers it, and we deliberately chose to issue nothing there." Without a third state, that second case is indistinguishable from an oversight — forever. This plan adds an explicit, persisted acknowledgment per country ("this market intentionally has no sales document") that the country index renders as its own status, distinct from the empty "Not configured" state. See §3/§6 for the mechanism.

### Out of Scope
- The mockup's "Test with a sample order" tester — needs its own product decision (a new evaluate-without-persisting endpoint vs. client-side simulation) and ships as a separate follow-up issue once that decision is made. **Two interaction decisions the mockup already validated, for that follow-up to inherit rather than re-decide**: (1) the tester renders as an inline accordion in the ladder, not a second nested dialog — an earlier round's modal-in-modal call was explicitly retracted; (2) it describes a hypothetical order as a repeatable fact-row list over the same three-field vocabulary and the same add/remove interaction the rule composer uses, rather than two hardcoded fields — unifying "author a rule" and "describe a sample order" as one mechanism.
- **OR / NOT condition combinators.** Verified directly against the shipped `sales-document-condition.types.ts`: the real engine is AND-only (`eq`/`gte`/`lt`, no `neq`, no negation wrapper, no OR grouping). This plan's composer must not imply a capability the engine doesn't have — the only way to express something OR-like today is authoring two separate, non-overlapping rules with the same outcome. Worth its own design discussion against ADR-041; not resolved here.
- **A fiscal-receipt row-level block badge on the orders list.** The app-wide audit (§ Context below) confirmed `OrderInvoicingCell`/`invoicingBlockedBadge` is invoice-only — nothing surfaces a receipt-routing block on the orders list the way an invoice one is surfaced. A real, currently-unfiled gap; not this plan's to fix.
- Any change to `SalesDocumentsPanel` (the single-primary table) or to which mechanism is actually **live**. `AutoIssueTriggerService` still resolves via that table today (#2173 tracks wiring the rule engine into live routing, separately, and has not shipped) — this plan only reorganizes the rule engine's **authoring** surface. The two panels staying visually separate on the page is intentional, not a defect this plan fixes: they are not the same mechanism yet, and pretending otherwise would be dishonest to what's actually live.
- Any change to the rule composer's condition vocabulary, the conflict guard's server-side logic, or the capability-scoping logic — all already correct and already shipped; this plan relocates where they render, not what they do.
- Merging `2154-sales-document-routing-adr041` to `main` — this plan's PR targets **that branch**, not `main` (see §5).
- **Surfacing the "no document — by design" acknowledgment on order-level UI** (order detail, order-list badges, timeline entries). Those surfaces exist today for the OLD single-primary gate's block reasons (per the architecture overview's Invoicing §, "Every block on the auto-issue path is persisted and operator-visible") — but that gate doesn't consult the new rule engine yet (#2173, deferred). Wiring the new resolver into a place where an order could actually hit this acknowledgment is #2173's job, not this plan's; this plan only adds the acknowledgment as an authoring-time record on the Settings page. Extending order-level surfacing to it is a natural follow-up once #2173 ships, not before — surfacing a state nothing live can currently produce would be premature.

### Constraints
- **Base branch is not `main`.** The entire feature this plan modifies exists only on `2154-sales-document-routing-adr041` (epic #2154's branch, itself based on the still-unmerged `1902-fiscalization-eparagony`). This plan's implementation PR must target that branch, not `main` — see §5 for what that implies for the worktree/branch setup at execution time.
- No new colors, fonts, or hand-rolled primitives: this repo already self-hosts IBM Plex Sans/Mono and ships a full OKLCH token set (`apps/web/src/index.css`) — the mockup's Google-Fonts `@import` was an artifact-only necessity, not something to carry into the real app.
- Reuse Radix `Dialog` (`apps/web/src/shared/ui/dialog.tsx`) exactly as `SalesDocumentRuleComposerDialog` already does — it already provides focus-on-open, a focus trap, Escape-to-close, and focus-return-on-close for free. Do not hand-build any of that.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/web/src/features/sales-documents/**`, `apps/web/src/pages/settings/sales-documents-page.tsx`) for the bulk of the work; one narrow CORE + Interface addition (`libs/core/src/sales-documents/**`, `apps/api/src/sales-documents/**`) for the new countries-listing read.

**Capabilities involved**: None new. The existing `ISalesDocumentRulesService` (`@openlinker/core/sales-documents`) gains one method; no new port, no new capability value, no CORE↔Integration boundary crossed.

**Existing services reused**:
- `SalesDocumentRuleComposerDialog`, `SalesDocumentRulesList`, `SalesDocumentCountryDefaults` — moved inside the new per-country dialog, otherwise unchanged.
- `detectSalesDocumentConflict` / `SalesDocumentsPanel` — untouched (different mechanism, see Non-Goals).
- The rules/country-defaults/thresholds REST endpoints and their FE hooks (`use-sales-document-rules-query.ts`, etc.) — unchanged; the new dialog calls them with whichever country is currently open, exactly as the flat page does today.
- Radix `Dialog` primitive (`apps/web/src/shared/ui/dialog.tsx`) — reused verbatim, as `SalesDocumentRuleComposerDialog` already does.

**New components required**:
- CORE: `ISalesDocumentRulesService.listConfiguredCountries()` + its repository-level aggregation; a new `SalesDocumentCountryAcknowledgment` entity + repository backing the "no document — by design" marker (see Phase 1 Step 5).
- Interface (API): `GET /sales-documents/countries` on `SalesDocumentRulesController`, a response DTO; `PUT`/`DELETE /sales-documents/countries/:country/acknowledgment` for setting/clearing the marker.
- Interface (FE): `SalesDocumentCountryIndex` (table), `SalesDocumentCountryRoutingDialog` (the new per-country dialog shell), a `useSalesDocumentCountriesQuery` hook, an API client method + query key, an acknowledgment mutation hook.

**Core vs Integration justification**: This is a pure read aggregation over the rule engine's own two tables (`sales_document_rules`, `sales_document_country_defaults`), both already owned by `libs/core/src/sales-documents`. It belongs in that context's existing service — no Integration package is involved, and nothing here needs a capability port (unlike `resolveRouting`, this method never touches a connection or an adapter). The acknowledgment marker is the same shape: a plain per-country record with no connection, no adapter, no capability — it belongs in the same context for the same reason.

**Reference**: [Architecture Overview - Cross-context dependencies in core](../architecture-overview.md#cross-context-dependencies-in-core) — `sales-documents` stays a zero-outbound-CORE-context-edge leaf; this addition reads only its own two tables and adds no new outbound edge.

---

## 4. External / Domain Research

Not applicable — no external system involved.

### Internal Patterns
- **Similar aggregation reads**: `IAnalyticsTrustService` (`libs/core/src/analytics-trust/`) composes across connections without introducing new capability ports — the same shape as this addition (a read-only rollup over existing rows, no new port).
- **Repository pattern to follow**: `sales-document-rule.repository.ts` and `sales-document-country-default.repository.ts` already exist; the new aggregation is one more method on each (or a single new method on one, querying both tables via the two existing TypeORM repositories it already injects) — not a new repository class.
- **Response DTO pattern**: mirror `SalesDocumentRuleResponseDto.fromDomain` — a `SalesDocumentCountrySummaryResponseDto` with a `fromDomain` static factory, per `docs/engineering-standards.md`.
- **FE query hook pattern**: mirror `use-sales-document-rules-query.ts` exactly (TanStack Query, a query-key factory entry in `sales-document-rules.query-keys.ts`).

---

## 5. Questions & Assumptions

### Open Questions
- **Which base branch does the implementation PR target?** The feature lives only on `2154-sales-document-routing-adr041`, which itself is not yet on `main` (blocked on `1902-fiscalization-eparagony` / PR #2137). Recommended default (see Assumptions): branch this plan's work from `2154-sales-document-routing-adr041` and merge back into it, matching how #2170 and this plan's own tracking issue were already handled. Re-target to `main` only after both upstream branches land, per whatever process closes out epic #2154's own PR #2161.
- **Does "Rules count" on the index count only rules for that literal country code, or does it need to reflect that `★ Rest of world` (`SALES_DOCUMENT_REST_OF_WORLD_COUNTRY`, the `*` sentinel) is a distinct row from every real country?** Assumed: the new endpoint returns one row per literal `country` value already present in either table (including `*`), with no special-casing beyond the FE always rendering `*`'s row last and distinctly, per Non-Goals's "reuse the mechanism, differentiate the treatment" principle already established in the mockup review.
- **Should the new endpoint page/limit results?** Given `country` is a free-text ISO code an operator types by hand, the realistic result-set size is small (tens, not thousands, of distinct countries per install). Assumed: no pagination for this slice; revisit if a real install's usage proves otherwise.
- **Does setting the "no document — by design" acknowledgment for a country conflict with also having rules/defaults there?** Assumed: no — an operator can acknowledge a country as intentionally undocumented and *later* add a rule, at which point the acknowledgment becomes stale. Rather than forbidding that combination, the FE clears the acknowledgment automatically the moment a rule or default is created for that country (the operator's own action already answers "is this configured now"), and the dialog surfaces the acknowledgment as a toggle an operator can also flip back manually at any time.

### Assumptions
- The implementation PR branches from and targets `2154-sales-document-routing-adr041`, not `main` — stated explicitly in the plan's own PR description so a reviewer isn't confused about the diff base.
- **The acknowledgment is informational, not behavioral.** It changes nothing about what `resolveSalesDocumentRouting` / `evaluateSalesDocumentRules` returns for an order in that country — an acknowledged country and a merely-empty one both still resolve `unresolved` / `no-configuration-for-country` today, identically. The acknowledgment exists purely so the Settings page can tell an operator "you decided this" apart from "nobody's looked at this yet." Making it behavioral (e.g., suppressing a future alert, or feeding into the #2173 live resolver as its own signal) is a legitimate follow-up but is explicitly not this plan's job — conflating the record-keeping addition with a routing-semantics change would be exactly the kind of scope-widening this plan's own Non-Goals section elsewhere avoids.
- `★ Rest of world`'s dialog is a distinct component (`SalesDocumentRestOfWorldRoutingDialog` or a `isRestOfWorld` prop branch inside one dialog component — implementer's choice in Phase 2) rather than the 4-tier country dialog with its Tier 3 conditionally hidden — the mockup review's finding was specifically that reusing one template and hiding a tier is exactly how the "two tiers both labeled Tier 2" bug got shipped in the mockup itself; a distinct rendering path for the 3-tier case is the safer default.
- The dual-default warning is presentational only in this slice (an `Alert` shown inside the dialog) — it does not change what the write endpoints accept; #2170's `upsertCountryDefault` already allows setting both independently, and changing that is a backend product decision out of this plan's scope.

### Documentation Gaps
- None found specific to this task; `docs/frontend-architecture.md` and `docs/frontend-ui-style-guide.md` cover the FE conventions this plan follows directly.

---

## 6. Proposed Implementation Plan

### Phase 1: Backend — countries-listing read

**Goal**: Make "which countries have any sales-document configuration, and how much" queryable in one call.

**Steps**:
1. **Domain type for the summary**
   - **File**: `libs/core/src/sales-documents/domain/types/sales-document-country-summary.types.ts`
   - **Action**: Define `SalesDocumentCountrySummary { country: string; ruleCount: number; invoiceDefaultConnectionId: string | null; receiptDefaultConnectionId: string | null; acknowledgedNoDocumentAt: string | null }`.
   - **Acceptance**: Type-only file, no logic; exported from the context's sub-barrel per the existing `sales-documents/index.ts` pattern.
   - **Dependencies**: None.

2. **Repository aggregation**
   - **File**: `libs/core/src/sales-documents/infrastructure/persistence/repositories/sales-document-rule.repository.ts` (add `countRulesByCountry(): Promise<Map<string, number>>`) and `sales-document-country-default.repository.ts` (add `listAllDefaults(): Promise<SalesDocumentCountryDefault[]>` if a "get everything" read doesn't already exist — check `listCountryDefaults`'s current signature first; it may already support this via `country: '*'`-as-wildcard or need a new method).
   - **Action**: One `GROUP BY country` count query on `sales_document_rules`; one full read of `sales_document_country_defaults` (small table, no pagination concern per §5).
   - **Acceptance**: Unit test asserts the count query returns the right per-country counts against a seeded in-memory/test dataset, per this repo's existing repository test pattern.
   - **Dependencies**: Step 1.

3. **Service method**
   - **File**: `libs/core/src/sales-documents/application/services/sales-document-rules.service.ts` + its interface `application/interfaces/sales-document-rules.service.interface.ts`.
   - **Action**: Add `listConfiguredCountries(): Promise<SalesDocumentCountrySummary[]>` — merges the two repository reads from Step 2 into one array, keyed by country, defaulting `ruleCount` to 0 for a country that has only a default (or vice versa).
   - **Acceptance**: `sales-document-rules.service.spec.ts` gets a new `describe('listConfiguredCountries', …)` block covering: a country with rules only, a country with defaults only, a country with both, and the `*` (Rest of world) row appearing like any other.
   - **Dependencies**: Step 2.

4. **Controller endpoint + DTO**
   - **File**: `apps/api/src/sales-documents/http/sales-document-rules.controller.ts` (add `GET /sales-documents/countries`) + new `apps/api/src/sales-documents/http/dto/sales-document-country-summary-response.dto.ts`.
   - **Action**: Thin pass-through, `@Roles('admin')` (matching every other endpoint on this controller already), no capability guard needed (this is a read, not a write to a specific connection).
   - **Acceptance**: A quick manual `curl` against the booted API returns the expected shape; Swagger doc reflects the new route (`@ApiOperation`, `@ApiResponse`) matching the existing endpoints' style.
   - **Dependencies**: Step 3.

5. **"No document — by design" acknowledgment: entity, repository, service, endpoints**
   - **Files**: new `domain/entities/sales-document-country-acknowledgment.entity.ts`, new ORM entity + migration (`sales_document_country_acknowledgments`: `country` PK, `acknowledgedAt` timestamp — no `documentKind`, this isn't a routing outcome, it's a per-country flag), new repository (mirrors `sales-document-country-default.repository.ts`'s shape: `find(country)`, `upsert(country)`, `delete(country)`); service methods `acknowledgeNoDocument(country)` / `clearAcknowledgment(country)` on `ISalesDocumentRulesService`; two controller routes `PUT` / `DELETE /sales-documents/countries/:country/acknowledgment`.
   - **Action**: `listConfiguredCountries` (Step 3) also left-joins this table so `acknowledgedNoDocumentAt` is populated per row. Creating a rule or a country default for an already-acknowledged country **clears the acknowledgment as part of that same write** (`createRule` / `upsertCountryDefault` call `clearAcknowledgment` internally when a row is written for that country) — this is what keeps the three states mutually exclusive without a UI-side guard: acknowledging and configuring can never silently coexist.
   - **Acceptance**: Service spec covers: acknowledging a bare country, acknowledging then adding a rule (acknowledgment clears), acknowledging an already-configured country (rejected client-side per Phase 2 Step 4 — see below — but the service method itself doesn't need to guard this since the FE never offers the action). Migration has both `up()`/`down()`.
   - **Dependencies**: Steps 1–3 (extends the same summary type and listing method).

### Phase 2: Frontend — country index + routing dialog

**Goal**: Replace the free-text selector with the reviewed index + dialog structure, reusing the existing rules-list/defaults/composer components inside the new dialog instead of on the flat page.

**Steps**:
1. **API client + query hook for the new endpoint**
   - **Files**: `apps/web/src/features/sales-documents/api/sales-document-rules.api.ts` (add `listConfiguredCountries`), `sales-document-rules.types.ts` (mirror the new DTO shape), `sales-document-rules.query-keys.ts` (add a `countries()` key), new `hooks/use-sales-document-countries-query.ts`.
   - **Acceptance**: Follows the exact shape of the existing `listRules`/`useSalesDocumentRulesQuery` pair — no new conventions introduced.
   - **Dependencies**: Phase 1 complete (real endpoint to call).

2. **`SalesDocumentCountryIndex` component**
   - **File**: `apps/web/src/features/sales-documents/components/sales-document-country-index.tsx`.
   - **Action**: A `data-table` (reuse the existing `.data-table`/`.data-table__container` classes `SalesDocumentsPanel` already uses — no new table styling) with columns Country · Rules · Invoice defaults to · Receipt defaults to · Status · action. Rows sourced from `useSalesDocumentCountriesQuery`; `★ Rest of world` is **not** just another row returned by the query treated identically — render it last, unconditionally, with the "Always on · catch-all" badge, regardless of where it sorts in the raw response (mirrors the mockup's Round 3 finding: same mechanism, deliberately different visual weight). **Status column renders one of three states**, computed client-side from the row (no new field needed beyond what Phase 1 Step 3/5 already returns): `ruleCount > 0 || either default set` → "Configured" (`StatusBadge` tone `success`); else `acknowledgedNoDocumentAt !== null` → "No document — by design" (`StatusBadge` tone `neutral`/muted, not `warning` — this is a deliberate, settled decision, not a problem); else → "Not configured" (`StatusBadge` tone `warning`, matching how an unattended gap reads elsewhere in this app).
   - **Acceptance**: Loading/error/empty states follow `LoadingState`/`ErrorState`/`Alert` exactly as `SalesDocumentsPanel` does (no new feedback-state pattern). An "Add country" affordance opens the dialog for a freshly-typed code with zero existing rows — the empty-country path reuses the exact same dialog as a configured one, per the mockup's Round 5 finding (S) that the empty state must be the same component, not a separate design. All three statuses are covered by a component test asserting the right badge tone + copy per state.
   - **Dependencies**: Step 1.

3. **`SalesDocumentCountryRoutingDialog` (real country)**
   - **File**: `apps/web/src/features/sales-documents/components/sales-document-country-routing-dialog.tsx`.
   - **Action**: A Radix `Dialog` (reuse `apps/web/src/shared/ui/dialog.tsx` exactly as `SalesDocumentRuleComposerDialog` does) whose body composes, unchanged: `SalesDocumentRulesList` (already renders rule cards + the "+ Add rule" button that opens `SalesDocumentRuleComposerDialog`), `SalesDocumentCountryDefaults` (Invoice/Receipt default pickers). Add: a Tier-3 reference block ("Falls to ★ Rest of world") linking to open the Rest-of-world dialog instead (state lives in the parent `SalesDocumentCountryIndex` — which dialog is open, and an optional "opened via cross-link, show a back affordance" flag, mirroring the mockup's Round 6 fix DD); the dual-default `Alert` from §2 In Scope, shown when both `SalesDocumentCountryDefaults` values are non-null; **the acknowledgment control** — when the country has zero rules and zero defaults, render a single secondary action "Mark this market as having no sales document" that calls the new acknowledge endpoint (Phase 1 Step 5) and flips the dialog's own empty-state copy to name the decision explicitly ("Acknowledged — no sales document is issued for this market" plus a timestamp and an "Undo" action calling the clear endpoint). Once any rule or default exists, this control is not rendered at all (the state already cleared itself server-side per Step 5's write-time clear — the dialog just reflects that by not offering an action that no longer applies).
   - **Acceptance**: Opening a country with 2 existing rules (seed data or a local dev connection) renders them via the unmodified `SalesDocumentRulesList`; saving a conflicting rule surfaces the real 409 from `SalesDocumentRuleComposerDialog`'s existing `createRule.error` Alert — do not add a second, client-only conflict check. A component test covers: acknowledging a bare country flips its status without a page reload (query invalidation), and adding a rule afterward removes the acknowledged copy (reflecting the server-side auto-clear).
   - **Dependencies**: Step 1; no changes needed to `SalesDocumentRulesList`, `SalesDocumentCountryDefaults`, or `SalesDocumentRuleComposerDialog` themselves.

3b. **"Reset country" action**
   - **File**: same component as Step 3 (`sales-document-country-routing-dialog.tsx`).
   - **Action**: A destructive `Button` ("Reset country") in the dialog footer, disabled when the country already has zero rules/defaults/acknowledgment (nothing to reset). On click, opens `apps/web/src/shared/ui/confirm-dialog.tsx` (already exists — reuse verbatim, do not build a second confirm pattern) naming exactly what will be deleted ("This deletes N rule(s) and clears both defaults for {country}. This can't be undone."). On confirm: sequentially calls the existing `deleteRule` mutation for every rule, `deleteCountryDefault` for both kinds if set, and the acknowledgment-clear endpoint if set, then invalidates the country-list and country-detail query keys so the dialog and index both reflect the reset immediately.
   - **Acceptance**: Resetting a country with 3 rules + 1 default leaves it in the exact same state as a never-touched country (index shows "Not configured", dialog reopens empty) — verified by a component test seeding that state and asserting the post-reset query cache. The confirm step is not skippable (no reset without the intermediate dialog).
   - **Dependencies**: Step 3; no new backend endpoint (composes existing per-id deletes).

4. **`SalesDocumentRestOfWorldRoutingDialog` (or a branch of Step 3's component)**
   - **File**: same directory as Step 3.
   - **Action**: The 3-tier view — rules, defaults, terminal "no match" — with **no** Tier-3 self-reference block. Implementer's choice whether this is a separate component or an `isRestOfWorld` prop on the Step 3 dialog that skips rendering Tier 3; either is acceptable, but the tier **numbering** must stay sequential (1, 2, 3) for this case specifically — the mockup shipped a real bug here (two tiers both labeled "Tier 2") that this step exists to not repeat.
   - **Acceptance**: A unit/component test asserts exactly 3 tier headings render for the Rest-of-world dialog and exactly 4 for a real country's, with no duplicate tier numbers in either.
   - **Dependencies**: Step 3.

5. **Wire the page**
   - **File**: `apps/web/src/pages/settings/sales-documents-page.tsx`, `apps/web/src/features/sales-documents/components/sales-document-rule-engine-panel.tsx` (or its equivalent — confirm exact current file name before editing), `apps/web/src/features/sales-documents/index.ts` (barrel).
   - **Action**: Replace the rendering of `SalesDocumentCountrySelector` + the flat rules-list/defaults section with `SalesDocumentCountryIndex`. Remove `SalesDocumentCountrySelector` once nothing references it (confirm via a repo-wide search before deleting — don't leave dead code). `SalesDocumentsPanel` above it is untouched.
   - **Acceptance**: The page renders the index; clicking a row opens the right dialog; the existing "+ Add rule" → composer → save → rules-list-refreshes flow still works end to end, unchanged in behavior from before this plan, just relocated.
   - **Dependencies**: Steps 2–4.

### Implementation Details

**New Components**:
- **Domain**: `SalesDocumentCountrySummary` type (Step 1.1); `SalesDocumentCountryAcknowledgment` entity (Step 1.5).
- **Application**: `ISalesDocumentRulesService.listConfiguredCountries`, `acknowledgeNoDocument`, `clearAcknowledgment` (Steps 1.3, 1.5).
- **Infrastructure**: two repository read methods (Step 1.2); one new repository + ORM entity for the acknowledgment table (Step 1.5).
- **Interface**: `GET /sales-documents/countries` + DTO (Step 1.4); `PUT`/`DELETE /sales-documents/countries/:country/acknowledgment` (Step 1.5); `SalesDocumentCountryIndex`, `SalesDocumentCountryRoutingDialog` (with its acknowledgment control and Reset-country action), the Rest-of-world dialog variant, one query hook, one API client method (Phase 2).

**Configuration Changes**: None.

**Database Migrations**: One — `sales_document_country_acknowledgments` (Step 1.5). Everything else in this plan reads existing tables; no other schema change.

**Events**: None emitted or consumed — this is a synchronous read/write UI, matching the rest of this feature.

**Error Handling**: No new domain exceptions. The existing `SalesDocumentRuleConflictException` → `ConflictException` (409) mapping is reused unchanged by the relocated composer.

---

## 7. Alternatives Considered

### Alternative 1: Keep the free-text country selector, just restyle it
- **Description**: Leave `SalesDocumentCountrySelector` as the only navigation control, polish its visual treatment (drop the duplicate chips-plus-text-field pattern) without adding a country-index table.
- **Why Rejected**: Doesn't solve the actual problem the mockup review surfaced — an operator with several countries configured still cannot see "what have I already set up" without typing each code by hand. The index is what makes the page scannable, not the selector's styling.
- **Trade-offs**: Would avoid Phase 1's backend addition entirely (cheaper, faster), at the cost of leaving the page's core usability gap unaddressed.

### Alternative 2: Build the "list configured countries" read as a FE-only aggregation over already-cached per-country queries
- **Description**: Instead of a new backend endpoint, have the FE track "every country code a user has ever typed" client-side (e.g., in `localStorage`) and render rows only for those.
- **Why Rejected**: Doesn't show the operator's *actual* configured state — a country configured from a different browser/session, or by a colleague, would silently not appear. This is exactly the kind of dishonest-to-the-real-state UI the mockup's domain-honesty review round existed to catch.
- **Trade-offs**: Zero backend work, but the resulting index would lie by omission.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ New backend method stays inside `sales-documents`'s existing service/repository — no new port, no capability, no cross-context edge added (context remains the documented zero-outbound-CORE-context-edge leaf).
- ✅ FE dependency direction respected: new components live under `features/sales-documents`, consumed by `pages/settings/sales-documents-page.tsx` — matches `app → pages → features → shared`.

### Naming Conventions
- ✅ New files follow existing sibling naming exactly (`sales-document-country-*`, `use-sales-document-countries-query.ts`, `*-response.dto.ts`) — no new pattern introduced.

### Existing Patterns
- ✅ Reuses `Dialog`, `Select`, `Alert`, `StatusBadge`, `LoadingState`/`ErrorState`, the `data-table` CSS classes, and the TanStack Query hook/query-key-factory pattern already established by this exact feature's own prior commits (#2159/#2170) — nothing here introduces a new UI primitive or state-management approach.

### Risks
- **Base-branch drift**: since the implementation PR targets `2154-sales-document-routing-adr041` rather than `main`, it will need re-targeting (or a rebase) once that branch itself merges upstream. Mitigation: state the base branch explicitly in the PR description (as this plan's §2 Constraints already does) so no reviewer is confused, and check `git log origin/main..origin/2154-sales-document-routing-adr041` before opening the PR to confirm the epic branch hasn't already merged by execution time.
- **Component-reuse risk**: if `SalesDocumentRulesList` or `SalesDocumentCountryDefaults` have any layout assumption baked in from being rendered directly on a page (e.g., a fixed page-width heading), moving them inside a `max-width: 30rem`-ish dialog (matching `SalesDocumentRuleComposerDialog`'s own sizing) could look cramped. Mitigation: Phase 2 Step 3's acceptance criterion includes visually checking this, and the dialog's width is not fixed to the composer's own `30rem` — size it independently once the real content is in place.

### Edge Cases
- **A country with rules but its defaults were later deleted (or vice versa)**: the countries-listing read (Step 1.3) must not drop such a country from the list just because one side is empty — the merge logic explicitly defaults the missing side rather than filtering the row out.
- **`★ Rest of world` with zero rules AND zero defaults**: still must appear on the index (it is "Always on," per its own badge) — the FE renders it unconditionally rather than only when the query returns a row for `*`.

### Backward Compatibility
- ✅ No breaking change to any existing endpoint or component's public props — this plan adds one new endpoint and relocates existing components into a new parent, without changing their own interfaces.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `sales-document-rules.service.spec.ts`: `listConfiguredCountries` merge logic (rules-only, defaults-only, both, Rest-of-world) — **File**: `libs/core/src/sales-documents/application/services/sales-document-rules.service.spec.ts`.
- Repository aggregation query — **File**: alongside the two repository classes, following this context's existing repository test pattern.
- FE: a component test for the Rest-of-world dialog asserting exactly 3 tiers with sequential numbering, and one for a real country's dialog asserting exactly 4 — **Files**: `apps/web/src/features/sales-documents/components/*.test.tsx`, matching `sales-documents-panel.test.tsx`'s existing pattern.
- `sales-document-rules.service.spec.ts`: acknowledgment lifecycle (acknowledge a bare country; acknowledge then create a rule clears it; clear via the explicit endpoint).
- FE: `sales-document-country-index.test.tsx` covering the three Status badge states; `sales-document-country-routing-dialog.test.tsx` covering the acknowledgment toggle round-trip and the Reset-country confirm-then-clear flow.

### Integration Tests
- None required beyond the unit-level repository test — this is a read-only aggregation over existing, already-integration-tested write paths (#2170's own `.int-spec.ts` coverage for rule/default creation is unaffected by this plan).

### Mocking Strategy
- Service spec mocks the two repository ports (per `docs/testing-guide.md`'s unit-test convention: mock ports, not concrete repositories).
- FE component tests mock the query hooks (TanStack Query test utilities, matching `sales-documents-panel.test.tsx`'s existing approach).

### Acceptance Criteria
- [ ] `GET /sales-documents/countries` returns one row per country with any rule or default, each with an accurate rule count and both defaults (or `null`).
- [ ] The Settings → Sales documents rule-engine section renders a country index instead of the free-text selector; `★ Rest of world` is always the last row, visually distinct.
- [ ] Clicking a configured country opens a dialog showing its real rules (via the unmodified `SalesDocumentRulesList`) and defaults (via the unmodified `SalesDocumentCountryDefaults`).
- [ ] Clicking an unconfigured/new country reaches the same dialog, empty, in the same number of clicks.
- [ ] `★ Rest of world`'s dialog renders exactly 3 tiers, sequentially numbered, with no tier referencing itself.
- [ ] Saving a conflicting rule inside the relocated composer still surfaces the real server 409 message — no new client-side conflict logic was added.
- [ ] A country with both Invoice and Receipt defaults set shows the dual-default warning.
- [ ] A country with zero rules and zero defaults can be marked "No document — by design"; the index shows a third, visually distinct status for it (not the same badge as "Not configured").
- [ ] Adding a rule or default to an acknowledged country automatically clears the acknowledgment — the two states can never coexist.
- [ ] "Reset country" clears every rule, both defaults, and any acknowledgment for that country after an explicit confirm step (via the existing `ConfirmDialog` primitive), never silently.
- [ ] No new colors, fonts, or hand-rolled Dialog/Select/confirm pattern — verified by diff review against `docs/frontend-ui-style-guide.md`.
- [ ] `SalesDocumentCountrySelector` is deleted once confirmed unreferenced, or left in place with a note if some other caller still needs it (check before deleting).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries (no new port, no new capability)
- [x] Uses existing patterns (Dialog, Select, data-table, TanStack Query hook shape) — no unnecessary abstractions
- [x] Idempotency considered (read-only new endpoint; existing writes untouched)
- [ ] Event-driven patterns used where applicable — n/a, no events involved
- [ ] Rate limits & retries addressed — n/a, admin-only internal read
- [x] Error handling comprehensive (reuses existing 409/400/404 mapping; no new exception types)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) — § Sales Documents (17), § Cross-context dependencies in core
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- [Testing Guide](../testing-guide.md)
- [ADR-041: Sales-document routing policy](../architecture/adrs/041-sales-document-routing-policy.md)
