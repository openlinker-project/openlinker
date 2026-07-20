# Implementation Plan - WooCommerce setup wizard with capability selection (#1727)

## 1. Goal

Convert the single-step WooCommerce connection creation form into a 4-step setup wizard
(mirroring the PrestaShop wizard) with a Capabilities step, and enforce the
`InventoryMaster` x `OfferManager` mutual exclusivity in both the wizard and the
edit-time `ConnectionCapabilitiesPanel`. Today the form silently submits the adapter's
full `supportedCapabilities` set, which contains the mutually exclusive pair, so every
create attempt 400s.

**Layer**: Frontend only (`apps/web`, `features/connections`). No backend changes -
the BE 400 remains the authoritative guard.

**Non-goals**: no changes to the PrestaShop wizard flow (only extracting shared
metadata), no plugin-registered (non-core) capability editing (#576 follow-up), no
platform-generic exclusivity registry beyond the single known pair.

## 2. Existing patterns reused

- `prestashop-setup-form.tsx` - 4-step `WizardLayout` + `SetupStepper`, per-step
  `form.trigger(STEP_FIELDS[i])`, `.capability-list` checkbox fieldset, `wizard-review-list`.
- `woocommerce-setup.schema.ts` - existing Zod schema + `toCreateConnectionInput`.
- `ConnectionCapabilitiesPanel.tsx` - edit-time checkbox list (gets the same guard).
- `CAPABILITY_HELP` exists twice (PrestaShop form + panel, slightly divergent copy) -
  unify into one shared module.

## 3. Steps

1. **`features/connections/lib/capability-metadata.ts`** (new; `lib/` is a canonical
   feature subdirectory):
   - `CAPABILITY_HELP: Record<CoreCapability, string>` - single source of the help copy
     (merge the two existing maps; connection-neutral wording).
   - `CAPABILITY_EXCLUSIVITY_PAIRS: ReadonlyArray<readonly [CoreCapability, CoreCapability]>`
     = `[['InventoryMaster', 'OfferManager']]` - platform-agnostic rule (a stock source
     of truth is never a stock write-back target); no `platformType` dispatch.
   - `getCapabilityConflict(selected: ReadonlySet<string> | readonly string[], capability: string): CoreCapability | null`
     - returns the selected capability that blocks `capability`, else null.
   - `hasCapabilityConflict(capabilities: readonly string[]): boolean` - Zod backstop helper.

2. **`woocommerce-setup.schema.ts`**:
   - `.refine(...)` on `enabledCapabilities` rejecting any exclusivity pair
     (message mirrors the BE copy).
   - Defaults unchanged (`WOOCOMMERCE_FALLBACK_CAPABILITIES` = ProductMaster,
     InventoryMaster, OrderProcessorManager, OrderSource).

3. **`woocommerce-setup-form.tsx`** - rewrite as 4-step wizard:
   - Steps: `Store details` (name, siteUrl) / `API credentials` (info Alert, consumerKey,
     consumerSecret) / `Capabilities` / `Review & create`.
   - Capabilities step: `.capability-list` checkboxes over the adapter registry's
     `supportedCapabilities` (fallback preserved), default-checked set from schema
     defaults; conflicting checkbox rendered `disabled` with an inline
     `.capability-list__help` explanation while its counterpart is selected.
   - Remove the silent `useEffect` seeding of all capabilities (root cause of the bug);
     `enabledCapabilities` becomes user-controlled with sane defaults. Registry
     capabilities not in defaults render unchecked.
   - Review step: name, site URL, masked consumer key (reuse `maskKey` shape), selected
     capabilities. Keep abandon-prevention, `FormErrorSummary`, API-error Alert.
   - No summary rail (WizardLayout's `summary` is optional) - Woo has few fields;
     review step covers it.

4. **`prestashop-setup-form.tsx`**: drop the local `CAPABILITY_HELP`, import from
   `../lib/capability-metadata`. No behavior change.

5. **`ConnectionCapabilitiesPanel.tsx`**: import shared `CAPABILITY_HELP` +
   `getCapabilityConflict`; when a capability's counterpart is enabled, render its
   checkbox `disabled` with the inline explanation (prevents the post-create 400).

6. **Tests**:
   - `woocommerce-setup-form.test.tsx` - update/extend: step navigation + per-step
     validation, exclusivity disable both directions, submit payload contains exactly
     the selected capabilities, review content.
   - `capability-metadata.test.ts` - conflict helper unit tests.
   - `ConnectionCapabilitiesPanel.test.tsx` - extend with the disable-guard case.
   - Schema refine test (in the form test file or a schema test).

## 4. Validation

- Quality gate: `pnpm lint`, `pnpm type-check`, scoped `pnpm --filter @openlinker/web test`.
- No architecture violations: pure feature-slice change; shared module lives inside the
  feature (`lib/`), no `shared/` -> `features/` import, no `platformType` literals.
