# Implementation plan — mapping-options resilience (#483 + #484)

## 1. Goal

Two issues, one PR. Together they close the loop on the operator-facing outage caught by the screenshot in the recent investigation:

- **#483** — `PrestashopOrderProcessorManagerAdapter.listPaymentMethods` calls `GET /api/modules` which is **not** exposed via the PrestaShop Webservice for typical API keys. PrestaShop responds with `400 Bad Request` listing the alphabetised set of resources the key *does* have access to (`taxes`, `translated_configurations`, `warehouses`, `weight_ranges`, `zones`) — `modules` isn't in it. Introduced by PR #476 (#472 + #473) when the hardcoded stub was replaced with a live call.
- **#484** — `useMappingOptions` runs 6 parallel queries and surfaces a single `error: Error | null`. The page renders one `ErrorState` for the whole tab strip on *any* failure, blocking the operator from configuring **Order Statuses** or **Carriers** when only **Payments** failed.

**Layers:** BE Integration (PrestaShop adapter) + FE feature (`useMappingOptions` hook + `connection-mappings-page` composition). No CORE / Domain change.

**Non-goals**
- BE: live probing `/api/modules` first with fallback (issue option **(b)**) is rejected — extra code path for marginal benefit, the curated list is the right primary path.
- FE: a "retry this panel" UI affordance — out of scope; the page already invalidates queries via the standard TanStack `refetch`, and a per-panel retry button is a follow-up if operators ask for it.

## 2. Codebase research

### BE side

- **Site to replace:** `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts:672`. Today's implementation actually has more sophistication than the issue body suggested — it tries a `is_payment_module` / `tab === 'payments_gateways'` heuristic and falls back to "include all active modules" if neither indicator is present. None of that helps because `/api/modules` itself returns 400 before any rows arrive.
- **Sibling pattern to mirror:** `libs/integrations/allegro/src/domain/types/allegro-payment-type.types.ts` exports `ALLEGRO_PAYMENT_TYPE_OPTIONS: ReadonlyArray<MappingOption>` with a *captured-on-date* header comment and is consumed via `Promise.resolve([...ALLEGRO_PAYMENT_TYPE_OPTIONS])` in `AllegroOrderSourceAdapter.listPaymentMethods` (line 340-342). This is the established convention for "marketplace doesn't expose a live endpoint, use a curated list".
- **Connection config plumbing:** `PrestashopConnectionConfig` (`libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`) is the home for connection-level overrides. Sibling field `defaultCarrierId?: number` shows the docstring style — it documents the resolution chain inline. The adapter accesses it as `this.connection.config as unknown as PrestashopConnectionConfig`.

### FE side

- **Hook:** `apps/web/src/features/mappings/hooks/use-mapping-options.ts` — single `error: Error | null` from `firstError` flattening. 70 lines, clean.
- **Existing test:** `apps/web/src/features/mappings/hooks/use-mapping-options.test.tsx` already has 2 cases, including one (`surfaces the first error when any side fails to load`) that asserts the old single-error shape. Needs rewriting for the new per-key shape.
- **Page composition:** `apps/web/src/pages/connections/connection-mappings-page.tsx:36, 53-58, 127-128, 144-145, 161-162` — page-level `ErrorState` short-circuits at line 53, then each `MappingPanel` is also passed the same `optionsError`. Both layers need attention: drop the page-level short-circuit, derive a per-panel `optionsError` for each panel.
- **MappingPanel today:** already renders its own `ErrorState` when `optionsError !== null` (`apps/web/src/features/mappings/components/MappingPanel.tsx:99-101`). No changes needed to the panel itself — the per-panel error already works at panel scope.

### Test plumbing

- Hook tests use `renderHook` + `QueryClientProvider` + `ApiClientProvider` (existing pattern in the test file).
- For the page composition, `renderWithProviders` from `apps/web/src/test/test-utils.tsx` is the right wrapper if I add a page-level test. Probably skip page-level tests for this PR — the hook test is where the partial-failure invariant lives, the panel rendering is already covered by `MappingPanel.test.tsx`.

## 3. Design

### BE — `PRESTASHOP_PAYMENT_MODULES` curated list + per-connection override

