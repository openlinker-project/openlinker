# Implementation Plan: Move plugin-specific connection-config assembly behind a plugin slot (#1330)

**Date**: 2026-07-02
**Status**: Ready for Review
**Estimated Effort**: 1-1.5 days
**Base branch**: `1311-ksef-platnosc-plan` (PR #1317) - this work refactors files that PR introduces, so it stacks on that branch and merges after it.

---

## 1. Task Summary

**Objective**: Introduce a plugin-contract seam for per-platform connection-config assembly in `apps/web`, and move every KSeF-named config module out of the shared `features/connections` feature into the `plugins/ksef` slice.

**Context**: KSeF-specific config assembly has accumulated inside the shared connections feature (`ksef-seller-config.ts`, `ksef-payment-config.ts`, `ksef-nrb.ts`, `ksef-nip.ts`, KSeF value sets in `ksef-setup.schema.ts`, KSeF fields + superRefine + merge clauses in `edit-connection.schema.ts`, `readKsef*` hydration in `EditConnectionForm.tsx`). Each addition followed the existing precedent, so it is consistent - but the pattern grows the shared feature per platform instead of the platform's plugin. Raised as a SUGGESTION in the PR #1317 review; #1330 asks for the seam before a third platform needs structured config editing.

**Classification**: Frontend (plugin contract + feature refactor). No backend, no API surface, no persisted-config shape changes.

---

## 2. Scope & Non-Goals

### In Scope

- New `PlatformContribution.connectionConfig` slot (schema fragment + read-side hydration + write-side assembly) in `shared/plugins/plugin.types.ts`.
- `PluginEditConnectionFields` declaration-merging interface so plugin-contributed form fields stay statically typed (mirrors the `PluginApiNamespaces` precedent, #605).
- Host consumption in `edit-connection.schema.ts` (`buildEditConnectionSchema`, `mergeStructuredIntoConfig` third param) and `EditConnectionForm.tsx` (composed resolver, hydration spread).
- Move ALL KSeF-named files out of `features/connections` into `plugins/ksef`: the four assembly/helper modules, the setup wizard (schema + form + test), and the setup page (from `pages/connections`, because pages cannot import plugins).
- New `plugins/ksef/ksef-connection-config.ts` contribution implementing the slot from the moved code.
- Remove KSeF re-exports from the `features/connections` barrel; relocate KSeF test cases from `edit-connection.schema.test.ts` to a plugin-local spec with identical assertions.

### Out of Scope (explicit non-goals)

- Migrating the OTHER platforms' inline config fields (Allegro `sellerDefaults`, Subiekt, InPost, WooCommerce, PrestaShop, Infakt) to the new slot. They stay inline in the shared schema; each is a mechanical follow-up once the seam exists. AC-3 of #1330 targets platform-named **files**, and after this change none remain.
- Any change to persisted config shapes (`config.seller`, `config.payment`, `config.env`, `config.contextIdentifier`) or to the BE shape validator.
- Changes to the create-connection generic form or to `shared/plugins`' ESLint exemption.

### Constraints

- **Per-keystroke partial-patch semantics must be preserved verbatim** (`applyKsefSellerToConfig` / `applyKsefPaymentToConfig` merge single-field patches against existing config without dropping sibling leaves - the exact bug class found during #1311 smoke testing). The moved code is not rewritten, only relocated.
- Existing edit-connection behavior covered by current tests must stay green (AC-4); KSeF-specific cases relocate with unchanged assertions.
- ESLint boundaries: plugins import features only via the barrel; features/pages never import `plugins/`; `shared/plugins` may type-import only `Connection` + `EditConnectionFormValues` from `features/connections`.

---

## 3. Architecture Mapping

**Target Layer**: `apps/web` only - `shared/plugins` (contract), `features/connections` (host consumption), `plugins/ksef` (contribution), `pages/connections` (one deletion).

**Existing patterns reused**:
- `PlatformContribution` render slots (`StructuredConfigSection`, `ExtraConfigSection`) - the new slot sits at the same altitude, resolved at render time via `usePlatform(connection.platformType)`.
- `PluginApiNamespaces` TS declaration merging (#605) - reused for form-field typing.
- `syncStructuredToJson` / `mergeStructuredIntoConfig` single-JSON-payload flow - unchanged in shape; gains a contribution pass-through.

**New components**:
- `ConnectionConfigContribution` interface + `PluginEditConnectionFields` merging interface (`shared/plugins`).
- `buildEditConnectionSchema(contribution?)` factory (`features/connections`).
- `ksefConnectionConfig` contribution object (`plugins/ksef`).

**Why the composition happens at render time**: the edit form edits exactly one connection of one `platformType`, so only that platform's fragment needs to be in the resolver schema. This avoids the forbidden `features -> plugins` import that a module-load composition would require, and matches how `StructuredConfigSection` is already resolved.

---

## 4. Current-State Inventory (what moves, what changes)

| File (today) | KSeF content | Disposition |
|---|---|---|
| `features/connections/components/ksef-nip.ts` | `normalizeNip` | MOVE -> `plugins/ksef/lib/ksef-nip.ts` |
| `features/connections/components/ksef-nrb.ts` | `normalizeNrRb` | MOVE -> `plugins/ksef/lib/ksef-nrb.ts` |
| `features/connections/components/ksef-seller-config.ts` | `applyKsefSellerToConfig` | MOVE -> `plugins/ksef/lib/ksef-seller-config.ts` |
| `features/connections/components/ksef-payment-config.ts` | `applyKsefPaymentToConfig` | MOVE -> `plugins/ksef/lib/ksef-payment-config.ts` |
| `features/connections/components/ksef-setup.schema.ts` | wizard schema + `KSEF_ENVIRONMENT_VALUES` / `KSEF_AUTH_TYPE_VALUES` / `KSEF_FORMA_PLATNOSCI_VALUES` + `toCreateConnectionInput` | MOVE -> `plugins/ksef/components/ksef-setup.schema.ts` (value sets may split into `plugins/ksef/lib/ksef-values.ts` if cleaner) |
| `features/connections/components/ksef-setup-form.tsx` + `.test.tsx` | create wizard | MOVE -> `plugins/ksef/components/`; deep hook import `../hooks/use-create-connection-mutation` becomes a barrel import (export `useCreateConnectionMutation` + `CreateConnectionInput` from the barrel if not already) |
| `pages/connections/ksef-setup-page.tsx` | page wrapper | MOVE -> `plugins/ksef/components/ksef-setup-page.tsx` (pages cannot import plugins; the plugin route lazy-imports the plugin-local page instead). Delete the pages module. |
| `features/connections/components/edit-connection.schema.ts` | KSeF Zod fields (`ksefEnvironment`, 7x `seller*`, `contextIdentifier`, 7x `payment*`), whole `superRefine` (both checks are KSeF), KSeF keys on `StructuredConfigPatch`, KSeF merge clauses (env, seller, payment, contextIdentifier) | EDIT - strip KSeF, add `buildEditConnectionSchema`, thread contribution into `mergeStructuredIntoConfig` |
| `features/connections/components/EditConnectionForm.tsx` | `readKsefEnvironment` / `readKsefSeller` / `readKsefPayment`, KSeF defaults spread, KSeF entries in `StructuredField` union, `KSEF_FORMA_PLATNOSCI_VALUES` import | EDIT - strip KSeF, compose schema + hydration from `plugin?.connectionConfig` |
| `features/connections/index.ts` | KSeF enum re-exports (lines 42-51) | EDIT - remove (plugin imports locally); add `useCreateConnectionMutation` export |
| `features/connections/components/edit-connection.schema.test.ts` | KSeF field/merge/skonto/NRB cases | EDIT - move KSeF cases to plugin-local spec, keep non-KSeF cases |
| `plugins/ksef/components/ksef-structured-section.tsx` | imports value sets from the barrel | EDIT - import from plugin-local module |
| `plugins/ksef/index.ts` | `definePlugin` bag | EDIT - add `connectionConfig: ksefConnectionConfig` |
| `plugins/ksef/ksef-setup.route.tsx` | lazy-imports `pages/connections/ksef-setup-page` | EDIT - lazy-import plugin-local page |

Verified: no consumer outside `features/connections` + `plugins/ksef` imports any of the KSeF modules (grep over `apps/web/src`).

---

## 5. Questions & Assumptions

### Assumptions (safe defaults)

1. **Setup wizard moves with the value sets.** The issue lists `ksef-setup.schema.ts` for its value sets; since features cannot import plugins, leaving the wizard in `features/connections` while the value sets move would force duplication. Moving the whole wizard (schema + form + page) into `plugins/ksef` is the only split that satisfies AC-3 without duplication. Other platforms' wizards (infakt, woocommerce) stay where they are - they migrate when their platform does.
2. **Declaration merging over index-signature widening** for `EditConnectionFormValues`. Keeps `form.register('sellerNip')` etc. statically typed inside the plugin section; follows the `PluginApiNamespaces` precedent. Fields merged in must be optional so base-only usage is unaffected.
3. **`mergeStructuredIntoConfig` gains an optional third parameter** (the contribution) rather than the host chaining a second call, so there stays exactly one write path into `configText` and the existing whole-object sync helpers keep working unchanged.
4. **`editConnectionSchema` (no-contribution) stays exported** as `buildEditConnectionSchema()` output for the existing non-KSeF schema tests and any external type derivations.
5. The `zodResolver(composedSchema)` result needs a narrowing cast to `Resolver<EditConnectionFormValues, ...>` because the composed schema's static type is opaque at the host. One cast, commented, at the single `useForm` call site.

### Open Questions (non-blocking)

- Whether `lib/` is acceptable as the plugin-slice subdirectory for non-component helpers. `plugins/<name>/` has no canonical-subdirectory ESLint constraint (that set applies to features), and `lib/` matches the feature convention - assumed yes.

---

## 6. Proposed Implementation Plan

### Phase 1 - Contract seam (`shared/plugins`)

1. **Define the contribution types** - `apps/web/src/shared/plugins/plugin.types.ts`
   - Add:
     ```ts
     export interface ConnectionConfigContribution {
       /** Zod raw shape merged into the edit-connection schema for this platform's connections. */
       schemaShape: ZodRawShape;
       /** Optional cross-field checks applied via superRefine on the composed schema. */
       superRefine?: (values: Record<string, unknown>, ctx: RefinementCtx) => void;
       /** Hydrate this platform's form fields from a stored config (read side). */
       readConfigToForm: (config: Record<string, unknown>) => Partial<EditConnectionFormValues>;
       /**
        * Merge a PARTIAL structured patch into config (write side). Called per
        * keystroke with single-field patches - MUST NOT drop sibling leaves
        * absent from the patch, and MUST preserve unknown config keys.
        */
       applyToConfig: (config: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>;
     }
     ```
   - Add slot `connectionConfig?: ConnectionConfigContribution` to `PlatformContribution` with a doc row explaining consumed-by (`EditConnectionForm`) and absence semantics (platform has no structured-config fields beyond the shared base).
   - Add the empty merging interface, in `plugin.types.ts` or a sibling file:
     ```ts
     /** Plugin-contributed edit-connection form fields (TS declaration merging, mirrors PluginApiNamespaces). */
     export interface PluginEditConnectionFields {}
     ```
   - **Acceptance**: `pnpm --filter web type-check` passes; no runtime change.

### Phase 2 - Host consumption (`features/connections`)

2. **Refactor `edit-connection.schema.ts`**
   - Delete KSeF imports, the 15 KSeF field declarations, the whole `superRefine` block (both checks are KSeF-only - the base becomes a plain `z.object`), the KSeF keys + doc comments on `StructuredConfigPatch`, and the four KSeF merge clauses (env, seller-assembly, payment-assembly, contextIdentifier).
   - Add `buildEditConnectionSchema(contribution?: ConnectionConfigContribution)`: extends the base object with `contribution.schemaShape` and chains `contribution.superRefine` when present; `export const editConnectionSchema = buildEditConnectionSchema();` keeps the existing export working.
   - Re-type `EditConnectionFormValues = z.input<typeof editConnectionSchema> & Partial<PluginEditConnectionFields>` (and the analogous `EditConnectionFormSubmission`). Type-only import from `shared/plugins` - allowed direction (features -> shared).
   - `mergeStructuredIntoConfig(base, structured, contribution?)`: after the existing clauses, `return contribution ? contribution.applyToConfig(next, structured) : next;`.
   - **Acceptance**: file contains zero `ksef`/`Ksef`/`KSEF` tokens; non-KSeF schema tests pass unchanged.

3. **Refactor `EditConnectionForm.tsx`**
   - Delete `readKsefEnvironment` / `readKsefSeller` / `readKsefPayment`, the KSeF defaults spread, the `KSEF_FORMA_PLATNOSCI_VALUES` import, and the KSeF members of `StructuredField`.
   - `const connectionConfig = plugin?.connectionConfig;`
   - Resolver: `const schema = useMemo(() => buildEditConnectionSchema(connectionConfig), [connectionConfig]);` -> `resolver: zodResolver(schema) as Resolver<...>` (commented cast per assumption 5).
   - Defaults: append `...(connectionConfig?.readConfigToForm(connection.config) ?? {})` to the `defaultValues` object.
   - Thread `connectionConfig` as the third argument into every `mergeStructuredIntoConfig` call (`syncStructuredToJson` + the three whole-object sync helpers - harmless for non-overlapping platforms).
   - Widen `syncStructuredToJson`'s field parameter so plugin-contributed field names (present on `Path<EditConnectionFormValues>` via declaration merging) type-check at the `StructuredSection` call-site cast.
   - **Acceptance**: file contains zero KSeF tokens; form still renders/saves for a PrestaShop connection (existing tests).

4. **Trim the barrel** - `features/connections/index.ts`
   - Remove the KSeF enum re-export block; add `export { useCreateConnectionMutation } from './hooks/use-create-connection-mutation';` and ensure `CreateConnectionInput` is on the exported types list (needed by the moved wizard).
   - **Acceptance**: `pnpm --filter web lint` (barrel/deep-import rules) passes.

### Phase 3 - KSeF plugin slice (`plugins/ksef`)

5. **Move the four helper/assembly modules** to `plugins/ksef/lib/` via `git mv` (preserves history): `ksef-nip.ts`, `ksef-nrb.ts`, `ksef-seller-config.ts`, `ksef-payment-config.ts`. Update their file headers' `@module` tags; contents otherwise verbatim.

6. **Move the setup wizard**: `ksef-setup.schema.ts`, `ksef-setup-form.tsx`, `ksef-setup-form.test.tsx` -> `plugins/ksef/components/`. Fix imports: deep feature-internal imports (`../hooks/use-create-connection-mutation`, connection types) become barrel imports from `../../../features/connections`; shared/ui paths re-point.

7. **Move the setup page**: recreate `pages/connections/ksef-setup-page.tsx` as `plugins/ksef/components/ksef-setup-page.tsx` (verbatim content, adjusted imports); delete the pages module; update `ksef-setup.route.tsx`'s `lazy` to import the plugin-local page.
   - Note for the route-count contract tests: the route object count is unchanged (still lazy), so `route-lazy.test.ts` / `route-handle.test.ts` stay green.

8. **Create the contribution** - `plugins/ksef/ksef-connection-config.ts`
   - `ksefConnectionConfigShape` (ZodRawShape): the 15 field declarations moved verbatim from the shared schema (using local `normalizeNip` / `normalizeNrRb` / `KSEF_FORMA_PLATNOSCI_VALUES`).
   - `ksefSuperRefine`: the postal-code and skonto both-or-neither checks, moved verbatim.
   - `readKsefConfigToForm`: composition of the three `readKsef*` readers moved verbatim from `EditConnectionForm.tsx` (including the legacy flat `config.sellerNip` fallback).
   - `applyKsefConfig(config, patch)`: the env + contextIdentifier flat clauses moved from `mergeStructuredIntoConfig`, then the `applyKsefSellerToConfig` / `applyKsefPaymentToConfig` chaining moved verbatim (same set-or-delete copy-back semantics).
   - `export const ksefConnectionConfig: ConnectionConfigContribution = { ... }`.
   - Declaration-merging block:
     ```ts
     declare module '../../shared/plugins' {
       interface PluginEditConnectionFields {
         ksefEnvironment?: '' | 'test' | 'demo' | 'prod';
         sellerNip?: string;
         /* ... all 15 fields, all optional ... */
       }
     }
     ```
   - Wire `connectionConfig: ksefConnectionConfig` into the `platform` bag in `plugins/ksef/index.ts`.
   - **Acceptance**: editing a KSeF connection hydrates seller/payment fields, per-keystroke sync writes `config.seller`/`config.payment` without dropping siblings, submit round-trips - covered by the relocated tests.

9. **Re-point `ksef-structured-section.tsx`** (and `ksef-credentials-panel.tsx` if it uses `KSEF_AUTH_TYPE_VALUES`) to plugin-local value-set imports.

### Phase 4 - Tests & quality gate

10. **Relocate KSeF schema/merge tests**: move every KSeF-related case from `edit-connection.schema.test.ts` into `plugins/ksef/ksef-connection-config.test.ts`, exercising `buildEditConnectionSchema(ksefConnectionConfig)` and `mergeStructuredIntoConfig(base, patch, ksefConnectionConfig)` with **unchanged assertions** (NRB normalization inside the length bound, skonto pair anchoring, partial-patch sibling preservation, empty-leaf pruning, legacy `sellerNip` fallback hydration).
11. **Add one seam test**: a platform with no `connectionConfig` composes to the base schema, and `mergeStructuredIntoConfig` without a contribution leaves config untouched beyond base clauses (regression guard for the new optional param).
12. **Quality gate** (scoped, per resource constraints): `pnpm --filter web lint && pnpm --filter web type-check && pnpm --filter web test` - full-repo gate left to CI.

---

## 7. Alternatives Considered

1. **Render-slot-only (leave Zod fields + merge clauses in the shared schema, move only the helper files)** - rejected: fails AC-1 ("schema fragment ... per plugin") and leaves the growth pattern intact; the next platform would still edit three shared files.
2. **Index-signature widening of `EditConnectionFormValues`** (`& Record<string, unknown>`) instead of declaration merging - rejected: `Path<T>` degenerates to `string`, silently disabling field-name type-checking for every platform section; declaration merging keeps safety and has an in-repo precedent (#605).
3. **Build-time schema composition from the `plugins` array** - rejected: requires `features -> plugins` imports (ESLint-banned, inverts the dependency direction). Render-time composition via `usePlatform` matches the existing `StructuredConfigSection` altitude and needs only the one platform's fragment anyway.
4. **Keeping the setup wizard in `features/connections`** - rejected: it imports the value sets that must move, and features cannot import plugins; duplication of the value sets would drift.

---

## 8. Validation & Risks

- **Architecture compliance**: dependency direction preserved (`plugins -> features(barrel) -> shared`; `shared/plugins` keeps its two type-only imports; pages no longer reference KSeF). ESLint boundary rules are the enforcement.
- **Risk - per-keystroke sibling-drop regression** (#1311 lesson): mitigated by moving assembly code verbatim and relocating the tests that pin the partial-patch semantics.
- **Risk - resolver identity churn**: memoize the composed schema on the plugin reference (stable from the registry) so RHF's resolver isn't rebuilt per render.
- **Risk - declaration-merging block not in the import graph**: the merge lives in a module reachable from `plugins/ksef/index.ts`, which `plugins/index.ts` imports - same guarantee `apiNamespaces` relies on.
- **Risk - hidden consumer of a moved module**: grep sweep found none outside `features/connections` + `plugins/ksef`; `pnpm --filter web type-check` is the backstop.
- **Backward compatibility**: persisted config shapes and BE contracts untouched; a KSeF connection saved before this change hydrates identically (readers moved verbatim, including the legacy flat `sellerNip` fallback).

---

## 9. Testing Strategy & Acceptance Criteria

- **Unit (vitest)**: relocated KSeF schema/assembly cases (step 10); new seam tests (step 11); moved `ksef-setup-form.test.tsx` green from its new path; existing `ksef-structured-section.test.tsx` green with local imports.
- **Issue AC mapping**:
  - [ ] AC-1 seam defined: `ConnectionConfigContribution` + `PluginEditConnectionFields` in `shared/plugins`, consumed by `EditConnectionForm`/`buildEditConnectionSchema`.
  - [ ] AC-2 KSeF assembly lives in `plugins/ksef` (lib + components + contribution).
  - [ ] AC-3 `grep -ri ksef apps/web/src/features apps/web/src/pages` returns nothing; no platform-named config-assembly files in the shared module.
  - [ ] AC-4 existing edit-connection tests green (non-KSeF cases in place, KSeF cases relocated with identical assertions).

---

## 10. Alignment Checklist

- [x] Frontend dependency direction respected (`app -> pages -> features -> shared`; plugins via barrels)
- [x] Uses existing patterns (PlatformContribution slot, declaration merging, single `configText` write path)
- [x] No new global state; form state stays in RHF, composition at render time
- [x] Error handling unchanged (Zod messages move with their fields)
- [x] Testing strategy complete; per-keystroke regression class pinned by relocated tests
- [x] Naming conventions followed (kebab-case files, `*.schema.ts`, `*.test.tsx`)
- [x] Plan is execution-ready
