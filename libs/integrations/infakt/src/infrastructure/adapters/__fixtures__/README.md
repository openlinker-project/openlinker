# inFakt response captures

Real inFakt v3 responses, committed so a spec can assert against the wire shape instead of against
whatever shape the spec author believed in. Precedent:
`libs/integrations/allegro/src/infrastructure/adapters/__fixtures__/category-parameters-257933.json`.

Why these exist: #1373/#1374 retargeted both list readers at `{ items, pagination }` - a shape inFakt
never emits - on the strength of a PR-body "verified live" claim with no captured payload behind it, and
the hand-written spec fixtures were rewritten to match the claim. 180 unit tests stayed green while
`listBankAccounts` 502'd in production and NIP-based client de-duplication was dead. See #1926.

| File | Endpoint | Captured | Environment |
|---|---|---|---|
| `clients-list-response.json` | `GET /api/v3/clients.json?limit=2` | 2026-07-29 | `api.sandbox-infakt.pl` |
| `bank-accounts-list-response.json` | `GET /api/v3/bank_accounts.json` | 2026-07-29 | `api.sandbox-infakt.pl` |

**Sanitisation.** Every key, key order, type, and null/empty-string convention is verbatim from the
capture - that is what the specs assert. Identifying *values* (company names, street names, bank names,
custom account names, e-mail) were replaced with obviously-synthetic ones. Ids, uuids, account numbers,
SWIFT codes, the NIP, and the `metainfo` page URLs are sandbox test data and are kept as captured.

**Notes on the envelope.** `metainfo.count` reports inFakt's default page size (10), not the number of
rows actually returned - the `clients` capture asked for `limit=2` and still reports `count: 10`.
`next`/`previous` are emitted regardless of whether such a page holds rows (the `bank_accounts` capture
returns all 2 of 2 accounts and still carries both links), so neither is a usable has-more signal.

**Refreshing a capture**: re-run the `GET`, re-apply the sanitisation above, and update the captured
date in this table in the same commit.
