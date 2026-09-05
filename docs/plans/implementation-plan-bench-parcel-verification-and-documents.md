# Implementation plan — opening a parcel, verification and auto-close, documents and the label (#2418, `W3b-5`)

> Spec of record: `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` § 2.4 (D1–D4), § 2.5 (E1–E6),
> § 2.6 (F1–F4); decisions D11, D13, D14, D17, D18, D19, D20, D21.
> Mockups: `docs/plans/mockups/oms-wave3b/templates/PackBench.dc.html`, `BenchDocuments.dc.html`.
> Depends on #2413 (`95793b9a4`) and #2416 (`5a7017d6b`).

## 0. One discrepancy between the issue text and the code, recorded up front

The issue names #2100's vocabulary as `SalesDocumentBlockReason`. The shipped type is
**`SalesDocumentGateBlockReason`** (`libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts`),
alongside `SalesDocumentUnresolvedReason`. F2 reuses the real names. Nothing else in the issue
disagrees with the tree.

---

## 1. Where the state lives, and why

#2413 already wrote the answer into `fulfillment-work.orm-entity.ts`, twice, and this plan is
the redemption of both notes:

- *"no `packedAt` is added here because that would be a second completion instant competing with
  **the phase model #2418 owns**"*
- *"a reader must NOT take this field as a complete account of who handled the box — **the
  verification ledger** holds the rest"* — and `packedByUserId` is *"Written by #2418, not here."*

So this issue owns exactly two pieces of durable state:

1. **A verification ledger** — one row per verified unit, in `libs/core/src/fulfillment`.
2. **A close instant** — `fulfillment_works.parcelClosedAt`, written with `packedByUserId` in the
   same statement.

`fulfillment_work_lines.fulfilledQuantity` is deliberately **not** touched: its own docblock says
*"Written by progress ingress (#2400), never by a create or a re-save"*, and emission into
`IFulfillmentProgressService` is explicitly #2420's. The bench records what it verified; #2420
decides what the rest of the system is told.

Placement is core, not `apps/api/src/bench`, because none of it reads a sibling context: it is
fulfilment state about a fulfilment work. The **join** with `orders` / `invoicing` / `shipping`
stays in `apps/api/src/bench/`, which is the #2416 placement and ADR-053's requirement.

---

## 2. D20, made structural rather than promised

> A hand-confirmed line must be indistinguishable from a scanned one, in storage and on screen.

Two mechanisms, both structural:

**(a) The port takes a LINE, never a barcode.** `IFulfillmentVerificationService.verifyUnit` accepts
`{ workId, workLineId, gestureId, verifiedByUserId }` and nothing else. A scan and a hand-confirm
reach it through the *same* method with the *same* arguments; the barcode is resolved to a line in
the API layer and then discarded. There is no second method, no `source` argument, and no way for a
caller to say how the unit was confirmed — so recording it differently is **not expressible**.

**(b) The table carries no column that could hold the distinction.** No `source`, no `barcode`, no
`manual`, no `confirmationMethod`. A spec asserts the exact column list, so adding one is a
deliberate act that fails a test named for D20.

On screen, both paths increment the same counter and render the same `Verified` badge; the FE
component receives no flag, because the API sends none.

Refusing to mark it is the decision, not an omission. Marking creates a stigma, and stigma drives
the workaround the system cannot see: scanning a second unit of the same SKU twice, after which the
parcel closes looking perfectly verified. The cost — weaker dispute evidence on hand-confirmed
lines — is accepted knowingly (D20).

---

## 3. D2 — one eligibility rule, two callers

Today the rule is **inline** in `BenchWorkService.toView`:

```ts
const state: BenchWorkState =
  work.status === 'cancelled' ? 'cancelled' : work.activeHolds.length > 0 ? 'held' : 'packable';
```

…and the selection half is the module-private `BENCH_STATUSES` + `requestStatus: ['accepted']`.
Neither is reachable by a second caller, so opening a parcel would have had to restate them — the
exact "two implementations that agree today" D2 forbids.

**New pure-rule module `apps/api/src/bench/application/bench-work-eligibility.ts`** (the
`bench-work-ordering.ts` shape, qualifying on all three counts of the pure-rule exception):

| Export | Used by the list | Used by opening a parcel |
|---|---|---|
| `BENCH_WORK_STATUSES` | the `status` filter | the "is this work even a bench parcel" guard |
| `BENCH_WORK_REQUEST_STATUSES` | the `requestStatus` filter | same |
| **`deriveBenchWorkState(input)`** | the row's `state` | the refusal's reason |
| `isPackableBenchState(state)` | — | the refusal predicate |

