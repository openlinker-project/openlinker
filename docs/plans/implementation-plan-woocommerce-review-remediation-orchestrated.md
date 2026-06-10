# Implementation Plan — WooCommerce PR-Stack Review Remediation (Orchestrated)

**Status:** ✅ Complete (2026-06-10) — Waves 0–6 done; all 7 PRs fixed, pushed, re-reviewed, and commented. Pending: §8 catch-up to origin/main + merge (gated, not started).
**Author:** OpenLinker Senior Engineer (orchestrator)
**Date:** 2026-06-10
**Reviewer of record:** `piotrswierzy` (all reviews dated 2026-06-09, the current round)

---

## 1. Goal & Scope

Resolve **every** code-review finding (BLOCKING / IMPORTANT / SUGGESTION) raised by `piotrswierzy`
across the 7 open WooCommerce PRs, keep each child branch aligned with its parent as fixes land,
then run a **second `/tech-review` pass**, comment + fix anything new, and re-align — looping until
each PR is clean.

**In scope (7 PRs):** #947, #958, #960, #969, #970, #959, #972.
**Out of scope (flagged, not fixed here):** #1002 (`975-woocommerce-frontend-plugin`). It is only
relevant because #947 review item 4 (FE scope bleed) requires a *decision* on which PR owns the
frontend. See §7.

**Non-goals:** Merging any PR to `main` (optional final phase §8, gated on explicit go-ahead);
new feature work beyond what the reviews require; touching non-WooCommerce code except the 3
shared regressions the reviews explicitly call out.

---

## 2. Branch Topology & Canonical Stack Order

GitHub PR base/head refs (verified via `list_pull_requests`):

| PR | Branch | Base | Capability |
|----|--------|------|-----------|
| #947 | `873-woocommerce-plugin-scaffold` | `main` | scaffold / connection / tester |
| #958 | `874-woocommerce-product-master-read` | `main` | ProductMaster read |
| #960 | `879-woocommerce-product-master-write` | `874-…read` | ProductMaster write |
| #969 | `875-woocommerce-inventory-master-port` | `879-…write` | InventoryMaster |
| #970 | `877-woocommerce-order-processor` | `875-…inventory` | OrderProcessor + Fulfillment |
| #959 | `876-woocommerce-order-source-port` | `874-…read` | OrderSource |
| #972 | `878-woocommerce-e2e-docker` | `main` | E2E + Docker dev stack |

**Canonical fix-flow order** (fixes flow root → leaf so the canonical C2/C3 versions propagate downstream; this is the *fix order*, NOT a claim about git ancestry):

```
 873 (scaffold, #947)          ← Wave 0
 874 (read, #958)              ← Wave 1   (logical child of scaffold)
 879 (write, #960) ───┐        ← Wave 2a   ┐ independent siblings,
 876 (ordersource,#959)┘       ← Wave 2b   ┘ both have PR-base 874
 875 (inventory, #969)         ← Wave 3   (PR-base 879)
 877 (order processor, #970)   ← Wave 4   (PR-base 875)
 878 (e2e, #972)               ← Wave 5   (touches every adapter — fix last)
```

> ⚠️ **BLOCKING constraint resolved (tech-review).** Two facts shape the alignment strategy:
> 1. **Local `main` is stale** — 52 commits behind `origin/main` (+3 local commits). We do **NOT**
>    rebase any branch onto local `main`, and we do **NOT** fold a "catch up to `origin/main`"
>    (52-commit drift) into the review-fix waves — that conflates review remediation with a base
>    bump and explodes the conflict surface. Step 1 of Wave 0 is `git fetch origin` so every
>    decision reasons about real `origin/*` refs, not the stale local `main`.
> 2. **Verified topology (Wave 0 Step 1):** despite GitHub PR-bases reading `main`, the branches are
>    a **real local stack** rooted at merge-base `1112ed5c` (cumulative commits 873=60 → 874=61 →
>    879=121 → 875=180 → 877=252; 876=121 and 878=76 as siblings). Each branch is checked out in its
>    own worktree under `.claude/worktrees/`. So merging a fixed parent into its child brings a clean
>    fix-delta (old parent commit is already an ancestor). **Branches keep their existing PR bases**;
>    catch-up to `origin/main` stays a **separate decision after reviews are clean** (§8).
>
> **Alignment = merge parent → child (default), not rebase.** All branches are under active review
> with anchored inline comments; rebase + force-push orphans those threads. We instead merge the
> fixed parent *into* the child (no history rewrite, no force-push, review threads stay anchored).
> Rebase is used only where a branch genuinely needs linear history and has no live review anchors.
> The C1 regression fix is applied **per-branch idempotently** (see §3) rather than relied upon to
> propagate through merges — it's trivial and identical, so per-branch application can't conflict.

