# Implementation Plan — #1096 Presta→marketplace offer-creation FE (Erli + capability-shaped bulk)

> Status: DRAFT (plan→review→fix cadence). Branch `1096-erli-offer-creation-fe`, worktree `/tmp/erli-wt/1096`. Scope: `apps/web` only (FE). Backend Erli `createOffer` is done (#984/#985).

## 1. Goal & framing

Add the FE surfaces to push a PrestaShop product onto an Erli connection (single + bulk), generalising the bulk flow off its Allegro hardcode the same way #608 generalised the single flow. The architectural spine is **define per-platform offer-creation UI at the plugin level; the host selects by `OfferManager` capability, never by literal `platformType`**.

Three deliverables:

1. **Single offer** — Erli registers `build.offerCreationWizard` → `ErliCreateOfferWizard`. No host change (launcher already resolves by `platformType`).
2. **Bulk** — new `build.bulkOfferConfigSection` plugin slot + app-tier resolver; `bulk-config-step.tsx` becomes a thin shell (capability-select connection + shared pricing/stock + resolved platform section). Migrate Allegro's delivery-policy/currency fields into Allegro's contribution. Erli ships a dispatch-time section.
3. **Entry point + picker modal + per-platform blockers** — capability-gated Products button (0 hidden / 1 direct / 2+ modal); plugin-contributed per-row blockers replacing the host `BulkRowBlocker` enum (serving both single + bulk).

Shared Erli field group (dispatch / images-note / category) extracted once and consumed by both the single wizard and the bulk section + a shared Zod slice. All wizard/section components lazy-loaded.

## 2. Key files surveyed (read before edit)

| Area | Path |
|---|---|
| Plugin contract | `apps/web/src/shared/plugins/plugin.types.ts` |
| Plugin registry | `apps/web/src/plugins/index.ts`, `define-plugin.ts`, `resolve-offer-creation-wizard.ts` |
| Erli plugin | `apps/web/src/plugins/erli/index.ts` |
| Allegro plugin | `apps/web/src/plugins/allegro/index.ts` |
| Single wizard | `apps/web/src/features/listings/components/AllegroCreateOfferWizard.tsx`, `OfferCreationLauncher.tsx`, `create-offer-fields.schema.ts` |
| Single resolver hook | `apps/web/src/app/plugin-bindings/use-offer-creation-wizard.ts` |
| Bulk wizard | `bulk-wizard.tsx`, `bulk-config-step.tsx`, `bulk-resolve-step.tsx`, `bulk-review-step.tsx`, `bulk-policy.ts`, `bulk-wizard.types.ts` |
| Bulk transport | `apps/web/src/features/listings/api/bulk-listings.types.ts` |
| Bulk page | `apps/web/src/pages/listings/bulk-create-wizard-page.tsx` |
| Entry point | `apps/web/src/pages/products/products-list-page.tsx` (~L31 cap, ~L178 navigate, ~L380 button) |
| Connections | `apps/web/src/features/connections/api/connections.types.ts`, `hooks/use-connections-query.ts` |
| Platform hooks | `apps/web/src/shared/plugins/use-platform.ts`, `use-platforms.ts` |
| Route + lazy | `apps/web/src/app/routes/listings.route.tsx`, `route-lazy.test.ts` |
| ESLint platformType ban | `.eslintrc.js:486-538` |
| BE Erli adapter (wire contract) | `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts`, `domain/types/erli-connection.types.ts` |

## 3. Backend wire contract (what the FE must produce — already implemented BE-side)

`ErliOfferManagerAdapter.createOffer` (single + bulk both flow through `OfferManagerPort.createOffer`):

- **price** — integer grosze, computed BE-side from the neutral `CreateOfferPrice` (`{ amount, currency }`). FE sends PLN amount as today. PLN-only; no currency choice for Erli.
- **stock** — neutral `stock` number.
- **images** — the Erli adapter reads images **only** from `cmd.overrides.imageUrls` (it does NOT self-source from master, unlike Allegro). **So the FE MUST populate `overrides.imageUrls` from the master product's `product.images` / variant images** — required, not optional. The server still sanitizes every URL (`sanitizeImageUrls` → `isSafePublicHttpsUrl`, drops non-https/internal-host), so forwarding master URLs is SSRF-safe; the FE never accepts operator-typed raw URLs. The `erli:missing-image` blocker counts these master image URLs (0 → block).
- **dispatchTime** — read from `overrides.platformParams.dispatchTime` as an object `{ period: number, unit?: 'hour'|'day'|'month' }`; falls back to `connection.config.defaultDispatchTime`. Erli fails closed if neither present.
- **category** — Allegro-id reuse (#985); resolved exactly as today via the same `resolveCategoriesBatch` / category resolution — no Erli-native picker.

`ErliConnectionConfig` (non-secret, on `connection.config`): `baseUrl?`, `defaultDispatchTime?: { unit?, period }`, `callbackBaseUrl?`. **No secrets** — `apiKey` lives in encrypted credentials, never on the FE `Connection` DTO.

**Implication:** the Erli sections send `dispatchTime` via `overrides.platformParams.dispatchTime` (bulk: `sharedConfig.overrides.platformParams.dispatchTime`, mirroring how Allegro sends `deliveryPolicyId`). Single wizard sends the same on `CreateOfferRequest.overrides.platformParams`.

## 4. Contract changes (`plugin.types.ts`)

> **CONSTRAINT (ESLint, verified):** `.eslintrc.js:155-172` restricts `shared/plugins/**` to type-importing ONLY `{Connection, EditConnectionFormValues, Role, ApiRequest, PluginApiNamespaces, CreateOfferRequest}` from `features/app` — any other feature/app import name is rejected by `importNamePattern`. Therefore every NEW contract type (form-values shape, blocker descriptor, validation input) MUST be **defined inside `shared/plugins`** (or use only `react`/`react-router` types). `features/listings` then imports these FROM `shared/plugins` (features→shared is allowed). I will NOT extend the allow-list — defining the types in the contract layer is the correct ownership. `StatusBadgeTone` lives in `shared/ui`; to avoid coupling the contract to UI, define a local `OfferBlockerTone` union in `shared/plugins` that structurally matches `StatusBadgeTone` (consumers cast at the chip render site, which already imports `shared/ui`).

> **DECISION — slot placement: `platform`, not `build` (resolves tech-review BLOCKING).** The issue's own tech-lead note demanded this be decided + documented. `bulkOfferConfigSection` and `offerValidation` are **render-time, per-platform UI affordances** — structurally identical to `StructuredConfigSection`/`ExtraConfigSection`, which live in `PlatformContribution` and resolve via `usePlatform(platformType)`. `offerCreationWizard` sits in `build` ONLY because its consumer (`OfferCreationLauncher`) is reached through the `app/`-tier `useOfferCreationWizard` hook to dodge a `features → plugins` import — a DI artifact, not a "render-time sections go in build" precedent. Our two new consumers (`bulk-config-step.tsx`, `bulk-review-step.tsx`, `ErliCreateOfferWizard`) all live in `features/`, and **`features/` may import `usePlatform`/`usePlatforms` from `shared/plugins` directly** (shared is importable by features — no boundary crossing, no `app/plugin-bindings` hook needed). So both new slots go in `PlatformContribution`, resolved via `usePlatform(connection.platformType).bulkOfferConfigSection` / `.offerValidation`. This matches the `StructuredConfigSection` precedent exactly and avoids inventing new `app/plugin-bindings` hooks. `offerCreationWizard` stays in `build` (unchanged — its launcher still uses the app-tier hook). A short comment in `plugin.types.ts` documents both placements and why they differ.

### 4a. `BulkOfferConfigSectionProps` + `BulkOfferConfigSectionContribution`

The bulk config section is a **build-time, content-only** contribution (sibling to `offerCreationWizard`), resolved by an app-tier hook. The host owns the connection picker + shared pricing/stock policy; the section renders ONLY the platform-specific fields, writing into the parent RHF form's open `platformParams` slot.

```ts
// shared/plugins/plugin.types.ts — owns the form-values contract.
export interface BulkConfigFormValues {
  // shared host slice
  pricingMode: 'use-master' | 'markup' | 'flat';
  markupPercent: string;
  flatPriceAmount: string;
  stockMode: 'use-master' | 'cap' | 'flat';
  capValue: string;
  flatStockValue: string;
  publishImmediately: boolean;
  generateDescription: boolean;
  currency: string;
  // open slot the platform section writes (deliveryPolicyId, dispatchTime, …)
  platformParams: Record<string, unknown>;
}
export interface BulkOfferConfigSectionProps {
  connection: Connection;             // allow-listed import — OK
  form: UseFormReturn<BulkConfigFormValues>;  // react-hook-form type — OK
}
/** Optional completeness gate the section exposes so the host can AND it into
 *  `canProceed` deterministically (NOT formState.isValid — see decision). */
export type BulkSectionIsComplete = (values: BulkConfigFormValues) => boolean;
// On PlatformContribution (render-time):
bulkOfferConfigSection?: {
  component: ComponentType<BulkOfferConfigSectionProps>;
  /** Pure predicate over current form values — host ANDs into canProceed. */
  isComplete: BulkSectionIsComplete;
};
```

> **Decision (RHF over render-prop):** `bulk-config-step.tsx` is currently `useState`-based, not RHF. To let a platform section register arbitrary fields without the host knowing them, convert the config step to a single React Hook Form keyed by `BulkConfigFormValues` (owned by the contract). The section receives `form` and registers its fields under `platformParams.*`. Matches the documented "RHF pattern: a component that takes the parent form and registers namespaced fields" (prestashop-structured-section precedent). Host serialises `platformParams` into `sharedConfig.overrides.platformParams` on submit — generic, no platform branch.
>
> **Validation threading (resolves tech-review IMPORTANT — single mechanism, no `formState.isValid`):** the host keeps its **explicit `canProceed` boolean** for the shared slice (pricing/stock regex, exactly as today — deterministic, already tested). The platform section additionally contributes a pure `isComplete(values): boolean` predicate alongside its `component`. Host `canProceed = sharedSliceValid && (section?.isComplete(form.getValues()) ?? true)`. We do NOT rely on `form.formState.isValid` (stale-until-touched under RHF, requires a resolver to be meaningful). The section renders its own per-field error affordances on its own; the `isComplete` predicate is the single gate the host consumes. Allegro `isComplete` = `Boolean(values.platformParams.deliveryPolicyId)`; Erli `isComplete` = dispatch period is a valid non-negative int. Form values still flow through one RHF instance for `watch`/`setValue` ergonomics; the gate is the explicit predicate, not RHF's lazy validity flag.

### 4b. Per-platform bulk-row + single-offer blockers (the OCP seam)

Replace the host-closed `BulkRowBlocker` union + `BLOCKER_CHIPS` map with a **plugin-declared blocker registry**, shared by single + bulk.

```ts
// shared/plugins/plugin.types.ts — owns the validation contract surface.
export type OfferBlockerTone = 'error' | 'info' | 'neutral' | 'review' | 'success' | 'warning'; // structurally == StatusBadgeTone
export interface OfferBlockerDescriptor {
  /** Stable blocker id, namespaced to avoid cross-plugin clash, e.g. 'allegro:needs-product-parameters'. */
  id: string;
  tone: OfferBlockerTone;
  label: string;
}
/** Neutral inputs a platform validator needs. Owned by the contract (NOT
 *  features/listings) so the ESLint pinhole isn't widened. The host maps its
 *  internal row state → this shape at the call site. */
export interface OfferRowValidationInput {
  /** Master images resolved for the row (Erli missing-image gate). */
  imageCount: number;
  /** Whether the row's submit category needs product params the operator hasn't supplied (Allegro). */
  needsProductParameters: boolean;
  /** Whether a catalogue card will be linked (Allegro exemption). */
  willLinkProductCard: boolean;
}
export interface OfferValidationContribution {
  /** Static descriptors so Review/single-wizard render chips for any platform generically. */
  blockers: readonly OfferBlockerDescriptor[];
  /** Pure fn returning the active PLATFORM-SPECIFIC blocker ids for a row. */
  validateRow: (input: OfferRowValidationInput) => string[];
}
// On PlatformContribution (render-time, resolved via usePlatform):
offerValidation?: OfferValidationContribution;
```

> The validation INPUT is a neutral, host-mapped shape (not the wizard's internal `BulkWizardRow`), so the contract owns it cleanly and the host translates its row → input at the call site. The Allegro validator returns `['allegro:needs-product-parameters']` when `needsProductParameters && !willLinkProductCard`; the Erli validator returns `['erli:missing-image']` when `imageCount === 0`.
>
> **Shared by BOTH single + bulk (resolves tech-review IMPORTANT — declared once):** the AC requires a marketplace declare its blockers once and have them serve both surfaces. So **`ErliCreateOfferWizard` MUST consume `usePlatform('erli').offerValidation.validateRow`** for its image gate — it does NOT re-inline a `imageCount===0` check. Same for `bulk-resolve-step`/`bulk-review-step`. The Erli image rule lives in exactly one place: the plugin's `offerValidation`. `platformType` is dropped from the contribution because `usePlatform` already keys on it (the bag is platform-scoped) — mirrors how `StructuredConfigSection` carries no `platformType`.

> **Decision (scope of the blocker refactor — pragmatic split):** The host currently owns BOTH platform-neutral blockers (`no-variant`, `no-ean`, `no-match`, `multi-match`, `no-master-price`, `no-master-stock`, `currency-mismatch`) and one Allegro-specific blocker (`needs-product-parameters`). A full migration of every blocker into plugins is a large rewrite of `bulk-policy.ts`/`computeBlockers` and risks Allegro regressions. The AC requires that **adding a new marketplace needs NO host enum/Review change** and that **Allegro's `needs-product-parameters` is migrated onto the mechanism**.
>
> Approach: keep the neutral price/stock/category blockers in the host as **generic, platform-agnostic** descriptors (they already are — every `OfferManager` marketplace needs a price, stock, and category). The neutral set stays the `as const` + union `BulkRowBlockerValues` pattern (engineering-standards §Union Types). Move only the **platform-specific** blockers (`needs-product-parameters` for Allegro; `missing-image` for Erli) into the `offerValidation` contribution; plugin blocker `id`s are **open-world namespaced strings** (`'erli:missing-image'`) — NOT a second closed union (same open-world stance as capability/platformType). The chip map merges host-neutral descriptors with plugin descriptors at render time. A new marketplace adds its own blockers via its plugin with zero host edits. This satisfies the AC ("no host enum entry for a new marketplace"; Allegro blocker migrated) without a risky full rewrite of `computeBlockers`.
>
> **`OfferBlockerTone`:** define a local union in `shared/plugins` structurally matching `StatusBadgeTone` (avoids `shared/plugins → shared/ui` coupling). The chip render site (`bulk-review-step`, already imports `shared/ui`) accepts it where `StatusBadgeTone` is expected (structurally identical).

> **Erli `missing-image` blocker** is the concrete Erli contribution, declared once in `plugins/erli`'s `offerValidation`: a row whose master product has zero usable images carries `erli:missing-image`. Consumed by bulk Review AND `ErliCreateOfferWizard` (no inline duplication — see §4b note above).

## 5. Implementation steps

### Phase A — Shared Erli field group + Zod slice (no behaviour change yet)
1. `features/listings/components/erli/erli-offer-fields.schema.ts` — Zod slice: `dispatchPeriod: number`, `dispatchUnit: 'hour'|'day'|'month'`, default-from-connection helper that **parses `connection.config.defaultDispatchTime` with Zod** (never trust the shape). Export `parseErliConfig(config: Record<string,unknown>)`, `toDispatchTimeParam(values)` → `{ period, unit }`.
2. `features/listings/components/erli/erli-dispatch-time-field.tsx` (kebab-case file, `ErliDispatchTimeField` export) — RHF field group taking `form` + `connection`; renders the dispatch dial (period seg buttons + unit select) per the mockup, with the "connection default" badge when unchanged. a11y (focus, radiogroup roles, `t(key, fallback)`), reduced-motion via CSS. **Content-only** — no Dialog.
3. Unit-test the schema/parse helpers (`erli-offer-fields.schema.test.ts`).

### Phase B — Single-offer Erli wizard (#608 slot — stays in `build`)
4. `features/listings/components/erli-create-offer-wizard.tsx` (kebab-case file, `ErliCreateOfferWizard` export) — content-only wizard (`OfferCreationWizardProps`). Steps: Variant → Offer details (title, category via existing resolve, price PLN, stock, description, dispatch via `ErliDispatchTimeField`, images-from-master note) → Review. No Policies step (Erli has none). Reuses existing hooks (`useCreateOfferMutation`, `useResolveCategoryQuery`, product queries). **Image gate consumes `usePlatform('erli').offerValidation.validateRow({ imageCount, … })`** — declared once in the plugin, NOT re-inlined. Submits `CreateOfferRequest` with `overrides.platformParams.dispatchTime` + `overrides.imageUrls` from master. Renders product content escaped (no `dangerouslySetInnerHTML`).
5. Register in `plugins/erli/index.ts`: `build.offerCreationWizard = { platformType: 'erli', component: ErliCreateOfferWizardLazy }` where `ErliCreateOfferWizardLazy = lazy(() => import('…/erli-create-offer-wizard').then(m => ({ default: m.ErliCreateOfferWizard })))`. Confirm `definePlugin` + `assertUniquePluginInvariants` pass.
6. **Suspense boundary:** the launcher's wizard-render site (`<Wizard ... />` in `OfferCreationLauncher`) wraps the contributed component in `<Suspense fallback={…}>`. Lazy component is component-lazy (not route-lazy) — `route-lazy.test.ts`'s `EXPECTED_LAZY_ROUTE_COUNT` is unaffected (no new route). Document the difference in the wizard file header.

### Phase C — Bulk contract slots on `PlatformContribution` (resolved via `usePlatform`)
7. Add `BulkConfigFormValues`, `BulkOfferConfigSectionProps`, `BulkSectionIsComplete`, `OfferBlockerTone`, `OfferBlockerDescriptor`, `OfferRowValidationInput`, `OfferValidationContribution` to `plugin.types.ts`. Add `bulkOfferConfigSection?` and `offerValidation?` to `PlatformContribution` (NOT `BuildContribution` — see §4 placement decision). Update `Platform` flattened type automatically (it spreads `PlatformContribution`). **No new `app/plugin-bindings` hooks** — `features/` consumes `usePlatform()` from `shared/plugins` directly (sanctioned: shared is importable by features). Update `frontend-architecture.md` §`PlatformContribution` slot reference table with the two new rows.

### Phase D — `bulk-config-step.tsx` → thin shell
8. Convert to one RHF form (`BulkConfigFormValues` = shared slice + `platformParams` object). Connection selection by **`OfferManager` capability** across ALL connections (drop `useConnectionsQuery({ platformType: 'allegro' })` → `useConnectionsQuery()` + `.filter(c => c.status==='active' && c.supportedCapabilities.includes('OfferManager'))`). Keep auto-select-when-1. Resolve the section via `usePlatform(connection.platformType)?.bulkOfferConfigSection`; render its `component` wrapped in `<Suspense fallback>`; fallback alert when the platform contributes none. Keep shared pricing/stock fieldsets + publish/AI toggles. `canProceed = sharedSliceValid && (section?.isComplete(values) ?? true)` — explicit predicate, NOT `formState.isValid`. On proceed, serialise `platformParams` into `BulkWizardConfig`.
9. `useSellerPoliciesQuery` import moves OUT of the host into Allegro's section.

### Phase E — Allegro + Erli bulk sections (migrate Allegro debt)
10. `plugins/allegro/components/allegro-bulk-config-section.tsx` — delivery-policy `<Select>` (via `useSellerPoliciesQuery`) + currency select; writes `platformParams.deliveryPolicyId` + sets `currency` on the parent form via `setValue`. Register `platform.bulkOfferConfigSection = { component: lazy(...), isComplete: (v) => Boolean(v.platformParams.deliveryPolicyId) }` in `plugins/allegro/index.ts`. Allegro bulk behaviour unchanged (delivery policy still threads to `sharedConfig.overrides.platformParams.deliveryPolicyId`).
11. `plugins/erli/components/erli-bulk-config-section.tsx` — `ErliDispatchTimeField` (shared) + the "no policies / PLN / images-required" note per mockup; writes `platformParams.dispatchTime`, fixes `currency='PLN'`. Register `platform.bulkOfferConfigSection = { component: lazy(...), isComplete: (v) => isValidDispatch(v.platformParams.dispatchTime) }` in `plugins/erli/index.ts`.
12. Thread `BulkWizardConfig`: replace the literal `deliveryPolicyId` field with a generic `platformParams: Record<string, unknown>`; keep `currency` (section-set, default PLN for neutral price compute). `bulk-wizard.tsx` submit: `sharedConfig.overrides.platformParams = config.platformParams` (generic — was `{ deliveryPolicyId }`). The neutral price computation reads `config.currency` exactly as today.

### Phase F — Per-platform blockers (the seam, both surfaces)
13. Keep neutral `BulkRowBlockerValues` as the host `as const` union; **remove only `needs-product-parameters`** from it and move it to Allegro's `offerValidation` (open-world string id `'allegro:needs-product-parameters'`). Add Erli's `'erli:missing-image'`. `bulk-review-step.tsx` builds `BLOCKER_CHIPS` from host-neutral descriptors merged with the resolved platform's `offerValidation.blockers` (via `usePlatform`) — no platform enum, no `useAllOfferValidations` needed (Review knows the batch's single connection → single platform). `bulk-resolve-step.tsx` (and the Review reconcile in `bulk-wizard.tsx`) call the resolved platform `validateRow(input)` and concat its ids onto the neutral `computeBlockers` output. `ErliCreateOfferWizard` calls the same `validateRow` for its image gate.
14. Verify `computeBlockers` neutral path unchanged for Allegro (regression guard via existing `bulk-policy.test.ts` + `bulk-resolve-step.test.tsx`).

### Phase G — Entry point + picker modal
15. `products-list-page.tsx`: import `useConnectionsQuery` + `usePlatforms`. Compute `offerManagerConnections = active ∧ supportedCapabilities.includes('OfferManager')`. 0 → hide the create action. 1 → button label `Create {platform.displayName} offers (N)` (display name via `usePlatform`) → navigate straight to wizard with `&connectionId=<id>`. 2+ → button `Create offers (N)` → open `MarketplacePickerModal`; on pick → navigate with `&connectionId=`. No literal platformType.
16. `pages/products/marketplace-picker-modal.tsx` — Dialog listing each OfferManager connection (name + platformType + adapterKey + `OfferManager` badge) per the picker mockup. a11y radiogroup, Cancel/Continue, loading/empty/error states.
17. `bulk-create-wizard-page.tsx` + `BulkWizard`: read `connectionId` from the URL and pre-select it in the config step (locked-in but operator can re-pick; auto when only 1 OfferManager connection). Pass preselected id into `BulkConfigStep`.
18. Update the navigate target in `handleSubmit` to include `connectionId` when known.

### Phase H — Tests + polish
19. Tests (Vitest + Testing Library, `renderWithProviders`):
    - `erli-create-offer-wizard.test.tsx` — renders dispatch field, missing-image gate (via `offerValidation`), submit payload shape (`platformParams.dispatchTime`).
    - `bulk-config-step.test.tsx` (update) — capability-based connection select; resolves Allegro section (delivery policy) vs Erli section (dispatch); `canProceed` honors section `isComplete`.
    - `products-list-page.test.tsx` (update) — 0 hidden / 1 direct-label+navigate / 2+ opens modal.
    - `marketplace-picker-modal.test.tsx` — lists connections, pick → continue.
    - `erli-offer-fields.schema.test.ts` — config parse + dispatch param mapping.
    - Blocker resolution test — Allegro `needs-product-parameters` + Erli `missing-image` resolve via plugin `offerValidation`, Review renders chips generically.
20. Update `bulk-wizard.tsx` page title to neutral ("Bulk marketplace offer creation") + Confirm copy "Create N {Marketplace} offers?".
21. **AC compliance — no-literal-platformType:** the scoped `pnpm --filter @openlinker/web lint` (§9) runs `no-restricted-syntax`, which fails on any `platformType === '…'` in `features|pages|app`. Grep the diff for the pattern before commit as a belt-and-suspenders.

## 6. OCP / no-literal-platformType compliance

- Entry point, config-step connection select, Review chips: all capability/registry-driven. No `platformType === '…'` in `features|pages|app`.
- New marketplace = 1 BE adapter + 1 FE plugin (`build.offerCreationWizard` + `platform.bulkOfferConfigSection` + `platform.offerValidation`), zero host edits.

## 7. Security (from review comment — all standing)

- Capability-gating is UX only; BE enforces `@Roles('admin')` + connection/capability + product scope. No reliance on FE gate.
- No secret read/rendered; `connection.config` stays non-secret (Erli: baseUrl/defaultDispatchTime/callbackBaseUrl).
- Product content rendered escaped; no `dangerouslySetInnerHTML`. Image-URL SSRF stays BE concern; FE forwards master images only.
- Keep `BULK_SELECTION_CAP = 100`.
- Parse `connection.config.defaultDispatchTime` with Zod before use (untyped `Record<string,unknown>`).

## 8. Risks / deferrals

- **Blocker refactor scope** (§4b decision) — pragmatic split (neutral blockers stay host; platform-specific move to plugins). Tech-review accepted the split rationale; full `computeBlockers` migration is an explicit non-goal.
- **RHF conversion of bulk-config-step** — touches the most-tested bulk component; mitigated by keeping the shared field semantics identical, gating on an explicit `canProceed` predicate (not `formState.isValid`), and updating tests.
- **Per-offer dispatch override** — v1 sources from connection default; per-offer override optional (mockup shows batch-level dial). Single wizard offers it; bulk is batch-level.
- **Currency threading** in the thin shell — Allegro section `setValue('currency', …)`; Erli fixes PLN; host default PLN. Neutral price compute reads `config.currency` unchanged.
- **Slot placement** (§4 decision) — `bulkOfferConfigSection`/`offerValidation` on `platform`; `offerCreationWizard` stays on `build`. Documented divergence in `plugin.types.ts` + `frontend-architecture.md` slot tables.

## 9. Quality gate (scoped — resource-constrained)

`pnpm --filter @openlinker/web lint && pnpm --filter @openlinker/web type-check && pnpm --filter @openlinker/web test`. If TS6305: build `@openlinker/core`, `@openlinker/shared`, `@openlinker/plugin-sdk` dists first.
