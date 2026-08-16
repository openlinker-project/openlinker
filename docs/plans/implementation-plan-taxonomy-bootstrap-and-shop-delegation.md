# Implementation Plan — taxonomy bootstrap + shop-browse delegation (#2084, #2085)

**Issues**: #2084 (blocker) + #2085, shipped as one PR
**Layer**: CORE (application) + Interface (apps/api) + a small Frontend follow-through
**Depends on**: #1979, #2061, #2063, #2074, #2075 — all merged

---

## 1. Understand the task

`ShopCategoryBrowseService` is the last shop-side read that still calls the platform live, contradicting ADR-037's defining property. #2074 deferred fixing it because delegating without a bootstrap would turn a populated picker into an empty one for up to an hour after a connection is created. #2084 supplies that bootstrap; #2085 then delegates.

They ship together deliberately: an intermediate commit with only #2084 adds a guarantee nothing consumes, and one with only #2085 is a live regression.

### Non-goals

- **No change to the sync job, scheduler task, or the projection schema.** The hourly task remains the steady-state refresh; this adds one more enqueue point.
- **No new port method.** The "is this scope already synced?" question is answered with the existing `IDestinationTaxonomyService.browse`.
- **No re-bootstrap on every enable.** See decision 2 — rows survive `disable()`, so a re-enable is not a gap.

---

## 2. Decisions settled during research

### D1 — Two triggers: unconditionally at create, and on the enable transition

The issue says "enqueue on enable, not only on create". `update()` has **no** status-transition hook today (`patch.status` is used only in a log string, `connection.service.ts:450`), so that half is new machinery.

At **create**, the call is *unconditional* — exactly mirroring `enqueueInitialCatalogSync` (:369), which is also unconditional. An explicit `status === 'active'` gate there would be dead weight: the D3 probe resolves the scope, and a connection that cannot resolve an adapter (because it was created disabled) fails that probe and skips on its own. Encoding the rule twice gives it two places to drift.

At **update**, the trigger is the transition *into* `active`. It is evaluated against `existing.status` — already fetched at :453 for the adapterKey immutability check, so it costs nothing — compared to the **returned** `connection.status`, never `patch.status`: a patch that omits `status` must not read as a transition, and the port's result is the authority on what was actually persisted.

### D2 — Permanent per-connection idempotency key, and why that is not a bug

Following the `bootstrap:${id}:product:syncAll` precedent (no timestamp), the key is
`bootstrap:${connectionId}:taxonomy:sync`.

The consequence to state plainly: **a re-enable after a disable will collapse into the original key and enqueue nothing.** That is correct, not a leak — `disable()` does not delete projection rows, so a re-enabled connection still has its tree, and the hourly task owns drift from there. The key is consumed once, at the first moment the connection is usable.

This is also why the key must NOT reuse the scheduler's shape (`taxonomy:owner:<owner>:sync:<ts>`): that one is timestamped per tick and owner-scoped. A same-minute overlap between bootstrap and tick therefore does **not** collapse — the AC asking for that is unachievable without making the bootstrap key owner-scoped and timestamped, which would defeat run-once semantics. The **lock** (#2061, `taxonomySyncLockKey`) is what actually prevents a double walk, and it does so per scope regardless of how the two jobs were keyed. AC-3 is satisfied in substance (no double walk) but not literally (not via a shared key); the plan says so rather than quietly reinterpreting it.

### D3 — Skip the enqueue when the scope already has rows

AC-4 wants a second marketplace connection joining an already-synced owner not to trigger a redundant full walk. The lock only prevents a *concurrent* one; an owner synced an hour ago has a free lock and would be fully re-walked.