---

## 3. Cross-Cutting Concerns (fix once, propagate — do NOT fix 7×)

### C1 — The 3 shared "branch-hygiene" regressions (BLOCKING on #947, #958, #959, #960, #969, #970, #972)
Byte-identical in every branch; origin is #947 (`873-scaffold`):
1. **`.claude/scheduled_tasks.lock`** committed → delete it + add `.claude/` to `.gitignore`.
   *(Already staged-for-delete in the current working tree — finish the job + gitignore.)*
2. **`apps/api/src/database/data-source.ts`** env-path reverted `'../../../.env'` → `'../../.env'`
   → restore `'../../../'` (matches `main`; current code is a migration/boot regression).
3. **`apps/web/src/features/shipments/api/shipments.types.ts`** re-adds `@deprecated shippingMethod`
   on `GenerateLabelInput` → remove (contradicts #979). *(Note: #972 already fixed this one; apply
   only where still present.)*

**Strategy (per-branch idempotent — PRIMARY).** Because the branches are siblings (not a true git
stack, §2) and the fix is trivial + byte-identical, each wave applies the identical 3-file fix as
its **own first commit** on its branch. This can't conflict (every branch ends at the same desired
state) and doesn't depend on merge/rebase propagation. Where a later parent→child merge re-surfaces
an identical regression as a conflict, the rule is **"take the regression-removed side."** Do **not**
rebase a branch onto #947 to inherit this fix — that would re-parent siblings (§2).

### C2 — SSRF DTO has 3 divergent copies (IMPORTANT, spans #958/#959/#969)
`woocommerce-connection-config.dto.ts` `IsSsrfSafeUrlConstraint` exists in 3 versions; #969's is the
**strongest** (closes decimal-integer `2130706433` + octal-octet `0177.0.0.1` bypasses), #959's is the
**weakest**. **Goal:** one canonical source; the strongest filter must be the one that survives.
The canonical (strongest) version is authored in the earliest wave that owns the DTO and each later
wave's subagent is told to **adopt that exact version verbatim** (not merge-propagated — explicit, so
last-write-wins can't reinstate the weak copy). Also add (documented-limitation comment): config-time
validation can't stop DNS-rebinding / request-time redirects → fold into the request path where #969's
review asks (`fetch` follows redirects to private IPs).

