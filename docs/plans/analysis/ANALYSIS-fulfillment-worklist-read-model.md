# Pre-implement verdict — #2406 fulfilment worklist read model (`W3a-19`)

**Base audited**: `origin/oms-programme-wave-3a` @ `42ba1fc14`.
**Verdict**: **GO-WITH-CHANGES**. No reuse collision, no contract break, no migration.
All findings are folded into `docs/plans/implementation-plan-fulfillment-worklist-read-model.md`.

## BLOCKING

### C1 — `version` does not cover the line counters the view returns

`fulfillment-work.repository.ts:30-36` addresses this issue by number: *"`recordLineProgress`
deliberately does NOT bump the header's `version` … a client holding a version cannot detect that
counters moved underneath it, so **#2406 must not use `version` alone to decide that a work object
is unchanged.**"*

The draft made `version` the sole token while putting `fulfilledQuantity` / `cancelledQuantity` in
the projection — exactly the case the docblock forbids, and silently, since §5 carried no scope
qualifier. **Resolved** in plan §5 "Token scope — HEADER ONLY": counters are display-only, safe
today because no exposed action reads one, with the condition that ends the decision named and
pinned by a spec.

### C2 — the port reserved a different mechanism for #2406, and §11 rejected a strawman of it

`fulfillment-work-repository.port.ts:32-35`: *"Input shapes are objects, deliberately … **#2406 will
add an `expectedVersion` precondition to the mutating methods**; an object shape makes that purely
additive instead of a nine-signature widening."*

The draft rejected that as "six signatures to change". False: the shapes are objects so the change
is additive and breaks no caller. **Resolved** — `claimWorkVersion` is dropped entirely in favour of
threading `expectedVersion` into the existing guards' own `WHERE` (also the independent conclusion
of the plan tech-review, on the separate grounds that claim-then-act reverses the `version` contract
and does not serialise claim-to-effect).

## Directed questions

| # | Question | Answer |
|---|---|---|
| 1 | `apps/api/src/fulfillment/` exists? | **No.** 39 entries under `apps/api/src`, none `fulfillment` (`fulfillment-authority/` is #2304, a different context). All four in-flight siblings (#2396/#2407/#2408/#2409) pinned at base with **zero commits**. |
| 2 | Existing list / version-guard on the port? | **No.** Only `findById` / `findByOrderId`, neither filterable nor paged. `expectedVersion` has exactly one repo-wide hit — the docblock in C2. `listWorks`, `deriveSupportedActions`, `OPERATOR_INVOCABLE_ACTIONS`, `IFulfillmentWorklistService`: zero hits. |
| 3 | `applyGuardedUpdate` reusable? | **Yes.** Private, same class, `(operation, build) => Promise<boolean>` off `result.affected`, 8 call sites, translates throws to `FulfillmentPersistenceError`. A `RETURNING` sibling exists but cannot serve the 409 body — a conflicting UPDATE affects no row. |
| 4 | Does `apps/web` hold a mirror? | **No.** `supportedActions` / `supported_actions`: zero hits in `apps/web/src`. `FulfillmentWorkActionValues` appears only in its own spec and one prose reference. |
| 5 | apps/api module precedent | `CatalogTrustApiModule` for shape; `apps/api/src/sales-documents/` for the larger DTO surface. Both suffix the host class `*ApiModule`. |
| 6 | Inverse-guard precedent | **Not the first.** All 40 `*-mirror.mjs` entries are *positive* mirrors; the inverse templates are `check-contract-suite-not-in-production.mjs` and `check-no-injection-contracts.mjs`. |
| 7 | Sibling collision risk | Zero today (no sibling has committed); real at merge. `fulfillment.module.ts` has a **single** `exports:` key on this base — the two-`exports` incident is not present. |

## Warnings folded into the plan

- **W1** guard must ship `--self-check` and strip comments before scanning.
- **W2** interface in `application/interfaces/` (matches #2400/#2401/#2402).
- **W3** host class must be `FulfillmentApiModule` — `FulfillmentModule` collides with the core barrel export.
- **W4** docblock must state the split from `IFulfillmentWorkQueryService` (same folder, same aggregate).
- **W5** nothing writes `status = 'on_hold'`; `activeHolds` is the authority on heldness.
- **W6** `apps/api` must not import `FulfillmentWorkRepositoryPort` (deny pattern + not exported).
- **W7** ADR-053 no-injection holds; nothing here injects `orders` / `inventory`.

## Open questions, all now answered in the plan

1. Token scope → header-only (§5).
2. Why not `claimWorkVersion` → dropped (§5, §11).
3. Heldness authority → `activeHolds` (§4).
4. Refreshed `version` for the 409 body → `findById` re-read, documented best-effort (§5).
5. Batched holds read → `listActiveHoldsForWorks(workIds)` (§8 step 3/4).
