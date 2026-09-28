# Product Spec — OMS Wave 3b: the pack bench

**Status:** draft — context, stories, decision log. Surfaces, copy and mockups follow.
**Epic:** #2422. **Feeds the decision in:** #2080. **Prerequisite:** #2079 (§ 1.6).
**Scope:** picking is **cut** from this wave (§ 5). Eight epic children become five.

---

## 0. Scope of this document

§ 1 context · § 2 stories · § 3 non-goals · § 4 open questions · § 5 what was cut · § 6 decision log.
No surface, copy or layout is specified yet; where a story would imply a control, it stops at the
behaviour.

The decision log (§ 6) is the substantive part. Twenty-two decisions, each with its reasoning, and
several of them reverse an earlier draft of this document.

---

## 1. Problem & operator context

### 1.1 The persona changes — programme-wide

**P-D, the enterprise fulfilment operation** — ~1000 orders/day, multiple packers per shift
including temporary staff, shared roaming bench terminals, multi-location.

**This is a programme-wide reorientation, not a per-wave exception.** Every prior OMS spec names
P-A, the solo/small-team operator, as "the *only* persona this spec designs for"
(`product-spec-oms-wave2-operator-experience.md` § 1.2). That is now superseded.

The consequence is not confined to this wave, and must not be recorded as if it were: several
shipped decisions were **sized against P-A's volume** and are now serving a persona 10–100× larger.

- **ADR-039** rejects a materialised view for order analytics on the stated grounds that "This
  persona's volume (10–100 orders/day) means the total corpus is small for years". At 1000/day that
  premise no longer holds.
- **`sync_jobs` carries no retention anywhere in the tree.** At P-A's volume that was tolerable; at
  P-D's, on a connection taking sweep children every twenty minutes, it is millions of rows a year.
- Lane caps, sweep budgets and page sizes were tuned against P-A-shaped load.

**None of that is a prerequisite for this wave**, and this spec does not attempt it. But it is now
**live technical debt against a stated persona** rather than a hypothetical, and it should be tracked
as such rather than rediscovered when something is slow.

