# Product Spec — OMS Wave 3b: the pack bench

**Status:** draft — context, stories and decision log. Surfaces, copy and mockups follow.
**Epic:** #2422. **Feeds the decision in:** #2080. **Prerequisite:** #2079 (§ 1.5).
**Scope change:** this revision **cuts picking from the wave** (§ 5). Eight epic children become five.

---

## 0. Scope of this document

§ 1 (context), § 2 (stories), § 3 (non-goals), § 4 (open questions), § 5 (what was cut and why),
§ 6 (decision log). No surface, copy or layout is specified yet — where a story would have implied
a control, it stops at the behaviour.

---

## 1. Problem & operator context

### 1.1 Persona — and the change from every prior spec

**P-D, the enterprise fulfilment operation** — ~1000 orders/day, multiple packers per shift
including temporary staff, shared bench terminals, multi-location.

This is **the first OMS spec that does not design for P-A**, the solo/small-team operator that
`product-spec-oms-wave2-operator-experience.md` § 1.2 names as "the *only* persona this spec designs
for". A deliberate widening, recorded rather than absorbed: several shipped decisions were sized
against P-A's volume — ADR-039 rejects a materialised view "at this persona's volume (10–100
orders/day)", and `sync_jobs` carries no retention anywhere in the tree. At 1000 orders/day those
are 10–100× assumptions. **Re-examining them is out of scope here and is not a prerequisite**, but
it is a real consequence of the widening.

