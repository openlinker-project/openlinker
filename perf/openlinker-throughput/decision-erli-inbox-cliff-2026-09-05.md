# Decision - how to reach Erli's unread-inbox cliff (#2865)

Written 2026-09-05 against `main` at `c1e4090ee`.

This is a **decision document, not a results report.** Nothing here was measured. Every
statement below is either a quotation from the repository, a fact confirmed by an earlier
live spike and recorded in the tree, or a consequence derived by reading code. Each is
labelled. Nothing was observed against the live Erli platform in the course of writing it,
and no figure here may be quoted as a measurement.

It answers acceptance criteria 1, 2 and 6 of #2865. Criteria 3, 4 and 5 need a driver that can
push Erli's unread inbox past its cap; no such driver exists in this repository or in any
open issue, and section 9 says so rather than inferring an answer.

**Read section 2 first if you read nothing else.** The single most consequential thing found
here is not the decision, it is that **the 500 cap and the "a read-marked message never
returns" property are both unverified prose from one commit** - present in neither the #992
spike's recorded findings, nor ADR-025, nor the setup guide, nor the runbook. What #992
actually confirmed is the different and much weaker claim that *there is no client-controlled
`limit` parameter*. Those two have been quoted interchangeably ever since, including by #2840,
#2846 and #2865 itself. Almost every question this document could not answer traces back to
that, and it changes what anyone should do next: the first move is not to build a rig, it is
to find out whether the thing being modelled is real.

---

## 1. The decision

**Both, in a fixed order, with a third step in front of them that neither the issue nor the
epic anticipated.**

| # | Step | What it is for | Blocking? |
|---|---|---|---|
| 0 | **Get the inbox contract from Erli in writing** | Establish whether the unread inbox is capped, at what number, what the server does with a new event at the cap, and whether a truncated listing returns the oldest or the newest messages. | **Yes.** Steps 1 and 2 are both unsound without it. |
| 1 | **A scoped, read-only sandbox probe** | Corroborate the vendor's answer on the one axis a read-only probe can reach - the listing's sort order - and take a latency baseline for the stub. A characterisation probe, never a throughput run. | No, but cheap. |
| 2 | **An Erli source stub, as the measurement rig** | Produce the burst repeatably, reach past the cap on demand, and measure what OpenLinker does at it. The only rig that can be re-run month over month, which is what the programme's comparability requires. | No. |

**The one-sentence reason: the cliff is a documented server-side contract rather than an
emergent performance property, so the cheapest and only definitive source is the vendor -
and a live sandbox cannot substitute for it, because observing what the server does at the
cap means first putting hundreds of unread events into a third party's sandbox, which is
load-testing someone else's system rather than the "characterisation probe" #2840 licensed.**

### This corrects #2840, and the correction should be recorded there

#2840 lists this cliff as one of exactly three behaviours that need a live sandbox:

> **Live sandboxes are needed for exactly three behaviours, none of which is F1 or F2**, and
> each is a characterisation probe rather than a throughput run: [...] and Erli's server-fixed
> <= 500-unread inbox with ack-on-next-read (`erli-order-source.adapter.ts:12-25`), which is
> arguably the most interesting throughput cliff in the system, is unreachable by any other
> means, and is out of scope for #2846 - to be filed separately rather than silently dropped.

(Emphasis as in the original; the elision drops the two Allegro items.)

The premise holds in the sense it was meant: a stub can produce the *shape* of the cliff but
can never observe the server, so nothing but the live platform can say what Erli really does.
The implicit second premise - that a sandbox therefore *reaches* it - does not. A sandbox
reaches it only if somebody first drives its unread count past whatever the cap is, and there
are only two ways to do that: place hundreds of real sandbox orders, or find some other event
that lands in the inbox and emit hundreds of those. Both are sustained writes into
infrastructure Erli operates, and #2840's own framing ("a characterisation probe rather than a
throughput run", "load is not driven through a marketplace UI") does not authorise either. The
honest reading is that the sandbox is necessary but not sufficient, and that the missing piece
is a contract statement from the vendor.

### What each rig may claim

