# Implementation Plan — FE `platformType` open-world (#578 + #579)

## Goal

Close Modularity Thread D's two remaining HIGH items on the frontend:

- **#578 (D3)** — `PLATFORM_TYPES = ['prestashop', 'allegro']` is a closed `as const` union. The platform-picker uses `Record<PlatformType, …>` which compiler-enforces exhaustiveness against the closed set. Adding `'shopify'` requires editing the core `PLATFORM_TYPES` union and touching every literal-branch site.
- **#579 (D4)** — A dozen call sites dispatch on `connection.platformType === 'allegro' | 'prestashop'` literals to render platform-specific UI (offer-wizard filtering, seller-defaults section, edit-form branches, listing-detail rendering, connection actions).

After this PR, `platformType` is an opaque string and FE behavior dispatches through:

1. **Capability checks** (`c.supportedCapabilities.includes('OfferManager')`) for capability-shaped decisions.
2. **A per-platform plugin registry** for true UI quirks that cannot be expressed as a capability (e.g., PrestaShop's `window.location.origin` default for the OL callback URL, Allegro's GPSR seller-defaults section, the "Configure webhooks" action).

An ESLint rule prevents the literal-equality dispatch from coming back.

This mirrors the FE counterpart of the BE pattern landed in #570/#571/#572/#576/#577 (open Capability/EntityType unions at the registry boundary, plugins self-register via `PluginRegistryModule.forRoot({ plugins })`).

## Layer classification

**Frontend.** No backend code touched. Public BE contracts (`connection.supportedCapabilities: string[]`, `connection.enabledCapabilities: string[]`, `connection.platformType: string`) are already open since #576/#577 — FE just consumes them.

## Non-goals

