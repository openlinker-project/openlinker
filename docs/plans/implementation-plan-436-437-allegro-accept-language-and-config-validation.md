# Implementation Plan — #436 + #437: Allegro `Accept-Language` header + Connection-config validation gap

Closes #436 (P0 — pin `Accept-Language: pl-PL` on `AllegroHttpClient` so the new endpoints stop 422'ing on `UnsupportedLanguageInAcceptLanguageHeader`). Closes #437 (P0 — close the `UpdateConnectionDto.config: Record<string, unknown>` validation bypass that lets partial `sellerDefaults` configs persist; tighten the Allegro adapter preflight to reject incomplete configs at offer-create time).

Both fixes shipped from the 2026-04-29 sandbox repro after #435 merged. They're independent enough to land separately, but combined here because they share the Allegro/connection-config slice and ship as the same operator-visible fix ("seller defaults now actually work end-to-end").

## 1. Goal

1. **#436** — Every `AllegroHttpClient` request sends `Accept-Language: pl-PL` so:
   - `GET /sale/products` (smart-link, #431) stops returning 422 → resolver runs against real data
   - `GET /sale/responsible-producers` (RP dropdown, #430) stops returning 422 → operator can pick an entry
   - Any future Allegro endpoint with the same gating works automatically
2. **#437** — Two-layer config validation:
   - **Service layer** — `ConnectionService.update()` runs platform-specific validation against the typed `AllegroConnectionConfigDto` (already exists from #435; currently dead because the controller's `config` field is `Record<string, unknown>`)
   - **Adapter layer** — `AllegroOfferManagerAdapter.createOffer()` preflight checks each required sub-field individually, so future operators with corrupt or hand-edited config fail fast with actionable diagnostics instead of with Allegro 422s

## 2. Layer classification

| Layer | Change |
|---|---|
| **CORE** | None. |
| **Integration (Allegro)** | (a) `AllegroHttpClient.executeRequest` writes `Accept-Language: pl-PL` into the request headers (single line). (b) `AllegroOfferManagerAdapter.createOffer` preflight widens `if (!this.sellerDefaults)` to per-field checks. |
| **Interface (API)** | `ConnectionService.update` runs `validateOrReject(plainToInstance(AllegroConnectionConfigDto, patch.config))` when `existing.platformType === 'allegro'` and `patch.config` is set. Mirrors the existing `enabledCapabilities` validation in the same method. |
| **Frontend** | None — class-validator throws `BadRequestException` with field-keyed errors that the existing form-level Alert renders verbatim. Optional follow-up: map errors to RHF fields, but defer per #437 OOS. |
| **DX** | None. |
| **Migrations** | None. |

## 3. Non-goals

- **Per-platform language preference.** PL marketplace is the only supported market; locale becomes interesting if/when DE / CZ / etc. land.
- **Validation of *other* per-platform config shapes** (PrestaShop's `baseUrl`, `shopId`, etc.). Same bypass exists for them but no live bug surfaced; open as a follow-up if/when needed.
- **Backfilling existing connections with partial `sellerDefaults`.** Operators just re-save through the form once #436 lets the RP dropdown load — the server-side validation will reject any further partial saves.
- **Per-field FE-side validation that mirrors BE.** Server stays the source of truth (#435 §4.6); BE returning 400 with a clear message is enough until operators report friction.
- **Card-blocked marker for smart-link parameter-mismatch failures.** Still deferred per #431 §3.

## 4. Design

### 4.1 `Accept-Language` header (#436)

`AllegroHttpClient.executeRequest` (`libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts`) already builds a fresh `Headers` object per call. Insert one line after the `Accept` header is set:

```ts
headers.set('Accept-Language', 'pl-PL');
```

Caller-supplied `options.headers` override (the Headers API merges later writes), so a future endpoint that needs a different locale can opt out without ceremony. The token-state-owned `Authorization` and the `X-Trace-Id` headers are appended last and remain immutable from caller code (existing invariant).

**Why `pl-PL` and not `en-US`**: operators target the PL marketplace; Allegro's localised `userMessage` field is most useful in Polish for support handoffs. The actual API behaviour is identical across the accepted locales.

### 4.2 Service-layer config validation (#437 layer 1)

`ConnectionService.update` already validates `enabledCapabilities` against the resolved adapter metadata (lines 242-261 per the survey). The natural place to add config validation is right after that block, before `connectionPort.update`:

```ts
// Existing capability validation ends here…
if (patch.config !== undefined && existing.platformType === 'allegro') {
  await this.validateAllegroConfig(patch.config);
}
await this.connectionPort.update(connectionId, patch);
```

Where `validateAllegroConfig` is a private helper (kept in the same service file — it's a thin wrapper, not worth its own module yet):

```ts
private async validateAllegroConfig(config: Record<string, unknown>): Promise<void> {
  const dto = plainToInstance(AllegroConnectionConfigDto, config, {
    enableImplicitConversion: false,
  });
  const errors = await validate(dto, {
    whitelist: false,        // we accept extra keys (forward-compat)
    forbidNonWhitelisted: false,
    skipMissingProperties: false,
  });
  if (errors.length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      message: 'Invalid Allegro connection config',
      errors: flattenValidationErrors(errors),
    });
  }
}
```

`flattenValidationErrors` is a 5-line utility that walks the nested ValidationError tree and produces `{ path: string; message: string }[]` so the FE can map field-keyed errors back to form inputs. Lives in a sibling util file (not engineering-standards-blocking — this is a one-off helper for the service).

**Why service-layer rather than DTO-layer**: making `UpdateConnectionDto.config` a discriminated union by `platformType` would push a Nest typing fight into a hot path that's already tested. Service-layer validation reuses the existing `AllegroConnectionConfigDto` (live since #435), needs zero controller-typing churn, and keeps the platform-branching logic next to the existing `enabledCapabilities` branch which already does the same thing.

**Why `whitelist: false`**: the global `ValidationPipe` runs with `whitelist: true, forbidNonWhitelisted: true` — meaning unknown keys are rejected at the controller boundary. We don't want that here because `connection.config` is intentionally extensible (`adapterKey`, `masterCatalogConnectionId`, future fields). The validator just needs to confirm the **typed fields are correct**; extra keys pass through.

### 4.3 Adapter preflight widening (#437 layer 2)

`AllegroOfferManagerAdapter.createOffer` currently has:

```ts
if (!this.sellerDefaults) {
  throw new OfferCreateRejectedException(ALLEGRO_ADAPTER_KEY, 0, [
    { field: 'sellerDefaults.location', code: 'SELLER_DEFAULTS_NOT_CONFIGURED', message: ... },
    { field: 'sellerDefaults.responsibleProducerId', code: 'SELLER_DEFAULTS_NOT_CONFIGURED', message: ... },
    { field: 'sellerDefaults.safetyInformation', code: 'SELLER_DEFAULTS_NOT_CONFIGURED', message: ... },
  ]);
}
```

Widen to:

```ts
const missing = collectMissingSellerDefaultsFields(this.sellerDefaults);
if (missing.length > 0) {
  throw new OfferCreateRejectedException(
    ALLEGRO_ADAPTER_KEY,
    0,
    missing.map((field) => ({
      field,
      code: 'SELLER_DEFAULTS_NOT_CONFIGURED',
      message: `Allegro connection ${this.connectionId} is missing ${field}. Configure it on the connection edit page before creating offers.`,
    })),
  );
}
```

Where `collectMissingSellerDefaultsFields` is a pure helper (file-private to the adapter, since the shape is Allegro-specific):

```ts
function collectMissingSellerDefaultsFields(
  defaults: AllegroSellerDefaultsConfig | undefined,
): string[] {
  const missing: string[] = [];
  if (!defaults) {
    // Same three fields as today's preflight when sellerDefaults is entirely absent.
    return [
      'sellerDefaults.location',
      'sellerDefaults.responsibleProducerId',
      'sellerDefaults.safetyInformation',
    ];
  }
  const loc = defaults.location;
  if (!loc?.countryCode) missing.push('sellerDefaults.location.countryCode');
  if (!loc?.province) missing.push('sellerDefaults.location.province');
  if (!loc?.city) missing.push('sellerDefaults.location.city');
  if (!loc?.postCode) missing.push('sellerDefaults.location.postCode');
  if (!defaults.responsibleProducerId) missing.push('sellerDefaults.responsibleProducerId');
  const safety = defaults.safetyInformation;
  if (!safety?.type) missing.push('sellerDefaults.safetyInformation.type');
  if (
    safety?.type === 'SAFETY_INFORMATION' &&
    (!safety.content || safety.content.length === 0)
  ) {
    missing.push('sellerDefaults.safetyInformation.content');
  }
  return missing;
}
```

Per-field messages let the FE Alert show a precise list ("missing: sellerDefaults.responsibleProducerId, sellerDefaults.location.city") instead of the current "configure all three fields". Operators with a config that lost just one field (because the BE validation was bypassed pre-#437, or because they hand-edited the JSON) now see the exact gap.

After preflight, the rest of `createOffer` can keep using `this.sellerDefaults!.location` / `.responsibleProducerId` / `.safetyInformation` as it does today — the non-null assertions are valid because preflight short-circuits any incomplete shape.

### 4.4 Why both layers, not just one

- **Service layer alone**: stops new partial configs from persisting, but doesn't help connections already in the DB (the operator has to re-save). And in-place mutation of a connection's config via direct DB patching (rare, but possible) bypasses it.
- **Adapter layer alone**: catches every bad config at offer-create time, but lets the bad shape sit in the DB until the operator tries an offer. Bad UX and bad observability.
- **Both**: catch new bad configs at save (fast feedback in the form), catch already-broken configs at offer-create (clear error trail in Job-detail view). Belt-and-braces, ~50 LOC total.

## 5. Step-by-step plan

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `libs/integrations/allegro/src/infrastructure/http/allegro-http-client.ts` | Add `headers.set('Accept-Language', 'pl-PL')` immediately after `Accept` is set in `executeRequest`. JSDoc comment references #436 + the supported-locale list. | Header appears on every request; caller-supplied `options.headers` can still override (Headers API last-write-wins). |
| 2 | `libs/integrations/allegro/src/infrastructure/http/__tests__/allegro-http-client.spec.ts` | Extend the existing header-assertion `expect.objectContaining({...})` blocks to include `'accept-language': 'pl-PL'`. | All existing specs that assert on headers still pass; one new branch confirms the override path (caller-supplied `Accept-Language: en-US` wins). |
| 3 | `apps/api/src/integrations/application/services/util/flatten-validation-errors.ts` (new) | 5-line helper that walks `ValidationError[]` and produces `{ path: string; message: string }[]`. JSDoc explains it's a one-off for service-level DTO validation. | Pure function; no NestJS deps. |
| 4 | `apps/api/src/integrations/application/services/connection.service.ts` | (a) Add `private async validateAllegroConfig(config: Record<string, unknown>): Promise<void>` — runs `plainToInstance(AllegroConnectionConfigDto, config)` + `validate()`, throws `BadRequestException` with flattened errors on failure. (b) In `update()`, after the existing capability-validation block and before `connectionPort.update`: `if (patch.config !== undefined && existing.platformType === 'allegro') { await this.validateAllegroConfig(patch.config); }`. | Saves with valid config succeed; saves with invalid `province` / missing `responsibleProducerId` / `postCode` regex fail / discriminated-safetyInformation shape fail return 400 with field-keyed errors. |
| 5 | `apps/api/src/integrations/application/services/connection.service.spec.ts` | New describe block covering: valid Allegro config passes, missing `responsibleProducerId` rejects, bad province enum rejects, bad postcode regex rejects, `type=SAFETY_INFORMATION` without `content` rejects, non-Allegro platforms skip the validator. | All branches green. |
| 6 | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | (a) Replace the `!this.sellerDefaults` preflight with the field-by-field collector per §4.3. (b) Add `collectMissingSellerDefaultsFields` as a file-private helper (or a sibling util file — pick whichever fits the existing util-extraction threshold; one consumer = file-private). | Preflight rejects incomplete shapes with per-field error list; complete shapes flow through unchanged. |
| 7 | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Extend the existing `seller defaults (#430)` describe block: keep the all-missing branch (current); add branches for missing-only-`responsibleProducerId`, missing-only-`location.city`, `type=SAFETY_INFORMATION` without `content`. | Each missing-field branch produces the exact expected `OfferCreateRejectedException` payload; happy path stays green. |
| 8 | All — quality gate | `pnpm lint`, `pnpm type-check`, `pnpm test`. | Clean. |
| 9 | Manual sandbox repro — **hard merge gate** | (a) Re-run the same Canon variant offer-create that 422'd on 2026-04-29 (cat 257933, EAN 4549292246117). With #436 in place, smart-link should hit `/sale/products` successfully — likely returns `unique` for that EAN; if so, offer reaches `active`/`validating` via card-link. (b) Open the connection-edit form: RP dropdown loads from `/sale/responsible-producers` (also unblocked by #436). (c) Save with a missing field intentionally (e.g., empty city) — BE returns 400 with `errors: [{ path: 'sellerDefaults.location.city', message: '...' }]`. (d) Have the operator delete `responsibleProducerId` from a connection's DB config directly, then attempt an offer — adapter preflight returns `OfferCreateRejectedException` with `field: 'sellerDefaults.responsibleProducerId'` in the Job-detail view. | All four paths produce the documented behaviour. |

## 6. Tests-of-record

- **HTTP client spec** — extended header-assertion block on every existing call-shape (the `objectContaining` already lists Authorization + Content-Type + Accept; adding `accept-language` is a one-line edit per assertion).
- **HTTP client spec (new branch)** — caller-supplied `Accept-Language: en-US` in `options.headers` wins over the default.
- **`ConnectionService.update` spec (new branch)** — six branches: valid Allegro config / missing RP / bad province / bad postcode / SAFETY_INFORMATION without content / non-Allegro platform skip.
- **`AllegroOfferManagerAdapter` spec (new branches)** — three field-by-field missing-field cases (RP only, city only, safety content only) on top of the existing all-missing branch.

No integration tests added — both fixes are wiring-only with no DB/wire-schema changes; existing E2E coverage continues to exercise the happy path.

## 7. Validation

- **Hexagonal compliance** — change confined to integration (#436) + interface/application (#437). CORE / FE / DTO unchanged.
- **Naming** — `validateAllegroConfig` private method (camelCase, per engineering-standards.md "Variables and Functions"); `flattenValidationErrors` util in `*.ts` colocated under `services/util/` (no `.types.ts` because it exports a function, not types). `collectMissingSellerDefaultsFields` file-private inside the adapter.
- **Service interface** — `ConnectionService` already implements `IConnectionService`; the new private method doesn't extend the public interface (per engineering-standards.md only public service methods are exposed via interface).
- **DI / port discipline** — no new ports; `AllegroConnectionConfigDto` is value-imported from `apps/api/src/integrations/http/dto/`, which is in-package and not a boundary violation.
- **Error handling** — `BadRequestException` at the controller boundary surfaces as a 400 to the FE per existing precedent. `OfferCreateRejectedException` at the adapter boundary surfaces through the existing `MarketplaceOfferCreateHandler` → Job-detail view path (no new wiring).
- **Logging** — new `validateAllegroConfig` logs `warn` on rejection so ops sees which connections are being misconfigured. Adapter preflight log already exists (`warn` on `OfferCreateRejectedException`).
- **Migrations** — none required.
- **Security** — `Accept-Language: pl-PL` is a static header, not user input; no injection surface. Service-layer validation runs against the typed DTO so injected fields are rejected by class-validator (already enforced by global pipe `whitelist: true`).

## 8. Risks & open questions

- **Operators on connections that already have partial `sellerDefaults` in the DB.** They'll get `OfferCreateRejectedException` with the per-field list on their next offer attempt — a slight UX regression vs. the current generic "all three fields missing" message, but factually more accurate. They re-save through the form (now functional once #436 unblocks the RP dropdown) and converge.
- **`Accept-Language: pl-PL` localises `userMessage` for everyone, including non-Polish operators.** Acceptable today (PL marketplace, PL operators); revisit when DE/CZ markets land.
- **Service-layer validation runs class-validator twice on Allegro PATCHes.** Once at the controller (via `ValidationPipe` on the `Record<string, unknown>` field — which is a no-op) and once in the service (against the typed DTO). The "twice" is one-trip cosmetic; the controller's first pass actually does nothing for `config`. Acceptable.
- **Future per-platform validation** — when PrestaShop's `baseUrl` regex or Shopify's API key prefix gets the same treatment, the `validateAllegroConfig` private method becomes a switch by `platformType`. That's an N=2 → N=3 refactor, not worth pre-building.

## 9. Out of scope (explicitly deferred)

- PrestaShop / Shopify per-platform config validation (no live bug today).
- FE field-mapping of BE validation errors back to RHF fields (best-effort form-top Alert is enough today).
- Per-connection `Accept-Language` override (PL is the only supported market today).
- Changing the discriminated `safetyInformation` Zod schema on the FE — BE is the strict gate; FE relaxation is intentional per #435 §4.6.
- Card-blocked marker for smart-link parameter-mismatch failures (#431 deferred).
