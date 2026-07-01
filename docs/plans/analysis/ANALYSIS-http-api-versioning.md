# Pre-implement analysis — HTTP API versioning (`/v1`) (#1133)

- **Plan**: `docs/plans/implementation-plan-http-api-versioning.md` (Design A / hard `/v1`)
- **Gate run**: read-only against the live tree at `1133-http-api-versioning`
- **Verdict**: **READY** — with one **required carve-out decision** to fold in before coding (Allegro OAuth callback). No Critical contract break, no reuse collision.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `AppInfoService` / `IAppInfoService` | **NEW** (absent) | no `*app-info*`/`*version*service*` under `apps/api/src`; no `getProductVersion`/`AppInfoService` symbol anywhere |
| `api-version.const.ts` (`API_VERSION`, `API_VERSION_LABEL`) | **NEW** | no `API_VERSION` symbol in `apps/api/src` |
| `enableVersioning` / `VERSION_NEUTRAL` config | **NEW** | confirmed unused in `apps/api` + `apps/worker` |
| `version`/`api` on `InternalHealthResponse` | **PARTIAL — extend** | `dev-stack-health.types.ts` owns it; consumed only by `app.controller.ts` + `dev-stack-health.service*.ts` (all apps/api) |
| Version-neutral webhook route | **PARTIAL — extend** | single `webhook.controller.ts` (`@Controller('webhooks')`) → one `@Version(VERSION_NEUTRAL)` |
| Runtime version endpoint | **NEW** | no app/product-version endpoint exists (root `/` returns a string) |

## Backward-compat findings

| Surface | Result | Severity |
|---|---|---|
| Top-level barrels (`@openlinker/core/*`) | untouched (apps/api-only change) | — |
| Port method signatures | none changed | — |
| DTO / response shapes | `InternalHealthResponse` gains **optional** `version`/`api` — additive | none |
| Symbol tokens | none removed; may **add** `APP_INFO_SERVICE_TOKEN` | none |
| ORM schema | no entity change → **no migration** | none |
| `check:invariants` | no cross-context import; apps/api service not covered by `check-service-interfaces.mjs` (libs/core-only) | none |
| OpenAPI snapshot tests | none exist → no contract-snapshot break | none |
| **Allegro OAuth callback** `/integrations/allegro/oauth/callback` | **external URL not in the plan's neutral set** | **Warning (external contract)** |

> **⚠️ Superseded during tech-review.** The analysis below recommended keeping the
> Allegro OAuth callback version-neutral. That was **wrong** — the Allegro-whitelisted
> redirect URI is the **FE route** `/integrations/allegro/connect/callback`
> (`window.location.origin`), not this backend endpoint. The backend
> `/integrations/allegro/oauth/callback` is an internal JSON API the FE callback page
> calls through the versioned api-client, so it MUST be versioned (`/v1`). Marking it
> neutral 404s that call and breaks OAuth completion. Final neutral set is
> `{ /webhooks, / }` only. Kept below for provenance.

### The Allegro OAuth callback (must decide before coding)

`AllegroOauthConnectDto.redirectUri` is **client-supplied** and documented as *"must match Allegro app configuration"* (`allegro-oauth-connect.dto.ts:38`). It is an operator-whitelisted redirect URI in Allegro's developer console — a genuine external URL, same class as `/webhooks`. Under hard `/v1` the callback route becomes `/v1/integrations/allegro/oauth/callback`, so any operator who whitelisted the unversioned URL must re-register it.

Two acceptable resolutions (pick one at implementation; not a replan):
- **(a) Carve it out** — mark the callback route `@Version(VERSION_NEUTRAL)` (mirrors the `/webhooks` treatment). Zero operator churn; the OAuth surface stays outside the versioned contract. **Recommended** — the callback is an integration handshake, not part of the app's REST contract, and there is no cost to leaving it stable.
- **(b) Version it + document** — let it move to `/v1`, update the FE-supplied `redirectUri` default + the DTO example + a RELEASING/setup note telling operators to re-whitelist. Consistent "everything is /v1" story, at the cost of an operator migration step.

Because there are **zero external deployments today**, either is safe; (a) is strictly lower-risk and one decorator.

## Open questions / minor notes (non-blocking)

1. **Root `/` (`getHello`)** moves to `/v1` under the default → bare `GET /` returns 404. No known consumer; optionally keep neutral for LB probes. Trivial.
2. **Where to populate `version`/`api`** — controller overlay (keeps `DevStackHealthService` focused on DB/redis readiness) vs. inject `AppInfoService` into the health service. Prefer the controller overlay; impl detail.
3. **Ordering in `main.ts`** — call `enableVersioning(...)` **before** `SwaggerModule.createDocument(...)` so Swagger operations render `/v1/...`.
4. **FE test** `apps/web/src/app/api/api-client.test.ts:137` calls `request('/health')` — will need updating alongside the FE base-path change.
5. **`/webhooks` raw-body middleware** in `main.ts` stays keyed on `/webhooks`; the neutral webhook route keeps that path, so no mismatch.

## Bottom line

No reuse collision, no Critical contract break, no migration. Proceed — but **explicitly decide the Allegro OAuth-callback carve-out** (recommend `VERSION_NEUTRAL`) so the neutral set is `{ /webhooks, /integrations/allegro/oauth/callback }`, not just `/webhooks`.
