# Implementation Plan — Open `PromptTemplateChannelValues` (#580)

## Goal

Close D5 of Modularity Thread D. Today `PromptTemplateChannelValues = ['prestashop', 'allegro'] as const` lives in `libs/core/src/ai/domain/types/prompt-template.types.ts` as a closed union. Plugin authors can't add a third channel (`'shopify'`, `'amazon'`) without editing core. Same shape problem #576 solved for `Capability` and #578/#579 solved for `platformType` — flip channel to an open `string` axis.

## Layer

**CORE (AI) + Interface (apps/api DTO) + Frontend.** No migration — the `prompt_templates.channel` column is already a nullable `VARCHAR`, so widening the type at the application layer is a pure type/runtime-validation change.

## Non-goals

- **DB migration**: the channel column is already a string; no schema change needed.
- **Backwards-compat shims**: rows with `'prestashop'`/`'allegro'` continue to work transparently (the type only widens — never narrows).
- **Backend-side "registered platforms" registry for channel validation**: the AI domain should stay decoupled from the integrations registry — channel is opaque at the AI layer (same as `platformType` on `Connection` after #578/#579). Cross-validation (rejecting channels with no registered platform) would couple AI to integrations and isn't needed for MVP.
- **Renaming the type**: `PromptTemplateChannel` stays as a named alias for documentation/readability; it just resolves to `string` instead of a closed literal union. Mirrors how `platformType` stays typed as `string` rather than getting renamed.
- **Removing the `'master'` UI marker**: the FE schema's `'master'` sentinel for the channel dropdown ("apply to all channels" — represented as `channel = null` server-side) stays. Only the per-platform options open up.

## Research summary

### Closed-union surface today

The `PromptTemplateChannelValues = ['prestashop', 'allegro'] as const` literal + derived `PromptTemplateChannel` type spreads across **23 BE files** (libs/core/ai + libs/core/content + apps/api) and **9 FE files** (apps/web/features/{ai-prompt-templates,content,prompt-templates} + apps/web/pages):

- **Domain** (libs/core/src/ai/domain): `prompt-template.types.ts` (declaration), `prompt-template.entity.ts`, `prompt-template-not-found.exception.ts`, `cannot-archive-published-template.exception.ts`, `prompt-template-repository.port.ts` (8 occurrences).
- **Application** (libs/core/src/ai/application): `prompt-template-commands.types.ts`, `prompt-template.service.interface.ts`, `prompt-template.service.ts`.
- **Infrastructure** (libs/core/src/ai/infrastructure): `prompt-template.repository.ts` — has the runtime narrowing helper `asChannel(value)` that filters via `PromptTemplateChannelValues.includes(...)`.
- **Cross-context** (libs/core/src/content): `content-suggestion.types.ts` (channel command + result fields).
- **Interface DTO** (apps/api): `suggest-content.dto.ts` — `@IsIn(PromptTemplateChannelValues as unknown as string[])` validator on the inbound `channel` field.
- **FE types** (apps/web): two duplicates of `PromptTemplateChannelValues` — one in `features/content/api/content.types.ts:14-15`, one in `features/prompt-templates/api/prompt-templates.types.ts:14-15`. Plus a `content.utils.ts:resolveSuggestChannel` that narrows a runtime `platformType` against the closed list.
- **FE schema** (apps/web): `new-prompt-template.schema.ts` has `ChannelSelectValues = ['master', ...PromptTemplateChannelValues] as const` — Zod validator for the create-form select. List page has a hardcoded `channelLabel(channel)` switch over the two known values.

### Reference patterns to mirror

- **#576 capability open-world**: `CoreCapabilityValues` stays as a closed enum for the well-known set, but `AdapterMetadata.supportedCapabilities` and `Connection.enabledCapabilities` accept `CoreCapability | string`. The HTTP DTOs are NOT yet runtime-aware (still strict on `CoreCapabilityValues`) — flagged as a follow-up.
- **#578/#579 platformType open-world**: `platformType: string` end-to-end. `CreateConnectionDto.platformType` validated as `@IsString() @IsNotEmpty()` only — no allowlist. FE renders per-platform UI via the runtime plugin registry (`usePlugin(platformType)` / `usePlugins()`).

The pattern that fits #580 most cleanly is **#578/#579 (full open-string)** — channel is an opaque platform identifier, no need for a closed core enum at all.

## Design

### Backend (libs/core/src/ai)

**`domain/types/prompt-template.types.ts`** — keep `PromptTemplateChannel` as a named alias, drop the closed enum:

```ts
/**
 * Channel scoping. `null` channel rows are "master" / generic templates that
 * apply when no channel-specific override is published. Values are opaque
 * platform identifiers (matches `connection.platformType` semantics —
 * open-world per #578/#579).
 *
 * Historically a closed union of `['prestashop', 'allegro']` (#580). Plugin
 * authors can now author templates against their own channel without
 * editing core — channel is just a string, validated by format at the DTO
 * boundary, not by membership in a core enum.
 */
export type PromptTemplateChannel = string;
```

The `PromptTemplateChannelValues` array is **deleted from the domain**. The runtime allowlist no longer exists at the core layer.

**`infrastructure/persistence/repositories/prompt-template.repository.ts`** — the `asChannel(value)` helper currently does `PromptTemplateChannelValues.includes(value as PromptTemplateChannel) ? (value as PromptTemplateChannel) : null`. With channel = string, the helper simplifies to `value ?? null` (the `null` ⇄ `'master'` distinction remains). Net deletion.

All other domain/application/infrastructure files that import `PromptTemplateChannel` keep working unchanged because the type widens to `string`.

### Interface (apps/api)

**`apps/api/src/content/http/dto/suggest-content.dto.ts`** — replace `@IsIn(PromptTemplateChannelValues)` with the **exact same validator shape** that `CreateConnectionDto.platformType` uses (`apps/api/src/integrations/http/dto/create-connection.dto.ts:60-62`). Mirroring the precedent verbatim keeps the open-world string axis uniformly validated across the codebase — every plugin-extensible string axis carries the same DTO shape, which is also the shape a plugin author can copy:

```ts
@ApiPropertyOptional({
  description:
    'Optional channel scoping. Matches `connection.platformType` for ' +
    'channel-specific templates (e.g. "allegro"). Null/omitted resolves ' +
    'to the master template. Validated only by type — channel is ' +
    'open-world per #580.',
  example: 'allegro',
})
@IsOptional()
@IsString()
@IsNotEmpty()
channel?: string | null;
```

No imported `PromptTemplateChannelValues`; no `@IsIn`; no length cap. A defense-in-depth `@MaxLength(N)` cap on plugin-extensible string axes (channel, `platformType`, `enabledCapabilities`) is a separate cross-cutting concern — out of scope here so we don't drift from the precedent; should be tackled as one PR across all the open-world string fields if it lands.

### Frontend (apps/web)

The FE has two duplicate `PromptTemplateChannelValues` declarations — one in `features/content/api/content.types.ts`, one in `features/prompt-templates/api/prompt-templates.types.ts`. Both become:

```ts
export type PromptTemplateChannel = string;
```

(`PromptTemplateChannelValues` deleted from both.)

**`features/content/api/content.utils.ts:resolveSuggestChannel`** — currently narrows a runtime `platformType` against the closed list:

```ts
export function resolveSuggestChannel(platformType: string): PromptTemplateChannel | null {
  return (PromptTemplateChannelValues as readonly string[]).includes(platformType)
    ? (platformType as PromptTemplateChannel)
    : null;
}
```

With the type open, the function reduces to a passthrough: `return platformType || null`. But the function's intent was to translate "no recognised platform → master template" — that protection disappears in an open world. Cleanest fix: delete the helper entirely and pass `platformType` directly at the (one) call site, which now means "channel = this connection's platformType". The semantic is identical: a registered plugin's `platformType` is, by definition, a valid channel.

**`features/prompt-templates/components/new-prompt-template.schema.ts`** — currently:

```ts
const ChannelSelectValues = ['master', ...PromptTemplateChannelValues] as const;
```

The picker needs runtime options now. Two approaches:

1. **Runtime-derived from the plugin registry**: `['master', ...usePlugins().map(p => p.platformType)]`. Means the schema becomes a hook (`useNewPromptTemplateSchema`) since it depends on registry state.
2. **Free-text input + helper hint**: drop the `<Select>` and use a regular `<Input>` for channel, with the current list as a `<datalist>` autocomplete from the plugin registry.

Option 1 keeps the existing UX (closed dropdown of known platforms + "master") while staying plugin-aware. Option 2 is more "truly open" but worse UX. Going with **option 1** — same model the rest of FE uses for platform-scoped pickers (`PlatformPicker` in `features/connections` iterates `usePlugins()`).

**`features/prompt-templates/components/new-prompt-template.schema.ts`** becomes a hook `useNewPromptTemplateSchema()` returning the schema with runtime-derived channel union. Existing Zod-as-resolver wiring at the form site picks up the hooked schema.

**`pages/prompt-templates/prompt-templates-list-page.tsx:channelLabel`** — current implementation switches over the two known values. Replace with `usePlugin(channel)?.displayName ?? toTitleCase(channel)` so unknown channels surface with a readable fallback instead of falling through to a default branch.

### Cross-context (libs/core/src/content)

**`content-suggestion.types.ts`** — `channel: PromptTemplateChannel | null` works unchanged (type widens). No edit needed beyond confirming the import still resolves.

### What doesn't change

- The `prompt_templates.channel` DB column (already nullable `VARCHAR`).
- The `null` channel = "master template" convention.
- The four partial unique indexes on `(key, channel)` honouring NULL-distinct semantics.
- The publish-archive-on-conflict transactional semantics.
- The render-template substitution engine.
- The AI provider routing layer (#451/#452).

## Implementation steps

### Step 1 — Open the domain type
- `libs/core/src/ai/domain/types/prompt-template.types.ts` — delete `PromptTemplateChannelValues`; redefine `PromptTemplateChannel = string` with the new docblock.

### Step 2 — Simplify the runtime narrowing
- `libs/core/src/ai/infrastructure/persistence/repositories/prompt-template.repository.ts` — delete `asChannel(value)`; replace its 4 call sites with `value ?? null`.

### Step 3 — Open the HTTP DTO
- `apps/api/src/content/http/dto/suggest-content.dto.ts` — drop `PromptTemplateChannelValues` import + `@IsIn` decorator; replace with `@IsString() @MaxLength(64)`. Update Swagger description.

### Step 4 — Open the FE type duplicates
- `apps/web/src/features/content/api/content.types.ts` — delete `PromptTemplateChannelValues`; `PromptTemplateChannel = string`.
- `apps/web/src/features/prompt-templates/api/prompt-templates.types.ts` — same.

### Step 5 — Simplify or delete `resolveSuggestChannel`
- `apps/web/src/features/content/api/content.utils.ts` — delete `resolveSuggestChannel` (passthrough is meaningless). Update the single call site to use `connection.platformType` directly.
- `apps/web/src/features/content/index.ts` barrel — drop the `resolveSuggestChannel` re-export.

### Step 6 — Make the FE schema registry-aware
- `apps/web/src/features/prompt-templates/components/new-prompt-template.schema.ts` — convert the static `ChannelSelectValues` to a hook `useNewPromptTemplateSchema()` that resolves channel options from `usePlugins()`.
- Update the form component using the schema to call the hook.

### Step 7 — Label unknown channels gracefully
- `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx:channelLabel` — replace the switch with `usePlugin(channel)?.displayName ?? humaniseChannel(channel)`.

### Step 8 — Tests

Pin each assertion to a specific spec so the test-side scope is unambiguous:

- **Repository (read path)** — `libs/core/src/ai/infrastructure/persistence/repositories/prompt-template.repository.spec.ts` (or its int-spec equivalent if the unit suite mocks the ORM): drop tests that asserted the closed-set filtering of `asChannel`; add a test that confirms a future channel (e.g. `'shopify'`) round-trips through `save({ channel: 'shopify' })` → `findByKey` / `findVersions` and returns `'shopify'` intact rather than silently becoming `null`. This is the load-bearing test that the open-world widening actually works at the DB read boundary.
- **HTTP DTO** — `apps/api/src/content/http/dto/suggest-content.dto.spec.ts` (create if absent — small file, ~30 lines): three cases — accepts `'allegro'` (legacy value), accepts `'shopify'` (future plugin value), rejects empty string. Verifies the new `@IsString() @IsNotEmpty()` shape matches `CreateConnectionDto.platformType` behaviour.
- **FE new-template dialog** — `apps/web/src/features/prompt-templates/components/new-prompt-template-dialog.test.tsx`: keep the existing happy-path test but assert the channel select renders one option per registered plugin in the test fixture, NOT the closed `['prestashop', 'allegro']` set. Add a fixture plugin (e.g. `'shopify'`) to `IN_TREE_PLUGINS` via `renderWithProviders({ plugins: [...] })` to prove the picker is registry-driven.
- **FE list-page label fallback** — `apps/web/src/pages/prompt-templates/prompt-templates-list-page.test.tsx`: one new case — given a row with channel `'newchannel'` (not in the in-tree plugin manifest), the page renders the humanised fallback (`"Newchannel"` or similar) rather than crashing or showing an empty cell. Locks in the `usePlugin(channel)?.displayName ?? humaniseChannel(channel)` branch.

### Step 9 — Quality gate
- `pnpm lint` + `pnpm type-check` + `pnpm test` from the worktree root.

### Step 10 — Documentation
- `docs/architecture-overview.md` § AI — append one sentence under the bullet list noting channel is open-world per #580 (mirrors the #576 capability bullet).

## Validation

- **Architecture**: domain layer no longer exports a closed enum that integration plugins would need to extend. The DTO layer becomes format-validated only — mirrors the #578/#579 `platformType` approach. No new cross-layer dependencies.
- **Engineering Standards § Union Types `as const` Pattern (Default)**: the standard's preferred form is `as const` + derived union, with a runtime array. The standard's "❌ Bad" example explicitly calls out bare `string` types as "Missing: No runtime array for validation/Swagger" — **and that's the right shape here**. The plan deliberately diverges because channel is a plugin-extensible axis (#576, #578/#579 precedent): a closed runtime array would defeat the entire issue. This is the documented exception that fits open-world axes; not a standards miss.
- **Naming**: `PromptTemplateChannel` stays as a named type alias (mirrors `platformType: string` being kept named, not inlined). Preserves call-site readability and gives a single seam for future tightening.
- **Type safety**: no `any` introduced; `string` widening is a strict superset of the previous union.
- **Testing**: existing unit/integration tests cover the round-trip; new tests only add the "future channel" case and the FE label fallback.
- **Security**: DTO still enforces non-empty string at the boundary, matching `platformType` exactly. Channel never crosses the SQL layer untyped — `prompt-template.repository.ts` uses parameterized queries throughout (TypeORM `QueryBuilder`), so injection risk is unchanged.

## Risks & open questions

- **The `'master'` UI sentinel**: today `'master'` is purely an FE marker for `channel = null`. The new hook schema needs to keep the sentinel as the first option in the select — clearly noted in the implementation, but worth checking the form's Zod transform doesn't accidentally accept `'master'` as a literal channel server-side.
- **FE schema-as-hook conversion**: `useNewPromptTemplateSchema()` will be one of the first FE schemas to be hook-shaped instead of a static export. The form site needs `useMemo`-stabilisation so the Zod resolver isn't a fresh object on every render. Add `useMemo` in the call site as part of Step 6.
- **Behaviour change at `resolveSuggestChannel` removal**: today the helper translates "no recognised platform → `null` (master template)" before calling the suggest endpoint. After the open-world flip, an unrecognised `connection.platformType` reaches the AI domain as the raw string instead. This is the *correct* new semantics — registered plugins by definition have valid channels — but it IS a behaviour change for one narrow case: when a backend plugin is registered and producing connections while the FE plugin manifest hasn't caught up. Failure mode is "wrong template selected for an in-flight platform" (the new channel-specific template returns no published row, so the renderer falls back to the master template by design), not a crash. Acceptable; flagging for the PR description.
- **Cross-spec consistency**: the audit also names `OfferMappingFilters.platformType` as a "still says e.g. 'allegro'" doc string. That's already a `string` type — just a stale comment. Out of scope for #580, but I'll note it in the PR description as a one-line follow-up if it bothers the reviewer.

## Out-of-scope follow-ups

- `OfferMappingFilters.platformType` JSDoc cleanup ("e.g. 'allegro'" implies a closed set when the field is open) — tiny doc nit.
- Runtime-aware DTO validators for `CoreCapabilityValues` (#576 left this open) — separate Thread C/D follow-up.
- A neutral `humaniseChannel(channel: string): string` helper if the title-casing logic gets a second consumer. Today the only consumer is `channelLabel`, so inline it there.