P-A is not abandoned: the desktop worklist (#2410) and the order-grain packed toggle (§ 1.4) remain,
and nothing here removes or degrades them.

### 1.2 The bet, stated honestly

**No named seller has asked for this.** It is a strategic bet, in the same sense and stated in the
same terms as the Wave 2 spec's automation builder: the competitive evidence is strong — BaseLinker,
Linnworks, ShipStation, Peoplevox, Apilo and Sellasist all ship a scanner-driven pack bench, and
Sellasist markets the absence of a click as a headline feature — but that is a *market signal*, not
demand from an OpenLinker user.

Gate this document on whether that bet is accepted. A ~10k-line frontend epic for a persona no prior
OpenLinker surface has served is a large wager on a signal rather than a request.

### 1.3 What this wave is

**The pack bench is the human interface of one holder.**

OL routes a work to a holder and dispatches it (`fulfillment.work.dispatch` — *"offer a routed
`FulfillmentWork` to its assigned holder"*). A 3PL holder receives that dispatch through its
adapter; the in-house holder receives it through a screen. Same routing decision, same dispatch, same
progress seam back. The bench is not a special case — it is one executor whose integration happens to
be a person with a scanner.

Two consequences, both load-bearing:

- **The work list is authoritative, not derived.** It is what routing assigned to this holder,
  accepted and not yet closed — never a list of orders that merely look due. An order routed to a
  3PL never appears on the bench.
- **The bench only has work if routing is on.** No routing → no `fulfillment_works` → an empty
  bench. Correct, and it splits by persona (§ 1.4).

### 1.4 The two packing paths

| | Routing **off** | Routing **on** |
|---|---|---|
| Path | `POST /orders/:id/packed` (shipped) | the pack bench |
| Grain | order | work — one location, one parcel |
| Verification | none | every item scanned |
| Persona | P-A | P-D |

**This wave does not replace the order-grain toggle.** And the corollary must appear wherever this
wave is described: **the pack bench is not a standalone feature.** It is the operator-facing half of
OMS routing. Describing it as "scanner-verified packing" without "and you must be running OMS
routing" would misrepresent it.

### 1.5 Why it is worth building

With picking outside OL (§ 5) and therefore unverified, **pack-time scanning is the only check
between what was sold and what is in the box.** Not a convenience — the sole quality gate in the
chain. That is why the refusals are stories in their own right rather than trimmings on a happy path.

**How strong that check actually is, stated here rather than left to be inferred.** It reliably
catches the **wrong item** (E2). It catches the **wrong count** only to the degree each physical unit
is scanned once — no product in the field can tell two units from one unit scanned twice (§ 3), and
D20 permits a line to be hand-confirmed indistinguishably from a scan. So the gate is real and worth
building, and it is not a guarantee. "Scanner-verified" must not be read as "verified".

### 1.6 Prerequisite — #2079

`RolesGuard.canActivate` returns `true` for any route with no `@Roles()` decorator
(`roles.guard.ts:28`). Measured on `main` at `0470542e0`: **~280 route decorators, ~121 without
`@Roles`**, ~110 authenticated — the figure drifts as routes land, so it is the proportion that
matters, not the integer. The undecorated set includes `customers.controller.ts` (`@Get()`, `@Get(':id')` —
buyer PII), all of `products`, and the `sales-documents` rules surface including writes. The existing
`write-guard-coverage.spec.ts` cannot catch it: **non-GET handlers only**, on a hand-listed
23-controller set, so every PII read is outside it by construction.

Because packers are ordinary users (D2) and the bench is not a principal, **the bench cannot be
restricted differently from any other session unless the role is narrower**. D12 introduces a
`packer` role — and a role only means something once the routes that must exclude it carry `@Roles`.
So #2079's audit must be executed as **audit *and decorate***, not audit and allowlist.

Story **A5** asserts the property in this wave's own tests rather than citing #2079's.

---

## 2. In-scope stories

`(P9)` marks a story whose acceptance includes the binding naming rule: **authority**, **posture**
and **FulfillmentWork** never appear in anything the operator can see.

### 2.1 Surface A — the bench and who is at it *(W3b-1, #2413)*

Terminals are **shared and roaming** (D15), but a person changes terminal only a few times a shift
(D16) — so sign-in is a shift-boundary-ish event, not a per-parcel one.

**A1 — I start packing and the system knows it is me**
- Given I am a packer with my own account at a shared bench,
- When I sign in and pack a parcel,
- Then that parcel is attributed to my user id — not to the bench, not to a shift.

**A2 — I can hand the bench over**
- Given I am signed in,
- When another packer takes the bench,
- Then switching user is reachable from the packing surface without returning to the application
  shell, and the incoming packer's first scan is attributed to them,
- And verification progress on an open parcel survives the switch.

**A3 — walking away does not leave my identity on the bench**
- Given I stop interacting,
- Then the surface locks after an idle period, and no scan is attributed to me until someone signs
  in; locking never discards progress.

**A4 — I can always see who the system thinks I am**
- Given the surface is open,
- Then the signed-in packer's name is visible without opening a menu, in the same glance as the item
  being scanned.

**A5 — a bench terminal cannot wander into customer data** *(prerequisite #2079)*
- Given a session signed in at a bench with the role packing requires,
- When it requests a route unrelated to fulfilment — the customer list, a customer record, the
  sales-document rules surface,
- Then it is refused.

### 2.2 Surface B — the work list *(W3b-3, #2416)*

**B1 — I see the work routed to us, and only that** *(P9)*
- Given orders routed across several holders,
- Then the bench lists only work assigned to this holder, accepted and not yet closed.

**B2 — the list tells me what is urgent, and never what is ready**
- Given work with differing dispatch deadlines,
- Then the list is ordered by urgency and states deadlines in plain words,
- And it **never** states or implies that stock has been picked or gathered.
- *(OL cannot see a shelf. Implying readiness sends a packer to fetch something that is not there,
  and after that happens twice the list is not trusted again.)*

**B3 — the list says why it is empty**
- Given no work is assigned,
- Then the surface distinguishes "nothing to pack right now" from "routing is not switched on, so
  this bench will never receive work", and says what to do about the latter.

**B4 — state is legible at a glance** *(P9)*
- Given work in mixed states,
- Then state is carried by colour and position as well as text, never by colour alone.

**B5 — I can push one parcel to the front** *(D22)*
- Given a parcel that must go out ahead of its deadline order — an angry customer, a courier
  cut-off, a supervisor's call,
- When someone with write access expedites it,
- Then it sorts ahead of everything not expedited, and the bench shows *that* it was expedited
  rather than silently reordering the list under the packer,
- And it can be un-expedited, because a permanent override is a second deadline system.
- *(Without this, the only lever on ordering is to HOLD everything else — destructive, and it
  stops other work rather than advancing this one. Deadline order is a good default and a poor
  only-answer: `dispatchByAt` cannot know that this particular buyer phoned twice.)*

### 2.3 Surface C — scanner-first operation *(W3b-3, #2416)*

**C1 — the verification loop is scanner-only**
- Given a bench with a scanner and no practical keyboard access,
- Then every step of verifying a parcel is reachable by scanning, and no step requires a target
  smaller than a gloved fingertip.
- *(**Opening** a parcel is exempt — D11. OL prints no barcode, so there is nothing to scan.)*

**C2 — nothing to mis-tap into**
- Then the surface is full-viewport with no global navigation and no links out of the flow; leaving
  requires a deliberate action.

**C3 — an unrecognised scan is reported, never swallowed**
- Given I scan something matching no expected item or command,
- Then the surface says so immediately and distinctly, and records nothing.

**C4 — usable in the conditions of a floor** *(W3b-8, #2421)*
- Given glare, gloves, one hand occupied, a bench-height screen,
- Then targets, contrast and feedback are sized for that, and every state change that matters is
  signalled by more than colour. Errors are **audible**, and wrong-item and over-scan are
  **distinguishable by sound** (the field's practice, and the packer is looking at the box).

### 2.4 Surface D — opening a parcel *(W3b-5, #2418)*

**D1 — I open the parcel in front of me**
- Given a physical tote at the bench,
- When I find it by whatever identifier I have — order number, buyer name, marketplace reference —
- Then that work opens, showing what must go in the box.
- *(Search-and-select, not scan: D11.)*

**D2 — a parcel I must not pack is refused, with the reason** *(P9)*
- Given the work is held, its order cancelled, or otherwise not packable,
- Then the surface refuses and says why in plain words,
- And the refusal uses the **same eligibility rule as the list**, so the two can never disagree.

**D3 — a split order is unambiguous**
- Given an order routed across two locations, and therefore two parcels,
- Then the surface is explicit about which parcel this is, and never presents one parcel's contents
  as the whole order.

**D4 — I am told when the work changes underneath me**
- Given the work is cancelled, re-routed or closed elsewhere while I am packing it,
- Then the surface interrupts, names what changed and says what to do — rather than letting my next
  scan fail with an error I cannot interpret.
- *(Only for changes that make the parcel unpackable. An interruption that fires on a buyer's address
  edit trains people to dismiss interruptions.)*

### 2.5 Surface E — verification and close *(W3b-5, #2418)*

**E1 — every item is verified into the box**
- When I scan each item, each unit is checked against the work's lines and recorded.

**E2 — the wrong item is refused, and tells me why**
- Then the surface refuses it, names what it expected and what it got, and records nothing.

**E3 — over-packing is caught at the moment it happens**
- Given a line requiring 2 units, when I scan a third,
- Then the extra unit is refused, signalled distinctly, and the recorded quantity never exceeds the
  line's requirement.

**E4 — an item that will not scan can still be confirmed**
- Given a damaged, missing or absent barcode,
- Then I can confirm that line by hand, and the parcel proceeds.
- *(Recorded identically to a scan — D20. A surface with no manual path does not prevent the
  workaround, it hides it: the packer scans a second unit of the same SKU twice, which the system
  cannot detect, and the parcel closes looking perfectly verified.)*

**E5 — the parcel closes when the last item is verified**
- Given the final line is completed,
- Then the parcel closes automatically, with no separate confirmation step.
- *(D18, matching the field. The cost is D13's: attribution lands on whoever verified last, which
  under roaming may be someone who checked one item of five.)*

**E6 — I can reopen a parcel I closed by mistake**
- Given a parcel closed in error — including one closed by a mis-scan completing the count,
- When I reopen it,
- Then verification resumes, the reopen is recorded with who and when, and re-closing updates the
  attribution.
- *(Load-bearing because of E5: auto-close removes the pause in which a mistake would have been
  caught, so reopening is the only correction mechanism. Refused once the parcel has shipped — the
  box is gone, and reopening it in software is a fiction.)*

### 2.6 Surface F — documents and the label *(W3b-5, #2418)*

**F1 — the documents in the box are printed, not created here**
- Given a parcel ready to close,
- Then the bench prints the documents the sales-document machinery already issued.
- *(The bench never issues. Trigger models are `manual | auto-on-paid | auto-on-shipped | batched`,
  qualifying on paid and shipped; there is no "on packed" trigger and this wave adds none — packing
  is not a fiscal event. An operation that puts an invoice in the box configures `auto-on-paid`, and
  the document exists long before the tote reaches a bench.)*

**F2 — a missing document is named, not silently skipped** *(P9)*
- Given a document is expected but was never issued — blocked, manual, or issuance failed,
- Then the surface says so in the packer's words, reusing the existing block-reason vocabulary,
- And packing is **not** refused.
- *(A tax-rate gap is an office problem. Refusing to pack piles boxes at a bench while someone hunts
  for an admin, and the order still needs shipping — that is the shape of every fail-closed gate that
  gets switched off within a week.)*

**F3 — the label is at the bench when the parcel closes**
- Given a parcel closing,
- Then its label is available to print without the bench waiting on a carrier round-trip.
- *(Fetched upstream — D14. A carrier having a bad afternoon must not stop packers working.)*

**F4 — a parcel that cannot be labelled is visible and retryable**
- Given the label could not be produced,
- Then the parcel is packed and unlabelled — a real state, surfaced at the bench and to whoever runs
  dispatch, retryable without re-opening or re-verifying.
- *(Otherwise boxes sit on a floor and nobody knows why.)*

### 2.7 Surface G — what reaches the rest of the system *(W3b-7, #2420)*

**G1 — who packed it is always answerable**
- Then the work records **either** a packer's user id **or** the service that packed it, exactly one.
- *(Mirroring `CHK_fulfillment_holds_actor`. A bare nullable column makes "a 3PL packed this" and "a
  human packed it and we lost who" indistinguishable.)*

**G2 — the order still has one answer**
- Then the order-level packed fact follows from the works — one fact, derived, never a rival to the
  per-parcel detail — and a single-parcel order behaves exactly as today.

**G3 — a scan recorded once is recorded once**
- Given a network retry, a tablet sleeping mid-request, or a reflex double-trigger,
- Then one physical action is recorded exactly once,
- And a **legitimate** second scan — the second unit of a two-unit line — is recorded as a second
  unit.
- *(Per-gesture id, minted client-side, durable before the request is sent, reused on retry.)*

**G4 — the bench and the worklist never disagree**
- Then the desktop worklist (#2410) shows the same state, and an action in one is reflected in the
  other rather than producing a stale-token conflict the operator must resolve.

### 2.8 Surface H — behaviour under failure *(W3b-8, #2421)*

**H1 — a network blip does not cost me my work**
- Then scans already recorded are not lost, the surface says plainly that it is offline, and does not
  accept work it cannot record while pretending otherwise.

**H2 — the surface never claims a state it has not confirmed**
- Then a line does not display as verified until the system has accepted it, and the operator is
  never left unable to tell whether their last scan counted.

---

## 3. Non-goals

- **Picking** (§ 5).
- **Assigning parcels to specific benches.** The list is what routing assigned to this *holder*;
  physical possession settles who packs it. No claims, no locks, no double-pickup machinery.
- **A station/device principal, PIN or badge** (D2).
- **Location topology or bin codes** (D5).
- **Issuing documents at the bench** (F1).
- **Detecting the same physical unit scanned twice.** No product in the field does this; verification
  is a counter, not a set. Stated in the spec so "scanner-verified" is not read as airtight.
- **Replacing the order-grain packed toggle** (§ 1.4).
- **Wave 4 hardening** — `W4-1`/`W4-2`, and the `pending {decisionId}` routing arm (`W4-3`).

---

## 4. Open questions

Small, and belonging to surface design rather than to scope:

1. The idle-timeout value (A3).
2. Undo depth within an open parcel — last action, or any recorded line.
3. Whether single-unit, single-line parcels behave any differently. No product documents a special
   case; better decided against real volume than in a spec.

---

## 5. What was cut, and what it costs

**Picking is deferred to the future WMS.** Cut: **W3b-2** (#2414, pick-list generation +
`oms_pick_*`), **W3b-4** (#2417, the pick flow), **W3b-6** (#2419, `short_picked` +
`releaseShortfall`). Surviving: W3b-1, W3b-3, W3b-5, W3b-7, W3b-8.

A WMS owns pick lists, location topology and walk order. A stopgap now — a free-text bin code, an
OL-owned pick list — creates data the WMS must later reconcile, and operator-maintained location
strings acquire years of inconsistent convention before the real system inherits them. This applies
ADR-048 decision 1's principle (no interface without an implementer) to data: no field whose owner
does not exist yet.

**Costs, recorded so they are not discovered:**

- **The re-route intent stays unconsumed.** `FulfillmentProgressService.apply()`'s `short_picked` arm
  emits a `{kind:'reroute'}` intent nothing acts on. Tolerable **only** because nothing can *produce*
  a short-pick until picking exists — whoever builds the WMS inherits this and must be told.
- **DESIGN § 5.4's re-source loop ships unexercised** by any real path.
- **Walking is unoptimised.** `inventory_locations` carries postcode and lat/long — a site address,
  not a shelf. Real, recurring cost at 1000 orders/day, arriving with the WMS.
- **Short shipments are structurally awkward in an auto-close design** (D18): the completion trigger
  is "all items verified", so an order that *cannot* have all items verified has no path to
  completion. Unreachable in this wave — nothing produces a shortfall — but it is the first thing the
  WMS wave must design.

---

## 6. Decision log

| # | Decision | Reasoning |
|---|---|---|
| D1 | Attribution serves **dispute resolution** — usually right; wrong attribution embarrassing but recoverable. | Not coaching (too weak to justify the rails), not shrinkage (unreachable on a shared terminal without a per-action credential; claiming it would be false). |
| D2 | **Every packer has an account; the bench is a device label, not a principal.** | Removes a fifth credential entity in `libs/core/src/users`, its enrolment/rotation/lockout, and a bearer token in shared browser storage. Cost: mis-attribution becomes the failure mode. Answers #2080. |
| D3 | **#2079 is a prerequisite**, executed as audit *and decorate*. | Choosing the ordinary session forfeits the protection a dedicated verifier had — `req.auth` is read by no guard, so such a token cannot reach an undecorated route. An ordinary session inherits the whole app. |
| D4 | Attribution grain is **per work, per phase**; the order-grain fact is **derived**. | An order can split into several works; an order-grain person fact names one packer and drops the other. |
| D5 | **No location topology or bin codes.** | A WMS owns it; a stopgap becomes data it must migrate. |
| D6 | **No actor on `FulfillmentProgressEvent`.** | Otherwise every 3PL adapter carries a field only our bench can populate, and a permanently-`null` field is later read as "unattributed" rather than "not applicable". |
| D7 | **Picking deferred to the WMS** (§ 5). | |
| D8 | **The bench is a holder's interface**; its list is routing's dispatch, not a deadline-derived queue. | `fulfillment.work.dispatch` already offers routed work to its holder. A derived list would be a second, weaker answer beside an authoritative one, and would show work routed to a 3PL. |
| D9 | **No pick lists, claims or double-pickup machinery.** | Picking concerns; physical possession settles who packs a parcel. |
| D10 | The order-grain fact is derived **and** the manual toggle survives; first writer wins. A short-shipped order still reads packed. | Preserves the shipped invariant (person or system asserts; first wins). Partial-ness is not a packing concept: the model's answer is line-scoped refund or return, and a partial-packed flag would be "an invented partial-cancel state no source can express". If ever needed, it belongs on `FulfillmentRollupState`, where Shopify puts it. |
| D11 | **Opening a parcel is search-and-select, not a scan.** | OL prints no barcode and mints no scannable parcel identity; `externalWorkId` is the holder's own reference and null for the in-house executor. Makes no assumption about what is physically on a tote — the one assumption we are not entitled to. Scanning becomes a faster input for the same action if a WMS later supplies tote labels. |
| D12 | Packers get a **narrower `packer` role**, not `operator`. | At 1000/day with temps, "every temp packer can read the customer database" is not a defensible posture. Requires D3. |
| D13 | The **last verifier** owns the parcel; the ledger holds every contributor. | Consequence of D18. Under roaming this can be someone who checked one item of five — recorded as a limitation, not presented as an assertion. |
| D14 | **The label is fetched upstream**; the bench prints it. | Mintsoft's shape. A carrier outage must not stop packing, and this answers that better than decoupling does. |
| D15 | Terminals are **shared and roaming**. | Owner's operation. Justifies A2–A4. |
| D16 | A person changes terminal **a few times a shift**, not continuously. | Password sign-in is therefore acceptable friction, and D2 survives. At dozens of switches a day it would not, and #2080's two-principal design would reopen. |
| D17 | **A missing document warns; it does not block packing.** | A tax-rate gap is an office problem the packer cannot fix. Fail-closed here is the gate that gets switched off within a week. |
| D18 | **The parcel closes on the last verification**, with no confirmation step. | The field is near-unanimous (Peoplevox, Sellasist, Linnworks, ShipStation auto-advance; Sellasist markets the absent click). Overrides an earlier recommendation for a deliberate commit. |
| D19 | **A closed parcel can be reopened**, attributed and audited; refused once shipped. | Load-bearing because of D18 — auto-close removes the pause in which a mis-scan would be caught, so reopening is the only correction path. Apilo attributes the un-pack too. |
| D20 | **Manual confirmation is recorded identically to a scan.** | Marking it creates a stigma, and stigma drives the undetectable workaround (scan a second unit of the same SKU twice). Cost: weaker dispute evidence. |
| D22 | **An operator can expedite a parcel ahead of deadline order**, visibly and reversibly. | Ordering is otherwise purely `dispatchByAt`, and the only lever on it is holding everything else — which stops work rather than advancing it. The expedite is shown, not silent, because a list that reorders itself under a packer is a list they stop trusting. **Routing a parcel to a bench BY HAND is a different and larger thing** — it adds a producer of work and must take #2395's single decision slot — and is #2869, not this wave. |
| D21 | **A work changing underneath the packer interrupts**, naming the change. | The free behaviour — a 409 on the next scan — is an error at a moment the packer cannot interpret, which is how a correct guard becomes a support ticket. |
