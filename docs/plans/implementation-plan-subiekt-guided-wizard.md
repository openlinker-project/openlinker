# Implementation Plan: Subiekt Guided Connection Wizard (#1199)

**Date**: 2026-06-24
**Status**: Ready for Review
**Estimated Effort**: ~0.5–1 day (FE-only, follows an established pattern)

---

## 1. Task Summary

**Objective**: Add an `apps/web/src/plugins/subiekt/` FE plugin that contributes a guided connection wizard (a `setupCard` on `/connections/new` + a dedicated guided setup route at `/connections/new/subiekt`), so an operator can create a Subiekt connection through a step-by-step UI instead of the generic "advanced mode" create-connection form.

**Context**: The Subiekt **backend** adapter is already on `main` (`libs/integrations/subiekt`, `platformType: 'subiekt'`, `adapterKey: 'subiekt.invoicing.v1'`, capability `Invoicing`, plus a working connection-tester that probes the bridge). But there is **no `plugins/subiekt/` FE plugin at all** — Subiekt never appears on the `PlatformPicker`, so operators fall through to advanced mode (raw Credentials JSON + manual capability toggles + bridge URL). The E2E run (Presta → OpenLinker → Subiekt, FS 169/CENTRALA/2026) flagged this as a usability gap. This issue fills in the standard `OpenLinkerPlugin` slots for the platform, following the PrestaShop / Erli plugin pattern exactly.

**Classification**: Frontend (Interface layer — FE plugin + route + feature form). No CORE/Integration/backend changes.

---

## 2. Scope & Non-Goals

### In Scope
- New `apps/web/src/plugins/subiekt/` plugin (`index.ts` via `definePlugin`, `subiekt-setup.route.tsx`, `subiekt.test.ts`).
- New page wrapper `apps/web/src/pages/connections/subiekt-setup-page.tsx`.
- New guided form `apps/web/src/features/connections/components/subiekt-setup-form.tsx` (+ `subiekt-setup.schema.ts` + `subiekt-setup-form.test.tsx`).
- A `platform.setupCard` so Subiekt appears on `/connections/new` (`PlatformPicker`).
- Register the plugin in `apps/web/src/plugins/index.ts`; bump `EXPECTED_LAZY_ROUTE_COUNT` in `route-lazy.test.ts` (41 → 42).
- Wizard collects exactly what creates a working Subiekt connection against the merged BE contract, then runs the existing `/connections/:id/test` (bridge health) affordance.

