# Implementation Plan — #820 Validate same-seller identity on Allegro re-auth

**Issue:** #820 · **Builds on:** #819 / [ADR-008](../architecture/adrs/008-auth-failure-classifier-connection-reauth.md) · **Spawned:** #859 (relocate the whole Allegro OAuth surface into the plugin)
**Layer:** Integration (Allegro plugin — the `/me` seam) + Interface/Application (apps/api OAuth orchestration)
**Branch:** `820-allegro-same-seller-reauth`

> Design settled via `/grill-me` (Q1–Q5). The decisions and their rationale are inline below.

## 1. Problem

`AllegroOAuthService.reauthenticateExistingConnection` (#819 in-place re-auth) rotates a flagged connection's OAuth credentials while **preserving the connection id** (and all connection-scoped identifier mappings). It validates only `platformType === 'allegro'` — **not** that the new token authorizes the **same Allegro seller**. Re-authing with a different seller silently rebinds the connection while keeping mappings keyed to the old seller's external-id space → wrong-but-quiet lookups (404s). Admin-gated + operator creds → **foot-gun, not a security hole**, but it inverts the mapping-preservation benefit. Add a guard.

**Non-goals:** a confirm/override UX (hard reject — Q2); seller validation for non-Allegro platforms; relocating the rest of the Allegro OAuth surface (tracked as **#859**); any change to the #819 trigger or the token-refresh path (refresh reuses the same refresh-token → same seller → can't rebind, so no check there).

## 2. Research findings (verified)

- **Seller-id source — `GET /me` → `id` (string)**, with `Accept: application/vnd.allegro.public.v1+json`; `/me` also returns `login`. Verified against developer.allegro.pl ([account docs](https://developer.allegro.pl/tutorials/jak-zarzadzac-kontem-danymi-uzytkownika-ZM9YAKgPgi2), [GET /me news](https://developer.allegro.pl/news/get-me-dodalismy-informacje-o-super-sprzedawcy-nn9Y12wyesl)). No code reads it today (the connection-tester calls `/me` but ignores the body).
- **OAuth service** (`apps/api/.../allegro-oauth.service.ts`): `storeCredentialsAndCreateConnection(tokenResponse, stateData)` branches to `reauthenticateExistingConnection` when `stateData.connectionId` is set, else creates. It owns Allegro host knowledge locally (`getApiBaseUrl`, token URL, `fetchWithTimeout`) — the wart #859 will fix.
- **Persistence:** `Connection.config` is jsonb; the Allegro shape (`AllegroConnectionConfig`) is validated by `AllegroConnectionConfigDto` via `AllegroConnectionConfigShapeValidatorAdapter`, which runs `validate(..., { whitelist: false, forbidNonWhitelisted: false })` — **unknown fields pass**. So `ConnectionService.update({ config })` re-validating the merged blob is safe on live data → **no migration**; `sellerId` rides the jsonb.

## 3. Design (decisions locked)

**Plugin owns the `/me` contract; host orchestrates the check.** (Q4: architecture-correct seam, not inlined in the host wart.)

1. **Plugin package** — `AllegroAccountReader.fetchSellerIdentity(baseUrl, accessToken): Promise<AllegroAccountIdentity>` (`{ sellerId, login }`). Owns `GET {baseUrl}/me` (Accept header, Bearer, `AbortController` timeout) + parses `AllegroMeResponse { id, login }`; throws on non-200 or missing `id`. `@Injectable()`, exported from the package barrel.
2. **Host OAuth service** injects `AllegroAccountReader`. In `storeCredentialsAndCreateConnection`, after token-exchange, fetch the identity **once before branching** (Q1: a `/me` failure hard-fails the callback uniformly — recoverable, since the state isn't marked completed):
   - **Create path:** include `sellerId` in the `config` passed to `connectionService.create` (every new connection is seller-anchored from birth).
   - **Re-auth path:** pass the identity into `reauthenticateExistingConnection`.
3. **`reauthenticateExistingConnection`** (check **before** any credential rotation):
   - `stored = (existing.config as AllegroConnectionConfig).sellerId`
   - **mismatch** (`stored && stored !== fresh.sellerId`) → `BadRequestException({ message, code: 'ALLEGRO_SELLER_MISMATCH' })` (Q2). Message built from the connection's own `name` + the **incoming** `login` (in hand from `/me`) + both ids (Q3: persist `sellerId` only; derive the message, don't cache the mutable `login`). `warn`-log `{ connectionId, connectionName, storedSellerId, incomingSellerId, incomingLogin }` (Q5). No rotation.
   - **match or legacy-null** → rotate credentials (existing), then `update(connectionId, { status: 'active', config: { ...existing.config, sellerId: fresh.sellerId } })` (backfills legacy connections; idempotent on match). `info`-log the backfill when `stored` was null.

### Data flow
```
callback → exchangeCodeForToken → tokenResponse
        │  AllegroAccountReader.fetchSellerIdentity(getApiBaseUrl(env), access_token) → { sellerId, login }
        ▼
  storeCredentialsAndCreateConnection
    ├── create:  connectionService.create({ config: { …, sellerId } })
    └── re-auth: reauthenticateExistingConnection(…, identity)
            stored vs fresh.sellerId →
              mismatch → BadRequest ALLEGRO_SELLER_MISMATCH (no rotation, warn-log)
              match/null → updateCredentials + update({ status:'active', config:{…,sellerId} })
```

## 4. Step-by-step

| # | File | Change |
|---|------|--------|
| 1 | `libs/integrations/allegro/src/domain/types/allegro-config.types.ts` | `AllegroConnectionConfig` += `sellerId?: string` |
| 2 | `libs/integrations/allegro/src/domain/types/allegro-account.types.ts` (NEW) | `AllegroMeResponse { id: string; login: string }`, `AllegroAccountIdentity { sellerId: string; login: string }` |
| 3 | `libs/integrations/allegro/src/infrastructure/http/allegro-account-reader.ts` (NEW) | `@Injectable() AllegroAccountReader.fetchSellerIdentity(baseUrl, accessToken)` — raw `GET /me`, Accept header, timeout, parse `{id,login}`→`{sellerId,login}`, throw on non-200/missing id |
| 4 | allegro package barrel (`index.ts`) | export `AllegroAccountReader` + the account types |
| 5 | `libs/integrations/allegro/src/application/dto/allegro-connection-config.dto.ts` | `+ @IsOptional() @IsString() @IsNotEmpty() sellerId?: string` |
| 6 | `apps/api/src/integrations/application/services/allegro-oauth.service.ts` | inject `AllegroAccountReader`; fetch identity before branching; create-path config gains `sellerId`; `reauthenticateExistingConnection(+identity)` = match-check (reject + code + log) + backfill; replace the stale ASSUMPTION comment |
| 7 | apps/api integrations module | register `AllegroAccountReader` provider so it injects into the OAuth service |
| 8 | `allegro-account-reader.spec.ts` (NEW, package) | mock `global.fetch`: success → `{sellerId,login}`; non-200 → throws; missing `id` → throws |
| 9 | `allegro-oauth.service.spec.ts` (apps/api) | provide a mock `AllegroAccountReader`; cover create-persists-sellerId, re-auth match, **re-auth mismatch (rejects, no rotation)**, legacy-null backfill, reader-failure aborts |

## 5. Validation

- **Architecture:** the new Allegro `/me` knowledge lands in the plugin (per #859's direction); host stays orchestration-only for the new bit. No core change, no migration (jsonb config; validator is non-whitelisting). Seller id/login are public — safe to store(`id`)/log.
- **Testing:** unit-only. The reader's HTTP is unit-tested in the package (mock `fetch`); the OAuth-service logic is unit-tested against a mocked reader (no `global.fetch` stubbing in apps/api). No int-spec — the Allegro OAuth callback has no existing integration harness and the logic is fully unit-coverable.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`.
