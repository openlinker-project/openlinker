# Implementation Plan - Mapping Configuration connection pairing (#1784)

## 1. Understand the task

Make the order Mapping Configuration page (`apps/web/src/pages/connections/connection-mappings-page.tsx`) show and reason about the **connection pair** it configures, replace hardcoded "Allegro"/"PrestaShop" copy with resolved platform labels, gate mapping to today's supported source platforms, and make the page responsive (drop the desktop-only banner).

- **Layer:** Frontend / Interface only. No CORE or Integration change; no new port/capability/DI token/schema/migration.
- **Non-goals:**
  - No backend change. The mapping/options endpoints and their `config.masterCatalogConnectionId` partner resolution stay as-is.
  - No server-side supported-pairs guard (FE-only by decision; API stays open for emergency API-driven mappings).
  - No change to how mapping **data** is keyed (still by URL `connectionId`).
  - No "multiple destinations" case (not representable: `masterCatalogConnectionId` is a single string).
  - No rename of internal wire/bundle keys (`allegroOrderStatuses`, etc.).

Authoritative mock: https://claude.ai/code/artifact/ea21c413-4a4a-4ee3-82e9-c581e14681d3

## 2. Research (findings)

- **Pairing is config-stamped.** `apps/api/src/mappings/http/mapping-options.controller.ts` `resolvePartnerConnectionId`: source connection carries `config.masterCatalogConnectionId` -> its one master; from the master, reverse-lookup the single active paired source (throws 400 if several). FE will mirror this resolution.
- **Data queries key on URL `connectionId`** (`mappings.controller.ts`), unchanged. So the multi-source case must **navigate** to the chosen source's page, not swap state in place.
- **Page today** (`connection-mappings-page.tsx`): gates tabs by capability (`supportsOrderSource` -> Fulfillment, `supportsOrderProcessor` -> Order States); status/carriers/payments always shown. Uses `useConnectionQuery(connectionId)`, `useMappingOptions`, per-tab query hooks. Renders `DesktopOnlyBanner` + hardcoded labels.
- **Label lookup:** `usePlatform(platformType)?.displayName ?? platformType` (as in `connection-detail-page.tsx`).
- **Reverse-lookup source:** `useConnectionsQuery()` + client filter `c.status === 'active' && readMaster(c) === urlId && SUPPORTED.includes(c.platformType)` (mirrors category page's candidate filter).
- **MappingPanel** already takes `sourceLabel`/`targetLabel`/`title`/`description` as props (no prop-shape change for labels). `DYNAMIC_OPTION_SUFFIX` is a module const hardcoding "Allegro" -> make it a prop.
- **RoutingRulesPanel** copy is mostly generic ("marketplace delivery method"); add a `sourceLabel` prop for the description.
- **CSS:** `.toolbar-chip`/`.context-chip` pill family at `index.css:1601`. Existing responsive breakpoints use `@media (max-width: 640px)` / `767px`. Reuse tokens; namespace new classes `.mapping-pair*`.
- **Tests:** `apps/web/src/pages/connections/connection-mappings-page.test.tsx` exists - extend it.

## 3. Design

### 3.1 Supported-pairs constant (FE-only)
`apps/web/src/features/mappings/supported-source-platforms.ts`
```ts
// FE-ONLY gate (by decision, #1784). The mapping API stays open on capability,
// so an operator can still add mappings for an unlisted pair via the API in an
// emergency (as done earlier for presta->erli). Do NOT mirror this server-side
// without an explicit decision to close that escape hatch.
export const SUPPORTED_SOURCE_PLATFORMS = ['allegro', 'erli'] as const;
export function isSupportedSourcePlatform(p: string | undefined): boolean { ... }
```

### 3.2 Pairing resolution hook
`apps/web/src/features/mappings/hooks/use-mapping-pairing.ts` - `useMappingPairing(connectionId)` returns a discriminated union (`*.types.ts` colocated):
- `{ status: 'loading' }`
- `{ status: 'error'; error: Error }`
- `{ status: 'unsupported'; source: Connection; destination: Connection | null }`
- `{ status: 'no-source'; master: Connection }`
- `{ status: 'pick-source'; master: Connection; candidates: Connection[] }`
- `{ status: 'ready'; source: Connection; destination: Connection }`

Resolution (mirrors backend): read `masterCatalogConnectionId` off the URL connection.
- present -> URL conn is source; destination = connection with that id (from list); `unsupported` if source platform not allowlisted; else `ready`.
- absent -> URL conn is master; candidates = active + paired-here + allowlisted sources; 0 -> `no-source`, 1 -> `ready`, >1 -> `pick-source`.

Inputs: `useConnectionQuery(connectionId)` + `useConnectionsQuery()`. Loading/error fold in from both.

### 3.3 Pairing bar component
`apps/web/src/features/mappings/components/mapping-pairing-bar.tsx` - renders the route strip (source chip or `<Select>` picker, connector, destination chip, meta line with "Change pairing" link / picker hint). Props: the resolved pairing + `onPickSource(id)`. Pure presentational.

### 3.4 Page wiring (`connection-mappings-page.tsx`)
- Call `useMappingPairing(connectionId)`.
- `loading`/`error` -> existing full-page `LoadingState`/`ErrorState`.
- `unsupported` -> bar + unsupported empty state (supported-pair badges).
- `no-source` -> bar + guidance empty state.
- `pick-source` -> bar (picker) + prompt empty state; `onPickSource` -> `navigate('/connections/{sourceId}/mappings')`.
- `ready` -> bar + tabs (existing content), with `sourceLabel`/`destinationLabel` from `usePlatform` threaded into description, tab panels, `MappingPanel` props, `RoutingRulesPanel` `sourceLabel`, and `MappingPanel` dynamic-suffix prop.
- Remove `DesktopOnlyBanner` import + usage.

### 3.5 MappingPanel / RoutingRulesPanel
- `MappingPanel`: add optional `dynamicOptionSuffix?: string` prop (default keeps behaviour); page passes `` ` - exact ${sourceLabel} cost` ``. Replace module const usage.
- `RoutingRulesPanel`: add `sourceLabel: string` prop; interpolate into the description sentence.

### 3.6 Responsive CSS (`index.css`, bounded section)
- `.mapping-pair` route strip (grid -> stacked at `<=640px`, connector rotates).
- Responsive mapping table -> cards at `<=640px`: confirm MappingPanel's real markup first, then either add card CSS targeting it or (if it's a `<table>`) apply the `display:block` + `data-label` card technique. Tabs list -> horizontal scroll rail at `<=640px`. Reuse tokens only.

