# Implementation Plan: describeApiError, field errors and shared error copy (#3862)

## 1. Task understanding

**Goal.** The API answers every error with a stable `code` and its `params` (#3860, #3861, #3863-#3865) and never
with translated text (ADR-081). The frontend needs one resolver that turns that into a sentence in the operator's
language, one helper that puts per-field validation errors onto a form, and the shared copy for every code.

**Layer.** Frontend, `shared` (`shared/api`, `shared/i18n`, `locales`), plus one `check:invariants` script.

**Base.** `3863-error-codes-filters-existing` (PR #3999): the mirror compares with the full backend code list.

**Non-goals.** Moving the ~350 `error.message` renders onto the resolver (#3867); the frontend half of #3863
(follows this, on its own branch).

## 2. Design

- `ApiError` reads `code`, scalar `params`, `fields` and `providerMessage` from the body once, in its constructor.
  Malformed parts are dropped rather than trusted.
- `describeApiError(error, featureNamespace?, { dev? })`:
  1. the feature namespace's `apiErrors.<code>`;
  2. `errors.codes.<code>`;
  3. `errors.status.<family>` (`400` ... `429`, `5xx`, `network`, `timeout`, `other`).
  - A template with a placeholder the error does not fill is skipped, never shown with `{name}`.
  - `PROVIDER_REJECTED` renders `errors.providerRejected` with the provider's words verbatim.
  - In development (not in tests) an untranslated error reads `[untranslated:<code>] <raw message>`.
- `applyFieldErrors(error, setError, pathMap?)` sets one message per form field, the copy for the constraint
  code (`errors.fields.<code>`) with its params, falling back to `errors.fields.invalid`. The body path is
  React Hook Form's own dotted path, so a matching form needs no map; it returns the fields it could not place.
- `errors` namespace in `en.json` and `pl.json`: `codes` (every registered code), `fields`, `status`,
  `providerRejected`. It goes into the single-file layout `main` has today; when #3920 (one file per namespace)
  lands, it moves to `en/errors.json` and `pl/errors.json`.
- `shared/api/api-error-codes.ts` mirrors `ApiErrorCodeValues`. `scripts/check-api-error-code-mirror.mjs` fails
  on order or value drift, on a code with no English copy, and on copy for an unregistered code. Polish gaps are
  `check-locales`'s.

## 3. Tests

- Resolver: feature copy, shared copy, params, unfilled placeholder, unknown code, no code, status families,
  network and timeout, provider words, never blank, development marker.
- `applyFieldErrors`: nested path, object and function maps, unmapped fields, one message per field.
- `ApiError`: envelope parsing and tolerance of a non-envelope body.
- Mirror script `--self-check`.