Drop the live `/api/modules` call entirely. Replace with:

```ts
// libs/integrations/prestashop/src/domain/types/prestashop-payment-module.types.ts (new)
export const PRESTASHOP_PAYMENT_MODULES: ReadonlyArray<MappingOption> = [
  // Native PS modules
  { value: 'ps_wirepayment', label: 'Bank wire transfer (ps_wirepayment)' },
  { value: 'ps_checkpayment', label: 'Cheque (ps_checkpayment)' },
  { value: 'ps_cashondelivery', label: 'Cash on delivery (ps_cashondelivery)' },
  // Common Polish-market modules (priority — primary OL audience)
  { value: 'przelewy24', label: 'Przelewy24' },
  { value: 'tpay', label: 'Tpay' },
  { value: 'payu', label: 'PayU' },
  { value: 'bluepayment', label: 'Blue Media (BluePayment)' },
  { value: 'paynow', label: 'Paynow (mBank)' },
  { value: 'imoje', label: 'imoje (ING)' },
  // Common international modules
  { value: 'paypal', label: 'PayPal' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'klarna', label: 'Klarna' },
  { value: 'adyen', label: 'Adyen' },
];
```

`MappingOption` is the existing `{ value: string; label: string }` shape from `@openlinker/core/orders`.

Extend `PrestashopConnectionConfig` with a per-connection override:

```ts
/**
 * Additional PrestaShop payment-module names installed on this connection's
 * shop that aren't in the curated `PRESTASHOP_PAYMENT_MODULES` list. Each
 * entry is a module's technical name (matches the `payment` field on
 * PrestaShop orders, e.g. `'custom_module_xyz'`).
 *
 * The adapter's `listPaymentMethods` returns `[...curated, ...override]`,
 * deduped by `value`. Use this when an operator's shop has a payment module
 * that's not common enough to bake into the curated list.
 */
paymentModuleOverrides?: string[];
```

Adapter implementation:

```ts
async listPaymentMethods(): Promise<MappingOption[]> {
  const config = this.connection.config as unknown as PrestashopConnectionConfig;
  const override = config.paymentModuleOverrides ?? [];
  if (override.length === 0) {
    return [...PRESTASHOP_PAYMENT_MODULES];
  }
  // Dedup by value: curated entries win over identical-value overrides.
  const seen = new Set(PRESTASHOP_PAYMENT_MODULES.map((m) => m.value));
  const extra = override
    .filter((name) => !seen.has(name))
    .map((name) => ({ value: name, label: name }));
  return [...PRESTASHOP_PAYMENT_MODULES, ...extra];
}
```

Then strip the unused helpers `isTruthy` / `flattenLanguageField` *only if no other method uses them* — `flattenLanguageField` is shared with `listOrderStatuses` and probably `listCarriers`, so leave both helpers alone. The dead code is just the heuristic block inside `listPaymentMethods` and the `PrestashopModule` import (verify there are no other callers before removing the type import).

The `PrestashopModule` type itself can stay in `prestashop-options.types.ts` for now — removing it is a clean follow-up if no other code uses it.

### FE — `useMappingOptions` errors record + per-panel composition

```ts
// apps/web/src/features/mappings/hooks/use-mapping-options.ts (refactored)
interface UseMappingOptionsResult {
  options: MappingOptions;
  isLoading: boolean;
  errors: Partial<Record<keyof MappingOptions, Error>>;
}

export function useMappingOptions(connectionId: string): UseMappingOptionsResult {
  const apiClient = useApiClient();
  const results = useQueries({
    queries: QUERY_SPEC.map(({ side, kind }) => ({
      queryKey: mappingsQueryKeys.option(connectionId, side, kind),
      queryFn: () => apiClient.mappings.getMappingOptions(connectionId, side, kind),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const options: MappingOptions = { ...EMPTY_OPTIONS };
  const errors: Partial<Record<keyof MappingOptions, Error>> = {};
  results.forEach((result, index) => {
    const { bundleKey } = QUERY_SPEC[index];
    options[bundleKey] = result.data ?? [];
    if (result.error instanceof Error) {
      errors[bundleKey] = result.error;
    }
  });

  return { options, isLoading, errors };
}
```

