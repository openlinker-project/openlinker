# Implementation Plan: Amazon plugin foundation (#4177)

Part of epic #4176. Branch `4177-amazon-plugin-foundation`.

## 1. Task

Package `@openlinker/integrations-amazon` (`amazon.spapi.v1`): connection config, LWA credentials,
access-token provider, SP-API client, connection tester, retry and auth-failure classifiers, host
registration, README and setup guide. No capability: `supportedCapabilities` stays empty until #4178.

**Layer**: Integration (Infrastructure). No CORE change.

**Non-goals**: any capability adapter, the public-app OAuth flow (waits for AC7), a web setup form
(#4186).

## 2. Research

- The code already exists in commit `c2ebb1e36` on this branch (written before the issue was filed).
  This plan checks it against #4177 and lists the gaps.
- Patterns followed: Shopify foundation (#3974), `ShoperHttpClient` (no redirects, streamed size cap,
  rate-limiter errors unwrapped), Erli plugin (empty manifest + `createNestAdapterModule` +
  tester behind a factory interface), DPD module.
- Research-first check against Amazon's published OpenAPI model
  (`amzn/selling-partner-api-models`, `sellers-api-model/sellers.json`, v1):
  - `GET /sellers/v1/marketplaceParticipations` answers
    `{ payload: [{ marketplace: { id, name, countryCode, defaultCurrencyCode, defaultLanguageCode, domainName }, participation: { isParticipating, hasSuspendedListings }, storeName }], errors? }`.
    Matches `AmazonMarketplaceParticipationsResponse`.
  - Errors are `{ errors: [{ code, message, details? }] }`. Matches `AmazonSpApiErrorBody`.
  - **New finding, not in the spike**: the operation's usage plan is **0.016 req/s, burst 15**. A
    connection test repeated more than ~15 times within a few minutes answers 429.
- LWA (`POST https://api.amazon.com/auth/o2/token`, form-encoded, `grant_type=refresh_token`) answers
  `{ access_token, token_type, expires_in, refresh_token }` or `{ error, error_description }`; the spike
  exercised it live (Evidence #9 / #31).

## 3. Gaps found

| # | Gap | Fix |
|---|---|---|
| G1 | A throttled connection test reports Amazon's raw 429 message | Tester maps 429 to a plain sentence ("Amazon allows about one connection test a minute; try again shortly") |
| G2 | `docs/plans/implementation-plan-amazon-integration-epic.md` in the commit is superseded by epic #4176 (different numbering) and the README points to it | Delete the file; README links #4176 |
| G3 | Local `docs/plans/drafts/amazon-epic-issues.md` is superseded by #4176-#4187 | Delete |
| G4 | No foundation plan in `docs/plans` (Shopify has one) | This file |

Everything else in #4177's proposed solution and acceptance criteria is already covered:
config + region check, credentials with `source`, fingerprint-keyed token cache, client safety
properties, tester with sandbox skip, classifiers (403 never `needs_reauth`), host registration in all
places listed in the issue, README and setup guide.

## 4. Steps

1. `amazon-connection-tester.adapter.ts`: 429 branch + test.
2. Delete the superseded epic plan; update `README.md`.
3. Delete `docs/plans/drafts/`.
4. Quality gate on the package: lint, `tsc -b`, jest; api / worker type-check.

## 5. Validation

- Hexagonal: domain types and policies import nothing from Nest or Node; `node:crypto` only in the
  infrastructure token provider.
- No secret in logs, cache keys or messages (asserted by the token-provider and tester specs).
- AC "passes the connection test on a live seller account" cannot be verified locally: needs a
  Professional seller account and a private SP-API app.
