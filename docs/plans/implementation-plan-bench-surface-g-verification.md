# Implementation plan — W3b-7 (#2420), Surface G: G4, and proving G1–G3 hold

**Verification task.** G1/G2/G3 were built by #2413/#2416/#2418. Nothing may be re-implemented
here; a divergence found is **reported**, not repaired.

## Phase 0 — findings established before any code

Two things are already true on `c4ac4b436` and shape everything below.

> **Revised after `/pre-implement` and `/tech-review` (both run on this plan).**
> The review carried one BLOCKING item — Phase 2's G2 as first drafted would have
> asserted `markPacked` twice under a split-order title, which is true of *any*
> order and would have gone green with both work rows deleted: precisely the
> "certifies what it never checked" failure this issue exists to prevent. The
> order-grain assertion is dropped; only the per-work grain is asserted, and
> AC-3 is reported unsatisfiable. Phase 1a's formulation, F1's framing, the
> `__tests__` walk and Phase 1d's reasoning were corrected as recorded below.

### Two acceptance criteria cannot be met against the shipped model

Stated as a **deliverable**, not as context. #2420's AC-2 (*"including that
neither-and-both are unrepresentable"*) and AC-3 (*"exactly one order-grain fact"*)
are both premised on a model that does not exist — F1 and F2 below. Substitute
assertions are written where something real can be asserted, and each says in its
own docblock which half of its AC it does **not** cover. Otherwise the issue
closes with two ACs ticked by adjacent tests and the gap becomes invisible.

### F1 — the packed-actor constraint is AT-MOST-ONE, not "exactly one"

**This is a limitation #2413 recorded, not a defect discovered.** The migration's
own docblock states the choice, the reason (`<>` is unsatisfiable at INSERT — the
router creates these rows unpacked) and the consequence verbatim: *"Both-NULL is
therefore ambiguous between 'not packed' and 'packed with no attribution
recorded'… Recorded as a limitation rather than papered over."* What is new, and
what is worth reporting, is that #2418 has since **weakened the disambiguator**
and made the bad state reachable — see below.


`CHK_fulfillment_works_packed_actor` is
`NOT ("packedByUserId" IS NOT NULL AND "packedByService" IS NOT NULL)` — deliberately unlike
`CHK_fulfillment_holds_actor`'s `(a IS NOT NULL) <> (b IS NOT NULL)`. **Both-NULL is legal**, and
`fulfillment-work-schema.int-spec.ts:299` asserts it is accepted.

That is *forced*, and #2413 says so. What has changed since is the disambiguator. #2413 argued
both-NULL is safe because *"`status` distinguishes them"* — a work not yet packed vs one packed
without attribution. #2418 then added `parcelClosedAt`, a real completion instant, and with it
the state `parcelClosedAt IS NOT NULL AND both actors NULL`, which `status` does **not**
disambiguate: it says, unambiguously, *"this parcel was packed and we do not know by whom"* —
exactly what G1's rationale calls dangerous.

