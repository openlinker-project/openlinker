# Implementation Plan — HTTP API versioning (`/v1`) + runtime version surface (#1133)

- **Issue**: #1133 (Axis 3 of ADR-029)
- **Layer**: Interface / DX (apps/api bootstrap + FE api-client base path + docs)
- **Branch**: `1133-http-api-versioning`

## 1. Goal

Move the flat, unversioned HTTP API onto an explicit **URI versioning** scheme
(`/v1/...`) using NestJS `enableVersioning`, and add a **runtime version
surface** (`GET /v1/health` reporting product version + API version) so the tag,
the Release, the CHANGELOG, and the live process agree. Decided by
[ADR-029](../architecture/adrs/029-versioning-and-release-strategy.md) §Axis 3 and
[RELEASING.md](../../RELEASING.md) §"HTTP API versioning". Blocks the first
`v0.1.0` product tag (#1137).

**Non-goals** (explicitly deferred):
- No `/v2`, no actual breaking change — only the `/v1` scaffold + the
  deprecation *policy text*.
- Product-release tooling (release-please, CHANGELOG, first tag) is #1137.
- npm package SemVer (Changesets) stays deferred (#552 / PUBLIC_API.md).
- Making `package.json` the enforced single origin of the product version is
  coordinated with #1137 (which owns tagging); #1133 ships a sane resolution
  chain + the endpoint.

## 2. Decided design

### 2.1 Versioning
- `app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION })`
  in `apps/api/src/main.ts`, where `API_VERSION = '1'` (prefix defaults to `v` →
  `/v1`). Sourced from one shared constant reused by the version endpoint.
- **Version-neutral routes** (served WITHOUT `/v1`):
  - `@Controller('webhooks')` — external platforms have `/webhooks/:provider/:connectionId`
    provisioned, and `main.ts` keys raw-body middleware on the literal `/webhooks` path.
  - the root `/` welcome route — kept neutral for load-balancer / uptime probes
    that hit the bare origin.
- **Correction (post-review):** the Allegro OAuth callback
  `/integrations/allegro/oauth/callback` is **versioned** (`/v1`), NOT neutral.
  The pre-implement analysis conflated it with the Allegro-whitelisted redirect
  URI — but that whitelisted URL is the **FE route**
  `/integrations/allegro/connect/callback` (`window.location.origin`). The backend
  endpoint is an internal JSON API the FE callback page calls via the versioned
  api-client (`request('/integrations/allegro/oauth/callback?...')` → `/v1/...`);
  marking it neutral would 404 that call and break OAuth completion.
- Everything else (auth, orders, connections, sync, products, health, both
  Allegro OAuth endpoints, …) moves under `/v1` via the default.

### 2.2 Runtime version surface
- Enrich the existing internal health response so `GET /v1/health` returns
  `{ status, version, api, services, timestamp }` (reuses `AppController` +
  `DevStackHealthService.checkInternalHealth()` — no new controller).
  - `api`: the `v1` string, from the shared `API_VERSION` constant.
  - `version`: product version, resolved by a small `AppInfoService`
    (`IAppInfoService`) as `OL_PRODUCT_VERSION ?? npm_package_version ?? '0.0.0-dev'`.
    Deploy sets `OL_PRODUCT_VERSION` to the release tag (documented; #1137 wires
    it from package.json/release-please). `npm_package_version` covers `pnpm`-run
    dev.
- `GET /v1/health/dev-stack` (existing dev diagnostics) rides along under `/v1`.

### 2.3 Swagger
- Keep the Swagger UI at `/api` (middleware, unaffected by route versioning).
- Set `DocumentBuilder().setVersion(productVersion)` from the same resolved
  product version (was hardcoded `'1.0'`). Operation paths auto-render `/v1/...`.

### 2.4 Frontend
- Append `/v1` to the API base. Chosen approach: **`buildUrl()`** in
  `apps/web/src/app/api/api-client.ts` prepends `/v1` to non-neutral paths, OR
  simpler — bake `/v1` into the base and special-case the two health calls.
  Final choice pinned in step list after reading `buildUrl`. FE calls
  `/health/dev-stack`, which is version-neutral-sensitive — see §3 decision.

### 2.5 Deprecation/support policy
- Add a short "HTTP API versioning" section to `docs/` (or extend RELEASING.md
  reference): `/v1` is current; a breaking change ships as `/v2` with `/v1`
  supported for a documented window; product version moves independently.

## 3. Open decision (needs user) — enforcement strictness vs. test churn

NestJS URI versioning supports `defaultVersion: ['1', VERSION_NEUTRAL]`
(type-verified), which serves **both** `/v1/x` and `/x`. This is the fork:

- **Design A — hard `/v1`** (`defaultVersion: '1'`). Unversioned → 404.
  Faithful to "decide before adoption". Cost: mirror versioning in the int-test
  harness + update ~100–185 non-webhook int-spec paths to `/v1/...` (67 files),
  large mechanical diff, heavier/flakier int-suite verification.
- **Design B — dual-serve** (`['1', VERSION_NEUTRAL]`). Both paths resolve.
  Zero test churn; FE/Swagger/docs advertise `/v1`. Softer: unversioned stays
  reachable (transitional). 
- **Design C — hard `/v1` in main.ts only**, harness stays unversioned + one
  dedicated `api-versioning.int-spec.ts`. Low churn but harness diverges from
  main.ts (which it otherwise mirrors).

**Recommendation: Design A** — #1133's whole point is to make `/v1` the surface
before integrators build against the unversioned one; dual-serve leaves the
unversioned surface adoptable and undercuts that. The churn is mechanical and
scriptable. If the large diff / int-suite flakiness is the bigger concern,
Design B is the safe fallback.

## 4. Step-by-step

1. **`apps/api/src/app-info/`** — `IAppInfoService` (`getProductVersion()`,
   `getApiVersion()`), `AppInfoService` impl, `api-version.const.ts`
   (`API_VERSION = '1'`, `API_VERSION_LABEL = 'v1'`). Unit spec for the
   resolution chain.
2. **`apps/api/src/main.ts`** — `enableVersioning({ type: URI, defaultVersion })`;
   `.setVersion(productVersion)` in Swagger; keep `/webhooks` middleware + `/api`.
3. **`webhook.controller.ts`** — add `@Version(VERSION_NEUTRAL)`.
4. **`app.controller.ts` + `dev-stack-health.types.ts`** — add `version` + `api`
   to `InternalHealthResponse`; inject `AppInfoService`; populate in
   `checkInternalHealth()` (or map in controller). Update the health unit/int spec.
5. **Test harness** (`apps/api/test/integration/setup.ts` `configureApp`) — under
   Design A only: `app.enableVersioning(...)` mirroring main.ts; update non-webhook
   int-spec paths to `/v1/...` (webhook + neutral paths unchanged). Under Design B:
   no harness change; add `api-versioning.int-spec.ts` asserting `/v1/health`
   surface + `/webhooks` neutral + a representative `/v1/orders` route.
6. **Frontend** — `apps/web/src/app/api/api-client.ts` (+ `env.ts` / `.env.example`):
   route non-neutral calls through `/v1`; keep `/health*` reachable.
7. **Docs** — deprecation/support policy note; update `dev-environment.md` /
   `getting-started.md` health curls if paths change.
8. **Quality gate** — `pnpm lint`, `pnpm type-check`, `pnpm test`; targeted
   int-spec run for the versioning + health slices.

## 5. Validation / risks
- **Arch compliance**: interface-layer only; `AppInfoService` implements an
  interface (standards §Service Interface). No core/domain changes, no migration.
- **Risk — webhook breakage**: mitigated by `@Version(VERSION_NEUTRAL)` +
  unchanged raw-body middleware path. Covered by existing webhook int-specs.
- **Risk — FE health 404**: `/health/dev-stack` must stay reachable from the FE;
  handled in step 6.
- **Risk — version source in Docker**: `npm_package_version` unset under
  `node dist/main.js`; `OL_PRODUCT_VERSION` fallback + doc note.
- **Risk — int-suite churn/flakiness (Design A)**: large diff; verify with
  targeted patterns, prune Docker between heavy runs.
