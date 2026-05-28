# Implementation Plan — #864 Close the last host→plugin OAuth coupling

**Issue:** #864 · **Follow-up to:** #859 / ADR-013 · **Layer:** Interface (host) — subtractive
**Branch:** `864-validate-connection-allegro-cleanup` · **ADR:** not required (subtractive cleanup; closes a known trade-off recorded in ADR-013)

> Closes the one residual Allegro coupling in `apps/api`'s neutral OAuth surface, explicitly tracked in ADR-013 §Cons. After this PR, `OAuthConnectionService` value-imports zero plugin packages — the modularity epic (#546) is complete for the OAuth slice.

## 1. Goal & non-goals

**Goal:** drop `OAuthConnectionService.validateConnection` and the `GET /integrations/allegro/connections/:id/validate` endpoint that backs it. The endpoint is redundant with already-shipped capabilities:

- **Shape validation** (#586/#587): `ConnectionConfigShapeValidatorPort` runs on create *and* update via `ConnectionService.validateConfigShape`, throwing `InvalidConnectionConfigException` → 400 with a flat error list. Allegro's `AllegroConnectionConfigShapeValidatorAdapter` covers the env-value, base-URL, and shape checks the host method duplicates today.
- **Live-credential validation** (#583): `ConnectionTesterPort` (host-dispatched via `ConnectionService.testConnection` → `POST /connections/:id/test`) covers "are these credentials live?".

**Non-goals:** any other change. No new types, no FE work, no behaviour change to anything else.

## 2. Research findings (drives the Option-2 call)

- **No FE consumer.** `grep -rnE "integrations/allegro/connections.*validate|validateConnection" apps/web/src` → 0 hits.
- **No int-spec consumer.** The OAuth int-spec I shipped under #859 covers connect/callback only.
- **Only callers of `validateConnection`** are: the `AllegroController.validate` handler, the interface declaration, and 2 cases in the controller spec.
- **Only host-side importers of `AllegroConnectionConfig` + `AllegroEnvironmentValues`** are in `oauth-connection.service.ts:47-48,211,215,217` (the validateConnection method body). Nothing else in `apps/{api,worker}` imports these symbols.
- **Existing shape coverage:** `libs/integrations/allegro/src/application/dto/allegro-connection-config.dto.ts` declares `environment` with the `AllegroEnvironmentValues` constraint, `apiBaseUrl`, and the rest — class-validator runs on every `ConnectionService.create` / `update` and produces a flat `{path, message}[]` for any shape failure, mapped to a 400 with `BadRequestException({message, errors})`.

**Conclusion:** `validateConnection`'s checks are 100% covered by the plugin validator on every write; the post-write read-style validator is dead surface, only ever called by a route the FE doesn't use.

## 3. Decision: drop, don't relocate

Picked **Option 2** from the issue body. Option 1 (delegate `validateConnection` to the plugin validator and re-flatten errors into the `{valid, errors[]}` string-array shape) would have preserved the surface — but the surface has no consumer. Dropping is strictly cleaner: less code, fewer tests, fewer endpoints, no new error-flattening adapter on the host. If a future operator workflow needs a read-style validity probe, it's a small additive change to either resurface it (delegating to the plugin validator) or expose `POST /connections/:id/test`.

## 4. Step-by-step

| # | File | Change |
|---|---|---|
| 1 | `apps/api/src/integrations/application/services/oauth-connection.service.ts` | Remove the `validateConnection` method (lines ~193-253). Drop the now-unused imports: `NotFoundException` from `@nestjs/common`, `AllegroConnectionConfig` + `AllegroEnvironmentValues` from `@openlinker/integrations-allegro`. Remove the deferred-coupling comment block immediately above the imports. |
| 2 | `apps/api/src/integrations/application/interfaces/oauth-connection.service.interface.ts` | Remove the `validateConnection` method signature + its JSDoc block from `IOAuthConnectionService`. |
| 3 | `apps/api/src/integrations/http/allegro.controller.ts` | Remove the `@Get('connections/:id/validate')` handler (`validate` method) and its Swagger decorators (`@ApiOperation`, `@ApiParam`, `@ApiResponse`s, `@ApiBearerAuth`). |
| 4 | `apps/api/src/integrations/http/allegro.controller.spec.ts` | Remove the `validate: jest.fn()` from the mock, the `describe('validate', …)` block + its 2 `it()` cases. |
| 5 | `docs/architecture/adrs/013-neutral-oauth-completion-port.md` | **No edit** — ADRs are append-only per the README practice. The PR description references this PR/#864 as the resolution of the recorded trade-off; the git log + issue cross-link is the audit trail. |

## 5. Validation

- **Architecture**: strictly subtractive. The neutral `OAuthConnectionService` now value-imports zero plugin packages — `@openlinker/integrations-allegro` is no longer in its dependency graph. The cross-context import guard (`scripts/check-cross-context-imports.mjs`) keeps its allow-list intact; we just stop tripping a previously-tolerated host→plugin coupling.
- **Naming/structure**: no new files. No naming concerns.
- **Test coverage**: the existing service unit spec never covered `validateConnection` (it was the deferred Allegro-coupled method in #859); no test removal needed there. The controller spec loses two tests with the route; the remaining 17 tests cover connect / callback / cursors / commands.
- **Behaviour**: `GET /integrations/allegro/connections/:id/validate` returns **404** after this PR. The FE doesn't call it; no operator workflow documented as dependent. Note in the PR body.
- **Security**: no impact. The endpoint was admin-bearer-gated (existing); removal reduces attack surface marginally.
- **Quality gate**: `pnpm lint && pnpm type-check && pnpm test` — must pass with zero errors. `pnpm test:integration` (apps/api) — must remain green; expect the same pre-existing flakes (apps/web full-suite parallelism, PS-harness cold-cache) and **no** new failures.

## 6. Risk

Single soft-breaking behaviour change: the `/validate` endpoint disappears. Mitigation: documented in the PR body; FE confirmed not to consume it. If a future caller surfaces, resurfacing the endpoint by delegating to the plugin validator is a small additive change against the unchanged `ConnectionConfigShapeValidatorRegistryService` seam.
