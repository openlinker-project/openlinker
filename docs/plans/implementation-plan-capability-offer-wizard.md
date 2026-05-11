# Implementation Plan — Capability-shaped Offer Creation Wizard (#608)

**Issue**: [#608 — [H5] [HIGH] CreateOfferWizard is Allegro-shaped, not capability-shaped](https://github.com/SilkSoftwareHouse/openlinker/issues/608)
**Thread**: H (FE plugin architecture)
**Branch**: `608-create-offer-wizard-capability-shape`
**Builds on**: #629 (FE plugin registry + open ApiClient — landed yesterday)

---

## 1. Goal

`apps/web/src/features/listings/components/CreateOfferWizard.tsx` is presented as a generic offer-creation flow but is wired to Allegro semantics throughout (category picker, seller policies, `productSet`, `serializeAllegroParameters`, `MissingCategoryParameterSectionError`). The listings page mounts it unconditionally regardless of `connection.platformType`. A Shopify or eBay plugin has no extension point to swap in its own offer-creation flow.

Add a per-platform extension point to the FE plugin registry, replace the unconditional mount with a capability-shaped dispatch, and rename the existing wizard so its Allegro coupling is named in the type system rather than implied.

## 2. Non-goals (deferred follow-ups)

- **File relocation**: the issue mentions "move under `features/allegro/`". This plan **keeps the wizard and its private helpers in `features/listings/components/`** for the architectural fix, and defers the directory move to a follow-up. Rationale: separating the registry seam from the file-move makes the diff reviewable, and the renamed wizard's identity is what the FE plugin registry binds to — the disk path is cosmetic. The follow-up issue (call it H5b) is mechanical `git mv` + import updates.
- **Splitting the Allegro-shaped helpers** (`serialize-allegro-parameters`, `auto-prefill-parameters`, `build-parameters-zod-schema`, the CategoryPicker tree, `category-parameters-step`, `category-parameter-form.types`) out of `features/listings/` — same rationale; same follow-up.
- **OfferManager capability gating** on the connection picker (only listing connections whose adapter implements `OfferCreator` per `CoreCapability`). The BE doesn't yet expose adapter-capabilities to the FE; today every active marketplace connection is offered. Wire when #573/#574 (FE-side capability metadata) lands.

## 3. Layer classification

- **Frontend / plugin contracts** (`apps/web/src/plugins/`) — extend the `WebPlugin` interface with an `offerCreationWizard` slot; add a resolver helper.
- **Frontend / feature** (`apps/web/src/features/listings/`) — rename the wizard, drop in-wizard connection picker (the launcher now owns connection selection), add a small `OfferCreationLauncher` entry-point component.
- **Frontend / plugin instance** (`apps/web/src/plugins/allegro/`) — wire the renamed Allegro wizard against the registry.
- **Frontend / page** (`apps/web/src/pages/listings/`) — swap the unconditional wizard mount for the launcher.

No backend changes. No new API endpoints. No new tests at the API or worker level.

## 4. Pattern reuse

Mirrors the registry-contribution pattern #629 established for `WebPlugin.routes` / `navItems` / `apiNamespaces`. The contribution is structural — no TypeScript declaration merging needed (unlike `apiNamespaces`, which augments `PluginApiNamespaces`). A plugin that omits `offerCreationWizard` simply doesn't contribute — listings page renders a "Marketplace not supported" empty state when the chosen connection's `platformType` has no registered wizard.

## 5. Design

### 5.1 Plugin contract — `apps/web/src/plugins/plugin.types.ts`

Extend `WebPlugin` with one new optional slot:

```typescript
import type { ComponentType } from 'react';
import type { Connection } from '../features/connections/api/connections.types';
import type { CreateOfferRequest } from '../features/listings/api/listings.types';

/**
 * Props every per-platform offer-creation wizard receives. The launcher
 * resolves the connection up front (so each wizard knows its platform via
 * `connection.platformType` and never has to render its own connection
 * picker). The wizard is **content-only** — the launcher owns the Dialog
 * chrome so the connection-picker → wizard transition is one continuous
 * dialog rather than two flashing in sequence. `defaultVariantId` /
 * `initialValues` carry retry-path hints.
 */
export interface OfferCreationWizardProps {
  connection: Connection;
  defaultVariantId?: string;
  initialValues?: CreateOfferRequest;
  /** Called when the wizard's Cancel/Close button is pressed — the
   *  launcher uses this to close the surrounding Dialog. */
  onCancel: () => void;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}

export interface OfferCreationWizardContribution {
  /** Connection `platformType` this wizard handles, e.g. 'allegro'. */
  platformType: string;
  /**
   * Pre-bound React component. Using `ComponentType` (vs a render fn) keeps
   * the contribution a pure value at module-load time, plays nicely with
   * test mocks, and mirrors how React expects to consume components at JSX
   * time (`<contribution.component {...props} />`).
   */
  component: ComponentType<OfferCreationWizardProps>;
}

export interface WebPlugin {
  // …existing fields…
  offerCreationWizard?: OfferCreationWizardContribution;
}
```

### 5.2 Resolver — `apps/web/src/plugins/resolve-offer-creation-wizard.ts`

Pure helper used by the `app/`-tier hook (§5.2a). Walks an arbitrary plugin list and returns the first matching contribution or `null`. Pure so the unit spec is trivial and the hook can mock it.

```typescript
export function resolveOfferCreationWizard(
  plugins: ReadonlyArray<WebPlugin>,
  platformType: string,
): OfferCreationWizardContribution | null {
  for (const plugin of plugins) {
    const contribution = plugin.offerCreationWizard;
    if (contribution && contribution.platformType === platformType) {
      return contribution;
    }
  }
  return null;
}
```

### 5.2a App-tier hook — `apps/web/src/app/plugins/use-offer-creation-wizard.ts`

`features` may import only `shared` per `frontend-architecture.md` §"Dependency Rules" — ESLint-enforced. **Features cannot import `plugins/`.** To bridge: expose the plugin lookup via an `app/`-tier hook, mirroring the existing `useApiClient` carve-out the same doc explicitly endorses ("Features may import `useApiClient` from `app/api/` — this is the designed dependency-injection boundary").

```typescript
// apps/web/src/app/plugins/use-offer-creation-wizard.ts
import { useMemo } from 'react';
import { plugins } from '../../plugins';
import {
  resolveOfferCreationWizard,
  type OfferCreationWizardContribution,
} from '../../plugins/resolve-offer-creation-wizard';

/**
 * App-tier hook that resolves the per-platform offer-creation wizard from
 * the build-time plugin registry. Features consume this hook; they must
 * not import `plugins/` directly (FE dep-rule violation, ESLint-enforced).
 *
 * Returns `null` when no plugin contributes a wizard for the given
 * platform — call sites render a "marketplace not supported" empty state.
 */
export function useOfferCreationWizard(
  platformType: string | undefined,
): OfferCreationWizardContribution | null {
  return useMemo(
    () => (platformType ? resolveOfferCreationWizard(plugins, platformType) : null),
    [platformType],
  );
}
```

**Doc update (required in this PR)**: add a one-line carve-out to `docs/frontend-architecture.md` §"Dependency Rules" alongside the `useApiClient` line, so the next contributor doesn't read the import as a violation:

> Features may also import `useOfferCreationWizard` from `app/plugins/` — same DI-boundary precedent.

### 5.3 `OfferCreationLauncher` — `apps/web/src/features/listings/components/OfferCreationLauncher.tsx`

Drop-in replacement for the current `<CreateOfferWizard>` mount on the listings page. Owns connection-picking state, owns the Dialog chrome, and resolves the per-platform wizard via `useOfferCreationWizard(connection?.platformType)`.

**Props** (intentionally a superset of the old wizard props so the call site is one-line):
```typescript
interface OfferCreationLauncherProps {
  isOpen: boolean;
  onClose: () => void;
  /** Pre-selected connection id (e.g. retry path). When set, skips the picker. */
  defaultConnectionId?: string;
  initialValues?: CreateOfferRequest;
  onSubmitted: (offerCreationRecordId: string, connectionId: string) => void;
}
```

**Single morphing dialog** (state-driven body, not two sequential dialogs — see review SUGGESTION #3):

1. `isOpen=false` → render nothing.
2. `isOpen=true` + no connection chosen yet → render `<Dialog>` with a small connection-picker body: dropdown of active connections sorted by name, "Continue" + "Cancel" buttons. Continue stores the chosen `connection` in launcher state; Cancel fires `onClose`.
3. `isOpen=true` + `connection` chosen + matching wizard contribution → render the **same** `<Dialog>` but switch the body to `<contribution.component connection={…} defaultVariantId={…} initialValues={…} onCancel={onClose} onSubmitted={onSubmitted} />`. The wizard renders no Dialog of its own; it lives inside the launcher's.
4. `isOpen=true` + `connection` chosen + **no** matching contribution → same `<Dialog>` rendering an `<Alert tone="warning">` saying "Offer creation isn't supported for this marketplace yet (platformType=`{connection.platformType}`)" + a Close button that fires `onClose`.

Auto-pick optimisation: when `defaultConnectionId` is supplied and resolves to an active connection in the loaded list, skip step 2 and seed `connection` directly. While the connections query is still loading and no connection is yet chosen, render a tiny inline loading state inside the dialog body — never let the dialog flash empty.

### 5.4 Wizard rename + content-only refactor — `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx`

`git mv CreateOfferWizard.tsx AllegroCreateOfferWizard.tsx`; rename the exported function; preserve all internal logic. Shape changes:

- **Props**: replace `{ isOpen, onClose, defaultConnectionId, initialValues, onSubmitted }` with `{ connection, defaultVariantId?, initialValues?, onCancel, onSubmitted }` (per the contract in §5.1).
- **Dialog chrome removed**: drop the `<Dialog>`/`<DialogContent>`/`<DialogTitle>` wrapper entirely. The wizard now returns wizard-body markup directly (stepper + step content + nav buttons). The launcher provides the surrounding Dialog. Internal "Cancel" button calls `onCancel`.
- **Step 1**: rename "Connection & Variant" → "Variant". Remove the connection `<Select>`. Pre-fill `connectionId` in the form state from `props.connection.id` (defaulted via `defaultValues`); the field stays in the form schema (the API call still needs it) but is never user-editable.
- **`STEP_FIELDS[0]`**: drop `'connectionId'`; keep `'internalVariantId'`.
- **Step labels constant** renamed to make Allegro identity explicit (e.g. `ALLEGRO_STEP_LABELS`) — small clarity tweak; no functional change.
- **Header**: include the connection name (e.g. "Create Allegro offer · {connection.name}") inside the wizard body so the operator knows which marketplace they're creating for, replacing the in-wizard picker affordance.

**Test migration (review SUGGESTION #5)**: the existing `CreateOfferWizard.test.tsx` has substantial coverage of "operator picks a connection, then …" — that behaviour now lives in the launcher. Tests removed from the wizard spec because they exercise the connection-picker UX must be **re-implemented against `OfferCreationLauncher.test.tsx`** so net regression coverage is preserved. Don't just delete them.

**Connection-id integrity check (review SUGGESTION #4)**: add a single test that mounts the renamed wizard with a fixture `connection`, drives it through to submit, and asserts the captured `CreateOfferRequest.connectionId === connection.id`. This catches the failure mode where someone later wires a hidden input that drifts.

### 5.5 Plugin wiring — `apps/web/src/plugins/allegro/index.ts`

```typescript
import { AllegroCreateOfferWizard } from '../../features/listings/components/AllegroCreateOfferWizard';
// …existing imports…

export const allegroPlugin = definePlugin({
  id: 'allegro',
  routes: [allegroCallbackRoute, allegroSetupRoute],
  apiNamespaces: (request) => ({ allegro: createAllegroApi(request) }),
  offerCreationWizard: {
    platformType: 'allegro',
    component: AllegroCreateOfferWizard,
  },
});
```

### 5.6 Listings page — `apps/web/src/pages/listings/listings-list-page.tsx`

Replace:
```tsx
<CreateOfferWizard
  isOpen={isWizardOpen}
  onClose={closeWizard}
  defaultConnectionId={...}
  initialValues={retryInitialValues}
  onSubmitted={handleOfferSubmitted}
/>
```
with:
```tsx
<OfferCreationLauncher
  isOpen={isWizardOpen}
  onClose={closeWizard}
  defaultConnectionId={retryDefaultConnectionId ?? (debouncedConnectionId || undefined)}
  initialValues={retryInitialValues}
  onSubmitted={handleOfferSubmitted}
/>
```
Imports change; logic doesn't. `listings-list-page.test.tsx` updates to match.

## 6. Step-by-step plan

| # | File | Action | Acceptance |
|---|------|--------|------------|
| 1 | `apps/web/src/plugins/plugin.types.ts` | Add `OfferCreationWizardProps`, `OfferCreationWizardContribution` (uses `component: ComponentType<…>`, not a render fn); extend `WebPlugin`. | Type compiles; existing plugins unchanged. |
| 2 | `apps/web/src/plugins/resolve-offer-creation-wizard.ts` | New helper (pure function). | Exports the signature in §5.2. |
| 3 | `apps/web/src/plugins/resolve-offer-creation-wizard.test.ts` | Unit spec — match, no-match, multi-plugin (first-match-wins). | 3+ tests pass. |
| 4 | `apps/web/src/app/plugins/use-offer-creation-wizard.ts` | New `app/`-tier hook that closes over `plugins` and exposes `useOfferCreationWizard(platformType)`. Mirrors the `useApiClient` DI-boundary precedent. | Returns the resolved contribution or `null`. Memoised on `platformType`. |
| 5 | `apps/web/src/app/plugins/use-offer-creation-wizard.test.tsx` | Unit spec. | Returns `null` for unknown / undefined platform; returns the contribution for a registered one. |
| 6 | `docs/frontend-architecture.md` | Add the one-line carve-out under §"Dependency Rules" — "Features may also import `useOfferCreationWizard` from `app/plugins/` — same DI-boundary precedent as `useApiClient`." | Doc change visible in diff. |
| 7 | `apps/web/src/features/listings/components/CreateOfferWizard.tsx` | `git mv` → `AllegroCreateOfferWizard.tsx`. Drop the Dialog wrapper. Drop `isOpen`/`onClose`/`defaultConnectionId`; require `connection` + `onCancel` props (§5.1 contract). Drop the connection picker from Step 1; rename step labels; show connection name in the wizard header. | File renamed; no `<Dialog>` import; no `isOpen` prop; `STEP_FIELDS[0]` is `['internalVariantId']`. |
| 8 | `apps/web/src/features/listings/components/CreateOfferWizard.test.tsx` | `git mv` → `AllegroCreateOfferWizard.test.tsx`. Strip connection-picker tests; inject a fixture `connection`. Add the connection-id integrity test (§5.4). **Identify which removed tests cover behaviour that now lives in the launcher and migrate them to step 10's spec** — net coverage preserved. | Suite passes; explicit comment on which removed cases were re-homed in the launcher spec. |
| 9 | `apps/web/src/plugins/allegro/index.ts` | Register the wizard contribution: `{ platformType: 'allegro', component: AllegroCreateOfferWizard }`. | Type-check passes; `allegroPlugin.offerCreationWizard?.platformType === 'allegro'`. |
| 10 | `apps/web/src/features/listings/components/OfferCreationLauncher.tsx` | New component (§5.3). Owns the Dialog; switches body between picker / wizard / unsupported-alert based on internal `connection` state. Uses `useOfferCreationWizard(connection?.platformType)`. | Renders the 4 states (closed, picking, wizard, unsupported); auto-picks on `defaultConnectionId` once connections load; single-Dialog morphing, no flicker. |
| 11 | `apps/web/src/features/listings/components/OfferCreationLauncher.test.tsx` | Unit spec covering: picker shown when no default; auto-skip when default supplied AND connection in active set; falls back to picker when `defaultConnectionId` doesn't resolve; loading state while connections fetch; unsupported-platform alert when no plugin contribution; wizard rendered on Continue. **Re-implement the connection-picker-flow tests that previously lived in the wizard spec** (§5.4 migration). | All migrated test cases preserved and passing. |
| 12 | `apps/web/src/pages/listings/listings-list-page.tsx` | Swap mount → `OfferCreationLauncher`. | Page still opens "Create offer" CTA; existing retry path still pre-fills. |
| 13 | `apps/web/src/pages/listings/listings-list-page.test.tsx` | Update imports / assertions. | Suite passes. |
| 14 | `apps/web/src/index.css` | Launcher picker-body styles (if new classes needed). | Picker renders without horizontal scroll on 360px; reuses existing `.dialog__*` tokens. |

## 7. Architecture compliance

- ✅ `WebPlugin` is an open-extension contract — adding a slot doesn't break existing plugins (the new field is optional).
- ✅ Dependency direction:
  - `plugins/allegro` → `features/listings/components/AllegroCreateOfferWizard.tsx` is `plugins → features`, allowed.
  - `pages/listings` → `features/listings/components/OfferCreationLauncher.tsx` is `pages → features`, allowed.
  - `features/listings/components/OfferCreationLauncher.tsx` → `app/plugins/use-offer-creation-wizard.ts` is `features → app`, allowed via the explicit `useApiClient` carve-out (extended in step 6).
  - `app/plugins/use-offer-creation-wizard.ts` → `plugins/index.ts` is `app → plugins`, allowed.
  - **Features do NOT import `plugins/` directly** — that path goes only through the `app/`-tier hook.
- ✅ No `any` — `Connection`, `CreateOfferRequest` are typed imports; the wizard contribution is fully typed via `ComponentType<OfferCreationWizardProps>`.
- ✅ Naming: `AllegroCreateOfferWizard.tsx` (PascalCase export, matches existing `CreateOfferWizard.tsx` / `CategoryPicker.tsx` / `EditOfferDrawer.tsx` / `OfferCreationTracker.tsx` convention in this slice).
- ✅ `OfferCreationLauncher.tsx` follows the same Pascal convention.
- ✅ `use-offer-creation-wizard.ts` follows the kebab `use-*.ts` hook convention.
- ✅ Test files use `*.test.tsx` per FE rules.
- ✅ No `fetch()` from pages/features — all data goes through `useApiClient`.

## 8. Risks

1. **Test renames** — `CreateOfferWizard.test.tsx` is the largest test file in the listings slice (covers all 5 steps + retry path). Renaming + updating connection-picker tests is mechanical but voluminous. Mitigation: do the rename as a pure `git mv` first, then a focused edit of the connection-picker test block.
2. **Connection-picker UX shift** — moving the picker from inside the wizard to a launcher modal changes the operator flow. Existing tests asserting "step 1 contains a connection select" will break and need to be replaced by launcher tests asserting "picker dialog shows on open, then wizard opens on Continue". Snapshot/screenshot diff is intentional; it's the user-visible change the issue tracks.
3. **`defaultConnectionId` semantics** — today the wizard uses `defaultConnectionId` to *pre-select* in its picker; after the refactor the launcher uses it to *skip* the picker. Listings-page retry path (`handleRetry`) already supplies an exact connection, so the skip is correct. The filter-derived default (`debouncedConnectionId`) may not always identify a real connection (it's a free-text filter on platform type / ID strings). Guard: launcher resolves `defaultConnectionId` against the loaded connections list and falls back to the picker if the id doesn't match.

## 9. Out of scope (re-stated)

- Physical move of the wizard + Allegro-shaped helpers to `features/allegro/` — follow-up.
- Hiding non-`OfferCreator` connections from the picker — needs FE-side capability metadata (#573/#574 dependency).
- Building a generic "no-wizard" fallback page or marketplace-onboarding stub — the launcher shows an inline alert today; a richer story can land when there's a second plugin to test against.

## 10. Validation checklist

Before commit:
- [ ] `pnpm lint` clean
- [ ] `pnpm type-check` clean
- [ ] `pnpm test` — all suites green, including renamed wizard suite and new launcher suite
- [ ] Manual: open `/listings`, click "Create offer", confirm picker dialog shows with active connections, pick one, confirm wizard opens for Allegro and the connection name is shown in the wizard header
- [ ] Manual: retry path from `OfferCreationTracker` still opens directly into the wizard with pre-filled fields
- [ ] Manual: with a non-Allegro connection (mock by editing fixtures or temporarily registering a Prestashop plugin contribution), confirm the "not supported" alert renders
