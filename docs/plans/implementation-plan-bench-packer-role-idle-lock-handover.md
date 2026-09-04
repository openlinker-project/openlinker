# Implementation plan — W3b-1 Surface A: the bench, the `packer` role, idle lock and handover (#2413)

- **Issue**: #2413 (epic #2422)
- **Spec**: `docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` § 2.1 (A1–A5), decisions D1–D4, D6, D12, D13, D15, D16
- **Decision**: [ADR-071](../architecture/adrs/071-pack-station-principal.md)
- **Depends on**: #2079 (`a6eb8da7c`) — landed on this branch
- **Mockup**: `docs/plans/mockups/oms-wave3b/templates/BenchIdentity.dc.html` (locked / sign-in / handover)

---

## 1. What this is

ADR-071: **the pack station has no principal**. Every packer is an ordinary user on a narrower
role; the bench is a device label. So this issue is four things, of which the third is the
substantial one:

1. a `packer` role,
2. an attribution column pair on `fulfillment_works`,
3. **a review of all 76 `@AnyRole()` routes against that role**,
4. three pieces of bench UX (handover, idle lock, permanently visible name).

---

## 2. The route review — the substantial half

### 2.1 The inventory is machine-derived, not transcribed

The 76 routes were enumerated by running `route-authorization-coverage.spec.ts`'s own discovery
machinery (Nest `Reflect.getMetadata`, filesystem-walked controllers) rather than by grepping for
`@AnyRole()` — a text scan mis-attributes multi-line decorators and cannot resolve the
class-vs-handler precedence `RolesGuard` applies. Count confirmed: **76**.

### 2.2 The principle

Route-by-route intuition produces an incoherent set, so the review applies one rule:

> `packer` **keeps** access to **operational reads a bench legitimately touches** — the item they
> are verifying, the parcel's shipment and label, stock availability. It is **excluded from every
> REGISTER and from configuration** — the customer register, the ORDER register, financial and
> fiscal documents, connection configuration, job and webhook diagnostics, commercial analytics,
> and the location register. The packer reaches the parcel in front of them **through the work**,
> never by enumerating a register.

*(The order half of that sentence is § 8's BLOCKING #2, applied. The first draft kept the order
register open on the grounds that "the packer needs the parcel", and `orderSnapshot` carries the
buyer's name, email and both addresses — so the customer register would have been closed and the
same data reachable one route over.)*

