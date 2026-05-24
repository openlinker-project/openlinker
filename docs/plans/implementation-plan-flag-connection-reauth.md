# Implementation Plan — Flag connection + surface re-auth on terminal OAuth refresh rejection (#819)

## 1. Goal & Classification

When an Allegro connection's **refresh token is rejected server-side** (`400 invalid_grant` →
`credential-rejected`), every job on that connection dies, but nothing flags the connection or
tells the operator. The connection stays `status='active'`, so the scheduler keeps enqueuing
jobs that immediately die — now hourly because of the offer-status sync (#818).

**Fix:** on a **terminal `credential-rejected`** OAuth failure (never on transient
`network-failure`), flag the connection so (a) the scheduler stops enqueuing against it, (b) the
operator sees a "re-authentication required" affordance, and (c) a successful re-auth clears the
flag.

**Layer classification:**
- **CORE** — new marketplace-agnostic auth-failure classification seam in the `sync` context;
  `SyncJobRunner` flags the connection at the dead-job boundary.
- **Integration (Allegro)** — register an auth-failure classifier for `AllegroAuthenticationException`;
  thread an existing `connectionId` through the OAuth re-auth flow.
- **Interface (FE)** — "Re-authentication required" banner on connection detail + list marker.

**Non-goals:**
- Token-rotation correctness (the sandbox token was invalidated server-side — not an OL bug; see
  issue Assumptions). This issue is detection + surfacing + halting dead-job noise.
- PrestaShop auth flagging (API-key based, not OAuth-refresh). The seam is generic; PrestaShop can
  register a classifier in a follow-up.
- A general "re-authenticate any OAuth connection" admin UX beyond what recovery needs.

## 2. Key findings from codebase research

- **Classification already happens in the Allegro http client.** `refreshOnUnauthorized`
  (`allegro-connection-token-state.ts`) returns a tagged outcome; the http client throws
  `AllegroNetworkException` for `network-failure` (retryable) and `AllegroAuthenticationException`
  for `credential-rejected` / `no-callback` (terminal). **So by the time the error reaches the
  worker, the terminal-vs-transient distinction is already encoded in the exception type** — a
  network blip never surfaces as an auth exception. We do not need to thread `connectionId` through
  the exception: the runner already has `job.connectionId`.
- **The runner is the right seam.** `SyncJobRunner.handleJobFailure()`
  (`apps/worker/src/sync/sync-job.runner.ts:289`) already classifies non-retryable errors via
  `RetryClassifierRegistryService` (a marketplace-agnostic registry plugins register into — #581).
  At the non-retryable dead-job branch (line 299) `job.connectionId` and the unwrapped `cause` are
  in hand. This is the exact precedent to mirror for auth-failure classification.
- **`isNonRetryableError` is broader than auth.** It also returns `true` for deterministic 4xx
  (422 business errors, `OfferCreationInvariantException`). We must **only** flag the connection
  when the cause is specifically a *credential rejection*, not any non-retryable failure — hence a
  dedicated classifier, not "flag on every dead job".
- **`connections.status` is a free-form string column** (`@Column() status!: string`) — adding a
  new status value needs **no DB migration**.
- **Scheduler filters `status: 'active'`** (`scheduler.service.ts:152`) — any non-`active` status
  automatically stops enqueuing. ✔
- **Re-auth currently mints a NEW connection.** `AllegroOauthService.storeCredentialsAndCreateConnection`
  always calls `connectionService.create(...)`; OAuth `state` carries no existing `connectionId`.
  Minting a new connection on re-auth would **orphan all connection-scoped identifier mappings**
  (products/offers/orders are keyed to `connectionId`). Proper recovery must update the existing
  connection in place.
- **`ConnectionService.updateCredentials` exists** (in-place credential rotation, db-backed refs)
  but is never called from the OAuth path and does not touch status.
- **Worker DI** already imports `IdentifierMappingModule` (→ `CONNECTION_PORT_TOKEN`) and `SyncModule`
  (→ classifier registries) into `SyncWorkerModule`, so the runner can inject both.

## 3. Design

### 3.1 Marketplace-agnostic auth-failure classification (CORE, `sync` context)

Mirror the `RetryClassifierPort` / `RetryClassifierRegistryService` pattern exactly.

- `libs/core/src/sync/domain/ports/auth-failure-classifier.port.ts`
  ```ts
  export interface AuthFailureClassifierPort {
    /** True iff the cause is a terminal credential rejection for this
     *  platform's exception hierarchy (re-authentication required).
     *  False for everything else (transient, deterministic-4xx, unknown). */
    isCredentialRejected(cause: unknown): boolean;
  }
  ```
- `libs/core/src/sync/infrastructure/adapters/auth-failure-classifier-registry.service.ts` —
  `register(adapterKey, classifier)` + OR-across-all `isCredentialRejected(cause)` (copy of the
  retry registry; iterate-all because the runner holds a raw error, not an `adapterKey`).
- `libs/core/src/sync/sync.tokens.ts` — `AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN = Symbol('AuthFailureClassifierRegistryService')`.
- `sync.module.ts` — provide (`useExisting`) + export both token and service; barrel re-exports the
  port + registry (mirroring the retry-classifier exports).

### 3.2 Connection status flag (`needs_reauth`)

- `libs/core/src/identifier-mapping/domain/types/connection.types.ts` — extend
  `ConnectionStatusValues` to `['active', 'disabled', 'error', 'needs_reauth'] as const`.
  Propagates to `UpdateConnectionDto` enum, `connection-response.dto.ts`, FE type. No migration.
- New port/service surface for writing the flag: the runner calls the existing
  `ConnectionPort.update(connectionId, { status: 'needs_reauth' })` (from
  `@openlinker/core/identifier-mapping`), **guarded** so it only flips a connection that is
  currently `active` (never clobber `disabled`, never re-write if already flagged).

### 3.3 Runner wiring (worker)

`SyncJobRunner` (`apps/worker/src/sync/sync-job.runner.ts`):
- Inject `AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN` and `CONNECTION_PORT_TOKEN`.
- In `handleJobFailure`, at the non-retryable branch (before/with `markDead`):
  ```ts
  if (this.isNonRetryableError(error)) {
    const cause = unwrap(error);
    if (this.authFailureClassifierRegistry.isCredentialRejected(cause)) {
      await this.flagConnectionNeedsReauth(job.connectionId);
    }
    await this.jobRepository.markDead(job.id, errorMessage);
    return;
  }
  ```
- `flagConnectionNeedsReauth(connectionId)`: fetch connection; if `status === 'active'`, update to
  `needs_reauth`; log a structured warn (`{ connectionId, platformType, from, to }`). Swallow errors
  from the flagging step (must never mask the original job failure / crash the runner loop).
- **Telemetry:** structured log on transition. (Domain event optional — deferred; logging satisfies
  the criterion and avoids new event plumbing.)

### 3.4 Allegro classifier (Integration)

- `libs/integrations/allegro/src/infrastructure/adapters/allegro-auth-failure-classifier.adapter.ts`
  — `AllegroAuthFailureClassifierAdapter implements AuthFailureClassifierPort`:
  `isCredentialRejected(cause) => cause instanceof AllegroAuthenticationException`.
- Register in `allegro-plugin.ts` `register(host)`:
  `host.authFailureClassifierRegistry.register('allegro.publicapi.v1', new AllegroAuthFailureClassifierAdapter())`.

### 3.5 Plugin contract (`HostServices`)

Add `readonly authFailureClassifierRegistry: AuthFailureClassifierRegistryService;` to
`libs/plugin-sdk/src/host-services.ts`, and add the field to every place a `HostServices` literal is
assembled (Allegro + PrestaShop Nest modules' `onModuleInit`, and `createNestAdapterModule`).
Type-check will enumerate them. **Plugin-contract change → write a short ADR.**

### 3.6 Auto-recovery — re-authenticate the *existing* connection (Integration + API)

> Scope decision pending user confirmation — see §6. Plan below is the recommended full slice.

- `AllegroOAuthConnectDto` + `OAuthStateData` — add optional `connectionId`.
- `allegro.controller.ts` `oauth/connect` — pass through `connectionId`.
- `allegro-oauth.service.ts`:
  - `generateAuthorizationUrl` — persist `connectionId` in the Redis state blob.
  - `storeCredentialsAndCreateConnection` (or a new branch `reauthExistingConnection`) — when
    `state.connectionId` is present: resolve the connection, `updateCredentials(connectionId, creds)`
    (in-place, db-backed), then `connectionPort.update(connectionId, { status: 'active' })`.
    Otherwise keep the existing create-new path.
- This preserves all connection-scoped identifier mappings and satisfies the "successful re-auth
  clears the flag" criterion.

### 3.7 Frontend

- `connection.types.ts` (FE) — add `'needs_reauth'` to `ConnectionStatus`.
- `connections-list-page.tsx` `toStatusTone()` — map `'needs_reauth'` → `'warning'` and label.
- `connection-detail-page.tsx` — when `status === 'needs_reauth'`, render a `<Alert tone="warning"
  title="Re-authentication required">` with a "Re-authenticate" action that starts OAuth for **this
  connection** (Allegro: `useStartAllegroOAuthMutation` with the current `connectionId`), reusing the
  `requiresExternalAuthRedirect` / PlatformContribution pattern.

## 4. Step-by-step implementation

| # | File | Change | Acceptance |
|---|------|--------|-----------|
| 1 | `libs/core/src/sync/domain/ports/auth-failure-classifier.port.ts` | New port | Interface compiles; header comment |
| 2 | `libs/core/src/sync/infrastructure/adapters/auth-failure-classifier-registry.service.ts` | New registry (mirror retry) | `register` + `isCredentialRejected` OR-across-all |
| 3 | `libs/core/src/sync/sync.tokens.ts` | New token | `AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN` |
| 4 | `libs/core/src/sync/sync.module.ts` + barrel | provide/export port+registry+token | Worker + plugins resolve it |
| 5 | `libs/core/src/identifier-mapping/.../connection.types.ts` | add `'needs_reauth'` | union + DTO enum updated |
| 6 | `libs/plugin-sdk/src/host-services.ts` | add `authFailureClassifierRegistry` | type-check finds all literal sites |
| 7 | host-bag assembly sites (Allegro/PrestaShop modules, `createNestAdapterModule`) | wire new field | boot wiring compiles |
| 8 | `libs/integrations/allegro/.../allegro-auth-failure-classifier.adapter.ts` | New classifier | true only for `AllegroAuthenticationException` |
| 9 | `allegro-plugin.ts` | register classifier | registered at boot |
| 10 | `apps/worker/src/sync/sync-job.runner.ts` | inject + flag on credential-rejected | flips `active→needs_reauth`, guarded, error-swallowed |
| 11 | Auto-recovery: DTO/state/controller/oauth service | re-auth existing connection in place | `updateCredentials` + status→active; mappings preserved |
| 12 | FE: types + list tone + detail banner + re-auth action | surface + CTA | banner shows on `needs_reauth`, links to OAuth |
| 13 | `docs/architecture/adrs/NNN-*.md` | ADR for the classifier seam + HostServices addition | rationale captured |

## 5. Tests

- **Unit (`sync-job.runner.spec.ts`)**: flags connection on credential-rejected non-retryable cause;
  does **not** flag on (a) transient/retryable error, (b) non-retryable non-auth (422 /
  `OfferCreationInvariantException`); flagging guarded to `active`; flagging error swallowed.
- **Unit**: `AuthFailureClassifierRegistryService` (OR-across-all, unknown → false);
  `AllegroAuthFailureClassifierAdapter` (true for `AllegroAuthenticationException`, false otherwise).
- **Integration (`*.int-spec.ts`)**: real Postgres — a dead-on-credential-rejection job flips the
  connection to `needs_reauth`; scheduler `list({status:'active'})` then excludes it; re-auth
  in-place resets to `active` and preserves the credentials ref / mappings.
- **FE**: detail page renders the re-auth banner when `status === 'needs_reauth'`; list shows the
  marker; banner CTA invokes the OAuth start for the connection.

## 6. Open questions for the user (scope)

1. **Status value:** dedicated `'needs_reauth'` (recommended — precise FE signal, no migration,
   scheduler auto-excludes) vs reuse `'error'`.
2. **Auto-recovery scope:** build the in-place re-auth-existing-connection flow now (recommended —
   required to preserve connection-scoped mappings and to satisfy "re-auth clears the flag") vs
   defer it to a follow-up (ship detection + flagging + FE banner now; clear the flag via
   `updateCredentials` so a later re-auth flow recovers automatically).

## 7. Validation / architecture compliance

- Marketplace-agnostic seam (classifier registry) — no Allegro imports in core/runner. ✔
- Ports + Symbol tokens; domain layer framework-free. ✔
- Only `credential-rejected` flags (transient `network-failure` surfaces as retryable
  `AllegroNetworkException`, never reaches the auth branch). ✔
- No `any`; structured `Logger`; flag write guarded + error-swallowed so it never destabilises the
  runner loop. ✔
- No DB migration (string status column). ✔
