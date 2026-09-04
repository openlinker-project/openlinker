# Product Spec — routing a parcel to the in-house bench by hand

**Status:** draft — context, stories, decision log. No surface, copy or layout is specified.
**Issue:** #2869. **Depends on:** #2395 (the routing commit), #2399 (the executor handshake),
#2409 (the OL-OMS executor). **Surfaces on:** #2411 (order detail) in slice 1, and #2410 (worklist)
once an override exists — M21.
**Explicitly not:** the pack bench itself (#2422 / `product-spec-oms-wave3b-scan-pick-pack.md`).

> **Sequencing gate — see § 5.1.** R7 must ship **before** `resolveFulfillmentRouter` is wired.

---

## 0. Scope of this document

§ 1 context · § 2 stories · § 3 non-goals · § 4 open questions · § 5 sequencing and slicing ·
§ 6 decision log.

**The decision log (§ 6) is the substantive part.** Twenty-three decisions, each with its reasoning.
Five of them answer the questions #2869 asks by name (M1–M5); the rest are consequences the issue
does not raise and that a reader would otherwise meet as surprises.

Two decisions — **M21** (where it surfaces) and **M22** (a closed reason plus a note) — **reverse
what this document first concluded**, because a shipped answer already existed in the tree and was
missed on the first pass. Both are recorded with the reversal visible rather than silently rewritten.

Where a story would imply a control, it stops at the behaviour.

---

## 1. Problem & context

### 1.1 The gap

An order reaches a pack bench **only** if routing created a `FulfillmentWork` and dispatched it to
the in-house holder. There is no way for a person to put a parcel on a bench.

That is correct as a default — ADR-071, and `product-spec-oms-wave3b-scan-pick-pack.md` § 1.3 / D8,
where the bench list is deliberately **authoritative** (what routing assigned) rather than
**derived** (what looks packable). But three real cases have no answer:

1. **Routing is switched off.** No routing → no works → the bench is permanently empty. The Wave 3b
   spec concedes this in terms: *"the pack bench is not a standalone feature."* That is an adoption
   barrier, not a nuance.
2. **The order routed elsewhere**, and a person wants it packed here anyway.
3. **The order failed to route** — unfulfillable, held at the time, the router declined, or two
   connections claimed A2 and the selection was refused.

### 1.2 The principle, restated because everything below follows from it

**Manual control adds a PRODUCER of work. It never adds a second list.**

A hand-routed parcel appears in the *same* bench list, sorted the same way, obeying the *same*
eligibility gate (Wave 3b B1, D2). The bench does not change and learns nothing new. A person
becomes another way its existing condition — *assigned to this holder, accepted, not closed* —
comes true.

Two sources of truth for "what is on this bench" would recreate exactly the derived-list problem the
authoritative design exists to remove, with the added twist that both would claim to be
authoritative.

### 1.3 Why this is a routing question and not a bench question

#2395 commits **exactly one routing decision per order**, under
`UNIQUE ("orderId") WHERE "state" = 'live'`, in one transaction. A manual route must therefore
**take the decision slot**, not sit beside the router's. Two decisions for one order is a double
shipment: physical, and unrecoverable.

So this belongs with the routing context, and its whole design is the answer to *"what does the
exactly-once gate mean when a person is one of the deciders?"*

### 1.4 What is already true, and easy to misread as missing

Three facts about `main` shape the slice, and two of them are load-bearing:

- **`fulfillment.work.dispatch` has a handler and no producer.** Nothing in the tree enqueues it.
  A `FulfillmentWork` created today therefore stays `unsubmitted` for ever, is never offered to a
  holder, is never accepted, and so **can never satisfy the bench's eligibility rule**. A manual
  route that only created work would be invisible. See M8 — this slice is the job type's first
  producer, for the router's own works as much as for hand-routed ones.
- **A real router EXISTS and is one function body from live.** `libs/oms/src/routing/ol-fulfillment-router.ts`
  ships with its spec and `libs/oms/src/index.ts` barrel-exports `createOlFulfillmentRouter`. What
  is missing is only `resolveFulfillmentRouter`, which still `return`s `null` and whose own header
  says *"#2408/#2409 replace THIS function; nothing else needs touching."* So today every order
  takes case 3 and manual routing is the only way an order reaches a bench — **but the second
  producer is one edit away, not a wave away.** § 5.1 is the whole consequence.
- **`packer` does not exist on `main`.** The role, the bench surfaces and `apps/api/src/bench/`
  arrive with Wave 3b. This spec must therefore *name* the role it excludes without depending on
  it having landed (M14).

### 1.5 The persona

P-D, the enterprise fulfilment operation (Wave 3b § 1.1) — but this slice also serves P-A directly,
and that is its main value: **an operation that wants scanner-verified packing without adopting OMS
routing can have it.** That is the adoption barrier § 1.1 case 1 names, and closing it is worth more
than the two override cases combined.

---

## 2. In-scope stories

`(P9)` marks a story whose acceptance includes the programme-wide naming rule: **authority**,
**posture** and **FulfillmentWork** never appear in anything the operator can see.

### 2.1 Deciding by hand

**R1 — I can send an order to our own bench** *(P9)*
- Given an order that nothing has routed,
- When someone with write access sends it to the in-house bench,
- Then a parcel is created for it, offered to the in-house holder, accepted, and it appears on the
  bench list — indistinguishable there from one a router produced.
- *(M8: "offered and accepted" is not free. Creating the work is not enough.)*

**R2 — the whole order goes, in one parcel**
- Given an order with several lines,
- Then one parcel is created carrying every line not already cancelled, at one location.
- *(Splitting by hand is a non-goal — § 3. A person choosing which lines go where is a routing
  *engine* built out of a form.)*

**R3 — I say where it is being packed from**
- Given more than one location exists,
- Then I choose which, and the parcel records it.
- *(A work carries one location. Guessing it would put stock in the wrong building — M12.)*

**R4 — an order already going out from here is not sent twice, and one half-done is finished**
- Given an order whose parcel is already assigned to the in-house bench,
- When someone sends it to the bench again,
- Then no second parcel is created; if the parcel was accepted the surface says it is already here
  — not an error — and if it was created but never accepted, the action finishes that instead, and
  says the parcel was not on the bench until now.
- *(M6 and M23. The first arm is the double-click and the second operator; the second is the
  recovery path for a request that died between creating the parcel and offering it. Without it,
  the ordinary guard sees a parcel and refuses — so clicking again would refuse rather than help.)*

### 2.2 Taking an order back from somewhere else

**R5 — I can take back an order that routed elsewhere, and say why**
- Given an order routed to another holder that has **not** accepted it,
- When I send it to the in-house bench with a reason,
- Then the other parcel is cancelled, a new decision is recorded as mine, and the parcel appears on
  the bench.
- *(M1. R14's reason is required here as everywhere — but this is the one write in the routing model
  that overturns a decision the system made, so an unexplained one would be unauditable rather than
  merely uncounted.)*

**R6 — an order a holder has already accepted is refused, and I am told what to do instead** *(P9)*
- Given a parcel a 3PL has accepted, or one it has been offered and has not yet answered,
- When I try to send the order to the bench,
- Then it is refused, and the surface says the holder currently has it and that cancellation must be
  requested and agreed first.
- *(M2. Cancelling accepted work is a **negotiation the holder may refuse**, not a command
  — ADR-054's two-axis model. A route that assumed compliance would put the parcel on our bench
  while a 3PL was packing the same goods.)*

**R7 — an order whose routing is still in flight is refused**
- Given a routing decision that is still `live` — a router mid-call, or one whose outcome is
  in doubt,
- Then a manual route is refused and says the system is still deciding.
- *(M3. This is the double-ship the whole table exists to prevent; a person is not exempt from it.)*

### 2.3 What the record says afterwards

**R8 — the record says a person decided, and which person** *(P9)*
- Then the routing record distinguishes *"a rule chose this"* from *"a person chose this"*, names
  the person, and carries their reason where one was required.
- *(M4. These are different facts and the explanation surface will want to say which.)*

**R9 — the parcel itself is anonymous to the bench**
- Then nothing the bench reads distinguishes a hand-routed parcel from a routed one — not its
  ordering, not its eligibility, not its refusals.
- *(§ 1.2. The provenance lives on the routing record, where planning surfaces read it, and not on
  the work, where packing surfaces would.)*

**R10 — re-polling the order does not undo my decision**
- Given an order I routed by hand,
- When the marketplace is polled again and the order re-ingests — which happens routinely,
- Then nothing re-routes it and nothing reverses my decision.
- *(M5.)*

**R11 — a refusal is a sentence, not a status code** *(P9)*
- Given any refusal above,
- Then the operator is told which condition refused them and what would clear it, in their own
  words.
- *(Each refusal in § 2 has a different remedy — wait, request cancellation, create a location,
  configure the OMS. A shared "cannot route" message makes all four unactionable.)*

### 2.4 Who may do it

**R12 — a packer cannot plan** *(P9)*
- Given a session with the packing role,
- When it requests the route-to-bench action,
- Then it is refused.
- *(M14. The bench is a packing surface, not a planning one; the same reasoning that keeps the
  action off the bench keeps it away from the bench's role.)*

### 2.5 Where it appears, and how I say why

**R13 — I find the action where the order's absence of a parcel is already explained** *(P9)*
- Given an order with no fulfilment task,
- Then the surface that already tells me so also offers to send it to the bench,
- And once a task exists, the action lives with the task's other actions rather than beside them.
- *(M21. The order-detail panel already renders "No fulfilment tasks — this order was not routed to
  one" as its settled-and-empty state. That sentence is where an unrouted order is visible at all;
  putting the remedy anywhere else means writing a second explanation of the same absence.)*

**R14 — I say why, from a short list, and may add a sentence** *(P9)*
- Given I am sending an order to the bench,
- Then I choose a reason from a closed list and may add a free-text note,
- And when no listed reason fits, I choose the catch-all and the note becomes required.
- *(M22. The closed value is what makes "how often is the router overridden, and why" answerable;
  the note is what stops a missing member losing the fact.)*

---

## 3. Non-goals

- **Any change to the bench.** Not its list, its ordering, its eligibility rule or its refusals.
- **Expediting.** One flag, one sort key ahead of `dispatchByAt`, shipped in Wave 3b as B5/D22.
- **The action on the bench surface itself** (#2869's own scope note).
- **Splitting an order across locations or holders by hand** (R2).
- **Routing by hand to a 3PL holder.** M13 — "route to *our* bench" is one destination and one
  meaning; "route to any holder" is a routing engine with a person in the loop.
- **Bulk manual routing.** M15.
- **Un-routing** — taking a parcel off the bench without sending it anywhere. The existing work
  cancellation is that, and a second verb for it would be a second answer.
- **Any reversal of a manual decision while its parcel stands.** No sweep, no expiry, no
  "the router knows better now". M5 — the *one* release is an operator cancelling the parcel, which
  is an explicit act and not a reversal the system performs.
- **A `FulfillmentRouter` capability name, or any manifest change.** A2 is `config-only` by design
  (#2393/#2403); this slice adds no adapter and dispatches no capability it did not already.

---

## 4. Open questions

Three earlier questions are now **settled** and have moved into the decision log: whether R5 belongs
in slice 1 (no — § 5.2), what the reason is (**M22**), and where the action appears (**M21**). What
remains:

1. **Whether R3's location choice defaults.** With exactly one active location, offering a choice of
   one is friction; defaulting it silently is the guess M12 refuses. Probably: pre-select and show,
   never hide.
2. **Whether M22's four reason members need a fifth.** They cover #2869's three motivating cases plus
   the catch-all, under the rule that a member names the *state* that made a manual route necessary
   and never the operator's motive. A fifth should be admitted only if it names a state the four
   cannot — and the `other` + note path means guessing wrong costs nothing.

---

## 5. Sequencing and slicing

### 5.1 THE GATE — R7 must exist **before** `resolveFulfillmentRouter` is wired

> **R7 (the live-decision refusal, M3) must be shipped BEFORE the first router is wired.
> Not with it. Before it.**

Three facts make this a gate rather than a preference:

1. **What it prevents is physical and unrecoverable.** Two producers deciding one order is two
   parcels with two carriers. There is no compensating write; the guard is the only mitigation and
   it only works if it is already there.
2. **What arms the hazard is a one-line edit.** `resolveFulfillmentRouter` returns `null` today and
   its header explicitly invites replacement — *"nothing else needs touching"*. That is an
   invitation somebody could accept in an unrelated PR, on a day nobody is thinking about manual
   routing.
3. **The window is invisible while it is open.** With no router, a manual route can never race one,
   so the missing guard is untestable, unreportable and entirely benign — right up to the commit
   that makes it catastrophic. Nothing fails in between to warn anyone.

So the ordering must not be left to inference from a dependency list. **The same gate is recorded on
#2408.** If manual routing ships without R7, the correct response is to block the router wiring, not
to file a follow-up.

Note that R7 is cheap precisely because the machinery exists: it is one predicate over
`findLiveByOrderId`, a read the claim path already performs.

### 5.2 What a first slice should cut, and what it costs

**Cut R5 and R6 — the whole override path — and ship R1–R4 and R7–R14.**

**R7 stays in, deliberately, even though it is unreachable on `main`.** It is the live-decision
refusal (M3), i.e. the double-ship guard itself; it is one predicate over a read the claim already
performs, and a guard that is *cheap*, *permanent* and *protects against a physical, unrecoverable
event* is not one to defer on reachability grounds. R5/R6 are cut because they are **machinery**
with no producer; R7 is a **refusal**, and refusals are what a slice must never ship without.

Reasoning: **case 1 is the only reachable case today** (§ 1.4). Cases 2 and 3 presuppose a router
that routed, or declined to. R5/R6 are the machinery for managing a conflict **between two
producers**, and there is still only one — so they are the ADR-048 decision 1 error of an interface
with no implementer, applied to a guard with nothing to guard.

**This is a cut of MACHINERY, never of a REFUSAL** — which is the whole reason R7 survives it while
R5/R6 do not, and why § 5.1 states its gate separately rather than folding it in here. Deferring
work that manages a conflict is prudent; deferring the refusal that prevents one is not the same
kind of decision and must not be filed under the same heading.

**The implementing PR owes a committed mockup.** This document specifies no surface, so no mockup
belongs *here* — but R14's reason-plus-note dialog and R13's placement in the panel's empty state are
a real surface, and `frontend-architecture.md § UX Mockups` requires a high-fidelity mockup committed
under `docs/plans/mockups/` for a non-trivial feature, with stable `data-state` values the
implementation and E2E tasks cite by name. That obligation is reviewer-enforced — nothing under
`pnpm check:invariants` can observe it — so it is recorded now rather than discovered at review.

What survives the cut still needs M2's and M3's refusals **stated in the spec** — which is why they
are decisions rather than stories cut alongside R5/R6. A slice that ships the happy path without
knowing what it will refuse ships a guard shaped by whatever was convenient.

And the cut is smaller than it looks: **R4 survives it and reads the same negotiation state M2 does**
(*is this work assigned here and accepted?*). So slice 1 already carries the read; what R5/R6 add on
top is the *cancellation of another holder's work*, not the ability to see one. Sizing the slice as
though the negotiation axis were deferred entirely would be wrong.

---

## 6. Decision log

| # | Decision | Reasoning |
|---|---|---|
| **M1** | **A person may override an existing routing decision — but only a TERMINAL one, and only with a reason.** #2869 asks "override, or only decide where none exists?"; the answer is *neither of those two*. | A **committed** decision is already terminal, so the live index is free and `claimIntent` simply succeeds — what blocks a re-route is the `already-routed` guard, which keys on **non-cancelled work**, not on the decision. So an override over a committed decision is: cancel the incumbent work, then claim a fresh decision. **No incumbent decision row is ever mutated**, and no new terminal state is needed for it — #2869 suspects the terminal vocabulary may need a new arm, and it does not. A **live** decision is the opposite case and is refused (M3). The distinction is easy to miss and expensive to get wrong: the two incumbents need two different removals. Two mechanics follow and are named so nobody invents alternatives: the cancellation reuses the shipped closed union's `rerouted` member (`FulfillmentCancellationReasonValues` already carries it — **do not widen a `fulfillment-authority` leaf union for this**), and it carries #2406's `expectedVersion`, because an override is exactly the stale-view case that guard exists for — the operator is acting on a worklist row that may be seconds old, and omitting it silently opts out. |
| **M2** | **A manual route is REFUSED while a holder still has the work.** The safe negotiation states are exactly `unsubmitted`, `rejected` and `cancellation_accepted`; `submitted`, `accepted`, `cancellation_requested` and `cancellation_rejected` all refuse. | ADR-054's two axes exist because cancelling accepted work is a request a holder **may refuse** — a merged axis cannot express *"we asked and they said no"*. So "cancel and re-route" is not a command and must not be modelled as one. `submitted` refuses for #2395's own `leaveInDoubt` reason: the holder may be accepting right now, and OL has no answer either way. `cancellation_rejected` refuses because it is a positive statement that the holder still has it. The remedy is stated to the operator (R6), never taken on their behalf. |
| **M3** | **A `live` routing decision refuses a manual route outright** — no override, no force, no reason text that unlocks it. | This is the exact state #2395's `leaveInDoubt` protects: the router may be committing on its side at this moment. Terminalising it to make room would free the live index, so the next decision mints a new id and therefore a **new idempotency key**, which the vendor cannot dedup against the first call. That is two plans and two shipments. A person clicking a button does not change what the router is doing. The stranded-decision sweep #2395 names as a follow-up is the correct remedy, not a manual escape hatch. |
| **M4** | **Provenance is a `decidedBy` discriminator (`router` \| `operator`) plus a nullable `decidedByUserId`, with `routerConnectionId` becoming nullable — enforced as an XOR CHECK.** Not "a null router connection means manual". | #2869 asks whether it is a column, a reason code or an actor reference. It is a column *and* an actor, and neither alone is sufficient. **Absence must not encode a positive fact** (the #2100 rule): reading `routerConnectionId IS NULL` as "a person decided" would be indistinguishable from a row an older or newer build wrote differently. An actor reference alone is also insufficient — a future service-initiated manual route (an automation action firing this same path) has no user and would then be indistinguishable from a router row. **The discriminator, not the actor column, is the extensible axis**: `'router'` requires `routerConnectionId` and forbids a user; `'operator'` requires a user and forbids a connection; and a future non-human decider takes a **third `decidedBy` value** rather than a null user under `'operator'` — which is what keeps the CHECK a genuine XOR instead of one that has to be relaxed the first time the third case appears. `decidedByUserId` carries **no foreign key**, matching every other reference on this table: an intent record must survive the thing it decided about, and a deleted user must not erase the audit of what they decided. The XOR is the shipped house shape: `CHK_fulfillment_holds_actor`, and ADR-071's `packedByUserId ⊕ packedByService`, both of which exist because a bare nullable column made two different facts look the same. **The port input does NOT gain a nullable field:** `ClaimRoutingIntentInput` becomes a union discriminated on `decidedBy`, so a router route with no router connection cannot type-check. That is the shape `TerminaliseRoutingDecisionInput` already takes one method over, on the rule the port states in its own words — *a choice that does not exist must not be offered*. **The CHECK's full predicate, written here so M19 cannot drift from it** — `CHK_routing_decisions_decider`: <br>`(decidedBy = 'router' AND routerConnectionId IS NOT NULL AND decidedByUserId IS NULL AND reason IS NULL AND note IS NULL)` <br>`OR (decidedBy = 'operator' AND routerConnectionId IS NULL AND decidedByUserId IS NOT NULL AND reason IS NOT NULL)`. <br>The router arm forbids `reason`/`note` rather than merely not requiring them — that is what makes "a router row carries no operator reason" enforceable instead of conventional — and `note` is unconstrained on the operator arm, since M22 makes it required only under `other`, an application rule (see M19). A third `decidedBy` value gets its own arm; there is deliberately no catch-all `ELSE TRUE`, which would silently admit any shape the day one is added. Note also that `RoutingDecision` is barrel-exported, so widening `routerConnectionId` to `string \| null` on the entity is a public source-compatibility change. Nothing in the tree dereferences it — but an **out-of-tree** consumer that does is broken by it, so this belongs in a **release note**, not only in a decision log: the treatment `engineering-standards.md` gives the deprecated `InventoryMasterPort.reserveInventory` / `releaseInventory` methods is the precedent for announcing this class of change on a published contract. |
| **M5** | **Re-ingestion does not reclaim a hand-routed order — and this is already structurally true, so the slice ADDS no stickiness mechanism.** It adds a regression test that says so. | `RoutingCommitService.claimOrResume` skips with `already-routed` whenever any non-cancelled work exists for the order, and a manual route creates exactly that. So the protection is the guard that already ships, and it is *stronger* than a flag would be: it is enforced on the same read every routing attempt already makes, rather than on a column a new code path could forget to consult. A "manual decisions are sticky for ever" flag was considered and rejected — it would strand an order permanently with **no release path**, since cancelling the parcel would then leave the order routable by nobody. **Cancelling the parcel is the deliberate release, and the only one.** That is a real behaviour and belongs in the operator's mental model, not buried. |
| **M6** | **Sending to the bench an order the bench already has, accepted, is a NO-OP SUCCESS — not a refusal.** | M2 refuses when a holder has the work; the in-house bench is a holder, so read literally M2 would refuse this. But the operator's intent — *this parcel should be packed here* — is already satisfied, and answering "refused: a holder has it" about our own bench is both true and useless. This is the double-click and the second operator, and both deserve "it is already here". Correctness is unaffected: no decision is claimed and no work is created either way. |
| **M7** | **The manual path is a distinct method on `IRoutingCommitService` with its OWN narrower outcome type — not a synthetic "manual router" adapter, and not a widening of `RoutingCommitOutcome`.** | A manual-router adapter is superficially elegant (manual routing becomes literally a producer) and wrong in three ways. It would run the plan-conservation check, the holds and unfulfillable refusals, the wall-clock budget and the `Promise.race` machinery over an in-process synchronous decision that crosses no boundary; it would make the **`in-doubt` arm reachable** for a purely local failure, stranding an order for no reason; and it would have to name a `routerConnectionId` whose adapter is not a router — precisely the falsehood M4 exists to prevent. It would also push a person's decision through the ADR-062 plugin PII allowlist for no benefit. The narrower outcome follows the repository's own rule that **a choice that does not exist must not be offered** (`terminalise` takes no `expectedState` for exactly this reason): `in-doubt` cannot occur here, so it must not be an arm. The lock, the guard read, `claimIntent` and the atomic commit are shared verbatim. |
| **M8** | **This slice is the FIRST producer of `fulfillment.work.dispatch`, and must drive the work to `accepted` before it is done.** | Nothing in the tree enqueues that job (§ 1.4). The bench's eligibility rule is *assigned, **accepted**, not closed*, so a manual route that stopped at creating work would produce a parcel nobody can see, and the feature would read as broken on its first use. The OL-OMS executor auto-accepts (#2409), so the handshake terminates immediately — but it must actually run, through `FulfillmentHandshakeService`, so that `assignmentAttempt` is claimed and the idempotency key is minted the one way #2399 permits. **Short-cutting to `requestStatus = 'accepted'` with a direct write is forbidden**: it would mint an acceptance no handshake authored, and the day a second in-house executor exists that write is a lie. It runs **in the same request**, not as an enqueued job (M18): the in-house executor crosses no network, so there is nothing to be asynchronous about, and enqueueing it would make R1 false at the moment it answers — the operator would be told the parcel is on the bench while it was still `unsubmitted`. |
| **M9** | **The manual path MAY abandon its own decision on failure, where the router path may not — and this asymmetry is the point.** A new `RoutingDecisionAbandonReason` member covers it. | `claimIntent` commits **outside** the caller's transaction by design, so a manual commit that fails after claiming leaves a `live` row that blocks the order for ever. For the router that is the correct trade (M3). Here nothing crossed a boundary and no external system can be mid-decision, so the row is safely abandonable, and leaving it live would strand an order for a local database error. The existing reason vocabulary describes *a router that answered and was refused*, so no member of it fits; a new one is required rather than borrowed. `abandonReason` is `varchar(64)` with no enum, so this needs no migration. |
| **M10** | **`decidedBy` lands `NOT NULL DEFAULT 'router'`, with the default dropped in the same migration `up()`.** | Every existing row *is* a router row — `claimIntent` has one caller — so the default is a true statement about history rather than a placeholder. Dropping it in the same `up()` stops it becoming an implicit answer for future inserts, and stops `synchronize` re-adding it and leaving the column unstated-but-present. This is the shipped `shipments.direction` shape (#2373) applied verbatim. The XOR CHECK must be declared **class-level under the same name the migration uses**: the integration harness builds its schema by `synchronize`, so an anonymous constraint mints a hash name there and the two schemas diverge on exactly what `fulfillment-work-migration-parity.int-spec.ts` compares — and `routing_decisions` is already in that spec's scope. |
| **M11** | **The target holder is resolved, never chosen — and zero or several both REFUSE.** | The in-house holder is a connection with `FulfillmentExecutor` enabled on `openlinker.oms.v1`. Zero refuses with the remedy (enable the OMS), because a manual route with nowhere to send it must not create orphan work. Several refuse as ambiguous and pick nothing — the #2047 rule that silence-and-pick-one is forbidden where a wrong pick is a parcel. Offering the operator a holder picker was rejected: it turns "send to our bench" into "route to any holder", which is § 3's excluded feature wearing a different hat. |
| **M12** | **Zero locations refuses, with `POST /inventory/locations/bootstrap` as the named remedy.** | A `FulfillmentWork` carries one location and `inventory_locations` ships empty on every install with nothing seeding it (ADR-058 decision 1). Defaulting `locationId` to `null` would be a work object that names no building — unpickable stock nothing reports. This is #2407's situation exactly, so it takes #2407's exact remedy rather than inventing a second one; a `MAIN` location minted idempotently is one click away. |
| **M13** | **"Route to the in-house bench" is the whole action. There is no destination parameter.** | A destination parameter makes this a routing engine driven by a form, competing with the router rather than complementing it, and re-opens every question the router's plan shape answers (splits, holds, unfulfillable lines). One destination keeps the feature's meaning stable and its refusals enumerable. If hand-routing to a 3PL is ever wanted, it is a different feature with a different risk profile — it crosses a vendor boundary, where this one does not. |
| **M14** | **`@Roles('admin', 'operator')`, and `packer` is excluded — deliberately, and asserted.** | `RolesGuard` denies by default since #2079, so the audience must be declared rather than inherited. The role set is `packer`-excluding for ADR-071 D12's reason: at 1000 orders/day with temporary staff, "every temp can decide where orders are fulfilled from" is not defensible. It is the same reasoning that keeps the *action* off the bench surface, applied to the *role* — and it must be asserted rather than assumed, since the `packer` role does not exist on `main` (§ 1.4), so the assertion arrives with it and this spec states the requirement it will meet. |
| **M15** | **One order per call. No bulk.** | The refusals are per-order and each has a different remedy (M2, M3, M11, M12), so a bulk action's honest result is a per-row outcome table, which is a surface this slice does not have. A bulk action reporting one aggregate number would hide exactly the refusals R11 exists to explain. |
| **M16** | **Provenance is on the routing record, never on the work.** | R9. The bench reads works; planning surfaces read decisions. A `manuallyRouted` flag on `fulfillment_works` would be visible to the bench, and a field visible to a surface is a field that surface eventually branches on — which is how "indistinguishable to the bench" quietly stops being true. |
| **M17** | **The join lives in the app layer, not in core.** | `fulfillment` is a registered zero-sibling-edge leaf with an enforced no-injection invariant (ADR-053): it may not read `orders` for the lines, `integrations` for the holder, or `users` for the actor. Every one of those crosses as an argument, resolved by an app-layer controller — the shape `FulfillmentWorkRouteHandler` and `FulfillmentWorkDispatchHandler` already take, and the shape `apps/api/src/bench/` takes on the Wave 3b branch. A design that needed `fulfillment` to read `orders` would be wrong as designed, not merely inconvenient. |
| **M18** | **The action is synchronous and answers the operator directly; it does not enqueue and report "queued".** | Every refusal in § 2 is knowable at the moment of the request, and R11 requires the operator to be told which one fired. An enqueued action would answer "accepted" and surface the refusal in a job log, which for a person at a screen deciding what to pack next is no answer at all. The handshake that follows the commit is **not** an exception to this — see M8: it crosses no boundary, so it runs inline and R1 is true when the response lands. Nothing in this action is enqueued. |
| **M19** | **The reason gets its OWN columns — a closed `reason` required on MANUAL rows (enforced by M4's CHECK, never a column-level `NOT NULL`) plus a nullable `note` — never `abandonReason`.** | `abandonReason` is the wrong home twice over: it is written only by `terminalise`, and it means *"why OpenLinker refused a router's plan"*. Putting *"why a person chose this"* in the same column merges two unrelated facts and leaves the explanation surface unable to say which it is reading — the failure M4 refuses one column over. **This row originally made the reason nullable, on the argument that one is required only for an override; M22 overturns that.** R14 collects a reason on *every* manual route, and the vocabulary's own first member (`routing-not-enabled`) is a **first-route** reason, not an override one — so a reason is required on every manual row and the earlier "null means this overruled nothing" reading would have been false for the commonest case in the product. **A column-level `NOT NULL` is the wrong mechanism and must not be used**: both columns are necessarily null on a **router** row, so a bare `NOT NULL` would fail every router insert — inside `claimIntent`, the one write #2395 built to be atomic — on a table that already has rows. The requirement is *conditional*, so it belongs in M4's CHECK, whose full predicate is written out there precisely so these two rows cannot drift apart again. The `note` stays nullable because it is genuinely optional except under `other` (M22), which is an application rule rather than a column one — a CHECK tying it to one enum member would have to be rewritten by every future member that also wants a mandatory note. |
| **M20** | **The refusals are named, closed values on the outcome — never a message string the surface parses.** | R11 requires the operator to be told which condition refused them, and there are five with five different remedies (holder has it, still deciding, no holder, several holders, no location). A single "cannot route" plus prose is what makes all five unactionable; prose the frontend *matches on* is worse, because it breaks on the first reword. This is the #2231 rule — the destination declares the reason, the surface renders copy for it — and the closed union is what lets the copy live in one place and a new refusal be a compile error at every render site rather than a silent fallthrough. |
| **M21** | **The action surfaces on BOTH the worklist and order detail wherever a task exists — but it does NOT join `OPERATOR_INVOCABLE_ACTIONS`, and in slice 1 its only home is the order-detail panel's EMPTY STATE.** | `FulfillmentTaskActions` is shared by `fulfillment-worklist-row.tsx` and `order-fulfillment-tasks-panel.tsx`, so an action rendered there costs nothing to surface twice and choosing one surface would mean deliberately suppressing the other. **But that component renders one control per entry of a *task's* `supportedActions`, and manual routing is an ORDER-grain act that exists precisely when there is no task.** So it cannot ride that array in slice 1: there is no work to hang it off, the worklist has no row for an unrouted order, and `OPERATOR_INVOCABLE_ACTIONS` is `satisfies readonly FulfillmentWorkAction[]` — joining it would mean adding a member to a closed union of *work transitions* for something that **creates** work rather than transitioning it. It therefore sits **beside** that set, permanently. Its slice-1 home is the panel's settled-empty branch, which already renders the exact sentence the remedy answers; adding it there is a genuinely free, non-duplicating placement, and the server never has to claim an action is legal on a task that does not exist. Once R5/R6 land, the *override* is a different act on an order that DOES have a task, and that one belongs in the shared component — which is when the both-surfaces-for-free property is actually collected. |
| **M22** | **A closed `reason` AND a free-text `note`, with `other` requiring the note. Four members: `routing-not-enabled`, `routed-elsewhere`, `routing-failed`, `other`.** | This reverses § 4's earlier lean toward free text, because the shipped answer was already in the tree: `fulfillment-task-action-dialog.schema.ts` carries a closed `reason` select plus a `note` capped at `FULFILLMENT_NOTE_MAX_LENGTH`, matched to the DTO's `@MaxLength(1000)`. Closed reasons are also the norm on this very table (`RoutingDecisionAbandonReason`). The objection that a vocabulary invented before use will be wrong is real, and **the note is what defuses it**: a missing member degrades to `other` plus a sentence, never to a lost fact — which is why the note is *required* there rather than merely offered. The four members are the issue's own three motivating cases plus that catch-all, and they follow one rule that should govern any fifth: **each names the STATE of the order that made a manual route necessary, never the operator's motive.** A motive axis (`customer-escalation`, `supervisor-asked`) would overlap every state member and make the aggregate uncountable — and urgency is already D22's expedite, not a routing decision. **`HoldReasonValues` is NOT reused**: a hold reason and a routing reason are two vocabularies at two grains, and merging them is the same defect this spec refuses in M16 and the bench card refuses one line above its own hold label. The dialog gains a mode-specific enum beside the existing one. |
| **M23** | **Commit succeeded, handshake then failed: abandon NOTHING and cancel NOTHING. The decision stands, the work stands at `unsubmitted`, and re-invoking the action RESUMES the handshake.** The response says the parcel is not yet on the bench. | **M9's reasoning does not reach this state and must not be stretched to.** M9 is about a `live` decision left blocking an order forever when the commit transaction fails; here the commit *succeeded*, so the decision is `committed` — terminal, out of the live index, and **true**: the routing decision really was made, and abandoning it would erase a correct record because a later, separate act failed. Cancelling the work is wrong for the same reason: it is the correct product of a correct decision, and discarding it on a transient failure destroys a real routing outcome. The state is reachable rather than theoretical — #2409's executor cannot fail, but `claimDispatchAttempt` is a guarded conditional UPDATE and the request can die between it and `recordAcceptance`, so *"the OL executor cannot fail"* is not *"this path cannot fail"*. What makes leaving it safe is that **the remedy is re-invocation, not repair**: `ClaimFulfillmentDispatchInput.from` already accepts `'unsubmitted'`, so a stranded work is exactly a re-claimable one, and re-running mints a fresh `assignmentAttempt` — harmless here precisely because the in-house executor is stateless and holds no vendor order a second key could duplicate (#2409). So the action gains a **resume arm**, and without it this state would be a trap: the ordinary guard sees non-cancelled work and answers `already-routed`, so an operator clicking again would be refused rather than helped. Resume and M6's no-op are two arms of one rule — *this order's in-house parcel exists*: accepted ⇒ nothing to do, not accepted ⇒ finish the handshake. That is `claimOrResume`'s own shape one grain up. **The response must not claim R1 succeeded**, since the parcel is genuinely not on the bench; it reports a distinct outcome telling the operator to try again, which is honest and actionable, where a bare success would be neither. |

---

## 7. References

- #2869 (this document), #2395 (the routing commit and its exactly-one gate), #2394
  (`routing_decisions`), #2399 (the executor handshake, `assignmentAttempt`), #2409 (the OL-OMS
  executor), #2410 / #2411 (the surfaces), #2407 (the zero-locations refusal and its remedy),
  #2047 (the one-document-per-order precedent this gate copies)
- [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md) — the two axes, and why
  cancellation is a negotiation
- [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md) — the leaf posture and
  the no-injection invariant
- [ADR-071](../architecture/adrs/071-pack-station-principal.md) — packers are ordinary users with a
  narrower role
- [ADR-058](../architecture/adrs/058-multi-location-positions-reservations-availability-authority.md)
  decision 1 — locations are operator-authored and ship empty
- `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` § 1.3, § 1.4, D8, D12, D22