This is D12's own standard (*"every temp packer can read the customer database is not a defensible
posture"*) generalised. **Every exclusion is behaviour-neutral today**: `@Roles('admin','operator',
'viewer')` names exactly the roles `@AnyRole()` currently admits, so no existing user's access
changes. The change is what happens to the *fourth* role.

### 2.3 Disposition (76 = 31 keep + 45 narrow)

**Narrowed to `@Roles('admin','operator','viewer')` — 45 routes**

| Group | n | Routes |
|---|---|---|
| Buyer PII *(owner-decided; story A5)* | 2 | `GET /customers`, `GET /customers/:id` |
| Financial documents *(owner-decided)* | 12 | `InvoicingController` ×7, `NumberingSeriesController` ×5 |
| Infrastructure / diagnostics *(owner-decided)* | 15 | `Cursors` ×2, `Sync` jobs ×4, `WebhookDelivery` ×2, `Adapter` ×1, `Allegro` cursors/commands ×4, `Connection` `GET /` + `GET /:id` |
| Inventory locations *(owner-decided)* | 2 | `GET /inventory/locations`, `GET /inventory/locations/:id` |
| **Commercial analytics** *(added by this review — flagged)* | 5 | `GET /analytics/trust`, `/needs-attention`, `/sales`, `/top-products`, `/top-products/:productId/variants` |
| **Fiscal registrations** *(added by this review — flagged)* | 2 | `GET /fiscal-registrations`, `GET /orders/:orderId/fiscal-registration` |
| **The order register** *(added by the tech review — see § 8 BLOCKING #2)* | 7 | `OrdersController` ×6 (incl. the three summaries and `:id/sales-document`), `RefundsController` ×1 |

The two added groups are stated in the PR body rather than applied silently. Both follow directly
from the owner's own rationale and neither was enumerated:

- **Analytics** returns revenue, AOV, median order value and a per-channel breakdown
  (`sales-analytics.controller.ts`). If invoice PDFs are not packer-facing, company revenue is not
  either — and the argument is *stronger* here, since an invoice concerns one order and this
  concerns the business.
- **Fiscal registrations** are the same class of object as the invoicing reads the owner excluded,
  under a different controller. Excluding one and not the other would leave the decision keyed on
  file layout rather than on what the data is.

Both are fail-closed: re-admitting `packer` is one word if the owner disagrees.

**Kept `@AnyRole()` — 31 routes**

| Group | n | Why a packer may reach it |
|---|---|---|
| Session self-service | 2 | `GET /auth/me` is what **A4** renders. Excluding it breaks the story. |
| Products / variants | 6 | Item identity for verification. |
| Shipments | 4 | Incl. `:id/label` — the label goes **on the box** and the bench prints it (**D14**, **F1**). |
| Returns | 5 | Warehouse-adjacent; no buyer PII on the return aggregate. |
| Listings / shop-publish / bulk batches | 10 | Catalogue reads; no PII, no configuration, no money. Judged harmless rather than needed. |
| Inventory (`/inventory`, `/inventory/availability`) | 2 | Operational stock, distinct from the location **register**. |
| Pickup points | 2 | Operational carrier reference data. |

### 2.4 A consequence for #2418, recorded here rather than discovered there

Excluding `packer` from `GET /invoices/:invoiceId/document` means **the bench cannot print the
invoice through the invoice register**. Surface D (`BenchDocuments`) needs it — *"the bench prints;
it never issues"*.

That is not a contradiction to resolve now; it is the narrower role working. #2418 must expose a
**work-scoped** document route (`GET /fulfillment/works/:id/documents`, `@Roles(...,'packer')`)
returning only the documents for the parcel in front of the packer, rather than granting the whole
register. Reaching documents *through the work* is the correct shape for a narrow role, and the
alternative — widening the register — would undo this issue.

### 2.5 The decision is encoded as a test, not as a comment

A prose note saying "CustomersController must never carry `@AnyRole()`" is discharged the moment
somebody adds a route. `packer-exclusion.spec.ts` asserts, over the same discovered metadata, that
**every `@AnyRole()` route in `apps/api` appears on an explicit 31-entry allow-list** — so a new
open route fails the build wherever it lands, including on a controller nobody has written yet.
(It began as a list of excluded controllers, which guards only the controllers somebody thought
of — the hand-listed-array failure #2079's coverage spec exists to remove. Inverted per § 8.) It
also asserts the reverse direction: a stale entry is a standing licence for a route to reopen.

### 2.6 The tripwire

`user-role-values.spec.ts` moves to the four-role list, and its docblock is rewritten to record
that the #2413 review was **discharged by review**, naming § 2.3 of this plan — so the next reader
sees a decision, not a list somebody extended to make a test pass. The tripwire keeps firing for
role five.

---

## 3. The `packer` role

`UserRoleValues` gains `'packer'`. `ROLE_PERMISSIONS.packer` is **the empty set**, deliberately:

- `PermissionValues` has no member describing packing. Granting `orders:read` to satisfy the
  `Record` would light up the FE's orders navigation for a packer — `usePermission` drives UI
  visibility — which is the opposite of a narrower role.
- The map is display-only; backend authorization is `@Roles`, which § 2.3 sets. So an empty set
  costs nothing today and is the fail-closed direction.
- The bench's own permission arrives with the bench's own surfaces (#2416/#2418), which is when a
  `pack:*` member can be named for something that exists — ADR-048 decision 1's "no interface
  without an implementer", applied to a permission.

**FE mirror**: `apps/web/src/features/users/api/users.types.ts` carries a hardcoded
`type UserRole = 'admin' | 'operator' | 'viewer'`, and `users-page.tsx` two hardcoded role pickers.
Both gain `packer`, or an admin cannot assign the role that this issue exists to create.
`SessionUser.role` is already `string`, so the session needs no change.

---

## 4. Attribution — `packedByUserId` ⊕ `packedByService`

Two nullable `text` columns on `fulfillment_works` plus
`CHK_fulfillment_works_packed_actor`.

### 4.1 The predicate is **at-most-one**, not the holds table's XOR — and that is not a slip

`CHK_fulfillment_holds_actor` is `(a IS NOT NULL) <> (b IS NOT NULL)`: **exactly** one. A hold
always has an actor, so both-null is meaningless there.

A *work* is created unpacked and spends most of its life that way, so both-null is the **normal**
state. Copying `<>` literally would fail the migration on every existing row and make every future
`INSERT` impossible. The predicate is therefore:

```sql
NOT ("packedByUserId" IS NOT NULL AND "packedByService" IS NOT NULL)
```

What the issue asks for is preserved exactly: *"a 3PL packed this"* and *"a human packed it"* can
never be the same value, and a single nullable column could not express both. Only the third state
("nobody has packed it") is admitted, because here it exists.

### 4.2 Both-null is ambiguous, and no timestamp is added to disambiguate it

Both-null reads as *not packed* **or** *packed with no attribution recorded*. `status` distinguishes
them, and adding a `packedAt` here would create a second, competing completion instant beside the
phase model #2418 owns. Recorded as a limitation rather than papered over.

> **Superseded by #2890.** #2418 landed that phase model as `parcelClosedAt`, which removed the
> disambiguator this paragraph relies on: closed-with-neither-actor became representable and
> reachable. `CHK_fulfillment_works_closed_parcel_actor` now refuses it, so both-NULL is legal only
> while the parcel is open. The limitation above no longer holds.

### 4.3 `text`, not `uuid`

`order_records.packedByUserId` (#2287) is `uuid`. `fulfillment_holds.placedByUserId` /
`placedByService` are `text`. This column pair mirrors the *holds* pair in shape, name-discipline
and now type — consistency inside the context the columns live in beats consistency with a
different context's different fact. No FK to `users`, matching both precedents: a dangling id from a
deleted user is the honest outcome for an audit fact.

### 4.4 Relationship to `order_records.packedAt` / `packedByUserId` (#2287)

Different facts at different grains, deliberately coexisting. #2287 is an **operator ticking an
order packed** by hand. This is the **bench recording who closed a work object** — D4's per-work,
per-phase grain, from which the order-grain fact is *derived*. Neither is computed from the other in
this issue.

> **Superseded by #2890.** The derivation is now wired: closing a parcel calls
> `IOrderRecordService.markPacked`, whose `WHERE packedAt IS NULL` guard is D10's first-writer-wins.
> The order-grain fact IS computed from this one — the reverse is still never true.

### 4.5 D6 holds

Nothing is added to `FulfillmentProgressEvent`. No writer ships here — #2418 owns the write, at the
moment it owns the verification that triggers it. The column ships ahead of its writer, the posture
this tree takes throughout.

### 4.6 Parity

`fulfillment-work-migration-parity.int-spec.ts` is generic over `TABLES` and compares CHECK
constraints by **name and definition**, so it covers this automatically. The new constraint joins
its containment roster (the file's convention for constraints its own prose reasons about).

---

## 5. Bench UX (A2, A3, A4)

### 5.1 There is no host surface yet, so this ships one

`apps/web` has `/fulfillment` (#2410 — the *operator* worklist) and no bench. Mounting an idle lock
on an operator page would be wrong; shipping unmounted components would leave A2–A4 asserted only
against themselves.

So: a minimal **`/bench` route** whose body is a placeholder naming #2416, wrapped in the identity
machinery. #2416/#2418 fill the body in; the identity behaviour is real and testable now.

### 5.2 The three pieces

- **`useIdleTimeout`** (`shared/hooks/`) — pointer/key/scroll activity resets a timer; fires once on
  expiry. No `localStorage` (a guard test forbids persisting anything auth-shaped).
  **Default 5 minutes**, `VITE_OL_BENCH_IDLE_TIMEOUT_MS`-configurable (spec § 4 open question 1).
  Rationale: long enough to survive fetching a box from a rack, short enough that an unattended
  terminal on a floor is not left signed in for a break. Not persisted, not per-user.
- **`BenchIdentityOverlay`** — locked / sign-in / handover, per the mockup. **Rendered as an overlay
  above the bench body, never as a route change**, which is the mechanism by which locking "never
  discards progress": the bench subtree is not unmounted.
- **`BenchIdentityBar`** — the signed-in name, always rendered, no menu to open (**A4**).

### 5.3 Handover must actually clear the outgoing session

`adapter.clearSession()` drops the in-memory access token and POSTs `/auth/logout`, but **does not
clear the react-query cache** — on a shared browser profile the incoming packer would read the
outgoing packer's cached responses. `switchPacker` therefore calls `clearSession()` **and**
`queryClient.clear()`, and the overlay only leaves the `handover` state once a new session resolves.
Asserted by a test, not by a comment.

"Verification progress survives the switch" is proved by mounting a stateful child under the
overlay and asserting its state after a full lock → switch → sign-in cycle.

---

## 6. Files

**Backend**
- `libs/core/src/users/domain/types/role.types.ts` — `packer` + `ROLE_PERMISSIONS.packer`
- `libs/core/src/fulfillment/infrastructure/persistence/entities/fulfillment-work.orm-entity.ts`
- `apps/api/src/migrations/1869000001000-add-fulfillment-work-packed-actor.ts`
- 12 controllers — `@Roles('admin','operator','viewer')` on 38 handlers
- `apps/api/src/auth/user-role-values.spec.ts` (rewritten)
- `apps/api/src/auth/packer-exclusion.spec.ts` (new)
- `apps/api/test/integration/bench-packer-authorization.int-spec.ts` (new — **A5**)
- `apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts` (roster)

**Frontend**
- `apps/web/src/shared/hooks/use-idle-timeout.ts` (+ test)
- `apps/web/src/features/bench/` — `bench-identity.copy.ts`, `BenchIdentityBar`, `BenchIdentityOverlay`, `use-bench-identity.ts` (+ tests)
- `apps/web/src/pages/bench/bench-page.tsx`, `apps/web/src/app/routes/bench.route.tsx`
- `apps/web/src/features/users/api/users.types.ts`, `apps/web/src/pages/users/users-page.tsx`

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| A narrowed route breaks an existing FE call | Behaviour-neutral by construction — the three existing roles are named explicitly. Asserted by the unchanged FE test suite. |
| Migration CHECK fails on existing rows | At-most-one, not XOR (§ 4.1). Verified against real Postgres by the parity spec. |
| `synchronize` / migration name drift | The named `@Check` decorator, plus the parity spec that has caught exactly this before. |
| Empty `packer` permission set breaks `GET /me` or the FE | `permissions: []` is a valid response; no FE path branches on emptiness. Verified. |
| The `/bench` route must satisfy the routing contract tests | `route-handle.test.ts` / `route-lazy.test.ts` require a crumb + lazy leaf. |

---

## 8. Findings applied from the two gates

`/pre-implement` and `/tech-review` both ran against this plan before implementation.
Recorded here rather than in a PR comment, because the reasoning is the durable part.

**Note on one spurious finding.** The tech review read the worktree while § 2 and § 4
were already applied as uncommitted WIP, and reported the plan as "out of sync with the
branch" — that the narrowing and `packer` were "already committed in `a6eb8da7c`". They
were not; they were this issue's own in-flight edits. Its BLOCKING #1 is therefore
withdrawn. Its BLOCKING #2 is real and is the most valuable finding of either gate.

### Applied

| # | Finding | What changed |
|---|---|---|
| B2 | **`GET /orders` leaks a superset of `GET /customers/:id`.** `OrderRecordResponseDto.orderSnapshot` carries the buyer's name, email and both un-redacted addresses under the default `OL_STORE_PII=true`. Narrowing `CustomersController` alone would have made A5 nominal. | `OrdersController` (6) + `RefundsController` (1) narrowed. The principle in § 2.2 is restated: **registers are excluded; the bench reaches the parcel through the WORK.** Recorded at the top of `orders.controller.ts` and asserted in the A5 int-spec. |
| C1 | `role.types.spec.ts` asserts every role holds ≥1 permission — `packer: []` fails it. | The loop is narrowed and the exception asserted **positively**, so an empty set for any other role is still a failure and `packer` becoming non-empty by accident is one too. |
| C2 | `test-auth.helper.ts` hardcodes the three roles, so the A5 spec could not seed a packer. | Widened to `UserRole`; `loginAsPacker` added. |
| C3 | `route-lazy.test.ts` pins `EXPECTED_LAZY_ROUTE_COUNT = 62`. | 63, with the breakdown comment updated. |
| TR | A5 must assert the **sales-document rules surface**, not only customers. | Asserted, plus a positive `GET /auth/me` case (a spec of only 403s passes if the role is broken outright) and a viewer case proving the narrowing is behaviour-neutral. |
| TR | `features/bench` needs registering in `check-ui-vocabulary.mjs` **and** both `.eslintrc.js` pattern groups, with the folder, not later. | Both, plus the `index.ts` barrel. |
| TR | The locked screen must reveal nothing about the order, and it is unstated whether locking clears the session. | **Lock clears the session and the query cache.** An overlay over a live token is a curtain, not a lock. The body is concealed three ways (`aria-hidden`, `inert`, a CSS rule) and asserted. Handover deliberately does **not** conceal — D13 requires the incoming packer to see what is already verified. |
| TR | `packedByUserId` as `text` collides with D4: the derivation target `order_records.packedByUserId` is `uuid`. | Split: `uuid` for the user id, `text` for the free-form service name. The divergence from `fulfillment_holds` is recorded at the column. |
| TR | `packer-exclusion.spec.ts` as a deny-list guards only the controllers somebody thought of. | **Inverted to an allow-list** over discovered metadata: every `@AnyRole()` route must be listed, so a new open route fails the build wherever it lands. Also asserts the reverse — a stale entry is a standing licence for a route to reopen (#2791's lesson). |
| TR | `VITE_*` is build-time; document it. | Said so in `use-bench-identity.ts` and in a new `apps/web/.env.example` block. |
| W1 | "Behaviour-neutral" overstates it slightly: `RolesGuard` short-circuits `@AnyRole()` without inspecting the role, and `UserRepository` coerces an out-of-set role to `viewer`. | Neutral for every DB-backed user; a real (desirable) narrowing for an out-of-set principal such as a stale JWT. |

### Declined, with reasons

- **Narrowing `GET /inventory/locations/:id` may leave #2416 unable to render a location
  name.** Real, and left as-is: it is the same forward consequence as the invoice
  documents, and the remedy is the same — the work-scoped read carries the label. Noted
  here rather than reopening the owner's decision.
- **`GET /orders/:id/sales-document` kept open.** Superseded — the whole register is now
  narrowed, so the question does not arise.

### Deferred to #2416 / #2418, recorded so they are not discovered

1. A **work-scoped order read** projecting only what a bench must see. Until it exists the
   bench sees no order data. Fail-closed, and free today because the body is a placeholder.
2. A **work-scoped document read** for printing the invoice at the bench (§ 2.4).
3. A location **label** on the work, per the declined item above.
4. Whether `/bench` earns a nav entry — which would also need `RoleValues` widened.

---

## 9. Findings applied from the second gate (`/tech-review` on the finished diff)

| # | Finding | What changed |
|---|---|---|
| **BLOCKING** | **The lock signed the packer out of the ROUTER.** `/bench` was a child of `rootRoute`, and `AuthenticatedAppLayout` answers an anonymous session with `<Navigate to="/login">`. Since `lock()` clears the session deliberately, the layout unmounted the whole bench subtree — destroying the parcel and showing the generic login page. A2 and A3 both defeated in production, invisible to every component test because they mount `BenchSurface` with no router. | `/bench` moved to a new top-level `standaloneRoutes` array beside `/consent`, outside `AuthenticatedAppLayout` and outside `AppShell`. `bench-route-placement.test.ts` asserts the placement structurally, because placement is what was wrong and what a refactor would plausibly "tidy" back. `route-lazy.test.ts` collects `standaloneRoutes` so the bench stays covered. |
| IMPORTANT | The idle clock was disarmed in `handover` — where the outgoing packer is **still signed in**. One tap of *Switch packer* and a walk away left an unattended terminal signed in indefinitely. | `enabled: signedIn && state !== 'locked'`, plus a test for the abandoned-handover case. |
| IMPORTANT | `void clearPrincipal()` was a floating promise on the security path; a failed logout POST left `locked` reported over a live token, and `confirmHandover` could strand in `handover`. | `try/finally` in `clearPrincipal` (the cache clears whether or not the network answered) and in `confirmHandover`, plus an explicit `.catch()` in `lock()`. The lock is now at least as strong offline as online. |
| IMPORTANT | Three docblocks cited `bench-identity-overlay.test.tsx`, which does not exist, for a **lock → switch → sign-in** cycle. **No test covered sign-in at all** — the `wasSignedIn` transition effect was asserted only by its own comment. | References corrected to `bench-surface.test.tsx`, and the sign-in leg added. It starts SIGNED IN and lets the first idle period elapse, so only `reset()` can produce the second lock — the first draft started signed-out and **survived deleting `reset()`**, i.e. asserted nothing. |
| IMPORTANT | `VITE_OL_BENCH_IDLE_TIMEOUT_MS` was documented and read by nothing; `resolveBenchIdleTimeoutMs` had no call site. | Wired in `BenchSurface`, which is the one env read. |
| IMPORTANT | `var(--color-surface, #fff)` / `var(--color-border, #e5e7eb)` — neither token exists, so the fallback always won and the locked overlay painted white in dark mode. `check-design-tokens.mjs` is one-directional and cannot catch it. | Real tokens: `--bg-surface-elevated`, `--border-subtle`. |
| IMPORTANT | The tripwire docblock said "38 narrowed" (45) and described `packer-exclusion.spec.ts` as the deny-list draft that spec explicitly rejects. | Both corrected. |
| IMPORTANT | The identity bar rendered `Signed in` beside `Nobody is signed in` — the contradiction a packer reads first at a locked terminal. | The whole span branches. |
| SUGGESTION | *"Inverted, the guard has no blind spot"* overstated it: `@Roles(..., 'packer')` admits a packer without mentioning `@AnyRole()`, and #2416/#2418 will reach for exactly that spelling. | A second, separate `PACKER_GRANTED_ROUTES` array (empty today) with its own both-directions assertions. Verified red-first. |
| SUGGESTION | `getOwnPropertyNames` misses inherited handlers. | Recorded as a decision; no controller extends another today, and the #2079 coverage spec shares the limitation. |
| SUGGESTION | The migration's columns were `IF NOT EXISTS` but the constraint was a bare `ADD`. | `DROP CONSTRAINT IF EXISTS` first — Postgres has no `ADD CONSTRAINT IF NOT EXISTS`. |
| SUGGESTION | `/bench` had no role gate; an operator navigating there would be signed out after five idle minutes. | Resolved by the BLOCKING fix: the bench is a standalone terminal surface with no nav entry, reached by URL. Whether it earns a role gate is #2416's, with the nav entry. |

Confirmed correct by the same review and left alone: the 45-route narrowing (no frontend caller breaks, no route dropped a role), the absence of a migration for the role itself, the `uuid`/`text` split, the at-most-one CHECK and its name parity, and `use-idle-timeout.ts` in isolation.
