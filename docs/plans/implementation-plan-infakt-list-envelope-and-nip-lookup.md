# Implementation Plan - inFakt list envelope + NIP client lookup (#1926)

## 1. Goal

Make `InfaktInvoicingAdapter`'s two list reads work against the real inFakt v3 API, and make its
NIP-keyed client lookup an identity resolution rather than a "first row of an unfiltered page" guess.

**Layer**: Integration - Infrastructure (adapter) + Domain (types) in `libs/integrations/infakt`.

**Non-goals** (explicitly out of scope, listed on the issue):
- Any frontend change. The FE consumes the neutral `InvoicingBankAccount` DTO over HTTP.
- Any core / `libs/core/src/invoicing` change, DB migration, or backfill.
- The sibling defects the audit surfaced (PrestaShop `filter[filter[…]]`, InPost `items?`), a shared
  outbound response-shape validation helper, a `docs/lessons.md` entry, and provider-side cleanup of
  the duplicate inFakt clients already accumulated.

## 2. Findings that drive the design

Live-verified 2026-07-29 against `https://api.sandbox-infakt.pl/api/v3`:

| Probe | Result |
|---|---|
| `clients`, `invoices`, `bank_accounts`, `products`, `corrective_invoices`, `vat_rates` | every one returns exactly `{ metainfo, entities }` |
| `limit`/`offset`, `page`/`per_page`, `Accept: …vnd.infakt.v3+json` / `v4+json`, `X-API-Version: 4`, `fields=` | envelope unchanged; `/api/v1/` and `/api/v2/` 404 |
| vendor Postman collection behind `docs.infakt.pl` (203 requests) | `entities` ×159, `metainfo` ×112, `items` ×0, `pagination` ×0 |
| `clients.json?nip=<nip>` | 200, **unfiltered** page (param ignored) |
| `clients.json?q[nip_eq]=<nip>` | 200, exactly the matching client |
| `clients.json?q[clean_client_nip_eq]=<nip>` | 200, **unfiltered** page - an unknown filter key fails identically to a bare param |
| `q[nip_eq]=PL1234563218` / `123-456-32-18` | 0 results - exact string match, so the NIP must be normalised |
| two `POST /clients.json` with the same NIP | `201` both times - inFakt does **not** dedupe server-side |

Two consequences shape the plan: the envelope must be `entities`, and because inFakt answers 200 with a
full page for *any* unrecognised filter key, a client-side re-match is the only durable guard - the
filter alone can silently stop working at any time.

## 3. Design

1. **`InfaktListResponse<T>`** becomes the real envelope: `{ entities: T[]; metainfo: { count, total_count, next, previous } }`.
   The previous `pagination` sub-shape is deleted outright, not renamed - none of its five field names
   exists in the API.
2. **`getListResponse`** keeps the loud named `InfaktApiError` guard introduced by #1374 and only
   retargets it at `entities`. The guard is *not* widened to accept both shapes: no inFakt version,
   header, or content-negotiation path emits `{ items, pagination }`, so tolerating it would enshrine a
   fabricated shape and hide real future drift.
3. **`findClientByNip`** sends `q[nip_eq]=<digits-only NIP>` plus an explicit `limit`, then re-matches
   every returned client's NIP client-side and only adopts an exact match. Deviation from the issue's
   original AC: when several clients genuinely carry the requested NIP, the adapter adopts the
   **lowest-id (oldest)** match and logs a warning, rather than treating a multi-match as no-match.
   Rationale: an exact-NIP match cannot be a *different* legal entity, and real seller accounts already
   hold duplicates created by this very bug - "no match" would keep minting new ones forever for exactly
   the buyers worst affected. Picking the oldest is deterministic and stops the growth; the warning
   surfaces the duplicates to the operator.
4. **The `try/catch` in `findClientByNip` is removed**, not narrowed to 404. inFakt answers 200 for "no
   match", so the negative result already falls out of the re-match finding nothing; a transport/5xx
   failure must surface as a retryable failed issuance rather than be silently reported as "not found"
   and turned into another duplicate client.
5. **Fixtures.** Real captured list responses land under
   `libs/integrations/infakt/src/infrastructure/adapters/__fixtures__/`, following the
   `libs/integrations/allegro/.../__fixtures__/category-parameters-257933.json` precedent (raw JSON +
   provenance in prose). A sibling `README.md` records endpoint, capture date, environment, and the
   fact that identifying values were replaced with obviously-synthetic ones while every key was kept
   verbatim - the key set is what the specs assert against.

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `src/domain/types/infakt.types.ts` | replace `InfaktListResponse<T>` with the `entities`/`metainfo` shape | `type-check` passes; no `pagination` reference remains in the package |
| 2 | `src/infrastructure/adapters/infakt-invoicing.adapter.ts` | `listBankAccounts` reads `entities`; `getListResponse` guards `entities`; `findClientByNip` gains `q[nip_eq]` + `limit` + client-side re-match + no `catch`; new module-scope `normalizeNip` | `listBankAccounts` maps the fixture; guard throws on an unrecognised envelope |
| 3 | `src/infrastructure/adapters/__fixtures__/{clients,bank-accounts}-list-response.json` + `README.md` | committed captures with provenance | files exist, are valid JSON, and carry `metainfo` + `entities` |
| 4 | `__tests__/infakt-invoicing.adapter.spec.ts` | re-seed the 9 list fixtures from the captures; repair the inverted #1373/#1374 guard test; add an outgoing-query assertion and a mismatched-NIP spec | package suite green |
| 5 | `__tests__/infakt-connection-tester.adapter.spec.ts` | update the cosmetic `'{"items":[]}'` body | package suite green |
| 6 | `scripts/poc-sandbox-test.ts` | run the step-1 `upsertCustomer` twice with the same NIP and assert one `providerCustomerId` | the live smoke can now fail on this defect class |

## 5. Validation

- Architecture: no port, DI token, DTO, ORM entity, or barrel export changes. `InfaktListResponse` and
  `getListResponse` are package-private (absent from `src/index.ts`), so the contract surface is
  untouched and no `check:invariants` rule is in scope.
- Security: fixtures carry synthetic identifiers only; no API key, credential, or real buyer PII.
- Testing: unit only. No integration test is added - the package has no Testcontainers surface, and the
  durable guard against this bug class is the committed real-response fixture plus the outgoing-query
  assertion (a spec that mocks the client can never validate a *wire* shape on its own).
- `/pre-implement` gate skipped deliberately: the change is confined to one package, introduces no new
  port / service / token / entity / helper module, and touches nothing another plan could collide with.