Page composition derives per-panel error from the relevant source/destination keys:

```ts
// connection-mappings-page.tsx — minimal diff
const { options, isLoading: optionsLoading, errors } = useMappingOptions(connectionId);

// Drop the page-level optionsError short-circuit (today's lines 53-58).
// Derive each panel's error from its two relevant bundle keys.
const statusOptionsError = errors.allegroOrderStatuses ?? errors.prestashopOrderStatuses ?? null;
const carrierOptionsError = errors.allegroDeliveryMethods ?? errors.prestashopCarriers ?? null;
const paymentOptionsError = errors.allegroPaymentProviders ?? errors.prestashopPaymentModules ?? null;
```

Then pass the panel-specific `*OptionsError` into each `MappingPanel`'s `optionsError` prop. Order Statuses + Carriers stay interactive when Payments has a 400; the operator can save their carrier work and revisit Payments later.

The `loadError` for the saved-mappings (status/carrier/payment row queries) can keep the page-level short-circuit — those are different queries (not the options endpoints), and a failure to fetch *saved mappings* genuinely means the page can't render in any meaningful way.

### Why drop the page-level options short-circuit

Today's behaviour: any options query fails → `<ErrorState>` covers the entire tab strip. After: any options query fails → only the affected panel renders the error inline; the other panels work normally. This matches `frontend-architecture.md` "every list and detail screen should render loading, empty, error, and success-aware states deliberately" — the page-level error was conflating two scopes.

## 4. Step-by-step plan

### Step 1 — BE: curated list module

**File:** `libs/integrations/prestashop/src/domain/types/prestashop-payment-module.types.ts` (new)
- Export `PRESTASHOP_PAYMENT_MODULES: ReadonlyArray<MappingOption>` with a captured-on-date header (matching the Allegro payment-type sibling).
- 12-ish entries: 3 native PS, 6 PL-market, 4 international.

**Acceptance:** module compiles; values are unique; header comment documents the curation date and override mechanism.

### Step 2 — BE: connection-config override field

**File:** `libs/integrations/prestashop/src/domain/types/prestashop-config.types.ts`
- Add optional `paymentModuleOverrides?: string[]` with a docstring explaining how it composes with the curated list.

**Acceptance:** type compiles; existing `PrestashopConnectionConfig` consumers unaffected (additive optional field).

### Step 3 — BE: rewrite `listPaymentMethods`

**File:** `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts`
- Replace lines 672–699 with the new curated-list + override implementation.
- Remove the `PrestashopModule` import only if no other method uses it (likely safe, but verify with grep).
- No HTTP call; no logger noise.

**Acceptance:** type-check green; no `/api/modules` reference remains.

### Step 4 — BE tests

**File:** `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.spec.ts` (or wherever the existing tests live — verify before editing)
- New `describe('listPaymentMethods (#483)')`:
  - Returns the curated list verbatim when `paymentModuleOverrides` is absent / empty.
  - Appends override entries to the curated list when present.
  - Dedupes: an override entry whose `value` matches a curated `value` is dropped (curated wins for label consistency).
  - Does **not** make any HTTP call — assert the http client mock wasn't invoked.

**Acceptance:** 4 tests pass; `pnpm --filter @openlinker/prestashop test` green; existing tests for the adapter still pass.

### Step 5 — FE: refactor `useMappingOptions`

**File:** `apps/web/src/features/mappings/hooks/use-mapping-options.ts`
- Rename `error: Error | null` → `errors: Partial<Record<keyof MappingOptions, Error>>` in `UseMappingOptionsResult`.
- Drop the `firstError` flattening; populate `errors` per bundle key in the existing `forEach`.
- Drop the `if (isLoading) return { options: EMPTY_OPTIONS, ... }` early return — it's redundant once `errors` accumulates per-key (an in-flight query has no error yet, so `errors[key]` is just absent).

**Acceptance:** type compiles; existing single-success test still passes after adjusting the assertion from `result.current.error` to `result.current.errors`.

### Step 6 — FE: rewrite the failing-side test

