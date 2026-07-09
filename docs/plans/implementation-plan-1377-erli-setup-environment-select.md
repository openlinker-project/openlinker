# Implementation Plan — Erli setup wizard: environment select instead of free-text Base URL (#1377)

## 1. Task

Replace the free-text "Base URL (optional)" input in the Erli connection wizard with a two-option `Select` (Production / Sandbox), since only two valid base URLs exist and both are already enforced server-side by `ERLI_ALLOWED_BASE_URL_HOSTS`.

**Layer**: Frontend (Interface: FE form/schema) + small Integration constant export (Domain types).
**Non-goals**: no change to `erli-base-url.policy.ts` / validation, no change to the edit-connection flow (create-wizard only, per issue's own scoping).

## 2. Existing patterns reused

- `inpost-setup-form.tsx` / `inpost-setup.schema.ts` already use `environment: z.enum(['sandbox', 'production'])` + `<Select>` — same shape, copied directly.
- `apps/web` has no path alias into `libs/integrations/*`, so the sandbox URL literal is duplicated in the FE schema with a comment cross-referencing the BE constant (per the issue's own fallback instruction).

## 3. Steps

1. **`libs/integrations/erli/src/domain/types/erli-connection.types.ts`** — add `export const ERLI_SANDBOX_BASE_URL = 'https://sandbox.erli.dev/svc/shop-api';` next to `ERLI_DEFAULT_BASE_URL`.
2. **`apps/web/src/features/connections/components/erli-setup.schema.ts`**:
   - Replace `baseUrl` union field with `environment: z.enum(['production', 'sandbox'])` (`as const` values array).
   - Update `ERLI_SETUP_DEFAULT_VALUES` → `environment: 'production'`.
   - Update `toCreateConnectionInput`: `sandbox` → `config.baseUrl = ERLI_SANDBOX_BASE_URL_LITERAL` (local literal + comment pointing at `erli-connection.types.ts`); `production` → omit `config.baseUrl`.
3. **`apps/web/src/features/connections/components/erli-setup-form.tsx`** — replace the `<Input>` block (Base URL) with a `<Select>` with two `<option>`s ("Production — https://erli.pl", "Sandbox — https://sandbox.erli.dev").
4. **`apps/web/src/features/connections/components/erli-setup-form.test.tsx`** — update:
   - "renders the required form fields" → assert Environment select instead of Base URL input.
   - Remove the HTTPS-rejection test (field no longer free-text).
   - "omits config when no base URL is given" → default (production) submit path, `config: {}`.
   - "includes baseUrl in config when supplied" → select Sandbox, assert `config: { baseUrl: 'https://sandbox.erli.dev/svc/shop-api' }`.

## 4. Acceptance criteria (from issue)

- [ ] Select with exactly two options, Production default-selected, no free-text URL field.
- [ ] Production submit → no `baseUrl` key in `config`.
- [ ] Sandbox submit → `config.baseUrl = 'https://sandbox.erli.dev/svc/shop-api'`.
- [ ] `ERLI_SANDBOX_BASE_URL` constant added next to `ERLI_DEFAULT_BASE_URL`.
- [ ] Tests updated for the select interaction and both submit paths.
- [ ] No architecture boundary violations.

## 5. Risk / validation

Trivial, single-context (FE) change with one BE constant addition — no cross-context contract surface touched, no DI/tokens/migrations involved. Pre-implement gate skipped as unnecessary for a change this size and this well-specified (issue already enumerates every touched file).
