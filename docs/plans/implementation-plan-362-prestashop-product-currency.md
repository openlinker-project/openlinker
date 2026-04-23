# Implementation Plan — #362 — Resolve PrestaShop product currency from connection config

**Branch:** `362-prestashop-product-currency`
**Layer:** Integration (PrestaShop) + CORE types boundary + Frontend wizard
**Scope:** Option B from the issue — add optional `currency` to `PrestashopConnectionConfig`, thread through factory → mapper, expose in wizard. No DB migration (column added in #358).
**Risk:** Low — behaviour-preserving when `currency` is unset (still emits `null`); new code paths only activate when operator opts in.

---

## 1. Understand the task

### Goal

A PrestaShop connection configured with `currency: 'PLN'` produces synced products that persist `currency='PLN'`, so `GET /products` returns the real ISO code and the FE renders the correct locale-aware glyph (`zł` for PL) instead of the muted "Currency unknown" fallback.

### Why

#358 wired persistence end-to-end (`product.currency` column + ORM + read API + FE glyph rendering), but `PrestashopProductMapper.mapProduct` emits `currency: null` as a deliberate placeholder — the previous hardcoded `'EUR'` was removed because it would be wrong for PL/PLN shops (the primary operator cohort). The plan at `docs/plans/implementation-plan-358-persist-product-currency.md` §Step 10 explicitly calls for #362 to land Option B. This PR closes that loop.

### Non-goals

- Shop auto-detect (Option C — fetch `PS_CURRENCY_DEFAULT` via PrestaShop webservice). Separate follow-up if operator friction proves too high.
- Multi-currency price lists per product.
- Currency on `ProductVariant`.
- Backfilling `null` currencies on existing rows — next sync populates them naturally.
- Currency-formatting changes on FE (already done in #358/#357).

### Layer classification

- **Integration**: `libs/integrations/prestashop/` — config type, mapper options, factory validation, mapper emit.
- **CORE boundary**: unchanged — `Product.currency: string | null` already accepts the value.
- **Frontend**: wizard Zod schema + form field + `toCreateConnectionInput()` mapping.
- **DX**: no new migrations, no new tokens, no new DI wiring.

---

## 2. Research — current state

### Mapper placeholder (the thing we're fixing)

`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts:33-35`:
```ts
// Null until a per-connection currency or shop auto-detect lands (#362).
// The previous 'EUR' hardcode would persist wrong values for PLN shops.
currency: null,
```

### Mapper options today

`libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.types.ts:17-26`:
```ts
export interface PrestashopProductMapperOptions {
  storefrontBaseUrl: string;
}
```

Injected via `PrestashopProductMapper` constructor (same file, line 20 of the mapper).

### Factory wiring

`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts:72-74`:
```ts
const productMapper = new PrestashopProductMapper({
  storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl,
});
```

`validateAndParseConfig()` at lines 143–264 parses config fields (`baseUrl`, `storefrontBaseUrl`, `shopId`, `langId`, `timeoutMs`, `pageSize`, `responseFormat`). No `currency` handling today.

### Connection config type

`libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts:16-82`:
```ts
export interface PrestashopConnectionConfig {
  baseUrl: string;
  storefrontBaseUrl?: string;
  shopId?: number;
  langId?: number;
  preferredLanguageId?: number;
  timeoutMs?: number;
  pageSize?: number;
  responseFormat?: 'auto' | 'json' | 'xml';
}
```

Pure TS interface — no `class-validator` decorators. Validation lives in the factory's `validateAndParseConfig` (manual checks).

### Wizard

- Schema: `apps/web/src/features/connections/components/prestashop-setup.schema.ts:28-64` — Zod object, exports `FormValues` + `toCreateConnectionInput()` at lines 78–96.
- Form: `apps/web/src/features/connections/components/prestashop-setup-form.tsx:146-215` — step 0 renders `name`, `baseUrl`, `storefrontBaseUrl`, `webserviceKey`, `shopId` via `FormField` + `Input`.
- Step gating: `STEP_FIELDS` at lines 53-58.

Pattern for a new config field:
1. Add to Zod schema + `STEP_FIELDS`
2. Render in the step-0 JSX with `FormField`
3. Map into `config` in `toCreateConnectionInput()`

### Existing mapper tests

`libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts` — 58 tests.
Line 40-51 contains:
```ts
it('should emit currency=null until a real source is wired up (#362)', () => {
  // ...
  expect(result.currency).toBeNull();
});
```
This test title becomes stale after this PR. Update it (semantics become "null when options.currency is undefined") + add a new test for "emits configured currency when options.currency is set".

### Factory spec exists

`libs/integrations/prestashop/src/application/__tests__/prestashop-adapter.factory.spec.ts` — good; we add currency-validation cases here.

### Integration-test seam

`apps/api/test/integration/products-read.int-spec.ts` already asserts `GET /products` surfaces `currency: 'PLN'` end-to-end via direct DB seed. That covers the "once it's persisted, the read API returns it" leaf. We don't need a new integration test for the mapper→DB→read path — the unit tests on the mapper + factory are sufficient to prove the wiring, and the existing integration test covers the read surface.

### ISO 4217 validation

No existing reusable validator. Will add `@Matches(/^[A-Z]{3}$/)` pattern in a new **config DTO class** (the first part of the codebase that does class-validator on the PS config object). Alternative is to keep validation purely in `validateAndParseConfig` — smaller surface, matches the file's existing style. Going with the latter for consistency (the PR already adds 5 new touchpoints; introducing a full DTO class would be scope creep). Zod schema on the FE mirrors the rule with `.regex(/^[A-Z]{3}$/)`.

### Factory error class (resolved)

`libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts` uses **`PrestashopConfigException`** for all 9+ field-validation failures (`baseUrl`, `shopId`, `langId`, `timeoutMs`, `pageSize`, `responseFormat`, etc.). The new `parseOptionalIsoCurrency` helper throws the same exception class — no new exception type.

### FE Select primitive (resolved)

`apps/web/src/shared/ui/select.tsx` is the project primitive (forwarded `<select>` with `control control--select` classes, `invalid` boolean prop). Precedent: `create-connection-form.tsx`, `EditConnectionForm.tsx`, `AllegroSetupForm.tsx`, `TriggerSyncDialog.tsx`, `CreateOfferWizard.tsx` all import `Select` from `shared/ui/select`. Use this primitive — do **not** drop a raw `<select className="input">` into the form.

### FE test seam (resolved)

`apps/web/src/features/connections/components/prestashop-setup-form.test.tsx` already exists — add the new cases there; no new file needed. Schema-level pure test of `toCreateConnectionInput()` is still the cleanest seat for the happy/absent-path assertions.

---

## 3. Design

### PrestashopConnectionConfig — new field

```ts
export interface PrestashopConnectionConfig {
  baseUrl: string;
  storefrontBaseUrl?: string;
  shopId?: number;
  langId?: number;
  preferredLanguageId?: number;
  timeoutMs?: number;
  pageSize?: number;
  responseFormat?: 'auto' | 'json' | 'xml';
  /**
   * Default ISO 4217 currency code for products synced from this PrestaShop
   * connection (e.g. 'PLN', 'EUR'). When unset, products persist `currency=null`
   * and the FE renders a muted "Currency unknown" fallback.
   *
   * @see {@link Product.currency} in `@openlinker/core`
   */
  currency?: string;
}
```

### PrestashopProductMapperOptions — new field

```ts
export interface PrestashopProductMapperOptions {
  storefrontBaseUrl: string;
  currency?: string;   // ISO 4217; undefined → emit null
}
```

### Mapper — currency emit

Replace the placeholder:
```ts
currency: this.options.currency ?? null,
```
Remove the `#362` comment since the issue is resolved by this PR.

### Factory — validation + wiring

In `validateAndParseConfig`, after the existing field parsers, add:

```ts
const currency = this.parseOptionalIsoCurrency(raw.currency);
```

Where `parseOptionalIsoCurrency` is a small private helper:

```ts
private parseOptionalIsoCurrency(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new PrestashopConfigException('currency must be a string');
  }
  const upper = raw.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) {
    throw new PrestashopConfigException(
      'currency must be a 3-letter ISO 4217 code (e.g., PLN, EUR)',
    );
  }
  return upper;
}
```

Matches the existing pattern — every `parse*` helper throws `PrestashopConfigException` with a single-string message (see the 9+ existing throws at lines 146–240 of `prestashop-adapter.factory.ts`).

Thread into mapper:

```ts
const productMapper = new PrestashopProductMapper({
  storefrontBaseUrl: config.storefrontBaseUrl ?? config.baseUrl,
  currency: config.currency,
});
```

### Wizard — schema addition

`prestashop-setup.schema.ts`. Goal: `FormValues` is `string | undefined` (so the `<Select>` can hold `''` as "not set") and `FormSubmission` is `string | undefined` (never `''`, so `toCreateConnectionInput` can trust truthiness). A `preprocess` collapses `''` → `undefined` before the regex fires:

```ts
currency: z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(
        z
          .string()
          .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 code (e.g., PLN, EUR, USD)'),
      ),
  )
  .optional(),
```

`toCreateConnectionInput` tail:
```ts
if (values.currency) {
  config.currency = values.currency;
}
```

After preprocess `values.currency` is either a validated 3-letter code or `undefined` — the redundant `.length > 0` guard drops out.

`STEP_FIELDS[0]` append `'currency'`.

### Wizard — form field

Between "Shop ID (optional)" and the end of step 0, add a new `FormField` wrapping the `Select` primitive from `shared/ui/select` (same primitive used by the sibling `create-connection-form.tsx` / `EditConnectionForm.tsx` / `AllegroSetupForm.tsx`). Options cover common ISO 4217 codes the issue lists: PLN, EUR, USD, GBP, CZK, HUF, plus SEK, NOK, DKK for Nordics, CHF for CH, RON for RO — aligns with OpenLinker's EU-first operator cohort.

```tsx
import { Select } from '../../../shared/ui/select';

<FormField
  label="Default currency (optional)"
  name="currency"
  error={form.formState.errors.currency?.message}
  description="Three-letter ISO 4217 code. Applied to all products synced from this PrestaShop connection. Leave blank to persist currency as unknown."
>
  <Select
    {...form.register('currency')}
    invalid={Boolean(form.formState.errors.currency)}
  >
    <option value="">— not set —</option>
    <option value="PLN">PLN — Polish Złoty</option>
    <option value="EUR">EUR — Euro</option>
    <option value="USD">USD — US Dollar</option>
    <option value="GBP">GBP — British Pound</option>
    <option value="CZK">CZK — Czech Koruna</option>
    <option value="HUF">HUF — Hungarian Forint</option>
    <option value="RON">RON — Romanian Leu</option>
    <option value="SEK">SEK — Swedish Krona</option>
    <option value="NOK">NOK — Norwegian Krone</option>
    <option value="DKK">DKK — Danish Krone</option>
    <option value="CHF">CHF — Swiss Franc</option>
  </Select>
</FormField>
```

### Testing

| Area | Test |
|---|---|
| Mapper | **Existing test updated** — rename from `should emit currency=null until a real source is wired up (#362)` to `should emit currency=null when options.currency is undefined`; keep assertion. |
| Mapper | **New** — `should emit options.currency when set` — construct mapper with `currency: 'PLN'`, assert `result.currency === 'PLN'`. |
| Factory | **New** — `validateAndParseConfig rejects currency with wrong length / wrong case / non-string`. |
| Factory | **New** — `validateAndParseConfig accepts 'PLN' and normalises lowercase 'pln' to 'PLN'`. |
| Factory | **New** — `createAdapters passes config.currency into the product mapper options`. |
| Wizard schema | **New** — `prestashop-setup.schema.ts` spec (if one exists) or a schema-focused test inside the form component's test. |
| Wizard form | **New** — `prestashop-setup-form.test.tsx` — if file exists, add a case. Otherwise fold in as a simple validation-message assertion via existing connection-wizard test. |

No new integration test — `products-read.int-spec.ts` already validates the read surface for arbitrary persisted currency values; the unit tests above prove the mapper & factory wiring. The issue's "integration test" bullet is satisfiable at the unit-test layer given that existing integration coverage already exercises the persistence→read path.

### Docs

No architecture-overview or engineering-standards change. This is a single-integration config extension; the pattern matches existing config fields (`shopId`, `langId`, etc.) which aren't documented individually either.

---

## 4. Step-by-step implementation

### Step 1 — Extend `PrestashopConnectionConfig` type

**File:** `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`
Add optional `currency?: string` field with JSDoc referencing #362/#358.

**Acceptance:** `pnpm type-check` passes.

### Step 2 — Extend `PrestashopProductMapperOptions` type

**File:** `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.types.ts`
Add optional `currency?: string`.

**Acceptance:** `pnpm type-check` passes.

### Step 3 — Update mapper to emit configured currency

**File:** `libs/integrations/prestashop/src/infrastructure/mappers/prestashop-product.mapper.ts`
Replace `currency: null` + the #362 comment with `currency: this.options.currency ?? null,`.

**Acceptance:** `pnpm --filter @openlinker/integrations-prestashop type-check` passes.

### Step 4 — Factory: validate `config.currency` + pass to mapper

**File:** `libs/integrations/prestashop/src/application/prestashop-adapter.factory.ts`
- Add private `parseOptionalIsoCurrency(raw: unknown): string | undefined` helper that normalises case and validates ISO 4217 format. Throws `PrestashopConfigException` — the same class used by the 9+ existing `parse*` helpers (lines 146–240).
- In `validateAndParseConfig`: call `parseOptionalIsoCurrency(raw.currency)` and include `currency` in the returned parsed config object.
- In `createAdapters`: pass `currency: config.currency` into the `PrestashopProductMapper` constructor call at lines 72–74.

**Acceptance:** `pnpm --filter @openlinker/integrations-prestashop type-check` passes.

### Step 5 — Update mapper spec + add new case

**File:** `libs/integrations/prestashop/src/infrastructure/mappers/__tests__/prestashop-product.mapper.spec.ts`
- Rename existing test at lines 40-51 to `should emit currency=null when options.currency is undefined`; keep assertion.
- Add adjacent `should emit options.currency when set` test: instantiate mapper with `currency: 'PLN'`, assert `result.currency === 'PLN'`.

**Acceptance:** `pnpm --filter @openlinker/integrations-prestashop test prestashop-product.mapper` — both tests pass.

### Step 6 — Factory spec: currency validation + wiring

**File:** `libs/integrations/prestashop/src/application/__tests__/prestashop-adapter.factory.spec.ts`
Add five test cases under the existing `validateAndParseConfig` describe block — all rejection assertions check the thrown exception is a `PrestashopConfigException`:
- accepts `currency: 'PLN'` → parsed config has `currency: 'PLN'`
- accepts `currency: 'pln'` → normalised to `'PLN'`
- rejects `currency: 'pl'` → `PrestashopConfigException` with message mentioning ISO 4217
- rejects `currency: 123` → `PrestashopConfigException` with message mentioning "must be a string"
- absent `currency` → parsed config has `currency: undefined`

Plus two end-to-end wiring cases under the `createAdapters` describe (stable public-contract assertion — no constructor spying or private-field peeking):
- `config.currency: 'PLN'` + fixture PS product payload → `ProductMaster.getProduct(...).currency === 'PLN'`
- absent `config.currency` + same fixture → `result.currency === null`

**Acceptance:** `pnpm --filter @openlinker/integrations-prestashop test prestashop-adapter.factory` — all new cases pass.

### Step 7 — Wizard: Zod schema + config mapping

**File:** `apps/web/src/features/connections/components/prestashop-setup.schema.ts`
- Add `currency` to the Zod object using the `preprocess(''→undefined) → trim/uppercase → .pipe(regex)` pattern from §3 (keeps `FormSubmission` as `string | undefined`, never `''`).
- Add `'currency'` to `STEP_FIELDS[0]` array.
- Append `if (values.currency) config.currency = values.currency;` to `toCreateConnectionInput()` — the preprocess guarantees truthiness is sufficient.

**Acceptance:** `pnpm --filter @openlinker/web type-check` passes.

### Step 8 — Wizard: form field

**File:** `apps/web/src/features/connections/components/prestashop-setup-form.tsx`
Insert a new `FormField` wrapping the **`Select` primitive** from `shared/ui/select` (not a raw `<select>`) after the Shop ID field in step 0 — matches the precedent set by `create-connection-form.tsx`, `EditConnectionForm.tsx`, and `AllegroSetupForm.tsx`. Options: 11 ISO codes from §3 plus a `— not set —` placeholder. Pass `invalid={Boolean(form.formState.errors.currency)}` to the `Select`.

**Acceptance:** `pnpm --filter @openlinker/web type-check` passes; `pnpm --filter @openlinker/web lint` clean.

### Step 9 — Wizard: form test coverage

**File:** `apps/web/src/features/connections/components/prestashop-setup-form.test.tsx` (already exists — confirmed in §2 Research).

Add two cases exercising the pure `toCreateConnectionInput()` function (no DOM needed for these — they're schema assertions):
- **Happy path:** `values.currency = 'PLN'` → `config.currency === 'PLN'`.
- **Absent path:** `values.currency` undefined (preprocess collapses `''` → `undefined`) → `config.currency` is absent from the output config object (not set to `''` or `undefined`).

**Invalid-path test is skipped on FE** — the `Select` primitive constrains values to the option set; any manually crafted invalid value would be rejected server-side by Step 6's factory validation.

**Acceptance:** `pnpm --filter @openlinker/web test prestashop-setup-form` — new cases pass.

### Step 10 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:integration        # api side (validates no regression)
```

All must pass. Integration not mandatory here (no integration code path changed — mapper is unit-level, factory is unit-level, wizard is FE) but run it anyway for end-to-end sanity. Worker integration: skip unless a touched file consumes worker helpers (none do).

### Step 11 — Commit + push + PR

Single commit. Conventional message:
```
feat(prestashop): per-connection currency config threads through to synced products

Closes #362
```

Push + create PR against `main`.

---

## 5. Validation

### Architecture compliance

- ✅ No CORE/Integration boundary crossed the wrong way. The field lives entirely in the PrestaShop adapter package (`libs/integrations/prestashop/`); CORE's `Product.currency` already accepts `string | null`.
- ✅ Domain layer stays pure — `PrestashopConnectionConfig` is a `*.types.ts` interface with no framework imports.
- ✅ Factory validation pattern matches existing fields; no new exception class needed.
- ✅ Wizard uses the documented Zod + React Hook Form + `FormField` + `toCreateConnectionInput()` pattern — same shape as `shopId` and `storefrontBaseUrl`.

### Naming

- `currency` — plain field name, matches the domain column name from #358.
- `parseOptionalIsoCurrency` — matches the factory's `parse{Field}` helper convention.

### Testing

- Mapper spec: one existing test repurposed, one new test added.
- Factory spec: five new cases covering normalisation, rejection, and wiring.
- Wizard: happy + absent paths covered at the schema layer (DOM layer if a form test file already exists).
- No integration test needed — existing `products-read.int-spec.ts` proves the persistence→read surface; unit tests prove config→mapper wiring.

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Existing PS connections without `currency` regress | `currency` is optional; absent → mapper emits `null` (today's behaviour exactly). Zero regression. |
| Operator enters wrong ISO code | Wizard's `<select>` constrains to the option list. Server-side factory validation catches anything slipping past via direct API calls. |
| Factory `createAdapters` asserts on unexpected shape | Existing fields already pass through without issue; new field follows the same pattern. |
| Stored currency drifts from PrestaShop shop reality | Out of scope for this PR. Option C (auto-detect) is the next step if operator friction proves high. |
| Select `<option>` list grows over time / i18n | Keep it small for MVP (11 codes covering OpenLinker's expected operator cohort). Native `<select>` makes it trivial to extend. If we ever need a full ISO 4217 list with search, that's a future `CurrencyPicker` primitive, not this PR. |

### Open questions — none

The issue body is explicit about Option B; `#358`'s plan §Step 10 pre-approved the scope; the repo's form and factory patterns dictate the implementation shape.

---

## 6. Estimate

~45 min end-to-end:
- 10 min — Steps 1–4 (type + factory + mapper wiring)
- 10 min — Steps 5–6 (mapper + factory specs)
- 10 min — Steps 7–8 (wizard schema + form field)
- 5 min — Step 9 (wizard test coverage)
- 10 min — Steps 10–11 (quality gate + commit + PR)
