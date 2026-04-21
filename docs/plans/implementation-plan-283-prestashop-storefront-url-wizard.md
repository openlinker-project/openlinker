# Implementation Plan — #283 storefrontBaseUrl FE wizard field

## 1. Goal

Add the optional `storefrontBaseUrl` field to both the PrestaShop create-connection wizard and the edit-connection form. The backend field shipped in #271 — the API is forgiving (absent/empty → adapter falls back to `baseUrl`), so this is purely the operator UX affordance for the split-host case (webservice URL ≠ public storefront URL).

**Layer:** Frontend
**Scope:** two schemas, two form components, two test files
**Non-goals:**
- Live validation that the storefront URL actually serves PrestaShop image paths (out of scope per issue).
- Adding the pattern to non-PrestaShop connection types.
- Any backend work — the config field, factory fallback, and credentials plumbing are already live in `main` (see `c5891bb`).

## 2. What's already true

**Create wizard** — `apps/web/src/features/connections/components/`
- `prestashop-setup.schema.ts` defines `prestashopSetupSchema` (Zod) plus `toCreateConnectionInput()` and `PRESTASHOP_SETUP_DEFAULT_VALUES`. `shopId` is the existing precedent for an optional PrestaShop-specific config field that is only persisted when non-empty.
- `prestashop-setup-form.tsx` drives a 4-step wizard. Step 0 fields are in `STEP_FIELDS[0]`; Steps 1 and 3 show review lists using a `wizard-review-list` `dl`. `shopId` is conditionally rendered there (only when set).

**Edit form** — same directory
- `edit-connection.schema.ts` has `editConnectionSchema` + `mergeStructuredIntoConfig()`. `StructuredField` type union lives inline in `EditConnectionForm.tsx` and currently has three members: `baseUrl | shopId | masterCatalogConnectionId`. The "delete on empty string" behaviour is explicit in `mergeStructuredIntoConfig`.
- `EditConnectionForm.tsx` gates the PrestaShop-structured inputs under `platformBranch === 'prestashop'`. The pattern for each structured field is: `form.watch(field)` + `syncStructuredToJson(field, value)` + `FormField` with `disabled={!configIsParseable}`.

**Tests**
- `prestashop-setup-form.test.tsx` — 5 component tests, advances through the wizard with `fillCredentialsStep` + `advanceToStep` helpers. The `shopId` happy-path is the nearest template.
- `edit-connection.schema.test.ts` — covers `mergeStructuredIntoConfig` only. Schema-level Zod validation is currently exercised only indirectly through the component. The issue asks for direct schema tests — we'll add them here and keep the style consistent with the helper tests.

## 3. Changes

### 3.1 `prestashop-setup.schema.ts`

- Add `storefrontBaseUrl` to the Zod schema using the same `union([z.url(...), z.literal('')]).optional()` pattern as the issue spec. Keep the error messages verbatim from the issue so we don't drift from the acceptance criteria:
  ```ts
  storefrontBaseUrl: z
    .union([
      z.url('Storefront URL must be a valid URL').refine(
        (v) => v.startsWith('http://') || v.startsWith('https://'),
        'Storefront URL must use http:// or https://',
      ),
      z.literal(''),
    ])
    .optional(),
  ```
- Extend `PRESTASHOP_SETUP_DEFAULT_VALUES` with `storefrontBaseUrl: ''`.
- In `toCreateConnectionInput`, mirror the `shopId` branch: only set `config.storefrontBaseUrl` when the trimmed value is non-empty. Keep the existing `baseUrl`-first ordering so the API payload reads naturally.

### 3.2 `prestashop-setup-form.tsx`

- Extend `STEP_FIELDS[0]` to include `'storefrontBaseUrl'` so the Zod error surfaces on Next (not only on final submit).
- Add a `FormField` in Step 0 directly below the Shop URL field, with the helper text the issue specifies: *"Override only if your public storefront URL is different from the webservice URL. Leave blank if they're the same — defaults to Shop URL."*
- Conditionally render the value in Step 1 (`Verify credentials` `dl`) and Step 3 (final review `dl`) using the same pattern as `shopId` — only when the value is non-empty.

