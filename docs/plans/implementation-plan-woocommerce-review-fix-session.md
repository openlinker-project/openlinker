# Implementation Plan: WooCommerce PR Review & Fix Session (Issues 873–879)

**Date**: 2026-06-03  
**Status**: Ready for Execution  
**Estimated Effort**: 2–3 days (reviews: ~4h, fixes: ~12–16h, rebase/QA: ~4h)

---

## 1. Task Summary

**Objective**: Systematically review all seven WooCommerce PRs (#947, #958, #959, #960, #969, #970, #972), consolidate findings beyond Piotr's existing reviews, fix every finding in the existing worktrees, keep the stack rebased, and push clean branches.

**Context**: Seven stacked PRs implement the WooCommerce plugin (issues 873–879). Piotr has already done CHANGES_REQUESTED reviews on PRs #969 (875) and #970 (877). The other five PRs (#947, #958, #959, #960, #972) have no review. All CI checks show `state: pending` (no checks have run). All worktrees are already checked out.

**Classification**: Integration (all adapters live in `libs/integrations/woocommerce/`), with touches to App layer (plugin registration in `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts`), Testing, and Dev-infra (docker-compose.yml).

---

## 2. Scope & Non-Goals

### In Scope
- Tech-review + pr-review + security-review for each of the 7 PRs (separate agent per PR)
- Reading and respecting Piotr's existing inline review comments on PRs #969 and #970
- Consolidating all findings (excluding Piotr's already-captured ones) into a unified fix list
- Fixing all blocking and important issues in the worktrees
- Running `pnpm lint && pnpm type-check && pnpm test` in each worktree before committing
- Rebasing downstream branches after each upstream fix lands
- Pushing updated branches (not merging — PRs remain open for Piotr's sign-off)

### Out of Scope
- Repeating Piotr's captured findings in review output — they are already documented
- New feature work beyond what the issues require
- Merging any PR (that is Piotr's call)
- Creating new GitHub issues from findings (use PR comments for that)
- Frontend WC plugin (`apps/web/src/plugins/woocommerce/`) — separate issue per spec

### Constraints
- Stacked branches: fixes to 873 must be committed before rebasing 874, fixes to 874 before rebasing 879/876, etc.
- Do not alter the PR base branches — only push to the feature branches
- Piotr's review findings for 875 and 877 must be fixed but must not be re-stated in fresh review output (avoid duplicate noise)
- Commit with DCO sign-off (`git commit -s`) per project workflow

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/woocommerce/`), App (`apps/api`, `apps/worker`), Dev-infra

**Capabilities Involved**:
- `ProductMasterPort` (read + write) — PRs 874, 879
- `InventoryMasterPort` — PR 875
- `OrderSourcePort` — PR 876
- `OrderProcessorManagerPort` — PR 877
- Plugin scaffold / connection tester / credentials validators — PR 873
- E2E integration tests + docker-compose dev stack — PR 878

**Existing Services Reused**:
- `IdentifierMappingPort` / `batchGetOrCreateInternalIds` — all capability adapters
- `CustomerIdentityResolverPort` — PR 877 (order processor)
- `fetchAllPages` utility (WC-internal) — PRs 874, 875
- `toPositiveInt` guard (WC-internal, introduced in PR 877) — PR 875 needs to adopt
- `@openlinker/core/identifier-mapping/testing` fake — unit tests for 875 (B1 fix)
- `ConnectionTesterRegistryService`, `ConnectionConfigShapeValidatorRegistryService`, `ConnectionCredentialsShapeValidatorRegistryService` — PR 873

**New Components Required** (already created, may need fixes):
- `WoocommerceProductMasterAdapter` (read) — PR 874
- `WoocommerceProductMasterAdapter` (write extension) — PR 879
- `WoocommerceInventoryMasterAdapter` — PR 875
- `WoocommerceOrderSourceAdapter` — PR 876
- `WoocommerceOrderProcessorAdapter` — PR 877
- Plugin scaffold, HTTP client, connection tester — PR 873
- Docker compose WC dev stack, integration test helpers — PR 878

**Core vs Integration Justification**: All WC-specific code lives in `libs/integrations/woocommerce/`. CORE ports are not modified. The Integration layer implements existing ports against the WC REST API v3.

---

## 4. PR / Branch / Worktree Reference

| Issue | PR | Branch | Base | Worktree path | Review state |
|---|---|---|---|---|---|
| 873 | #947 | `873-woocommerce-plugin-scaffold` | `main` | `.claude/worktrees/873-woocommerce-plugin-scaffold` | No review |
| 874 | #958 | `874-woocommerce-product-master-read` | `main` | `.claude/worktrees/874-woocommerce-product-master-read` | No review |
| 879 | #960 | `879-woocommerce-product-master-write` | `874-…-read` | `.claude/worktrees/879-woocommerce-product-master-write` | No review |
| 876 | #959 | `876-woocommerce-order-source-port` | `874-…-read` | `.claude/worktrees/876-woocommerce-order-source` | No review |
| 875 | #969 | `875-woocommerce-inventory-master-port` | `879-…-write` | `.claude/worktrees/875-woocommerce-inventory-master` | Piotr: CHANGES_REQUESTED |
| 877 | #970 | `877-woocommerce-order-processor` | `875-…-port` | `.claude/worktrees/877-woocommerce-order-processor` | Piotr: CHANGES_REQUESTED |
| 878 | #972 | `878-woocommerce-e2e-docker` | `main` | `.claude/worktrees/878-woocommerce-e2e-docker` | No review |

**Merge / fix order**: 873 → 874 → (879 ‖ 876) → 875 → 877 → 878

---

## 5. Piotr's Already-Captured Findings (DO NOT REPEAT)

Review agents for PRs 875 and 877 must skip these — they are already in the PR and will be fixed.

### PR #969 — InventoryMasterPort (875) — CHANGES_REQUESTED
- 🔴 **B1**: `listVariableInventory` looks up `batchGetOrCreateInternalIds` result with bare `externalId` key, but the map is keyed by `${externalId}:${connectionId}` → every variation gets `variantId: undefined`
- 🔴 **A**: `manage_stock=false` products report `quantity: 0`; `stock_status` / `manage_stock` fields present in types but never read → de-lists sellable products
- 🟡 Variable-product unit test mocks bare keys (why B1 slipped); switch to `@openlinker/core/identifier-mapping/testing` fake; assert `variantId`/`id` are defined
- 🟡 `getInventory`/`getAvailableQuantity` comment says "aggregate" but returns `rows[0]` — fix comment or logic
- 🟡 SSRF: decimal/octal IP encodings bypass private-range check; `fetch` follows redirects so a validated https URL can 302 → `http://10.0.0.5`
- 🟡 `protocols: ['https']` rejects `http://localhost`, contradicting DTO's own doc comment
- 🟢 Guard `Number(mapping.externalId)` against NaN — reuse `toPositiveInt` from #970
- 🟢 Document non-atomic read-modify-write in `adjustInventory`

### PR #970 — OrderProcessorManagerPort (877) — CHANGES_REQUESTED
- 🔴 **B1**: `createOrder` guard requires `metadata.internalOrderId`; `OrderSyncService` never sets it → every real call throws
- 🔴 **B2**: `OrderRef.orderId` returns internal OL id; contract requires destination-native WC id (`String(raw.id)`) → mapping corruption
- 🔴 **B3**: Adapter does own idempotency skip-check and writes order mapping — both owned by `OrderSyncService`; delete them, keep platform-side `_ol_order_id` dedup
- 🔴 **B4**: Line-item `price` is read-only in WC REST → orders silently priced at WC catalog price; must pin buyer-paid price via `subtotal`/`total`
- 🟡 **I1**: Auth failures during customer provisioning swallowed into guest orders
- 🟡 **I2**: `metadata.buyerEmail` never set by orchestration → customer provisioning never runs
- 🟡 **I3**: 55 unit tests encode wrong contract (fabricated `internalOrderId`, wrong return id) → add orchestration-shaped tests + integration test
- 🟡 **I4**: Retry-classifier routing claim undemonstrated — no classifier change in this PR
- 🟢 `set_paid: true` unconditional — document MVP limitation
- 🟢 Malformed `externalOrderId` should throw validation/processing exception, not `ResourceNotFound`

---

## 6. Implementation Plan

### Phase 1 — Rebase Diagnostic (before reviews)

**Goal**: Understand the current rebase state of each branch relative to its base so the review agents know what diff to read.

**Steps**:

1. **Check each branch's divergence from its base**
   - Run in each worktree: `git log --oneline <base>..<branch> | wc -l` and `git log --oneline <branch>..<base> | wc -l`
   - If the branch is behind its base (base has commits not in branch), note it — the branch needs rebasing *after* upstream fixes land
   - Record findings: is 874 up to date with `main`? Is 879 up to date with 874? Etc.
   - **Acceptance**: A table of `{branch, commits-ahead, commits-behind-base}` is produced before review starts

2. **Check for merge conflicts in stacked branches**
   - `git merge-tree $(git merge-base HEAD origin/<base>) HEAD origin/<base>` or dry-run merge
   - Flag any branch that already has conflicts with its current base
   - **Acceptance**: No silent conflicts proceed to review

---

### Phase 2 — Review (one agent per PR)

**Goal**: Run tech-review + pr-review + security-review for each PR in a separate agent that reads only that PR's worktree. Agents for 875 and 877 must skip Piotr's findings (listed in §5).

**Execution**: Spawn 7 parallel agent instances. Each agent:
1. Reads the worktree at `.claude/worktrees/<branch>/`
2. Reads `git diff <base>...HEAD` for that branch only
3. Performs tech-review, pr-review, security-review per `docs/code-review-guide.md`
4. Returns findings in structured markdown with severity ratings
5. Does NOT look at or comment on other PRs' worktrees

**Agent prompts** (one per PR):

#### Agent A — PR #947 / Issue 873 (Plugin Scaffold)
- Worktree: `.claude/worktrees/873-woocommerce-plugin-scaffold/`
- Diff base: `main`
- Focus: plugin descriptor shape (matches Allegro/PrestaShop pattern?), adapter registry registration, connection tester registration, credentials validator registration, `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` wiring, SSRF guard on WC site URL, unit tests
- Reference: Allegro plugin at `libs/integrations/allegro/`, PrestaShop plugin at `libs/integrations/prestashop/`

#### Agent B — PR #958 / Issue 874 (ProductMaster read)
- Worktree: `.claude/worktrees/874-woocommerce-product-master-read/`
- Diff base: `main`
- Focus: `WoocommerceProductMasterAdapter` read methods, `fetchAllPages` utility, identifier mapping key format (composite key used correctly?), synthetic variant for simple products (uses `product:{wcId}` convention?), EAN/GTIN mapping to `ProductVariant`, pagination correctness, unit + integration tests
- Reference: `PrestashopProductMasterAdapter` for patterns

#### Agent C — PR #960 / Issue 879 (ProductMaster write)
- Worktree: `.claude/worktrees/879-woocommerce-product-master-write/`
- Diff base: `874-woocommerce-product-master-read`
- Focus: write methods (`createProduct`, `updateProduct`, `deleteProduct`, `upsertProductVariant`, `assignCategories`), reverse identifier mapping (internal → WC external via `getExternalIds`), conflict detection hook for `has_conflict`, error handling for not-found vs conflict, unit tests
- Reference: `PrestashopProductMasterAdapter` write methods

#### Agent D — PR #959 / Issue 876 (OrderSource)
- Worktree: `.claude/worktrees/876-woocommerce-order-source/`
- Diff base: `874-woocommerce-product-master-read`
- Focus: `WoocommerceOrderSourceAdapter`, `listOrderFeed` cursor shape (`woocommerce.orders.lastModifiedAfter` key), `modified_after` watermark pattern (mirrors PrestaShop `date_upd`), `getOrder` hydration, `IncomingOrder` neutral shape, dedup by `id+status` (WC `order.updated` fires on creation too), cursor advancement only after successful enqueue, unit tests
- Reference: `PrestashopOrderSourceAdapter` for cursor pattern, `AllegroOrderSourceAdapter` for feed shape

#### Agent E — PR #969 / Issue 875 (InventoryMaster)
- Worktree: `.claude/worktrees/875-woocommerce-inventory-master/`
- Diff base: `879-woocommerce-product-master-write`
- **CRITICAL**: Do NOT repeat Piotr's findings from §5 above — they are already captured
- Focus: find any issues Piotr did NOT capture — architecture layer violations, missing test cases, import path correctness, type file placement, logging correctness, adapter registration in plugin descriptor, `listInventory(productId)` return shape alignment with `InventoryMasterPort` contract

#### Agent F — PR #970 / Issue 877 (OrderProcessorManager)
- Worktree: `.claude/worktrees/877-woocommerce-order-processor/`
- Diff base: `875-woocommerce-inventory-master-port`
- **CRITICAL**: Do NOT repeat Piotr's findings from §5 above — they are already captured
- Focus: find any issues Piotr did NOT capture — `cancelOrder` / `processReturn` / `getOrder` / `updateOrderStatus` implementations, customer provisioning address reuse via `destination_address_mappings`, `OL-shipping-{hash}` alias format, status mapping WC → OL neutral status, logging, security (path traversal guard for `externalOrderId` — does it cover all cases?), unit test coverage of cancel/return paths

#### Agent G — PR #972 / Issue 878 (E2E + Docker)
- Worktree: `.claude/worktrees/878-woocommerce-e2e-docker/`
- Diff base: `main`
- Focus: docker-compose WC service (`port 8082`, separate from PS on 8080), WooCommerce + MySQL containers, seed script idempotency, integration test suites (S-1 order-ingest, S-2 inventory-propagation, S-3 bulk-wizard-smoke), test harness pattern (`woocommerce-container.helper.ts`), `resetTestHarness()` usage between tests, real DB assertions (not just HTTP), no mocked DB, `pnpm dev:stack:wc-credentials` and `pnpm dev:stack:seed-woocommerce` scripts, README update

---

### Phase 3 — Consolidate Findings

**Goal**: Merge all 7 review outputs into a single prioritized fix list, deduplicated and grouped by PR.

**Steps**:

1. **Aggregate per-PR findings into a master table**
   - Columns: `PR | Severity | Finding | File:line | Fix description`
   - Sort by: blocking (🔴) first, then important (🟡), then suggestions (🟢)
   - Mark each as `[Piotr]` or `[New]`

2. **Cross-PR pattern check**
   - Check if the same bug class appears in multiple PRs (e.g., SSRF guard missing in both 873 and 875)
   - Flag these: fixing in 873 may mean 875 can reuse the fixed utility rather than repeating the fix

3. **Identify ordering dependencies**
   - Some 875 fixes depend on 874 (e.g., importing `toPositiveInt` from a shared WC utils)
   - Some 877 fixes depend on 875 context
   - Note which fixes must happen in which order

**Acceptance**: A single `FINDINGS.md` scratch doc (or in-conversation table) lists all items ordered by fix priority before any code changes begin.

---

### Phase 4 — Fix Execution

**Goal**: Apply all fixes in branch order, running the quality gate in each worktree before committing.

**Fix order follows the merge dependency chain:**

#### Step 4.1 — Fix PR 873 (`873-woocommerce-plugin-scaffold`)
- Worktree: `.claude/worktrees/873-woocommerce-plugin-scaffold/`
- Apply all 🔴 and 🟡 findings from Agent A
- Quality gate: `cd .claude/worktrees/873-woocommerce-plugin-scaffold && pnpm lint && pnpm type-check && pnpm test`
- Commit with: `fix(woocommerce): address review findings for plugin scaffold (#873)`
- Signed-off: `git commit -s`

#### Step 4.2 — Rebase 874 on top of updated 873 (if 873 had structural changes)
- `cd .claude/worktrees/874-woocommerce-product-master-read && git rebase 873-woocommerce-plugin-scaffold`
- Note: 874 is based on `main`, not 873 — rebase only needed if 873 changes shared WC infrastructure that 874 depends on (e.g., HTTP client changes, shared types)

#### Step 4.3 — Fix PR 874 (`874-woocommerce-product-master-read`)
- Worktree: `.claude/worktrees/874-woocommerce-product-master-read/`
- Apply all 🔴 and 🟡 findings from Agent B
- Quality gate: `cd .claude/worktrees/874-woocommerce-product-master-read && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for ProductMasterPort read (#874)`

#### Step 4.4 — Rebase 879 and 876 on updated 874
- `cd .claude/worktrees/879-woocommerce-product-master-write && git rebase 874-woocommerce-product-master-read`
- `cd .claude/worktrees/876-woocommerce-order-source && git rebase 874-woocommerce-product-master-read`

#### Step 4.5 — Fix PR 879 (`879-woocommerce-product-master-write`)
- Worktree: `.claude/worktrees/879-woocommerce-product-master-write/`
- Apply all 🔴 and 🟡 findings from Agent C
- Quality gate: `cd .claude/worktrees/879-woocommerce-product-master-write && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for ProductMasterPort write (#879)`

#### Step 4.6 — Fix PR 876 (`876-woocommerce-order-source-port`)
- Worktree: `.claude/worktrees/876-woocommerce-order-source/`
- Apply all 🔴 and 🟡 findings from Agent D
- Quality gate: `cd .claude/worktrees/876-woocommerce-order-source && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for OrderSourcePort (#876)`

#### Step 4.7 — Rebase 875 on updated 879
- `cd .claude/worktrees/875-woocommerce-inventory-master && git rebase 879-woocommerce-product-master-write`

#### Step 4.8 — Fix PR 875 (`875-woocommerce-inventory-master-port`) — Piotr's findings + new
- Worktree: `.claude/worktrees/875-woocommerce-inventory-master/`
- **Fix Piotr's B1**: Change `listVariableInventory` map lookup from bare `externalId` to composite `${externalId}:${connectionId}` key — drop the `!` non-null assertion
- **Fix Piotr's A**: Read `manage_stock` and `stock_status` fields; if `manage_stock=false` and `stock_status='instock'`, emit `Infinity` or a configurable large number — or make a deliberate decision (document it) rather than emitting 0
- **Fix Piotr's test gap**: Switch variable-product unit test to use `@openlinker/core/identifier-mapping/testing` fake; assert `variantId` and `id` are defined
- **Fix Piotr's comment bug**: Align `getInventory`/`getAvailableQuantity` comment with actual `rows[0]` behaviour
- **Fix Piotr's SSRF**: Harden URL guard against decimal/octal IP encodings; add `{ redirect: 'error' }` to `fetch` calls or an explicit redirect check; ensure `http://localhost` is permitted by DTO doc comment
- **Fix Piotr's NaN guard**: Import and use `toPositiveInt` from `woocommerce-utils.ts`
- **Fix Piotr's docs**: Add comment to `adjustInventory` noting non-atomic read-modify-write limitation
- **Fix new findings from Agent E**
- Quality gate: `cd .claude/worktrees/875-woocommerce-inventory-master && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for InventoryMasterPort (#875)`

#### Step 4.9 — Rebase 877 on updated 875
- `cd .claude/worktrees/877-woocommerce-order-processor && git rebase 875-woocommerce-inventory-master-port`

#### Step 4.10 — Fix PR 877 (`877-woocommerce-order-processor`) — Piotr's findings + new
- Worktree: `.claude/worktrees/877-woocommerce-order-processor/`
- **Fix Piotr's B1**: Remove the `metadata.internalOrderId` guard; `createOrder` must create unconditionally (platform-side `_ol_order_id` meta field handles dedup recovery)
- **Fix Piotr's B2**: Return `String(raw.id)` from `OrderRef.orderId` (WC-native id, not internal OL id)
- **Fix Piotr's B3**: Delete the adapter's own idempotency skip-check and order-mapping write; keep only the platform-side `_ol_order_id` dedup meta field
- **Fix Piotr's B4**: Use `subtotal`/`total` (not `price`) to pin buyer-paid price on line items; throw if WC REST rejects it
- **Fix Piotr's I1**: Surface auth failures from customer provisioning as `WooCommerceAuthFailureException` (re-auth classifier catches this); do not swallow into guest path
- **Fix Piotr's I2**: Read `buyerEmail` from `order.buyerEmail` (not `metadata.buyerEmail`) — or confirm where the orchestration sets it and align
- **Fix Piotr's I3**: Rewrite unit tests to use orchestration-shaped inputs (no fabricated `internalOrderId`; assert `String(raw.id)` returned); add integration test for `createOrder` round-trip
- **Fix Piotr's I4**: Register `WooCommerceAuthFailureException` in the retry classifier or explicitly note it as a follow-up with a TODO
- **Fix Piotr's suggestions**: Document `set_paid: true` limitation; throw validation exception (not `ResourceNotFound`) for malformed `externalOrderId`
- **Fix new findings from Agent F**
- Quality gate: `cd .claude/worktrees/877-woocommerce-order-processor && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for OrderProcessorManagerPort (#877)`

#### Step 4.11 — Fix PR 878 (`878-woocommerce-e2e-docker`)
- Worktree: `.claude/worktrees/878-woocommerce-e2e-docker/`
- This PR is based on `main` (not the stack), but integration test assertions may need updating if 875/877 contracts changed
- Apply all 🔴 and 🟡 findings from Agent G
- Verify integration test helpers reference correct method names (e.g., `setNextIncomingOrder` → correct adapter name)
- Quality gate: `cd .claude/worktrees/878-woocommerce-e2e-docker && pnpm lint && pnpm type-check && pnpm test`
- Commit: `fix(woocommerce): address review findings for E2E tests + dev stack (#878)`

---

### Phase 5 — Push & PR Update

**Goal**: Push all fixed branches and leave a summary comment on each PR.

**Steps**:

1. **Push each branch** (in dependency order):
   ```bash
   cd .claude/worktrees/873-woocommerce-plugin-scaffold && git push origin 873-woocommerce-plugin-scaffold
   cd .claude/worktrees/874-woocommerce-product-master-read && git push origin 874-woocommerce-product-master-read
   cd .claude/worktrees/879-woocommerce-product-master-write && git push origin 879-woocommerce-product-master-write
   cd .claude/worktrees/876-woocommerce-order-source && git push origin 876-woocommerce-order-source-port
   cd .claude/worktrees/875-woocommerce-inventory-master && git push origin 875-woocommerce-inventory-master-port
   cd .claude/worktrees/877-woocommerce-order-processor && git push origin 877-woocommerce-order-processor
   cd .claude/worktrees/878-woocommerce-e2e-docker && git push origin 878-woocommerce-e2e-docker
   ```

2. **Add a summary comment** to each PR listing:
   - What was fixed (ref each finding by severity)
   - Any findings deferred as follow-up issues (e.g., I4 retry classifier for 877 if not done)
   - Confirmation that `pnpm lint && pnpm type-check && pnpm test` passed

3. **Re-request review** from Piotr on PRs #969 and #970 after fixes (they were CHANGES_REQUESTED)

---

## 7. Questions & Assumptions

### Open Questions

1. **PR 875 — `manage_stock=false` inventory representation**: Should OL treat untracked-but-in-stock products as "unlimited" (large sentinel), or should the adapter throw `WooCommerceNotSupportedException` for unmanaged stock? The issue spec says "master is authoritative including 0" — but that rule applies to tracked stock. **Assumption**: emit a large sentinel value (e.g., `9999`) and document the MVP limitation, so Allegro offers don't get de-listed for unmanaged WC products. Needs confirmation.

2. **PR 877 — `metadata.buyerEmail` source**: Piotr says `OrderSyncService` never sets `metadata.buyerEmail`. Is this a gap in the orchestration (needs a core change), or should the adapter read `order.buyer?.email` directly? **Assumption**: the adapter should read buyer email from the `IncomingOrder` payload directly (as Allegro and PrestaShop adapters do), not from `metadata`. No core change needed.

3. **PR 877 — retry classifier**: Should `WooCommerceAuthFailureException` be registered in the retry classifier within this PR, or is it acceptable to defer to a follow-up? **Assumption**: register a minimal classifier entry in this PR (matching the Allegro pattern in `createAllegroPlugin`'s `register(host)` call) — the fix is small and I4 is marked 🟡 IMPORTANT by Piotr.

4. **PR 878 — base branch**: PR #972 is based on `main`, but it depends on all capability PRs. Should we rebase 878 on top of 877 before pushing, or leave it on `main` (expecting the stack to merge in order before 878 is reviewed)? **Assumption**: leave base as `main` — the test helpers can reference adapter classes that exist in the same worktree; rebasing to 877 would make the PR harder to review in isolation.

5. **SSRF fix scope**: The SSRF guard exists in PR 873 (plugin scaffold, for WC site URL validation at connection creation) and is also referenced in PR 875 (for the `fetch` call in the inventory adapter). Should the fix live once in 873 (shared validator) and 875 reuses it, or does each adapter need its own guard? **Assumption**: the connection-level SSRF guard in 873 validates the URL at creation time. Adapters should additionally use `{ redirect: 'error' }` in their `fetch` calls as a defense-in-depth measure. Both fixes apply in their respective PRs.

### Assumptions

- All worktrees are on the commits shown in `git worktree list` output (873: 758ce507, 874: 5b7a30e8, 875: fb108797, 876: 48189598, 877: 4af79194, 878: cd0e9a37, 879: 493e1d68)
- `pnpm lint && pnpm type-check && pnpm test` must pass in each worktree with no errors before committing — failures are blockers
- The `pnpm test` scope in integration-specific worktrees runs unit tests only (no Docker required); `pnpm test:integration` is out of scope for this session
- `toPositiveInt` utility already exists in the WC package (introduced in 877) — 875 can import it after 4.7 (rebase of 875 on 879)
- Piotr's inline review comments (the full set in the persisted comment files) may contain additional detail beyond the review body summaries captured in §5 — review agents should read those files too

### Documentation Gaps

- The spec at `docs/specs/product-spec-872-woocommerce-shop-integration.md` is referenced by all issues but not checked by Claude in this session — review agents should read it if it provides clarification on behaviour decisions (e.g., `manage_stock=false` handling)
- ADR-014 / issue #909 referenced in Piotr's review of 877 (OrderSyncService idempotency contract) — review agents should locate this ADR to understand the `createOrder` orchestration contract before fixing B1-B4

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ All WC code lives in `libs/integrations/woocommerce/` — no CORE changes
- ✅ Adapters implement existing CORE ports — no new ports created
- ✅ Identifier mapping uses `IdentifierMappingPort` (not direct service)
- ⚠️ Risk: B3 fix for 877 may touch `OrderSyncService` in core if the orchestration contract genuinely doesn't provide the data the adapter needs — must verify this is purely an adapter-side fix before touching core

### Naming Conventions
- ✅ Adapter classes: `WoocommerceProductMasterAdapter`, `WoocommerceInventoryMasterAdapter`, `WoocommerceOrderSourceAdapter`, `WoocommerceOrderProcessorAdapter` — matches `{System}{Capability}Adapter` pattern
- ✅ Worktree and branch names match issue numbers

### Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Rebase conflict between 875 and 879 after fixes | Medium | Fix 879 before rebasing 875; resolve conflicts manually |
| `pnpm test` fails after rebase due to import path changes | Low | Run quality gate after every rebase |
| B3 fix for 877 requires touching `OrderSyncService` core | Medium | Read ADR-014 first; if core change needed, scope it minimally and note in PR |
| SSRF fix breaks `http://localhost` in dev/test environments | Low | Ensure fix explicitly allows loopback per DTO doc comment |
| `manage_stock=false` decision wrong (sentinel vs throw) | Medium | Document choice explicitly; leave a TODO for Piotr to confirm |
| 878 integration tests break because 875/877 adapter method signatures changed | Medium | Run unit tests in 878 worktree after rebasing; update test helpers if needed |

### Edge Cases

- **Simple WC product** (no variations): must produce the deterministic synthetic variant `product:{wcId}` — verify this is consistent across 874 (ProductMaster), 875 (InventoryMaster)
- **Variable WC product with 0-stock variation**: must emit `quantity: 0` not omit the row — master is authoritative including 0 (per #822/#823 pattern)
- **`manage_stock=false` at product level but `manage_stock=true` at variation level**: WC allows mixed mode — the adapter must handle this correctly
- **WC order with no line items** (edge case): should throw a validation exception, not crash
- **Cursor wrapping**: `woocommerce.orders.lastModifiedAfter` is a datetime string — what happens at the epoch? At max datetime? The adapter must handle null cursor (first run = fetch all)

### Backward Compatibility
- ✅ No schema migrations required for any of these PRs (per issue specs)
- ✅ No existing adapters are modified — WC is a new plugin
- ✅ `apps/api/src/plugins.ts` and `apps/worker/src/plugins.ts` additions are additive

---

## 9. Testing Strategy & Acceptance Criteria

### Quality Gate (per worktree, before every commit)
```bash
pnpm lint          # zero errors
pnpm type-check    # zero errors  
pnpm test          # all unit tests pass
```

### Unit Tests Focus Areas
- **873**: Connection tester returns structured OK/error; credentials validator rejects malformed payloads; SSRF guard blocks private IPs
- **874**: `getProduct` maps simple + variable WC products; synthetic variant produced for simple products; composite identifier mapping key used; `fetchAllPages` pagination correct
- **879**: `updateProduct` reverse-maps internal → WC external id; `has_conflict` not set if no concurrent edit detected
- **875 (post-fix)**: `listVariableInventory` uses composite `${externalId}:${connectionId}` key; `manage_stock=false` products get correct quantity representation; `@openlinker/core/identifier-mapping/testing` fake used instead of hand-rolled mock
- **876**: `listOrderFeed` cursor advances only after enqueue; `getOrder` maps all `IncomingOrder` fields; dedup by `id+status`
- **877 (post-fix)**: `createOrder` creates unconditionally (no `internalOrderId` guard); returns `String(raw.id)`; no adapter-side idempotency check; line items use `subtotal`/`total`; auth failure throws correct exception
- **878**: `woocommerce-container.helper.ts` starts WC + MySQL; seed script is idempotent; S-1/S-2/S-3 make real DB assertions

### Integration Tests (878 only, requires Docker)
- S-1: Order ingest — Allegro order → WC order created
- S-2: Inventory propagation — WC stock change → Allegro offer quantity updated
- S-3: Bulk wizard smoke — WC products → Allegro offers via bulk-creation batch

### Acceptance Criteria
- [ ] `pnpm lint && pnpm type-check && pnpm test` passes in all 7 worktrees with zero errors
- [ ] All 🔴 BLOCKING findings (Piotr's + new) are resolved in the respective branches
- [ ] All 🟡 IMPORTANT findings are resolved or explicitly deferred with a TODO comment + issue reference
- [ ] Each fixed branch is pushed to `origin`
- [ ] A summary comment is added to each PR listing what was fixed
- [ ] Review agents for 875 and 877 produced findings that do not duplicate Piotr's already-captured list
- [ ] No new `any` types introduced
- [ ] No `console.log` introduced (use `Logger` from `@openlinker/shared/logging`)
- [ ] All commits include DCO sign-off (`Signed-off-by:` trailer)

---

## 10. Execution Checklist

### Pre-review
- [ ] Confirm worktree commit SHAs match expected branch tips
- [ ] Check rebase state (Phase 1)
- [ ] Locate and read ADR-014 / issue #909 (OrderSyncService idempotency contract) before fixing 877
- [ ] Read `docs/specs/product-spec-872-woocommerce-shop-integration.md` for behaviour decisions

### Review phase
- [ ] Agent A (873): tech-review + pr-review + security-review → findings
- [ ] Agent B (874): tech-review + pr-review + security-review → findings
- [ ] Agent C (879): tech-review + pr-review + security-review → findings
- [ ] Agent D (876): tech-review + pr-review + security-review → findings
- [ ] Agent E (875): tech-review + pr-review + security-review → new findings only (not Piotr's)
- [ ] Agent F (877): tech-review + pr-review + security-review → new findings only (not Piotr's)
- [ ] Agent G (878): tech-review + pr-review + security-review → findings
- [ ] Consolidated findings table produced

### Fix phase (in order)
- [ ] 873 fixed → quality gate → committed → pushed
- [ ] 874 fixed → quality gate → committed → pushed
- [ ] 879 fixed → quality gate → committed → pushed (rebase on 874 first)
- [ ] 876 fixed → quality gate → committed → pushed (rebase on 874 first)
- [ ] 875 fixed (Piotr + new) → quality gate → committed → pushed (rebase on 879 first)
- [ ] 877 fixed (Piotr + new) → quality gate → committed → pushed (rebase on 875 first)
- [ ] 878 fixed → quality gate → committed → pushed

### Post-fix
- [ ] Summary comment posted on each of the 7 PRs
- [ ] Re-review requested from Piotr on PRs #969 and #970

---

## 11. Alignment Checklist

- [x] Follows hexagonal architecture — WC adapters implement existing CORE ports, no CORE changes
- [x] Respects CORE vs Integration boundaries — all new code in `libs/integrations/woocommerce/`
- [x] Uses existing patterns — mirrors PrestaShop and Allegro adapters
- [x] Idempotency considered — B3 fix removes duplicate idempotency logic from adapter; platform-side `_ol_order_id` dedup retained
- [x] Event-driven patterns not applicable — WC v1 is REST polling only
- [x] Rate limits & retries addressed — WC REST Basic Auth; existing `IWooCommerceHttpClient` handles retries
- [x] Error handling comprehensive — domain exceptions, SSRF guard, manage_stock edge case
- [x] Testing strategy complete — unit tests per adapter, quality gate per worktree, integration tests in 878
- [x] Naming conventions followed — adapter, port, exception naming all per standards
- [x] File structure matches standards — `libs/integrations/woocommerce/src/{capability}/`
- [x] Plan is execution-ready — all steps have file paths, commands, and acceptance criteria
- [x] Plan is saved as markdown file ✅

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- [WooCommerce Spec](../specs/product-spec-872-woocommerce-shop-integration.md)
- Issues: [#873](https://github.com/openlinker-project/openlinker/issues/873), [#874](https://github.com/openlinker-project/openlinker/issues/874), [#875](https://github.com/openlinker-project/openlinker/issues/875), [#876](https://github.com/openlinker-project/openlinker/issues/876), [#877](https://github.com/openlinker-project/openlinker/issues/877), [#878](https://github.com/openlinker-project/openlinker/issues/878), [#879](https://github.com/openlinker-project/openlinker/issues/879)
- PRs: [#947](https://github.com/openlinker-project/openlinker/pull/947), [#958](https://github.com/openlinker-project/openlinker/pull/958), [#959](https://github.com/openlinker-project/openlinker/pull/959), [#960](https://github.com/openlinker-project/openlinker/pull/960), [#969](https://github.com/openlinker-project/openlinker/pull/969), [#970](https://github.com/openlinker-project/openlinker/pull/970), [#972](https://github.com/openlinker-project/openlinker/pull/972)
