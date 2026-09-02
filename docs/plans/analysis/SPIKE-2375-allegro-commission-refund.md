# Spike #2375 — Allegro commission-refund claim: is it writable?

Desk research only. Source of record: the official OpenAPI spec at
`https://developer.allegro.pl/swagger.yaml` (fetched **2026-08-25**, 1,501,685 bytes; tag
`Commission refunds`, paths `/order/refund-claims` and `/order/refund-claims/{claimId}`), plus the
order-handling tutorial's `Rabaty transakcyjne (zwroty prowizji)` section and two threads on
`allegro/allegro-api`.

## Verdict — **Branch A. The claim is writable.**

`POST /order/refund-claims` ("Create a refund application", `operationId: createRefundApplication`,
scope `allegro:api:orders:write`) exists in the live public spec and is documented end-to-end in the
seller tutorial with a working request/response example. The commission refund is a first-class,
four-operation REST family (create / list / get / cancel), not a seller-panel-only act. **Returns
spec §5.7 should select Branch A and strike Branch B's copy**, and #2379 ships both halves.

Three qualifications are load-bearing and must reach #2379 rather than staying in this file:

1. **The claim keys on an ORDER LINE ITEM, not on a return.** `RefundClaimRequest` is
   `{lineItem: {id}, quantity}` where `lineItem.id` is the checkout-form line-item UUID. The
   customer-return payload keys its `items[]` on `offerId` and carries **no** line-item id (spike
   #2289, E-note "line items key on `offerId`"). So the commission block cannot claim from the
   return alone — it must join `return.orderId -> GET /order/checkout-forms/{id} -> lineItems[] ->
   match on offer.id -> lineItem.id`. That join is **ambiguous when one order carries the same offer
   in two line items**, and #2379 must decide what it does there rather than picking one.
2. **A duplicate claim is a hard 422 `ClaimExistsException`, and it fires even against a REJECTED
   prior claim.** #2379's acceptance criterion "reports an already-claimed condition as success, not
   an error" is therefore satisfiable, but only by resolving the 422 through a re-read — and the
   *list* endpoint has no `lineItem.id` filter, which makes that re-read more expensive than it looks
   (see Q5).
3. **Allegro creates some of these claims itself.** `RefundClaim.type: AUTOMATIC` is in the spec's own
   enum (E9, primary), so an OL claim can collide with one Allegro already made. *How often* is not
   established here: the conditions come from a seller-help page this spike could not fetch (E19,
   secondary — see risk 3), and if they cover the buyer-return case as that summary indicates, the
   collision is a normal outcome rather than an edge case. #2379 must handle it as routine either
   way, since the handling is the same; only the §5.7 product framing depends on the frequency, and
   that framing should not be rewritten on secondary evidence alone.

## Evidence

Unless noted, the source is the official spec,
[developer.allegro.pl/swagger.yaml](https://developer.allegro.pl/swagger.yaml) (fetched 2026-08-25).

| # | Fact | Source |
|---|---|---|
| E1 | A `Commission refunds` tag exists with four operations: `POST /order/refund-claims`, `GET /order/refund-claims`, `GET /order/refund-claims/{claimId}`, `DELETE /order/refund-claims/{claimId}` | swagger.yaml |
| E2 | Create: `operationId: createRefundApplication`, request+response media type `application/vnd.allegro.public.v1+json` (**not** the `.beta.` type customer-returns needs), scope `allegro:api:orders:write`, success **201** | swagger.yaml |
| E3 | `RefundClaimRequest` = `{lineItem: {id: string}, quantity: int32 >= 1}`. Neither field is marked `required` in the schema, but the tutorial calls both **wymagane** | swagger.yaml + tutorial |
| E4 | `RefundClaimResponse` = `{id: string}` **only** — the create returns no status, so the claim's state must be read back via `GET /order/refund-claims/{claimId}` | swagger.yaml + tutorial |
| E5 | `lineItem.id` is "identyfikator przedmiotu z zamówienia … Pobierzesz go za pomocą `GET /order/checkout-forms/{id}`" | [tutorial](https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR) |
| E6 | Eligibility window: "Przez REST API możesz utworzyć wniosek dla **prowizji, które pobraliśmy w ciągu ostatnich 45 dni**" — the window runs from the **commission charge**, not from the order or the return | tutorial; [allegro-api#3001](https://github.com/allegro/allegro-api/issues/3001) |
| E7 | `RefundClaim.status` is a closed 7-value enum: `IN_PROGRESS`, `WAITING_FOR_PAYMENT_REFUND`, `GRANTED`, `REJECTED`, `REJECTED_AFTER_APPEAL`, `CANCELLED`, `APPEALED` | swagger.yaml |
| E8 | `GRANTED` is documented as covering **two** distinct histories: accepted as requested, **or** rejected-then-successfully-appealed | swagger.yaml |
| E9 | `RefundClaim.type` enum is `MANUAL` \| `AUTOMATIC` — "`AUTOMATIC` - the application was created automatically" | swagger.yaml |
| E10 | A repeat create for the same line item returns HTTP 422 `{"code": "ClaimExistsException", "message": "Claim exists for line item id <uuid>."}` — observed against an existing claim in status `REJECTED` | [allegro-api#9992](https://github.com/allegro/allegro-api/issues/9992) |
| E11 | Cancel is permitted **only** from `IN_PROGRESS` and `APPEALED`; any other status returns 422 | tutorial |
| E12 | Cancel "cannot be undone" | swagger.yaml |
| E13 | List filters are `lineItem.offer.id`, `buyer.id`, `status`, `limit` (1..100, default 25), `offset` (default 0). **There is no `lineItem.id` filter and no `orderId` filter** | swagger.yaml |
| E14 | List is ordered newest-first ("pierwszy wynik jest najnowszym") | tutorial |
| E15 | `RefundClaim` carries `commission: {amount, currency}` — the claimed money is reportable to the operator | swagger.yaml |
| E16 | `RefundClaim.lineItem` carries `{id, quantity, boughtAt, offer.id}`; `quantity` is the **total purchased** and is >= the claimed quantity | swagger.yaml |
| E17 | Create error responses are 400 / 401 / 403 / 406 / 422 only. **No 409**, and no idempotency-key header anywhere on the operation | swagger.yaml |
| E18 | The customer-return status vocabulary carries `COMMISSION_REFUND_CLAIMED` ("The sales commission refund (transaction rebate) application has been claimed") and `COMMISSION_REFUNDED` ("The sales commission was refunded") on the **return** aggregate | swagger.yaml |
| E19 | Allegro grants the discount automatically where its own data suffices — it checks whether the buyer returned via the "Kupione" tab, the return reason, and whether the refund went through Allegro's payment system; a refused-delivery parcel is granted automatically | Allegro seller help, via search snippet (page itself 403/502 to an unauthenticated fetch) — **secondary, see risk 3** |
| E20 | The tutorial's `Sandbox` section describes only the generic list/buy/order flow. It says nothing about `refund-claims`, and the swagger `servers` block is environment-neutral | tutorial + swagger.yaml |
| E21 | Tutorial documents a `buyer.login` list filter; the spec documents `buyer.id`. The two disagree | tutorial vs swagger.yaml |
| E22 | The tutorial's example `RefundClaim` response carries fields the schema omits — `buyer.login` and `lineItem.offer.name`. The documented schema is a **subset** of what the API returns, so it must be read as a floor, not a contract | tutorial vs swagger.yaml |
| E23 | `GET /billing/billing-entries` exists with an **`order.id`** filter (plus `type.id`, `offer.id`, `occurredAt.gte/lte`), returning `BillingEntry {occurredAt, type:{id,name,group}, asset: DEBIT\|CREDIT, offer, value}`, newest-first. Scope `allegro:api:billing:read` — a **different scope** from the orders one | swagger.yaml |
| E24 | `BillingType` example id `SUC` = "Prowizja od sprzedaży" (sales commission); `GET /billing/billing-types` enumerates the codes. The code set is an **example, not an enum**, so it must be discovered, not hardcoded | swagger.yaml |

## API surface

**Create** — `POST /order/refund-claims`
`Content-Type` + `Accept`: `application/vnd.allegro.public.v1+json`; scope `allegro:api:orders:write`.

```json
{ "lineItem": { "id": "15f8e350-5252-11ea-875e-a14b8f6a3728" }, "quantity": 1 }
```
→ `201 { "id": "c5ed3e8c-b37b-4379-892b-4e9bbd8de416" }`

**Read one** — `GET /order/refund-claims/{claimId}` (scope `allegro:api:orders:read`) → `RefundClaim`.
**Read many** — `GET /order/refund-claims` → `{refundClaims[], count}`; filters per E13.
**Cancel** — `DELETE /order/refund-claims/{claimId}` (scope `...:write`) → `204`; only from
`IN_PROGRESS` / `APPEALED`, irreversible.

`RefundClaim`:

```
id          uuid
status      IN_PROGRESS | WAITING_FOR_PAYMENT_REFUND | GRANTED | REJECTED
            | REJECTED_AFTER_APPEAL | CANCELLED | APPEALED
type        MANUAL | AUTOMATIC
quantity    int32 >= 1                 # claimed quantity
commission  { amount, currency }       # gross value of the claim
buyer       { id }
createdAt   date-time
lineItem    { id, quantity, boughtAt, offer: { id } }
```

Note the media type: this family is `public.v1`, whereas customer-returns is
`beta.v1`. `AllegroHttpClient`'s per-request Accept override (already used for the returns feed,
`allegro-order-source.adapter.ts:370`) means the two can coexist, but the claim path must **not**
inherit the beta type.

## The seven questions

**Q1 — Is the claim writable at all?**
**Yes.** E1/E2. It is a documented public write, not observation-only and not panel-only.

**Q2 — Exact endpoint, request shape, required fields, enums.**
E2/E3/E4/E7/E9 above. One caveat worth carrying: the request schema marks **nothing** `required`
while the tutorial calls both fields required (E3) — so an omitted field is a 400/422 discovered at
runtime, not a schema violation. The adapter should require both itself.

**Q3 — If observation-only, what can be read?** *(moot — but the observation half is richer than
§5.7 assumes.)*
There are now **two** independent observation sources, and they disagree in granularity.
`CustomerReturn.status` carries `COMMISSION_REFUND_CLAIMED` / `COMMISSION_REFUNDED` (E18) as **one
value for the whole return**; `RefundClaim.status` carries a 7-value vocabulary **per line item**
(E7). A return of two lines can have one claim `GRANTED` and one `REJECTED`, which the return-level
status cannot express. #2379's observation half should read `RefundClaim` where a claim id is known
and treat the return-level status as a coarse fallback, recording both verbatim.

**Q4 — Preconditions.**
- **A commission must actually have been charged, within the last 45 days** (E6). This is the real
  gate, and it is anchored on the **charge**, not on the order or the return — so a return that
  arrives late against an old order can be outside the window while the return itself is fresh. The
  charge date is on neither the order nor the return, **but it is not unobtainable**: `GET
  /billing/billing-entries?order.id={orderId}` returns the order's billing entries with `occurredAt`
  and a `type.id`, so the commission charge and its date are readable (E23/E24). Two costs make this
  a deliberate decision rather than an obvious win, and #2379 should take it as a **follow-up, not a
  prerequisite**: it needs the separate `allegro:api:billing:read` scope, which existing OL
  connections were not granted and which cannot be added without re-consent; and the commission
  `type.id` is an example value, not an enum, so identifying "the commission entry" means reading
  `/billing/billing-types` rather than hardcoding `SUC`.
- The docs state **no** requirement that the return be in a particular state, nor that the buyer
  refund have been issued first, before a *manual* claim is filed. Allegro's *automatic* grant does
  appear to check the refund went through its payment system (E19), but that governs whether Allegro
  files/grants it, not whether the seller may apply.
- Nothing documents an eligibility precheck endpoint. **There is no way to ask "is this claimable?"
  short of attempting it** — which makes an unconditional button plus honest error surfacing the
  only available design, and is consistent with §5.7's Branch A copy ("a failure surfaces Allegro's
  message verbatim and attributed, and the button stays available").

**Q5 — Failure and idempotency semantics.**
- **There is no idempotency key** (E17). Allegro dedups on the line item instead: a repeat create is
  422 `ClaimExistsException` naming the line-item id (E10).
- That 422 **is** the "already claimed" signal #2379 wants, and it is safe to treat as terminal
  success in the sense that retrying cannot help. But it does **not** by itself yield a status,
  and this is the one place where a naive design leaves a permanent hole: the message carries no
  claim id, and there is no `lineItem.id` filter on the list (E13), so nothing downstream can find
  the claim either. "Record the 422 and let the observation pass fill in the status later" is
  therefore **not a viable recommendation** — there is no pass that can locate a claim OL has no id
  for.
  The only available resolution is on the 422 path itself: list by `lineItem.offer.id` and match
  `lineItem.id` client-side, newest-first (E14), which favours the recent claim. That is bounded per
  return by one offer's claim history, and it is unbounded in the worst case, so #2379 should cap
  the paging and record an explicit "a claim exists, status unresolved" state when the cap is hit —
  **never** silently render `Not claimed`, which invites a duplicate attempt.
- **`ClaimExistsException` fires against a `REJECTED` prior claim too** (E10) — so "already claimed"
  does not mean "will be refunded", and OL must never render it as `Claim filed` on that basis
  alone. The reporter in #9992 asked whether re-filing after a rejection is possible and **received
  no staff answer**; treat re-filing after rejection as **not possible via the API**, and route the
  operator to the appeal (`APPEALED` / `REJECTED_AFTER_APPEAL` exist as observable statuses, but no
  appeal *write* is exposed — the appeal is panel-only).
- Deterministic refusals: 403 (not your claim), 422 (`ClaimExistsException`, ineligible, outside the
  45-day window), 400 (malformed), 406 (wrong media type). In-doubt: a create whose response is lost
  — because there is no idempotency key, a blind retry risks a second claim, and the 422 is what
  saves it. **`ClaimExistsException` is the de-facto idempotency guarantee**, and #2379's assumption
  ("the claim is idempotent at Allegro, or the adapter makes it so with a caller-supplied key") is
  half right: Allegro supplies it, the adapter cannot.
- **`GRANTED` is ambiguous** (E8) — it covers both "accepted" and "rejected then won on appeal". OL
  must not narrate it as "Allegro accepted your claim first time".

**Q6 — Sandbox.**
**Undetermined.** The endpoints are not environment-scoped in the spec (E20) so they are *probably*
routable on `api.allegro.pl.allegrosandbox.pl`, but a commission refund is a **billing** act, and
nothing states that sandbox charges commissions at all — if no commission is charged, the 45-day
eligibility gate (E6) can never be satisfied and every sandbox create is a 422 regardless of
correctness. See risk 1 for what would settle it. **Plan #2379 for adapter unit tests with recorded
fixtures** (which its own AC already asks for) and do **not** commit to an integration test against
a live claim.

**Q7 — Anything that makes §5.7 not achievable as written.**
Three things, in descending order of consequence.

1. **Allegro files some claims itself, and §5.7's premise does not account for that at all.** E9 is
   **primary** evidence that `AUTOMATIC` claims exist. E19 is **secondary** and, if it holds, says
   the automatic path covers the buyer-return-with-Allegro-refund case — the modal case for this
   module — which would make a 422 against an Allegro-created claim the *common* outcome of pressing
   `[Claim commission refund]` on a healthy return. Mechanically that is fine either way (the block
   renders the existing claim's status), and #2379 needs no branch on frequency.
   What does depend on frequency is the §5.7 narrative — the operator "learns OL is claiming
   something they never did". If E19 holds, that narrative overstates the case and the block's
   honest value is narrower but still real: **it makes the commission money visible, and it covers
   what Allegro did not automate** — close to Branch B's own justification, "the prompt is the
   product". **Recommendation: do not rewrite §5.7's framing on E19 alone.** Settle risk 3 first
   (one authenticated page read); the DoD item is reachable under either answer.
2. **`Claim filed` on observation is achievable, but from a different observation than §5.7
   assumes.** §5.7 reads status "from the observed `rawStatus` timeline
   (`COMMISSION_REFUND_CLAIMED` / `COMMISSION_REFUNDED`)". With the claim family available, the
   authoritative observation is `RefundClaim.status`, which is per-line and 7-valued. The four
   product states map, but not one-to-one: `Not claimed` = no claim found; `Claim filed` =
   `IN_PROGRESS` \| `WAITING_FOR_PAYMENT_REFUND` \| `APPEALED`; `Refunded by Allegro` = `GRANTED`;
   `Refused` = `REJECTED` \| `REJECTED_AFTER_APPEAL`; and `CANCELLED` **has no product state at
   all** — §5.7 needs a fifth, or must fold it back to `Not claimed`, which is a lie if the operator
   cannot re-file. Recommend a fifth state.
3. **§5.7 has no expired state, and the 45-day window is not checked before the button is pressed**
   (Q4). An operator can claim on a six-week-old return and get an opaque 422. The verbatim-error
   surfacing §5.7 already specifies is an adequate mitigation for the first slice, and it is the
   right one: the window *is* computable via the billing API (E23), but only at the cost of a new
   OAuth scope, so pre-checking is a follow-up rather than something §5.7 should assume. The block
   should not promise claimability it has not checked.

Nothing here blocks the wave, and nothing makes Branch A unbuildable.

## Recommendation for #2379

Ship **Branch A — both halves** (`W2-37` scope). Concretely:

1. A `CommissionRefundClaimer`-shaped sub-capability on the Allegro adapter (ADR-002 composable
   sub-capability, guard-narrowed off the dispatched adapter, absent on every other source — which
   is what makes §5.7's "absent, not empty" true structurally rather than by a `platformType` test).
2. **Write**: `POST /order/refund-claims` with `public.v1` media type. `201` records the claim id.
   **`422 ClaimExistsException` is terminal, not retryable**, and resolves via the bounded
   offer-scoped lookup in Q5 — recorded as "a claim already exists for this line item" and never as
   `Claim filed`, because it may be a rejected one. Every other 4xx surfaces Allegro's own message
   verbatim and attributed, and the button stays available (§5.7 Branch A).
3. **Observation**: `GET /order/refund-claims/{claimId}` where a claim id is known; the
   `CustomerReturn.status` values stay recorded verbatim as the coarse fallback. Both stored raw,
   neither mapped into an OL state machine (#2379 AC). Store the whole claim payload rather than a
   projection of the documented fields — the schema is a floor, not a contract (E22).
4. **The line-item join is the real work**, not the write: `return.orderId` →
   checkout-form → `lineItems[]` → `offer.id` match → `lineItem.id`. Decide explicitly what happens
   when the match is not unique. OL already carries the value it needs —
   `allegro-order-source.adapter.ts:780` maps `items[].id = lineItem.id` into the order snapshot —
   so the join may be servable from OL's own store without a checkout-form re-read; confirm the
   snapshot retains it before designing either way.
5. **No `DELETE`.** Cancelling is irreversible (E12), it deletes the seller's own money claim, and
   nothing in §5.7 asks for it. Leaving it out is the conservative default; add it only on a stated
   operator need.
6. **A fifth product state.** `CANCELLED` maps to none of §5.7's four (Q7.2). Add one rather than
   folding it into `Not claimed`, which would invite a re-file the API refuses.
7. **No automation.** Unchanged from the 2026-08-22 decision-log entry — and reinforced: with no
   idempotency key, and with the 45-day eligibility gate unevaluable *until* the billing scope is
   added (E23), an automated claim is a write against a third party with money attached and no
   precheck.

## Open risks — flagged, not guessed

1. **Sandbox coverage is unverified (Q6)** and is the single biggest risk to testing #2379. Settled
   by one authenticated `POST /order/refund-claims` against a sandbox order — needs sandbox seller
   credentials and a sandbox order that actually incurred a commission.
2. **Re-filing after `REJECTED` is undocumented and the one field report went unanswered** (E10).
   Assumed impossible. Settled by an Allegro-staff answer or one production attempt.
3. **The automatic-claim conditions (E19) are secondary evidence only** — both Allegro help pages
   returned 403/502 to an unauthenticated fetch, so the conditions are quoted from a search summary,
   not from the page. The *existence* of `AUTOMATIC` is primary (E9); its exact triggers are not.
   Settled by reading the help article from a browser session.
4. **`buyer.id` vs `buyer.login` list-filter disagreement (E21)** between spec and tutorial. E22
   suggests the likely explanation — the API returns and probably accepts both, and the spec
   under-documents — but that is an inference, not a finding. It only matters if #2379 lists claims
   by buyer, which the recommendation above avoids in favour of `lineItem.offer.id`.
5. **No documented rate limit** on this family (the customer-returns endpoint states 25 req/s per
   user; `refund-claims` states nothing). Assume the account-wide limits apply.
6. **`ClaimExistsException` is not in the spec** — it is a runtime error code known only from a
   field report (E10). The adapter must match it defensively (code string, with the 422 status as
   the outer guard) and must not break if the code string changes.
7. **Scope availability is an app-registration property and cannot be answered from this repo.**
   The claim needs `allegro:api:orders:write` (E2) and the window pre-check
   `allegro:api:billing:read` (E23). `AllegroOAuthCompletionAdapter.buildAuthorizationUrl`
   (`libs/integrations/allegro/src/infrastructure/adapters/`) sets `response_type`, `client_id`,
   `redirect_uri` and `state` and **no `scope` parameter at all**, so the granted scopes are whatever
   the registered Allegro application declares in the developer portal. #2379 should confirm the
   registered app carries `orders:write` before estimating: if it does not, the claim button needs
   an app-registration change and operator re-consent, not a code change. `billing:read` is very
   likely absent for the same reason, which reinforces treating the window pre-check as a follow-up.