`deriveBenchWorkState` is moved verbatim; `BenchWorkService.toView` calls it instead of inlining it,
so the list's behaviour is byte-identical and a spec pins that the two callers agree on a shared
fixture table. **If the rule changes, both change, because there is only one.**

The refusal itself (`BenchParcelService.openParcel`) is:

1. work not found → 404;
2. status outside `BENCH_WORK_STATUSES`, or `requestStatus` outside
   `BENCH_WORK_REQUEST_STATUSES`, or not assigned to an OpenLinker packing executor →
   `refusal: 'not-at-this-bench'`;
3. otherwise `deriveBenchWorkState(...)`, and anything that is not `packable` is the refusal reason
   (`held` carrying its `holdReason`, or `cancelled`).

`'not-at-this-bench'` is a refusal reason, **not** a fourth `BenchWorkState`: widening the state
union would change the shipped list DTO for a fact the list can never produce (the list *selects*
on those columns, so a row it returns is always in-set).

---

## 4. E5 / D18 — there is no commit control

The parcel closes inside the same transaction as the verification that completes it. Structurally:

- `verifyUnit` inserts the ledger row, recounts, and — when every line's verified count equals its
  required quantity — stamps `parcelClosedAt` and `packedByUserId` in the same transaction.
- There is **no** `closeParcel` method on the service, **no** `POST .../close` route, and **no**
  `close` member of any action vocabulary. A commit control cannot be wired because there is nothing
  to wire it to.
- The FE renders the mockup's closed state and its footer promise verbatim: *"This box closes itself
  the moment the last line is verified. There is nothing here to press."*

A spec asserts the absence: the bench feature's rendered output contains no button whose accessible
name matches `/done|close|confirm|finish|commit/i` while verifying, and the API module exposes no
close route.

**Attribution is D13's**: `packedByUserId` is the user who performed the *last* verification, which
under roaming benches may be someone who checked one item of five. The ledger holds every
contributor. That is recorded as a limitation, not presented as an assertion.

---

## 5. E6 / D19 — reopen

`reopenParcel({ workId, reopenedByUserId, hasShipped })`:

- refuses with `'shipped'` when `hasShipped` — the box is gone, and reopening it in software is a
  fiction;
- refuses with `'not-closed'` when `parcelClosedAt` is null;
- otherwise, in one transaction: void every active verification row (`voidedAt`, `voidedByUserId`),
  clear `parcelClosedAt`, `packedByUserId` and `packedByService`.

Three points:

- **The void columns ARE the audit** ("recorded with who and when"). No second table and no
  `lastReopenedAt` column: a closed parcel by definition has a full ledger, so a reopen always
  writes rows, and a column nothing reads is the cost this tree already refuses for an index nothing
  reads.
- **Reopen voids the whole ledger and verification restarts from zero.** Keeping the counts would
  instantly re-close the parcel (the counts are full — that is what closed means), so "verification
  resumes" is only expressible this way. It is also correct: a mis-scan means you do not know *which*
  unit was wrong.
- **`hasShipped` is a required argument, not a read.** `fulfillment` is a zero-sibling-edge leaf and
  may not read `shipping`; the rule stays in core and the *fact* arrives from the caller — ADR-053's
  own "order data enters as arguments" discipline. `BenchParcelService` resolves it from the work's
  shipment using **`ReservationConsumeCandidateStatusValues`**, whose docblock already defines "the
  goods left the building". No second departure vocabulary is minted.

Re-closing after a reopen writes the new verifier into `packedByUserId` — "re-closing updates the
attribution" — for free, because close is a plain write on the completing verification.

---

## 6. E1 / E2 / E3 — the refusals

| Story | Decided where | Reason code | Records |
|---|---|---|---|
| E1 unit verified | core | — | one ledger row |
| E2 wrong item | API layer (it holds the barcode and the resolution) | `unknown-item` | nothing |
| E3 over-pack | core (it owns the counters) | `over-packed` | nothing |
| D2 not packable | API layer, via `deriveBenchWorkState` | `held` / `cancelled` / `not-at-this-bench` | nothing |
| closed already | core | `parcel-closed` | nothing |

"Records nothing" is asserted: a refused verification leaves zero rows and does not consume the
gesture id, so the packer's next, correct scan of the same physical gesture is not deduplicated
away.

E2 names **what it expected and what it got**: the response carries the scanned value plus the
outstanding lines' names, and the FE renders the mockup's sentence shape. E3's response carries the
line and its cap, rendering *"Third scan turned down — this box takes 2. The count stayed at 2."*

