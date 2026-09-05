# Implementation Plan: Route authorization — audit, decorate, deny by default (#2079)

**Date**: 2026-09-03
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2079 · **Blocks**: #2413 (`packer` role) and therefore epic #2422
**Wave**: OMS Wave 3b, prerequisite § 1.6

---

## 1. Task Summary

**Objective.** Make every HTTP route in `apps/api` carry an explicit authorization
decision that `RolesGuard` actually reads, and make the guard **deny** when no such
decision is present.

**Context.** `RolesGuard.canActivate` returns `true` for any route carrying no
`@Roles()`:

```ts
if (!requiredRoles || requiredRoles.length === 0) return true;
```

It is the second global `APP_GUARD` after `JwtAuthGuard`, so **an undecorated route
authorizes any authenticated principal**. That was tolerable while every principal
was an OL user with one of three broadly-equivalent roles — the fail-open default
reduced to "logged-in users may call this", which was intended.

[ADR-071](../architecture/adrs/071-pack-station-principal.md) arms it: packers become
ordinary users on a narrower `packer` role, and **a narrower role means nothing while
an undecorated route admits any authenticated principal**. A `packer` session would
reach buyer PII on day one.

**Classification**: Infrastructure · Interface layer. No CORE change, no schema change,
no migration.

---

## 2. The audit (measured, not estimated)

Produced by reading real NestJS decorator metadata off every controller class in
`apps/api/src` — not by text-scanning the source. That distinction is load-bearing:
a text scan of this codebase reports `AllegroController.callback` as undecorated
because a comment sits between its `@Public()` and its `@Get()`. **The audit and the
shipped coverage spec share one discovery mechanism** so the number cannot drift.

Measured on `oms-programme-wave-3b` at `fd4311479`:

| | Count |
|---|---|
| Route handlers total | **279** |
| `@Public()` (JWT bypassed; `RolesGuard` must not gate these) | **15** |
| `@Roles(...)` | **188** |
| **Undecorated — authorize any authenticated principal** | **76** |