| Rig | Can establish | Cannot establish |
|---|---|---|
| Vendor contract (step 0) | Whether the cap exists, its value, the saturation behaviour, the truncation order | What OpenLinker does when it hits any of that |
| Read-only sandbox probe (step 1) | The listing's sort order at small unread counts; per-request latency for the stub's cost model; that the endpoint shapes still match what #992 recorded | Anything at or near the cap. A quiet sandbox has an empty inbox. |
| Erli source stub (step 2) | Everything about **OpenLinker's** behaviour at the cap - drain rate, cursor movement, whether an order is lost, what an operator can see | Anything about **Erli's** behaviour at the cap. A stub asserts the cap; it never observes one. |
| Live saturation run | All of it | Requires Erli's explicit agreement; out of scope until they give it |

The split in the last two rows is the whole decision. #2846's governing rule is *"the stub
must reproduce the real cost model, or the measurement is of the stub."* For every other stub
in this programme the cost model is a latency curve that can be checked against a real shop.
Here the cost model **is** the cliff - the cap, the truncation order, the saturation behaviour -
so a stub built before step 0 would not merely risk "the mock is now the model", it would
*be* the model, with nothing to check it against. Step 0 is what makes step 2 evidence rather
than an assertion dressed as a run.

### If Erli does not answer

A decision that depends on a third party replying needs a stated fallback, or it is a plan to
wait indefinitely. The fallback is: **build the stub parameterised over the branches and run
all of them**, reporting conditional results rather than one number - "if the server truncates
oldest-first, OpenLinker drains at X and loses nothing; if newest-first, it loses N orders per
burst and reports nothing". That is weaker than a measurement of the real cliff and it is still
worth having, because what it produces is a list of what to defend against, and because the two
defences in section 5 are worth building whichever branch turns out to be real. What it must
not do is pick one branch, implement it, and publish the result as *the* behaviour at the cap.

---

## 2. Provenance of the 500 figure and the ack semantics (AC 2)

**Not confirmed against the live platform in this session, and not confirmable read-only.**
The pieces routinely quoted as one fact have three different provenances, and separating them
is most of this section's value.

### The ack REQUEST FORM: confirmed live, in #992

`libs/integrations/erli/src/infrastructure/adapters/erli-inbox.types.ts` declares itself
*"the SINGLE reconciliation point for inbox wire assumptions and endpoint paths"* and opens
with **"Verified against the live Erli Shop API (#992 spike)"**, listing:

- `GET /inbox` returns a top-level array of `{ id, shopId, created, read, type, payload }`
- **there is no `limit` query param**
- ids are 24-character Mongo ObjectIds, time-ordered and lexicographically sortable
- ack is `POST /inbox/mark-read { lastMessageId }` - mark-up-to-id, not per-message
- the type vocabulary is `orderCreated`, `orderStatusChanged`, `productsNeedSync`
- `productsNeedSync` carries no `payload.id` (confirmed live again in the #1322 manual E2E)

So the **request form** is confirmed: `POST /inbox/mark-read { lastMessageId }` is a real
mark-up-to-id endpoint, and OpenLinker is calling it correctly.

### The ack EFFECT is not confirmed, and that is a separate gap

The property the whole ack-on-next-read design rests on is that **a read-marked message never
returns from a re-read**. That is *not* in the verified list above. Its only occurrence
anywhere in the tree is `erli-order-source.adapter.ts:14`, and it sits inside the very same
prose sentence that carries the 500 figure:

> The inbox is "<=500 UNREAD" - a read-marked (acked) message never returns from a re-read.

One sentence, one commit, one author's reading. There is no basis for treating half of it as
confirmed and half as unverified, and an earlier draft of this document did exactly that.

The verified list even carries weak evidence the other way: the wire item has a `read`
boolean, which `validateInboxMessage` parses onto `ErliInboxMessage.read` and **nothing ever
filters on**. A field saying whether a message is read is pointless on a listing that only
ever returns unread ones. It may be a leftover, or the listing may return read messages too
and the adapter may simply be relying on a property the server does not have.

This matters as much as the cap does. If read-marked messages *do* return, then acking does
not bound the unread window, the cursor filter is the only thing keeping the wave correct, and
"acking is what bounds the unread window below the 500 cap" is false. It is added to the
vendor questions in section 7 for that reason.

### The 500 cap: never confirmed, and its only source is adapter prose

Restricted to the **cap figure** (a literal `grep` for `500` also finds HTTP statuses, prices
and issue numbers), it occurs in exactly two files, both prose, both introduced by the same
commit `3800a3d43` (#1081, the orders-ingestion PR):

- `erli-order-source.adapter.ts:6,14,25,192,234` - "the unread inbox (<=500)", "The inbox is
  '<=500 UNREAD'", "Acking is what bounds the unread window below the 500 cap"
- `erli-scheduler-tasks.ts:62` - "the `GET /inbox` page size is server-fixed (<=500 unread)"

(Those two source files write it with the single-glyph less-than-or-equal sign, transcribed as
`<=` here. #2840 already writes `<=`, so its quotation above is verbatim.)

It appears **nowhere** in `erli-inbox.types.ts`'s verified list, nowhere in ADR-025, nowhere
in the setup guide or the runbook, and nowhere in the #992 spike's recorded findings.

What #992 *did* confirm is that there is **no client-controlled `limit` parameter**. The
adapter's prose reads that as "the page size is server-fixed at 500". Those are two different
claims, and only the first has evidence behind it. "No limit param" is compatible with an
uncapped listing that returns every unread message, with a cap at some other number, and with
a cap of 500. Nothing in the tree distinguishes them.

**Recorded status.** Confirmed against the live platform: the endpoint shapes, the ObjectId
ids, the `POST /inbox/mark-read { lastMessageId }` request form, the type vocabulary, and the
absence of a `limit` query param. **Unconfirmed against the live platform: that a read-marked
message never returns; the 500 cap; the behaviour at the cap; and the truncation order.**

### Why it was not confirmed here, and what a person with credentials would have to run

There is no Erli connection in either local stack. Both `connections` tables were queried
directly (`ol-demo-fresh-postgres` and `openlinker-postgres`, grouped by `platformType`) and
neither holds an `erli` row; between two runs a few minutes apart the demo stack's row count
also moved, so no transcript is reproduced here.

`docs/manual-testing/01-presta-woo-allegro-erli-inpost-dpd-ksef/04-erli.md` does name a
`Demo Erli` connection `4137021d-6395-47e9-a8ec-3518ba99381c` against
`https://sandbox.erli.dev/svc/shop-api`, and that was a **local** stack: the walkthrough opens
`http://localhost:8090/...` and its directory README names the compose project `ol-demo-full`.
That stack no longer exists - no such container, and the only demo volumes present are
`ol-demo-fresh_*` - so the connection went with the teardown. Whether the API key it held is
still valid, or still recorded anywhere, is unknown.

**And it would not have helped.** Even holding a working sandbox API key, the three
unconfirmed facts are unreachable read-only:

| Fact | Reachable by a read-only `GET /inbox`? |
|---|---|
| Does the server cap unread, and at what number? | No. Needs more unread messages than the cap. |
| At the cap, does it keep accepting new events or refuse/drop them? | No. Needs saturation. |
| Under truncation, oldest-first or newest-first? | **Partially.** See below. |

The one thing a read-only probe genuinely buys is the third row, indirectly. Any inbox holding
two or more unread messages answers it in one read: record whether the array is ascending or
descending by id. A **descending** listing puts the newest at the top, which is evidence that a
truncated listing would shed the *oldest* - the order-loss branch in section 5. It is evidence
rather than proof, it is free, and nobody has recorded it, because the adapter does not care
about array order (it filters on `id > cursor` and takes the maximum) and so never looked.

**Exact probe for whoever holds a key** - read-only, one request, no writes, no attempt to
approach the cap:

```
GET {base}/inbox
Authorization: Bearer {apiKey}
```

Record the array length and whether the ids ascend or descend. Do not call
`POST /inbox/mark-read`. Do not create orders to inflate the count. If the sandbox's inbox
holds fewer than two unread messages the probe answers nothing, and the honest response is to
say so rather than to start generating events to make it answer.

---

## 3. What the code does (derived, by reading `listOrderFeed`)

Five steps per poll, in this order - the order matters and section 6 explains why:

1. `GET /inbox` -> the unread listing `L`
2. validate each item, dropping and warning on malformed ones
3. **if `fromCursor` is not null: `POST /inbox/mark-read { lastMessageId: fromCursor }`** -
   which the adapter believes removes every message with `id <= fromCursor` from future
   listings. That belief is the unverified one from section 2, not something the code can
   establish about the server.
4. `newWave = valid.filter(id > fromCursor)`; the order-event literals become feed items,
   deduped per order id
5. `nextCursor = max(id)` over the **entire** new wave, of any type; on an empty wave the
   cursor is left where it was

Core then enqueues, and only then commits the cursor -
`libs/core/src/orders/application/services/order-ingestion.service.ts:243` reads
`// Enqueue first; if enqueue fails, do not commit cursor.` That guarantee is real and is
what makes the ack-on-next-read design crash-safe.

The poll runs on `*/5 * * * *` - a hardcoded literal in `erli-scheduler-tasks.ts`, not an
operator setting. `ERLI_ORDERS_POLL_LIMIT = 200` rides in the job payload and the adapter
does not honour it, which the constant's own docblock says.

**The inbox is the only discovery channel.** `erliOrderPath(id)` is the only orders read in
the package - there is no list-orders endpoint in use, so there is no way to re-discover an
order whose inbox message OpenLinker never saw. ADR-025 puts it plainly: the webhook is a
low-latency *trigger* with a scheduled *"inbox poll as the mandatory backstop"*, and the
runbook says *"A dropped webhook is lost; the inbox poll is the only delivery guarantee."*

---

## 4. The four branches

Everything downstream turns on which of these the server does. Only observation distinguishes
them, and OpenLinker behaves completely differently in each.

**Branch 0 - there is no cap, and `GET /inbox` returns every unread message.** Nothing
*verified* rules this out: what #992 confirmed is that there is no client-controlled `limit`
parameter, not that the server imposes one of its own (section 2). If this is what the server
does, the cliff does not exist, #2865 closes as "not a defect", and the only residual finding
is a very large response body on a deep backlog. It is listed first because it is the cheapest
outcome and because a stub hard-coded to a 500 cap would make it unobservable for ever.

What the tree *does* contain is one more unverified assertion, from the same commit as the
cap, that the listing truncates: `erli-order-source.adapter.ts:234` warns that an unacked
high-id non-order message "accumulates against Erli's 500-unread cap, **eventually pushing
real orders off the listing** (PR1079-TECH-01)", and #2847 repeats that as fact. So a
truncating listing is the repository's working assumption, held on no evidence, and the
`nextCursor = max(new wave)` design in section 3 was built against it. That makes branch 0
less likely than the others and does not make it ruled out - it is the same prose talking.

**Branch A - the listing truncates and keeps the OLDEST; the server keeps accepting.**
Benign. The cursor filter works, each poll drains a slice, the ack frees it, the next slice
appears. Ingestion latency grows; nothing is lost. This is what the adapter's design assumes.

**Branch B - the listing truncates and keeps the NEWEST.** Order loss, silently. Section 5.

**Branch C - the server refuses or drops new events once unread is at the cap.** Loss too,
but on the platform side and entirely invisible to OpenLinker: the event never enters the
inbox, so no poll can ever surface it. The webhook is the only remaining route, and it is
fire-once with no retry (ADR-025). Whatever OpenLinker measures at the cap in this branch,
the interesting number is not throughput, it is the orders that were never offered.

---

## 5. The correctness finding: under branch B, an order is lost silently (derived)

**Label: derived by reading code. Not measured, and contingent on branch B being what the
server does. It is stated here rather than deferred because if it holds it is a correctness
defect, not a throughput figure, and because it is cheap to defend against before knowing.**

The ack is a high-water mark: `markReadUpTo(fromCursor)` marks read **every** message at or
below `fromCursor`, including messages OpenLinker has never seen. That is safe if and only if
the listing below the high-water mark was complete - an assumption the adapter never states
and nothing verifies.

Walk it through. Unread ids `1..700`, cursor at `0`, and the listing returns the newest 500:

| step | what happens |
|---|---|
| poll N reads | listing = `201..700`. Messages `1..200` were truncated away and OpenLinker cannot tell. |
| poll N computes | `newWave = 201..700` (all above the cursor), `nextCursor = 700` |
| core | enqueues the 500, commits cursor `700` |
| poll N+1 acks | `markReadUpTo(700)` marks `1..200` read - **they were never enqueued** |
| result | up to 200 orders gone. No error, no exception, no warn, no counter, no cursor regression. |

Three properties make it undetectable rather than merely bad:

- **The listing is the only evidence, and it is the thing that was truncated.** OpenLinker
  cannot see the gap because the gap is precisely what the response omitted.
- **Core's cursor guard cannot help, and for Erli it barely engages anyway.**
  `isCursorRegression` blocks a cursor going *backwards*; a cursor jumping forwards over
  messages nobody read is a perfectly legal advance, so no regression guard of any kind could
  catch this. Separately, `compareOrderCursors` recognises four shapes - a **decimal** counter,
  an ISO instant, a naive wall clock, and a wall-clock keyset - and a 24-character hex ObjectId
  matches none of them (the counter pattern is `^[0-9]+$`, and an ObjectId normally carries
  `a-f`; an all-digit one would match, and an unchanged cursor short-circuits to
  `not-regressed` before any shape test). So in practice every Erli advance answers
  `unrecognised`, core warns that *"monotonicity is unchecked for this source"* - once per
  `(connection, cursorKey)` **per process**, from an in-memory set, so it recurs per replica
  and after every restart - and the guard returns "no regression" by design.
- **There is no reconciliation channel.** No list-orders read exists, so nothing re-discovers
  the order later. The webhook fired for those orders long before the burst and is gone.

Note this is **not contingent on the cap being 500**, nor on there being a cap at all. It
needs only that the listing is ever truncated newest-first while the cursor advances past the
truncation boundary. Any server-side truncation of that shape turns the high-water-mark ack
into a data-loss instrument.

If step 0 or a saturation run confirms branch B, this belongs on **#1135** ("prove no order
loss under Redis outage + horizontal scale"), which #2840 already names as the only issue
owning the no-loss invariant, and it should be filed as a correctness defect against the
adapter rather than reported as a throughput number.

### The defences, and the one that actually closes it

**It is the CURSOR ADVANCE that loses the order, not the ack.** This is worth stating flatly,
because two plausible-sounding fixes do not work and it is easy to ship one of them and
believe the problem is solved.

Once `nextCursor` is committed at `700`, `newWave = valid.filter(id > fromCursor)` is strictly
greater, so ids `1..200` are filtered out of every subsequent poll for as long as the
connection lives. The ack merely decides whether they also *disappear*. So:

- **Acking per id instead of by high-water mark does not close it.** Erli does support the
  alternative - `erli-inbox.types.ts` records that *"Erli also accepts `{ ids: [...] }`; the
  adapter uses the high-water-mark form."* - and switching would stop OpenLinker erasing
  messages it never saw. But those messages are still never enqueued: they stay unread, are
  filtered out by the cursor predicate on every poll, and now permanently consume cap
  headroom. It converts a silent deletion into a silent permanent backlog. Worth doing as
  defence in depth, and it is not the fix.
- **Moving the ack in front of the read does not close it either.** That reordering is worth
  doing for the capacity reason in section 6a, and it is listed here separately so nobody
  mistakes it for a loss fix: the loss was caused by the *previous* poll's cursor advance, and
  acking earlier in this one changes nothing about that.

**The fix is to refuse to advance the cursor over a listing that may be truncated.** A poll
returning a listing at the cap cannot know what sits below its lowest id, so committing
`max(observed)` is a guess. The safe behaviour there is to **stop**: do not advance, do not
ack, and alert - because a stalled feed is fully recoverable once an operator or a later poll
sees a shorter listing, while a lost order is not. Under branch B with a persistently full
inbox that stall is permanent, which is the honest answer: newest-first truncation with no
list-orders endpoint means the old messages are unreachable through this API at all, and no
adapter change can conjure them back. Recovering those already passed over needs a
reconciliation read that Erli does not expose.

**Cheap, and worth doing whatever the branch turns out to be: report the listing size.** The
adapter logs nothing about how deep the inbox is (section 6b), so today the cliff is invisible
until it has already been crossed. This is also the prerequisite for the fix above, which
needs to know it is at the cap before it can refuse to advance.

---

## 6. Three adjacent findings, all derived from code

**(a) The ack runs after the read, and that roughly halves the drain ceiling.** The docblock
says the adapter *"at the START of each call [...] marks-read only messages with id <=
input.fromCursor"*, but the code issues `GET /inbox` first and acks second. So the previous
wave is still unread when this poll's listing is taken, and still occupies room in it. The
per-poll capacity for *new* messages is therefore `cap - |previous wave|`, not `cap`. Under
sustained saturation that gives `w(k) = cap - w(k-1)`, which is an involution: `cap/2` is a
fixed point nothing converges towards, and every other starting point gives the period-2 orbit
`cap -> 0 -> cap`, where the zero poll carries **no new orders at all** because the listing it
read was entirely messages already enqueued. Either way the **average** is `cap/2`. At a cap of
500 and a 5-minute cron that is an average ceiling near **3 000 messages/hour instead of
6 000** - arithmetic on unverified inputs, so *derived*, and only under branch A. Acking before
the read restores the full `cap` per poll and is safe, since the ack only ever touches
messages already enqueued (core commits `fromCursor` only after enqueue succeeds).

**(b) There is no saturation signal.** Nothing logs the unread depth, the listing size, or how
close the install is to the cap. There is one adjacent trace - `orders-poll.handler.ts` logs
`fetched=N, enqueued=N, committed=N` per poll - but `fetched` is `feed.items.length`, i.e.
order events *after* the cursor filter, the type filter and the per-order dedupe, so it says
nothing about how many messages the listing held or how deep the unread set is. An operator on
branch A watching orders arrive ever later has almost nothing to read, and the first
observable symptom of branch B is a customer complaint.

**(c) A failing ack walks the install into the cliff, quietly.** `markReadUpTo` is
best-effort by design - *"a failed ack is warn-logged, not fatal"*. A persistent ack failure
(auth blip, 5xx, a changed contract) leaves unread growing monotonically with nothing above
`warn`, and since acking is what bounds the unread window, the cliff arrives on its own. Any
run built for this cliff should exercise a failing ack as a scenario, not only a burst.

### Two docblocks that say something the code does not do

Neither has an issue and neither is caused by this work; they are recorded here because this
document is currently the only place they are written down, and both will mislead the next
person to read the file they sit in.

**`erli-order-source.adapter.ts:18`** - *"Instead, at the START of each call it marks-read
only messages with id `<= input.fromCursor`"*. The call issues the `GET /inbox` at `:194` and
the ack at `:228`, so the ack is not first, and that ordering is precisely what causes the
capacity penalty in (a) above. Anyone reasoning about drain rate from the docblock alone will
get `cap` per poll and be wrong by a factor of two.

**`erli-base-url.policy.ts:34`** - *"The single guard both the config-shape validator and the
adapter factory call so the SSRF/cleartext property can't drift between the create-time gate
and the per-connection construction seam."* Only `ErliAdapterFactory.resolveBaseUrl` calls the
combined `isAllowedErliBaseUrl`. `ErliConnectionConfigShapeValidatorAdapter` imports
`isAllowedErliHost` alone and re-implements the https half in a private `parseHttpsUrl`. Both
halves are enforced in both places today, so nothing is broken - but the property rests on two
implementations, not one, which is the exact drift the docblock claims is impossible. It is
also the file section 7 says a stub arm has to work around, so it will be read.

---

## 7. What the follow-on work has to look like

### Step 0 - the vendor questions

Five, in this order of importance:

1. Is the unread inbox capped? At what number?
2. At the cap, does `GET /inbox` truncate, and does it return the **oldest** or the **newest**
   messages?
3. At the cap, what happens to a **new** event - queued behind the cap, refused, or dropped?
4. Does `GET /inbox` return **only unread** messages, and does a message marked read via
   `POST /inbox/mark-read` ever appear in a later listing? (Section 2: this is assumed by the
   whole design, is unverified, and the wire item's unused `read` boolean hints the other way.)
5. Is `GET /inbox` ordered, and in which direction?

Questions 2 and 3 decide whether this is a performance issue or a correctness one. Question 4
decides whether "acking is what bounds the unread window" is true at all. Question 5 is the
one the read-only probe can corroborate.

### Step 1 - the sandbox probe

Read-only, one request, as spelled out in section 2. Also take a per-request latency sample
while there, because step 2's stub needs an honest constant and #2854 already flags the
unattributed `STUB_PER_REQUEST_LATENCY_MS: '120'` as *"the 'the mock is now the model' trap
the epic names"*. The precedent is exact and already filed as a pair: **#2856** is the Allegro
stub and **#2861** is the one-off Allegro sandbox latency baseline that gives it an honest
constant. Sandbox once to calibrate, stub thereafter to measure. Erli's version of that pair
is steps 1 and 2 here, with the difference that Erli additionally needs step 0, because what
its stub has to reproduce is not a latency curve but a behaviour.

### Step 2 - the stub, and the one blocker nobody has hit yet

An Erli source stub has to serve `GET /inbox` and `POST /inbox/mark-read` with real
read-marking state, ObjectId-shaped ids, a cap that can be set **or disabled**, and a
**configurable truncation order**, so every branch in section 4 can be run - because until
step 0 lands, which one is real is exactly what is unknown, and a stub hard-coded to one of
them has silently answered the question it was built to ask.

**#2854's "no code change to repoint OL" pattern does not hold for Erli.** For Allegro and
PrestaShop the connection carries a base-URL config field and a stub is reached by pointing it
at `http://<stub>:8080`. Erli refuses that, twice:

`libs/integrations/erli/src/domain/policies/erli-base-url.policy.ts` requires
`url.protocol === 'https:'` **and** a host equal to or under `erli.pl` / `erli.dev`. It is an
SSRF guard - the base URL becomes an authenticated GET carrying the static API key - and both
halves are enforced twice: at create/update by `ErliConnectionConfigShapeValidatorAdapter`,
and again at per-connection construction by `ErliAdapterFactory.resolveBaseUrl`, which throws
`ErliConfigException` on a disallowed override (deliberate defence in depth, PR1057-TECH-03).

One detail to know before touching it: the two do **not** share one guard, despite the policy
file's own docblock calling itself *"The single guard both the config-shape validator and the
adapter factory call"*. Only the factory calls the combined `isAllowedErliBaseUrl`; the
validator imports `isAllowedErliHost` alone and re-implements the https half in a private
`parseHttpsUrl`. The property holds today and it holds in two places that can drift.

So an Erli stub arm needs one of:

- **(a) TLS plus an `erli.dev` name inside the compose network** - a network alias such as
  `stub.erli.dev` and a certificate the api and worker trust. #2854 proposes a `wc-tls` nginx
  service for the WooCommerce arm (proposed: neither `docker-compose.lab.yml` nor `docker/lab/`
  exists yet), so fronting a stand service with TLS is already within that issue's scope
  rather than a new capability. **This is the right answer.**
- (b) widening the allowlist behind an env flag - rejected. It weakens a live SSRF guard in
  production code to serve a test rig, and the guard exists because the base URL carries the
  bearer key.

The connection row itself is **not** an extra burden, contrary to what an earlier draft of
this document said. The stand creates every connection it uses rather than repointing an
existing one: `perf/openlinker-throughput/bootstrap.sh` defines `ol_ensure_connection` (probe
by name, then `POST /v1/connections`) and calls it four times, for `perf-prestashop`,
`perf-woocommerce`, `perf-allegro-a` and `perf-allegro-b`. An Erli arm is one more block. What
distinguishes Erli is only the TLS requirement above.

The load shape is #2847's ramp, which is right for this, with two Erli-specific caveats
already recorded in that issue: the poll cadence is a hardcoded `*/5` literal, so a
2.5-minute mean poll wait is a first-order term in any latency figure; and the advertised
page limit of 200 is not honoured.

---

## 8. Reading of the acceptance criteria as they stand

| AC | Status |
|---|---|
| 1. A written decision: sandbox arm, stub, or both, with the reason | **Done** - section 1. Both, plus a blocking vendor step in front. |
| 2. The cap and the ack semantics confirmed, or explicitly recorded as unconfirmed | **Done** - section 2. The ack **request form** is confirmed (#992); the ack **effect** (that a read-marked message never returns), the cap, the saturation behaviour and the truncation order are all **explicitly recorded as unconfirmed against the live platform**, with the probe that would confirm what is confirmable. |
| 3. What Erli does at the cap, documented from observation | **Open.** No driver exists. Section 4 names the branches; none is claimed. |
| 4. What OpenLinker observes at the cap; degrades / stalls / loses stated unambiguously | **Open.** Section 5 derives a loss path from code, contingent on branch B. That is a reading, not an observation, and is labelled as such. |
| 5. If an order can be lost, raise it as a correctness issue linked to #1135 | **Conditionally open.** The candidate path is in section 5 with its destination named. Filing it needs branch B confirmed - filing a correctness defect on an unverified branch would be the same guess this programme refuses. |
| 6. Result labelled measured / derived / extrapolated | **Done** - section 10. |

---

## 9. What this did not establish

- **What Erli actually does when unread reaches the cap.** Not observed. Not inferred. The
  four branches in section 4 are all still live, including the one in which there is no cap.
- **Whether the cap is 500, or exists at all.** The figure's only source is adapter prose
  written in one commit and never verified; the #992 spike confirmed the absence of a `limit`
  parameter, which is a different claim.
- **Whether an order can be lost.** Section 5 shows a mechanism by which one *would* be lost
  under branch B. Whether branch B is real is unknown. No order was lost in the course of
  writing this, because nothing was run.
- **How far behind the cursor can fall before it matters.** Requires a run.
- **Whether the truncation order is oldest-first or newest-first**, which is the single fact
  that decides between "slow" and "silently lossy".
- **Any latency, throughput or drain figure.** The `cap/2` ceiling in section 6(a) is
  arithmetic over an unverified cap and an unverified branch. It is a mechanism worth knowing
  and is not a number worth quoting.
- **Whether a read-marked message ever returns from a later listing.** Assumed by the entire
  ack-on-next-read design, asserted in one unverified prose sentence, and never checked. If it
  is false, acking does not bound the unread window and section 6(c)'s amplifier becomes the
  steady state rather than a failure mode.
- **Whether the endpoint shapes still hold.** They were confirmed live in #992 and again in
  #1322's manual E2E; neither was re-run here, and Erli may have changed since.
- **Whether the team still holds a working Erli sandbox key.** No Erli connection exists in
  either local stack, and the one named in the manual-testing walkthrough belonged to an
  `ol-demo-full` stack that has since been torn down. Whether the key survives anywhere was
  not established.

---

## 10. Label ledger

| Statement | Label |
|---|---|
| `GET /inbox` shape, no `limit` param, ObjectId ids, `mark-read` mark-up-to-id request form, type vocabulary | **Measured, but not by this document** - recorded in `erli-inbox.types.ts` as verified against the live API in the #992 spike, and not re-verified here |
| `productsNeedSync` carries no `payload.id` | **Measured, but not by this document** - recorded as confirmed in the #1322 manual E2E, not re-verified here |
| The <=500 unread cap | **Unverified assertion** - adapter prose only, commit `3800a3d43`; not measured, not derived |
| That a read-marked message never returns from a re-read | **Unverified assertion** - the same prose sentence, same commit, as the cap above |
| That the listing truncates at the cap ("pushing real orders off the listing") | **Unverified assertion** - `erli-order-source.adapter.ts:234`, same commit; repeated as fact in #2847 |
| The order of operations in `listOrderFeed`, and that the ack follows the read | **Derived** - read from source at `c1e4090ee` |
| Core enqueues before committing the cursor | **Derived** - `order-ingestion.service.ts:243` |
| No Erli connection in either local stack; no Erli service in any compose file; no Erli block in `bootstrap.sh` | **Measured** - direct `psql` and `grep`, this session |
| The stand creates its connections rather than repointing them | **Derived** - `bootstrap.sh`'s four `ol_ensure_connection` calls |
| No list-orders read exists in the Erli package | **Derived** - `grep`, whole package |
| The order-loss path under branch B | **Derived**, and contingent on an unverified branch |
| The `cap/2` per-poll drain ceiling | **Derived** - arithmetic over an unverified cap, under an unverified branch |
| Erli's base-URL allowlist blocks a compose-network stub | **Derived** - `erli-base-url.policy.ts` plus `ErliAdapterFactory.resolveBaseUrl` |

---

## Related

- **#2865** - this decision's issue.
- **#2840** - the epic. Section 1 records a correction to its live-sandbox premise.
- **#2846** - stub discipline; the source of "the stub must reproduce the real cost model".
- **#2847** - the ramp, and the right load shape for step 2.
- **#2854** - the stand. Step 2 needs a service definition here, and the TLS workaround.
- **#2856** and **#2861** - the Allegro stub and its one-off sandbox latency baseline: the
  sandbox-calibrate-then-stub precedent this decision follows.
- **#1135** - the destination if branch B is confirmed.
- **ADR-025** - the reconciliation-first posture, and the reason the inbox poll is mandatory.
