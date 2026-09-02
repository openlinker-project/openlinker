# Implementation Plan: Return detail with verbatim source status and decline action (#2336)

- **Issue**: #2336 (`W1c-9`), the last issue of Wave 1c (epic #2337)
- **Depends on**: #2333 (decline write), #2334 (read API), #2335 (returns list + feature slice)
- **Design of record**: ADR-060; returns product spec `docs/specs/product-spec-oms-returns-operator-ux.md` §3.3, §5, §5.5, §5.6, §5.9, §9

---

## 1. Task Summary

Build `/returns/:returnId` — the per-return view. It answers, in order: which return is this, which
order does it belong to (or why can't we say), what came back on each line, what did the source say,
and what is the one write OpenLinker can make against it.

Everything it renders already exists on the wire. `GET /returns/:returnId` (#2334) returns the list
header fields plus `lines[]` and a backend-resolved `declineAvailability`; `POST /returns/:returnId/decline`
(#2333) is the write. This issue is entirely `apps/web` — with one narrow, justified backend addition
(see D7).

---

## 2. Scope & Non-Goals

### In Scope

- `GET /returns/:returnId` client + Zod parse + query hook.
- `POST /returns/:returnId/decline` client + mutation hook, invalidating via `returnsQueryKeys`.
- The detail page: header, orphan banner, lines table (with counters and the explicit
  "could not be matched to a line" state), source-observation panel, decline action.
- Route registration `/returns/:returnId` + `rowHref` on the list + `EXPECTED_LAZY_ROUTE_COUNT` 54 → 55.
- Copy in `features/returns/lib/return-detail.copy.ts` (vocabulary-gate scanned).
- Responsive: desktop anchor, tablet column hiding, mobile card view.
- Component/unit tests.

### Out of Scope (with reasons)

- **The receive / dispose / refund / credit-note flows** (spec §5.2, §5.3, §5.7, §5.8). Wave 2. There
  is no write for any of them, and the columns they would drive are declared-but-undriven.
- **The two custody/money *rails*** (spec §5.1). Wave 1c writes neither axis, so a rail would be a
  progress indicator over columns nothing advances. The per-line chips render at their default and
  say "not tracked yet" (issue assumption), which is the honest Wave-1c form and leaves Wave 2 a
  layout to light up rather than one to add.
- **`Match to an order`** (spec §5.5's CTA). No re-attribution *write* exists; re-attribution is an
  automatic reconcile. The banner explains and does not offer a button that does nothing.
- **`Authorize`** (spec §5.6's second action). No `ReturnAuthorizer` capability ships. Its *explainer*
  sentence does ship, because §5.6's whole point is that an unexplained absence reads as a missing
  feature.
- **`rawPayload` panel** (spec §5, panel 6). The DTO deliberately omits `rawPayload` — it carries
  buyer PII with no `OL_STORE_PII` parity, and a spec asserts the exact key set. Nothing to render.
- **The activity timeline** (spec §5, panel 7). No audit projection is exposed.
- **A published decline-reason-code vocabulary.** `ReturnDecliner.declineReasonCodes` is adapter-side
  and no endpoint publishes it (see D6).

### Constraints

- No new permission name (issue AC, spec §9): gate on the existing `orders:write`, which is held by
  exactly `admin` + `operator` — the same pair the endpoint's `@Roles('admin', 'operator')` names.
- `.nullish()`, never `.optional()`, on every nullable projection field (#939).
- `shared` must not import `features`/`pages`.
- No banned vocabulary term in operator copy (`scripts/check-ui-vocabulary.mjs` already scans
  `features/returns`).

---

## 3. Architecture Mapping

| Layer | File | Change |
|---|---|---|
| Feature — types | `features/returns/api/returns.types.ts` | `ReturnLine`, `ReturnDetail`, `ReturnDeclineAvailability`, `DeclineReturnInput/Result`, the four value unions |
| Feature — schema | `features/returns/api/return-detail.schema.ts` | Zod parse of the detail + the decline response |
| Feature — api | `features/returns/api/returns.api.ts` | `get(returnId)`, `decline(returnId, input)` |
| Feature — keys | `features/returns/api/returns.query-keys.ts` | `detail(returnId)` |
| Feature — hooks | `features/returns/hooks/use-return-query.ts`, `use-decline-return-mutation.ts` | new |
| Feature — copy | `features/returns/lib/return-detail.copy.ts` | new |
| Feature — components | `return-decline-action.tsx`, `return-lines-table.tsx`, `return-orphan-banner.tsx`, `return-line-state-chips.tsx` | new |
| Feature — components | `return-source-status.tsx` | optional `sourceName` prop (attribution by name) |
| Feature — lib | `lib/decline-error.ts` | map `ApiError` → operator copy, reading `details.trigger` |
| Page | `pages/returns/return-detail-page.tsx` | new |
| Route | `app/routes/returns.route.tsx` | index + `:returnId` children |
| Route test | `app/routes/route-lazy.test.ts` | count 54 → 55 |
| List | `pages/returns/returns-list-page.tsx` | `rowHref` |
| API (narrow) | `apps/api/src/common/filters/returns-exception.filter.ts` | serialise `trigger` on the 409 body |
| Barrel | `features/returns/index.ts` | export the new surface |

---

## 4. Design decisions this plan owns

### D1 — `rawStatus` renders verbatim, attributed, and is never interpreted

The detail reuses `ReturnSourceStatus` (#2335) rather than re-rendering the value, so there is one
place that decides what a source status looks like. It gains one optional prop: `sourceName`, so the
detail can render `Allegro: COMMISSION_REFUND_CLAIMED` (spec §3.3's exact form) where the connection
name is resolved, falling back to the generic `Source:` prefix the list already uses when it is not.
No mapping table, no tone derived from the value, no sort. `null` reads **"Not reported"** in muted
text with the hint *"The source channel reported no status for this return."* — a different fact from
any status, never a status of its own.

### D2 — `declineAvailability` is consumed, never re-derived

The backend resolves it because deriving it client-side fails in the *wrong* direction — offering an
action the source cannot perform. The page renders the button from `supported` and, when false,
states **why** from `reason` (`no-source-return-id` → "This return has no reference at the source
channel, so there is nothing to ask them about."; `source-declares-no-decline` → "This channel does
not publish a way to decline a return."). An unrecognised `reason` (a value this build predates) is
handled by a fallback sentence, never by a blank disabled button.

Note the deliberate split: `declineAvailability.reason` does **not** carry the orphan case — that is
`bucket`, and a second spelling of it would be a second definition of orphan. So the page's disabled
ladder is, in order: orphan → unsupported → already declined → read-only session. Each states its own
reason. The button is **always visible** (spec §5.5: never hidden — a missing button is
indistinguishable from a bug).

### D3 — A 2xx alone never displays as "declined"

The write returns five outcomes. Only `declined` (and `already-declined`) means the source reported
the decline as a fact, and only then is `declinedAt` non-null. `decline-sent` means the source
accepted the request and has reported no instant — the page shows **"Decline sent"** with the
sentence *"{source} has the request and has not yet reported the outcome. OpenLinker records their
decision when it arrives."* and `declinedAt` stays empty. `in-flight` reports that a request is
already open. `refused` renders the source's own `refusalReason` verbatim, as the source's words.

The **persisted** header status is likewise never inferred from a mutation: after the write the page
invalidates and re-reads, and the "Declined" badge is driven by `declinedAt` alone (the same rule
`ReturnStatusCell` already applies). The `decline-sent` sentence is the mutation's own transient
result, rendered as such and labelled as coming from this attempt — not written into the header.

### D4 — `resolvedOrderLineId === null` is a stated state, not a blank

Rendered as **"Could not be matched to a line"** in muted text. The backend DTO says so explicitly
(there is no order-lines table to point at). A blank cell would read as missing data and invite a
bug report.

### D5 — Confirm, and a single-submit guard

The decline opens `ConfirmDialog` carrying spec §5.6's exact framing: *"Declining tells {source} you
are refusing this return. {source} decides what happens next — OpenLinker records the outcome it
reports."* Double submission is guarded three ways, deliberately overlapping because each covers a
different route: `ConfirmDialog`'s own `isConfirming` disables the confirm button; the handler
returns early when `mutation.isPending`; and the dialog closes on settle. The backend's ADR-044
proposal row is the real guarantee (a second call resolves `in-flight` rather than sending twice) —
the UI guards so the operator is not left wondering, not because correctness depends on it.

### D6 — `reasonCode` is a free-text field with the source's vocabulary surfaced on refusal

`reasonCode` is adapter-native and opaque to core; no HTTP endpoint publishes
`ReturnDecliner.declineReasonCodes`, so the frontend cannot render a select without inventing a
marketplace vocabulary in `apps/web` — the exact coupling the CORE/Integration boundary exists to
prevent, and a stale copy of Allegro's seven codes would refuse a code the adapter accepts. The field
is therefore a required text input, labelled as the channel's own code, and the adapter's refusal
(which names the codes it accepts) is rendered verbatim. Publishing the codes on
`declineAvailability` is a clean follow-up and is named as deferred rather than silently skipped.

### D7 — The 409 body must carry `trigger`

`ReturnNotAttributedError` exposes a readonly `trigger` and the filter's own docblock says a
structured rendering must read that field rather than parse the message. The filter today serialises
only `{ statusCode, error, message }`, so the field is unreachable from the frontend and the only
alternative would be the string-parsing that docblock forbids. One line in
`ReturnsExceptionFilter` adds `trigger` to the 409 body (and only the 409 — the other two errors have
no such field). This is additive, changes no status code, and makes an existing stated contract true.

The 409 is a **backstop**, not the main path: an orphan is already visible as `bucket` and the button
is disabled before it can be pressed. It is reachable only if the return is re-attributed away
between load and click. It is handled anyway, because "the operator's copy of the record went stale"
is exactly what the status means.

### D8 — Error handling reads status codes, never messages

- **404** on the detail read → a `not found` `EmptyState` with a back link (invoice-detail precedent).
- **404** on the write → the return vanished; toast + invalidate so the page re-reads and shows the
  not-found state itself.
- **409** → the orphan sentence, naming the blocked trigger from `details.trigger`.
- **400** → the source cannot be asked; the API's message is the adapter's own words and is shown.

---

## 5. Questions & Assumptions

- **A1** — `orders:write` is the correct existing permission: `ROLE_PERMISSIONS` grants it to
  `admin` + `operator` and no one else, exactly matching `@Roles('admin', 'operator')` on the write.
  A return decline is an order-domain write. No new permission value ships.
- **A2** — Custody/money/disposition chips render at their declared defaults with a
  "not tracked yet" attribution, per the issue's own assumption.
- **A3** — The connection display name comes from the connections list the app already holds
  (`useConnectionsQuery`), exactly as the list does — no per-page connection fetch.
- **A4** — `lines` arrives ordered by `lineIndex`; the frontend does not re-sort (it renders what the
  server ordered) but keys on `line.id`.

---

## 6. Implementation Plan

### Phase 1 — Feature slice (transport)

1. `returns.types.ts`: add `RETURN_CUSTODY_STATE_VALUES`, `RETURN_MONEY_STATE_VALUES`,
   `RETURN_DISPOSITION_VALUES`, `RETURN_REFUND_REASON_VALUES`,
   `RETURN_DECLINE_UNSUPPORTED_REASON_VALUES`, `DECLINE_RETURN_OUTCOME_VALUES` (FE mirrors of the
   core unions), `ReturnLine`, `ReturnDeclineAvailability`, `ReturnDetail extends ReturnListItem`,
   `DeclineReturnInput`, `DeclineReturnResult`.
2. `return-detail.schema.ts`: `parseReturnDetail` / `parseDeclineReturnResult`. Unlike the list
   parse, the detail parse **throws** on an unreadable envelope — there is no partial page to show
   and a header of blanks would be worse than an error state. A malformed *line* drops itself and is
   counted (the list's per-row rule, same reasoning), reported next to the table.
   Unknown union values (a custody state this build predates) do not drop the line: the value is
   preserved as a string and rendered raw, because dropping a whole line over an unrecognised chip
   would hide a real parcel.
3. `returns.api.ts`: `get`, `decline`.
4. `returns.query-keys.ts`: `detail(returnId)`.
5. Hooks: `useReturnQuery(returnId)`, `useDeclineReturnMutation(returnId)` — the mutation invalidates
   `returnsQueryKeys.detail(returnId)` and `returnsQueryKeys.all` (the list's `declinedAt`/status
   changes too, and list keys carry filters+pagination so only the prefix can catch them all).

### Phase 2 — Copy + components

6. `return-detail.copy.ts` — every operator string, including the four disabled-reason sentences and
   the five outcome sentences.
7. `return-orphan-banner.tsx` — spec §5.5's copy, error tone, `Alert`.
8. `return-line-state-chips.tsx` — custody / money / disposition with the "not tracked yet" hint.
9. `return-lines-table.tsx` — `DataTable` with `cardView` + `hideBelow`, counters as
   `n of m received`, the explicit unmatched-line state.
10. `return-decline-action.tsx` — the availability ladder, `useWriteAccess('orders:write', demoMode)`
    + `ReadOnlyLock`, `ConfirmDialog`, reason-code + comment fields, outcome rendering.
11. `return-source-status.tsx` — optional `sourceName`.
12. `lib/decline-error.ts` — `ApiError` → copy, reading `details.trigger`.

### Phase 3 — Page, route, wiring

13. `return-detail-page.tsx` — loading skeleton / 404 / error / loaded; header (identity, source,
    origin, opened), orphan banner, lines, source-observation panel, decline action.
14. `returns.route.tsx` — index + `:returnId`; `route-lazy.test.ts` 54 → 55.
15. `returns-list-page.tsx` — `rowHref={(item) => item.id}`, replacing the deferral comment.
16. `features/returns/index.ts` — export the new surface.
17. `returns-exception.filter.ts` — `trigger` on the 409 body (D7) + its spec.

### Phase 4 — Tests

- `return-detail.schema.test.ts` — nullish tolerance, line drop counting, unknown-union preservation,
  throw on unreadable envelope.
- `decline-error.test.ts` — 404/409/400/network mapping; `trigger` read from `details`, never parsed.
- `return-decline-action.test.tsx` — each disabled reason renders its sentence; confirm required;
  double-click sends once; each outcome renders its own sentence; `decline-sent` never says declined.
- `return-lines-table.test.tsx` — unmatched line copy; counters; not-tracked-yet chips.
- `return-detail-page.test.tsx` — loading, 404, error, orphan banner, verbatim `rawStatus`,
  `null` rawStatus.
- `returns-exception.filter.spec.ts` — 409 body carries `trigger`.

---

## 7. Alternatives Considered

- **Deriving decline availability in the browser** — rejected: it fails toward offering an action the
  source cannot perform, and the backend already resolves it from adapter manifests.
- **Rendering the operator stage** (spec §3.2) — rejected for Wave 1c: it is derived from counters
  nothing advances. `ReturnStatusCell`'s existing docblock makes the same call, and W2-40 owns it.
- **Parsing the 409 message for the blocked trigger** — rejected: the filter's docblock explicitly
  forbids it; serialising the field is one line and makes a stated contract real.
- **A `reasonCode` select from a copied Allegro code list** — rejected: marketplace vocabulary in
  `apps/web`, guaranteed to drift.

## 8. Validation & Risks

- **Risk**: the detail parse throwing on a contract break blanks the page. Mitigated by scoping the
  throw to the *envelope* (header unusable) and dropping only malformed lines, which are reported.
- **Risk**: over-eager invalidation refetches the whole list cache. Accepted — a decline changes list
  state, and `returnsQueryKeys.all` is the only prefix that reaches every filter/pagination key.
- **Gates**: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm check:invariants`.

## 9. Acceptance Criteria (issue #2336)

- [ ] Header, lines with counters, order link or orphan banner, verbatim attributed `rawStatus`
- [ ] Decline confirms; disabled-with-reason for orphan and unsupported source
- [ ] `resolvedOrderLineId = null` renders as an explicit "could not be matched" state
- [ ] No `returns:*` permission; `useWriteAccess` + `ReadOnlyLock`
- [ ] Responsive on tablet and mobile
- [ ] Tests added
- [ ] No boundary violation (`shared` imports nothing from `features`/`pages`)
