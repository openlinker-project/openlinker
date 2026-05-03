# Implementation Plan — #509 PrestashopConnectionConfigDto

## Goal

Close the engineering-standards `Validation` violation on the PrestaShop side: every field on `Connection.config` for PS today is unvalidated at the interface layer because the schema is a plain `interface` and the controller body uses `Record<string, unknown>`. Mirror the Allegro pattern (`AllegroConnectionConfigDto` + `validateAllegroConnectionConfig` registered in `CONNECTION_CONFIG_VALIDATORS`) for PrestaShop.

## Layer classification

Interface (DTO) + a tiny touch on Application/services/util (validator registry + glue). No CORE changes. No schema/migration. No FE work.

## Scope correction (uncovered during research)

The issue body says "returns 400 from the create/update endpoint", but `connection.service.create()` does **not** call `CONNECTION_CONFIG_VALIDATORS` today — only `update()` does (added in PR #437). So the registry runs on update only. To meet the acceptance criterion as written, this PR also wires the registry into `create()`. Side effect: Allegro create now also gets DTO-validated, fixing the same latent gap retroactively. Flagged to user — confirm before implementation.

## Files

**New:**
- `apps/api/src/integrations/application/dto/prestashop-connection-config.dto.ts`
- `apps/api/src/integrations/application/dto/__tests__/prestashop-connection-config.dto.spec.ts` (DTO field-level coverage)

**Modified:**
- `apps/api/src/integrations/application/services/util/connection-config-validators.ts` — add `validatePrestashopConnectionConfig`, register under `prestashop`
- `apps/api/src/integrations/application/services/connection.service.ts` — call the validator in `create()` (mirroring the existing `update()` hook)
- `apps/api/src/integrations/application/services/connection.service.spec.ts` — add a `describe('PrestaShop config validation (#509)')` block mirroring the existing Allegro block; add a parallel block for the create path

## Field mapping

The DTO mirrors `PrestashopConnectionConfig` (libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts):

| Field | Constraint | Notes |
|---|---|---|
| `baseUrl` (required) | `@IsUrl({ require_protocol: true })` `@IsString()` | required, http(s) URL |
| `storefrontBaseUrl?` | `@IsUrl({ require_protocol: true })` `@IsOptional()` | optional override |
| `shopId?` | `@IsInt()` `@Min(1)` `@IsOptional()` | positive int |
| `langId?` (deprecated) | `@IsInt()` `@Min(1)` `@IsOptional()` | kept for back-compat |
| `preferredLanguageId?` | `@IsInt()` `@Min(1)` `@IsOptional()` | positive int |
| `timeoutMs?` | `@IsInt()` `@Min(1)` `@Max(120000)` `@IsOptional()` | sanity max = 2 min |
| `pageSize?` | `@IsInt()` `@Min(1)` `@Max(1000)` `@IsOptional()` | sanity max = 1000 |
| `responseFormat?` | `@IsIn(ResponseFormatValues)` `@IsOptional()` | extracted as `as const` |
| `currency?` | `@IsString()` `@Matches(/^[A-Z]{3}$/)` `@IsOptional()` | uppercase ISO-4217 format |
| `defaultCarrierId?` | `@IsInt()` `@Min(1)` `@IsOptional()` | matches existing runtime guard |
| `guestCustomerGroupId?` | `@IsInt()` `@Min(1)` `@IsOptional()` | matches existing runtime guard |
| `paymentModuleOverrides?` | `@IsArray()` `@IsString({ each: true })` `@IsOptional()` | string array |

**Currency strictness:** strict `^[A-Z]{3}$` over the issue's lenient `@Length(3,3)`. Rejects `pln` / `123` / `EUR` (good) — adapter consumers don't normalize, so operators must save canonical form. A `@Transform`-uppercase alternative would silently mutate the persisted bytes; explicit error is friendlier.

**Numeric upper bounds (review fix):** `timeoutMs` capped at 120000 (2 min) and `pageSize` at 1000 to prevent typo-driven config from disabling the adapter or DOSing PS WS. Both are well past any plausible production value.

**`responseFormat` as const (review fix):** extract `ResponseFormatValues = ['auto','json','xml'] as const` in `prestashop-config.types.ts`, derive `ResponseFormat` from it. Mirrors how `AllegroSafetyInformationDto` consumes `AllegroSafetyInformationTypeValues`.

## Test plan

**DTO unit test** (`prestashop-connection-config.dto.spec.ts`):
- Happy path: minimal config (only `baseUrl`) passes
- Happy path: fully-populated config passes
- Per-field invalid: each numeric field rejects `0`, negatives, non-finite (3 cases collapsed)
- Per-field invalid: `currency` rejects `'pln'`, `'PL'`, `'1234'`
- Per-field invalid: `responseFormat` rejects `'foo'`
- Per-field invalid: `baseUrl` rejects empty, missing protocol
- Per-field invalid: `paymentModuleOverrides` rejects non-string entries
- Optional-vs-omitted: omitting any optional field passes

**Service-level test** (`connection.service.spec.ts`):
- `describe('PrestaShop config validation (#509)')` mirrors the existing Allegro block
  - Update path: valid config accepted; `defaultCarrierId: -1` rejected with 400
  - Create path: valid config accepted; `guestCustomerGroupId: 0` rejected with 400 (this branch is new because create-path validation was missing)

## Quality gate

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all green, includes the two new specs
```

No migration. No `migration:show` needed.

## Open questions

1. **Currency regex strictness** — `@Length(3,3)` (issue sketch, lenient) vs `@Matches(/^[A-Z]{3}$/)` (proposed, strict). Strict is safer; lenient is friendlier. Default: strict.
2. **Create-path validation expansion** — confirm OK to wire the validator into `create()` too. Side effect: also tightens Allegro create. Default: yes.
3. **Should the DTO live in `libs/integrations/prestashop/`** instead of `apps/api/src/integrations/application/dto/`? The Allegro DTO lives in `apps/api/...` despite Allegro types living in `libs/integrations/allegro/...`, so the existing convention is "Application-layer DTOs live in apps/api". Following that. Open for review.

## Implementation order

1. Write `PrestashopConnectionConfigDto` with all decorators
2. Add `validatePrestashopConnectionConfig` and register `prestashop` in `CONNECTION_CONFIG_VALIDATORS`
3. Add the validator-call in `connection.service.create()` (parallel to the existing `update()` hook)
4. Write DTO unit tests
5. Extend `connection.service.spec.ts` with a PS validation block (update + create paths)
6. Run quality gate
7. Self-review per `docs/code-review-guide.md`
8. Commit on `509-ps-connection-config-dto`

## Out of scope

- Migration of existing connections that already have invalid values persisted (issue body explicit OOS).
- DTO for a future `OpenLinkerConnectionConfig` or other platforms.
- Removing the runtime guards in `PrestashopOrderProcessorManagerAdapter.resolveExternalCarrierId` and `PrestashopCustomerProvisioner` — they stay as defense-in-depth (issue body explicit).
- Refactoring controller-body DTOs to typed `config` (out-of-scope; would require a discriminated union and reverberates further).