### 3.3 `edit-connection.schema.ts`

- Add `storefrontBaseUrl` to `editConnectionSchema` with the same Zod pattern (union of validated URL + empty string, optional).
- Extend `mergeStructuredIntoConfig`'s `structured` parameter type with `storefrontBaseUrl?: string` and add a parallel branch that deletes on `""` and writes otherwise (identical to the `baseUrl`/`shopId` branches).

### 3.4 `EditConnectionForm.tsx`

- Extend the inline `StructuredField` type union to include `'storefrontBaseUrl'`.
- Add to the form's `defaultValues`: `storefrontBaseUrl: readString(connection.config, 'storefrontBaseUrl')` — `readString` already returns `''` for missing/non-string values, which is what we want.
- In the `platformBranch === 'prestashop'` block, add a `FormField` right below Shop URL with the same helper text as the create wizard. Wire it through `syncStructuredToJson('storefrontBaseUrl', ...)` just like `baseUrl` and `shopId`.
- No `mergeStructuredIntoConfig` caller change needed — `syncStructuredToJson` already passes through the field name.

### 3.5 `prestashop-setup-form.test.tsx`

Three new tests after the existing `shopId` test:

1. **Persists a valid `storefrontBaseUrl`** — when provided, it appears verbatim in the created `config.storefrontBaseUrl`.
2. **Omits the key when blank** — no `storefrontBaseUrl` property in the final `config` (asserts via `expect.not.objectContaining`).
3. **Blocks advancing on invalid URL** — `storefrontBaseUrl: 'not-a-url'` keeps the wizard on Step 0 and surfaces the Zod error (mirror the existing `baseUrl` invalid-URL test).

### 3.6 `edit-connection.schema.test.ts`

Two new `describe` blocks:

1. **`editConnectionSchema`** — direct Zod tests: empty string passes, omitted passes, valid URL passes, garbage (e.g. `'not-a-url'`) fails with the specified message.
2. **`mergeStructuredIntoConfig` + `storefrontBaseUrl`** — add two cases to the existing describe block: writes on non-empty, deletes on empty string. Follows the existing `baseUrl`/`shopId` precedent to a T.

## 4. Acceptance (from the issue)

- [x] Operator can set `Storefront URL (optional)` in both create and edit forms for PrestaShop connections.
- [x] Blank field → config has no `storefrontBaseUrl` key.
- [x] Invalid URL blocks Step 1 advance (create) and form submit (edit).
- [x] Existing connections without the field continue to work; the input renders empty (via `readString`).
- [x] `pnpm lint && pnpm type-check && pnpm test` pass.

## 5. Quality gate

```bash
pnpm --filter @openlinker/web test -- prestashop-setup-form.test
pnpm --filter @openlinker/web test -- edit-connection.schema.test
pnpm lint
pnpm type-check
pnpm test  # full web + backend unit suites to confirm nothing collateral broke
```

## 6. Risks

- **Zod v4 `z.url()`** — already in use in this schema for `baseUrl`, so no version concern. The `union([z.url(), z.literal('')])` pattern matches the existing `masterCatalogConnectionId` precedent.
- **Review `dl` rendering** — The wizard's Step 1/3 `dl` uses `<dt>/<dd>` pairs inside a single `<dl>`. Adding a conditional pair mirrors the existing `shopId` conditional exactly. Low risk.
- **`configText` round-trip in edit form** — `syncStructuredToJson` already merges through `mergeStructuredIntoConfig` and re-serializes. As long as we extend the helper consistently, raw-JSON-view users never lose the new key. Covered by the schema test.
- **Schema error message exact-matching** — The issue spec quotes `'Storefront URL must be a valid URL'` and `'Storefront URL must use http:// or https://'`. We'll preserve these strings verbatim so future test copy-paste from the issue still works.

## 7. Out of scope

- Per issue: no probe of the storefront URL (the `/test` endpoint only checks webservice auth).
- Per issue: field is PrestaShop-specific — no generalisation to other platforms.
- Not extracting a shared "optional URL" Zod helper — the pattern recurs only twice in this file, three times after this PR. Extraction belongs in a focused refactor if a 4th instance appears.
