# Implementation Plan — admin+env-gated test seam to stamp `taxRateEra='pre-rollout'` (#2855)

## 1. Task

`order_records.taxRateEra = 'pre-rollout'` is written exactly once, ever, by a historical
migration — no ingestion path can ever produce it for a fresh order, making the `tax-a` /
`tax-c` analytics coverage states structurally unreachable by any flow-driven E2E seed. Add a
narrow, double-gated (role `admin` + env `OL_ALLOW_TEST_FIXTURES`) write seam to stamp it on
demand. CORE (orders context) + Interface layer. Non-goal: wiring #2482's E2E spec to call it —
out of scope for this issue's own acceptance criteria items 1-3; item 4 (E2E wiring) is deferred
to whichever E2E work item actually touches that spec.

## 2. Research

- `OrderRecordRepository.clearFxStampForRestatement` (`order-record.repository.ts:957`) is the
  exact shape to mirror: a single conditional `UPDATE ... WHERE` via query builder, `affected > 0`
  as the `boolean` answer, idempotent (re-running when already in the target state is a no-op
  reporting `false`).
- `OrdersController.placeHold` / `.releaseHold` (`orders.controller.ts:772` / `:836`) is the HTTP
  shape: `@Roles('admin')`, `@CurrentUser()` never trusted from the body, a pre-read for 404,
  domain exceptions mapped to specific HTTP status via `catch`.
- `ReportingCurrencySettingsService` (`libs/core/src/currency/application/services/reporting-currency-settings.service.ts`)
  shows the established convention for reading an `OL_*` boolean env var inside `libs/core` via
  `ConfigService.get<string>(name, 'false').trim().toLowerCase() === 'true'` (`@nestjs/config`
  already used inside `libs/core`, e.g. `currency`, `operational-settings`).
