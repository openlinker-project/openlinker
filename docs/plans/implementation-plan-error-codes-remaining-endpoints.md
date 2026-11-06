# Implementation Plan: error codes for the remaining endpoints (#3865)

## 1. Task understanding

**Goal.** The ~300 remaining `apps/api/src` sites that throw a Nest exception whose body is only an English
sentence send a stable `code` and the `params` the frontend's copy needs (ADR-081), exactly as #3864 did for
connections and invoicing. Messages stay unchanged.

**Base.** `3864-error-codes-connections-invoicing`, for `codedHttpError` and the `extras` argument. The PR is
retargeted to `main` once #3921, #3922 and #3864's PR merge.

**Non-goals.** The global filters and the endpoints that already send a code (#3863); the frontend resolver
and copy (#3862).

## 2. Approach

- Every sentence-only site becomes `codedHttpError(status, CODE, sameMessage, params?, extras?)`, which keeps
  the Nest class for the status, so callers and the class-based spec assertions are unchanged.
- Codes are SCREAMING_SNAKE, one meaning each, `<RESOURCE>_NOT_FOUND` for lookups, area-prefixed elsewhere;
  existing codes reused where they fit (`VALIDATION_FAILED`, `ORDER_NOT_FOUND`, `PROVIDER_REJECTED` ...).
- Params carry ids, counts, statuses and limits, never sentences, buyer data or raw external text. Domain
  exception messages pass through with a code per exception class.
- Existing object bodies without a code keep every field as extras.
- Areas with a repeated shape get a small `<area>-errors.ts` helper, as `invoicing-errors.ts` does.
- New codes are registered in `ApiErrorCodeValues`, grouped by area with one doc line each.

## 3. Areas

orders (46), listings (31), bench (20), analytics (20), auth (18), users (15), sales-documents (15), oms (15),
integrations (15), shipping (13), webhooks (12), products (12), mappings, content, automation, ai (10 each),
fiscalization (9), sync (7), fulfillment (5), currency (4), and the long tail (inventory, returns,
operational-settings, mcp, customers, cursors, catalog-trust).

## 4. Tests

- Spec assertions on exact bodies updated; one spec per area pins a representative code and its params.
- `apps/api/src/common/errors/__tests__/coded-error-coverage.spec.ts` widens from the three #3864 files to all
  of `apps/api/src`: no sentence-only HTTP error may return.

## 5. Risks

- A code is permanent once released; the merged list in `api-error-code.types.ts` is the review point.
- Auth errors keep exactly the vagueness they have: the code says no more than the message.
