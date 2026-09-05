# Implementation plan — the bench work list and the scanner-input primitive (#2416, `W3b-3`)

> Spec of record: `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` § 2.2 (B1–B5), § 2.3 (C1–C4),
> decisions D8, D11, D21, D22. Mockup: `docs/plans/mockups/oms-wave3b/templates/WorkList.dc.html`.
> Depends on #2413 (`95793b9a4`).

## 1. What is being built, and the shape it takes

Surface B is a **read composed above two contexts**, and Surface C is **one hook plus one pure
rule module**. Neither is a new bounded context.

The load-bearing decision is where the composition lives. `FulfillmentWork` carries `orderId` and
nothing else about the order: no reference a packer can read, no buyer, no `dispatchByAt`. B2's
ordering key and B2's row copy are all order-side facts. `libs/core/src/fulfillment` is a registered
zero-sibling-edge leaf under ADR-053 with an enforced no-injection invariant
(`scripts/check-no-injection-contracts.mjs`, `barrel-purity.spec.ts`), so it may not read `orders`.

So the join happens in **`apps/api/src/bench/`**, over `IFulfillmentWorklistService` and
`IOrderRecordService` — the `AuthorityStatusService` (#2353) precedent verbatim: *"it cannot live in
the leaf (the empty allow-set is what keeps the graph acyclic) and did not earn a fifth
trust-shaped core context for one page."* **This change adds no core cross-context edge and spends
no allow-list entry.**

## 2. Surface B — the read

### 2.1 The holder is resolved from the OMS's own manifest, never from `platformType`

D8: the list is *"what routing assigned to this holder"*. The in-house holder is the OL-OMS
executor connection (ADR-055, #2409 — `openlinker.oms.v1` advertising `FulfillmentExecutor`).

`BenchWorkService` resolves it as: every connection whose `adapterKey === omsAdapterManifest.adapterKey`
— imported as a **value from `@openlinker/oms`**, the static-manifest-export seam (#575) used as
designed — that is `active` and carries `FulfillmentExecutor` in `enabledCapabilities`.

Not a `platformType` switch (architecture forbids it), not a string literal (a literal drifts when
the OMS versions its adapterKey), and not `listCapabilityAdapters` (that constructs adapters; a read
that must answer when the floor is busy should resolve no credentials).

**Zero such connections is the B3 "routing is not switched on" fact.** It is reported as a field, not
as an empty list, because an empty list is the other fact.

### 2.2 The filter is exactly B1, plus one thing the mockup requires

`IFulfillmentWorklistService.list` already accepts `status[]` and `requestStatus[]`. B1 —
*"assigned to this holder, accepted and not yet closed"* — is therefore:

- `requestStatus: ['accepted']`
- `status: ['open', 'scheduled', 'on_hold', 'in_progress', 'cancelled']`
- `assignedConnectionId: <the resolved holder ids>` — **the one new filter axis**, added to
  `FulfillmentWorkListFilter` and `listWorks`. Additive and optional, so every existing caller is
  byte-identical.

`closed` and `incomplete` are excluded: both are terminal and neither is packable.

**`cancelled` is deliberately INCLUDED**, which reads as a deviation from B1's "not yet closed" and
is not one. The mockup ships a *"Do not pack these"* section carrying exactly `on hold` and
`cancelled` — *"nothing to pack. Take the items back to the shelf."* A cancelled parcel whose tote is
physically on the bench is the one case where saying nothing is worse than saying something: the
packer packs it. Hiding it would satisfy a literal reading of B1 and defeat the surface.

`assignedConnectionId` takes a **list**, not a scalar: an install may legitimately carry two OMS
connections, and a scalar would force the bench to pick one silently.

### 2.3 Ordering, and the bound that makes it honest

Sort key, most urgent first:

1. expedited before not expedited (D22 — § 3)
2. then `dispatchByAt` ascending, **nulls last** (an order with no deadline is not urgent; it is
   unknown, and sorting unknown to the front would push real deadlines down)
3. then `orderId` — a stable tiebreak, so two reads of an unchanged list agree

`dispatchByAt` lives on `order_records`, so the sort **cannot** be pushed into the works query. The
bench therefore reads **one bounded page** (`FULFILLMENT_WORKLIST_MAX_LIMIT`, 100) and sorts it in
the composition layer, reporting `total` alongside. When `total > works.length` the surface says so
in plain words rather than paging: a cross-page in-memory sort would be wrong, and silently wrong.

This is a stated limit, not an oversight. A bench holding more than 100 open parcels at once is a
staffing problem before it is a paging one.

### 2.4 The projection is an allowlist, and it is PII-bearing on purpose

`BenchWorkResponseDto` carries, per row:

| Field | Source | Why |
|---|---|---|
| `workId`, `version` | work | the optimistic token expedite needs |
| `orderReference` | `orderSnapshot.orderNumber` ?? internal id | what the mockup renders as `OL-4468`; also what the search matches |
| `buyerName` | `orderSnapshot` shipping/billing name | mockup renders it; it is how a packer tells two boxes apart |
| `dispatchByAt` | `order.dispatchByAt` | B2's ordering and its plain-words deadline |
| `lineCount`, `unitsToVerify` | `Σ line.totalQuantity − cancelledQuantity` | **never `fulfilledQuantity`-derived readiness** (B2) |
| `parcelIndex`, `parcelTotal` | position among the order's works | mockup's "Parcel 1 of 2" |
| `state` | derived: `on_hold` \| `cancelled` \| `packable` | B4 — carried as a value, so colour is never the only carrier |
| `holdReason`, `holdPlacedAt` | first active hold | mockup's "why it is held" |
| `expeditedAt` | work | D22's visible marking |
| `supportedActions` | work view | so the expedite control is server-told, never client-derived |

Buyer name is a deliberate disclosure and is consistent with #2413's review: the *locked* screen
withholds buyer data; a signed-in packer is shown it, because it is on the label they are about to
stick on the box. `ShipmentResponseDto` already reaches a packer under the same reasoning.

Nothing else from the snapshot crosses — no address, no email, no phone, no totals. Field-by-field,
never a spread (the `FulfillmentWorkView` rule).

### 2.5 Route and role

`GET /bench/work` on `apps/api/src/bench/http/bench-work.controller.ts`,
`@Roles('admin', 'operator', 'packer')`.

`RolesGuard` denies by default (#2079) and `route-authorization-coverage.spec.ts` requires exactly
one of `@Public` / `@Roles` / `@AnyRole` per handler, so the decorator is mandatory rather than
optional. Naming `packer` makes the route fail `packer-exclusion.spec.ts` until it is registered in
`PACKER_GRANTED_ROUTES` — whose docblock says *"#2416/#2418 fill this in with their work-scoped
reads."* This is that entry, and it is the first one.

Reviewed against #2413's principle — *a packer keeps operational reads a bench touches, is excluded
from every register and from configuration, and reaches the parcel through the work*: this read is
scoped to work routed to the bench, discloses one buyer name per row and no configuration, and has
no write. It qualifies.

## 3. Expedite (B5, D22)

**One flag, one sort key, no new concept** — and no producer of work. Manual routing to a bench is
#2869 and is not this.

- `fulfillment_works."expeditedAt" timestamptz NULL`. Null means not expedited; the timestamp is
  both the flag and the tiebreak between two expedited parcels (first pushed, first out).
- Two new members of `FulfillmentWorkActionValues` and of `OPERATOR_INVOCABLE_ACTIONS`:
  **`expedite`** and **`release_expedite`**.

  Two verbs rather than one verb carrying a boolean, because `supportedActions` exists so *"the
  server tells the client what is legal next"*. `deriveSupportedActions` offers `expedite` only when
  the work is not expedited and `release_expedite` only when it is, so the control's direction is
  never a client-side derivation. It is also the shape `hold` / `release_hold` already established
  for a reversible act.

  Spelling: `expedite`, not `prioritise`/`prioritize`. It is the spec's own word in both directions
  ("expedites it", "un-expedited"), and it dodges an `-ise`/`-ize` choice the repo has no settled
  rule for. `release_` reuses the established prefix; `cancel_` was rejected because "cancellation"
  already means the negotiation axis in this context.
- Both are terminal-guarded (`!isTerminalFulfillmentWorkStatus`) and hold-independent — a held
  parcel may still be pushed to the front, because the hold will be released and the ordering
  should already be right when it is.
- Repository: `setExpedited(input)` — one conditional UPDATE carrying the state guard
  (`"expeditedAt" IS NULL` / `IS NOT NULL`) and `withVersionGuard` in the SAME statement, bumping
  `version`. That is what lets `explainRefusal` tell a stale token from an already-applied replay.
- **No index.** Nothing orders by this column in SQL (§ 2.3); an index nothing reads is cost.
- FE gate: a new `pack:write` permission held by `admin` and `operator` and **not** by `packer`,
  keeping the holders identical to the action route's `@Roles('admin','operator')` — the documented
  `shipments:write` / `automations:write` discipline. `ROLE_PERMISSIONS.packer` stays `[]`, and its
  docblock's *"a `pack:*` member arrives with the bench's own surfaces (#2416/#2418)"* is where this
  comes from. The permission is display-only; the route's `@Roles` is the enforcement.

  Consequence, stated: a packer signed in at the bench sees the expedited **marking** and no
  expedite **control**. That is B5 exactly — "someone with write access expedites it", and the bench
  shows that it happened.

## 4. Surface C — the scanner-input primitive

`apps/web/src/features/bench/lib/scanner-gesture.ts` (pure) + `hooks/use-scanner-input.ts`.

### 4.1 Telling a scan from typing

A hardware scanner is a keyboard emitting a burst terminated by Enter. The pure rule takes the
buffered keystrokes and answers `scan` / `typing`:

- every inter-key gap ≤ `SCANNER_MAX_KEY_GAP_MS` (50 ms — a human sustaining <50 ms/char over eight
  characters is not typing)
- at least `SCANNER_MIN_LENGTH` (4) printable characters
- terminated by `Enter`

A burst failing any clause is discarded silently as typing; **only the terminator produces a
gesture**, so a half-buffer left by a wandering keyboard never dispatches.

The listener is on `document`, so it **works with nothing focused** — the bench's normal state. It
ignores events originating in an editable element (`input`, `textarea`, `contenteditable`), because
the one editable element on this surface is the search field D11 requires and stealing its
keystrokes would break opening a parcel. That is a stated behaviour, not an accident.

### 4.2 The per-gesture id is minted and made durable BEFORE the consumer is called

G3 is #2420's, and the primitive must not need rewriting for it: *"a legitimate second scan — the
second unit of a two-unit line — is recorded as a second unit."* Dedup and legitimate repetition are
the same bytes on the wire, so identity cannot be the payload.

On a completed gesture the hook:

1. mints `gestureId` (`crypto.randomUUID`, with a counter fallback where it is absent),
2. **writes it to `sessionStorage` before invoking the consumer**, so a reload or a retry reuses the
   same id rather than minting a second one for one physical gesture,
3. calls `onScan({ value, gestureId, at })`,
4. exposes `settleGesture(gestureId)` for #2420 to clear it once the server has it.

Two identical scans produce two ids and therefore two units. A payload-keyed dedup would record one,
and retrofitting identity later is a rewrite — which is why it is here now.

The pending log is **not** cleared by the idle lock or a handover: A3 says locking never discards
progress, and a gesture already made is progress. Who a *replayed* gesture is attributed to is
#2420's question, and is recorded here rather than answered.

`sessionStorage`, not `localStorage`: per tab, cleared with it, and carrying no credential — the
`no-localstorage-jwt` rule is about tokens and is not in tension with this.

### 4.3 Where it is exercised in THIS slice (C3)

On the work list, **every** scan is unrecognised — D11 is explicit that OL prints no barcode and
mints no scannable parcel identity, so there is nothing on this surface a scan can match. So the
list consumes the primitive to state precisely that, immediately and distinctly, recording nothing:
a `role="alert"` announcement plus a non-colour marker. That is C3 exercised on real behaviour
rather than a placeholder, and it teaches the packer that this surface is opened by typing.

## 5. Surface B — the frontend

New under `features/bench/` (already registered in **both** `.eslintrc.js` pattern groups, and
already inside `check-ui-vocabulary.mjs`'s `SCAN_ROOTS` — so all copy avoids `authority`, `posture`,
`phase`, `holder`, `Gateway`, `Orchestrator`, `FulfillmentWork`).

- `api/bench.types.ts` / `bench.schema.ts` / `bench.api.ts` / `bench.query-keys.ts` — the
  `features/fulfillment` shape. **`.nullish()` on every optional field** (#939): a `null` sub-field
  under `.optional()` drops the whole section and renders a blank cell.
- `lib/bench-work.copy.ts` — every operator-visible string, mockup-verbatim where the mockup has one.
- `lib/bench-work-ordering.ts` — the pure sort and the plain-words deadline (`Breaching in 2 hours`
  / `Due today` / `Due tomorrow` / `Due <weekday>`), taking `now` as an argument so it is testable
  without a clock.
- `hooks/use-bench-work-query.ts`, `hooks/use-bench-expedite-mutation.ts`, `hooks/use-scanner-input.ts`
- `components/bench-work-list.tsx`, `bench-work-row.tsx`, `bench-work-empty.tsx`,
  `bench-work-search.tsx`
- `pages/bench/bench-page.tsx` — replaces the #2413 placeholder. **`/bench` does not move**;
  `bench-route-placement.test.ts` is untouched and must stay green.

### 5.1 The search field filters; it does not open

Opening a parcel is #2418. A "Open parcel" button wired to nothing is dead code that type-checks, so
this slice ships none: the search field **filters the loaded rows** (a real function), matching the
mockup's forgiving rules — case-insensitive substring against the reference with any
non-alphanumeric prefix stripped, and against the buyer name. `BenchWorkRow` takes an optional
`onOpenParcel`; when it is absent no control renders, and #2418 passes it in one line.

### 5.2 B4 — never colour alone

Each row carries its state as **text** (`On hold — do not pack`, `Cancelled`, the deadline phrase),
as **position** (the two "Do not pack these" rows sort to their own section under their own heading)
and as a `StatusBadge` whose `withDot` is on. Expedited rows carry the word `Expedited` and sort to
the top. Asserted by a test that reads text content only.

## 6. Test plan — red-first

Every test below is verified to fail against a deliberate break before it is trusted.

| Test | Breaks when |
|---|---|
| `bench-work.service.spec.ts` — holder scoping | the filter drops `assignedConnectionId` (a 3PL-routed work appears) |
| — accepted/open only | `requestStatus: ['accepted']` is dropped |
| — cancelled survives | `cancelled` is dropped from the status filter |
| — no holder ⇒ routing-off | zero OMS connections answers an empty list instead of the flag |
| `bench-work-ordering.test.ts` | expedited stops sorting first; null `dispatchByAt` sorts first |
| `bench-work.copy.test.ts` | any copy string contains `picked`, `gathered`, `ready to pack` |
| `bench-work-row.test.tsx` | state is asserted from `textContent`, so a colour-only signal fails |
| `scanner-gesture.test.ts` | the gap threshold, the minimum length or the terminator is removed |
| `use-scanner-input.test.tsx` | the id is minted after dispatch, or is not durable, or two identical scans share one id |
| `bench-work-list.test.tsx` | an unrecognised scan announces nothing |
| `packer-exclusion.spec.ts` (existing) | the new route names `packer` without being registered |
| `fulfillment-work-migration-parity.int-spec.ts` (existing) | the `expeditedAt` migration and the ORM entity disagree |
| `bench-work.int-spec.ts` | a packer is refused, or an admin's read leaks another holder's work |

## 7. Explicitly not built

Opening/verifying/closing a parcel and the label (#2418); emission into
`IFulfillmentProgressService` and G2/G3/G4 (#2420); floor posture, audible feedback, offline (#2421);
manual routing to a bench (#2869); paging past the first 100 rows (§ 2.3); an audit actor on the
expedite (the flag carries no `expeditedByUserId` — B5 needs visible and reversible, not attributed,
and a column nothing reads is cost).

---

## 8. Review findings applied (`/pre-implement` + `/tech-review`, both on §§ 1–7 above)

Both gates ran against the draft above. Every finding is resolved here rather than left as a note;
where a finding is declined the reason is recorded.

### 8.1 Three shipping defects in the draft — all fixed

**F1 (BLOCKING) — the holder would never have resolved.** `Connection.adapterKey` is
`string | undefined`, and `oms.plugin.ts` carries `isDefault: true` precisely because *"the connection
create form omits `adapterKey`"*. So an operator-created OMS row stores NULL and
`connection.adapterKey === OMS_ADAPTER_KEY` is false on every real install — the B3 "routing is not
switched on" flag would have fired permanently and the surface would have been dead on arrival.

Resolution: compare the **resolved** metadata, via
`IIntegrationsService.resolveAdapterMetadata({ platformType, adapterKey })` — metadata-only, so no
adapter is constructed and no credential is resolved (the `AuthorityStatusService` precedent). Going
through the registry is also what keeps this from being a disguised `platformType` switch: the
registry owns the platform→default mapping and the bench merely asks it.

**F2 (BLOCKING) — the cap hid the rows the heading promised.** `listWorks` orders
`createdAt DESC, id DESC` and applies `take(limit)` *before* the composition layer sees anything, so
"one page of 100" was the 100 **newest** works — i.e. under a heading reading *Most urgent first*,
the surface would have dropped the most overdue parcels. And § 1.1's persona is 1000 orders/day: more
than 100 concurrently accepted-and-open works is an ordinary Tuesday, not a staffing failure.

Resolution, two parts. (a) `FulfillmentWorkListFilter` gains an optional
`orderBy?: 'createdAt_DESC' | 'createdAt_ASC'`, defaulting to `'createdAt_DESC'` so every existing
caller is byte-identical, and the bench asks for **`createdAt_ASC`** — an older work object is the
one closer to its deadline, so truncation now drops the newest, which is the safe direction.
(b) The bench **pages** to `BENCH_WORK_HARD_CAP` (500, five queries against the existing
`IDX_fulfillment_works_assigned_open`) rather than reading one page, so on any realistic install the
sort is over the complete set and truncation never happens at all. `total` is reported either way and
the surface says plainly when it is showing part of the work.

Denormalising `dispatchByAt` onto `fulfillment_works` would make the sort pure SQL and was
considered. It is declined here: the column would have to be written by #2395's routing commit, which
is a different issue's write path, and an insert-only copy of another context's mutable field needs
its own staleness answer. Recorded so the next reader knows it was weighed.

**F3 (BLOCKING) — "Parcel 1 of 2" could not be computed from the page it was computed from.** The
page is filtered to *this executor, accepted, non-terminal*, so a sibling parcel that is closed,
routed elsewhere or not yet accepted is absent — the denominator would have been wrong precisely on
the split orders the field exists for, while reading authoritative.

Resolution: the denominator is **every** work for that `orderId`, whatever its status and whoever
holds it. `FulfillmentWorkRepositoryPort` gains `listWorkIdsByOrderIds(orderIds)` — one batched query
returning ids ordered `createdAt, id` per order — so the index is this work's position in that
sequence and the total is its length. One extra query for the whole page, never one per row.

### 8.2 Surfaces that would have rendered something false

**F4 — heldness is `activeHolds`, never `status`.** Nothing in the tree writes
`status = 'on_hold'`; a held work reads `status: 'open'` with a non-empty `activeHolds[]`. Had the
`state` derivation keyed on the status, every held parcel would have vanished from the *"Do not pack
these"* section — the one section whose absence is dangerous. `'on_hold'` stays in the status filter
as a defensive member only, and `state` is derived from `activeHolds.length > 0`. Pinned by a test
that a held work whose status is `open` renders in the do-not-pack section.

**F5 — no location axis, and the mockup's location copy therefore changes.** Every line of the
mockup is location-scoped (*"routed to Warehouse Kraków"*), and `FulfillmentWorkListFilter.locationId`
exists. It is deliberately **not** used: nothing in the product tells a bench which location it is at.
#2413 ships no terminal record, and D2 makes the bench *"a device label, not a principal"*, so there
is no configuration to read it from and inventing one is device configuration this wave does not
have.

So the list is scoped to the **executor**, which is what B1 and § 3's non-goal actually say — *"The
list is what routing assigned to this holder"* — and the header names the executor connection's own
name rather than a warehouse. **This is a deliberate deviation from the mockup's copy** and is
reported as such; the alternative (a warehouse name over an unfiltered list) is the surface stating
something false, which is the one option not available.

**F6 — B3 names its remedy, and says why it is not `locations/bootstrap`.** The routing-off state is
answered server-side as a discriminated `routing` block rather than a bare boolean, and its remedy
copy points at **Settings → Who decides what** — the mockup's own answer and #2354's page — because
the fact behind it is *no active connection is set to carry out packing here*, which is an
assignment fact.

#2407's `POST /inventory/locations/bootstrap` is deliberately **not** the remedy surfaced at a bench,
and the reason is recorded rather than left as an omission: creating an inventory location is an
admin write against a configuration register a packer is excluded from by design, and it is not what
makes work reach this executor — a location can exist while nothing is assigned to pack. #2407's
panel remains the right place for that half, on the connection page where routing is switched on.
What IS reused is #2407's register: the state is reported, never claimed as an invariant; it names
what is true and what to do about it; and it never colours an unconfigured install as a fault.

**F7 — the copy promises auto-refresh, so the query does it.** `refetchInterval` 30 s plus
`refetchOnWindowFocus`, and the query is `enabled` on the session being signed in — which is what
pauses it while the bench is locked, since the idle lock clears the session. Without that the copy
*"New work turns up here on its own"* would have been a promise nothing kept.

**F8 — C2 gets an assertion, and the frontend role gate is stated.** There is deliberately **no**
frontend role gate on `/bench`: the surface tolerates an anonymous session and renders its own
sign-in (#2413), and a gate would fight that. The backend read is the enforcement
(`admin` / `operator` / `packer`), so a `viewer` who opens the URL is refused by the API and sees an
error state rather than a blank list. A test asserts the surface renders no link out of the flow.

**F9 / F10 — the two things a reviewer would read as bugs.** `expeditedAt` is added to the
`FulfillmentWorkView` allowlist and to the repository header's per-column sole-writer table
(`setExpedited`). And `cancelled` being terminal means `deriveSupportedActions` returns `[]` for those
rows — no actions at all, including no expedite — while a cancelled-after-closing work never appears
because `closed` is excluded. Both are correct and both are now stated.

### 8.3 Accepted refinements

- **`orders:write`, not a new `pack:write`.** The shipped operator worklist page already gates its
  action controls on `orders:write` (`fulfillment-worklist-page.tsx:98`), whose holders are exactly
  the action route's `@Roles('admin','operator')` and which a `packer` does not hold. A second
  permission with an identical holder set is drift waiting to happen. `PermissionValues`,
  `ROLE_PERMISSIONS`, the `session.types.ts` mirror and `check-permission-mirror.mjs` are therefore
  **untouched**, and `ROLE_PERMISSIONS.packer` stays `[]`.
- **`formatShipBy` is reused, not re-invented.** `apps/web/src/shared/format/format-ship-by.ts`
  already computes exactly this deadline from `dispatchByAt`, pure and `now`-injected. The bench
  takes its `level` and `remaining` and supplies only its own word choice on top, so the arithmetic
  has one home. The divergence in phrasing is deliberate: the orders page reads `3h left` at a desk,
  and the bench needs a headline legible at arm's length across a room.
- **The two new action members carry non-DESIGN provenance, stated.** Every existing member is
  `INFERRED from <DESIGN §5.x sentence>`; `expedite` / `release_expedite` derive from the Wave-3b
  **spec** (D22). They are the first members with that provenance and say so in place.
- **`FULFILLMENT_ACTION_COPY` gains both verbs.** `exposedActions` is shared, so the controls appear
  on the existing `/fulfillment` worklist too — which is correct (a supervisor expedites from their
  own worklist) but is a new control on a shipped page rather than "no new concept", and an
  unlabelled button from the humanising fallback would be the worse outcome.
- **`expeditedByUserId` stays out, for a better reason.** Not "a column nothing reads is cost" —
  that argument was equally available against `fulfillment_holds.placedByUserId` and lost there. The
  distinction is that a hold *stops* work and is dispute-bearing, while an expedite only reorders it:
  nothing downstream is refused because of it, so there is no question an actor column would answer.
- **Scanner hardening.** A total burst bound (`SCANNER_MAX_BURST_MS`, `SCANNER_MAX_LENGTH`) so a
  chain of sub-threshold events cannot grow the buffer without end; modifier and non-printable keys
  are ignored rather than buffered; and the handler **never** calls `preventDefault` on Enter
  globally, which would break every keyboard-reachable control on the surface.
- **The pending-gesture log is bounded.** `settleGesture` is #2420's, so in this slice nothing clears
  an id and a bench tab open for a shift would grow the log without limit. It is capped at
  `SCANNER_PENDING_LOG_LIMIT` entries, oldest dropped first.
- **D21 is #2418's, and nothing here precludes it.** Its spec story is D4 under Surface D, and this
  issue's own out-of-scope list assigns opening and verifying there. The refetch policy in F7 is the
  mechanism it will most likely build on.

### 8.4 Contract-surface edits the gates enumerated

`fulfillment-work-action.types.spec.ts` (the exact-twelve assertion and its title);
`SupportedActionsInput` gains `expeditedAt` and its spec's `base` literal follows;
`FulfillmentWorklistService.dispatch` gains an arm per verb (without which
`fulfillment-work.controller.spec.ts`'s `it.each([...OPERATOR_INVOCABLE_ACTIONS])` fails);
`FULFILLMENT_ACTION_COPY` + its copy test; `FulfillmentWork` / `FulfillmentWorkView` /
`FulfillmentWorkResponseDto` / the repository's `toDomain` and the service's `toView`; the migration
numbered above `1870000001000`; and `PACKER_GRANTED_ROUTES` gains
`BenchWorkController.listBenchWork` in the same commit that adds the route.
`fulfillment-work-migration-parity.int-spec.ts` needs no edit — its column diff is generic over a
table list already naming `fulfillment_works`.

### 8.5 Second review, on the finished diff — applied

`/tech-review` ran again against the implementation. Its verdict was *request
changes* on three counts; all three are fixed, and the five suggestions with
them.

**R1 (IMPORTANT) — an over-long scan was silently TRUNCATED and reported as
good.** The hook capped its buffer at exactly `SCANNER_MAX_LENGTH`, which made
`isScannerBurst`'s over-length clause unreachable from the product: a
129-character burst arrived as its last 128, passed every clause, and was handed
over as if it were the code that had been scanned. The unit test asserted the
rejection; the integrated path did the opposite. The buffer now keeps one
character past the bound so the terminator can refuse it, and two tests drive the
whole hook — one at the maximum length, one past it.

**R2 (IMPORTANT) — the new SQL had no test anywhere.** `setExpedited` (including
the `IS NULL` / `IS NOT NULL` predicate the replay-versus-stale-token story rests
on), the `assignedConnectionId` filter and its `1 = 0` empty arm, `orderBy`, and
`listWorkIdsByOrderIds` were all pinned only against a mock's arguments — a claim
about a CALL, not about which rows come back, which is precisely what D8 is
about. `apps/api/test/integration/fulfillment-expedite.int-spec.ts` (13 cases)
drives every one against real Postgres, and `bench-work.int-spec.ts` gains the
end-to-end case the plan promised and the first draft did not deliver: a real OMS
connection beside a rival executor's work, asserting the third party's parcel
never reaches the bench. Both are verified red-first.

**R3 (IMPORTANT) — the derivation's new arm was untested**, so neither the
direction nor the terminal suppression was pinned. Four cases added, including
the absent-flag degradation. The review also observed the consequence the plan
accepts in § 8.3: every non-terminal work now carries at least one action, so the
shipped operator worklist's "no actions" branch is reachable only for terminal
tasks. That is intended — a supervisor expedites from their own worklist — and is
recorded here rather than left to be discovered.

Also applied: the truncation copy no longer reads *"the oldest is shown first"*
under a heading saying *Most urgent first* (oldest-first is the SELECTION, urgency
is the display); the row's summary line and its open-parcel label moved into the
copy module, so the most-read strings on the surface are covered by the B2
readiness check rather than escaping it as inline JSX; the unrecognised-scan
alert now SHOWS what was scanned, because "not recognised" without the value
leaves a packer unable to tell a damaged label from the wrong box; the gesture
log's in-memory fallback latches on the first failed write, so a storage that
exists but refuses `setItem` no longer reads back a stale value while the
docblock claims otherwise; and § 2.4's `orderSnapshot.externalOrderId` is
corrected to `orderNumber`, which is what the code reads and what all four source
adapters populate.

One finding was declined on inspection rather than applied: an assertion that
`OMS_ADAPTER_KEY` equals its own literal was written and then removed as
tautological — the end-to-end D8 case already proves the resolution, and a test
that restates a constant is the vacuity this wave's own review standard rejects.
