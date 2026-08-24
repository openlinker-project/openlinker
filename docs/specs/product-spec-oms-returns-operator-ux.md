# Product Spec — OMS Returns: the operator's day (Waves 1c–2)

**Status:** Draft for review — **product/UX specification only**. The domain model is decided and out
of scope for re-litigation: `docs/plans/analysis/DESIGN-oms-authority-model.md` §7,
`docs/architecture/adrs/060-returns-aggregate-above-source-projection.md`, and the R1 REVIEW record.
Source-shape constraints are absorbed verbatim from `ANALYSIS-1032-oms-module.md` § Wave 4.
**Parent design stories:** T1–T7, T10 (§14). **Waves:** 1c (observe) + 2 (custody, money, corrections).
**Started:** 2026-08-22

> **What this document is.** ADR-060 decided *what a return is*. Nobody has designed *the operator's
> day*: the screen a warehouse user opens when a parcel lands on the bench, the moment an operator
> learns a restock silently refused, the paragraph an accountant reads before issuing a credit note
> against a legal document that cannot be retracted. That is this spec. Every screen below is
> constrained by one rule the model already committed to: **OL displays what it observed and what its
> operator did, and never a state it inferred.**

---

## 1. Problem

OL persists refunds (`RefundRecord`, #2036) with **no frontend at all** — verified: the only `refund`
token in `apps/web/src` is a payment badge label. Returns exist nowhere. So today the operator's
return workflow is: read the marketplace's own panel, count the parcel on the bench, type the stock
correction into PrestaShop by hand, remember to issue the credit note, and remember — separately, and
most sellers do not — to claim the Allegro commission back.

Four distinct failures live in that gap:

1. **No single place.** Returns are opened on the marketplace the buyer bought from. A three-channel
   seller checks three panels, on three cadences, with three vocabularies.
2. **The physical fact has nowhere to land.** "Two of the three advised units arrived, one is
   scuffed" is an event in the operator's own building with **no source counterpart to contradict it**
   — and no field anywhere in OL to hold it.
3. **Restock is the silent one.** `PrestashopInventoryMasterAdapter.adjustInventory` **rejects**
   (`PrestashopNotSupportedException`). A returns feature that reports "restocked" against that
   adapter would be lying to an operator about their own stock. ADR-060's answer — `restock_blocked`,
   operator-visible — only works if a screen surfaces it with something the operator can *do*.
4. **The money is two flows, not one.** The buyer refund and (on Allegro) the **commission refund**
   are separate claims with separate outcomes. Exactly one competitor covers the second. Sellers who
   do not claim it lose the fee on every return, permanently and invisibly.

### Why this is a UX problem and not a data problem

The model is deliberately honest in ways that are *hostile to a naive screen*: `rawStatus` is verbatim
and uninterpreted (Allegro's 11 values interleave four axes; the spec itself calls it a "timeline"),
`resolvedOrderLineId` is **nullable by design**, custody and money are **two machines that never
collapse**, and lines carry **counters, not statuses**. A screen that renders any of that as a single
green pill has re-introduced the inference the model refused. The design work here is showing three
partial truths at once without making the operator feel they are looking at a broken page.

---

## 2. Affected personas

| | Persona | What they do here | Their screen |
|---|---|---|---|
| **P1** | **The operator** (multi-channel seller, non-technical, runs the OL admin) | Triage the day's returns, decline what's declinable, drive money and paperwork | Returns list, return detail money side |
| **P2** | **The warehouse user** (may be the same human wearing a different hat; on a bench, possibly a tablet) | Open the parcel, record what actually arrived per line, dispose restock/scrap | Return detail custody side, mobile/tablet-first |
| **P3** | **The accountant** (often external, low OL familiarity, opens OL for one task) | Confirm a credit-note proposal against the original invoice | Correction-proposal review |

P2 is why the detail page is **tablet-first, not desktop-only** — the receiving flow is the one OL
surface a user reaches with a parcel in one hand. The responsive rule (mobile ≤767, tablet 768–1023
first-class) is binding here rather than nominal.

---

## 3. Decisions this spec owns

### 3.1 `inspected` — **collapsed into `received` for v1** (design §12.7, delegated)

**Decision: ship custody as `advised → in_transit → received → disposed | not_returned`. `inspected`
is deleted from v1.**

Reasoning, in the order that decided it:

1. **The fact `inspected` would carry is a fact OL already ruled out.** The only thing inspection
   produces that receipt does not is *condition* — and `damagedQuantity` was cut as unobservable from
   every source in scope, operator-typed-only, and **grading returned goods is a declared permanent
   non-goal** ("warehouse mechanics", ANALYSIS §1). A state whose payload does not exist is a label.
2. **It has no distinct action and no distinct decision.** `received` is entered by the operator
   recording quantities; `disposed` is entered by the operator choosing restock or scrap. **The
   disposition choice *is* the inspection outcome.** There is no third form, no third button, and
   nothing downstream branches on the difference — which is precisely the condition ADR-060 and design
   §12.7 set for deleting it ("delete before it enters a downstream `switch`").
3. **The operator need it appears to serve is already served.** "Arrived, not yet decided" is exactly
   `received` with `quantityRestocked + quantityScrapped < quantityReceived` — visible in the
   counters, which are the model's chosen expression of partial progress. Adding a state to say what
   a counter already says is double-encoding, and it makes `received` ambiguous.
4. **The cost of being wrong is asymmetric and small.** Adding a state later is additive (one enum
   value, one timestamp, one step in the custody rail). Shipping one nobody enters means every return
   sits in `received` forever while a timeline step renders permanently grey — and the operator learns
   to distrust the timeline, which is the one component whose entire value is trust.

**Reversal gate (explicit, so a later wave does not re-argue from scratch):** `inspected` re-enters the
moment **receipt and disposition are performed by different actors** — i.e. when `ReturnReceiver`
(T8, deferred with its narrowing base unnamed) or any 3PL receiving integration ships, because then
"received by the 3PL, not yet adjudicated by the authority" is a real hand-off with a real waiting
party. It must be added **before** any downstream consumer branches on custody, never after.

**Consequence for this spec:** every AC, rail and filter below uses the four-state custody machine. The
persisted `receivedAt` / `disposedAt` timestamps carry the whole story; a free-text **note** is offered
per disposition line (§5.3) and is explicitly *not* a graded vocabulary.

### 3.2 The rollup labels are derived from counters, and say so

The list needs one glanceable signal per row, but the model forbids a status. So the row renders a
**derived operator stage** computed *purely from counters and timestamps* — `Awaiting parcel`,
`Partially received`, `Received — awaiting disposition`, `Disposed`, `Not returned`, `Declined` — with
the counters themselves adjacent (`3 of 5 received`). It is a **presentation projection, never a
persisted column**, mirrored FE/SQL and pinned by a mirror test, following the #2100
`invoicingBlockedBadge` precedent exactly (`satisfies Record<…>` exhaustiveness + table-driven test +
a `scripts/check-*-mirror.mjs` invariant). If a future wave wants to persist it, that is a model change
and needs its own ADR — this spec does not create one by the back door.

### 3.3 `rawStatus` is shown, attributed, and never translated

The source status renders as a neutral chip carrying **the verbatim string**, always prefixed by the
source (`Allegro: COMMISSION_REFUND_CLAIMED`), with hover/press copy: *"Reported by Allegro. OpenLinker
does not interpret this value."* No mapping table, no traffic-light tone, no sorting by it. It is
evidence, not state.

---

## 4. Screen 1 — the Returns list (`/returns`)

Route module `src/app/routes/returns.route.tsx` (lazy; bump `EXPECTED_LAZY_ROUTE_COUNT`), page
`src/pages/returns/returns-list-page.tsx`, feature `src/features/returns/`. Breadcrumb handle
`{ crumb: { group: 'Operations', title: 'Returns' } }`.

### 4.1 Segments (MetricCard strip, clickable → filter)

Mirrors the orders-list `HEALTH_SEGMENTS` pattern. **Ordered by what stops the operator's day:**

| Segment | Tone | Means |
|---|---|---|
| **Needs receiving** | warning | custody `advised` / `in_transit`, or `received` with `quantityReceived < quantityAdvised` |
| **Needs disposition** | warning | `quantityReceived > quantityRestocked + quantityScrapped` |
| **Restock blocked** | error | any line with `restock_blocked` |
| **Money pending** | warning | money `pending` or **`in_doubt`** on any line |
| **Orphans** | error | `internalOrderId IS NULL` |
| **All open** | neutral | every return still needing something: custody is `advised`, `in_transit`, or `received` with units not yet disposed — **or** custody is finished (`disposed` / `not_returned` / declined) but money is still `pending` or `in_doubt`. A return leaves this segment only when custody **and** money are both finished |

**`Restock blocked` and `Orphans` are the two attention-worthy segments** (the #2100
attention-worthy/routine split): they alone may render a non-zero count in red on a healthy install,
because both mean *OL did something the operator has not been told about anywhere else*. `Money
pending` is routine on any active seller and is never red.

**Orphans, said plainly.** Copy on the segment and its empty state: *"Returns for orders OpenLinker has
never seen. They are kept, but nothing is triggered from them — no stock change, no refund, no credit
note — until they are matched to an order."* This is T2's whole point and must not be softened into
"unmatched".

### 4.2 Columns (desktop table)

| Column | Content | Sort |
|---|---|---|
| **Return** | source platform badge + `externalReturnId` (or OL id) + `Recorded by you` chip when `origin = operator_authored` | — |
| **Order** | `Link to={/orders/:id#returns}` with buyer name; **orphan** → red `Orphan` badge + `Match to order` affordance | — |
| **Opened** | `TimeDisplay` relative, absolute on hover | ✅ default desc |
| **Stage** | derived stage label (§3.2) + the counter line `3 of 5 received` | — |
| **Money** | money rollup chip: `Not refundable` / `Refund pending` / **`Refund in doubt`** / `Refund triggered` / `Refunded` / `Denied`; plus a small second chip when an Allegro **commission** flow is live | — |
| **Source status** | verbatim `rawStatus` chip, source-prefixed (§3.3) | — |
| **Attention** | `Restock blocked` / `Authority ambiguous` badges — independent parts, never a ternary | — |

**Three independent parts, never one ternary.** The #2100 post-mortem is explicit that folding an
invoice pill, a block badge and a CTA into a three-way ternary made the badge unreachable behind any
record. Money chip, attention badge and the primary action are siblings here for the same reason.

### 4.3 Filters (all URL params; any change resets `offset`)

`stage`, `attention=restock_blocked`, `orphan=true`, `money` (incl. `money=in_doubt`),
`sourceConnectionId`, `reason` (reuses `RefundReasonValues` verbatim — so returns-by-reason and
refunds-by-reason report on one axis by construction), `openedFrom` / `openedTo`. `FILTER_PARAMS` const
+ `hasActiveFilters` + one-call `clearAllFilters`, per the orders-list convention. Raw params narrowed
by type guards against `as const` arrays; an unrecognised value is ignored, never thrown.

### 4.4 Mobile / tablet

One `DataTable` with `cardView` using **the same cell renderers** as the desktop columns (#2091 — the
two must not be able to drift). Card: title = return + source badge; subtitle = order link or orphan
badge; body `dl` = Stage + counters, Money, Source status; meta = opened. Segment strip 1×6 → 2-col →
6-col. No horizontal scrolling outside `.data-table__container`.

### 4.5 Empty / loading / error

- **Loading:** `DataTableSkeleton columns={columns}`.
- **Error:** `ErrorState`, naming the failing scope, with Retry.
- **Empty, filtered:** "No returns match these filters" + `Clear filters`.
- **Empty, unfiltered, healthy:** "No open returns." plus a line stating *when OL last checked* and
  *how* (§7 — this line is the fork's most visible artefact).
- **Empty, no returns-capable connection at all:** an informational card — *"None of your connected
  channels report returns to OpenLinker yet. You can still record a return yourself."* + the
  operator-authored action. Never an error state: it is a configuration fact, not a failure.

---

## 5. Screen 2 — the Return detail (`/returns/:id`)

Stacked panel column, no tabs — matching `order-detail-page.tsx`. Hash anchors `#custody`, `#money`,
`#correction` for deep links from the list, the order panel and toasts.

Panel order, chosen so the page answers questions in the order they are asked:

1. `ReturnDetailHeader` — return id, source badge, origin, order link (or orphan banner), opened-at,
   primary actions.
2. `ReturnOrphanBanner` *(conditional, error tone, top of page)* — §5.5.
3. `ReturnCustodyPanel` (`#custody`) — the custody rail + the per-line receive/dispose flow.
4. `ReturnMoneyPanel` (`#money`) — the money rail, refund trigger, commission refund.
5. `ReturnCorrectionPanel` (`#correction`) — the credit-note proposal.
6. `ReturnSourceObservationPanel` — verbatim `rawStatus`, source-reported dates, `rawPayload` in a
   `RawPayloadPanel`.
7. `ReturnActivityTimeline` — the merged audit narrative (who did what, when).

### 5.1 The two timelines, side by side and labelled as two

Custody and money render as **two separate rails**, stacked vertically on mobile, each with its own
heading and a one-line explainer:

- **Custody — where the goods are.** `Advised → In transit → Received → Disposed` (or `Not returned`).
- **Money — where the refund is.** `Pending → Triggered → Refunded` (or `Denied` / `Not refundable`).

Under both, one standing sentence, always visible, never a tooltip:

> *These move independently. A marketplace often refunds the buyer before the parcel reaches you.*

That sentence exists because the single most likely support ticket this feature generates is "why does
it say refunded when I haven't got the item back". Answering it pre-emptively on the page is cheaper
than answering it in a mailbox.

**`in_doubt` is a first-class rail step, not an error.** Warning tone, labelled **"Refund — outcome
unconfirmed"**, body: *"OpenLinker asked the provider to refund and did not get a confirmed answer.
Nothing further will be triggered from this return until a confirmed outcome arrives. Do not refund
again from the marketplace panel."* — the ADR-042 discipline in operator language. It blocks like
`pending` and clears only on a terminal observation; the copy must say so, because the operator's
instinct is to retry.

### 5.2 The receive flow (P2, tablet-first)

Per-line table. Columns: product (name + sku + variant), **Advised**, **Received**, **Restocked**,
**Scrapped**, **Line status**, action. The invariant `advised ≥ received ≥ restocked + scrapped` is
enforced client-side *and* server-side; a client-side violation is a field error, never a
disabled-with-no-explanation input.

**Receiving is an inline expansion, not a modal** — following `generate-label-form.tsx` (RHF +
zodResolver, `<fieldset disabled>` while pending, `FormErrorSummary` / `FieldError` / `FormField`).
A modal on a tablet with a parcel in one hand is the wrong ergonomics, and the operator needs the
advised quantities visible while typing.

**Declared departure from the style guide.** `docs/frontend-ui-style-guide.md` puts complex data
editors behind an *"open on desktop"* hint at tablet width. The receive and dispose forms
deliberately **do not** carry that hint and stay fully interactive at 768 px. This is a declared
departure in the same shape as the bulk product picker (#1754/#1779), and it is declared rather than
silently taken:

- **The rule being departed from:** complex editors degrade to a desktop hint below the desktop
  breakpoint.
- **Why:** the tablet *is* the primary device for this task. The user is at a bench with a parcel in
  one hand; the desktop they would be redirected to is in another room. A hint here does not move
  the work to a better device, it moves it to a paper note and a later re-entry — which is exactly
  the double-handling this screen exists to remove.
- **What is guaranteed instead:** every control is fully interactive at 768 px, touch targets are
  ≥44 px, the advised quantities stay visible while typing, no horizontal scrolling occurs outside
  `.data-table__container`, and no *"open on desktop"* affordance is rendered at any width.
- **Scope of the departure:** the receive and dispose forms only. The credit-note proposal (§5.8) is
  an accountant's desktop task and keeps the standard treatment.

Fields per line: **quantity received** (number, defaults to the remaining advised quantity — the common
case is one press), optional **note**. Bulk affordance: **`Receive all as advised`** at the table head,
which pre-fills every line and still requires an explicit confirm. That is the single most common real
interaction, and it decides whether this screen is used or bypassed.

**Partial and over-receipt.**
- Received < advised → the line stays `received` with the shortfall visible; a `Mark remainder not
  returned` action moves the shortfall to `not_returned`. This is the only way a line reaches
  `not_returned`, and it is always an operator act, never a timeout.
- Received > advised → **blocked**, with an actionable message: *"You've recorded more units than the
  buyer advised. Record what arrived up to the advised quantity, and open a separate return for the
  rest."* OL does not silently widen a marketplace's own claim.

### 5.3 The dispose flow

Available per line once `quantityReceived > quantityRestocked + quantityScrapped`. Inline, same
pattern. Fields: **quantity**, **disposition** (`Restock` | `Scrap` — a two-option segmented control,
not a dropdown, because there will never be a third in this wave), optional **note** (free text; this
is where "scuffed box" goes, and it is deliberately not a graded vocabulary — §3.1).

Copy on the control, resolving the one thing an operator will get wrong:

- **Restock** — *"Adds the units back to your stock, in the system that owns your stock."*
- **Scrap** — *"Writes the units off. Stock is not changed."*

**Where the stock actually goes is named, not implied.** Under the Restock option, when an
`InventoryMaster` connection resolves: *"Stock will be added in **{connection name}**."* That is the
difference between an operator trusting the number and going to check it by hand.

### 5.4 `restock_blocked` — the surfacing that justifies the feature

> **This section is the canonical copy source for `restock_blocked`.** The Wave-2 operator-experience
> spec's attention state **RB-L** imports these strings rather than restating them, and the copy
> mirror check that the Wave-2 spec's S2-1 mandates covers **both** feature folders. Where any other
> document disagrees with the strings below, this section wins.

When the master's `adjustInventory` refuses (PrestaShop today), the line records `restock_blocked` and
the units stay in `quantityReceived`, **not** in `quantityRestocked`. Three surfaces, all required:

1. **List row** — `Restock blocked` error badge, and the `Restock blocked` segment counts it.
2. **Line row** — a persistent inline error row under the line, not a toast:

   > **Stock was not added.** OpenLinker recorded the disposition, but **{connection name}** does not
   > accept stock adjustments from OpenLinker, so **your stock has not changed**. Add {n} × {sku} in
   > {connection name} yourself, then mark this handled.
   >
   > `[Mark stock handled manually]`  `[Open {connection name}]`  `[Why did this happen?]`

3. **Order-detail returns panel** — the same badge, so an operator who reached the order first is not
   told a different story.

**`[Why did this happen?]` — the explainer, specified.** It expands inline (a disclosure, not a
modal, not a link out) and says exactly this:

> **OpenLinker can publish your stock, but it can't always change it.**
> Adding stock back needs a write into the system that owns your stock. **{connection name}** accepts
> stock *readings* from OpenLinker but not stock *adjustments*, so OpenLinker recorded what you
> decided and stopped there rather than telling you it had done something it hadn't.
> Nothing is lost: the units are still counted as received on this return, and this message stays
> until you say you've handled it.

No blame, no jargon, and no promise of a fix date — the real remedy (implementing `adjustInventory`
on that master) is a scheduling decision (R2), not something to hint at in a disclosure.

**`Mark stock handled manually` — what it does, and what it leaves behind.** It records an operator
attestation (who, when) and moves the units into `quantityRestocked` with
`restockedBy: 'operator_out_of_band'` — the same honesty device the refund trigger uses. It **never**
claims OL wrote the stock. Gated by the standard write posture (§9). Its post-state is specified,
because a resolution that leaves the alarm ringing trains the operator to ignore the alarm:

| Surface | Before | After the attestation |
|---|---|---|
| Line row | red inline error block, three actions | a neutral (not success, not error) row: *"Stock added manually by {user} on {date}. OpenLinker did not change your stock."* — no actions |
| Line counters | units in `quantityReceived` | units in `quantityRestocked`, `restockedBy: 'operator_out_of_band'` |
| List `Attention` badge | `Restock blocked` | **cleared**, if no other line on the return is still unhandled |
| `Restock blocked` segment | counts this return | **no longer counts it** — the segment counts *unhandled* blocks only |
| Order-detail returns panel | `Restock blocked` badge | badge cleared, on the same rule as the list |
| Timeline | *"Restock blocked"* | plus *"Stock handled manually"*, `by` = the operator, never removed |

**The segment counts unhandled blocks, not historical ones.** An operator who resolves twelve blocked
lines and still reads `Restock blocked 12` learns that the number is decoration — which is R2's
learned-ignored risk arriving by a different door. The attestation is permanent in the timeline and
on the line; only the *attention* clears, which is the same distinction the whole spec draws between
a record and an alarm.

**A toast is not sufficient and must not be the only signal.** A restock that silently no-ops is worse
than none; a restock whose failure lives in a toast the operator dismissed while looking at a parcel is
the same failure with extra steps.

### 5.5 Orphan returns

> **This section is the canonical copy source for the orphan-return state.** The Wave-2
> operator-experience spec's attention state **OR-P** imports these strings rather than restating
> them, under the same both-folders mirror check as §5.4.

Red banner at the top of the detail, and the row badge on the list:

> **This return is not matched to an order.** OpenLinker received it from {source} but has no matching
> order. It is safe here, and nothing will be triggered from it — no stock change, no refund, no credit
> note — until it is matched.
>
> `[Match to an order]`

Every action on the page that would move goods, money or paperwork is **visible and disabled**, with
the banner as its explanation — never hidden, because hiding makes the operator think the feature is
broken. A background reconcile may match it later; when it does, the timeline records *"Matched to
order {n} automatically"* with a timestamp, because an operator who finds actions unlocked overnight
needs to know why.

### 5.6 Decline / authorize (T3)

Two actions, deliberately asymmetric, and the asymmetry is stated rather than hidden:

- **Decline** — visible only where the source connection supports the write (Allegro). Confirm dialog:
  *"Declining tells {source} you are refusing this return. {source} decides what happens next —
  OpenLinker records the outcome it reports."* On success the return shows **`Decline sent`** until the
  source confirms; a confirmed decline is a *source observation*, never assumed from a 2xx.
- **Authorize** — visible **only for `operator_authored` returns**. On a source-ingested return the
  action is absent, with a one-line explainer in the header: *"{source} decides whether this return is
  accepted. OpenLinker records their decision."* This is the model's "OL must not pretend to decide
  what the marketplace already decided" rendered as an absence *plus a sentence* — an unexplained
  absence reads as a missing feature.

### 5.7 Money: the refund trigger and the commission refund (T6, T10)

**Buyer refund.** Primary action `Confirm refund` — the label is deliberately not "Refund": *"OpenLinker
does not move money. Confirm that you have refunded the buyer, and OpenLinker will record it against
this return and this order."* Fields: amount (pre-filled from the received/disposed lines, editable),
currency (locked to the order's — the existing refund-currency-mismatch guard), reason
(`RefundReasonValues`), note. Writes the linked `RefundRecord` with
`executedBy: 'operator_out_of_band'`, and the money rail moves to `triggered`. **`refunded` is only ever
entered on observation** — no button in the UI sets it, and the rail step carries *"Confirmed by
{source}"* when it lands.

When a `RefundExecutor` capability is present (no shipped adapter today), the same button becomes
*"Refund the buyer"* and the copy drops the out-of-band sentence. The seam exists; the label is the
whole difference the operator sees.

**Commission refund (Allegro) — a separate money flow, surfaced separately.** A distinct block inside
the money panel, never merged into the refund rail:

> **Allegro commission** — When a return completes, Allegro can refund the sales commission you paid on
> the order. **This is your money coming back from Allegro, and it is separate from the refund you give
> the buyer.**
> Status: `Not claimed` / `Claim filed` / `Refunded by Allegro` / `Refused`

Status is read from the observed `rawStatus` timeline (`COMMISSION_REFUND_CLAIMED` /
`COMMISSION_REFUNDED`) — **observation, not inference**, and the block says so. It appears only on
Allegro-sourced returns; on every other source the block is absent, not empty. The moment it earns its
keep is the one where an operator who has run returns for years learns OL is claiming something they
never did — so the copy leads with *"your money"*, not with *"commission"*.

**The action under the block has two specified branches, and a spike decides which ships (§14 Q2).**
Nothing yet verifies that Allegro exposes a commission-refund *claim write* — the status above is a
read of observed values, which is a different thing. The house rule is to verify Allegro field shapes
before designing to them, so both branches are specified now and the block is built once the spike
answers. **Everything above this line is identical in both branches**; only the action differs.

*Branch A — the API permits claiming.* The block carries a real action:

> `[Claim commission refund]`

which calls the Allegro write and moves the status to `Claim filed` **only on Allegro's own
observation**, never on a 2xx — the same discipline §5.6's `Decline sent` uses. A failure surfaces
Allegro's own message verbatim and attributed, and the button stays available.

*Branch B — claiming is seller-panel-only.* The block carries a deep link and an attestation instead,
and says so plainly rather than pretending:

> Allegro does not let OpenLinker file this claim for you — it has to be done in the Allegro seller
> panel. **It is still your money**, and OpenLinker will show you when Allegro refunds it.
>
> `[Claim this on Allegro ↗]`   `[I've claimed this]`

`Claim this on Allegro` deep-links to the order's commission page in the seller panel. `I've claimed
this` records an operator attestation (who, when) and moves the block to `Claim filed`, marked as
*"You told OpenLinker you filed this"* — never as *"Filed"*, because OL did not file it. The
`Refunded by Allegro` step still arrives as an observation in both branches, which is the point: even
in Branch B the block does the thing the operator cannot do for themselves, which is **notice** the
refund landing.

**The block is worth building in either branch.** Branch B is not a degraded version — a seller who
has never claimed a commission refund is losing the money because nobody told them it was claimable,
not because filing was hard. The prompt is the product; the write is a convenience.

### 5.8 The credit-note proposal (T7, P3)

**A proposal, never an issue.** The panel leads with what is at stake:

> **Credit note proposal.** OpenLinker has matched these returned lines to lines on invoice
> **{invoiceNumber}**. Check the match before issuing — **a correction to a document already sent to
> {authority} cannot be withdrawn.**

Table: returned line → proposed original invoice line (name, quantity, unit price gross, tax rate),
with a per-row **confidence**:

- **Matched** — one candidate, unambiguous.
- **⚠ Ambiguous** — *"Invoice {n} has {k} identical lines for this product. OpenLinker cannot tell which
  one this return refers to; the correction amount is the same either way **unless these lines were
  priced differently**."* All candidates are listed and the operator picks one. This is the positional
  line-identity problem *shown rather than resolved*, exactly as ANALYSIS-1032 requires.
- **⚠ No match** — no proposal for that line; the operator is told it is excluded, and why.

Auto-issue is **not offered**, and its absence is explained once in the panel footer: *"OpenLinker will
not issue corrections automatically until invoice lines carry a stable reference."* Every issue goes
through the existing `CorrectionIssuer` review flow with the operator's confirmed mapping.

**Hard AC:** a fully `Matched` proposal and one with a single `Ambiguous` line must be visibly different
**before** the operator reaches the confirm button — not in a dialog after it.

### 5.9 Loading / empty / error, detail

Skeleton panels rather than a full-page spinner (the header resolves first and orients the operator).
A failed sub-read degrades that panel to a scoped `ErrorState` with Retry; it never blanks the page.
Every mutation: success toast + explicit query invalidation, no optimistic updates.

---

## 6. Screen 3 — the order-detail Returns panel

`<div id="returns" tabIndex={-1}><OrderReturnsPanel order={order} /></div>`, after the shipment and
sales-document pair, before `OrderCustomerCard`. Compact: one row per return (return id, source badge,
opened, stage + counters, money chip, attention badge) linking to the detail. Plus:

- **`Record a return`** (write posture, §9) — the operator-authored path, and on shop orders and in the
  projection-only fork (§7B) the *only* path.
- A **Returns group in `OrderActivityTimeline`**, using its existing
  `TimelineEvent {id,timestamp,title,by,description,tone,footer}` shape: return opened, declined,
  received, disposed, restock blocked, refund confirmed, credit note issued. `by` carries the operator
  for OL-owned events and the source name for observations — the distinction the whole model rests on,
  made visible in one field.
- **Empty state:** "No returns against this order." — routine, neutral, no call to action beyond the
  record action.

---

## 7. The spike fork (#2289 — Allegro customer-returns feed shape)

The Wave-0 spike's kill condition: *if the feed is neither cursor- nor watermark-shaped, returns
ingestion shrinks to a projection off order sync.* Both branches ship the same aggregate, the same
detail page and the same custody / money / correction flows — **the fork changes discovery, freshness
and the orphan bucket, and nothing else.** That containment is deliberate: it is what lets the FE work
start before the spike lands.

### Branch A — the feed is pollable (cursor or watermark)

- `marketplace.returns.poll` + `marketplace.return.sync` run on their own cadence.
- **The orphan bucket is live** — a return can arrive for an order OL never ingested. The `Orphans`
  segment is a real, non-zero-capable red counter and §5.5 is fully exercised.
- List freshness line: *"Channels last checked {relative}."* per source connection, with a `Check now`
  action (write posture, §9) for when the operator expects something that has not landed.
- Decline follow-up rides the returns feed, so the `Decline sent` interim state typically resolves
  within one poll.
- The list is a **primary navigation item** under Operations.

### Branch B — projection-only fallback (returns ride order sync)

- No returns poll. A return becomes visible only when its **order** re-syncs.
- **The orphan bucket ships but is structurally near-empty** — a return discovered through an order is
  by construction attached to one. It renders as a segment with its own empty explanation rather than
  being deleted: an operator-authored return against a later-deleted order, or a reconcile race, can
  still produce one, and deleting the bucket would leave those rows nowhere to appear. Copy: *"Orphan
  returns are rare on your channels, because OpenLinker discovers returns through orders."*
- **Freshness is stated prominently, per source**, because it is now the operator's main surprise:
  *"OpenLinker discovers Allegro returns when it re-checks the order — usually within {order poll
  cadence}. A return may exist on Allegro before it appears here."* This sits on the list header **and**
  on the order returns panel. Understating it produces exactly the "OL is missing my return" ticket the
  line prevents.
- `Check now` on the order returns panel triggers an **order** re-sync and says so: *"Re-check this
  order on {source}"* — never "check for returns", which would promise a capability that does not exist.
- Decline stays available (it is a write, independent of feed shape), but confirmation waits for the next
  order sync, so `Decline sent` is longer-lived and the copy says *"{source} will confirm the next time
  OpenLinker checks this order."*
- The **operator-authored return is promoted**: it is the primary way a return OL has not yet observed
  gets worked today. The unfiltered empty state leads with it.
- The list page still ships and is still primary navigation — it reads OL's own aggregate, which exists
  in both branches. Only the inflow differs.

**Degradation rule.** Nothing in Branch B renders an error, a warning tone, or a "limited mode" banner.
It is a slower discovery path, not a broken one; presenting it as degraded teaches operators to distrust
a working feature.

---

## 8. Authority ambiguity (P4's operator-facing form)

A second enabled `ReturnsAuthority` connection resolves `ambiguous`: **no automated disposition, reason
persisted, inert**. Operator surface: an `Authority ambiguous` badge on the row, and an informational
(not error) banner on the detail:

> **Two systems are configured to decide dispositions for this channel.** OpenLinker will not decide
> automatically while that is true — you can still receive and dispose by hand.
> `[Review returns authority]`

Inert and reported, per the matrix rule. The banner links to the Wave-2 authority-status surface; it
does not attempt to resolve the conflict inline.

---

## 9. Access

**v1 introduces no new permission names.** Returns reuses the existing operator/admin posture
exactly as every other operations surface does:

- **Reads** — list, detail, the order-detail panel, the correction proposal — are available to any
  signed-in user who can already see orders. Returns are order data; a separate read permission
  would let a deployment produce a user who can see an order but not the return against it, which
  is a state nobody asked for.
- **Writes** — receive, dispose, mark stock handled manually, record an operator-authored return,
  match an orphan, decline, authorize, confirm a refund, claim a commission refund, confirm and
  issue a credit-note correction — are gated by the standard write posture: `useWriteAccess` +
  `ReadOnlyLock` (visible-but-disabled, carrying the demo message) for actions, `AccessGate`
  (hidden, demo-unaware) for informational content. Never an inline `session.user.role` compare.
- **No `scripts/check-permission-mirror.mjs` change**, no new `ROLE_PERMISSIONS` entry, no new
  `session.types.ts` value.

**Why no returns-specific tier.** A finer split — warehouse-records-goods versus operator-moves-money
— is only meaningful where those are **different humans**, and no current deployment is known to have
a distinct warehouse persona. A permission name is close to unremovable once shipped: every
deployment that granted it must be migrated, and every issue that gated on it must be re-litigated.
Shipping one ahead of the human it describes is the wrong direction of risk, and the write posture
already stops a read-only user from doing any of it.

**Reversal gate.** Introduce returns-specific permissions when either (a) a deployment presents a
distinct warehouse persona who must record physical arrival without being able to move money, or
(b) `ReturnReceiver` / 3PL arrival lands, which introduces a second receiving actor by construction.
Either is a real second principal; until then there is one.

---

## 10. User stories & acceptance criteria

**US-1 — One place for every return.** *(T1)*
*As the operator, I want every return from every channel in one list, so I stop checking three
marketplace panels.*
- The list shows returns from every returns-capable connection plus operator-authored ones.
- Each row states its source, and the source's own status verbatim and attributed.
- The list renders loading, error, filtered-empty and unfiltered-empty states distinctly.
- With no returns-capable connection, the operator sees an explanation and the record-a-return action —
  never an error.

**US-2 — Orphans are kept, visible, and inert.** *(T2)*
*As the operator, I want returns for orders OL never saw to be safe and obviously blocked.*
- An orphan return persists and appears in its own attention-worthy segment.
- Its detail page states, in one sentence, that nothing will be triggered from it and why.
- Every goods / money / paperwork action is **visible and disabled**, not hidden, with the banner as its
  explanation.
- Automatic matching is narrated in the timeline with its timestamp.

**US-3 — Decline where the platform allows; authorize only what I authored.** *(T3)*
*As the operator, I never want OL to pretend it decided something the marketplace decided.*
- `Decline` appears only where the source supports the write; elsewhere it is absent with a one-line
  explanation of who decides.
- `Authorize` appears only on `operator_authored` returns.
- A successful decline shows `Decline sent` until the source confirms. **A 2xx alone never displays as
  "declined by {source}".**

**US-4 — Record what physically arrived.** *(T4)*
*As the warehouse user, I want to record per line and quantity, on a tablet, with a parcel in my hand.*
- Per-line receive is an inline form, usable at tablet width, with ≥44 px targets.
- `Receive all as advised` pre-fills every line and requires one explicit confirm.
- Receiving more than advised is blocked with an actionable message.
- A shortfall stays visible; `not_returned` is only ever entered by an explicit operator action.
- `advised ≥ received ≥ restocked + scrapped` holds at every intermediate state, and a violation is a
  field error, never a silently disabled control.

**US-5 — Dispose, and know where the stock went.** *(T5)*
*As the operator, I want restock to land in the authoritative stock book, or to fail loudly.*
- Disposition is `Restock` or `Scrap` only; the restock control names the connection stock will land in.
- On refusal the line records `restock_blocked` and the units stay in `received` — never in `restocked`.
- `restock_blocked` surfaces in **three** places: list badge + segment, the line row, and the order
  returns panel — with a persistent inline message, not only a toast.
- The remediation message names the quantity, the sku and the connection, and offers `Mark stock handled
  manually`, which records an operator attestation and never claims OL wrote the stock.
- **After the attestation the alarm clears and the record does not**: the line row becomes the neutral
  *"Stock added manually by {user} on {date}. OpenLinker did not change your stock."*, the list badge
  and the order-panel badge clear (when no other line is still unhandled), the `Restock blocked`
  segment stops counting the return, and the timeline keeps both the block and the attestation
  permanently. A segment that keeps counting resolved work is a number the operator learns to ignore.
- `[Why did this happen?]` expands inline to the explainer specified in §5.4 — never a link out, never
  a modal, and never a promise that OpenLinker will fix it soon.
- **No screen ever shows "restocked" for units whose master write refused.** This is the
  highest-severity AC in this spec.

**US-6 — Refunds described honestly.** *(T6)*
*As the operator, I want OL to record who actually moved the money.*
- The buyer-refund action is labelled `Confirm refund` and states that OL does not move money.
- Confirming writes a `RefundRecord` linked to the return with `executedBy: 'operator_out_of_band'`,
  reusing `RefundReasonValues`.
- No UI path sets `refunded`; it is entered only on observation and rendered as "Confirmed by {source}".
- `in_doubt` renders as a named rail step in warning tone, tells the operator **not** to refund again,
  and blocks downstream triggers exactly as `pending` does.
- Custody and money are visibly two rails, with the "these move independently" sentence always visible.

**US-7 — A credit note I can trust.** *(T7)*
*As the accountant, I want the ambiguity shown before I issue, not after.*
- The proposal names the original invoice and states that a transmitted correction cannot be withdrawn.
- Each line is `Matched`, `Ambiguous` (all candidates listed, operator picks) or `No match` (excluded,
  with the reason).
- An ambiguous proposal is visually distinct from a fully matched one **before** the confirm button.
- Nothing is auto-issued; the absence is explained once, in the panel.

**US-8 — The commission comes back.** *(T10)*
*As a PL seller, I want the Allegro commission refund claimed, and to understand it is not the buyer's
refund.*
- The commission block is separate from the refund rail and leads with "your money coming back".
- Its status is read from observed source values, never inferred, and the panel says so.
- It appears only on Allegro-sourced returns; it is absent, not empty, elsewhere.

**US-9 — The return reaches me from the order too.**
*As the operator, I want to see returns where I already am.*
- The order detail carries a `#returns` panel with one row per return and a record-a-return action.
- Return events appear in the order activity timeline, with `by` distinguishing operator acts from
  source observations.

**US-10 — I can tell how fresh this is.** *(the fork's story)*
- In both branches the list states when and how OL last learned about returns, per source.
- In the projection-only branch the discovery latency is stated on the list header and on the order
  panel, and the manual action is honestly labelled as re-checking the **order**.
- Neither branch presents itself as degraded or limited.

---

## 11. Non-goals

Stated because silence reads as oversight.

1. **Exchanges / replacements.** No entity, no flow, no partial credit. A later wave, and it needs an
   order relationship OL does not have.
2. **Scan-driven receiving** (barcode / handheld). Wave 3b, behind the demand gate, with the pick/pack
   surface whose mechanics it shares.
3. **Disposition routing / receive-node selection.** Wave 4. `ReverseFulfillmentWork` does not exist and
   this spec must not imply a receiving-location choice.
4. **Condition grading, `refurbish`, RTV, quarantine.** Permanent non-goal at this level — warehouse
   mechanics. A free-text note is the whole affordance (§3.1).
5. **`inspected` as a state.** Decided out for v1 (§3.1), with a named reversal gate.
6. **3PL receiving (T8).** Deferred with `ReturnReceiver`; its narrowing base must be named before any
   screen assumes a second actor.
7. **Buyer-facing return portal / self-serve label generation.** OL is the seller's tool. Return labels
   exist as inbound `Shipment` rows; the buyer never sees an OL screen.
8. **Fiscal-receipt corrections.** ADR-042 defers them; only invoice corrections are proposed here.
9. **A returns-rate analytics dashboard.** The reason axis is deliberately shared with refunds so this is
   cheap later; it is not this wave.
10. **Automatic disposition, automatic correction issuance, automatic refund execution.** Each is gated
    on something that does not exist (an authority adapter, a stable invoice-line reference, a
    `RefundExecutor` implementation). Returns automation triggers belong to Wave 2's automation layer,
    not here.
11. **Replacing the marketplace's own returns panel.** OL surfaces and orchestrates; the platform still
    decides acceptance on source-ingested returns.

---

## 12. Definition of done

Split deliberately. The first list can be checked on the day the wave ships; the second is what we
watch for afterwards. An item that can only be evaluated months later, or that asserts an absence over
unbounded time, is a **signal**, not a gate — filing it as a gate teaches the reader to skim the list.

**Ship gates (checkable at ship):**

- **No screen ever shows "restocked" for units whose master write refused.** Proven by a test against
  a PrestaShop master with `adjustInventory` refusing: the line, the list, the order panel and the
  timeline all report `restock_blocked`, and no counter reads `restocked`. **Hard bar, highest
  severity in this spec.**
- A warehouse user completes a full receive-and-dispose on a tablet at 768 px without pinch-zooming,
  without horizontal scrolling outside `.data-table__container`, and without meeting any *"open on
  desktop"* affordance (§5.2's declared departure).
- **A 5-person unmoderated test in which ≥4 correctly answer, from the return detail alone,** whether
  the buyer has been refunded and whether the goods have arrived — the two-rails design's actual
  claim, testable, replacing *"no support question of the form…"* which asserted an absence over
  unbounded time.
- An accountant states, from the proposal alone and with no help, whether each line match is certain;
  a fully-`Matched` proposal and one with a single `Ambiguous` line are visibly different **before**
  the confirm button.
- The commission block renders with a **live claim status on a real Allegro return in staging**, in
  whichever §5.7 branch the spike selected. (This replaces *"at least one PL seller claims a
  commission refund they would not otherwise have claimed"*, which is a counterfactual nobody can
  measure.)
- Every state in §5.4's post-attestation table is reachable and renders as specified — in particular
  the `Restock blocked` segment count drops when the last blocked line is attested.
- Both spike branches' copy exists and the shipped one is reachable; the list and the order panel both
  state freshness per source (§7).

**Post-launch success signals (watched, not gates):**

- An operator working a day of returns does not open a marketplace panel to answer *"what arrived,
  what did I do with it, where is the money"*.
- Support conversations do not contain *"why does it say refunded when I haven't received the item"* —
  the standing two-rails sentence is what is being tested, and its failure mode is visible in the
  first month.
- Operators do not describe the shipped spike branch as "missing" returns — i.e. the freshness copy
  (§7) is doing its job rather than the fork being invisible.
- PL sellers claim commission refunds they were previously unaware of. Not measurable as a
  counterfactual; measurable as *"the commission block's claim action is used at all"*.

---

## 13. Risks

| | Risk | Mitigation in this spec |
|---|---|---|
| R1 | Operators read the derived stage as a persisted status and ask to filter or automate on it | Counters shown adjacent everywhere; stage is presentation-only and mirror-tested; no API field |
| R2 | `restock_blocked` becomes normal noise on a PrestaShop-master install and is learned-ignored | The real fix is implementing `adjustInventory` on PrestaShop — a **prerequisite worth scheduling with this wave**, not a returns line item. Until then the badge is per-line and actionable, never a global banner |
| R3 | The commission block reads as "OL refunded me" | Copy leads with "your money coming back from Allegro"; status is explicitly an observation |
| R4 | Ambiguous credit-note lines get click-through-confirmed | Ambiguity is visible before the confirm button and each candidate must be actively picked; no bulk confirm |
| R5 | Branch B's latency generates "OL is broken" tickets | Freshness stated in two places, honest manual action label, no degraded framing |
| R6 | `in_doubt` prompts a double refund from the marketplace panel | Explicit "do not refund again" copy on the rail step |
| R7 | A future returns-specific permission split blocks the common path (one person, both hats) | v1 ships none (§9); the reversal gate is a real second principal, not a hypothetical one |

---

## 14. Open questions

1. **How is an orphan matched to an order?** Search-and-pick is assumed; whether an operator can
   realistically identify the right order from a marketplace return payload is unverified.
2. **Does the Allegro API permit *claiming* a commission refund, or is it panel-only?** This is a
   **spike**, not a product question — it is the one thing in §5.7 designed against an unverified API
   shape, and the house rule is to verify Allegro field shapes before designing to them. Both
   branches are specified in §5.7 and neither blocks the rest of the wave; the spike decides which
   one ships. It must land before the commission block is built.

Three earlier entries here — the permission split, the nav placement, and whether the commission
refund is a button or a rule — were **settled** and now appear in the Decision log rather than being
re-opened.

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-22 | **`inspected` collapsed into `received` for v1** | No distinct payload (condition is a non-goal), no distinct action, no downstream branch; counters already express partial progress. Reversal gate: a second receiving actor (`ReturnReceiver` / 3PL) |
| 2026-08-22 | Derived stage labels are presentation-only and mirror-tested | The model says counters, not statuses; a persisted rollup is a model change needing its own ADR |
| 2026-08-22 | `rawStatus` shown verbatim, source-attributed, never toned or sorted | It is a timeline across four axes; toning it would be the inference the model refused |
| 2026-08-22 | Receiving is inline and tablet-first, not a modal | The user has a parcel in one hand and needs advised quantities visible |
| 2026-08-22 | `restock_blocked` surfaces in three places, persistently | A toast dismissed at a bench is indistinguishable from a silent no-op |
| 2026-08-22 | **No new permission names in v1**; returns reuses the existing operator/admin write posture (`useWriteAccess` + `ReadOnlyLock`), and `check-permission-mirror.mjs` is untouched | A permission is near-unremovable once shipped, and the finer split is only meaningful where the warehouse user is a *different human* — which no current deployment presents. Reversal gate: a distinct warehouse persona, or `ReturnReceiver` / 3PL arrival introducing a second receiving actor |
| 2026-08-22 | **Returns is a top-level `Operations` nav entry**, not a tab under Orders | Returns have their own cadence, their own attention states and their own two attention-worthy segments; a tab would make them visible only to someone already looking at an order |
| 2026-08-22 | **The Allegro commission refund is a button, not an automation** | It is a claim against a third party with money attached and no idempotency guarantee OL controls; automating it is a Wave-2 automation-layer question, and the operator's own confirmation costs one click |
| 2026-08-22 | **Both commission-claim branches are specified now; a spike picks one** | The claim *write* is unverified against Allegro's API, and the house rule is to verify Allegro shapes before designing to them. Neither branch blocks the wave, and Branch B is not a degraded version — the prompt is the product |
| 2026-08-22 | **`restock_blocked` and orphan copy is owned by this spec**; the Wave-2 spec imports it | One copy source with identical titles in both places is a Wave-2 AC (S2-1); two specs authoring the same string ships a violation of it on day one. The mirror check covers both feature folders |
| 2026-08-22 | **`Mark stock handled manually` clears the attention, never the record** | A segment that keeps counting resolved work becomes decoration; the attestation stays permanently in the timeline and on the line |
| 2026-08-22 | **The tablet-first receive/dispose forms are a declared departure from the style guide** | The tablet is the primary device for this task; a desktop hint moves the work to a paper note, not to a better device. Declared in §5.2 in the shape of the #1754/#1779 picker precedent |
| 2026-08-22 | **`All open` is defined positively** (custody unfinished, or money still `pending`/`in_doubt`) | The original negation did not parse — a reader could not tell whether `declined` had to be money-terminal too |
| 2026-08-22 | Branch B ships the orphan segment and the list page unchanged | The aggregate exists in both branches; only inflow differs, and a "limited mode" framing teaches distrust |