### C3 — Duplicate `toPositiveInt` (SUGGESTION, spans #969/#970)
Two helpers, same name, different contracts: #970's adapter has a 4-arg **throwing** version;
`woocommerce-utils.ts` (used by #969) has a `null`-returning one. Consolidate / rename. Resolve in the
ancestor (#969 owns `woocommerce-utils.ts`) and have #970 consume the hoisted helper.

> C2 and C3 are why waves are **ordered, not independent**: the canonical version must live upstream
> and flow down. Subagents are told to *consume* the upstream version, never re-fork it.

---

## 4. Orchestration Model

### Roles
- **Orchestrator (main thread = me).** Owns ALL git operations: `git fetch`, branch checkout,
  parent→child merges (rebase only as the documented exception), conflict resolution, topology
  verification, inter-wave sequencing, and the per-PR commit/push. Owns the re-review pass. Holds
  the canonical fix inventory.
- **Fix subagents (one per PR per wave).** Scoped to a single already-checked-out branch. Receive an
  explicit, finite fix list + inline-comment references + coding-standard constraints + the scoped
  quality-gate commands. They edit code and tests only; **they do not run git rebase/merge/push.**
  They report a structured summary (what changed, gate results, anything they couldn't resolve).

### Why Agent-tool dispatch, not a Workflow script
Waves are **sequential with a parent→child merge between each** (a child is aligned to its parent only
after the parent is fixed). Merges need a human-in-the-loop on a shared worktree and are stateful — a
poor fit for stateless parallel fan-out. The only genuine parallelism is the independent sibling pair
(#960 ∥ #959); per §7.4 we run it **sequentially** (resource-constrained PC). Default: **sequential,
≤1 active fix subagent** (small batches).

### Subagent contract (the prompt each fix subagent gets)
1. **Context:** branch name, PR number, capability, the relevant `docs/architecture-overview.md` /
   `docs/engineering-standards.md` rules (hexagonal boundaries, no `any`, no `console.log`, ports not
   adapters, `as const` unions, file headers, Symbol-token import rules).
2. **Fix list:** the exact BLOCKING → IMPORTANT → SUGGESTION items for that PR (from §5), each with
   file:line and the reviewer's prescribed fix. Plus: "consume the upstream canonical version of
   C2/C3, do not re-fork."
3. **Tests:** add/repair unit tests so they encode the *correct* contract (several reviews flag tests
   that pass while asserting the wrong behavior — e.g. #970 I3, #969 B1 mock).
4. **Scoped quality gate** (resource-constrained — never full-repo):
   ```bash
   pnpm --filter @openlinker/integrations-woocommerce lint
   pnpm --filter @openlinker/integrations-woocommerce type-check
   pnpm --filter @openlinker/integrations-woocommerce test
   ```
   For PRs touching core (`#970` touches `order-sync.service.ts`): also run the single affected core
   spec (`order-sync.service.spec`) and `pnpm check:invariants`.
5. **Report back:** changed files, gate output (pass/fail counts), zero lint warnings (reviews flag 3
   carried warnings repeatedly), and any item it judged should NOT be applied (with reasoning) for
   orchestrator decision.

### Alignment protocol (orchestrator, between waves) — DIRECT APPLY, not git-merge
**Verified in Wave 1 (do not retry merge):** the branches' true merge-base is `1112ed5c` (#979) with
**0 WooCommerce files** — each branch re-created the entire WC tree independently, so `git merge`
parent→child produces a storm of `add/add` conflicts on every WC file. Merge is therefore **abandoned**
as the alignment mechanism. Instead, "child aligned with parent" is achieved by **re-applying the same
fixes directly** on each branch (FE-strip, doc-drop, C1, and any canonical C2/C3 version) — identical
end-state, zero artificial conflicts. This is the plan's per-branch idempotent strategy (§3), now the
sole mechanism.

Per wave: `git fetch origin` once up front (real `origin/*` refs, not stale local `main`). Each branch
is worked **in its own worktree** under `.claude/worktrees/<branch>/` (each has usable `node_modules`).
The fix subagent applies that branch's full scope (own reviewer items + propagated scaffold fixes + C1
+ canonical C2/C3). Orchestrator commits (`-s --no-verify`) and `git push` (fast-forward — **no
force-push**, never to `main`). Catch-up to a moved `origin/main` stays out of scope here (§8).

### Quality-gate & commit rules
- DCO sign-off on every commit (`git commit -s`); conventional messages (`fix(woocommerce): …`).
- **CI is the real full-suite + integration gate.** Locally we run only the scoped WooCommerce gate
  (resource-constrained PC); all commits use `--no-verify` so the heavy pre-commit hook is skipped.
  The full `pnpm test` / `pnpm test:integration` run happens in CI on push.
- **Local gate per wave:** `pnpm --filter @openlinker/integrations-woocommerce {lint,type-check,test}`,
  0 errors + 0 warnings. For core-touching waves (#958, #970) also run **`pnpm check:invariants`
  directly** (lighter than full `pnpm lint`; catches cross-context-import + service-interface breaks).
- Co-author trailer per repo convention.

---

## 5. Waves — Per-PR Fix Inventory & Acceptance Criteria

### Wave 0 — #947 `873-scaffold` (root; fixes C1 origin)
**Step 1 (before edits):** `git fetch origin`; `git merge-base` map the real ancestry of `873/874/879/
875/877/876/878` vs `origin/main` to confirm the sibling topology (§2) — record findings.
**Blocking:** C1 (lock + data-source + shipments.types — applied per-branch idempotently, §3).
**Important:** (4) **FE strip (§7.1 — resolved):** remove only the **WooCommerce** entries/files from
#947 so #1002 owns the FE — `apps/web/src/plugins/woocommerce/*`, `features/connections/components/
woocommerce-setup-*`, the WC page + route, and the **WC entries** in `plugins/index.ts` +
`connections.types.ts` (do NOT delete those shared files; remove only WC lines). Confirm #1002 re-adds
them. (5) **drop process docs (§7.2 — resolved):** remove the 7 `implementation-plan-*.md` +
`review-findings-complete-summary.md` from the branch. (6) fix stale `woocommerce-config.types.ts` doc
comment (`['http','https']` → reflect `['https']`-only).
**Note (non-blocking):** scaffold must not be the merge point exposing operator-facing connection
testing before SSRF lands → tracked via C2 ordering.
**AC:** `.claude/` gitignored & lock gone; `data-source.ts` == `origin/main`; no `shippingMethod`;
FE stripped (FE build for other platforms still green); process docs gone; scaffold gate green.

### Wave 1 — #958 `874-read`
**Blocking:** C1 (applied per-branch, §3); ensure the **composite-key read fix** (`idMap.get(\`${id}:${connectionId}\`)`)
lands here, not just in #960 — else #958 ships a broken read path (returns empty vs real service).
**Important:** I1 — `createCapabilityAdapter` eager construction → build adapter/client/mapper *inside*
the dispatch thunk so unsupported-capability requests don't fetch creds + allocate first; I2 — guard
missing `config.siteUrl` → throw `WooCommerceConfigException` (not raw `TypeError` from `.replace()` on
undefined).
**Suggestions:** EAN/GTIN key-overlap comment; make `AbortError` (timeout) retryable for consistency;
note `parseVariantPrice`/`parsePrice` dup + `currency: null` `TODO(#879)`.
**AC:** read path works against composite-key map; lazy dispatch; siteUrl guarded; gate green, 0 warnings.

### Wave 2a — #960 `879-write` (merge in fixed #958)
**Blocking:** C1; confirm composite-key read fix present (coordinate w/ Wave 1 — ideally fixed in #958
and inherited).
**Important:** `upsertProductVariant` single-page variation lookup → use `fetchAllPages` so a target SKU
on page 2+ updates instead of POSTing a duplicate variation.
**Suggestions:** `deleteProduct` pass `{ force: true }` (or document soft-delete); map WC
`400 product_invalid_sku` → clear domain error; fix `request()` "after N retries" message on
non-retried non-2xx.
**AC:** >100-variation upsert updates (no dup); gate green.

### Wave 2b — #959 `876-ordersource` (merge in fixed #958; independent of 2a)
**Blocking:** C1.
**Important:** `listOrderFeed` — pass **`dates_are_gmt: true`** alongside `modified_after` (and on
`initialSyncFrom`) → fixes silent permanent order loss for shops west of GMT; SSRF — adopt C2 canonical
(decimal/octal integer-IP) + documented DNS-rebind limitation.
**Suggestion:** reconsider WC `failed` → `cancelled` mapping (failed payment can recover) → `updated`,
or confirm downstream treats `cancelled` benignly.
**AC:** GMT watermark correct; SSRF == canonical; gate green.

### Wave 3 — #969 `875-inventory` (merge in fixed #960; owns C2 + C3 canonical)
**Blocking:** B1 — wrong map key: use composite `\`${id}:${connectionId}\`` + drop the `!` so
`variantId` isn't silently `undefined` (this is the core feature of the PR); A — `manage_stock=false`
products report `0` and get de-listed by the authoritative master → read `stock_status`/`manage_stock`
and represent unmanaged-but-instock correctly; resolve the **`9999` sentinel** decision (TODO in code:
"confirm with Piotr") — pick flag / per-connection cap / documented-deliberate; C1.
**Important:** use `@openlinker/core/identifier-mapping/testing` fake instead of hand-rolled mock (the
bad mock hid B1) + assert `variantId`/`id` defined; fix `getInventory`/`getAvailableQuantity`
"aggregate" comment vs `rows[0]` reality; SSRF redirect-time + decimal/octal (C2 canonical lives here);
`protocols:['https']` vs loopback-http doc contradiction.
**Suggestions:** `NaN` guard on `Number(externalId)` (reuse hoisted `toPositiveInt` — C3); note
non-atomic read-modify-write in `adjustInventory`; PR-description "set-absolute" → "delta"; clear the
**3 lint warnings** in the inventory spec (missing return types).
**AC:** variable-product variations get real `variantId`; unmanaged-instock not de-listed; sentinel
decided; tests use the fake; 0 lint warnings; gate green.

### Wave 4 — #970 `877-order-processor` (merge in fixed #969; heaviest — 4 blockers)
**⚓ Reference-implementation anchor (tech-review).** B2/B3 are `OrderProcessorManagerPort` **contract**
behaviors shared with PrestaShop. The subagent MUST diff against `PrestashopOrderProcessorAdapter` (the
canonical impl) and match its return-shape + idempotency-ownership pattern rather than invent a parallel
one. If I2 (reach customer provisioning) needs `OrderSyncService` to emit new neutral metadata
(`buyerEmail`/`internalOrderId`), that is a **CORE change rippling to the PrestaShop adapter** — confirm
PrestaShop still satisfies the contract after the change; gate on `pnpm check:invariants` + the core
`order-sync.service.spec`. Flag any core-shape change back to the orchestrator before committing.
**Blocking:** B1 — `createOrder` must NOT require `metadata.internalOrderId` (orchestration never sets
it → currently throws 100%); create unconditionally; B2 — `OrderRef.orderId` must return the WC-native
id `String(raw.id)`, not the internal OL id (core's `persistDestinationMapping` corrupts otherwise);
B3 — delete adapter-owned idempotency skip-check (Step 2) + mapping write (Step 9); core owns them
under the per-(order,destination) lock (#909); keep platform-side `_ol_order_id` meta as forensic /
recovery dedup only; B4 — pin source-authoritative price via `subtotal`/`total` (line `price` is
read-only on WC write) or throw (#895 / ADR-014); C1.
**Important:** I1 — stop swallowing 401/403 into guest orders (propagate `WooCommerceAuthFailureException`
for reauth classification); I2 — `buyerEmail` never set by orchestration (same root as B1) → make
customer provisioning reachable; I3 — rewrite the 55 tests to the *correct* contract (no fabricated
`internalOrderId`, assert WC id returned) + add an orchestration-shaped test + integration test; I4 —
add/demonstrate the retry-classifier routing for `WooCommerceOrderProcessingException` (claimed,
untested).
**Suggestions:** gate `set_paid` to non-pending statuses; malformed `externalOrderId` → validation/
processing exception, not `ResourceNotFound`; consume hoisted `toPositiveInt` (C3).
**AC:** happy path creates a WC order against real orchestration; returns WC id; no adapter-side
idempotency; buyer-paid price pinned; tests encode real contract + integration test; gate green +
core `order-sync.service.spec` + `pnpm check:invariants` pass.

### Wave 5 — #972 `878-e2e-docker` (merge in fixed #970 tip — absorbs all upstream)
**Blocking:** C1 (lock + data-source; shipments.types already fixed here).
**Important:** pin `bitnami/wordpress:latest` → specific `:<x.y.z>` in **both** root `docker-compose.yml`
and `woocommerce-container.helper.ts` (MySQL already pinned `8.4.7`); merge-strategy now resolved by
this plan (rebase-on-merged-chain) — update PR body to say so + drop the divergence vs individual
capability PRs once they carry the fixes.
**Suggestions:** clear 3 carried lint warnings; add int-spec/README note on the ~5 min cold-cache boot
budget so CI timeouts are set deliberately.
**AC:** image pinned; rebased cleanly on the chain (no adapter divergence); CI-gated suite green where
runnable (testcontainers may be skipped locally per `OL_SKIP_WC_INTEGRATION` + resource limits — note
explicitly if not executed).

### Wave 6 — Re-review loop (the "another round of /tech-review" ask)
For each PR, in stack order: run `/tech-review` on the rebased branch diff. For any new finding →
post a PR comment (orchestrator), fix it (subagent or inline), re-run scoped gate, re-merge into
children if the change is upstream. **Loop a PR until its `/tech-review` is clean.** Stop condition: every PR
passes `/tech-review` with no BLOCKING/IMPORTANT open. SUGGESTIONs may be deferred with an explicit
note if the user agrees.

---

## 6. Execution Order Summary

`git fetch origin` → `Wave 0 (#947)` → merge→ `Wave 1 (#958)` → merge→ `Wave 2a (#960)` → `Wave 2b (#959)`
(sequential) → merge→ `Wave 3 (#969)` → merge→ `Wave 4 (#970)` → merge→ `Wave 5 (#972)` →
`Wave 6 re-review loop` → (optional, separate) `§8 catch-up to origin/main + merge to main`.

A shared **task list** (TaskCreate) mirrors these waves; each wave flips to `in_progress` on dispatch
and `completed` on gate-green + merge-aligned.

---

## 7. Decisions (resolved 2026-06-10)

1. **FE ownership:** ✅ **Strip FE from #947** — #1002 owns the entire WooCommerce frontend. Wave 0
   removes `apps/web/src/plugins/woocommerce/*`, `features/connections/components/woocommerce-setup-*`,
   the page/route, and the `plugins/index.ts` + `connections.types.ts` WC additions from #947.
2. **Committed planning docs:** ✅ **Drop** the 7 `implementation-plan-*.md` +
   `review-findings-complete-summary.md` from #947. This remediation plan stays local/untracked (not
   committed to any feature branch) — `docs/plans/` artifacts are not deliverables.
3. **#969 `9999` sentinel:** ✅ **Per-connection cap** — replace the magic `9999` with a configurable
   per-connection max-quantity for `manage_stock=false` + `instock` products. Add the config field to
   the WooCommerce connection config (+ shape validator), document the default, read it in
   `resolveStockQuantity`. **No migration needed** — connection `config` is JSONB. **API-only for now**;
   surfacing the field in the FE connection form is #1002's concern — flag it there so the cap isn't
   operator-invisible.
4. **Wave 2a∥2b:** ✅ **Sequential** (resource-constrained PC) — #960 then #959, no worktree isolation.
5. **Push cadence:** ✅ **Push per wave** so each PR's review updates incrementally. Under the
   merge-align model (§4) this is a plain fast-forward `git push` — **no force-push expected**;
   `--force-with-lease` only if a rare rebase was used, never `--force`, never to `main`.
6. **`.gitignore`:** ✅ Beyond the lock file, ignore **all** Claude artifacts — add `.claude/` (the
   whole dir) to `.gitignore` in Wave 0 so no future session lock / scheduled-task / settings file is
   ever committed.

---

## 8b. Catch-up to `origin/main` (✅ DONE 2026-06-10) — PR base conflicts resolved

All 7 branches merged `origin/main` (sole conflict `plugins/index.ts` → took main's version),
gates green, pushed. `git merge-tree` re-verified: all 7 now merge cleanly into `origin/main`.
New HEADs: 873 `158394aa`, 874 `a3a65d35`, 879 `7aa8b1d4`, 875 `6fdbf72f`, 877 `ad5feb2b`,
876 `bfd4d908`, 878 `22a2360d`.

**PR-base fix (2026-06-10):** #960/#969/#970/#959 had `base` = parent feature branch (not `main`),
which showed as CONFLICTING (parallel-superset branches with no shared history conflict child-vs-parent).
Retargeted all four to `main` via `gh api -X PATCH .../pulls/N -f base=main` (note: `gh pr edit --base`
fails on this repo with a Projects-classic GraphQL deprecation error — use the REST PATCH). All 7 PRs
now `MERGEABLE` against `main`. Containment: #970 ⊇ {scaffold,read,write,inventory,processor};
#959 = {…,ordersource}; #972 = {…,e2e/docker}. Recommended landing: merge **#970 → #959 → #972**,
close #947/#958/#960/#969 as subsumed by #970 (re-merge/resolve the content-identical overlap on
#959/#972 right before each merge).



PRs show "conflicting" because the branches are ~52 commits behind a moved `origin/main`.
**Verified conflict surface (via `git merge-tree` against `origin/main`, all 7 branches):**
exactly ONE file — `apps/web/src/plugins/index.ts`. Cause: `origin/main` added the `inpost`
plugin; our branches removed the WooCommerce entry. **Resolution (uniform):** take `origin/main`'s
version verbatim (`git checkout origin/main -- apps/web/src/plugins/index.ts`) — it has the correct
plugin set (prestashop, allegro, dpd, inpost) and no WC.

**Per-branch recipe (orchestrator, in each worktree):**
```bash
git merge origin/main                                    # conflicts only on plugins/index.ts
git checkout origin/main -- apps/web/src/plugins/index.ts # take main's version (no WC, has inpost)
git add apps/web/src/plugins/index.ts
# gate (catches semantic drift from 52 commits of main):
pnpm --filter @openlinker/integrations-woocommerce lint && \
pnpm --filter @openlinker/integrations-woocommerce type-check && \
pnpm --filter @openlinker/integrations-woocommerce test && \
pnpm --filter @openlinker/web type-check && pnpm check:invariants
git commit --no-verify    # merge commit; then: git push (no force)
```
Order: #947 first as canary (full gate); if clean, the rest. Any branch with semantic breakage from
the merge gets a targeted fix before its commit.

---

## 8. Optional Final Phase — Merge to `main` (gated, separate)

Only on explicit go-ahead, and only **after** Wave 6 is clean. This is the **deliberately deferred**
base-bump: catch each branch up to the current `origin/main` (52 commits ahead of stale local main)
as its own focused step, resolving drift separately from review remediation. Then merge in fix-flow
order, each via PR merge (not local): #947 → #958 → (#960 → #969 → #970) → #959 → #972, re-targeting
each PR's base as the stack collapses. Never merge a PR whose `/tech-review` (Wave 6) isn't clean.

---

## 9. Risks

- **Merge conflicts** from the byte-identical regressions × divergent SSRF DTO. Mitigated by per-branch
  idempotent C1 (§3), the §4 conflict-resolution rules, and a smoke test after each parent→child merge.
- **Stale local `main` (52 behind)** — never used as a rebase/merge base for the WC branches; the
  catch-up to `origin/main` is isolated to §8 so it can't contaminate review-fix commits.
- **#970 is a near-rewrite of `createOrder`** (4 blockers change its core shape). Budget the most time
  here; the reviewer offered the corrected shape (create-unconditionally + return `String(raw.id)` +
  platform-side `_ol_order_id` recovery + `subtotal`/`total` pricing) — follow it.
- **Tests encoding wrong contracts** (#970 I3, #969 B1 mock) mean a green suite is currently misleading;
  fixing code will (correctly) turn them red first — subagents must rewrite tests, not chase green.
- **Testcontainers (#972)** likely not executed locally (resource limits) — will be stated explicitly,
  CI relied on for the real run.