- No dedicated interface file exists for `OrderHoldService` at the same level as `OrderRecordService`
  — interfaces for small services live in `libs/core/src/orders/application/interfaces/*.service.interface.ts`
  (e.g. `order-hold.service.interface.ts`). No existing service is a clean fit for this seam (per
  the issue's own note) — a small dedicated `OrderTestFixtureService` is added.
- `orders.tokens.ts` / `orders.module.ts` show the DI-token + module-wiring convention (Symbol
  token per service, `useExisting` binding, service class + token both exported).
- No existing precedent for `OL_ALLOW_TEST_FIXTURES` anywhere in the repo — this issue introduces
  it, matching the issue's own assumption.

## 3. Design

- **Domain exception**: `TestFixturesDisabledException` in
  `libs/core/src/orders/domain/exceptions/test-fixtures-disabled.exception.ts` — thrown when the
  env gate is off. A distinct, named exception (not a generic `Error`) so the controller can map
  it deterministically, matching `OrderAlreadyOnHoldError` / `OrderHoldContendedError`'s pattern.
- **Repository** (`order-record.repository.ts` + `order-record-repository.port.ts`):
  `stampPreRolloutEraForTesting(internalOrderId: string): Promise<boolean>` —
  `UPDATE order_records SET "taxRateEra" = 'pre-rollout' WHERE "internalOrderId" = :id AND
  "taxRateEra" IS DISTINCT FROM 'pre-rollout'`, `affected > 0` as the answer. No role/env
  awareness at this layer — the repository is a dumb, narrow conditional writer, same as its
  precedent; the gates live in the service.
- **Service**: `OrderTestFixtureService implements IOrderTestFixtureService` —
  `markPreRolloutEraForTesting(internalOrderId: string): Promise<boolean>`. Reads
  `OL_ALLOW_TEST_FIXTURES` via `ConfigService`; throws `TestFixturesDisabledException` when not
  `'true'`. Calls the repository method; logs at `warn` on a successful (non-throwing) call,
  regardless of whether the write was actually applied (an idempotent no-repeat call is still a
  fixture action worth an audit trail).
- **Controller**: `POST /orders/:internalOrderId/test-fixtures/mark-pre-rollout-era`,
  `@Roles('admin')`. Pre-reads the order via the repository (already injected in
  `OrdersController`) for a 404 when it doesn't exist — same ordering rationale as `placeHold`
  (refuse before any side effect). Catches `TestFixturesDisabledException` → maps to 403
  Forbidden with a machine-readable body (`{ statusCode: 403, error: 'TEST_FIXTURES_DISABLED',
  message }`), matching the `ConflictException({ statusCode, error, message })` shape
  `placeHold`/`releaseHold` already use for their own domain exceptions. Returns
  `{ applied: boolean }` — `true` if the row was changed by this call, `false` if it already
  carried `'pre-rollout'` (idempotent, matches the repository's own semantics).
- **`.env.example`**: document `OL_ALLOW_TEST_FIXTURES` under a new commented block, default
  off, explicitly dev/test-only.

## 4. Steps

1. `libs/core/src/orders/domain/exceptions/test-fixtures-disabled.exception.ts` (new) —
   `TestFixturesDisabledException extends Error`.
2. `libs/core/src/orders/domain/ports/order-record-repository.port.ts` — add
   `stampPreRolloutEraForTesting(internalOrderId: string): Promise<boolean>;` to the port,
   documented with the same rationale style as `clearFxStampForRestatement`.
3. `libs/core/src/orders/infrastructure/persistence/repositories/order-record.repository.ts` —
   implement the method per the design above.
4. `libs/core/src/orders/application/interfaces/order-test-fixture.service.interface.ts` (new) —
   `IOrderTestFixtureService { markPreRolloutEraForTesting(internalOrderId: string): Promise<boolean>; }`.
5. `libs/core/src/orders/application/services/order-test-fixture.service.ts` (new) —
   `OrderTestFixtureService implements IOrderTestFixtureService`, per design.
6. `libs/core/src/orders/orders.tokens.ts` — add `ORDER_TEST_FIXTURE_SERVICE_TOKEN = Symbol('IOrderTestFixtureService')`.
7. `libs/core/src/orders/orders.module.ts` — register `OrderTestFixtureService` as a provider,
   bind the token, export both (mirrors every other service in the file).
8. `libs/core/src/orders/index.ts` — export `IOrderTestFixtureService` type and
   `TestFixturesDisabledException` from the top-level barrel (cross-context-safe symbol shapes:
   `I*Service`, `*Exception`) so `apps/api` can import them; token comes via the tokens sub-barrel
   already re-exported.
9. `apps/api/src/orders/http/orders.controller.ts` — inject
   `@Inject(ORDER_TEST_FIXTURE_SERVICE_TOKEN) private readonly testFixtureService:
   IOrderTestFixtureService`, add the new endpoint per design (with `@ApiOperation` /
   `@ApiResponse` docs matching `placeHold`'s density, explicitly warning this must never be
   called against real order data).
10. `apps/api/.env.example` — document `OL_ALLOW_TEST_FIXTURES` (default off, dev/test-only,
    commented out).
11. Tests:
    - `order-record.repository.spec.ts` — unit test for `stampPreRolloutEraForTesting` (guarded
      UPDATE, idempotent no-op).
    - `order-test-fixture.service.spec.ts` (new) — throws when env gate off; calls repository and
      logs when on; returns the repository's boolean.
    - `orders.controller.spec.ts` — 404 for unknown order, 403 for `TestFixturesDisabledException`,
      200 with `{ applied }` on success.

## 5. Validate

- CORE ↔ Interface boundary respected: repository/service/exception in `libs/core`, controller
  wiring in `apps/api`, no CORE dependency on NestJS beyond the already-established `@nestjs/common`
  + `@nestjs/config` usage.
- Naming: `*.exception.ts`, `*.service.interface.ts`, `*.service.ts`, Symbol token
  `{CONTEXT}_{INTERFACE}_TOKEN` — all match `docs/engineering-standards.md`.
- Security: double-gated (role + env), narrow to one column/one value, never settable via request
  body, audit-logged at `warn`. `.env.example` keeps the gate default-off and documented as
  dev/test-only, so it can never silently ship enabled.
- No migration needed — `taxRateEra` column already exists.

## Result

Implemented as designed. Quality gate: `pnpm --filter @openlinker/core lint` (0 errors),
`pnpm --filter @openlinker/core type-check` (clean), `pnpm --filter @openlinker/api lint`
(0 errors), `pnpm --filter @openlinker/api type-check` (clean), `pnpm check:invariants`
(exit 0 — cross-context imports and service-interface conformance both explicitly confirmed
for the new files). Unit tests not run locally per project convention (weak laptop); the
pre-commit hook's `smart-test` run below is the verification.