It is reachable. `VerifyUnitInput.verifiedByUserId` is `string | null`, `claimParcelClose`
writes it straight through, and `bench-parcel.controller.ts:115` passes `user?.id ?? null` from
an **optional** `@CurrentUser()`. Only `RolesGuard` on that route (`admin`/`operator`/`packer`,
deny-by-default since #2079) guarantees a principal — so the route guard, not the model, is what
upholds G1 today.

**Reported, not repaired** (the fix is a conditional CHECK, i.e. a migration).
What is asserted instead: the invariant that *does* hold on the shipped path, and — named in the
test's own docblock — the half of AC-2 that cannot be asserted.

### F2 — closing a parcel does not write the order-grain packed fact

`markPacked` has exactly one production caller, `orders.controller.ts:593` (the #2287 manual
toggle). `claimParcelClose` is called only by `FulfillmentVerificationService.verifyUnit` and
writes `fulfillment_works` alone. There is **no edge from the bench to `order_records.packedAt`**.

So spec § 2.7 G2 — *"the order-level packed fact follows from the works — one fact, derived"* —
is not implemented. Building it is implementing G2, not verifying it: it needs a cross-context
write, D10 first-writer-wins against the manual toggle, the T5 `order.packed` emission, and a
split-order decision. **Reported, not repaired.**

## Phase 1 — G4

Two callers, two assertions, and one honest statement of divergence.

**1a. Source-text invariant** — `apps/api/src/bench/application/__tests__/bench-eligibility-single-rule.spec.ts`,
modelled on `libs/core/src/__tests__/no-direct-buffer-read.spec.ts`. **A heuristic, and 1b is
what actually catches drift** — the first draft's rule ("a file containing `'packable'` must
import the helper") missed the realistic copy, which is refusal-shaped and contains neither the
literal nor the import. Two halves instead:

- **positive** — both known callers must import `deriveBenchWorkState`, which is also the
  non-vacuity guard and fails the moment a caller is rewired to an inline copy;
- **negative** — no production file under `apps/api/src/bench/` outside the owner may contain a
  `'cancelled'` comparison *and* a hold-count expression, that pair being the derivation's
  distinguishing input shape.

The walk covers **production source only**, exactly as the precedent's `collectSourceFiles`
does; that is not a carve-out, and `__tests__` must not appear in an authorized-paths list,
which would create the appearance of the exemption the precedent's docblock warns about. Copy
the precedent's other two guards too: the empty-walk failure, and the `toEqual` pin on the
authorized list so widening it is a deliberate edit to a failing assertion.

**1b. Cross-caller behavioural spec** — **not a new harness.** Both bench service specs already
carry ~150 lines of builders and `BenchParcelService` injects six dependencies, so a third copy
was the wrong shape. Instead one shared table
(`__tests__/bench-eligibility.fixture.ts`) is read by three specs: the rule's, the list's and
the parcel read's, each using the harness it already has. A row added to the table is asserted by
all three, and a service that stops calling the shared rule fails its own spec.

**1c. Token pass-through** — the bench must not recompute `version` or `supportedActions`; both
come from the same `FulfillmentWorkView` the desktop worklist (#2406) reads, so an action legal
in one is legal in the other and the token means one thing.

**1d. The token is not spent by packing** (integration). `verifyUnit` records into
`fulfillment_work_verifications` — a *different table* — so a mid-parcel scan leaves the
planner's in-flight token valid. A close/reopen does bump it, correctly: that is a state change.
(`recordLineProgress`'s own no-bump rule is #2400's progress path and never runs on the bench
flow; citing it here would invite an assertion into a bench int-spec where it cannot fire.)
This is the whole of "a legitimate action in one surface must not present the other with a
stale-token conflict the operator must resolve by hand", and it is asserted rather than assumed.

**Legitimate divergence, stated rather than papered over.** The desktop worklist
(`FulfillmentWorklistService`, core) does **not** read `bench-work-eligibility.ts`, and must not:
`BenchWorkState` is a *packing* question ("may I put this in a box"), `supportedActions` is a
*planning* one ("what may I do to this work"). The shared substrate is the `FulfillmentWorkView`
— same rows, same `version`, same `deriveSupportedActions`. The bench adds a projection on top.
Forcing the planning surface to carry a packing verdict would be a false identity.

## Phase 2 — G1/G2/G3 end to end

New `apps/api/test/integration/bench-surface-g.int-spec.ts`.

- **G1** — close through the real service with a user: `packedByUserId` set, `packedByService`
  NULL; reopen clears both; the DB refuses a both-set row. Plus F1's gap named in place.
- **G2** — a **split** order: two works on one order, both closed by different packers, each
  carrying **its own** packer. That is the decisions-table D4 grain (*"attribution is per work,
  per phase"* — not the § 2.4 story D4, the interrupt, which the bench code uses that name for
  elsewhere), it is reachable through the bench, and it is asserted nowhere today.
  **The order-grain half is deliberately NOT asserted here.** Calling `markPacked` twice beside
  a split fixture would go green with both work rows deleted — it is true of any order and says
  nothing about splitting — and it duplicates
  `order-record-packed.service.spec.ts:123`. AC-3 is reported unsatisfiable instead. No test
  pins the gap as correct, either: that would entrench it.
- **G3** — the unit-level half the HTTP test cannot give: a second **distinct** gesture on one
  line of the same SKU is a second unit (added to
  `fulfillment-verification.service.spec.ts`, which today only covers the retry half).

## Phase 3 — D6

`libs/core/src/fulfillment/__tests__/progress-event-carries-no-actor.spec.ts`, modelled on
`verification-indistinguishable.spec.ts`, over two surfaces: the event declarations
(comment-stripped, base + all five variants) and `fulfillment_progress_claims`' column roster
(exact set, non-vacuity guarded).

## Out of scope

New routes (none needed — no `PACKER_GRANTED_ROUTES` entry), offline/a11y (#2421), and any
change to G1/G2/G3 production code.

## Gate

`pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration`. Every assertion shown
red-first by mutation.