Cheapest sound check: `browse(connectionId, undefined)` — a synced scope always has roots (the same invariant #2075's empty-state heuristic rests on, and here both sides genuinely read the projection). Non-empty ⇒ skip. This needs no new port surface, and `resolveScope` throwing `TaxonomySourceUnavailableException` doubles as the capability gate: no taxonomy source ⇒ nothing to bootstrap ⇒ skip.

### D4 — #2085 changes the 422 body shape

Today core throws NestJS `UnprocessableEntityException` → `{statusCode, message, error: 'Unprocessable Entity'}`. After delegation the domain `TaxonomySourceUnavailableException` propagates to the **global** filter added in #2074 → `{statusCode, error: 'TaxonomySourceUnavailableException', message}`. Status stays 422; the body's `error` field changes. Nothing in `apps/web` reads it (verified), and the controller spec asserts the thrown type, not the body.

This also removes a documented layering violation — core importing `@nestjs/common` to throw an HTTP exception, which the domain exception's own docblock calls out as "not a pattern to copy".

### D5 — The shop picker's empty copy becomes false, again

`shop-category-picker-modal.tsx` currently renders **"This shop has no categories yet."** for an empty root. That is true while browse is live. After delegation it becomes a claim about the projection — and would assert the shop has no categories when the sync simply hasn't run.

This is the *third* instance of this defect class in the epic (the "Search categories" label, then the `no-matches` heuristic). Delegation must fix the copy in the same change, and it can now be **honest and precise** rather than hedged: with both halves on the projection, `isTaxonomyUnsynced`'s premise finally holds on this surface — so the picker's `'indeterminate'` state (added by #2075 exactly because it did not) **collapses back to the normal two**. Removing that state is part of this PR, not a follow-up.

**Why that is sound even though the bootstrap does not guarantee a *complete* tree.** The sync handler runs one `syncTaxonomy` per job and does not self-reschedule (`destination-taxonomy-sync.handler.ts:121`); one run expands at most `SYNC_PAGE_LIMIT_DEFAULT = 500` parent nodes. A WooCommerce tree is far smaller than that and so completes in the single bootstrap job, but that is a size accident, not a guarantee — and for a marketplace the walk genuinely spans several hourly ticks.

Incompleteness does **not** reintroduce the asymmetry, because the asymmetry never came from incompleteness. It came from the two halves reading two *different stores*. Mid-walk, both halves read the same partial projection and therefore degrade together: a node missing from search is equally unreachable by drilling. The operator can never see something in one half that the other denies, which is the only property `isTaxonomyUnsynced` needs. The plan claims the bootstrap makes the walk **start** immediately rather than up to an hour later — not that it finishes.

---

## 3. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `connection.service.ts` | `enqueueInitialTaxonomySync(connection)` — mirrors `enqueueInitialCatalogSync`: try/catch, warn-and-continue, never throws | Creation cannot fail on enqueue error |
| 2 | `connection.service.ts` | Call it unconditionally from `create()`, beside `enqueueInitialCatalogSync` | Create enqueues; a disabled connection skips via the D3 probe, not a status branch |
| 3 | `connection.service.ts` | In `update()`, `await` it before `return connection` when `existing.status !== 'active' && connection.status === 'active'` | Enabling enqueues; a name-only patch does not |
| 4 | `connection.service.ts` | Skip when `browse()` returns rows, or when `resolveScope` throws | No redundant walk; no taxonomy source ⇒ no job |
| 5 | `shop-category-browse.service.ts` | Delegate to `IDestinationTaxonomyService.browse`, map to `ShopCategory` | Never calls the adapter |
| 6 | `shop-category-browse.service.ts` | Drop the `@nestjs/common` import + `UnprocessableEntityException` | Core throws no HTTP exception |
| 7 | `shop-publish.controller.ts` | Update the `@ApiResponse` 422 description to name the domain cause | Docs match behaviour |
| 8 | `shop-category-picker-modal.tsx` | Empty copy → "not synced yet"; drop `'indeterminate'`, use `isTaxonomyUnsynced` | Both halves read one store |
| 9 | `category-search-results.tsx` | Remove the `'indeterminate'` variant + its test | Union back to two |
| 10 | Tests | `connection.service.spec` (3 existing bootstrap cases assert `enqueueJob` *not called* — must narrow to `objectContaining({jobType})`), `shop-category-browse.service.spec` (constructor arity changes, all 4 cases), controller spec, shop picker tests, primitive test | All green |
| 11 | `architecture-overview.md` | Record the bootstrap trigger + that the shop read is now projection-backed; retire the `'indeterminate'` paragraph | Reflects reality |

### The trap in step 10

`connection.service.spec.ts:404` and `:412` assert `expect(enqueueJob).not.toHaveBeenCalled()`. A second bootstrap job breaks both **even when the new code is correct**. They must narrow to the product job specifically, or they will be "fixed" by weakening them.

---

## 4. Validation

- **Architecture**: enqueue stays in `apps/api` (where `enqueueInitialCatalogSync` already lives); core gains no host concern and *sheds* one (the Nest exception). `ShopCategoryBrowseService` keeps its interface and DI token, and `DESTINATION_TAXONOMY_SERVICE_TOKEN` is already provided in the same core module, so #2085 changes no module edge. **#2084 does add one**: the host `IntegrationsModule` imports `CoreListingsModule` for that token. Verified cycle-free — the core `ListingsModule` imports the *core* `IntegrationsModule`, a different class, and `libs/core` cannot import `apps/api`; six host modules already import it. The cost is layering (connection management gains its first edge into `listings`), accepted because the alternative is dropping the already-synced check that stops a second marketplace connection re-walking a shared owner.
- **Idempotency**: run-once key, stated consequence (D2). Enqueue is best-effort and never fails a connection write.
- **No migration** — no schema change.
- **Tests**: unit for both services; the existing `destination-taxonomy.int-spec` covers the projection reads this now depends on.

### Risks

1. **A pre-existing connection whose taxonomy never synced.** Delegation makes its picker empty until the next hourly tick. The bootstrap only fires on a *transition*, so it does not retro-fill. Mitigated by the honest empty copy (D5) rather than by code — and worth stating in the PR, since an operator on a long-lived shop could see this once.
2. **`OL_TAXONOMY_SYNC_ENABLED=false`** makes the shop picker permanently empty after delegation, where today it works. This is the real behavioural cost of #2085 and belongs in the PR description.
3. **AC-3 is met in substance, not literally** (D2) — flagged rather than reinterpreted.
