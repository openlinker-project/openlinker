# Implementation Plan: validation errors per field with codes and params (#3861)

## 1. Task understanding

**Goal.** A request that fails DTO validation answers 400 with `code: 'VALIDATION_FAILED'` and
`fields[]`, one entry per failed constraint: dotted `path`, `code` = the class-validator constraint
key (`isNotEmpty`, `min` ...) and `params` taken from the constraint's metadata (`{ min: 1 }`). The
frontend (#3862, `applyFieldErrors`) maps them onto form fields and translates them. The connection
config shape errors (`ConnectionService`) get the same `fields`.

**Layer.** Interface (`apps/api` pipe + connection service mapping); one additive field on a CORE
type (`FlatValidationIssue.code`). Builds on #3860 (branch `3860-api-error-envelope`).

**Non-goals.** Frontend mapping (#3862); translating messages; webhook decoder `validateSync` (not
an HTTP DTO 400); manual `BadRequestException` sites in services (#3864/#3865).

## 2. Findings

- `main.ts` builds `new ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; the
  integration harness (`libs/test-kit`) builds its **own** pipe from default options, so tests do
  not run the shipped pipe - the same drift the global-filter roster fixed (#2675).
- Nest's `ValidationPipe` builds the 400 in a protected `createExceptionFactory()` and flattens
  messages with a protected `flattenValidationErrors()` (`"items.0.quantity must be ..."`). Today's
  body: `{ statusCode: 400, message: string[], error: 'Bad Request' }`.
- `getMetadataStorage().getTargetValidationMetadatas(...)` exposes each constraint's arguments.
- Config shape errors: `InvalidConnectionConfigException.errors: FlatValidationIssue[]` = `{ path, message }`,
  made by core `flattenValidationErrors` (also used by plugins) or built by hand (eparagony).
  Answered as `{ message, errors }`. Credentials shape errors carry one sentence, no path.

## 3. Design

- `libs/shared/src/errors/api-error-code.types.ts`: add `'VALIDATION_FAILED'`.
- `apps/api/src/common/validation/validation-field-errors.ts` (pure): `toValidationFieldErrors(errors: ValidationError[]): ApiErrorField[]`
  - depth-first, path joined with `.` (array items are their index: `items.0.quantity`);
  - one field per constraint, `code` = constraint key;
  - `params` from the constraint's metadata: known constraints get named params
    (`min`, `max`, `minLength`/`maxLength` -> `min`/`max`, `isLength`, `arrayMinSize`/`arrayMaxSize`,
    `isIn`/`isEnum` -> `values` joined with `, `); any other primitive arguments -> `arg0`, `arg1`;
    object/function arguments are skipped (never sentences);
  - `whitelistValidation` (unknown property) is reported like any other constraint.
- `apps/api/src/common/validation/coded-validation.pipe.ts`: `CodedValidationPipe extends ValidationPipe`,
  overrides `createExceptionFactory()` -> `BadRequestException({ statusCode: 400, message: <Nest's flattened messages>, error: 'Bad Request', code: 'VALIDATION_FAILED', fields })`.
  Existing `message` / `error` unchanged.
  `createValidationPipe()` returns it with the three options - the ONE producer used by `main.ts`
  and the harness (`validationPipe: false` + `useGlobalPipes(createValidationPipe())` in `configureApp`).
- Core: `FlatValidationIssue.code?: string` (optional, additive); `flattenValidationErrors` sets it
  to the constraint key. Plugins building issues by hand keep working.
- `ConnectionService.validateConfigShape`: body `{ message, errors, code: 'VALIDATION_FAILED', fields }`
  with `fields = errors.map(({ path, code }) => ({ path, code: code ?? 'invalid' }))`.
  `validateCredentialsShape`: same body as today plus `code: 'VALIDATION_FAILED'` (one sentence, no path).

## 4. Steps

1. Shared: `VALIDATION_FAILED` in `ApiErrorCodeValues`.
2. `validation-field-errors.ts` + spec: nested object, array of objects, multiple constraints,
   custom validator, `whitelistValidation`, params for min / maxLength / isIn / custom arg.
3. `coded-validation.pipe.ts` + spec: real DTO classes through `transform()` -> `BadRequestException`
   whose response keeps `message` / `error` and adds `code`, `fields`.
4. `main.ts` uses `createValidationPipe()`; `test/integration/setup.ts` passes `validationPipe: false`
   and registers it in `configureApp`.
5. Core `FlatValidationIssue.code`, `flattenValidationErrors` sets it; update its spec.
6. `ConnectionService` mapping + unit spec for both bodies.
7. Integration spec: a real DTO 400 (nested + array path) and a config shape 400 through the harness.
8. Quality gate (tsc shared/core/api, ESLint changed files, `check:invariants`); tests on CI.

## 5. Validation

- **Contract:** additive - `message` (array), `error`, `errors`, statuses unchanged.
- **Architecture:** pipe in the API interface layer; the only CORE change is an optional field set by
  core's own helper; no new dependency direction.
- **Risk:** a param could leak a sentence - only primitive constraint arguments are copied.
  Harness switch changes the pipe every int-spec runs through (to the shipped one) - desired.
