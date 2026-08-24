# Product Spec — OMS Wave 2 operator experience (presets, authority status, automation v1)

**Status:** Draft for owner review. Discharges the standing directive in
[`REVIEW-oms-authority-model.md`](../plans/analysis/REVIEW-oms-authority-model.md) §7 —
*"product-spec before Wave 2 (presets UX, automation triggers/actions, authority-status page)"*.
Wave 2 engineering issues must not be filed ahead of a Gate on this document.

**Design of record:** [`DESIGN-oms-authority-model.md`](../plans/analysis/DESIGN-oms-authority-model.md)
(§2 authority matrix, §6 lifecycle/holds, §10 Wave 2, §14 stories P2/P8/L4/R2/R4/R10/I6/T4–T7).
**ADRs:** [052](../architecture/adrs/052-independently-assignable-fulfillment-authorities.md),
[053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md),
[061](../architecture/adrs/061-advisory-reservations-and-availability-authority.md);
integrated by reference: [041](../architecture/adrs/041-sales-document-routing-policy.md) (+ #2047, #2100, #2170).
**House precedent this spec is answerable to:** the shipped #2161/#2170 sales-documents rule engine
and its composer.
**Workflow:** [`refinement-workflow.md`](../contributors/refinement-workflow.md) — this is a Tier-1
product spec; engineering plans are Tier-2 and downstream.

---

## 0. Scope of this document

Three operator surfaces, and nothing else:

| # | Surface | Design story | Ships with |
|---|---|---|---|
| S1 | **Who decides what** — the two presets + the authority answers they write | P2 (re-scoped from Wave 4 to Wave 2), P1 | The first operator-settable authority flag |
| S2 | **Authority status** — what is currently inert, and why | P4 (invariant → its operator-facing form), I6, R10, L4 | S1 |
| S3 | **Automation v1** — a closed trigger × action matrix | P8 | Wave 2's holds + reservation ledger + returns custody |

**Not in this document:** the router/worklist UI (Wave 3, its own spec per the same directive), the
scan/pick surface (Wave 3b), posture-B read-only surfaces (Wave 4, story L8), routing-rule storage
(**owned by #2298** — see §7.4), and any backend contract already fixed by ADR-052/053/061.

---

## 1. Problem & operator context

### 1.1 What the operator has today

An OpenLinker operator today configures **integrations**, not **decisions**. Every screen in
`/connections` answers "what is this system, and does it work?"; nothing answers "and what does it
get to decide?" That was fine while the answer was always the same — the shop decided everything,
OpenLinker moved data between it and the marketplaces.

Wave 2 breaks that for the first time. It ships the first authority flag an operator can actually
set, plus three new classes of decision OpenLinker makes on its own (hold an order, promise stock
against a reservation, dispose a returned line). The moment a decision has more than one possible
holder, three operator problems appear at once, and none of them has a home:

1. **"What did I just turn on?"** A per-authority checkbox grid is the obvious build and the wrong
   one. Six authorities × three candidate holders is a configuration surface no solo operator will
   ever read, and every combination it permits is a combination we must then support. The design
   answers this with **presets, and explicitly no per-authority override in v1** — *a needed
   override is a missing third preset* (§10 Wave 2). This spec holds that line.
2. **"Why did nothing happen?"** Every authority conflict in this model is **inert and reported**
   (§2, and the shipped #2047 shape). Inert-and-reported is only half a product: #2100 already
   taught us that a block which exists only in a log line is indistinguishable from a bug, and the
   fix was to persist it and put it on the row. Wave 2 adds five new inert states
   (§4.2) and they need the same treatment on day one, not in a follow-up.
3. **"Can I make it do the boring part?"** The derived phase (Wave 1a), holds (Wave 2) and the
   reservation ledger (Wave 2) are plumbing. The design is blunt about it: *"The automation layer is
   the sellable product layer above the phase; the phase is plumbing."* An operator does not buy a
   phase. They buy "chase the marketplace deadline for me" and "email the buyer when I hold their
   order".

### 1.2 Persona

**P-A, the solo/small-team operator** — the actual majority the R1 roadmap inverted around:
single location, self-shipping or marketplace-fulfilled, 1–3 marketplaces, 1 shop, Polish market,
no WMS, no 3PL. They are the *only* persona this spec designs for. Two consequences:

- Every surface must be **legible without the design document**. The words "authority", "posture"
  and "FulfillmentWork" are forbidden in the UI (design P9, and §2.1 below) because P-A has never
  read the model and never will.
- Every surface must be **useful with one connection**. A who-decides page that only makes sense
  once you have a 3PL is a page P-A never opens, which means the inert states never get seen,
  which loses the whole point of S2.

P-B (multi-location) and P-C (gateway/integrator) are served by the *same* surfaces later; they
drive no v1 requirement here.

### 1.3 The bet, stated honestly

S1 and S2 are **cost of shipping Wave 2 safely** — without them the first authority flag is a
silent foot-gun. S3 is the part with commercial upside, and it is a **strategic bet**: no named
seller has asked for an automation builder. BaseLinker's automation layer is the single most-cited
reason sellers stay on it, which is the market signal; it is not demand from a named OpenLinker
user. Gate this document on whether the owner accepts that.

---

## 2. Cross-cutting rules

### 2.1 UI naming (design P9 — binding)

`authority`, `posture`, `FulfillmentWork`, `AvailabilityAuthority`, `atpEffect`, `phase`,
`Orchestrator`, `Gateway` **never render**. The domain vocabulary stays in the code, the API and
this document.

| Model term | Renders as |
|---|---|
| authority / holder | *"who decides"*, *"decided by"* |
| A1 availability authority | *"how much stock we can promise"* |
| A2 sourcing/routing | *"where an order ships from"* |
| A3 fulfillment execution | *"who picks and ships"* |
| A4 order lifecycle | *"what state an order is in"* |
| A5 returns disposition | *"what happens to returned goods"* |
| A6 refund trigger | *"who issues refunds"* |
| A7 invoicing/fiscalization | *"who issues invoices and receipts"* |
| posture A / posture B preset | see the two preset names, §3.2 |
| `FulfillmentWork` | *"job"* (Wave 3 only; unused in Wave 2) |
| `ambiguous` | *"OpenLinker can't tell which one"* |
| `inert` / blocked | *"nothing happens until you fix this"* |
| `OrderLifecyclePhase` | *"status"* (the existing word; the phase is what feeds it) |

A copy-lint script (`scripts/check-ui-vocabulary.mjs`, §7.5) fails the build on any of the banned
words appearing in a `.tsx` string literal or a user-facing `*.copy.ts` under the three feature
folders. This is the same shape as the existing `check-sales-document-reason-mirror.mjs` gate.

**The banned list is closed and is exactly this table — nine terms, no "and other internal terms".**
A lint script cannot implement an open list, and an open list is how a gate becomes advisory:

| # | Banned term | Matched as |
|---|---|---|
| 1 | `authority` | case-insensitive word match |
| 2 | `posture` | case-insensitive word match |
| 3 | `FulfillmentWork` | exact, and the spaced form *"fulfillment work"* |
| 4 | `AvailabilityAuthority` | exact |
| 5 | `atpEffect` | exact, and the spaced form *"ATP"* |
| 6 | `phase` | case-insensitive word match |
| 7 | `Orchestrator` | case-insensitive word match |
| 8 | `Gateway` | case-insensitive word match |
| 9 | `holder` | case-insensitive word match |

Adding a tenth term is an edit to this table and to the script in the same commit; the seed issue
and this table are one list, mirror-checked against each other like every other pinned pair in the
repo.

### 2.2 Attention-worthy vs routine (#2100, binding)

Every state in S2 is classified **attention-worthy** or **routine**, and only attention-worthy
states are counted, badged red, or filterable. #2100's lesson applies verbatim: `trigger-model-manual`
is a *default*, so counting it puts a red "4,312 blocked" on a healthy install. The classification
table is §4.3, and it is a data table read by both the count query and the badge renderer — never
two independent lists.

### 2.3 Zero-config visibility

An operator who has set nothing must still be able to open S1 and read a complete, correct answer
("OpenLinker, by default" on every row). The page is **never gated on having configured anything**,
and never renders an empty state. This is the operator-facing form of the matrix's third
load-bearing property (every default is today's shipped behaviour).

---

## 3. Surface S1 — "Who decides what"

### 3.1 Placement

New route **`/settings/who-decides`**, reached from a new `SettingsPage` tile ("Who decides what").
Rationale for settings rather than a top-level nav item:

- It is read-rarely, changed-rarely, and admin-only — the exact profile of the existing
  `/settings/sales-documents` page (#2187), which this page is a sibling of and links to for A7.
- The left nav's `Operations` group is for daily work. A configuration page there competes with
  Orders for the operator's attention every day, forever, to be opened twice a year.
- The nav registry already reserves a **`Planned → Automations`** slot. S3 claims that slot (§5.1);
  S1 does not need one.

Admin-only (`@Roles('admin')` on the write endpoints; the read is available to `operator` so a
non-admin can *see* who decides what without being able to change it — matching the read-only-role
posture established in #1124/#1357).

### 3.2 Page copy and the two presets (exact operator-facing copy)

**Page furniture (verbatim; the mockup renders exactly these strings).**

| Slot | Copy |
|---|---|
| Eyebrow | `Settings` |
| Title | `Who decides what` |
| Lede | *OpenLinker, your shop, your marketplaces and your warehouse each get to decide different things. This page shows who decides what right now, and lets you hand some of those decisions to OpenLinker — or keep them where they are.* |
| Preset section eyebrow / heading | `Choose an arrangement` / `How should this work?` |
| Table section eyebrow / heading | `Right now` / `Who decides what` |
| Table section counter | `7 decisions` |
| Attention section eyebrow / heading | `Not working` / `Needs attention {N}` |
| Attention section subhead | *Only things that are stopping something. Defaults are never listed here.* |

The attention subhead is not decoration: it is §4.3's classification rule stated to the operator on
the page, which is what stops "why isn't my default listed here?" arriving as a ticket.

Rendered as three cards in a single-select radio group. The **third card is the current default and
is not a preset** — it is the pre-preset state, shown so that "I haven't chosen" is a visible,
named position rather than an absence.

---

> **Card 1 — Leave things as they are** &nbsp;·&nbsp; *badge:* `Current` (shown only while selected)
>
> Your shop and your marketplaces keep making every decision, exactly as they do now.
> OpenLinker connects them, publishes your stock and offers, files your invoices, and stays out of
> the way.
>
> *Best if:* one shop, one warehouse, and nothing about your current setup is annoying you.
>
> **Nothing changes when you pick this.** It is what OpenLinker already does.

---

> **Card 2 — Let OpenLinker decide**
>
> OpenLinker becomes the place where decisions get made: it works out how much stock you can
> safely promise, holds orders that shouldn't go out yet, and decides what happens to goods that
> come back. Your shop and your carriers still do the physical work.
>
> *Best if:* you sell the same stock on more than one channel, or you keep finding orders you
> wish had been stopped before they shipped.
>
> **What this changes:** OpenLinker starts subtracting orders it has seen from the stock numbers it
> publishes, and can hold an order so it never reaches your shop. Your existing stock, order and
> invoice flows are untouched.

---

> **Card 3 — Keep my other system in charge** &nbsp;·&nbsp; *badge:* `Not available yet`
>
> Your existing warehouse or order system keeps deciding. OpenLinker gives it marketplace
> connectivity — offers, stock publication, order feed, status relay — and files your Polish
> invoices and receipts, which it can't.
>
> *Best if:* you already run a warehouse or ERP system that you trust and don't want to replace.
>
> **What this changes:** OpenLinker stops working out your promisable stock itself and publishes
> what your system tells it. Refunds and fiscal documents stay with OpenLinker either way — only
> OpenLinker holds the credentials that can issue them.

---

Below the cards, a persistent line, always visible, never a tooltip:

> Changing this only affects what happens **from now on**. Anything already in progress — an order
> already sent to your shop, a label already bought — keeps its current arrangement until it
> finishes.

(That is the operator-facing rendering of prospective-only revocation, invariant P7.)

**Card 3 is disabled, badged `Not available yet`, with an inline reason until Wave 4** — *"Needs a
system that can take over. Connect one first."* — because the fact-producer seam it depends on is Wave-4 gated. Showing it
disabled rather than hiding it is deliberate: it tells the operator the shape of the choice, and it
is the same discipline as the composer's disabled tax-ID checkbox in #2170.

### 3.3 The "Who decides X?" table (exact copy)

Below the preset cards, always rendered, read-only in v1 (no per-authority override — §1.1). Each
row shows the **question**, the **current answer**, **why** that is the answer, and a state badge.

| Question | Answer values it can show | "Why" line when unset |
|---|---|---|
| **How much stock can we promise?** | `OpenLinker` · `My warehouse system` · `My 3PL` · `OpenLinker can't tell` | *Worked out from your stock master, minus your safety buffer. Nobody else has claimed it.* |
| **Where does an order ship from?** | `Each shop decides (nothing to route)` · `OpenLinker` · `My other system` · `OpenLinker can't tell` | *You sell from one place, so there is nothing to choose between.* |
| **Who picks and ships?** | `My shop` · `My marketplace` · `OpenLinker` · `My 3PL` · **a compound of any of these** · `OpenLinker can't tell` | *Whoever the order lands with, as it works today.* |
| **What state is an order in?** | `OpenLinker` · `My other system` · `OpenLinker can't tell` | *OpenLinker works it out from what it can see — the shipment, the invoice, any hold you placed.* |
| **What happens to returned goods?** | `OpenLinker` · `The marketplace` · `My other system` · `OpenLinker can't tell` | *Nothing decides yet — you handle returns by hand.* (until returns ship) |
| **Who issues refunds?** | `OpenLinker` — **always** | *Only OpenLinker holds the payment credentials, so only OpenLinker can do it. This one can't be handed over.* |
| **Who issues invoices and receipts?** | *(link)* `Set up under Sales documents →` | *Configured per country under Sales documents.* |

Notes that are load-bearing rather than cosmetic:

- **The refund row is rendered locked, not hidden.** A6's non-assignability is a statement of
  physical fact (§2, ADR-052) and reads as a reassurance to the operator, not a restriction. Hiding
  it would invite the question in a support ticket instead.
- **The invoicing row delegates rather than duplicates.** A7 is already fully specified and shipped
  by ADR-041/#2170; restating its answer here would create a second surface that can disagree with
  `/settings/sales-documents`. One link, no mirrored state.
- **The "why" line is the whole point of the table.** A per-row answer with no reason is a
  configuration dump. With the reason, the table doubles as the explanation of what the default
  *is*, which is what makes §2.3 (zero-config visibility) worth building.

**Compound answers (the "who picks and ships" case).** On the persona this spec designs for — one
shop plus one or two marketplaces — the truthful answer to *"who picks and ships?"* is per-order,
not a single holder. The answer is therefore a **list of holders with a scope**, rendered as a
middle dot join in the order the operator meets them (their own shop first, then each marketplace
alphabetically), with a scoped why-line. Exact copy for the 1-shop + Allegro case:

> **Answer:** `My shop · Allegro`
> **Why:** *Marketplace-fulfilled orders are picked and shipped by the marketplace. Everything else
> lands with your shop.*

The same rendering applies wherever a row resolves to more than one holder. A compound is a
**routine** answer, never attention-worthy — it is the correct description of a normal setup, not a
conflict. It is distinct from `OpenLinker can't tell`, which means two systems claim the *same*
scope and is attention-worthy (§4.2).

**`OpenLinker can't tell` is a value on every assignable row, and it swaps the why-line.** When a row
resolves ambiguous, the row renders the answer `OpenLinker can't tell` and its why-line is
**replaced by the §4.2 body copy for the matching state** (A1-U, A2-A, A3-X, A5-A) rather than the
default why-line. That is a rule, not a rendering accident: the operator reading the row is asking
exactly the question §4.2 answers, and a stale default why-line under an ambiguous answer would be a
false statement. The refund row (A6) and the invoicing row (A7) never take this value — the first
cannot be assigned, the second is answered elsewhere.

**State badge vocabulary (closed).** Every row carries exactly one badge from this list, and nothing
else:

| Badge | Tone | Means | Attention-worthy? |
|---|---|---|---|
| `Default` | neutral | Nobody has claimed this; OpenLinker's shipped behaviour answers it | No |
| `Nothing to route` | neutral | The question does not arise on this topology (A2 resolving `none`) | No |
| `Always` | info | Cannot be handed over (A6 refunds) | No |
| `Elsewhere` | neutral | Answered on another page (A7 sales documents) | No |
| `Chosen` | accent | The operator has picked a holder for this row | No |
| `Nothing is deciding` | error | Ambiguous — two systems claim it, so OpenLinker does neither | **Yes** |

`Nothing is deciding` is the only badge that is ever red, and its presence on a row implies a
matching §4.2 row in `Needs attention` — one fact, two renderings, from one source (§4.3).

### 3.4 Stories & acceptance criteria

**S1-1 — I can see who decides what, without configuring anything** *(P2, P1)*
- Given a fresh install with one shop connection and no OMS configuration,
- When I open `/settings/who-decides`,
- Then every row renders a concrete answer and a "why" line; no row is blank, "unknown", or an
  empty state; and the page never asks me to add something before it will show me anything.

**S1-2 — I pick a preset and understand what changed** *(P2)*
- Given I select **Let OpenLinker decide** and confirm,
- Then the confirm dialog lists, in plain sentences, exactly which rows changed answer and what the
  new behaviour is — generated from the diff, not from static copy;
- And after saving, the changed rows show a `Changed just now` marker and the page states that
- in-progress work is unaffected.

**S1-3 — I can go back** *(P7)*
- Given I have selected a preset,
- When I select **Leave things as they are** and confirm,
- Then every row returns to its default answer, and the confirm dialog says explicitly that orders
  already held, reservations already taken, and jobs already accepted are **not** reversed by this
  — with a link to the affected orders where any exist.

**S1-4 — I can't half-configure my way into an inert state** *(P4)*
- Given a preset selection would result in any authority resolving `ambiguous` (e.g. a second
  connection already claims the same thing),
- Then the confirm dialog blocks the save, names the conflicting connection, and states what would
  stop working — rather than saving and reporting the problem afterwards on S2.
- *(This is the one place the model's "inert and reported" is pre-empted rather than reported: at
  save time OpenLinker has both candidates in hand and the operator is present.)*

---

## 4. Surface S2 — Authority status

### 4.1 Shape and placement

**The same page**, below the who-decides table — not a separate route. Rationale: an operator who
opens the configuration page and an operator who needs to know why nothing happened are the same
person with the same question five seconds apart. Two pages guarantee one of them is stale.

The section renders as `Needs attention (N)` — a count badge in the page header, a table below,
and nothing at all when N = 0 beyond a single line: *"Everything that should be deciding something
is deciding it."*

**Second surface, always:** every attention-worthy state also renders **where the operator already
is** — a badge on the affected `/orders` row, `/products` row, or connection card, following #2100's
own treatment of `salesDocumentBlockReason` exactly. A state that only exists on a settings page is
a state nobody sees.

### 4.2 The inert states (complete for Wave 2)

Nine states. Each carries a **badge** — the short label rendered on the affected `/orders`,
`/products`, `/returns` or connection row, drawn from a closed four-value vocabulary
(`Stopped` / `At risk` / `Blocked` / `Not matched`) so a row badge is scannable without reading the
title.

| # | State | Badge | Where it comes from | Operator-facing title | Body copy | Fix |
|---|---|---|---|---|---|---|
| A1-U | **Stock we can promise is unknown** | `Stopped` | Two connections claim the same stock, or the claiming system errored | *"We don't know how much stock to publish"* | Two of your systems both say they're in charge of your stock, so OpenLinker won't guess. Publishing for these products is paused. | Name both connections; link to each; state that publishing stays paused |
| A2-A | **Two systems want to route the same orders** | `Stopped` | Two enabled routers on one source | *"Nothing is deciding where {channel} orders ship from"* | Two systems are set up to decide, so OpenLinker is doing neither. Orders are going out the way they did before. | Name both; link to each |
| A3-X | **Nobody accepted the job** | `Stopped` | Every candidate rejected or timed out | *"No one took the job for order {ref}"* | Every place that could have shipped it said no. It's waiting for you. | Link to order; show each rejection reason |
| UF-L | **Line can't be fulfilled** | `At risk` | `RoutingPlan.unfulfillable[]` | *"{n} line(s) on order {ref} can't be shipped from anywhere"* | There isn't stock for it in any place that can ship to this buyer. This is a refund or return decision, not something OpenLinker can fix. | Link to order; offer the refund/return action |
| RS-S | **We promised more than we have** | `At risk` | Reservation shortfall (I6) | *"Order {ref} is short {n} × {sku}"* | Your stock master dropped below what this order was promised. Nothing was silently reduced — this order is the one at risk. | Link to order; link to the product |
| A5-A | **Two systems want to decide returns** | `Stopped` | Two enabled returns authorities | *"Nothing is deciding what happens to returns from {channel}"* | Two systems are set up to decide, so OpenLinker is doing neither. Returns are still being recorded, but nothing is being restocked or scrapped automatically. | Name both |
| RB-L | **Restock was refused** | `Blocked` | `restock_blocked` (T5) | **Copy owned by the returns spec §5.4** — imported, never restated (see below) | | Link to the return; name the system |
| OR-P | **Return with no order** | `Not matched` | Orphan return (T2) | **Copy owned by the returns spec §5.5** — imported, never restated (see below) | | Link to the return |
| **AF-X** | **An automation couldn't finish** | `Stopped` | An automation step returned a failure (§5.3, §5.6) | *"Couldn't buy the label for order {ref}"* — one title per action, the action's own verb | The automation '{rule name}' tried and {reason from the underlying operation}. Nothing else in that automation ran, so {source} has not been told. The order is waiting for you. | Link to the order; link to the rule; `Try again` |

**AF-X is the automation-failure state, and it is not optional.** §1.1 and S2-1 commit to *"nothing
ever fails silently"*, and an automation is the one place in Wave 2 that spends money without an
operator present. A failed action landing only in a per-rule log — inside a page nobody has open —
is the same silent decline the #2100 lineage exists to forbid, one surface down. The multi-step
"stop on first failure" rule makes it sharper: when step 1 fails, step 2 (*"tell the marketplace"*)
never runs, so the marketplace still shows the order unshipped and the operator has **no** signal at
all unless this state exists. Rules:

- One AF-X row per failed **firing**, not per rule and not per step; the body names the step that
  failed and states which later steps were skipped.
- The title is the action's own verb — *"Couldn't buy the label for order {ref}"*, *"Couldn't issue
  the invoice for order {ref}"*, *"Couldn't tell {source} about order {ref}"*, *"Couldn't send the
  email for order {ref}"*, *"Couldn't put order {ref} on hold"*, *"Couldn't lift the hold on order
  {ref}"* — because "an automation failed" tells the operator nothing about what to do next.
- The reason is **the underlying operation's own reason**, passed through verbatim and attributed
  (*"Allegro said: …"*, *"DPD said: …"*), never a re-worded summary. The same discipline as the
  returns spec's `rawStatus` treatment.
- It clears when the firing is retried successfully, or when the operator dismisses it with an
  explicit *"I handled this myself"* — never on a timer, and never because a later, unrelated firing
  of the same rule succeeded.

**RB-L and OR-P copy is imported, not restated (canonical owner: the returns spec).** Both states are
owned end-to-end by the returns feature, and S2-1 requires *one* copy source with the same title in
both places. The canonical strings live in the **returns product spec §5.4 (`restock_blocked`) and
§5.5 (orphan)**, and this surface imports them from the returns copy module rather than keeping its
own variant. The mirror check that S2-1 mandates covers **both** feature folders, so a divergence
fails the build rather than shipping as two truths. For the reader's convenience, the imported
titles are *"Stock was not added."* (RB-L) and *"This return is not matched to an order."* (OR-P) —
but the returns spec is the record, and if this line ever disagrees with it, the returns spec wins.

**No state is written around `{location}`.** §1.2 designs for a single-location seller, for whom a
location name is a concept that does not exist and would render as an id or an empty string. A1-U's
copy is therefore written around the **systems** that disagree, which is the fact the operator can
act on. Where a deployment genuinely has more than one location, the location name is appended to
the body as a trailing clause (*"… in charge of your stock at {location}"*) — additive, never the
subject of the sentence.

### 4.3 Attention-worthy vs routine classification

**Attention-worthy** (counted, badged `danger`/`warning`, filterable): every row in §4.2, AF-X
included. A failed automation action is attention-worthy by the same rule that makes a blocked
sales document attention-worthy — OpenLinker was asked to do something, did not do it, and no other
surface says so.

**Routine** (rendered on the row it applies to, never counted, never red, never filterable):

- *"OpenLinker decides this, by default"* — the zero-config answer on every who-decides row.
- *"Nothing to route — you ship from one place"* — A2 resolving `none` on a single-location install.
- *"Waiting for the marketplace to ship it"* — observation-only work on `omp_fulfilled` (R10).
- *"You handle this by hand"* — any decision the operator has deliberately left with a manual
  trigger model.
- *"{system A} · {system B}"* — a compound answer on a who-decides row (§3.3). Two systems handling
  *different* orders is a description of a normal setup; only two systems claiming the *same* scope
  is a problem.
- An automation that ran and **did nothing because no rule matched**. Not-firing is the normal case,
  and counting it would put a number on every install with a narrow rule.

The #2100 precedent is exact and this is where it bites hardest: **A2 `none` is the default on the
majority topology.** Counting it would put a permanent red number on every single-location install
on the day Wave 2 ships. It is not a problem; it is the correct answer to a question that doesn't
arise.

**One table, two readers.** The classification above, the §4.2 badge column and the §3.3 state-badge
vocabulary are read by the count query, the settings-page renderer and the row-badge renderer from
**one** declared data table. Three independent lists is how a state ends up counted in one place and
invisible in another.

### 4.4 Stories & acceptance criteria

**S2-1 — Nothing ever fails silently** *(P4)*
- Given any of the nine states in §4.2 exists,
- Then it appears in `Needs attention` **and** as a badge on the affected order/product/connection
  row, with the same title text in both places (one copy source, mirror-checked like #2100's
  reason mirror).

**S2-2 — The healthy install stays quiet** *(#2100)*
- Given a single-location install with no OMS configuration and 4,000 orders,
- Then `Needs attention` shows 0, no red badge appears on any order row, and the who-decides table
  renders every row with a neutral tone.

**S2-3 — I can tell "not set up" from "broken"**
- Given a state is routine,
- Then it never contributes to the attention count and never uses the `danger` or `warning` tone;
- Given a state is attention-worthy,
- Then its copy states what is *not happening as a result*, in a sentence, before offering a fix.

**S2-4 — Every attention row names a next action**
- Given any row in §4.2,
- Then it links to the object it is about, and states either the exact fix or, where OpenLinker
  cannot fix it (RB-L, UF-L), where the operator must go instead.

**S2-6 — A failed automation is visible where the operator already is** *(AF-X)*
- Given an automation step fails,
- Then an AF-X row appears in `Needs attention`, a `Stopped` badge appears on the affected order
  row, and the order's activity timeline (§5.6) names the rule, the step, the failure reason and
  the steps that were skipped;
- And the automation's own rule page shows the same firing with the same reason — one record, three
  renderings, never three independent writes.

**S2-5 — An unrecognised state degrades safely**
- Given a persisted reason this build's UI does not recognise,
- Then it renders neutrally with its raw value and is **not** counted — the #2100 `IN`-list
  behaviour, restated as a requirement rather than inherited by accident.

---

## 5. Surface S3 — Automation v1

### 5.1 Placement

Claims the reserved **`Planned → Automations`** nav slot (`nav-registry.ts`), promoting it to a real
route **`/automations`** in the `Operations` group. This is a daily-relevance surface (the operator
will check "did my rules fire?"), unlike S1, which is why it earns nav space where S1 doesn't.

**First run — the zero-rules state (exact copy).** On a fresh install the index would otherwise
render eight triggers with `0 rules` each: technically complete, and useless as a starting point.
Instead the page leads with a single card above the trigger index:

> **You have no automations yet.**
> Most sellers start with this one:
>
> **When an order is marked packed → buy the shipping label → tell the marketplace.**
> One click at the packing bench instead of three, and the marketplace hears about it straight away.
>
> `[Set this up]`   `[Start from scratch]`

`Set this up` opens the composer **pre-filled** with T5 → A2 → A3, no conditions, inactive, and
still subject to the §5.7 S3-2 arming gate — the operator reviews and arms it, exactly as if they
had built it. It is a suggestion, never a rule that exists before the operator saved it: nothing is
created by opening the page.

Exactly **one** suggestion is offered, deliberately. A gallery of prebuilt recipes is a content
surface with its own maintenance cost, and §5.4 already names T5→A2→A3 as *"the automation that
justifies the wave"* — so the honest first-run page recommends that one and gets out of the way.
The card disappears permanently once any rule exists (active or not); it never returns after the
operator deletes their last rule, because at that point they know what the page is for.

### 5.2 The v1 trigger set (exactly 8)

**Admission rule:** a trigger is admissible only if it names a fact OpenLinker **persists**, at a
grain OpenLinker **writes**, in a wave that has **already shipped** by Wave 2. No derived-with-a-clock
facts, no facts produced by a gated wave.

| # | Trigger | Operator-facing name | Backing persisted fact | Fires | Available from | Parameters |
|---|---|---|---|---|---|---|
| T1 | `order.hold.placed` | *"An order is put on hold"* | `order_holds` insert (Wave 2, L4) | `edge` | Wave 2 | hold reason (any / specific) |
| T2 | `order.hold.released` | *"A hold is lifted"* | `order_holds.releasedAt` (Wave 2) | `edge` | Wave 2 | hold reason |
| T3 | `order.on_hold_for` | *"An order has been on hold for too long"* | `order_holds.placedAt`, open row | `deadline sweep` | Wave 2 | N (hours/days) |
| T4 | `order.dispatch_deadline_near` | *"A marketplace dispatch deadline is close"* | `order_records.dispatchByAt` (**persisted today**, inert; L9) | `deadline sweep` | Wave 1a | X (hours before) |
| T5 | `order.packed` | *"An order is marked packed"* | `order_records.packedAt` (Wave 0, L0 — the only demand-backed ask on record) | `edge` | Wave 0 | — |
| T6 | `return.received` | *"Returned goods arrive"* | `ReturnLine.quantityReceived` > 0 (Wave 2, T4) | `edge` | Wave 2 | — |
| T7 | `return.disposed` | *"A return is restocked or scrapped"* | disposition recorded (Wave 2, T5) | `edge` | Wave 2 | disposition (any / restock / scrap) |
| T8 | `inventory.reservation_shortfall` | *"We've promised more of something than we have"* | shortfall fact on a named order (Wave 2, I6) | `edge` | Wave 2 | — |

**Firing semantics — the two kinds, stated per trigger.** Without this, a *standing condition* like
T8 (a shortfall is true until somebody fixes it) is a level-triggered fact that a naive
implementation re-evaluates every recompute and emails about hourly, forever.

**`edge` — fires on the transition, once per transition.** T1, T2, T5, T6, T7, T8. The firing is
caused by the *write* that creates the fact, so re-reading, re-ingesting or re-computing the same
fact fires nothing. Concretely:

- **T1 / T2** fire per `order_holds` row, so hold → release → hold **does** fire T1 twice: those are
  two distinct holds and the second one is a real new fact.
- **T5** fires on the transition of `packedAt` from null to a value. Re-writing `packedAt` (a
  correction to the timestamp, or a re-pack) does **not** re-fire — the fact "this order got packed"
  happened once, and re-buying a label because someone fixed a typo is exactly the failure mode this
  rule prevents.
- **T6 / T7** fire per receive/dispose *act*, so a return received in three parcels fires T6 three
  times. That is intended: each is a real arrival.
- **T8** fires on the transition into shortfall for a given (order, sku) — **not** on every
  recompute while the shortfall persists. It re-fires only if the shortfall clears and then recurs.

**`deadline sweep` — fires when a clock crosses a persisted timestamp.** T3 and T4 only. There is no
event to hang these on: the fact is "time has passed", so a periodic evaluator is required. Rules:

- **Cadence: every 15 minutes**, one bounded, resumable sweep per rule set, sharing the shape of the
  existing bounded sweeps rather than inventing a scheduler.
- **At most once per (rule, order), ever.** The firing is recorded, and the recorded firing is what
  makes the next sweep skip that pair. A duration trigger whose condition stays true for three days
  must not fire 288 times.
- The parameter is a **threshold**, not a schedule. *"On hold for more than 48 hours"* fires once,
  the first time a sweep observes an open hold older than 48 hours. It does not fire again at 72.
- A rule edited to a **shorter** threshold may fire for orders that already passed the old one; a
  rule edited to a **longer** one never un-fires. Editing a rule does not erase its firing record.

**Rules are never retroactive.** A rule created today acts only on facts that occur after it was
saved — a new rule does not fire against the 40 orders already on hold, and a `deadline sweep` rule
does not fire for a pair whose deadline was crossed before the rule existed. This is stated to the
operator in the composer, not only here (§5.5):

> *An automation only acts on things that happen after you save it.*

That sentence is load-bearing: the opposite expectation ("I'll set this up and it'll clean up my
backlog") is the single most likely first-use surprise, and it would surprise them by spending
money on 40 labels.

**Pruned, with reasons** (recorded so the next reader doesn't re-propose them):

- **`work.short_picked`** *(named in the design's own Wave-2 sketch)* — **cut.** `FulfillmentWork`
  does not exist until Wave 3, and Wave 3 is demand-gated. A trigger whose backing object may never
  ship would be dead configuration in the composer's dropdown from day one, and would have to be
  rendered disabled-with-a-caveat forever. Re-admit it with Wave 3a.
- **`order.phase_held_for_N_days`** *(the design's phrasing)* — **narrowed to T3.** The derived phase
  carries **no clock and no entered-at timestamp** by construction (§6.3: *"a phase fed by `now` is
  uninvalidatable"*), so "the phase has been X for N days" is not computable from anything persisted.
  `order_holds.placedAt` **is** persisted, and "on hold for N days" is what the operator actually
  meant. This is a correctness prune, not a scope prune — the original phrasing describes a fact OL
  does not have.
- **`order.routed`** — Wave 3, same reason as `work.short_picked`.
- **`order.status_changed`** *(the obvious BaseLinker-shaped trigger)* — **cut from v1.** Source
  status is a pass-through string that re-arrives on every poll; a trigger on it fires on
  re-ingestion noise, and the deduplication story is a wave of its own. The derived phase is the
  right basis and it needs an entered-at fact OL has decided not to persist (§10, Decision log).

### 5.3 The v1 action set (exactly 6)

**Admission rule:** an action is admissible only if it invokes an operation OpenLinker **already
ships end-to-end**, with its own idempotency and failure handling already solved.

| # | Action | Operator-facing name | Underlying shipped operation | Reversible? |
|---|---|---|---|---|
| A1 | `issue-sales-document` | *"Issue the invoice or receipt"* | ADR-041 routing + `InvoiceService.issueInvoice` / fiscalization; #2047 one-document guard applies unchanged | **No** — fiscal |
| A2 | `dispatch-shipment` | *"Buy the shipping label"* | `ShipmentDispatchService` (ADR-012) | **No** — money + carrier |
| A3 | `relay-status-to-source` | *"Tell the marketplace"* | `OrderStatusWriteback` relay (#1157/ADR-027) | No (but harmless to repeat) |
| A4 | `send-email` | *"Send an email"* | existing `MailerPort` + a template; recipient = **buyer** or **a fixed address you enter** | No (but recoverable) |
| A5 | `place-hold` | *"Put the order on hold"* | `order_holds` (Wave 2); reason required | **Yes** |
| A6 | `release-hold` | *"Lift the hold"* | `order_holds.releasedAt` (Wave 2); note required | **Yes** |

**Pruned, with reasons:**

- **`mark-packed`** *(listed in the brief)* — **cut, on principle.** `packedAt` + `packedByUserId`
  record that **a named human packed a physical box**. An automation writing it would put a user id
  (or a null) against an event that did not happen, and the column's entire value is that it is
  trustworthy. Automating an assertion about the physical world is the one thing this layer must
  never do.
- **`propose-credit-note`** — **deferred to v1.1.** The correction proposal (T7) is real Wave-2
  functionality, but the design is explicit that it must render its positional ambiguity for
  operator confirmation and must never auto-issue. An automation that creates confirmable proposals
  is defensible; it needs the proposal inbox UI first, which is not in Wave 2's scope.
- **`adjust-stock` / `restock`** — **cut.** Restock is already the automatic consequence of
  disposition (T5); a second path to the same write is how double-restock bugs get built.
- **`call-a-webhook`** — cut, see §6 non-goals.

### 5.3b Action parameters (exact controls, defaults and copy)

Every action needs configuration, and none of it can be guessed at runtime — `ShipmentDispatchService`
does not pick a carrier for you. This is the largest copy surface in S3 and it renders inside the
composer where `( action parameters render here )` appears.

**A1 — *"Issue the invoice or receipt"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| — | none | — | *"Which document gets issued, and by which provider, is decided by your Sales documents rules. This automation only decides **when**."* + link to `/settings/sales-documents` |

A1 deliberately takes **no** parameters. ADR-041 routing already owns document-kind selection, and a
second place to choose it is a second answer that can disagree with the first.

**A2 — *"Buy the shipping label"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| Carrier | select, from the connection's configured carriers | none — **required** | *"Which carrier account to buy from."* |
| Service | select, from that carrier's services | the carrier's own default service where it declares one, else required | *"The service level. If your carrier only offers one, this is filled in for you."* |
| Package | select from saved package presets, or *"Use the order's own weight and size"* | *"Use the order's own weight and size"* | *"What to declare to the carrier. If the order has no weight, buying the label will fail — pick a preset instead."* |
| Cash on delivery | checkbox, disabled with a reason unless the carrier supports it | off | *"Collect the order total from the buyer on delivery."* |

A2 is the money-spending action; its parameter block carries a standing line: *"Every time this
runs, it buys a label and you are charged for it."*

**A3 — *"Tell the marketplace"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| What to tell them | fixed: *"that the order has shipped, with the tracking number if there is one"* | — | *"OpenLinker relays what it knows. If no label has been bought yet, the marketplace is told the order shipped without a tracking number."* |

No selectable status vocabulary: the relay is the shipped `OrderStatusWriteback` path, and inventing
a status picker would be the "states yes" boundary this design refuses.

**A4 — *"Send an email"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| To | radio: *"The buyer"* / *"A fixed address"* (+ text input) | *"A fixed address"* | *"Emails to the buyer are sent from your configured sender address."* |
| Subject | text, merge fields allowed | *"Order {order.reference}"* | — |
| Body | textarea, merge fields allowed, plain text | empty — **required** | *"Use the fields below to drop in order details. Anything else is sent exactly as you type it."* |

**Merge fields — a closed list of nine, and nothing else.** An open templating surface is a scripting
language, which §6 refuses. An unrecognised `{…}` is rendered **verbatim** as typed, never blanked —
blanking silently produces an email that reads as broken, and a visible `{ordr.reference}` is a typo
the operator can see and fix.

| Field | Renders |
|---|---|
| `{order.reference}` | the order's operator-facing reference |
| `{order.source}` | the channel name (*"Allegro"*) |
| `{order.total}` | the gross total with its currency |
| `{order.placedAt}` | the order date, in the operator's locale |
| `{order.dispatchBy}` | the marketplace dispatch deadline, or *"no deadline"* |
| `{buyer.name}` | the buyer's name as the source reported it |
| `{shipment.tracking}` | the tracking number, or *"not yet"* |
| `{hold.reason}` | the current hold's reason, or *"no hold"* |
| `{rule.name}` | the automation's own name |

**A5 — *"Put the order on hold"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| Reason | select, from the closed hold-reason union (§7.4) — **the only source** | none — **required** | *"Why it's being held. The operator who finds it sees this."* |
| Note | text, merge fields allowed | *"Placed by the automation '{rule.name}'."* | *"Added to the hold record."* |

The reason list is the design's merged union verbatim. The composer cannot add a reason, and an
operator who needs one that does not exist is asking for a design change (§7.4).

**A6 — *"Lift the hold"***

| Parameter | Control | Default | Copy |
|---|---|---|---|
| Which hold | select: *"Any hold"* / a specific reason | *"Any hold"* | *"Which hold to lift, if the order has more than one."* |
| Note | text, merge fields allowed, **required** (mirrors the manual release) | empty | *"Why it's being lifted. Required, the same as when you lift a hold by hand."* |

### 5.4 The legality matrix (which action may follow which trigger)

Not every pair is meaningful, and offering a meaningless pair is how an operator builds a rule that
silently never fires. The composer offers **only legal pairs**, from one declared table:

| | A1 invoice | A2 label | A3 relay | A4 email | A5 hold | A6 release |
|---|---|---|---|---|---|---|
| T1 hold placed | — | — | — | ✓ | — | — |
| T2 hold released | ✓ | ✓ | ✓ | ✓ | — | — |
| T3 on hold too long | — | — | — | ✓ | — | ✓ |
| T4 deadline near | — | ✓ | — | ✓ | — | — |
| T5 packed | ✓ | ✓ | ✓ | ✓ | — | — |
| T6 return received | — | — | — | ✓ | — | — |
| T7 return disposed | — | — | ✓ | ✓ | — | — |
| T8 shortfall | — | — | — | ✓ | ✓ | — |

Two of these are the load-bearing ones, and both should be read as the product:

- **T5 packed → A2 label → A3 relay** is "I packed it, buy the label and tell Allegro" — one click
  becomes zero. This is the automation that justifies the wave.
- **T4 deadline near → A4 email(operator)** is the marketplace-penalty story (L9), and it works on
  data OpenLinker has persisted and left inert for a year.

### 5.5 Composer UX — **mirror #2161**, with three declared divergences

The #2161/#2170 composer is the house pattern and this design adopts it: a **scope index table** →
per-scope dialog → **rule composer dialog** with an AND-ed list of closed-vocabulary conditions, a
declared outcome, effective-from/to dates, and a save-time conflict guard over a canonicalized
conditions hash. Concretely reused, not re-invented:

- The **condition shape**: a discriminated union on `field`, each field carrying exactly the
  comparison shape it needs; a runtime `is*Condition` narrower that treats a malformed persisted
  condition as *never matches* rather than throwing; `canonicalize*` + `compute*ConditionsHash`
  for the save-time duplicate guard.
- **No priority number.** #2170 deliberately removed it, and the reasoning transfers: a priority
  field is a silent tie-break, and a silent tie-break on an action that spends money is exactly what
  the #2047 lineage exists to prevent.
- **AND-only conditions**, with the shipped footer sentence used **verbatim** — *"Every added
  condition must ALL be true for this rule to match (AND)."* (`sales-document-rule-composer-dialog.tsx:246`,
  minus its trailing sentence about the cross-country `field` vocabulary, which is specific to the
  sales-documents matrix and has no counterpart here). No OR, no grouping, no negation. This is the
  one string a spec claiming to mirror #2161 must copy exactly rather than paraphrase, and it is the
  same string in the prose here and in the skeleton below.
- **Effective from / to** on every rule, filtered against an explicitly-supplied `now`.
- The **index-table shape** of `sales-document-country-index.tsx`: scannable, one status badge per
  row, a `Configure` action reaching one callback, and an add-row that costs the same number of
  clicks for a new scope as for an existing one.

**Divergence 1 — the scope axis is the trigger, not the country.** #2161 indexes by country because
the law is the scoping axis. Here the operator's mental model is *"when X happens, do Y"*, so the
index lists the **8 triggers**, each row showing rule count / last fired / status, and `Configure`
opens that trigger's rule list. A country index would be a category error.

**Divergence 2 — the condition vocabulary is different, and carries inline values.** v1 fields:

| Field | Op | Value |
|---|---|---|
| `sourceConnection` | `eq` | a connection (select) |
| `orderCountry` | `eq` | ISO-3166-1 alpha-2 (typed) |
| `orderTotalGross` | `gte` \| `lt` | **inline amount + currency** |
| `holdReason` | `eq` | one of the closed hold-reason values *(only offered for T1/T2/T3)* |

`orderTotalGross` carries an **inline literal**, where #2161 structurally forbids one and forces a
`thresholdRef`. That is not sloppiness: #2161's threshold indirection exists so a **legal** amount
can version independently of the rules citing it. An automation threshold ("email me about orders
over 2,000 PLN") has no legal-matrix versioning concern, and forcing the operator through a
separate thresholds table to author one would be ceremony imported from a constraint that doesn't
apply here. **Currency mismatch resolves the same way it does in #2161**: no conversion, ever — the
rule simply does not match, and the operator is told why on the rule row. (The ADR-040 FX stamp is
analytics-only and must not be reached for; the fact that automation is not a fiscal path does not
make a silently-converted comparison acceptable.)

**Divergence 3 — multiple rules may fire, *except* for irreversible actions.** #2161 resolves
at-most-one and reports `unresolved` on two matches, because two fiscal documents for one sale is
an unrecoverable legal event. Automation is asymmetric: sending two emails is recoverable; buying
two labels is not. So:

- For **reversible/repeatable actions** (A3, A4, A5, A6): every matching rule fires. Two rules that
  both send an email send two emails, which is what the operator asked for.
- For **irreversible actions** (A1 `issue-sales-document`, A2 `dispatch-shipment`): the #2047 rule
  applies **verbatim** — at most one may resolve; two matching rules resolve `ambiguous`, **nothing
  fires**, and the reason is persisted on the order and surfaced on S2. The save-time guard warns at
  authoring time where it can see the overlap; the runtime guard is the authority.

This split is the single most important design decision in S3, and it is a direct application of
the model's own rule: *an unrouted order is recoverable, a double-shipped one is not.*

**Composer copy skeleton** (dialog title *"Add automation"*):

```
When   [ An order is marked packed              ▾ ]
       ( trigger parameters render here, if any )

Only if  [ Marketplace is        ▾ ] [ Allegro          ▾ ]   [× ]
         [ Order country is      ▾ ] [ PL               ]     [× ]
         + Add condition
         Every added condition must ALL be true for this rule to match (AND).

Then   [ Buy the shipping label   ▾ ]
       ( action parameters render here )
       + Add step        ← max 3 steps, run in order, stop on first failure

Active from [ 2026-09-01 ]   until [           ] (optional)
       An automation only acts on things that happen after you save it.

                                        [ Cancel ]  [ Save automation ]
```

**Multi-step is capped at 3 and stops on first failure.** The T5→A2→A3 story needs two steps; three
is one step of headroom. Unbounded chaining is a scripting language with extra clicks.

### 5.6 Dry run, and automation history (three surfaces)

An operator who discovers a wrong outcome starts **from the order**, not from a rule they do not yet
suspect. A per-rule log is the only surface that assumes the operator already knows which rule to
blame — which is precisely the thing they are trying to find out. Automation history therefore lands
in three places, from one record.

**(a) "Test on a recent order" — before it is armed.**
Pick any order from the last 30 days, and the composer shows whether each condition matched and
whether the rule would have fired, without doing anything. This is the same instinct as the router's
`evaluate()` dry-run being called OL's differentiator (§5.3), applied at the layer the operator
actually touches. An automation that spends money and cannot be tested before it is armed will not
be armed. (The gate itself, and its fallback where no order matches, is S3-2 in §5.7.)

**(b) The order activity timeline — where the operator actually looks.**
**Every** automation firing writes an event to the affected order's `OrderActivityTimeline`, using
its existing `TimelineEvent {id, timestamp, title, by, description, tone, footer}` shape — the same
device the returns spec uses to make `by` carry the difference between an operator act and an
observation. One event per **step**, so a two-step rule writes two events in order.

| Field | Value |
|---|---|
| `by` | `Automation · {rule name}` — the rule name is a link to the rule |
| `title` | The action's own past-tense verb: *"Bought the shipping label"* · *"Issued the invoice"* · *"Told Allegro the order shipped"* · *"Sent an email"* · *"Put the order on hold"* · *"Lifted the hold"* |
| `description` | What the step actually produced, in operator vocabulary: *"DPD, tracking 000340512..."*, *"To warehouse@example.com"*, *"Reason: awaiting payment"* |
| `footer` | *"Ran because: {trigger, in the operator-facing name from §5.2}"* — e.g. *"Ran because: an order was marked packed"* |
| `tone` | neutral on success; **error** on a failed step, whose `title` becomes the AF-X title (§4.2) and whose `description` carries the underlying reason verbatim, attributed |

A failed step also writes one further event stating what did **not** run — *"Skipped: tell the
marketplace"*, footer *"The automation stopped after the step that failed."* — because a silently
missing step is indistinguishable from a step that was never configured.

Timeline events are written for **firings only**. A rule that evaluated and did not match writes
nothing: an order that matched no rule would otherwise accumulate one line per rule per event,
forever, and drown the timeline the feature exists to make readable.

**(c) `/automations/activity` — the global run log.**
The cross-rule counterpart to `/sync/jobs`, and the answer to *"what has been happening?"* when the
operator does not have a specific order in hand. Reached from `/automations` (a `Run log` action in
the page header) and from every rule page (`See all runs for this rule →`, which opens it
pre-filtered).

- **Placement:** a child route of `/automations`, in the `Operations` group; not a nav entry of its
  own (the parent already has one).
- **Columns:** `When` (`TimeDisplay`, relative with absolute on hover — default sort, descending) ·
  `Automation` (rule name, links to the rule) · `Trigger` (operator-facing name) · `Order / Return`
  (links to the object) · `What it did` (one line per step, in order, each with a tick or a cross) ·
  `Outcome` (`Done` / `Failed` / `Nothing to do` / `Blocked`).
- **Filters, all URL params:** `ruleId`, `trigger`, `outcome`, `from` / `to`, `orderId`. Same
  `FILTER_PARAMS` + `hasActiveFilters` + one-call `clearAllFilters` convention as the orders list;
  an unrecognised param value is ignored, never thrown.
- **A run row links to three things**: the order or return it acted on, the rule that fired, and —
  where the step dispatched a job — the `sync_jobs` row, so the existing job detail remains the
  place technical failure detail lives rather than being re-rendered here.
- **Outcome vocabulary is closed and honest.** `Blocked` is the #2047 two-money-rules case (§5.5
  divergence 3) — nothing ran, and the row says which rules collided. `Nothing to do` is a rule that
  fired and found the work already done (the label already bought). Neither is `Failed`, and neither
  is attention-worthy.
- **Retention:** runs are kept for 90 days, stated on the page footer (*"Runs older than 90 days are
  removed."*), so an empty older window is a known fact and not a suspected data loss.

**Per-rule fired log.** Each rule page keeps its last-50 view — the same records, pre-filtered — and
a deactivated rule keeps it (S3-6). Backed by `sync_jobs` where the action dispatches a job
(A1/A2/A3) and by the `automation_runs` table otherwise (§7.2); the run row is written **either
way**, so the log is complete rather than complete-for-some-actions.

**One record, four readings.** The timeline event, the run-log row, the per-rule log and the AF-X
attention state (§4.2) are renderings of **one** persisted run record. They cannot be four writes:
that is how a firing shows as succeeded in one place and failed in another.

### 5.7 Stories & acceptance criteria

**S3-1 — Label-and-tell** *(P8)*
- Given I create: **when** an order is marked packed, **only if** marketplace is Allegro, **then**
  buy the shipping label **and** tell the marketplace,
- When I mark an Allegro order packed,
- Then a label is bought and the marketplace is notified, and both appear in the rule's fired log
  linked to that order.

**S3-2 — I can test before I arm it, and I am never locked out of arming it**
- Given a draft automation whose action spends money (A1, A2), **and at least one order from the
  last 30 days matches its conditions**,
- Then the composer requires me to run a test against one of those orders before `Save` is enabled,
  and shows me the result of every condition;
- Given **no** order from the last 30 days matches its conditions (a new install, or a marketplace
  with no recent orders),
- Then the gate becomes an explicit acknowledgement instead of a test — the composer states:
  *"No order from the last 30 days matches these conditions, so this can't be tested yet. This
  automation will buy labels with real money the first time it matches."* — with a required
  checkbox, *"I understand this will spend money without having been tested"*, and `Save` enabled
  only once it is ticked;
- And the acknowledgement is recorded on the rule (who, when) and shown on the rule row until the
  rule's first successful firing, so an untested money rule is visible rather than
  indistinguishable from a tested one.
- *(Without this fallback the gate is unsatisfiable forever on exactly the installs that most need
  the automation — which would make the safety device a lock-out.)*

**S3-3 — Two money rules never both fire** *(#2047)*
- Given two active automations that would both buy a label for the same order,
- Then neither fires, an attention-worthy state appears on the order and on S2 naming both rules,
  and the label is not bought.

**S3-4 — Two emails do both fire**
- Given two active automations that would both email the buyer,
- Then both send, and neither is reported as a conflict.

**S3-5 — A rule that can never match says so**
- Given a rule whose threshold currency does not match any order in the selected marketplace's
  currency, or whose conditions are impossible,
- Then the rule row renders a warning stating that it has never matched an order, with the reason —
  following the #2170 composer's disabled-with-a-caveat precedent for `buyerHasTaxId`.

**S3-6 — Disarming is one click**
- Given any active automation,
- Then I can deactivate it from the list without deleting it, and a deactivated rule keeps its
  fired log.

**S3-7 — A failed action is never silent** *(AF-X, §4.2)*
- Given an automation step fails,
- Then an AF-X attention row exists, a `Stopped` badge appears on the affected order row, the order
  timeline carries an error-toned event naming the step, the reason (verbatim from the underlying
  operation, attributed) and the steps that were skipped, and the run appears in
  `/automations/activity` with outcome `Failed`;
- And the AF-X row offers `Try again` and a link to the rule;
- And nothing about the failure is discoverable **only** inside the rule page.

**S3-8 — I can find the automation from the order** *(journey: an automation did something wrong)*
- Given an order that an automation acted on,
- When I open the order,
- Then its timeline names the rule, the trigger, the timestamp and the outcome of each step, and
  links to the rule — so that turning the rule off (S3-6) is reachable from the order without
  knowing which rule to suspect first.

**S3-9 — A new rule does not act on my backlog** *(§5.2)*
- Given 40 orders already on hold and a rule created now on T3 (*"an order has been on hold for too
  long"*),
- Then no firing occurs for any hold placed before the rule was saved, the composer stated this
  before I saved, and `/automations/activity` is empty for that rule.

---

## 6. Non-goals (explicit, so silence isn't read as oversight)

**Hard non-goals — recommend never:**

- **Free-form conditions or scripting.** No expression language, no JS, no templating beyond
  named merge fields in the email body. The condition vocabulary is closed and every value is
  either a select or a typed literal against a declared type. This is the *"actions yes, states
  no"* boundary from ANALYSIS-1032, applied one layer up.
- **Automating an assertion about the physical world.** `mark-packed`, `mark-received`,
  `mark-inspected` — anything whose value is that a named human did it. (§5.3.)
- **An automation that can issue a second fiscal document.** A1 runs *through* ADR-041 routing and
  the #2047 guard, never around them.
- **Cross-order triggers.** "When 5 orders are held", "when a product runs out across all orders" —
  aggregate triggers need a windowing model, a debounce model and an "is it still true?" re-check,
  none of which exist. Every v1 trigger fires on exactly one order or one return.
- **External webhooks / HTTP-call actions.** An outbound call to an operator-supplied URL is a new
  egress surface with its own auth, retry, secret-storage and SSRF story. It is also the single
  most-requested automation feature everywhere it exists, so this needs to be a deliberate
  refusal-for-now with a named prerequisite (a credential store for operator-supplied endpoints),
  not an omission.

**Gated / deferred:**

- Per-authority override on S1 — **only** when a real operator need cannot be expressed as a third
  preset (the design's own rule; §1.1).
- `work.short_picked` and `order.routed` triggers — with Wave 3a.
- `propose-credit-note` action — v1.1, after the proposal inbox.
- **Calendar / time-of-day schedules** ("every morning at 8", "every Monday") — a different
  scheduler shape, and a different mental model: a schedule runs whether or not anything happened.
  Not v1. This is **not** a refusal of the `deadline sweep` mechanism (§5.2), which fires against a
  persisted per-order timestamp and is what T3 and T4 are built on.
- Bulk preset switching across many connections at once (open question 1 in the design).

---

## 7. Boundaries with other work

1. **Routing rules are plugin-owned; this spec neither stores nor edits them.** S1 renders *which*
   system routes; it never renders or edits the router's filter/sort list. Routing-rule storage
   lives in `@openlinker/oms` per design §5.3 / REVIEW H7 (the Wave-3a work), **not** with #2298 —
   #2298 is a docs-reconciliation task whose only bearing here is whether the merged #2161
   rule-engine *shape* is reused for those rules. Where this spec meets that work: S1's A2 row must
   be able to read a resolved answer shaped `{ holder, reason }` from the routing layer, and
   **that read is an obligation this spec places on Wave 3a's routing work** — it is named in
   §3.3's A2 row, and an issue must carry it, or the row silently degrades to `OpenLinker can't
   tell` on every install that configures a router.
2. **Automation storage is proposed here, and should mirror #2161's table shape**: an
   `automation_rules` table with `trigger`, `conditions jsonb`, `actions jsonb`, `conditionsHash`,
   `effectiveFrom/To`, `active`, plus an `automation_runs` log (one row per firing, carrying the
   per-step outcomes) that is the single record behind all four history renderings in §5.6, and a
   small `automation_trigger_firings` record making the §5.2 at-most-once-per-(rule, order) rule
   for `deadline sweep` triggers enforceable rather than aspirational. Same canonicalize+hash
   duplicate guard, same "malformed row never matches" narrowing. **Flagged as a proposal** — the
   Wave-2 engineering agent owns the final schema.
3. **A7 stays with sales-documents.** One link, no mirrored state (§3.3).
4. **The hold vocabulary is the design's merged union** (adjudication #4) and this spec adds no
   value to it. If the composer needs a hold reason not in the union, that is a design change, not
   a UI change.
5. **The copy-lint gate** (§2.1) is a new `check:invariants` entry and needs an issue of its own.

---

## 8. Open product questions (for the owner)

1. **Is the automation bet accepted?** (§1.3.) S1 and S2 are cost-of-shipping-Wave-2 and need no
   demand justification. S3 is a strategic bet on market signal, not on a named seller. If the
   answer is no, Wave 2 still ships coherently — S3 drops out cleanly and the phase stays plumbing,
   which is the honest cost of saying no.

That is the only question still open for the owner. Two earlier entries here — *"do we persist a
phase-entered timestamp?"* and *"card 3 disabled, or absent?"* — were **settled** and are now
recorded in the Decision log (§10) rather than re-opened; the body of this spec already implements
both answers.

---

## 9. Definition of done

Split deliberately: the first list is checkable on the day the wave ships, the second is what we
watch for afterwards. An unmeasurable item in a DoD list is not a gate, it is a wish, and mixing the
two teaches the reader to skim both.

**Ship gates (checkable at ship):**

- **A 5-person unmoderated test** in which **≥4 correctly answer "who decides how much stock we
  publish?"** from `/settings/who-decides` alone, with no documentation and no configuration, on a
  fresh single-shop install. (This replaces *"without reading any documentation"*, which named no
  protocol and so could not be failed.)
- No banned vocabulary word (§2.1) appears in any shipped string; the lint gate proves it, and the
  banned list is the closed nine-term table in §2.1.
- **All nine** inert states (§4.2), AF-X included, are reachable in a test environment and render in
  both places (settings + the affected row) with identical copy, proven by the copy mirror check.
- A healthy install — single location, no OMS configuration, 4,000 orders — shows an attention count
  of exactly 0 and no red badge on any order row.
- The T5→A2→A3 automation can be built, tested against a real past order, armed, and fired; its
  result is visible in **all three** history surfaces (§5.6) — the order timeline, the run log, and
  the rule's own log.
- Two overlapping money-spending automations demonstrably fire nothing, write a `Blocked` run row
  naming both rules, and report why on the order.
- A deliberately-broken money action (an invalid carrier account) produces an AF-X row, a `Stopped`
  order badge, an error-toned timeline event naming the skipped step, and a `Failed` run row — all
  from one firing.
- A rule created against a backlog of 40 held orders fires nothing (§5.7 S3-9).

**Post-launch success signals (watched, not gates):**

- Operators diagnose an automation misfire from the **order** rather than by opening rules one at a
  time — measured as: support conversations about a wrong automated outcome reference the order
  timeline or the run log, not "which rule did this?".
- The first-run suggestion (§5.1) is armed on a majority of installs that create any rule at all —
  if it is not, the suggestion is the wrong one, not the operator.
- `Needs attention` counts stay near zero on healthy installs over the first quarter; a drifting
  count means a state was classified attention-worthy that should be routine (§4.3).

---

## 10. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-08-22 | **Three cards, not two presets** — "leave things as they are" is a named, selectable position | "I haven't chosen" is a real state and the majority one; leaving it as an absence makes the page a configuration dump that cannot describe the install it is running on |
| 2026-08-22 | **Card 3 ships disabled, badged `Not available yet`, with an inline reason** — not hidden | Hiding it means the page silently changes shape at Wave 4; showing it disabled tells the operator the shape of the choice, matching the #2170 disabled tax-ID checkbox precedent. (Was §8.3's open question; settled.) |
| 2026-08-22 | **No `phaseEnteredAt` in v1**; the duration trigger is *"on hold for N"*, read off `order_holds.placedAt` | A phase fed by `now` is uninvalidatable, and a materialised entered-at column carries a five-context invalidation surface — the objection ADR-043 already sustained. `order_holds.placedAt` is persisted and is what the operator actually meant. (Was §8.2's open question; settled.) |
| 2026-08-22 | **`mark-packed` is refused as an automation action, on principle** | `packedAt` + `packedByUserId` assert that a named human packed a physical box; automating it writes a user id against an event that did not happen, and destroys the column's only value |
| 2026-08-22 | **Reversible actions all fire; irreversible actions obey #2047 exactly-one** | Two emails are recoverable, two labels are not — the split is the model's own "an unrouted order is recoverable, a double-shipped one is not", applied to automation |
| 2026-08-22 | **`order.status_changed` cut from v1** | Source status is a pass-through string that re-arrives on every poll; a trigger on it fires on re-ingestion noise, and the dedup story is a wave of its own |
| 2026-08-22 | **Automation history writes to the order timeline and a global run log, not only to a per-rule log** | The operator starts from the order, not from a rule they do not yet suspect; a per-rule-only log makes diagnosis require knowing the answer first |
| 2026-08-22 | **A failed automation step is attention-worthy (AF-X), never log-only** | The same §54/#2100 principle the rest of the document is built on; "stop on first failure" otherwise leaves the marketplace untold with no signal anywhere |
| 2026-08-22 | **Rules are never retroactive, and the composer says so** | The opposite expectation would spend money on a backlog the operator was only intending to describe |
| 2026-08-22 | **`restock_blocked` and orphan copy is owned by the returns spec and imported here** | S2-1 requires one copy source with identical titles in both places; two specs authoring the same string ships a violation of that AC on day one |
| 2026-08-22 | **Routing-rule storage is plugin-owned (`@openlinker/oms`), not #2298's** | #2298 is a docs reconciliation; it decides only whether the #2161 rule-engine shape is reused |