The 76 break down as **75 `GET` + 1 `PATCH`**. The `PATCH` is
`AuthController.updateAnalyticsConsent` (`PATCH /auth/me/analytics-consent`, #1938).

### 2.1 Two corrections to the issue text

Both are findings to report rather than problems to solve; neither changes the plan.

1. **The `sales-documents` rules surface is no longer undecorated.** The issue (measured
   at `0470542e0`) names it, including its writes. All three `sales-documents`
   controllers now carry a **class-level `@Roles('admin')`**. Spec § 1.6 story **A5**
   names that surface as one a bench session must be refused — it already is.
   The live half of A5 is `CustomersController`.
2. **The count is 76, not ~121.** Routes have been decorated since the issue was
   written. The proportion is what matters, and it is still ~27% of the surface.

### 2.2 Full inventory

`Previous effective audience` is `any authenticated user` for **every** row — that is
the defect. `Decorator applied` is `@AnyRole()` for every row (see § 4, D6).

| Controller | Route(s) |
|---|---|
| `analytics-trust/analytics-trust.controller.ts` | `GET trust` |
| `analytics/needs-attention.controller.ts` | `GET needs-attention` |
| `analytics/sales-analytics.controller.ts` | `GET sales` |
| `analytics/top-products.controller.ts` | `GET top-products`, `GET top-products/:productId/variants` |
| `auth/auth.controller.ts` | `GET me`, **`PATCH me/analytics-consent`** |
| `cursors/cursors.controller.ts` | `GET /`, `GET :connectionId/:cursorKey` |
| `customers/customers.controller.ts` | `GET /`, `GET :id` — **buyer PII** |
| `fiscalization/fiscalization.controller.ts` | `GET fiscal-registrations`, `GET orders/:orderId/fiscal-registration` |
| `integrations/adapter.controller.ts` | `GET /` |
| `integrations/allegro.controller.ts` | `GET connections/:id/cursors`, `GET connections/:id/commands`, `GET .../commands/failed`, `GET .../commands/:commandId` |
| `integrations/connection.controller.ts` | `GET /`, `GET :id` |
| `inventory/inventory-locations.controller.ts` | `GET /`, `GET :id` |
| `inventory/inventory.controller.ts` | `GET /`, `GET availability` |
| `invoicing/invoicing.controller.ts` | `GET connections/:connectionId/bank-accounts`, `GET invoices`, `GET invoices/:invoiceId`, `GET .../content`, `GET .../document`, `GET .../upo`, `GET orders/:orderId/invoice` |
| `invoicing/numbering-series.controller.ts` | `GET numbering-series`, `GET .../unassigned`, `GET .../:seriesId`, `GET .../:seriesId/audit`, `GET connections/:connectionId/numbering-routes` |
| `listings/bulk-listing.controller.ts` | `GET :batchId` |
| `listings/bulk-shop-publish.controller.ts` | `GET :batchId` |
| `listings/listings.controller.ts` | `GET /`, `GET :id`, `GET :id/offer`, `GET connections/:connectionId/offers/creation/:offerCreationRecordId` |
| `listings/shop-publish.controller.ts` | `GET categories`, `GET attributes`, `GET attributes/:attributeId/terms`, `GET :recordId` |
| `orders/orders.controller.ts` | `GET /`, `GET status-summary`, `GET sla-summary`, `GET lifecycle-summary`, `GET :internalOrderId`, `GET :internalOrderId/sales-document` |
| `orders/refunds.controller.ts` | `GET :internalOrderId/refunds` |
| `products/products.controller.ts` | `GET /`, `GET search`, `GET :id`, `GET :productId/variants`, `GET :productId/tax-rate-journal`, `GET variants/:variantId` |
| `returns/return-writes.controller.ts` | `GET :returnId/correction-proposal` |
| `returns/returns.controller.ts` | `GET /`, `GET ingestion-availability`, `GET events`, `GET :returnId` |
| `shipping/pickup-point.controller.ts` | `GET /`, `GET :providerId` |
| `shipping/shipment.controller.ts` | `GET /`, `GET active`, `GET :id`, `GET :id/label` |
| `sync/sync.controller.ts` | `GET jobs`, `GET jobs/grouped`, `GET jobs/lookup`, `GET jobs/:id` |
| `webhooks/webhook-delivery.controller.ts` | `GET /`, `GET :id` |

### 2.3 Routes that plausibly want a *narrower* role — reported, NOT changed

Per the issue's own Assumptions section, a behaviour change to an existing route is a
decision, not a cleanup. These are decorated at their **current** effective audience
(`@AnyRole()`) and listed here for a separate decision. None is tightened by this plan.

| Group | Routes | Why it might want narrowing | Recommendation |
|---|---|---|---|
| **Buyer PII** | `CustomersController` `GET /`, `GET :id` | Spec § 1.6 A5 names these as routes a bench session must be refused. The controller has no `@Roles` at all today. | The *only* group I would act on before #2413. `@Roles('admin','operator','viewer')` is behaviourally identical today and excludes `packer` by construction. Deferred here only because it is a decision, not a defect. |
| **Financial documents** | `InvoicingController` (7), `NumberingSeriesController` (5) | Every **write** on both controllers is `@Roles('admin')`. Invoice content, PDFs and UPO documents are read-anywhere today. | Confirm intent. If reads are meant to be `admin`-only, this is a real tightening with FE impact. |
| **Infrastructure / diagnostics** | `CursorsController` (2), `SyncController` jobs (4), `WebhookDeliveryController` (2), `AdapterController` (1), `AllegroController` cursors/commands (4), `ConnectionController` `GET /` + `GET :id` | Sibling writes on each are `admin`. These expose connection config shape, job payload errors and adapter inventory. Note the wider precedent cuts the other way: `connection-sync-status` and `catalog-trust` are deliberately `admin,operator,viewer`. | Probably correct as-is; flagged because a `packer` reaching `GET /connections/:id` is odd. |
| **Inventory locations** | `InventoryLocationsController` `GET /`, `GET :id` | Writes are `admin`; #2316 documents the writes as admin-only. Reads are operational. | Probably correct as-is. |

**The remaining 52 routes are correct as `@AnyRole()`**: operational reads whose sibling
reads on the same or adjacent controllers are already explicitly `admin,operator,viewer`
(`listings`, `taxonomy`, `mapping-options`, `description-format`, `fulfillment-work`),
plus session self-service (`GET /auth/me`, `PATCH /auth/me/analytics-consent`).

---

## 3. Scope & Non-Goals

### In scope
- `@AnyRole()` decorator + its metadata key.
- `RolesGuard` inverted to deny-by-default, with an explicit `@Public()` short-circuit.
- All 76 undecorated routes decorated.
- `write-guard-coverage.spec.ts` **replaced** by a discovery-based, all-verb spec.
- A tripwire that fails the build when `UserRoleValues` changes (see D5).
- `docs/engineering-standards.md` § Route authorization.

### Out of scope
- Creating the `packer` role — that is #2413, and it needs this landed first.
- Any narrowing from § 2.3. **After this lands, wave-spec story A5 is still not
  satisfied by anything: a `packer` session would reach `GET /customers` and
  `GET /customers/:id`.** This issue makes A5 *implementable* — it does not implement
  it. A5 is an acceptance criterion of the wave and must not be closed by implication;
  its remedy is one line (§ 2.3 group 1) and is a decision, not a cleanup.
- `CsrfGuard` — it is **not** an `APP_GUARD`; it is hand-applied to `/auth/refresh` and
  `/auth/logout` only. Untouched.
- MCP routes. `mcp-transport.controller.ts` is `@Public()` with its own
  `OAuthTokenVerifier` populating `req.auth`, which `RolesGuard` never reads;
  `mcp-tokens.controller.ts` is ordinary session auth with `@Roles('admin')`. The two
  auth models stay in separate controllers. **Neither file is edited.**
- `apps/worker` — no HTTP surface.
- Permission-based (`ROLE_PERMISSIONS`) authorization — a separate axis, FE-facing.
- **An integration test asserting a real `403` on an undecorated route** —
  deliberately deferred, recorded here rather than only reported (tech-review
  SUGGESTION, second pass). The guard's unit spec proves the decision and
  `viewer-role-authz` / `operator-role-authz` prove no existing route regressed;
  nothing drives an actual HTTP request against an undecorated route because
  none exists, which is the point. **The cheapest form, if the guard ever
  regresses or a reviewer wants the end-to-end proof, is a fixture controller
  registered only in an int-spec module** — that is the natural follow-up.

### Constraints
- **No behaviour change** for any existing route and principal.
- The 15 `@Public()` routes must keep working. This is the single highest-risk detail
  (see D2) — they carry no `req.user`, so a naive default-deny 403s all of them,
  including `POST /auth/login` and every inbound webhook.

---

## 4. Design decisions

**D1 — `@AnyRole()` is a real decorator with its own metadata key.**
`ANY_ROLE_KEY = 'anyRole'`; `AnyRole()` = `SetMetadata(ANY_ROLE_KEY, true)`, in
`apps/api/src/auth/decorators/any-role.decorator.ts` beside `roles.decorator.ts` and
`public.decorator.ts`. The guard reads it. The entire point of the issue is that
*"nobody decided"* and *"everybody may"* stop sharing a representation — an absence
cannot carry that meaning, so the affirmative form must be a value the guard consults.

**D2 — the guard checks `@Public()` FIRST, and this is not optional.**
`RolesGuard` today has no `@Public()` check and does not need one: a public route
carries no `@Roles`, so it hits `return true`. **Inverting the default removes exactly
that path.** Without an explicit `IS_PUBLIC_KEY` short-circuit, deny-by-default 403s
`POST /auth/login`, `POST /auth/refresh`, every `/webhooks/:provider/:connectionId`
delivery and the whole MCP transport. Resolution order:

1. `@Public()` → allow (JWT was bypassed; there is no principal to authorize).
2. `@AnyRole()` → require `req.user`, then allow.
3. `@Roles(...)` non-empty → today's check, unchanged.
4. none of the above → **deny**.

**D2a — precedence is resolved by specificity, not by key.** Two independent
`getAllAndOverride` calls can return a nonsensical pair: a class-level `@Roles('admin')`
with a method-level `@AnyRole()` would report both. The guard therefore resolves the
**handler** level first and consults the class only when the handler carries neither
decorator — so the more specific declaration wins as a unit.

**D2b — carrying both `@Roles()` and `@AnyRole()` at the same level is a contradiction**;
the guard denies and the coverage spec fails the build on it.

**D2c — the 403 body stays `'Insufficient permissions'`.** A missing decorator is an
operator-facing configuration fault, not something to describe to a caller, so the
guard additionally logs at `warn` naming the controller and handler, under the
greppable token **`route_authorization_missing_decorator`** — matching the repo's
alertable-token convention (`inventory_cross_source_position_conflict`,
`reservation_expiry_page_all_failed`). The token is what makes the condition findable
in production, where the 403 body deliberately says nothing.

**D3 — `@AnyRole()` goes on METHODS, never on a class.** Eight of the affected
controllers are undecorated end to end (`products`, `customers`, `cursors`, `adapter`,
`webhook-delivery`, `pickup-point`, the three `analytics*`), and a class-level
`@AnyRole()` there is one line instead of two to six. It is refused anyway: a
class-level `@AnyRole()` silently covers every route *added to that class later*, which
re-creates "undecorated inherits open" at class granularity and destroys the property
deny-by-default exists to buy — that a **new** route fails closed. The obvious victim is
a new PII route on `CustomersController`. The coverage spec therefore **bans class-level
`@AnyRole()`**. Note the asymmetry with class-level `@Roles()`, which is legitimate and
in use (`sales-documents`): a narrowing default is safe to inherit, a widening one is not.

**D4 — the coverage spec discovers controllers; it never lists them.**
`write-guard-coverage.spec.ts` has **two independent defects**, and fixing either alone
leaves the check ineffective: it covers non-GET handlers only, **and** it runs against a
hand-listed 23-controller set. Both hide `PATCH /auth/me/analytics-consent`
independently. The replacement walks `apps/api/src` for `*.controller.ts`, `require`s
each, and takes every export carrying NestJS `PATH_METADATA`.

**D4a — the spec must be non-vacuous, asserted.** Per
`docs/testing-guide.md § Port-contract suites`, the machinery that looks thorough and
asserts nothing is the thing to defend against. Five guards:
 (i) an import failure **throws** — never skipped, never caught into a "0 problems" pass;
 (ii) at least one controller file is discovered;
 (iii) every discovered file yields ≥ 1 controller class;
 (iv) every controller class yields ≥ 1 route handler;
 (v) **the filename convention discovery rests on is enforced, not trusted** — see D4b.
Without (ii)–(iv) a broken walker or a metadata-key rename reports green over an
unasked question. Note (ii)–(iv) are also what makes the Nest metadata-key **string
literals** (`'path'`, `'method'`) acceptable: `@nestjs/common/constants` is not in that
package's `exports` map, so the existing spec already hardcodes `'method'`, and a rename
of either key collapses discovery to zero — caught by (iii) and (iv) respectively rather
than passing vacuously. That reasoning belongs in the spec's file header, or the next
reader sees two magic strings with no defence.

**D4b — the `*.controller.ts` convention is ENFORCED (tech-review BLOCKING finding).**
Walking `*.controller.ts` is a **naming convention with nothing enforcing it**. A
`@Controller` class in a differently-named file is invisible to the spec, and its routes
would be free of both the decorator requirement and the reviewer's attention — which is
structurally the same failure as the hand-listed array, one level down: a set that looks
complete and is not, going green either way. Guards (ii)–(iv) do not close it; they
assert the files *found* are non-empty and yield routes, never that the walk found every
file. The spec therefore text-scans **every** `.ts` under `apps/api/src` for a line
matching `^@Controller` and asserts that file set is a subset of the discovered
`*.controller.ts` set. Anchoring at line start is required: `mcp/mcp-resource.ts:22` and
`analytics/analytics.module.ts:32` both mention `@Controller` in prose. Verified: the
convention holds today (58 `^@Controller` declarations across 57 files, none outside), so
the guard lands green and stays cheap.

**D5 — a tripwire on `UserRoleValues`.** `@AnyRole()` means "every role that exists
today, deliberately". Adding a role silently widens all 76 sites. A one-line assertion
that `UserRoleValues` is exactly `['admin','operator','viewer']`, whose failure message
instructs the next author to review every `@AnyRole()` site, converts that latent
widening into a build failure **at the moment #2413 adds `packer`** — which is precisely
when the review is wanted. Cheap, and it is what makes blanket `@AnyRole()` honest
rather than a rubber stamp. **It lives in `apps/api`, not beside the constant in
`libs/core`**, because the message is about `@AnyRole()` call sites and every one of
them is in `apps/api`; a core-side assertion could not name them. That rationale goes in
the spec's file header so it is not "corrected" later.

**D6 — all 76 get `@AnyRole()`.** Their current effective audience is every
authenticated user. `@Roles('admin','operator','viewer')` denotes the identical set
today, but it is an enumeration that silently becomes wrong the day a role is added,
and applying it everywhere would leave `@AnyRole()` shipped with zero call sites — a
decorator the issue asks for, existing and meaning nothing. Narrowing candidates are
reported in § 2.3 rather than applied.

---

## 5. Implementation plan

### Phase 1 — the decorator and the guard

1. **`apps/api/src/auth/decorators/any-role.decorator.ts`** *(new)* — `ANY_ROLE_KEY`,
   `AnyRole()`. File header states the class-level ban and why (D3).
   *Acceptance*: exports compile; metadata readable via `Reflect.getMetadata`.
2. **`apps/api/src/auth/guards/roles.guard.ts`** — implement D2/D2a/D2b/D2c. Update the
   file header, which currently documents the old fail-open contract verbatim.
3. **`apps/api/src/auth/guards/roles.guard.spec.ts`** — **rewrite, do not patch** (gate
   finding W1). Three of its seven tests encode the inverted contract: *"should allow
   access when no `@Roles()` decorator is present"* (L35), *"…when `@Roles()` has empty
   array"* (L42), and *"should read metadata from both handler and class"* (L77), which
   asserts `getAllAndOverride` was called with `(ROLES_KEY, [handler, class])` — an
   assertion about the *mechanism*, which D2a changes. More importantly every test mocks
   `getAllAndOverride` to return one value for **all** keys, so the file structurally
   cannot express "public, and no roles" — the exact combination D2 introduces. Rebuild
   it against a **real `Reflector`** over small decorated fixture classes.
   *Acceptance*: covers public / any-role / roles-match / roles-mismatch /
   no-decorator-denies / both-decorators-denies / no-user-denies / handler-overrides-class.
4. **`apps/api/src/auth/auth.module.ts`** — header comment names the new default.

### Phase 2 — decorate

5. Add `@AnyRole()` to each of the 76 handlers in § 2.2, method-level, immediately
   above the verb decorator (matching where `@Roles()` sits on its neighbours), plus the
   import in each of the 27 controller files.
   *Acceptance*: the Phase-3 spec passes; no `@Roles()` is added, removed or changed.

### Phase 3 — the coverage spec

6. **Delete** `apps/api/src/auth/write-guard-coverage.spec.ts`.
7. **`apps/api/src/auth/route-authorization-coverage.spec.ts`** *(new)* — D4 + D4a +
   the D2b and D3 bans. Failure messages name `Controller.handler` and the verb.
   *Acceptance*: verified **red first** — removing one `@AnyRole()` fails it, and the
   failure names that handler.
8. **`apps/api/src/auth/user-role-values.spec.ts`** *(new)* — D5. Its failure message
   must name **#2413** and say what to do, so the hand-off is an instruction rather than
   a surprise.

### Phase 4 — docs

9. **`docs/engineering-standards.md`** — new `### Route authorization` section placed
   immediately above `### MCP-protocol routes`, stating: exactly one of the three
   decorators per route; the guard denies otherwise; `@AnyRole()` is method-level only
   and why; and the rule the issue asks for — *a non-user principal never appears on
   `req.user`; it gets `@Public()` and its own verifier*, with MCP as the worked example
   and a pointer to the existing MCP section.
10. **Correct the ten prose assertions of the fail-open rule** (gate finding W4). It is
    stated as fact in `roles.decorator.ts:5`, the `roles.guard.ts` header,
    `auth.module.ts:7`, and in the controller headers of `description-format` (L33),
    `users` (L5), `returns` (L18), `refunds` (L11), `numbering-series` (L14),
    `invoicing` (L25) and `fiscalization` (L18). Every one becomes false. Leaving them
    is the failure this issue is about, one layer up: a codebase documenting the
    opposite of what it does.
11. **`docs/specs/product-spec-oms-wave3b-scan-pick-pack.md` § 1.6 is deliberately left
    unchanged.** It names `write-guard-coverage.spec.ts` and quotes the ~121 figure, both
    of which this change invalidates — but it is a **document of record** describing the
    state at authoring time, and rewriting history in a merged spec is worse than a stale
    filename. This note is what stops a reader hunting for a deleted file.

### Phase 5 — gate

11. `pnpm lint`, `pnpm type-check`, `pnpm test` under Node 22.
12. **Pin the D2 short-circuit with a test that fails if it is removed**, not only with
    a correct implementation. `route-authorization-coverage.spec.ts` gains a case
    asserting the guard allows a `@Public()` handler **with no `req.user`**, and the
    four production shapes are named in the spec so the regression is legible: login
    (`POST /auth/login`), refresh (`POST /auth/refresh`), a webhook
    (`POST /webhooks/:provider/:connectionId`) and the MCP transport (`ALL /mcp`). Each
    is asserted to resolve `@Public()` through the real `Reflector` against its real
    controller prototype, so deleting the short-circuit turns four named tests red
    rather than surfacing as a production outage.
13. `pnpm test:integration` over `viewer-role-authz`, `operator-role-authz` and
    `oms-write-authorization` (gate finding W3). These assert **`not 403`** for
    viewer/operator on routes that are undecorated today, so they stay green only
    because every such route gains `@AnyRole()` — the strongest available evidence that
    no existing route changed behaviour. Use a tight `--runTestsByPath`; a broad pattern
    pulls in the PrestaShop container suites and exhausts Docker.

---

## 6. Alternatives considered

**An allowlist of undecorated routes, asserted by a spec** — the issue's original
option (1), explicitly superseded by the issue itself. At 76 entries it is a check that
cannot fail: green whether or not anybody thought about a single entry, and an
allowlisted route still admits a `packer`. Rejected.

**Fix only the verb half of the existing spec** — leaves the hand-listed 23-controller
set, which is how the current spec came to exclude every PII read. `AuthController` is
not in that list, so `PATCH /auth/me/analytics-consent` would still be invisible.
Rejected.

**`@Roles('admin','operator','viewer')` everywhere instead of `@AnyRole()`** — same set
today, but it hardcodes the role list at 76 sites and leaves `@AnyRole()` unused.
Rejected; D5's tripwire buys the same "review on role change" benefit for one assertion.

**Boot the Nest module graph and read the router** — the most authoritative discovery,
but it needs Postgres and Redis, making this an integration test. A filesystem walk
gives the same coverage as a unit test with no Docker, and D4a's vacuity guards close
the gap that a walk can silently miss files.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| **Deny-by-default 403s the 15 `@Public()` routes**, breaking login and webhook ingest | D2's explicit `IS_PUBLIC_KEY` short-circuit, its own guard spec case, and integration tests that drive `POST /auth/login` |
| A route is missed and starts 403-ing in production | The spec fails the build before merge; it discovers rather than lists, so nothing is outside it by construction |
| A route outside `apps/api/src/**/*.controller.ts` | Every controller in the repo matches that pattern (57/57 verified). `apps/worker` has no HTTP surface |
| `require`-ing all 57 controllers is slow or fragile | Verified: all 57 import cleanly in ~3 s. Requires built `libs/*/dist` — the standing repo rule after pulling `main` |
| Guard precedence surprises on class+method combinations | D2a resolves by specificity; D2b denies contradictions and the spec fails them |

**Backward compatibility**: no route changes its effective audience. No schema, no
migration, no API contract change.

---

## 8. Acceptance criteria

- [ ] An audit lists every non-`@Public()` route without `@Roles()` and records its
      intended audience (§ 2), with disagreements raised rather than resolved
      unilaterally (§ 2.3)
- [ ] `@AnyRole()` exists, means *deliberately open to all authenticated users*, and is
      read by the guard
- [ ] Every route carries exactly one of `@Public()` / `@Roles()` / `@AnyRole()`
- [ ] `RolesGuard` **denies** when neither `@Roles()` nor `@AnyRole()` is present
- [ ] `@Public()` routes are unaffected
- [ ] A spec covering **all verbs** over **discovered** controllers fails the build when
      a route carries neither decorator, and is itself proved non-vacuous
- [ ] The `@Public()` + own-verifier rule is documented in `docs/engineering-standards.md`
- [ ] No behaviour change for existing routes and principals
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` green under Node 22

---

## 9. Alignment checklist

- [x] Hexagonal architecture — Interface layer only; no CORE change
- [x] CORE vs Integration boundaries respected
- [x] Uses existing patterns — `SetMetadata` decorator + `Reflector`, mirroring
      `@Public()` / `@Roles()`
- [x] Idempotency / events / rate limits — not applicable
- [x] Error handling — `ForbiddenException` plus a `warn` log naming the handler
- [x] Testing strategy complete, including red-first verification and vacuity guards
- [x] Naming conventions — `*.decorator.ts`, `*.guard.ts`, `*.spec.ts`
- [x] Execution-ready