**File:** `apps/web/src/features/mappings/hooks/use-mapping-options.test.tsx`
- Rewrite the second case ("surfaces the first error when any side fails to load") as "isolates per-bundle errors" — assert that `result.current.errors.allegroDeliveryMethods` is the rejection error, while `result.current.errors.prestashopCarriers` is `undefined` (i.e., other queries succeeded).
- Add a new case: "all queries succeed" — assert `result.current.errors` is `{}`.
- Add a new case: "two of six fail" — assert exactly those two keys are present in `errors`, the other four bundle keys have data.

**Acceptance:** 4 hook tests pass.

### Step 7 — FE: page composition

**File:** `apps/web/src/pages/connections/connection-mappings-page.tsx`
- Replace `error: optionsError` with `errors` from the hook.
- Drop the `if (loadError) return <ErrorState>` block at lines 53-58 *only* for the options error path. Keep it for `loadError` (which comes from the `useStatusMappingsQuery` etc. saved-row queries — that's a different scope).
- Wait — re-reading: line 43's `loadError` is the saved-row error, line 36's `optionsError` is the options error. Today's page-level `if (loadError)` only short-circuits on saved-row errors. The options error currently leaks through to all 3 panels via `optionsError={optionsError}`. So actually no page-level short-circuit needs to change — it's already not there for options. The fix is purely in how each panel's `optionsError` prop is computed.
- Compute three per-panel error variables: `statusOptionsError`, `carrierOptionsError`, `paymentOptionsError`.
- Pass each into the matching `MappingPanel`'s `optionsError` prop.

**Acceptance:** type-check green; manual verification (next step) shows partial failure isolated to the affected panel.

### Step 8 — Quality gate

```
pnpm --filter @openlinker/prestashop lint
pnpm --filter @openlinker/prestashop type-check
pnpm --filter @openlinker/prestashop test
pnpm --filter @openlinker/web lint
pnpm --filter @openlinker/web type-check
pnpm --filter @openlinker/web test
```

All clean. The pre-commit hook runs the relevant scoped suites — verify it stays green.

## 5. Validation

- **Architecture (BE):** curated list is a `domain/types` module — no framework deps, no I/O. Adapter still implements the existing `OrderProcessorManagerPort`; `listPaymentMethods` signature unchanged. Hexagonal boundary preserved.
- **Architecture (FE):** hook still under `features/mappings/hooks`. Page composition stays in `pages/connections`. Dep direction `pages → features → shared` preserved.
- **Naming (BE):** module name `prestashop-payment-module.types.ts` mirrors `allegro-payment-type.types.ts`. Export is SCREAMING_SNAKE per project convention for runtime-arrays.
- **Naming (FE):** hook return type renamed `error → errors` (plural, record-shaped). Local page-level vars `*OptionsError` mirror the existing `optionsError` prop name.
- **Testing:** BE adapter test covers curated/override/dedup/no-HTTP. FE hook test covers all-success / partial-failure / total-failure. No integration test needed (no DB / Nest wiring change).
- **Security:** no user-rendered HTML, no auth duplication. The override field is a configured string list, not user input rendered as HTML.
- **Migration:** none. The connection-config field is additive optional; existing connections work unchanged with the curated list.

## 6. Risks & open questions

- **Curated-list staleness.** Polish PrestaShop ecosystem ships new payment modules occasionally (recent example: `paynow` in 2023, `imoje` ramp). The header comment commits to a curation date; future updates are a single-file edit + a commit. Acceptable for a list that's expected to grow by ~1 entry per quarter.
- **Override visibility.** Operators with a non-curated module need to know they can add it via `paymentModuleOverrides`. The connection-config UI today doesn't have a list-of-strings editor for arbitrary fields. For this PR, the override is set via direct DB / connection-config-API edit — acceptable for a workaround. A "manage payment modules" UI is a follow-up if friction shows up.
- **Existing connections.** If anyone has a saved payment mapping pointing at a module name that's not in the curated list and not in their override list, the saved mapping still resolves at order-create time (the resolver reads the saved mapping by exact `payment` string match — the dropdown only matters for *adding* mappings). So the curated list doesn't break existing data; it just constrains the add-row dropdown.