## 4. Steps

1. **Read MappingPanel + RoutingRulesPanel full render** to confirm exact markup the responsive CSS must target. (No code yet.)
2. Add `supported-source-platforms.ts` (+ barrel export if the feature has one).
3. Add `use-mapping-pairing.ts` (+ `.types.ts`) with unit-testable pure resolver split from the hook (`resolveMappingPairing(urlConnection, allConnections)`), so logic is tested without React.
4. Add `mapping-pairing-bar.tsx`.
5. Rewire `connection-mappings-page.tsx`: pairing states, label threading, remove `DesktopOnlyBanner`.
6. `MappingPanel`: `dynamicOptionSuffix` prop; `RoutingRulesPanel`: `sourceLabel` prop.
7. `index.css`: pairing-bar + responsive card/tab CSS (bounded comment block).
8. Tests: unit-test `resolveMappingPairing` (all 6 outcomes); extend `connection-mappings-page.test.tsx` for ready (Allegro + Erli label substitution), pick-source (picker + navigation), unsupported, no-source.
9. Quality gate: `pnpm --filter @openlinker/web lint type-check test` (scoped), then full `pnpm lint`/`type-check`/`test`.
10. Visual verify with Playwright against demo API (worktree vite -> demo :3000 / :8090 stack): desktop + mobile screenshots per state, compare to mock.
11. Docs: `docs/frontend-architecture.md` note (pairing resolution + FE-only allowlist location); `docs/frontend-ui-style-guide.md` if the pairing strip/responsive-cards pattern is worth recording.

## 5. Validate

- **Architecture:** FE-only; no cross-layer or CORE/Integration violation. Hook depends on existing FE query hooks + `usePlatform`. Pure resolver keeps logic testable.
- **Naming:** `use-*.ts` hook, `*.tsx` component, `*.types.ts` types, `PascalCase` component. FE conventions honoured.
- **State ownership:** server state via TanStack Query (existing hooks); pairing is derived, not stored; multi-source choice lives in the URL (navigation), consistent with `docs/frontend-architecture.md`.
- **Security:** no secrets; read-only reuse of existing endpoints.
- **Risk:** the multi-source navigation must land on a page that re-keys data correctly (it does - URL `connectionId` drives all queries). Responsive card CSS must match MappingPanel's real DOM (step 1 gate).