**The gesture id is consumed, not designed.** `UQ_fulfillment_work_verifications_gesture`
(`fulfillmentWorkId`, `gestureId`) makes a retried request a `deduplicated` no-op returning the
current state, while two genuinely separate scans carry two ids and record two units. That is
#2416's primitive used as intended; the emission contract (G2/G3/G4) is #2420's and nothing here
touches `IFulfillmentProgressService`.

---

## 7. D4 / D21 — the interrupt, and why it cannot fire on an address edit

The bench polls `GET /bench/work/:workId/parcel` while a parcel is open. When `refusal` becomes
non-null on a parcel that was open, the FE raises a blocking interrupt naming the change
(*cancelled* / *put on hold* / *no longer routed here*) and says what to do.

**It cannot fire on a buyer's address edit, structurally**: the parcel projection carries no
address, no email, no phone and no totals, so a change to any of them is invisible to this surface
and cannot produce a diff. A spec asserts the projection's exact field list, which is therefore also
the proof for D4's "only for changes that make the parcel unpackable".

---

## 8. Surface F

### F1 — the bench prints, it never issues

No sales-document trigger is added, no `auto-on-packed` value is introduced, and neither documents
route reaches `IInvoiceService.issueInvoice` or any fiscalization write. A spec greps the bench
module for the issuance seams and asserts their absence, the shape
`libs/core/src/returns/__tests__/proposal-never-issues.spec.ts` already uses.

### F2 — a missing document is named and does not block

`GET /bench/work/:workId/documents` answers, for the invoice:

- `{ state: 'ready', invoiceId, number, issuedAt }` when a `issued` record exists for the order;
- `{ state: 'missing', blockReason, unresolvedReason }` otherwise, both read straight off
  `order_records.salesDocumentBlockReason` / `salesDocumentUnresolvedReason` (#2100).

Packing is never refused on this: the field is on a read that runs *after* the box closes, and no
verification path consults it. The FE renders the mockup's copy — *"Carry on packing — one paper is
not coming"* — and the codes are turned into the packer's words by the existing FE mirror of that
vocabulary (`check-sales-document-reason-mirror.mjs`); no second vocabulary is minted.

### F3 / F4 — the label

The same read answers, for the label:

- `{ state: 'ready', shipmentId, carrier, trackingNumber, fetchedAt }`;
- `{ state: 'unavailable', carrier, carrierMessage, failedAt }` — the carrier's own words, from
  `Shipment.errorMessage`;
- `{ state: 'none' }` when no shipment exists for the parcel yet.

**Nothing here buys a label.** D14 puts the label upstream; the bench prints it through the existing
`GET /shipments/:id/label`, which is already packer-reachable
(`ShipmentController.downloadLabel`). "Try the label again" re-fetches, which is why the mockup can
promise *"Trying again does not reopen the box and does not ask you to scan anything twice"* — the
retry touches no verification state at all. Buying a label needs `recipient` and operator-typed
`parcel` weight and dimensions, so a bench-side purchase would have to hold recipient PII: exactly
what this issue's route review exists to prevent. That is a stated boundary, not a gap.

**Visible to dispatch**: `GET /bench/unlabelled-parcels` returns every parcel that is closed and
packed but has no ready label, with a count. The bench renders the count (mockup: *"1 box waiting
here · 2 in dispatch"*); the operator fulfilment worklist page renders a banner linking the same
fact. One route, two audiences, one truth — a second query would be a second answer.

---

## 9. The two routes the issue names, plus the four the surface needs

All six are `@Roles('admin', 'operator', 'packer')`, all six are explicit allowlist projections
(field-by-field, never a spread), and all six are recorded in `PACKER_GRANTED_ROUTES`.

| Route | Handler | Replaces / why |
|---|---|---|
| `GET /bench/work/:workId/parcel` | `BenchParcelController.getParcel` | **the order read.** `/orders` was closed because `orderSnapshot` carries the buyer's name, email and both un-redacted addresses under default `OL_STORE_PII=true` |
| `GET /bench/work/:workId/documents/invoice` | `BenchDocumentsController.downloadInvoice` | **the invoice print.** The invoicing register was closed to `packer` |
| `POST /bench/work/:workId/verifications` | `BenchParcelController.verifyUnit` | E1–E4 |
| `POST /bench/work/:workId/reopen` | `BenchParcelController.reopenParcel` | E6 |
| `GET /bench/work/:workId/documents` | `BenchDocumentsController.getDocuments` | F2/F3/F4 |
| `GET /bench/unlabelled-parcels` | `BenchDocumentsController.listUnlabelled` | F4's dispatch half. It shipped on the documents controller rather than a third one: it answers the same question the label half of `getDocuments` answers, one parcel wider. |

**The parcel projection, field by field** — and this list *is* the D4 proof:

`workId`, `version`, `orderReference`, `buyerName`, `parcelIndex`, `parcelTotal`, `refusal`,
`holdReason`, `closedAt`, `packedByUserId`, `lines[]` of
`{ workLineId, productVariantId, name, sku, barcode, requiredQuantity, verifiedQuantity }`.

No address. No email. No phone. No totals. No prices. `buyerName` is the one PII field and is
#2416's already-decided disclosure — it is the name going on the label the same session may print.

`GET .../documents/invoice` streams the invoice bytes for the **work's own order** only; there is no
`invoiceId` parameter, so the route cannot be used to enumerate the register.

**D3** is served by `parcelIndex` / `parcelTotal` (both already computed by #2416's sibling read) and
by the mockup's banner: *"Everything below belongs in this box only."* The parcel read returns one
work's lines and can express no other.

---

## 10. Schema

Migration `1870000003000-add-fulfillment-parcel-verification.ts`:

1. `fulfillment_works."parcelClosedAt" timestamptz NULL`.
2. `fulfillment_work_verifications`:
   `id uuid PK`, `fulfillmentWorkId text NOT NULL` (FK → `fulfillment_works(id) ON DELETE CASCADE`,
   migration-only, no `@ManyToOne`), `workLineId uuid NOT NULL`, `gestureId text NOT NULL`,
   `verifiedByUserId uuid NULL`, `verifiedAt timestamptz NOT NULL`, `voidedAt timestamptz NULL`,
   `voidedByUserId uuid NULL`.
   - `UQ_fulfillment_work_verifications_gesture` UNIQUE (`fulfillmentWorkId`, `gestureId`).
   - `IDX_fulfillment_work_verifications_active` (`fulfillmentWorkId`, `workLineId`)
     `WHERE "voidedAt" IS NULL` — the count read, and the only read there is.

Every constraint is declared **under the same name** in the ORM entity, because the integration
harness builds schema by `synchronize`; `fulfillment-work-migration-parity.int-spec.ts` is extended
to cover the new table, which is the only automated migration check in this repository.

No FK on `workLineId`: it is inside the same aggregate but the cascade from the work already reaches
it, and the tree's line tables take exactly one FK.

---

## 11. Work breakdown

| # | Area | Files |
|---|---|---|
| A | Core state | migration, ORM entity, `FulfillmentVerificationRepositoryPort` + repo, `IFulfillmentVerificationService` + service, `fulfillment-verification.types.ts`, token, module wiring, specs |
| B | API | `bench-work-eligibility.ts` (+ `BenchWorkService` rewire), `BenchParcelService`, `BenchDocumentsService`, three controllers, DTOs, `PACKER_GRANTED_ROUTES` entries, specs |
| C | FE | `bench-parcel` components + copy + api + hooks + tests; the closed state; the documents surface; the unlabelled state; the dispatch banner |
| D | Integration | `bench-parcel.int-spec.ts` (verify / over-pack / wrong item / auto-close / reopen / shipped refusal / dedupe), PII-boundary assertions extending `bench-packer-authorization.int-spec.ts`, migration parity |

## 12. Red-first

Every guard is shown to fail before it is made to pass:

- delete the `deriveBenchWorkState` call from the open path → the D2 shared-rule spec fails;
- add a `source` column to the verification entity → the D20 column-list spec fails;
- add a `<Button>Done</Button>` to the verifying surface → the E5 no-commit-control spec fails;
- add `address` to the parcel projection → the D4 field-list spec fails;
- drop a `PACKER_GRANTED_ROUTES` entry → `packer-exclusion.spec.ts` fails;
- call `issueInvoice` from the bench module → the F1 never-issues spec fails.

---

## 13. Review findings, and what was done about each

Both gates ran on this plan **before** implementation. Every finding below was
applied; where the plan's answer differs from the finding's suggestion, the
reason is stated rather than left implicit.

### Blocking (tech review)

| # | Finding | Applied |
|---|---|---|
| B1 | **The recount was a read-then-act, so E3 was unenforceable under concurrency.** The gesture index constrains retries of ONE gesture and says nothing about two different gestures on one line; at READ COMMITTED both count `n`, both insert, and the line lands at `n+2`. | `lockWorkForVerification` takes `SELECT … FOR UPDATE` on the **parent work row**, and the whole of `verifyUnit` runs inside it — the identical adjudication `fulfillment_holds` carries for its ≤10 cap, and for the identical reason (a trigger would not be emitted by `synchronize`). |
| B2 | **The auto-close was a plain `SET`, so two completing verifications both wrote `packedByUserId`, a reopen could be silently re-closed, and `version` did not move.** | `claimParcelClose` is a guarded UPDATE (`WHERE "parcelClosedAt" IS NULL`) bumping `version`; `reopenParcel` is its mirror (`IS NOT NULL`), which also makes the `not-closed` refusal race-safe rather than a pre-read. The row lock closes the same race a second way. |
| B3 | **`Shipment.errorMessage` would have handed raw carrier prose to the narrowest role in the system**, bypassing the `shipments:write` redaction `ShipmentResponseDto` applies because that text may embed address fragments. | `providerCode` (a discriminator, never redacted) is always returned; `carrierMessage` is gated on the identical `ROLE_PERMISSIONS` predicate. **The mockup renders the prose verbatim — for an operator at the bench it still does, and for a `packer` it does not.** |
| B4 | **The shipping read the plan assumed does not exist** — `shipments.fulfillmentWorkId` (#2402) had no reader, and reaching for `SHIPMENT_REPOSITORY_TOKEN` from `apps/api` is a deny shape. | `ShipmentRepositoryPort.findByFulfillmentWorkIds` + a batched `IShipmentQueryService` counterpart keyed by work id, `direction` required. |

### Blocking / required (pre-implement)

- **`FulfillmentWorkListFilter.parcelClosed`** added (three-state optional), because no closed/packed axis existed to select the unlabelled list on.
- **`FulfillmentWorkView` widened** with `parcelClosedAt` + `packedByUserId`; the view carried neither.
- **`ReservationConsumeCandidateStatusValues` added to the shipping barrel** — the pre-implement gate reported it exported, and it was exported from its file but not re-exported by the barrel.
- **Line identity comes from two batched catalogue reads.** `ProductVariant` has `ean`/`gtin` and no `barcode`, and no `name` at all (that is on `Product`), so the DTO names what it holds.
- **E2's barcode resolution is in the browser**, against the barcodes the parcel read already returned — `getVariantsByBarcodes` is master-connection-scoped and the bench holds no such id.
- **The invoice's `ready` state now means issued AND printable**, mirroring the register route's own two conditions, with `issued-not-printable` as its own state. Telling a packer "ready to print" and then answering 409 is the failure F2 exists to remove.
- **The two `fulfillment-work.orm-entity.ts` docblocks this issue redeems were rewritten** — leaving "no `packedAt` is added here" beside a `parcelClosedAt` column would have made the file contradict itself.

### Important, applied

- **D2's third half is shared too.** `BenchExecutorResolver` lifts #2416's two private methods out of `BenchWorkService`; restating "active, capability enabled, registry-resolved adapter key" in the refusal would have been the very duplication D2 forbids, one level below where the pure extraction reached.
- **"Required" is `totalQuantity − cancelledQuantity`**, the same expression the list publishes as `unitsToVerify`, shared as `requiredUnitsForLine` and re-read **inside** the lock.
- **F4's retry is scoped to the case it can serve.** `retryable` is true only when a label exists to be re-fetched. Buying one needs a recipient and operator-typed parcel dimensions — the PII this surface exists not to hold — so the bench states that dispatch owns the rest rather than offering a button that cannot succeed. The mockup's *"Put the box on the problem shelf"* is the honest affordance there.
- **`GET /bench/unlabelled-parcels` is bounded, executor-scoped and projected field by field**, and reports `truncated`.
- **`settleGesture` gains its first caller**, and the hand-confirm path mints its id through the same `beginGesture`, so `gestureId` has one shape in storage.
- **`reopenParcel` takes `expectedVersion`.**
- **`generated` is deliberately outside the departure set** for E6, with the reason recorded on `hasShipped`: a bought label is not a box that has gone, and refusing there would strand every parcel awaiting collection.

### Deviations from the mockups, recorded rather than silently absorbed

- The label card renders *"fetched 14:29"* and *"tried 3 times"*. `Shipment` carries **neither** a fetch instant nor an attempt counter, so the surface shows what exists. Noted in the mockups README.
- `carrierMessage` is absent for a `packer` (B3 above), so the quoted carrier line renders only for a session holding `shipments:write`.

### Found while implementing, not by either gate

- **The integration harness did not truncate `fulfillment_work_verifications`** — its FK is migration-only, so the closure walk cannot reach it, and a verification written by one case was counted by the next. Added to the explicit list beside its three siblings.
- **The F1 never-issues guard fired on its own justification.** Scanning raw source matched the docblocks explaining why the bench never issues. It strips comments now — the same trap `no-parcel-commit-control.spec.ts` was already written to avoid.