P-A is not abandoned. The desktop worklist (#2410) remains their surface, and the order-grain packed
toggle (§ 1.4) remains their packing path.

### 1.2 What the operation has today

- A **desktop worklist** (#2410) and an order-detail fulfilment-task panel (#2411) — pointer-and-
  keyboard surfaces for a seated operator.
- **Order-grain packing**: `POST/DELETE /orders/:id/packed`, stamping `packedAt` +
  `packedByUserId`, first-writer-wins. One fact, asserted by a person or a system.
- **A line-grain vocabulary with no ingress.** `IFulfillmentProgressService` and
  `FulfillmentProgressLineDelta` model per-line progress precisely and shipped in Wave 3a — but
  nothing calls them in production, deliberately, and no HTTP surface exists.
- **Routing and dispatch.** `fulfillment.work.dispatch` already *offers a routed `FulfillmentWork`
  to its assigned holder*. OL already decides who should do the work, and already sends it.
- **Nothing scanner-driven anywhere.**

### 1.3 What this wave is

**The pack bench is the human interface of one holder.**

OL routes a work to a holder and dispatches it. A 3PL holder receives that dispatch through its
adapter; the in-house holder receives it through a screen. Same routing decision, same dispatch,
same progress reported back. The bench is not a special case — it is one executor whose integration
happens to be a person with a scanner.

Two consequences follow, and both are load-bearing:

- **The bench's work list is authoritative, not derived.** It is the set of works routed to this
  holder, accepted, and not yet closed — never a list of orders that merely *look* due. An order OL
  routed to a 3PL never appears on the bench.
- **The bench only has work if routing is on.** No routing → no `fulfillment_works` → an empty
  bench. That is correct rather than a defect: it splits by persona (§ 1.4).

### 1.4 The two packing paths, and who each is for

| | Routing **off** | Routing **on** |
|---|---|---|
| Path | `POST /orders/:id/packed` (shipped) | the pack bench |
| Grain | order | work (one location, one parcel) |
| Verification | none | every item scanned |
| Persona | P-A | P-D |

**This wave does not replace the order-grain toggle**, and an operation that never enables routing
loses nothing. The corollary must be stated wherever this wave is described: **the pack bench is not
a standalone feature.** It is the operator-facing half of OMS routing, and describing it as
"scanner-verified packing" without "and you must be running OMS routing" would misrepresent it.

### 1.5 Prerequisite — #2079, and why it is part of this decision

`RolesGuard.canActivate` returns `true` for any route carrying no `@Roles()` decorator
(`apps/api/src/auth/guards/roles.guard.ts:28`). Measured on `main`: **278 route decorators, 121
without `@Roles`**, ~110 authenticated. The undecorated set includes `customers.controller.ts`
(`@Get()`, `@Get(':id')` — buyer PII), all of `products`, and the `sales-documents` rules surface
including writes. The existing `write-guard-coverage.spec.ts` cannot catch this: it inspects
**non-GET handlers only**, on a hand-listed 23-controller set, so every PII read is outside it by
construction.

Only `operator` holds `orders:write`. A bench terminal, physically accessible to a shift's worth of
staff including temps, would therefore hold a session able to read the entire customer database.

At P-A's scale that was a tolerable adjacency. At P-D's it is not. Story **A5** asserts the property
in this wave's own tests rather than citing #2079's, whose coverage spec inspects no GET handlers.

### 1.6 Why this wave is worth building

With picking outside OL (§ 5) and therefore unverified, **pack-time scanning is the only check
between what was sold and what is in the box.** This is not a packing convenience; it is the sole
quality gate in the chain. That is why the refusals — wrong item, over-pack, ineligible order —
matter more than the happy path, and why they are written as stories in their own right.

---

## 2. In-scope stories

`(P9)` marks a story whose acceptance includes the binding naming rule: **authority**, **posture**
and **FulfillmentWork** never appear in anything the operator can see.

### 2.1 Surface A — the bench and who is at it *(W3b-1, #2413)*

**A1 — I start packing and the system knows it is me**
- Given I am a packer with my own account, at a shared bench terminal,
- When I sign in and pack a parcel,
- Then that parcel's packing is attributed to **my** user id — not to the bench, not to a shift, not
  to whoever configured the terminal.

**A2 — handover is easier than not doing it**
- Given I am signed in and mid-parcel,
- When my replacement takes the bench,
- Then switching user is reachable in one action from the packing surface itself, without returning
  to a general application shell,
- And the incoming packer's first scan is attributed to them,
- And verification progress on an open parcel survives the switch.
- *(Acceptance is comparative: if switching is slower than continuing under the previous packer's
  session, the design has failed regardless of what the surface offers.)*

**A3 — walking away does not leave my identity on the bench**
- Given I stop interacting,
- Then the surface locks after an idle period and no further scan is attributed to me until someone
  signs in,
- And locking never discards verification progress or the work list.

**A4 — I can always see who the system thinks I am**
- Given the packing surface is open,
- Then the signed-in packer's name is visible at all times without opening a menu, in the same
  glance as the item being scanned.

**A5 — a bench terminal cannot wander into customer data** *(prerequisite: #2079)*
- Given a session signed in at a bench with the role packing requires,
- When it requests a route unrelated to fulfilment — the customer list, a customer record, the
  sales-document rules surface,
- Then it is refused.

### 2.2 Surface B — the work list *(W3b-3, #2416)*

**B1 — I see the work that was routed to us, and only that** *(P9)*
- Given orders routed across several holders,
- Then the bench lists only work assigned to this holder, accepted and not yet closed,
- And an order routed elsewhere never appears.

**B2 — the list tells me what is urgent, and never what is ready**
- Given work with differing dispatch deadlines,
- Then the list is ordered by urgency and states deadlines in plain words ("due today", "breaching
  in 2h"),
- And it **never** states or implies that stock has been picked or gathered.
- *(OL cannot see a shelf. A surface that implies readiness it does not have sends a packer to fetch
  something that is not there, and after that happens twice the list is not trusted again.)*

**B3 — the list says why it is empty**
- Given no work is assigned to this holder,
- Then the surface distinguishes "nothing to pack right now" from "routing is not switched on, so
  this bench will never receive work", and in the latter case says what to do about it.

**B4 — state is legible at a glance** *(P9)*
- Given work in mixed states,
- Then state is carried by colour and position as well as by text, and never by colour alone.

### 2.3 Surface C — scanner-first operation *(W3b-3, #2416)*

**C1 — the verification loop is scanner-only**
- Given a bench with a scanner and no practical keyboard or mouse access,
- Then every step of verifying and committing a parcel is reachable by scanning,
- And no step requires pointing at a target smaller than a gloved fingertip.
- *(**Opening** a parcel is explicitly exempt — see § 4 Q1. OL prints no barcode today, so there is
  nothing to scan to identify a tote. The value is in verifying items, not in opening.)*

**C2 — nothing to mis-tap into**
- Given the packing surface is open,
- Then it occupies the full viewport with no global navigation and no links out of the flow, and
  leaving requires a deliberate action.

**C3 — an unrecognised scan is reported, never swallowed**
- Given I scan something matching no expected item or command,
- Then the surface says so immediately and distinctly, and records nothing.
- *(A scan that silently does nothing is indistinguishable from a scanner failure.)*

**C4 — usable in the physical conditions of a floor** *(W3b-8, #2421)*
- Given glare, gloves, one hand occupied, a bench-height screen,
- Then targets, contrast and feedback are sized for that, and every state change that matters is
  signalled by more than colour.

### 2.4 Surface D — opening a parcel *(W3b-5, #2418)*

**D1 — I open the parcel in front of me**
- Given I have a physical tote at the bench,
- When I identify it to the surface,
- Then that work opens, showing what must go in the box.

**D2 — an order I must not pack is refused, with the reason** *(P9)*
- Given the work is held, its order cancelled, or it is otherwise not packable,
- When I open it,
- Then the surface refuses and says why in plain words,
- And the refusal uses the **same** eligibility rule as the list, so the two can never disagree.
- *(State moves after dispatch: an order held or cancelled between dispatch and the tote reaching
  the bench must still be refused.)*

**D3 — a split order is unambiguous**
- Given an order routed across two locations, and therefore two parcels,
- Then the surface is explicit about which parcel this is, and never presents one parcel's contents
  as the whole order.

### 2.5 Surface E — verification and commit *(W3b-5, #2418)*

**E1 — every item is verified into the box**
- Given an open parcel,
- When I scan each item,
- Then each unit is checked against the work's lines and recorded.

**E2 — the wrong item is refused, and tells me why**
- Given I scan an item this parcel does not expect,
- Then the surface refuses it, names what it expected and what it got, and records nothing.

**E3 — over-packing is caught at the moment it happens**
- Given a line requiring 2 units,
- When I scan a third,
- Then the surface refuses the extra unit, signals it distinctly (visually and audibly), and the
  recorded quantity never exceeds what the line requires.

**E4 — I can undo my last action without abandoning the parcel**
- Given I have just recorded a scan in error,
- When I undo,
- Then it is reversed, the audit trail retains that it happened and was reversed, and my place in
  the parcel is unchanged.

**E5 — committing is deliberate**
- Given a fully verified parcel,
- When I commit,
- Then the commit requires an action a stray scan or tap cannot trigger.

**E6 — a parcel that is not ready cannot be committed**
- Given lines unverified or short,
- When I attempt to commit,
- Then the surface refuses and names precisely which lines are outstanding.

**E7 — the label is produced without leaving the flow**
- Given a committed parcel,
- Then its shipping label is produced and handed off for printing without navigating away, and a
  failure to produce it is reported at the bench, not only in a log.

### 2.6 Surface F — what reaches the rest of the system *(W3b-7, #2420)*

**F1 — who packed it is always answerable**
- Given a committed parcel,
- Then the work records **either** the packer's user id **or** the service that packed it, exactly
  one of the two,
- *(Mirroring `CHK_fulfillment_holds_actor`. A bare nullable column would make "a 3PL packed this"
  and "a human packed it and we lost who" look identical.)*

**F2 — the order still has one answer**
- Given an order whose parcels are packed,
- Then the order-level packed fact follows from the works — one fact, derived, never a rival to the
  per-parcel detail underneath it,
- And a single-parcel order behaves exactly as it does today.

**F3 — a scan recorded once is recorded once**
- Given the network retries, the tablet sleeps mid-request, or I scan the same unit twice by reflex,
- Then one physical action is recorded exactly once,
- And a **legitimate** second scan — the second unit of a two-unit line — is recorded as a second
  unit, not swallowed as a duplicate.
- *(#2080's idempotency question. A deterministic id under-packs the order; a per-gesture id must
  survive a retry and a reload.)*

**F4 — the bench and the worklist never disagree**
- Given work in progress at a bench,
- When someone views it on the desktop worklist (#2410),
- Then they see the same state, and an action in one surface is reflected in the other rather than
  producing a stale-token conflict the operator must resolve.

### 2.7 Surface G — behaviour under failure *(W3b-8, #2421)*

**G1 — a network blip does not cost me my work**
- Given the connection drops mid-shift,
- Then scans already recorded are not lost, the surface says plainly that it is offline, and it does
  not accept work it cannot record while pretending otherwise.

**G2 — the surface never claims a state it has not confirmed**
- Given a slow or failed write,
- Then a line does not display as verified until the system has accepted it, and the operator is
  never left unable to tell whether their last scan counted.

**G3 — I am told when I am looking at something out of date**
- Given the work I hold changed underneath me — cancelled, re-routed, closed elsewhere,
- Then the surface says what changed and what to do, rather than simply refusing my next action.

---

## 3. Non-goals

- **Picking** — see § 5.
- **Assigning parcels to specific benches.** The list is what routing assigned to this *holder*;
  physical possession settles who packs it. No claims, no locks, no double-pickup machinery.
- **A station/device principal, PIN or badge** (§ 6, D2).
- **Location topology or bin codes** (§ 5).
- **Replacing the order-grain packed toggle** (§ 1.4).
- **Putting right the P-A-sized decisions** named in § 1.1.
- **Wave 4 hardening** — `W4-1`/`W4-2`, and the `pending {decisionId}` routing arm (`W4-3`).

---

## 4. Open product questions (for the owner)

1. **How does the packer identify the parcel?** Typed/searched order number (cheap, breaks
   scanner-only for one step) versus OL printing a slip with a scannable work id (fully
   scanner-driven, but document generation is a wave of its own — and it is the artifact a WMS would
   later replace with its own tote label). **Recommendation: typed for now.**
2. **Is the persona widening programme-wide, or only this wave?** § 1.1 assumes only this wave.
3. **Is there named demand**, or is this a strategic bet? The Wave 2 spec declared its bet honestly;
   this one should too, either way.
4. **A3's idle lock and A4's always-visible name cost screen area and interruptions.** Both are
   safety rails for mis-attribution; your call on whether the floor will tolerate them.

---

## 5. What was cut from this wave, and why

**Picking is deferred to the future WMS.** Cut: **W3b-2** (#2414, pick-list generation +
`oms_pick_*`), **W3b-4** (#2417, the pick flow), **W3b-6** (#2419, `short_picked` +
`releaseShortfall` re-sourcing). Surviving: W3b-1, W3b-3, W3b-5, W3b-7, W3b-8.

Reasoning: a WMS owns pick lists, location topology and walk order. Building a stopgap now — a
free-text bin code, an OL-owned pick list — creates data the WMS must later reconcile or migrate,
and operator-maintained location strings acquire years of inconsistent convention before the real
system arrives to inherit them. This also honours ADR-048 decision 1's principle (no interface
without an implementer), applied to data: no field whose owner does not exist yet.

**Consequences, stated so they are not discovered later:**

- **The re-route intent stays unconsumed.** `FulfillmentProgressService.apply()`'s `short_picked`
  arm emits a `{kind:'reroute'}` intent that nothing in the tree acts on. Tolerable **only** because
  nothing can *produce* a short-pick until picking exists — but whoever builds the WMS inherits this
  and must be told.
- **DESIGN § 5.4's re-source loop remains unexercised.** It is specified, and it ships untested by
  any real path.
- **Walking is unoptimised.** OL has no intra-location topology (`inventory_locations` carries
  postcode and lat/long — a site address, not a shelf), so nothing orders a walk. At 1000 orders/day
  that is real, recurring cost, and it arrives with the WMS rather than with this wave.

---

## 6. Decision log

| # | Decision | Reasoning |
|---|---|---|
| D1 | Attribution serves **dispute resolution** — usually right, wrong attribution embarrassing but recoverable. Not coaching (too weak to justify the rails), not shrinkage (unreachable on a shared terminal without a per-action credential, and claiming it would be false). | § 2.1 A2–A4 earn their cost; re-auth-per-commit stays out. |
| D2 | **Every packer has an account; the bench is a device label, not a principal.** | Removes a fifth credential entity in `libs/core/src/users`, its enrolment/rotation/lockout, and a bearer token in shared browser storage. Cost: the failure mode becomes mis-attribution, which A2–A4 exist to make expensive. Answers #2080. |
| D3 | **#2079 is a prerequisite, not a neighbour.** | Choosing the ordinary session forfeits the protection a dedicated verifier had — it populates `req.auth`, which no guard reads, so such a token cannot reach an undecorated route at all. An ordinary session inherits the whole app. |
| D4 | Attribution grain is **per work, per phase**; the order-grain fact is **derived**. | An order can split into several works, so an order-grain person fact names one packer and drops the other. Matches the shipped invariant: "one fact… line-level data is a detail ledger underneath it, never a rival". |
| D5 | The actor is an **XOR** (`packedByUserId` ⊕ `packedByService`), mirroring `CHK_fulfillment_holds_actor`. | A bare nullable column makes "a 3PL packed this" and "a human packed it, unrecorded" indistinguishable. The constraint makes the ambiguous state unrepresentable. |
| D6 | **No actor on `FulfillmentProgressEvent`.** The seam stays connection-attributed. | Otherwise every 3PL adapter carries a field only our own bench can populate, and a permanently-`null` field is later read as "unattributed" rather than "not applicable". |
| D7 | **Picking deferred to the WMS** (§ 5). | |
| D8 | **The bench is a holder's interface**, and its list is routing's dispatch — not a queue computed from deadlines. | `fulfillment.work.dispatch` already offers routed work to its holder. A deadline-derived list would be a second, weaker answer beside an authoritative one, and would show work routed to a 3PL. |
| D9 | **No pick lists, claims or double-pickup machinery.** | Those were picking concerns. Physical possession settles who packs a parcel. |
| D10 | **Scanner-only applies to the verification loop, not to opening.** | OL prints no barcode and mints no scannable parcel identity; `externalWorkId` is the holder's own reference and is null for the in-house executor. See § 4 Q1. |
| D11 | **The list never claims readiness.** | Nothing reports picking, so `fulfilled_quantity` stays 0 and readiness is structurally unknowable. Implying it sends a packer to an empty shelf. |