### Out of Scope
- **Trigger-model dropdown / capability toggles** (#759 AC-2). The merged BE `SubiektConnectionConfigDto` accepts only `bridgeBaseUrl` + optional `timeoutMs`; trigger-model is not persisted by any BE contract on `main` (it belongs to #759 connection-settings + #1120 auto-issue trigger). Collecting it here would invent a field the BE ignores/strips. Deferred to #759/#1120.
- `StructuredConfigSection` / `CredentialsPanel` / `ConnectionActions` edit-form slots — these are #759's edit surface for an already-created connection. This issue owns the **create/onboarding** flow only. The plugin may add those slots later when #759 lands; they are independent.
- Any backend change. The plugin consumes existing endpoints (`POST /connections`, `POST /connections/:id/test`).
- i18n string migration (inline literals with the project's existing convention; no `t()` migration required for FE-001).

### Constraints
- FE dependency rules: `plugins/` may import `pages`, `features` (via barrel), `shared`, and type-only from `app/api/api-client` / `app/app-shell`. No host internals. (`docs/frontend-architecture.md` § Dependency Rules.)
- No `platformType` literal-equality dispatch outside `plugins/subiekt/`.
- No global store; wizard step/created-id state is component-local (`docs/frontend-architecture.md` § Local UI State).
- The setup **form** lives in the `connections` feature (like every other `*-setup-form.tsx`); the plugin contributes only the route, the page wrapper lives in `pages/`. This matches PrestaShop/Erli/WooCommerce/DPD exactly.

---

## 3. Architecture Mapping

**Target Layer**: Frontend only — `apps/web/src/plugins/`, `apps/web/src/pages/`, `apps/web/src/features/connections/`.

**Capabilities Involved**: None new. Consumes the existing connections-feature public surface and the generic connection-test endpoint backed by `SubiektConnectionTesterAdapter` (already on `main`).

**Existing Services / Surfaces Reused**:
- `definePlugin` (`apps/web/src/plugins/define-plugin.ts`) + `assertUniquePluginInvariants` (automatic at module load).
- `OpenLinkerPlugin` / `PlatformContribution` / `BuildContribution` / `PlatformSetupCard` contract (`apps/web/src/shared/plugins/plugin.types.ts`).
- `useCreateConnectionMutation`, `useTestConnectionMutation`, `CreateConnectionInput`, `ConnectionTestResult` (connections feature).
- Shared UI primitives: `PageLayout`, `Alert`, `BackLink`, `Button`, `FormField`, `FormErrorSummary`, `Input`, `useToast`.
- `PlatformPicker` already renders any plugin whose `platform.setupCard` is set — no change needed there.
- `rootRoute` already folds `plugins.flatMap(p => p.build?.routes)` — no change to `root.route.tsx` needed.

**New Components Required**:
- `subiektPlugin` (plugin object), `subiektSetupRoute` (RouteObject), `SubiektSetupPage` (page), `SubiektSetupForm` + `subiektSetupSchema` (feature form + schema).

**Core vs Integration Justification**: This is pure FE plugin wiring. The CORE↔Integration boundary is untouched — no BE code changes. The FE plugin is the host-side analogue of the already-registered BE adapter plugin.

**Reference**: `docs/frontend-architecture.md` § Platform Plugins; `docs/architecture-overview.md` (Subiekt under #753 invoicing adapter).

---

## 4. External / Domain Research

### Merged backend contract (`libs/integrations/subiekt`, on `main`)
- **Manifest** (`subiekt-plugin.ts`): `adapterKey: 'subiekt.invoicing.v1'`, `platformType: 'subiekt'`, `displayName: 'Subiekt nexo (Sfera bridge)'`, `supportedCapabilities` includes `'Invoicing'`.
- **Connection config** (`application/dto/subiekt-connection-config.dto.ts`):
  - `bridgeBaseUrl: string` — **required**, `@IsUrl({ require_protocol: true, require_tld: false, protocols: ['http','https'] })`, plus an IMDS-safety constraint (`isBridgeUrlSafe`) — http allowed (the bridge is a LAN service).
  - `timeoutMs?: number` — optional, `1000 ≤ n ≤ 120000`.
- **Credentials** (`domain/types/subiekt-credentials.types.ts`): optional `{ bridgeToken?: string }` — a shared bridge token for hardened deployments. **Secret — never echo/log.** Resolved only when `connection.credentialsRef` is truthy.
- **Connection test**: `SubiektConnectionTesterAdapter` is registered; the generic `POST /connections/:id/test` therefore exercises the bridge health probe and returns `ConnectionTestResult` (`{ success, status?, message, latencyMs }`).

### Internal FE patterns (confirmed by codebase read)
- **Closest template**: `features/connections/components/erli-setup-form.tsx` + `erli-setup.schema.ts` — a single-step create-from-scratch wizard that, after a successful `create`, surfaces a "Test connection" button calling `/connections/:id/test` and rendering the result. Includes abandon-prevention (`beforeunload` when dirty + not yet created).
- **Plugin shape**: `plugins/erli/index.ts` (`definePlugin`, `build.routes: [erliSetupRoute]`, `platform: { displayName, setupCard }`); `plugins/erli/erli-setup.route.tsx` (`path: 'connections/new/erli'`, `handle.crumb`, `lazy` import of the page).
- **Page wrapper**: `pages/connections/prestashop-setup-page.tsx` / `erli-setup-page.tsx` — thin `PageLayout` + `<XSetupForm/>`.
- **Setup card**: `PlatformSetupCard = { title, description, to, badge }`; `PlatformPicker` maps every plugin with a `setupCard` to a `<Link to={card.to}>`.
- **Route tree**: `root.route.tsx` appends `plugins.flatMap(p => p.build?.routes ?? [])` — adding the plugin to the array is sufficient.
- **Lazy contract**: `route-lazy.test.ts` asserts `EXPECTED_LAZY_ROUTE_COUNT === 41` today; one new lazy plugin route → bump to **42**.
- **Handle contract**: `route-handle.test.ts` requires every lazy leaf route to declare `handle: { crumb: { group, title } } satisfies RouteCrumbHandle`.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. (#759's trigger-model/capability-toggle UI is explicitly deferred — see Non-Goals.)

### Assumptions
- **A1**: `platformType` runtime key is `'subiekt'` and `adapterKey` is `'subiekt.invoicing.v1'` (confirmed in `subiekt-plugin.ts`). The wizard sends `adapterKey: 'subiekt.invoicing.v1'` explicitly (mirrors Erli sending its `adapterKey`).
- **A2**: `enabledCapabilities` is omitted from the create payload, so `ConnectionService.create` defaults it to the manifest's supported set (`['Invoicing']`) — same omitted-path posture as Erli.
- **A3**: `bridgeToken` is optional; the form offers it under an "advanced / secured bridge" affordance and only includes `credentials` in the payload when non-empty (so the common LAN-no-auth path sends no credentials).
- **A4**: The FE Zod schema mirrors the BE DTO (require protocol, allow `http`/`https`, `timeoutMs` 1000–120000). The IMDS-safety check is **BE-authoritative**; the FE may add a light advisory check but must not duplicate it as the source of truth — a BE 400 surfaces in the create-error Alert.
- **A5**: `id` and `platformType` are kept equal (`'subiekt'`), per in-tree convention.

### Documentation Gaps
- None. `docs/frontend-architecture.md` § Platform Plugins fully specifies the contribution shape.

---

## 6. Proposed Implementation Plan

### Phase 1 — Wizard form (the substance)
**Goal**: A guided, validated form that creates a Subiekt connection and then lets the operator test it.

1. **Create the Zod schema + payload mapper**
   - **File**: `apps/web/src/features/connections/components/subiekt-setup.schema.ts`
   - **Action**: Export `SUBIEKT_ADAPTER_KEY = 'subiekt.invoicing.v1'`, `subiektSetupSchema` (fields: `name` required; `bridgeBaseUrl` required URL with `http`/`https` protocol; `timeoutMs` optional coerced int 1000–120000 or blank; `bridgeToken` optional), `SUBIEKT_SETUP_DEFAULT_VALUES`, `toCreateConnectionInput(values): CreateConnectionInput`. The mapper builds `config: { bridgeBaseUrl, ...(timeoutMs ? { timeoutMs } : {}) }`, sets `platformType: 'subiekt'`, `adapterKey: SUBIEKT_ADAPTER_KEY`, includes `credentials: { bridgeToken }` **only** when `bridgeToken` is non-empty, and omits `enabledCapabilities`.
   - **Acceptance**: `z.input`/`z.output` types exported; mapper unit-covered in the form test; no `any`.
   - **Dependencies**: none.

2. **Create the setup form component**
   - **File**: `apps/web/src/features/connections/components/subiekt-setup-form.tsx`
   - **Action**: Mirror `ErliSetupForm`. `react-hook-form` + `zodResolver`. Fields: connection name; bridge base URL (mono input, `placeholder="http://127.0.0.1:5000"`, description noting the LAN bridge + that http is allowed); optional timeout (ms); optional bridge token (`type="password"`, described as "only for a secured/shared-token bridge — leave blank for an unauthenticated LAN bridge"). An info `Alert` ("Before you start": run the Subiekt Sfera bridge on the machine with Subiekt nexo; paste its URL). On submit → `useCreateConnectionMutation`; on success store `createdConnectionId`, toast success, reset dirty. After creation, render the "Test connection" affordance (`useTestConnectionMutation` → render `ConnectionTestResult`; clear stale result before re-test, per the Erli `PR1064-TECH-01` note) + a "Done" button navigating to `/connections`. Include `beforeunload` abandon-prevention while dirty and not yet created. `BackLink` to `/connections/new`.
   - **Acceptance**: Renders all fields; submit calls create with the mapped payload; post-create test button calls `/connections/:id/test` and renders the result; bridge token never rendered back into any value after submit.
   - **Dependencies**: Step 1.

### Phase 2 — Page + plugin wiring
**Goal**: Surface the form as a route and a setup card.

3. **Create the page wrapper**
   - **File**: `apps/web/src/pages/connections/subiekt-setup-page.tsx`
   - **Action**: Thin `PageLayout` (eyebrow "Integrations", title "Connect Subiekt", description about the Sfera bridge, summary chips "Sfera bridge" + "Guided setup") rendering `<SubiektSetupForm/>`. Mirror `PrestashopSetupPage`.
   - **Acceptance**: Page renders the form.
   - **Dependencies**: Step 2.

4. **Create the setup route**
   - **File**: `apps/web/src/plugins/subiekt/subiekt-setup.route.tsx`
   - **Action**: Export `subiektSetupRoute: RouteObject` with `path: 'connections/new/subiekt'`, `handle: { crumb: { group: 'Platform', title: 'Connect Subiekt' } } satisfies RouteCrumbHandle`, `lazy: () => import('../../pages/connections/subiekt-setup-page').then(m => ({ Component: m.SubiektSetupPage }))`.
   - **Acceptance**: Matches the Erli/PrestaShop route shape; carries a crumb.
   - **Dependencies**: Step 3.

5. **Create the plugin object**
   - **File**: `apps/web/src/plugins/subiekt/index.ts`
   - **Action**: `export const subiektPlugin = definePlugin({ id: 'subiekt', platformType: 'subiekt', build: { routes: [subiektSetupRoute] }, platform: { displayName: 'Subiekt nexo', setupCard: { title: 'Subiekt nexo', description: 'Connect Subiekt nexo via the OpenLinker Sfera bridge running on your Windows machine. Issues invoices for orders.', to: '/connections/new/subiekt', badge: 'Sfera bridge' } } })`.
   - **Acceptance**: Only `displayName` + `setupCard` (+ route) are contributed; edit-form slots intentionally absent (deferred to #759).
   - **Dependencies**: Step 4.

6. **Register the plugin**
   - **File**: `apps/web/src/plugins/index.ts`
   - **Action**: Import `subiektPlugin` and append it to the `plugins` array. (Order: after `erliPlugin` is fine; placement only affects card sequence.)
   - **Acceptance**: `assertUniquePluginInvariants` passes (unique `id`/`platformType`); Subiekt card appears on `/connections/new`.
   - **Dependencies**: Step 5.

### Phase 3 — Tests + contract bumps
**Goal**: Lock the behavior and keep the route contracts green.

7. **Plugin smoke test**
   - **File**: `apps/web/src/plugins/subiekt/subiekt.test.ts`
   - **Action**: Mirror `prestashop.test.ts` — assert `id`/`platformType` are `'subiekt'`, the build route path is `'connections/new/subiekt'`, `setupCard.to === '/connections/new/subiekt'`, `displayName` set, and negative assertions for the slots intentionally not contributed (no `apiNamespaces`, no `StructuredConfigSection`, no `requiresExternalAuthRedirect`).
   - **Acceptance**: Passes under `pnpm --filter @openlinker/web test`.
   - **Dependencies**: Step 5.

8. **Setup-form component test**
   - **File**: `apps/web/src/features/connections/components/subiekt-setup-form.test.tsx`
   - **Action**: Mirror `erli-setup-form.test.tsx` with `renderWithProviders` + `createMockApiClient`. Cover: renders fields; happy-path submit calls `connections.create` with the mapped payload (`platformType: 'subiekt'`, `adapterKey`, `config.bridgeBaseUrl`, no `credentials` when token blank); supplying a bridge token includes `credentials.bridgeToken`; required-field validation (missing name / missing bridge URL); post-create "Test connection" calls `connections.test(id)` and renders the result.
   - **Acceptance**: Passes; mocks the API client (not real adapters).
   - **Dependencies**: Step 2.

9. **Bump the lazy-route contract**
   - **File**: `apps/web/src/app/routes/route-lazy.test.ts`
   - **Action**: `EXPECTED_LAZY_ROUTE_COUNT` 41 → 42.
   - **Acceptance**: `route-lazy.test.ts` and `route-handle.test.ts` both pass (the new route carries a crumb).
   - **Dependencies**: Step 6.

### Implementation Details
- **New Components**: Interface/FE only — plugin object, route, page, feature form + schema. No domain/application/infrastructure code.
- **Configuration Changes**: None (no env vars).
- **Database Migrations**: None.
- **Events**: None.
- **Error Handling**: Create/test errors surface via the mutation `.error` → `Alert` (same as Erli). BE validation (IMDS guard, URL shape, timeout range) returns 400 → rendered in the create-error Alert. The `bridgeToken` secret is write-only — never read back into form state or rendered after submit.

---

## 7. Alternatives Considered

### Alternative 1: Put the form inside `plugins/subiekt/` instead of the connections feature
- **Description**: Co-locate `SubiektSetupForm` under `plugins/subiekt/components/`.
- **Why Rejected**: Every existing setup form (`erli`, `prestashop`, `woocommerce`, `dpd`) lives in `features/connections/components/`; the plugin contributes only the route. Following the established placement keeps the diff idiomatic and lets the form reuse feature-internal hooks via relative imports without crossing the plugin→feature barrel boundary awkwardly.

### Alternative 2: Multi-step (paged) wizard instead of one scrollable card
- **Description**: Break name / bridge URL / credentials / test into discrete `useState` steps.
- **Why Rejected**: The merged BE contract is small (one required field + two optional). Erli/PrestaShop use a single scrollable `wizard-card` with a post-create test affordance — that *is* the house "guided wizard" idiom. A paged stepper adds state and UX surface for no real gain. (Can revisit if #759's trigger-model + capability toggles land and the field count grows.)

### Alternative 3: Include the trigger-model dropdown now (per #759 AC)
- **Description**: Add the trigger-model/capability-toggle fields described in #759.
- **Why Rejected**: No BE contract on `main` persists them; the create endpoint would ignore/strip unknown config keys. Shipping a control that silently does nothing is worse than deferring. Belongs to #759 (edit-form) + #1120 (auto-issue trigger).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ FE plugin contract followed exactly (`definePlugin`, `setupCard`, `build.routes`). Reference: `docs/frontend-architecture.md` § Platform Plugins.
- ✅ Dependency direction respected (plugin → page → feature; form in feature; no host internals).
- ✅ No `platformType` literal-equality dispatch (the card/route are inside `plugins/subiekt/`).

### Naming Conventions
- ✅ `kebab-case.tsx` files, `PascalCase` exports, `*.route.tsx`, `*.test.tsx`, `use-*.ts` (reused). Reference: `docs/frontend-architecture.md` § Components And Pages.

### Existing Patterns
- ✅ One-to-one mirror of the Erli plugin + setup form (most recent precedent) and PrestaShop page wrapper.

### Risks
- **Stale route-count test**: forgetting the `41 → 42` bump fails `route-lazy.test.ts`. *Mitigation*: explicit Step 9.
- **Bridge-URL `http` rejected client-side**: copying Erli's https-only refine would wrongly block LAN `http://` bridges. *Mitigation*: schema allows `http`/`https` per the BE DTO (A4).
- **Secret leakage**: rendering `bridgeToken` back. *Mitigation*: write-only field; password input; not surfaced in `ConnectionTestResult`; covered by form test + security-review.

### Edge Cases
- Blank optional fields (`timeoutMs`, `bridgeToken`) → omitted from payload (no empty-string config keys).
- Create succeeds but test fails → result Alert shows failure with latency; operator can still finish ("Done").
- Duplicate plugin id/platformType → `assertUniquePluginInvariants` throws at module load (guarded by Step 7's identity assertions).

### Backward Compatibility
- ✅ Additive only. No existing plugin, route, or BE contract changes. Advanced-mode create-connection remains available.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit / Component Tests (Vitest + Testing Library)
- `apps/web/src/plugins/subiekt/subiekt.test.ts` — plugin static-surface smoke test.
- `apps/web/src/features/connections/components/subiekt-setup-form.test.tsx` — render, validation, create payload mapping (token present/absent), post-create test flow.

### Contract Tests (existing, must stay green)
- `apps/web/src/app/routes/route-lazy.test.ts` — count bumped to 42.
- `apps/web/src/app/routes/route-handle.test.ts` — new route declares a crumb.

### Mocking Strategy
- Mock the API client (`createMockApiClient`) — never real adapters. Assert `connections.create` / `connections.test` calls.

### Acceptance Criteria
- [ ] `plugins/subiekt/` exists and is registered in `plugins/index.ts`; uniqueness invariants pass.
- [ ] Subiekt appears as a `setupCard` on `/connections/new` (no longer advanced-mode-only).
- [ ] `/connections/new/subiekt` renders the guided form; it creates a `subiekt` connection (`adapterKey: 'subiekt.invoicing.v1'`, `config.bridgeBaseUrl`, optional `timeoutMs`, optional `bridgeToken` only when provided).
- [ ] Post-create "Test connection" calls `/connections/:id/test` and surfaces success/failure + latency.
- [ ] Bridge token is write-only and never echoed.
- [ ] New route declares `handle.crumb`; `route-lazy` (42) + `route-handle` tests pass.
- [ ] Component + plugin tests added and passing.
- [ ] `pnpm --filter @openlinker/web lint`, `type-check`, `test` all green.
- [ ] No FE dependency-boundary or `platformType` literal-dispatch violations.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (FE plugin contract; no boundary crossings)
- [x] Respects CORE vs Integration boundaries (no BE change)
- [x] Uses existing patterns (Erli/PrestaShop plugin + setup form) — no new abstractions
- [x] Idempotency considered (create is operator-initiated; test is read-only/idempotent)
- [x] Event-driven patterns — N/A (synchronous create + test)
- [x] Rate limits & retries — N/A (single create; test inherits BE behavior)
- [x] Error handling comprehensive (create/test error Alerts; BE 400 surfaced)
- [x] Testing strategy complete (component + plugin + contract bumps)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan saved as markdown file

> **ADR**: Not required. This is a routine feature addition following the established FE plugin pattern (`docs/architecture/adrs/README.md` § "Don't write one for … routine feature additions without architectural impact"). No new abstraction, no cross-context/contract change.

---

## Related Documentation
- [Frontend Architecture](../frontend-architecture.md) — § Platform Plugins, § Dependency Rules, § Routing Conventions
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Issue #1199 (this); related #759 (Subiekt connection settings — edit form), #1120 (auto-issue trigger), #753 (Subiekt BE adapter, merged)