- **Not** opening `Capability` on the FE — already done by #576 (FE keeps `CORE_CAPABILITY_VALUES` as well-known set, `enabledCapabilities`/`supportedCapabilities` are `string[]`).
- **Not** building an out-of-tree plugin discovery mechanism (lazy chunk loading, manifest scanning, etc.). That's Modularity Thread H — see #604/#605/#606. This PR ships the in-tree registry seam **only**; H-thread can later add discovery on top.
- **Not** migrating `PromptTemplateChannelValues = ['prestashop', 'allegro']` (#580 D5) — different scope, lives in the AI feature.
- **Not** addressing #607 (marketplace-specific code in `shared/`) or #608 (`CreateOfferWizard` Allegro-shaped). Those are larger refactors. This PR's `CreateOfferWizard` migration is limited to the single `platformType === 'allegro'` literal at line 302.
- **Not** moving `allegro-seller-panel-url.ts` into the plugin folder. It's a pure helper that already fails safe for non-Allegro platforms — and it's referenced by name in tests. Leaving as-is.

## Research summary

### Current shape

`apps/web/src/features/connections/api/connections.types.ts:1-3`:

```ts
export const PLATFORM_TYPES = ['prestashop', 'allegro'] as const;
export type PlatformType = (typeof PLATFORM_TYPES)[number];
```

Compare to the already-open Capability type on the same file (lines 12-25): `CORE_CAPABILITY_VALUES` is the well-known set, `enabledCapabilities`/`supportedCapabilities` field types are `string[]`. Same pattern applies here.

### Literal-equality dispatch sites (full inventory)

| File | Line | Today | Replacement |
|---|---|---|---|
| `features/listings/components/CreateOfferWizard.tsx` | 302 | `c.platformType === 'allegro' \|\| c.supportedCapabilities.includes('OfferManager')` | `c.supportedCapabilities.includes('OfferManager')` (drop redundant arm — #576 guarantees `supportedCapabilities` is populated) |
| `features/connections/components/create-connection-form.tsx` | 41-43 | `PLATFORM_OPTIONS` static array | `usePlugins()` → `plugins.map(p => …)` |
| `features/connections/components/create-connection-form.tsx` | 58 | `watchedPlatformType === 'allegro'` (toggles OAuth-only flow) | `usePlugin(watchedPlatformType)?.requiresOAuthRedirect === true` |
| `features/connections/components/create-connection.schema.ts` | 5-6 | `z.enum([...PLATFORM_TYPES, ''])` | `z.string().trim().min(1, 'Platform type is required')` (BE validates membership) |
| `features/connections/components/EditConnectionForm.tsx` | 162 | `connection.platformType === 'prestashop'` (callback-URL default) | `usePlugin(connection.platformType)?.getCallbackUrlDefault?.()` |
| `features/connections/components/EditConnectionForm.tsx` | 185 | `platformBranch = prestashop \| marketplace \| raw` via literal | `hasStructuredSection = plugin?.EditConnectionStructuredSection !== undefined`; `isMarketplace = connection.enabledCapabilities.includes('OfferManager')` |
| `features/connections/components/EditConnectionForm.tsx` | 345 | (already replaced upstream — line moved) | n/a |
| `features/connections/components/EditConnectionForm.tsx` | 433 | `connection.platformType === 'allegro' ? <AllegroSellerDefaultsSection /> : null` | `<plugin?.EditConnectionExtraSection ?? null />` (Allegro plugin contributes the seller-defaults section) |
| `features/connections/components/EditConnectionForm.tsx` | 673 | `connection.platformType !== 'prestashop'` (gates credential-rotation UI) | `usePlugin(connection.platformType)?.supportsCredentialRotation === true` |
| `features/connections/components/ConnectionActionsPanel.tsx` | 26 | `connection.platformType === 'prestashop'` (gates "Configure webhooks") | Render `usePlugin(connection.platformType)?.useConnectionActions?.(connection) ?? []` after the generic actions. PrestaShop plugin contributes the "Configure webhooks" action |
| `pages/connections/connections-list-page.tsx` | 5,17,126 | `PLATFORM_TYPES.includes(...)` validation + dropdown | `usePlugins()` for dropdown; accept any string in URL (BE validates) |
| `pages/listings/listing-detail-page.tsx` | 119 | `mapping.platformType.toLowerCase() === 'allegro'` gates "Edit offer" button | `usePlugin(mapping.platformType)?.supportsListingEdit === true` |
| `features/connections/components/platform-picker.tsx` | 21-43 | `PLATFORM_CARDS: Record<PlatformType, PlatformCard>` | `usePlugins()` → `plugins.filter(p => p.setupCard).map(p => ...)` |

The grep that produced this list:

```bash
grep -rn -E "(platformType|PlatformType)\s*(===|!==)" apps/web/src
grep -rn "toLowerCase() === 'allegro'\|toLowerCase() === 'prestashop'" apps/web/src
grep -rn "PLATFORM_TYPES" apps/web/src
```

### Existing FE provider stack

`apps/web/src/main.tsx` → `AppProviders` wraps the tree in: `ThemeProvider → SessionProvider → ToastProvider → ApiClientProvider → QueryClientProvider`. Adding `PluginRegistryProvider` at the outermost level (no dependency on session/api) is safe.

### Dependency rules to respect

From `docs/frontend-architecture.md:284-291` (enforced by `.eslintrc.js` overrides):

- `shared/` cannot import `features/`, `pages/`, or `app/`
- `features/` cannot import `pages/`
- `app/` is the composition root

The plan therefore puts the **plugin contract** (types, hooks, provider) in `shared/plugins/` (importable from anywhere) and the **plugin instances** (which compose feature components) in a new top-level `plugins/` directory at the same level as `app/`. Only `app/providers/app-providers.tsx` imports the manifest from `plugins/`. We add `plugins/` to the ESLint `features/`-restriction list as an allowed downstream (mirrors the existing override stanza shape).

## Design

### File layout

```
apps/web/src/
├── app/
│   └── providers/app-providers.tsx       # [edit] mount PluginRegistryProvider
├── plugins/                              # [new] in-tree plugin instances
│   ├── index.ts                          # exports IN_TREE_PLUGINS = [allegroPlugin, prestashopPlugin]
│   ├── allegro/
│   │   ├── allegro.plugin.tsx            # PlatformPlugin object
│   │   └── allegro.plugin.test.tsx
│   └── prestashop/
│       ├── prestashop.plugin.tsx
│       └── prestashop.plugin.test.tsx
├── shared/
│   └── plugins/                          # [new] registry contract
│       ├── plugin.types.ts
│       ├── plugin-registry-context.tsx   # provider + context
│       ├── use-plugin.ts                 # usePlugin(platformType) hook
│       ├── use-plugins.ts                # usePlugins() hook
│       ├── plugin-registry-context.test.tsx
│       └── index.ts                      # barrel
└── features/connections/api/connections.types.ts  # [edit] open PlatformType
```

### Plugin contract (`shared/plugins/plugin.types.ts`)

```ts
import type { ComponentType, ReactNode } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { Connection } from '../../features/connections/api/connections.types';
// NOTE: this is a cross-feature type import from shared/plugins. The contract
// is feature-aware by necessity — plugins compose feature components. We
// intentionally import only TYPES, not runtime, so the dependency direction
// stays one-way at runtime.

export interface PlatformSetupCard {
  title: string;
  description: string;
  to: string;
  badge: string;
}

export interface PlatformConnectionAction {
  id: string;
  label: string;
  description: ReactNode;
  status?: ReactNode;
  tone?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  isPending?: boolean;
  pendingLabel?: string;
  onTrigger: () => void;
}

export interface EditConnectionStructuredSectionProps {
  connection: Connection;
  // EditConnectionFormValues is a type that lives inside features/connections/
  // — to avoid the type leaking up into shared/, the prop typing here is
  // intentionally `unknown`-narrowed: plugins cast via a `formAccessor` arg.
  // See plugin-form-accessor.ts for the cast helper.
  form: UseFormReturn<EditConnectionFormSurface>;
  configIsParseable: boolean;
  syncStructuredToJson: (field: string, value: string, options?: { markDirty?: boolean }) => void;
}

// Minimal projection of EditConnectionFormValues that plugins are allowed
// to read/write. Keeps shared/plugins decoupled from feature-internal types.
export interface EditConnectionFormSurface {
  watch: (path: string) => string | undefined;
  setValue: (path: string, value: unknown, opts?: { shouldDirty?: boolean }) => void;
  register: UseFormReturn['register'];
  formState: { errors: Record<string, unknown> };
}

export interface EditConnectionExtraSectionProps {
  connection: Connection;
  form: UseFormReturn;
  configIsParseable: boolean;
  syncSellerDefaultsToJson: () => void;
}

export interface PlatformPlugin {
  /** Stable key matching `connection.platformType`. */
  platformType: string;
  /** Human-readable display name. */
  displayName: string;

  /** Setup-card metadata for `PlatformPicker`. Omit if no guided wizard. */
  setupCard?: PlatformSetupCard;
  /** Create-connection: skip the inline form, show OAuth-redirect Alert. */
  requiresOAuthRedirect?: boolean;

  /** Edit-connection: callback-URL default (PS only today). */
  getCallbackUrlDefault?: () => string | undefined;
  /** Edit-connection: render the platform-specific structured config inputs. */
  EditConnectionStructuredSection?: ComponentType<EditConnectionStructuredSectionProps>;
  /** Edit-connection: render extra section below structured/raw (e.g., Allegro seller defaults). */
  EditConnectionExtraSection?: ComponentType<EditConnectionExtraSectionProps>;
  /** Edit-connection: render rotate-key UI in CredentialsPanel. */
  supportsCredentialRotation?: boolean;

  /** Connection-detail: extra platform-specific actions on the action panel. */
  useConnectionActions?: (connection: Connection) => PlatformConnectionAction[];

  /** Listing-detail: gate the "Edit offer" button. */
  supportsListingEdit?: boolean;
}
```

> **Note on the form prop**: `EditConnectionFormValues` is a feature-private type that we cannot safely expose to `shared/plugins/`. Two pragmatic options:
>
> - **(a)** Keep the structured-section plugin slot's `form` prop as a narrow `EditConnectionFormSurface` projection (minimal Watch/SetValue/Register signature). Plugins cast as needed. **Trade-off**: weaker static typing inside plugin bodies.
> - **(b)** Hoist `EditConnectionFormValues` (and `editConnectionSchema`) into `shared/forms/edit-connection-form-values.ts`. **Trade-off**: a feature-internal type bleeds into shared/ — but `shared/plugins/` is itself a contract surface so this isn't entirely wrong.
>
> **Decision: (b)** is too invasive for this PR's scope and would couple `shared/` to every feature's form schema as plugins grow. **Going with (a)**: the structured-section/extra-section props use the narrowest possible interface (`UseFormReturn` with feature-local extension via the `form as` cast in plugin bodies). Plugins are the only places that need full typing, and they're already feature-aware composition layers. Reviewer: this is the one place static-typing weakens — confirm acceptable.

### Provider & hooks

```ts
// shared/plugins/plugin-registry-context.tsx
const PluginRegistryContext = createContext<PlatformPlugin[] | null>(null);

export function PluginRegistryProvider({ plugins, children }: { plugins: PlatformPlugin[]; children: ReactNode }) {
  return <PluginRegistryContext.Provider value={plugins}>{children}</PluginRegistryContext.Provider>;
}

// shared/plugins/use-plugins.ts
export function usePlugins(): PlatformPlugin[] {
  const ctx = useContext(PluginRegistryContext);
  if (ctx === null) {
    throw new Error('usePlugins() must be used inside <PluginRegistryProvider>.');
  }
  return ctx;
}

// shared/plugins/use-plugin.ts
export function usePlugin(platformType: string | undefined): PlatformPlugin | undefined {
  const plugins = usePlugins();
  if (!platformType) return undefined;
  return plugins.find((p) => p.platformType === platformType);
}
```

### In-tree plugin manifest

```ts
// apps/web/src/plugins/index.ts
import { allegroPlugin } from './allegro/allegro.plugin';
import { prestashopPlugin } from './prestashop/prestashop.plugin';
import type { PlatformPlugin } from '../shared/plugins';

/**
 * In-tree plugin manifest. Mirrors `apps/api/src/plugins.ts` from #572. To add
 * a third-party platform plugin, add an entry here — no other file in
 * `apps/web/src/{app,features,pages,shared}` should need to change.
 */
export const IN_TREE_PLUGINS: PlatformPlugin[] = [prestashopPlugin, allegroPlugin];
```

### Prestashop plugin (what it contributes)

```ts
export const prestashopPlugin: PlatformPlugin = {
  platformType: 'prestashop',
  displayName: 'PrestaShop',
  setupCard: {
    title: 'PrestaShop',
    description: 'Connect a PrestaShop store via the Webservice API…',
    to: '/connections/new/prestashop',
    badge: 'Webservice API',
  },
  getCallbackUrlDefault: () =>
    typeof window !== 'undefined' ? window.location.origin : undefined,
  EditConnectionStructuredSection: PrestashopStructuredSection,
  // No EditConnectionExtraSection — PS has no Allegro-like extra block.
  supportsCredentialRotation: true,
  useConnectionActions: (connection) => [configureWebhooksAction(connection)],
};
```

The `PrestashopStructuredSection` component contains: Shop URL, Storefront URL, Shop ID, OL callback URL, fallback carrier picker — moved verbatim from the inline JSX block in `EditConnectionForm.tsx`.

The `configureWebhooksAction` factory composes `useConfigureWebhooksMutation` + the toast feedback that was inlined in `ConnectionActionsPanel.tsx`. It becomes a hook because it owns mutation state — so the slot is `useConnectionActions: (connection) => PlatformConnectionAction[]` (rules-of-hooks compliant by calling the hook in the registry-consumer site, not inside the registry).

> **Hook usage in the registry**: `useConnectionActions` IS a hook (returns derived actions from mutation state). The consumer site (`ConnectionActionsPanel`) is the one calling it. Since each plugin's `useConnectionActions` must be called unconditionally, and there is at most one plugin per connection (`usePlugin(connection.platformType)`), the consumer always calls exactly zero-or-one such hook — but it would need to know *which* plugin's hook to call at compile-time. Since plugin lookup is dynamic, we instead make `useConnectionActions` ALWAYS execute and return `[]` for non-matching plugins, OR have a dedicated `<PluginConnectionActions />` component that the consumer renders, and that component internally calls the matching plugin's hook. **Going with the `<PluginConnectionActions connection={connection} />` component** — cleanest. The plugin exposes `ConnectionActions: ComponentType<{ connection: Connection }>` (a sub-component), not a hook. This sidesteps rules-of-hooks entirely.

Updated shape:

```ts
ConnectionActions?: ComponentType<{ connection: Connection }>;  // renders zero or more actions
```

### Allegro plugin (what it contributes)

```ts
export const allegroPlugin: PlatformPlugin = {
  platformType: 'allegro',
  displayName: 'Allegro',
  setupCard: {
    title: 'Allegro',
    description: 'Connect an Allegro seller account…',
    to: '/connections/new/allegro',
    badge: 'OAuth 2.0',
  },
  requiresOAuthRedirect: true,
  EditConnectionExtraSection: AllegroSellerDefaultsExtraSection,
  supportsListingEdit: true,
};
```

`AllegroSellerDefaultsExtraSection` wraps the existing `AllegroSellerDefaultsSection` from `features/connections/components/allegro-seller-defaults-section.tsx` — pure re-export with the plugin-slot signature.

### Migration sketch — `EditConnectionForm.tsx`

Before (line 184-190):
```ts
const platformBranch: PlatformBranch =
  connection.platformType === 'prestashop' ? 'prestashop'
  : connection.enabledCapabilities.includes('OfferManager') ? 'marketplace'
  : 'raw';
const hasStructuredInputs = platformBranch !== 'raw';
```

After:
```ts
const plugin = usePlugin(connection.platformType);
const StructuredSection = plugin?.EditConnectionStructuredSection;
const isMarketplace = connection.enabledCapabilities.includes('OfferManager');
const hasStructuredInputs = Boolean(StructuredSection) || isMarketplace;
```

Body rendering:
```tsx
{StructuredSection ? (
  <StructuredSection
    connection={connection}
    form={form}
    configIsParseable={configIsParseable}
    syncStructuredToJson={syncStructuredToJson}
  />
) : null}

{isMarketplace ? (
  <MarketplaceCatalogPicker {...marketplaceProps} />
) : null}

{plugin?.EditConnectionExtraSection ? (
  <plugin.EditConnectionExtraSection
    connection={connection}
    form={form}
    configIsParseable={configIsParseable}
    syncSellerDefaultsToJson={syncSellerDefaultsToJson}
  />
) : null}
```

### Migration sketch — `ConnectionActionsPanel.tsx`

Before (line 25, 134-156):
```ts
const isPrestashop = connection.platformType === 'prestashop';
// later …
{isPrestashop ? <ConfigureWebhooksRow … /> : null}
```

After:
```tsx
{plugin?.ConnectionActions ? (
  <plugin.ConnectionActions connection={connection} />
) : null}
```

The `ConfigureWebhooks` action JSX moves into `plugins/prestashop/components/prestashop-connection-actions.tsx` — owns its mutation hook and toast handling.

## Step-by-step plan

### Step 1 — Open `PlatformType` (`features/connections/api/connections.types.ts`)

- Rename `PLATFORM_TYPES` → `CORE_PLATFORM_TYPES` (well-known set; keeps the BE-mirror naming).
- Change `PlatformType` to `string` (just `string`, not `CorePlatformType | string` — flat alias is simpler and the BE entity type is already `string` post-#577).
- Change `Connection.platformType: PlatformType` → `platformType: string` (effectively the same; alias retained for code-search friendliness).
- Same for `ConnectionFilters.platformType` and `CreateConnectionInput.platformType`.
- **Acceptance**: `tsc --noEmit` clean. Grep `PLATFORM_TYPES` returns zero hits.

### Step 2 — Build the registry contract (`shared/plugins/`)

Files created:
- `shared/plugins/plugin.types.ts` — interfaces above.
- `shared/plugins/plugin-registry-context.tsx` — `PluginRegistryContext`, `PluginRegistryProvider`.
- `shared/plugins/use-plugins.ts` — `usePlugins()` (throws when provider absent).
- `shared/plugins/use-plugin.ts` — `usePlugin(platformType)` (returns `undefined` for unknown).
- `shared/plugins/index.ts` — barrel.
- `shared/plugins/plugin-registry-context.test.tsx` — basic provider/hook unit test.

### Step 3 — Build the two in-tree plugins (`plugins/`)

Files created:
- `plugins/prestashop/prestashop.plugin.tsx` — `prestashopPlugin: PlatformPlugin`.
- `plugins/prestashop/components/prestashop-structured-section.tsx` — the structured-config block extracted from `EditConnectionForm.tsx` (Shop URL, Storefront URL, Shop ID, OL callback URL, fallback carrier picker). Keeps the inline-JSX shape but receives props through `EditConnectionStructuredSectionProps`. The `PrestashopFallbackCarrierField` sub-component stays here; the `useMappingOptions` import path stays.
- `plugins/prestashop/components/prestashop-connection-actions.tsx` — the "Configure webhooks" action row extracted from `ConnectionActionsPanel.tsx`.
- `plugins/allegro/allegro.plugin.tsx` — `allegroPlugin: PlatformPlugin`.
- `plugins/allegro/components/allegro-extra-section.tsx` — thin wrapper around the existing `AllegroSellerDefaultsSection` so the plugin slot's prop signature matches.
- `plugins/index.ts` — `IN_TREE_PLUGINS` manifest.

### Step 4 — Mount the provider

Edit `app/providers/app-providers.tsx`: wrap inside `ThemeProvider` (outermost or just inside — doesn't matter, no consumer depends on session/api):

```tsx
<PluginRegistryProvider plugins={IN_TREE_PLUGINS}>
  …existing providers…
</PluginRegistryProvider>
```

### Step 5 — Migrate dispatch sites

In order, each migration with the new code:

5.1 `features/connections/components/platform-picker.tsx` — use `usePlugins()` for setup cards.

5.2 `features/connections/components/create-connection-form.tsx` —
- Replace `PLATFORM_OPTIONS` with `usePlugins().map(p => ({ value: p.platformType, label: p.displayName }))`.
- Replace `isAllegroSelected` with `requiresOAuthRedirect`.

5.3 `features/connections/components/create-connection.schema.ts` — relax `platformTypeFormSchema` to `z.string().trim().min(1, 'Platform type is required')`.

5.4 `pages/connections/connections-list-page.tsx` —
- Drop `isValidPlatformType` literal check; the URL search param is now an arbitrary string passed to BE.
- Dropdown options come from `usePlugins()`; label shows `displayName`.

5.5 `features/listings/components/CreateOfferWizard.tsx:302` — drop `c.platformType === 'allegro' ||`, leaving only the capability check.

5.6 `features/connections/components/EditConnectionForm.tsx` — five sites:
- Line 162 — `usePlugin(...)?.getCallbackUrlDefault?.() ?? ''` for the OL callback default.
- Line 185 — derive `StructuredSection`, `isMarketplace`, `hasStructuredInputs` as in the sketch above.
- Line 345-417 PS block — replace inline JSX with `<StructuredSection {...} />`.
- Line 433 — replace inline Allegro check with `<plugin.EditConnectionExtraSection {...} />`.
- Line 673 (`CredentialsPanel`) — replace `connection.platformType !== 'prestashop'` with `!plugin?.supportsCredentialRotation`. (`CredentialsPanel` becomes plugin-aware; it already takes `connection` as prop.)

5.7 `features/connections/components/ConnectionActionsPanel.tsx` — replace `isPrestashop` and the inline "Configure webhooks" row with `<plugin.ConnectionActions connection={connection} />`.

5.8 `pages/listings/listing-detail-page.tsx:119` — gate on `usePlugin(mapping.platformType)?.supportsListingEdit === true` (lowercase normalization no longer needed; `platformType` is opaque, but we keep `toLowerCase()` in the lookup as a defensive measure — or use the mapping's `platformType` as-is. Decision: drop the `toLowerCase()` since plugin keys are canonical strings; if production data has uppercase variants we should fix the BE rather than papering over here.).

### Step 6 — ESLint guard

Add a new override to `.eslintrc.js` for `apps/web/src/{features,pages,app}/`:

```js
{
  files: ['apps/web/src/{features,pages,app}/**/*.{ts,tsx}'],
  excludedFiles: ['apps/web/src/plugins/**'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          "BinaryExpression[operator=/^(===|!==)$/][left.property.name='platformType']",
        message:
          "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/. Use usePlugin()/usePlugins() or capability checks (supportedCapabilities.includes('…')).",
      },
      {
        selector:
          "BinaryExpression[operator=/^(===|!==)$/][right.property.name='platformType']",
        message:
          "Literal-equality dispatch on platformType is forbidden outside apps/web/src/plugins/.",
      },
    ],
  },
},
```

`apps/web/src/plugins/` is the one place where literal-equality is still legitimate (each plugin keys on its own `platformType` constant).

Also extend the `features/`-restriction stanza so plugin imports are allowed from features (TypeScript would otherwise complain about layer violations only if we tried to import `pages/` from `features/`; importing `plugins/` is fine — but features should not depend on plugins either, since plugins compose feature components. **Actually** features should NOT import plugins (one-way: plugins → features). The migration sites use `usePlugin()`/`usePlugins()` from `shared/plugins/` — which is allowed. Features don't import `apps/web/src/plugins/` directly.

### Step 7 — Tests

7.1 `shared/plugins/plugin-registry-context.test.tsx` — provider missing throws, provider present returns plugins; lookup hit/miss.

7.2 `plugins/prestashop/prestashop.plugin.test.tsx` — smoke that the plugin object has the expected fields and that `getCallbackUrlDefault()` returns origin in jsdom.

7.3 `plugins/allegro/allegro.plugin.test.tsx` — smoke.

7.4 Update `features/connections/components/platform-picker.test.tsx` — existing test renders both cards through provider mock. Adjust setup to wrap in `<PluginRegistryProvider plugins={[prestashopPlugin, allegroPlugin]}>` or extend `renderWithProviders` to take a `plugins?` option.

7.5 Update `features/connections/components/create-connection-form.test.tsx` and `features/connections/components/EditConnectionForm.test.tsx` — same provider wrap.

7.6 Update `features/connections/components/ConnectionActionsPanel.test.tsx` — add a case asserting that "Configure webhooks" renders for prestashop and NOT for allegro.

7.7 Update `pages/connections/connections-list-page.test.tsx` if it exists — verify filter dropdown options come from registry.

**Decision on `renderWithProviders` extension**: add an optional `plugins?: PlatformPlugin[]` parameter that defaults to `IN_TREE_PLUGINS`. Tests that need a non-default registry pass it explicitly. This minimizes per-test boilerplate.

### Step 8 — Quality gate + commit

```bash
pnpm lint        # zero errors
pnpm type-check  # zero errors
pnpm test        # all passing
```

Conventional commit (single commit per scope):

```
refactor(web): open platformType union + introduce plugin registry (#578, #579)

D3 + D4 of Modularity Thread D. PlatformType becomes an opaque string;
platform-specific UI dispatches through a new in-tree plugin registry
(apps/web/src/plugins/) instead of platformType === '…' literal checks.
ESLint rule prevents the literal-equality dispatch from coming back.

Mirrors the BE pattern from #572/#576/#577.
```

## Validation

- **Architecture**: dependency direction unchanged. `shared/plugins/` exports types + provider/hooks; `plugins/` (new top-level) is the composition layer that imports features; `features/` consume registry via `shared/plugins/`. No cycles.
- **Naming**: matches FE conventions (`*.tsx` PascalCase exports for components, `use-*.ts` for hooks, `*.test.tsx` colocated).
- **Testing**: unit tests for the new registry plus updated tests for migrated components.
- **Security**: no new request paths, no new credential handling. Same auth gates.
- **Lint**: new `no-restricted-syntax` rule lands the cross-cutting guard suggested by #546 (FE-side only — backend-side `platformType` literal dispatch is handled by Thread E).

## Risks & open questions

- **Form-type leakage**: the `EditConnectionStructuredSection` plugin slot's `form` prop is the weakest static-typing point (see "Note on the form prop" above). If reviewer pushes back, alternative is to hoist `EditConnectionFormValues` into `shared/forms/`. I'd prefer to land (a) and defer (b) until plugin authors hit it in practice.
- **Plugin import in tests**: `renderWithProviders` will now default to `IN_TREE_PLUGINS`. Tests that previously rendered components without the provider will need updating. Failure mode is a clear error message from `usePlugins()` — should be a fast fix.
- **`mapping.platformType.toLowerCase()` on `listing-detail-page.tsx:119`**: dropping `toLowerCase()` assumes BE always returns canonical lowercase. Spot-checked the BE `IdentifierMapping.platformType` denormalization in `architecture-overview.md:747` — denormalized from `Connection.platformType` which is always lowercase. Safe to drop.
- **Backwards compat**: dropping the `c.platformType === 'allegro'` arm in `CreateOfferWizard.tsx:302` relies on every Allegro connection having `supportedCapabilities: ['OrderSource', 'OfferManager']`. This was set in `apps/api/src/integrations/allegro/allegro-integration.module.ts` since #570/#571. Existing connections in DB inherit the metadata at request time (resolved live from `AdapterRegistryService`), so no migration is needed.

## Out-of-scope follow-ups (not this PR)

- #580 (D5): `PromptTemplateChannelValues` closed union — same shape, different feature.
- #607 (H4): `shared/` contains marketplace-specific code — broader refactor.
- #608 (H5): `CreateOfferWizard` Allegro-shaped — broader refactor.
- Lazy-loading plugin chunks (Modularity Thread H milestone 3 — out-of-tree plugins).

## Post-implementation deltas from tech-review

- `CredentialsPanel` moved from a flag (`supportsCredentialRotation`) into a full plugin slot (`CredentialsPanel?: ComponentType<{ connection }>`). The rotation form was hardcoded with PrestaShop-specific labels and the `webserviceApiKey` payload — gating that UI on a generic flag would mislabel it for any future plugin opting in. The PS plugin now contributes `PrestashopCredentialsPanel` directly; the form falls back to a generic read-only affordance when no plugin contributes one.
- `requiresOAuthRedirect` renamed to `requiresExternalAuthRedirect` — non-OAuth redirect flows (magic link, device-code) can opt into the same UX without the flag name lying.
- Plugin slot prop names dropped the `EditConnection` prefix: `EditConnectionStructuredSectionProps` → `StructuredConfigSectionProps`, `EditConnectionExtraSectionProps` → `ExtraConfigSectionProps`. Plugin field names followed: `EditConnectionStructuredSection` → `StructuredConfigSection`, `EditConnectionExtraSection` → `ExtraConfigSection`.
- `PluginRegistryProvider` now throws on duplicate `platformType` keys at mount time via a `useMemo` guard — silent shadowing was the previous failure mode.
- ESLint rule for `platformType` literal-equality now carries a comment explaining the deliberate scope (member-access vs literal only; standalone-variable comparisons in platform-specific helpers are exempt).
- Plugin smoke tests added at `plugins/{prestashop,allegro}/{name}.plugin.test.tsx`.
- `docs/frontend-architecture.md` now explicitly documents the `shared/plugins/` → `features/connections/api/` type-import exemption alongside the dependency rules.
