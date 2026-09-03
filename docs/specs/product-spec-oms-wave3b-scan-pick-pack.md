# Product Spec — OMS Wave 3b: the scan/pick/pack surface

**Status:** draft — stories only. Surfaces, copy, mockups and the decision log follow.
**Epic:** #2422 (`W3b-1` … `W3b-8`). **Feeds the decision in:** #2080.
**Prerequisite:** #2079 (see § 1.4 — this is load-bearing, not adjacent cleanup).

---

## 0. Scope of this document

This revision contains **§ 1 (context) and § 2 (the in-scope stories) only**. It exists to be
argued with before any surface is designed: the stories are written so that answering them settles
#2080's open questions, rather than restating them.

Everything a story does **not** say is deliberate. Where a story would have implied a control, a
copy string or a layout, it stops at the behaviour — those belong in the surface sections, which
are not written yet.

---

## 1. Problem & operator context

### 1.1 Persona — and the change from every prior spec

**P-D, the enterprise fulfilment operation** — ~1000 orders/day, multiple packers per shift
including temporary staff, shared bench terminals, batch picking and packing.

This is **the first OMS spec that does not design for P-A** (the solo/small-team operator that
`product-spec-oms-wave2-operator-experience.md` § 1.2 names as "the *only* persona this spec
designs for"). That is a deliberate widening and it must be stated rather than absorbed silently,
because several shipped decisions were sized against P-A's volume — ADR-039 rejects a materialised
view "at this persona's volume (10–100 orders/day)", and `sync_jobs` carries no retention anywhere
in the tree. At 1000 orders/day those are 10–100× assumptions. **Re-examining them is out of scope
here and is not a prerequisite for this wave**, but it is a real consequence of the widening and is
recorded so the next person does not discover it by surprise.

P-A is not abandoned: the desktop worklist shipped in Wave 3a (#2410) remains their surface, and
nothing in this wave removes or degrades it.

### 1.2 What the operation has today

- A **desktop worklist** (#2410) with manual mark-picked / mark-shipped at *work* grain, and an
  order-detail fulfilment-task panel (#2411). Both are pointer-and-keyboard surfaces built for a
  seated operator.
- **Order-grain packing**: `POST/DELETE /orders/:id/packed`, stamping `packedAt` +
  `packedByUserId`, first-writer-wins. One fact, asserted by a person or a system.
- **A line-grain vocabulary with no ingress.** `IFulfillmentProgressService` and
  `FulfillmentProgressLineDelta` model per-line pick/pack precisely and shipped in Wave 3a — but
  nothing calls them in production, deliberately, and no HTTP surface exists. **This wave supplies
  the ingress, not the seam.**
- **Nothing scanner-driven anywhere**, and no concept of a bench, a shift or a pick list.

### 1.3 The decision this spec assumes (#2080)

**Every packer has their own account. The bench is a device label, not a principal.**

Consequences taken deliberately:

- **No station token, no PIN, no badge.** No fifth credential entity in `libs/core/src/users`, no
  enrolment/rotation/lockout, no brute-force surface at a bench endpoint, no bearer token in shared
  browser storage.
- **Attribution is a real user id**, consistent with `packedByUserId` as already shipped.
- **The problem moves rather than disappearing**: on a shared bench the failure mode becomes
  *mis-attribution* — packer A does not log out, packer B scans, and B's work is recorded as A's.
  That is the exact accountability this decision exists to serve, silently wrong. Stories **A2–A4**
  exist to make that failure expensive to reach, and they are the stories that must earn their keep.
- **This choice gives up a protection the rejected option had.** A dedicated verifier (the MCP
  pattern) populates `req.auth`, which no guard or controller reads, so such a token cannot reach an
  undecorated route at all. An ordinary session inherits the whole app instead — see § 1.4.

### 1.4 Prerequisite — #2079, and why it is part of this decision

`RolesGuard.canActivate` returns `true` for any route carrying no `@Roles()` decorator
(`apps/api/src/auth/guards/roles.guard.ts:28`). Measured on `main`: **278 route decorators, 121
without `@Roles`**, ~110 of them authenticated. The undecorated set includes
`customers.controller.ts` (`@Get()`, `@Get(':id')` — buyer PII), all of `products`, and the
`sales-documents` rules surface including writes. The existing `write-guard-coverage.spec.ts`
cannot catch this: it inspects **non-GET handlers only**, on a hand-listed 23-controller set, so
every PII read is outside it by construction.

Only `operator` holds `orders:write`. So a bench terminal, physically accessible to a shift's worth
of staff including temps, would hold a session able to read the entire customer database.

**At P-A's scale that was a tolerable adjacency. At P-D's it is not.** #2079 is therefore a
prerequisite of this wave, not a neighbour of it, and story **A5** asserts the property rather than
assuming someone else's issue delivered it.

---

## 2. In-scope stories

Story ids are stable. Each names the epic child it serves. `(P9)` marks a story whose acceptance
includes the binding naming rule: the words **authority**, **posture** and **FulfillmentWork** never
appear in anything the operator can see.

### 2.1 Surface A — the bench and who is at it *(W3b-1, #2413)*

**A1 — I start packing and the system knows it is me**
- Given I am a packer with my own account, at a shared bench terminal,
- When I open the packing surface and sign in,
- Then every pick, pack and short-pick I record from this point is attributed to **my** user id,
  by the same mechanism that stamps `packedByUserId` today — not to the bench, not to a shift, and
  not to whoever configured the terminal.

**A2 — I hand over to the next packer, and the handover is easier than not doing it**
- Given I am signed in and mid-batch,
- When my replacement takes the bench,
- Then switching user is reachable in one action from the packing surface itself, without returning
  to a general application shell,
- And the incoming packer's first scan is attributed to them, not to me,
- And any partially-picked work is preserved across the switch rather than discarded.
- *(Acceptance is comparative, not absolute: if switching is slower than continuing under the
  previous packer's session, the design has failed regardless of what the surface offers.)*

**A3 — walking away does not leave my identity on the bench**
- Given I am signed in at a bench and stop interacting,
- When an idle period elapses,
- Then the surface locks and no further scan is attributed to me until someone signs in,
- And locking never discards recorded progress or the queue's position.

**A4 — I can always see who the system thinks I am**
- Given the packing surface is open,
- Then the signed-in packer's name is visible at all times without opening a menu,
- And it is visible in the same glance as the item being scanned — not in a corner the operator
  never looks at while working.

**A5 — a bench terminal cannot wander into customer data** *(prerequisite: #2079)*
- Given a session signed in on a bench terminal with the role packing requires,
- When that session requests a route unrelated to fulfilment — the customer list, a customer record,
  the sales-document rules surface,
- Then it is refused.
- *(Asserted here, in this wave's tests, rather than assumed from #2079's own coverage: the property
  this wave depends on is "a packing session is confined", and a spec that only cites another
  issue's fix inherits that issue's blind spots — its current guard-coverage spec does not inspect
  GET handlers at all.)*

### 2.2 Surface B — the work queue *(W3b-2 #2414, W3b-3 #2416)*

**B1 — I am given a batch to pick, not one order at a time**
- Given picking work exists for my location,
- When I begin,
- Then I receive a **queue** of orders as one unit of work, and the surface shows my position in it
  (how many done, how many remain).
- *(This is the `packGrain` question answered: the grain is the batch. A surface built around a
  single current order cannot express the queue an operation at this volume actually works in.)*

**B2 — the pick list is ordered for the walk, not for the database**
- Given a batch spanning several storage locations,
- Then the pick list is ordered so the locations form a sensible route,
- And the order of lines within a location is stable between reloads.

**B3 — I can set an order aside without losing it**
- Given an order in my queue that I cannot complete now (damaged stock, blocked aisle, missing item
  I have not yet confirmed short),
- When I set it aside,
- Then it leaves my queue, remains visible as needing attention elsewhere, and is not silently
  reassigned to nobody.

**B4 — the queue tells me its state at a glance** *(P9)*
- Given a queue of orders in mixed states,
- Then each order's state is legible without reading text — colour and position carry it — and the
  same state is also available as text for accessibility.
- *(Colour-as-state, per the competitive bar: white → in progress → done → over-picked.)*

### 2.3 Surface C — scanner-first operation *(W3b-3, #2416)*

**C1 — I can work the whole flow with a scanner and nothing else**
- Given a bench with a barcode scanner and no practical keyboard or mouse access,
- When I pick, verify, pack and commit an order,
- Then every step in the normal path is reachable by scanning — including the commit action —
  and no step requires pointing at a target smaller than a gloved fingertip.

**C2 — the surface does not offer me anything I can mis-tap into**
- Given the packing surface is open,
- Then it occupies the full viewport with no global navigation, no module rail and no links out of
  the flow,
- And leaving requires a deliberate action, not a stray tap.

**C3 — a barcode the system does not recognise is reported, never swallowed**
- Given I scan something that matches no expected item, location or command,
- Then the surface says so immediately and distinctly, and records nothing.
- *(A scan that silently does nothing is indistinguishable from a scanner failure, and at volume the
  operator will not notice which it was.)*

**C4 — the surface is usable in the physical conditions of a floor** *(W3b-8, #2421)*
- Given glare, gloves, one hand occupied and a bench-height screen,
- Then targets, contrast and feedback are sized for that, and every state change that matters is
  signalled by more than colour alone.

### 2.4 Surface D — the pick flow *(W3b-4 #2417, W3b-2 #2414)*

**D1 — scan location, scan item, confirm quantity**
- Given a pick list line at a location,
- When I scan the location, then the item, then confirm the quantity,
- Then the line is recorded picked, and the surface advances to the next line without further input.

**D2 — the wrong item is refused, and tells me why**
- Given I scan an item that is not the one this line expects,
- Then the surface refuses it, names what it expected and what it got, and records nothing.

**D3 — over-picking is caught at the moment it happens**
- Given a line requiring 2 units,
- When I scan a third,
- Then the surface refuses the extra unit, signals it distinctly (visually and audibly), and the
  recorded quantity never exceeds what the line requires.

**D4 — I can undo my last action without abandoning the order**
- Given I have just recorded a pick in error,
- When I undo,
- Then that pick is reversed, the audit trail retains that it happened and was reversed, and my
  position in the batch is unchanged.

**D5 — my progress survives the bench**
- Given I have picked part of an order,
- When the tablet sleeps, the page reloads, or the network drops and returns,
- Then my recorded progress is intact and the surface resumes where I was — not at the start of the
  order, and not with my scans lost.

### 2.5 Surface E — short pick and re-sourcing *(W3b-6, #2419)*

*Backend semantics are specified in DESIGN § 5.4 and are not restated here; these stories cover the
operator-facing half only.*

**E1 — I report that the stock is not there** *(P9)*
- Given a line I cannot fill, or can only partly fill,
- When I report the shortfall and the quantity I actually have,
- Then the picked portion stays picked, the shortfall is recorded as a distinct outcome from
  "not yet picked", and I am not asked to keep looking.

**E2 — a shortfall goes somewhere, and I can see that it did**
- Given I report a shortfall,
- Then the surface tells me what happens next in plain words — that the missing units are being
  sourced elsewhere, or that they cannot be,
- And it never reports success for a shortfall that was recorded but not acted on.
- *(This is the story that closes a known gap: today `FulfillmentProgressService.apply()`'s
  `short_picked` arm emits a re-route intent that nothing consumes.)*

**E3 — the location that could not fill it is not asked again**
- Given a shortfall re-sourced to another location,
- Then the location that reported the shortfall is excluded from the new decision,
- And the loop terminates — a shortfall cannot circle back to the same place.

**E4 — a cancelled order is not re-sourced**
- Given an order cancelled while I was picking it,
- When I report a shortfall on it,
- Then no re-sourcing occurs, and the surface tells me the order is cancelled rather than failing
  silently or appearing to succeed.

### 2.6 Surface F — pack, commit and ship *(W3b-5, #2418)*

**F1 — packing verifies what actually goes in the box**
- Given a picked order at the pack bench,
- When I scan each item into the box,
- Then each unit is verified against the order's lines, and the same refusal and over-pack rules as
  picking apply.

**F2 — committing is deliberate**
- Given a fully packed order,
- When I commit it,
- Then the commit requires an action that cannot fire from a stray scan or tap,
- And the order-level packed fact follows from the lines — one fact, derived, never a rival to the
  line data underneath it.

**F3 — the label is produced without leaving the flow**
- Given a committed order,
- Then its shipping label is produced and handed off for printing without navigating away from the
  packing surface, and a failure to produce it is reported at the bench, not only in a log.

**F4 — an order that is not ready cannot be committed**
- Given an order with lines unpicked, short, or unverified,
- When I attempt to commit,
- Then the surface refuses and names precisely which lines are outstanding.

### 2.7 Surface G — progress reaches the rest of the system *(W3b-7, #2420)*

**G1 — what I scan becomes the order's history**
- Given I pick, short-pick and pack an order,
- Then each of those is recorded through the existing progress seam, attributed to me, and visible
  on the order's own timeline to someone who was never at the bench.

**G2 — a scan recorded once is recorded once**
- Given the network retries, the tablet sleeps mid-request, or I scan the same unit twice by reflex,
- Then a single physical action is recorded exactly once,
- And a **legitimate** second scan — the second unit of a two-unit line — is recorded as a second
  unit, not swallowed as a duplicate.
- *(This is #2080's idempotency question, and the distinction is the whole difference: a
  deterministic id under-packs the order; a per-gesture id must survive a retry and a reload.)*

**G3 — the desktop worklist and the bench never disagree**
- Given work in progress at a bench,
- When someone views the same work on the desktop worklist (#2410),
- Then they see the same state, and an action taken in one surface is reflected in the other rather
  than producing a stale-token conflict the operator has to resolve.

### 2.8 Surface H — floor-grade behaviour under failure *(W3b-8, #2421)*

**H1 — a network blip does not cost me my work**
- Given the connection drops mid-shift,
- Then scans already recorded are not lost, the surface says plainly that it is offline, and it does
  not accept work it cannot record while pretending otherwise.

**H2 — the surface never claims a state it has not confirmed**
- Given a slow or failed write,
- Then the line does not display as picked until the system has accepted it,
- And the operator is never left unable to tell whether their last scan counted.

**H3 — I am told when I am looking at something out of date**
- Given the work I hold has changed underneath me — cancelled, re-routed, picked by someone else,
- Then the surface tells me, in words, what changed and what I should do, and does not simply refuse
  my next action.

---

## 3. Explicitly out of scope

Stated so silence is not read as oversight.

- **A station/device principal, PIN or badge credential.** Ruled out by § 1.3; a shared-credential
  bench is not built, and the seams to add one later are not pre-built either.
- **Putting right the P-A-sized decisions** named in § 1.1 (ADR-039's materialised-view rejection,
  `sync_jobs` retention). Real consequences of the persona widening; not this wave's work.
- **Hardware**: scanner models, label printers, bench photography.
- **Wave 4 hardening** — per-method error unions, wall-clock budgets, declared `maxBatchSize`,
  order-freshness token (`W4-1`/`W4-2`), and consuming the `pending {decisionId}` routing arm
  (`W4-3`).
- **Replacing the desktop worklist.** #2410 remains, and remains P-A's surface.

---

## 4. Open product questions (for the owner)

1. **Is the persona widening programme-wide, or only this wave?** § 1.1 assumes only this wave.
2. **Is there a named seller asking for this**, or is it a strategic bet? The Wave 2 spec declared
   its own bet honestly; this one should too, either way.
3. **Pick and pack: one bench or two?** The stories keep them separable (D vs F) without deciding.
4. **A4's "always visible packer name" and A3's idle lock have a cost in screen area and in
   interruptions.** Both are proposed as safety rails for mis-attribution; they need your judgement
   on whether the operation will tolerate them.
5. **Does the operation need per-*person* attribution at all**, or is per-shift enough? The whole of
   § 1.3 turns on this. If per-shift is enough, A1–A4 shrink dramatically.
