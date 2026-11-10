# Implementation Plan: API error envelope with stable codes (#3860)

## 1. Task understanding

**Goal.** Every error response from `apps/api` carries a stable machine `code` next to the
existing English `message`, so the frontend (#3862) can pick copy by code instead of showing a
server sentence. First step of the backend error-code track (#3860 -> #3861 / #3862 -> #3863-#3867).

**Layer.** Interface (`apps/api` exception filters) + Shared (framework-free types in
`libs/shared/src/errors`). No CORE change, no migration.

**Non-goals** (later issues in the track).
- Explicit codes for the domain filters and the ~14 already-coded sites - #3863.
- Validation errors per field (`fields`, `VALIDATION_FAILED`) - #3861.
- Converting the ~330 `HttpException` sites - #3864, #3865.
- Frontend resolver and mirror script - #3862.

## 2. Findings (origin/main @ 9e35aec9d)

- 9 global filters (not 7) in `apps/api/src/common/filters/global-filters.ts`, shared by `main.ts`
  and the integration harness (`test/integration/setup.ts`). No `@UseFilters` / `APP_FILTER`.
- Nest reverses the filter list and takes the **first match**
  (`router-exception-filters.js`: `setCustomFilters(filters.reverse())`), so a `@Catch()` catch-all
  must be registered **first** to stay behind every domain filter.
- Every domain filter writes its own body (`response.status(s).json({ statusCode, error: exception.name, message, ...extras })`),
  so a catch-all never sees them: each needs the same "add a code" step.
- Existing codes on the wire: `code: 'version_conflict'` etc. (lower-case, fulfillment), `code: 'OAUTH_STATE_INVALID'`,
  `error: 'ORDER_ALREADY_ON_HOLD'` (orders), domain filters `error: '<ExceptionClassName>'`,
  Nest defaults `error: 'Not Found'`. None may change.
- `libs/shared/src/errors` is framework-free and importable by plugins; `@nestjs/common` is kept out of
  plugin-facing barrels (the `logging` / `logging/nest` split, #589).

## 3. Design

### Shared, framework-free (`libs/shared/src/errors/`)

- `api-error-code.types.ts`
  - `ApiErrorCodeValues = ['INTERNAL_ERROR'] as const` - codes this layer itself mints; #3861/#3863 extend it.
  - `HttpStatusErrorCode = \`HTTP_${number}\`` - the fallback family.
  - `ApiErrorCode = KnownApiErrorCode | HttpStatusErrorCode`.
- `api-error-envelope.types.ts`
  - `ApiErrorEnvelope { statusCode; code: string; params?; message: string | string[]; fields?; error? }`.
    `code` is typed `string` on purpose: legacy codes already sent by endpoints pass through until #3863
    registers them; documented.
  - `ApiErrorParams = Record<string, string | number | boolean>` (inputs, never sentences).
  - `ApiErrorField { path; code; params? }` (filled by #3861).
  - `resolveApiErrorCode(body, status): string` - pure rule: existing `code` string wins; else a legacy
    `error` matching `^[A-Z][A-Z0-9_]+$` (e.g. `ORDER_ALREADY_ON_HOLD`); else `HTTP_<status>`.
    Exception-class names and Nest titles (`Not Found`) never become codes.
  - `withApiErrorCode(body, status)` - returns the body with `code` set by that rule; never removes or renames a field.
- Exported from `@openlinker/shared/errors`.

### API (`apps/api/src/common/`)

- `errors/coded-http.exception.ts` - `CodedHttpException extends HttpException`
  `(status, code: ApiErrorCode, message, params?)`, body `{ statusCode, code, message, params? }`.
  **In `apps/api`, not `libs/shared`** (deviation from the issue text): it extends Nest's `HttpException`,
  and `libs/shared/errors` is plugin-facing and framework-free; only the API throws HTTP exceptions.
- `filters/api-error-code.filter.ts` - `@Catch()` catch-all:
  - `HttpException`: body from `getResponse()` (string -> `{ statusCode, message }`), plus `withApiErrorCode`.
  - anything else: logs with stack (shared `Logger`), answers 500 `{ statusCode: 500, message: 'Internal server error', code: 'INTERNAL_ERROR' }`
    - the same body Nest's default handler sends, plus the code.
  - skips when `headersSent`.
- `filters/global-filters.ts` - catch-all added **first**, with a comment on Nest's reverse-then-first-match rule.
- Each of the 9 domain filters wraps its body in `withApiErrorCode(...)` (no other change; codes become
  `HTTP_<status>` until #3863 gives them explicit ones).

## 4. Steps

1. `libs/shared/src/errors/api-error-code.types.ts`, `api-error-envelope.types.ts`, export from `index.ts`;
   spec `api-error-envelope.spec.ts` for `resolveApiErrorCode` / `withApiErrorCode`
   (existing code kept, upper-snake `error` used, class name / Nest title ignored, `HTTP_<status>` fallback, body not mutated).
2. `apps/api/src/common/errors/coded-http.exception.ts` + spec (status, body shape, params optional).
3. `apps/api/src/common/filters/api-error-code.filter.ts` + spec: string body, object body, existing code,
   legacy `error` code, `CodedHttpException`, unknown error -> 500 `INTERNAL_ERROR`, headers already sent.
4. `global-filters.ts`: register catch-all first; spec asserting it is first and the list still has every domain filter.
5. 9 domain filters: `withApiErrorCode`; update their 6 existing specs to expect `code: 'HTTP_<status>'`.
6. Integration spec `api-error-code.int-spec.ts` through the real harness: an unknown route (404 `HTTP_404`),
   a domain-filter error (e.g. unknown connection -> `HTTP_404` with `error: 'ConnectionNotFoundException'`),
   and an `error: 'ORDER_ALREADY_ON_HOLD'` path if cheap to set up - all keep their existing fields.
7. Quality gate: `pnpm lint`, `pnpm type-check`, `pnpm check:invariants`; tests on CI.

## 5. Validation

- **Contract:** additive only - every existing field and status unchanged; a `code` appears where it was missing.
- **Architecture:** shared types framework-free; Nest-specific class stays in the API; no CORE touch.
- **Risk:** registration order (a catch-all registered last would swallow domain errors) - pinned by a spec.
  Logging unknown errors: the catch-all replaces Nest's default logger call, so it must log with the stack.
- **Security:** an unknown error's message is never sent to the client (generic 500 body, as today).

## 6. Open questions

1. `CodedHttpException` in `apps/api/src/common/errors` rather than `libs/shared/src/errors` (issue text) - OK?
2. Unknown errors as `INTERNAL_ERROR` (named) vs `HTTP_500` (family). Plan: `INTERNAL_ERROR`.
