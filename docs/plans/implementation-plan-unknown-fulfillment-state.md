# Implementation plan — an unknown `fulfillmentState` must degrade one cell, not the page (#2678)

## 1. Root cause (verified in code, not assumed)

`apps/web/src/features/orders/lib/order-health.ts`:

```ts
export function fulfillmentBadge(state: FulfillmentRollupStateValue | undefined) {
  return ORDER_FULFILLMENT_META[state ?? 'not-shipped'];   // total on the TYPE, partial at RUNTIME
}

export function slaBadge(slaState: SlaStateValue | undefined) {
  if (!slaState || slaState === 'none') return null;
  return ORDER_SLA_META[slaState];                          // same shape
}
```

Both are `Record` lookups whose key type is a closed union but whose runtime key is
an unvalidated string off the wire. `GET /orders` is **not** zod-parsed anywhere in
`features/orders/api/` (grep: no `z.` / no schema in `orders.api.ts`; zod in this
feature is form-resolver-only). So the declared type is a claim, not a guarantee.

An unrecognised value returns `undefined`, and every call site immediately reads
`.tone` / `.label`:

- `pages/orders/orders-list-page.tsx:954` (desktop Ship-by cell), `:1883` (mobile card),
  `:2015` (mobile badge row)
- `pages/orders/dispatch-risk-page.tsx:92` (sla), `:129` (fulfillment)

The throw happens inside the table's `cell` render, so React unmounts the whole
tree — the entire `/orders` page, not the offending cell.

## 2. What "degrade" must mean here

Two wrong fixes to avoid:

- **`?? 'not-shipped'` on an unrecognised value** — that is a *lie*: the operator
  reads "Not shipped" about an order in a state this build cannot name.
- **Return `null` and render nothing** — a silent drop. The row then looks like a
  row with no fulfilment fact at all.

Correct: render a **neutral badge that names the unrecognised value verbatim**,
matching the repo's established handling of an unknown channel code (an
unrecognised offer-validation code is surfaced with its raw value, #2231) and the
`phaseBadge` guard shape (#2310). `null`/absent keeps its documented meaning
(`≡ not-shipped`) — that is a real contract, not a fallback.

## 3. Changes

### 3.1 `features/orders/api/orders.types.ts`
Add two guards beside their unions, mirroring `isOrderLifecyclePhase`'s placement
and its "deliberately no fallback" docblock:

```ts
export function isFulfillmentRollupState(v: unknown): v is FulfillmentRollupStateValue
export function isSlaState(v: unknown): v is SlaStateValue
```

### 3.2 `features/orders/lib/order-health.ts`
- Widen both params to `string | null | undefined` — the honest type for a value
  off the wire. Call sites pass the union, which is assignable, so no call-site
  churn and no `as`.
- `fulfillmentBadge`: absent → `not-shipped` meta (unchanged); known → its meta;
  **unrecognised → `{ label: 'Unknown (<raw>)', tone: 'neutral' }`**.
- `slaBadge`: falsy or `'none'` → `null` (unchanged); known → its meta;
  unrecognised → same neutral unknown badge.
- One shared private `unknownStateBadge(raw)` so the two cannot drift, truncating
  the raw value (32 chars) so a pathological string cannot wreck the row layout.
- Return type of `fulfillmentBadge` stays non-nullable.

### 3.3 `pages/orders/dispatch-risk-page.tsx`
Delete the dead `if (!badge) return null;` at :129 — `fulfillmentBadge` has never
returned `null` and still does not. This is exactly the `WHY_CODE_FALLBACK`
dead-code lesson #2589 recorded: an unreachable guard reads as coverage and is not.

## 4. Sibling lookups — searched, not assumed

`grep -rn "META\[" apps/web/src` plus a read of every `Record<...>` in the orders
feature:

| Lookup | Verdict |
|---|---|
| `ORDER_FULFILLMENT_META[state ?? 'not-shipped']` | **FIXING** — unguarded, wire-driven |
| `ORDER_SLA_META[slaState]` | **FIXING** — same shape |
| `ORDER_HEALTH_META.<literal>` | safe — dot access on compile-time literals only |
| `ORDER_LIFECYCLE_PHASE_META[phase]` | safe — behind `isOrderLifecyclePhase` (#2310) |
| `ORDER_LIFECYCLE_PHASE_WAITING_ON[phase]` | safe — same guard |

Any further `Record`-keyed lookup found during implementation gets the same
treatment or an explicit out-of-scope note in the PR.

## 5. Tests — red first

1. `order-health.test.ts`: `fulfillmentBadge('teleported' as never)` returns a
   neutral badge naming the value; `slaBadge('quantum' as never)` likewise;
   absent/known behaviour unchanged. Red before the fix (`undefined` returned).
2. `orders-list-page.test.tsx`: seed one row with an unrecognised
   `fulfillmentState` through the **real** query/render path and assert the page
   still renders (other rows visible, the neutral cell present). This is the
   check that actually reproduces #2678 — a lib-only test would pass against a
   version of the fix that still crashed the page.
3. Both must be observed **red with the fix reverted**, not merely written.

## 6. Out of scope (stated, not silently skipped)
- Adding a zod parse layer to `GET /orders` — a much larger change; the guard at
  the render seam is the proportionate fix and is what #2589 did.
- A `check-*-mirror.mjs` invariant for `FulfillmentRollupStateValues` /
  `SlaStateValues`. None exists today; adding one is a separate change.
