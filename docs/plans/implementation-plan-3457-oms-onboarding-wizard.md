# Implementation Plan: OMS onboarding wizard ("Pack orders in OpenLinker") (#3457)

**Date**: 2026-09-28
**Status**: Ready for Review
**Estimated Effort**: 5–7 days (Phase 1 ≈ 1 day, Phases 2–6 ≈ 4–5 days, Phase 7 ≈ 0.5 day)
**Epic**: #3460 · **Mockup**: `docs/plans/mockups/oms-onboarding-wizard.html` (PR #3459) · **Base branch**: `3456-admin-create-user` (PR #3504, top of the backend chain)

---

## 1. Task Summary

**Objective**: Let an admin switch OpenLinker's own packing (the OMS) on from the UI, with no raw JSON. The wizard has four steps (product master, packers, what changes, turn on) followed by a status page. It exactly implements the `data-state` vocabulary of the committed mockup.

**Context**: Today switching the OMS on takes four hand-made writes that nothing guides:
- create an `openlinker` connection with `FulfillmentExecutor`;
- create an active inventory location (#2407 refuses routing without one);
- point every product master's stock at it (`config.stockLocationOverride`, #3206);
- set `config.sourcingAuthority.enabled = true` on the `openlinker` connection.

No who-decides preset grants A2. The pre-requisite backend behaviour (#3453, #3455, #3479–#3481, #3485–#3488, #3456) is in the PR chain this branch sits on, so step 3's sentences describe real behaviour.

**A dependency this plan also has to close**: #3504 (`POST /users`, forced password change) shipped **backend only**. Its PR body assigns the change-password screen and the `PASSWORD_CHANGE_REQUIRED` redirect to #3457. Nothing in `apps/web` handles that code today, so a packer created in step 2 would sign in and get 403 on every route with no way out. That is Phase 1 of this plan.

**Classification**: Frontend (Interface), plus one tiny backend change (an error code; see Phase 1, step 5).

---

## 2. Scope & Non-Goals

### In Scope
- The forced first-sign-in password change on the frontend. It covers both the normal app shell and the pack bench sign-in.
- A frontend client for `POST /users` and the step-2 create-packer form. It shows the one-time password once, with copy.
- The wizard page at `/settings/packing`, every mockup `data-state`, and the mockup's `data-testid` values.
- The status page after turn-on: waiting-first-order, first-order-arrived, status-on, status-off, and the stop-confirm dialog.
- Resume after reload: the page derives where the operator is from server state, never from local storage.
- The entry points:
  - a Settings tile;
  - an OMS `setupCard` in the platform picker;
  - a link from the empty pack-bench state "No work can reach this bench".
- A machine-readable error code on the #2407 routing refusal, so step 4 can map it (the `STOCK_LOCATION_OVERRIDE_INVALID` precedent).

### Out of Scope
- Two warehouses and anything else in #3454 (v2).
- `/orders` showing routed orders (#3482), the docs (#3483) and E2E (#3458). The mockup-parity E2E belongs to #3458. This plan only keeps every `data-testid` stable for it.
- Any change to the pack bench beyond the empty-state link and the password-change overlay.
- Changing who-decides presets. `openlinker-decides` switches every assignable claim **off**, so it is not a way to turn packing on (see §8, Risks).
- Server-side "unassigned count". `GET /fulfillment/works` has no assignee filter (see §5, Q3).

### Constraints
- **Capability-driven (D19).** Step 1 lists product masters by capability alone. No `platformType` comparison may appear anywhere in `apps/web/src/features/oms-onboarding/`, and a test asserts it.
- **`PATCH /connections/:id` replaces `config` wholesale**, so every write sends the freshly-read config with exactly one key changed.
- **The location is created only by the operator's Confirm click** (#2407: "an offer an operator takes, never a seed"). It is named "Main warehouse" (code `MAIN`), and the wizard never shows or asks for that name.
- Operator copy lives in `*.copy.ts` files scanned by `scripts/check-ui-vocabulary.mjs`. Banned words include *authority*, *holder* and *FulfillmentWork*.
- **Admin-only writes.** `POST /inventory/locations/bootstrap` and `POST /users` are `@Roles('admin')`. A read-only role sees the status page and no controls.

---

## 3. Architecture Mapping

**Target Layer**: Frontend (`apps/web`) `app` → `pages` → `features` → `shared`, plus one backend interface-layer change (an error code on an existing 400).

**Capabilities involved** (read as data, never dispatched from the browser):
- `ProductMaster` + `InventoryMaster`: the step-1 gate. A connection qualifies only if both are in `supportedCapabilities` **and** in `enabledCapabilities`, and its status is `active`.
- `FulfillmentExecutor`: enabled on the created packing connection. Without it `fulfillment.work.dispatch` never resolves an executor and nothing reaches the bench (#3476).
- A2 `sourcingAuthority`: config-only, turned on in step 4.

**Existing pieces reused**
| Need | Existing | Path |
|---|---|---|
| Stepper UI | `SetupStepper`, `WizardLayout` | `shared/ui/setup-stepper.tsx`, `shared/ui/wizard-layout.tsx` |
| Local-state wizard shape | `dpd-setup-form.tsx` (`STEP_LABELS`, `useState(0)`, `completedSteps`) | `features/connections/components/` |
| List/create/update connections | `useConnectionsQuery`, `useCreateConnectionMutation`, `useUpdateConnectionMutation` | `features/connections/hooks/` |
| Fetch-fresh-then-merge config | `mergeSalesDocumentConfig` (pattern) | `features/sales-documents/lib/merge-sales-document-config.ts` |
| Location bootstrap + active count | `useBootstrapLocationsMutation`, `useActiveLocationCountQuery`, `useInventoryLocationsQuery` | `features/inventory` barrel |
| Stock located/total counts | `useInventoryQuery({ locationId })` → `total` | `features/inventory/hooks/use-inventory-query.ts` (not in the barrel; add one export line) |
| Override error code | `STOCK_LOCATION_OVERRIDE_INVALID` mirror | `features/connections/lib/stock-location-override-error.ts` |
| Who decides / A2 row | `useWhoDecidesStatusQuery` (row `question === 'sourcing'`) | `features/fulfillment-authority` barrel |
| First order / open tasks | `useFulfillmentTasksQuery` | `features/fulfillment` barrel |
| Existing-user role change | `useUpdateRoleMutation` | `features/users` |
| Forced-redirect precedent | `AuthenticatedAppLayout` → `/consent` (#1938) | `app/layouts/authenticated-app-layout.tsx`, `app/routes/consent.route.tsx` |
| OMS connection lookup at page level | `OMS_PLATFORM_TYPE` + filter | `pages/oms/sourcing-rules-page.tsx:60-122` |
| Access gating | `useWriteAccess`, `useIsAdmin`, `AccessGate` | `shared/auth/use-permission.ts`, `shared/ui/access-gate.tsx` |

**New Components Required**
- `features/auth`: `ChangePasswordForm` plus a hook and API for `POST /auth/me/password`, `mustChangePassword` on `SessionUser`, and a `/change-password` route and layout.
- `features/users`: a `create` API and `useCreateUserMutation` (`POST /users`).
- `features/oms-onboarding` (new slice): the wizard, status view, pure state derivation, config-merge helpers and copy.
- `pages/oms/oms-onboarding-page.tsx` and `pages/oms/oms-connection.ts` (a shared lookup, extracted from the sourcing-rules page).
- `app/routes/oms-onboarding.route.tsx`.
- `SetupStepper` gains optional navigation props (backward-compatible).

**Where the platform knowledge lives**: the frontend has to know the literal `platformType: 'openlinker'` twice, to create the packing connection and to find an existing one. ESLint forbids `platformType` literal comparisons outside `plugins/`, and D19 forbids any `platformType` comparison inside the feature. The shipped precedent (#3060) keeps it at the **page** layer (`pages/oms/sourcing-rules-page.tsx`). This plan extracts that into `pages/oms/oms-connection.ts`: `OMS_PLATFORM_TYPE` and `findOmsConnections(connections)`, used by both pages. The page hands the feature the resolved `packingConnection` (or `null`) and `omsPlatformType` as props. The feature therefore contains no comparison, and the test in Phase 6 greps for one.

**Core vs Integration**: no CORE or integration code changes. The one backend change (Phase 1, step 5) adds a `code` to an existing `BadRequestException` in `apps/api` and changes no behaviour.

---

## 4. Domain Research (internal)

**Backend contracts (verified on this branch)**
- **`POST /connections` for `openlinker`:**
  - `requiresCredentials: false` (`libs/oms/src/oms.plugin.ts:76`).
  - The body needs a non-empty `name`, `platformType` and `config` (`{}` passes `@IsObject`).
  - `enabledCapabilities: ['FulfillmentExecutor']` is typed and present in the frontend `CoreCapabilityValues`.
  - **There is no singleton guard.** A second `POST` creates a second `openlinker` connection, so the wizard must reuse an existing one.
- **`POST /inventory/locations/bootstrap`:**
  - Idempotent. Returns `{created[], existingCodes[]}`; on a re-run `MAIN` shows up in `existingCodes`.
  - Admin-only.
  - The `MAIN` id comes from `created[0]`, or from a locations read filtered to code `MAIN` when it already existed.
- **`config.stockLocationOverride`** (`connection.service.ts:515-560`):
  - Validated only when the value changes against the persisted config.
  - It must name an existing, **active** location.
  - The 400 carries `code: 'STOCK_LOCATION_OVERRIDE_INVALID'`.
  - It is applied by the **next** master inventory sync, not instantly. Hence the "stock syncing" state.
- **`config.sourcingAuthority`**, read by `parseAuthorityConfig(config, 'sourcing')`:
  - It accepts `true` / `'true'` / `{enabled, isPrimary, scopes}`.
  - The 400 fires only on the persisted `false → true` transition when there are no active locations. The message is prose with **no code** (`connection.service.ts:148-168`); Phase 1, step 5 adds one.
- **`POST /users`** (#3504):
  - Body `{displayName ≤120, username ≤100 without "@", email?, role}`, returns `201 {id, temporaryPassword}`.
  - 409 returns `{field, message}` naming `username` or `email`. It never echoes the value.
- **Forced change** (#3504):
  - Every route answers `403 {code: 'PASSWORD_CHANGE_REQUIRED'}` except `GET /auth/me` and `POST /auth/me/password`.
  - `POST /auth/me/password {currentPassword, newPassword (8–72)}` answers `400 CURRENT_PASSWORD_INCORRECT` or `400 PASSWORD_UNCHANGED`.
  - The JWT claim `mustChangePassword` is re-minted only by **`/auth/refresh`**. After a successful change the client must refresh, then re-read `/auth/me`, or the guard keeps refusing.
  - `GET /auth/me` returns `mustChangePassword`.
- **`GET /fulfillment/works`:**
  - Filters: `status[]`, `requestStatus[]`, `locationId`, `orderId`, `limit`, `offset`. There is no assignee filter.
  - The frontend `FulfillmentTaskFilters` exposes only `orderId`, `locationId`, `limit` and `offset`.
  - Each task has `createdAt` and `assignedToUserId`.

**Frontend facts that shape the design**
- `SetupStepper` is display-only (no buttons). The mockup's steps are clickable (`wizard-stepper-button-${n}`, locked ones disabled).
- The bench is a **standalone route** (`app/router.tsx:53`) with its own `LoginForm` inside `BenchIdentityOverlay`. A packer signs in *there*, so the forced change has to work inside the overlay too, not only via a shell redirect.
- The empty-bench copy is `benchWorkCopy.emptyNotRouted` (`features/bench/lib/bench-work.copy.ts:178`). Its `remedyBody` points at who-decides today.
- `route-lazy.test.ts` pins `EXPECTED_LAZY_ROUTE_COUNT = 69`. It becomes 70 (one new lazy route; `/change-password` stays eager like `/consent`).

---

## 5. Questions & Assumptions

### Open Questions
1. **Q1: "Stock went down in {master}" on `first-order-arrived`.** The frontend cannot observe the decrement for a given order. **Default**: render it as a general statement of what happens ("Stock goes down in {master}; the order itself stays in OpenLinker") rather than as a per-order fact, and note this in the PR description as a mockup deviation.
2. **Q2: a master already has a different `stockLocationOverride`.** **Default**: Confirm sets the override only where it is absent or already `MAIN`. If a master points at another active location, step 1 shows a blocking warning naming it and does not overwrite, because v1 is one warehouse. Needs product confirmation.
3. **Q3: status-page line "12 orders on Fulfilment, 4 unassigned · last one arrived 4 min ago".** An unassigned count needs a server filter that does not exist. **Default**:
   - "N open tasks on Fulfilment" comes from `GET /fulfillment/works?status=<open states>&limit=1` → `total`. This adds `status?` to the frontend filters, which the backend already accepts.
   - "last one arrived X ago" comes from the newest task's `createdAt`.
   - "unassigned" is dropped.
   - A follow-up issue adds an assignee filter.
4. **Q4: name of the created packing connection.** **Default**: "OpenLinker packing" (a copy key). It is renamable on the connection page.
5. **Q5: another connection already claims A2 (sourcing).** Turning ours on would make the row `ambiguous`. **Default**: step 4 reads the who-decides `sourcing` row. If a claimant other than the packing connection exists, step 4 shows a blocking alert linking to `/settings/who-decides` and disables "Start packing".

### Assumptions
- The pack bench and Assign Packing Work (#3340, branch 3415) are on `main`. Verified: PRs #3368, #3374 and #3439 are merged.
- **Resume is derived from the server:**
  - Step 1 is done when a packing connection exists, an active `MAIN` exists, and every product master's override equals `MAIN`'s id.
  - Step 2 is optional and never "required".
  - Step 3's acknowledgement is local-only and re-asked after a reload. That is acceptable: it is a confirmation, not configuration.
  - The view is `status-on` when the packing connection's A2 claim is enabled, and `status-off` when a `sourcingAuthority` key exists with `enabled: false` (stop keeps the key).
  - Otherwise the view is the wizard at the first undone step.
- **"Live" is read from the who-decides `sourcing` row** (the server's own coercer), never from a frontend re-implementation of `parseAuthorityConfig`. The row shape is to be confirmed during implementation. The fallback reads `config.sourcingAuthority` with a minimal guard, documented as a display-only reading.
- The first-order view counts only tasks whose `createdAt` is after the turn-on moment the page captured. A task routed before a stop/restart does not read as "your first order".

### Documentation Gaps
- `docs/frontend-architecture.md` should record that a *wizard feature* may take platform-resolved data from its page (the #3060 shape) rather than resolving `platformType` itself. This is one line under Platform Plugins.

---

## 6. Proposed Implementation Plan

### Phase 1: Forced first-sign-in password change (prerequisite; can ship as its own PR)
**Goal**: an account created by `POST /users` can sign in, set a password and use the app, in the normal shell and at the pack bench.

1. **Session carries the flag**
   - **File**: `shared/auth/session.types.ts` (`SessionUser.mustChangePassword?: boolean`), `shared/auth/jwt-bearer-session-adapter.ts` (map it from `/auth/me`).
   - **Acceptance**: a unit test asserts the flag round-trips and that absent means `false`.
2. **API + hook**
   - **File**: `features/auth/api/auth.api.ts` (`changePassword`), `features/auth/hooks/use-change-password-mutation.ts`.
   - **Action**:
     - On success, call the session adapter's `refresh()` and then re-read the session, because the JWT claim clears only on re-mint.
     - Map `CURRENT_PASSWORD_INCORRECT` to a field error on current password, and `PASSWORD_UNCHANGED` to a field error on new password.
     - Codes are mirrored in `features/auth/lib/password-change-error.ts` (the `stock-location-override-error.ts` precedent).
   - **Acceptance**: hook tests cover success-then-refresh ordering and both error codes.
3. **`ChangePasswordForm`**
   - **File**: `features/auth/components/change-password-form.tsx` + `change-password-form.schema.ts` (Zod: new 8–72, confirm matches) + `lib/change-password.copy.ts`.
   - **Acceptance**: RTL tests cover validation, submit, the error mapping and the pending state. It is exported from the `auth` barrel.
4. **Gate both surfaces**
   - **Files**: `app/routes/change-password.route.tsx` (eager, standalone, `/consent`-shaped layout), `app/layouts/authenticated-app-layout.tsx`, `app/router.tsx` (`standaloneRoutes`), `features/bench/components/bench-identity-overlay.tsx` (+ `bench-identity.copy.ts`).
   - **Action**:
     - `AuthenticatedAppLayout` redirects to `/change-password?next=…` when `session.user.mustChangePassword`.
     - The bench overlay renders `ChangePasswordForm` in place of the sign-in form while the signed-in user must change, keeping the bench body mounted (ADR-071's overlay rule).
     - Defence in depth: the api client's error path treats a `403` with `code === 'PASSWORD_CHANGE_REQUIRED'` as a session invalidation (the session re-reads `/auth/me`) rather than a feature error.
   - **Acceptance**: `authenticated-app-layout.test.tsx` gets the redirect case; the bench-overlay test gets the change-then-continue case; `route-handle.test.ts` exclusions are updated for the new standalone route.
5. **Backend error code for the #2407 refusal**
   - **File**: `apps/api/src/integrations/application/services/connection.service.ts:162` (+ spec).
   - **Action**: throw `BadRequestException({ code: ROUTING_REQUIRES_ACTIVE_LOCATION_ERROR_CODE, message })` with an exported constant, message unchanged. Mirror it in `features/connections/lib/routing-requires-location-error.ts`.
   - **Acceptance**: the service spec asserts the code; `connection-crud` int-spec (if it asserts the body) is still green.

### Phase 2: Create-user client (step 2's backend)
6. **`users.create` + `useCreateUserMutation`**
   - **File**: `features/users/api/users.api.ts`, `users.types.ts` (`CreateUserRequest`, `CreateUserResponse`), `hooks/use-create-user-mutation.ts`, barrel export.
   - **Action**: invalidate `usersQueryKeys.all` and the packers query. Map a 409 `field` to the form field. **Never** keep `temporaryPassword` in the Query cache: return it from `mutateAsync` only.
   - **Acceptance**: API test for the request shape; hook test asserting the response is not cached.

### Phase 3: Feature scaffold, state derivation and writes
7. **Feature slice + gates registration**
   - **Files**: `features/oms-onboarding/index.ts`; `.eslintrc.js` (the slug in both `no-restricted-imports` groups × 5 canonical subdirs); `scripts/check-ui-vocabulary.mjs` (`SCAN_ROOTS` entry, `owner: 'W-07 (#3457)'`, `pending: false`).
   - **Acceptance**: `pnpm lint` passes, and `check-ui-vocabulary --self-check` passes.
8. **Product-master selection (pure)**
   - **File**: `features/oms-onboarding/lib/product-masters.ts` (+ test).
   - **Action**: `selectProductMasters(connections) → { eligible: Connection[]; partial: {connection, missing: ('ProductMaster'|'InventoryMaster')[]}[] }`. Eligible means `status === 'active'`, and both capabilities are in `supportedCapabilities` and in `enabledCapabilities`. The `partial` list feeds the "which capability is missing" copy.
   - **Acceptance**:
     - Tests cover none, one, two, three or more ("more than two": step 1 blocks with the v1 limit copy), a single-capability connection, and a disabled connection.
     - A Subiekt-shaped fixture (declares both) qualifies with no special case.
9. **Onboarding state derivation (pure)**
   - **File**: `features/oms-onboarding/lib/onboarding-state.ts` (+ test).
   - **Action**: `deriveOnboardingState({ masters, packingConnection, mainLocation, locatedCount, totalCount, sourcingRow, packersCount, view })` returns the mockup's exact `data-state` string, `data-source` (`none` / `two` / the first master's display name via `usePlatform`, lower-cased key; see the edge note), `firstUndoneStep` and `live`. One function, one vocabulary, typed as a union mirroring the mockup comment block (lines 843–849).
   - **Acceptance**: a table test with one row per mockup state.
10. **Config writes (pure helpers + one orchestrating hook)**
    - **Files**: `features/oms-onboarding/lib/config-merge.ts` (+ test), `hooks/use-confirm-product-master-mutation.ts`, `hooks/use-set-packing-mutation.ts`.
    - **Action**:
      - `withConfigKey(config, key, value)` returns a new object; the other keys are untouched.
      - The confirm hook runs sequentially:
        1. Reuse `packingConnection`, or `POST /connections {name, platformType: omsPlatformType, config: {}, enabledCapabilities: ['FulfillmentExecutor']}`. If a reused connection lacks `FulfillmentExecutor` in `enabledCapabilities`, `PATCH` it in (#3476).
        2. Bootstrap the location and resolve the `MAIN` id.
        3. For each master: re-read the connection (fresh config), then `PATCH {config: withConfigKey(fresh, 'stockLocationOverride', mainId)}`. Skip it if it is already equal; honour Q2's default.
      - Each step is idempotent, so a retry after a partial failure converges. The hook reports which step failed.
      - The set-packing hook writes `sourcingAuthority = {...existingClaim, enabled}` on a freshly read config. Stop keeps the claim object and location. Map `ROUTING_REQUIRES_ACTIVE_LOCATION` to the step-4 inline alert.
    - **Acceptance**:
      - Unit tests prove unrelated keys survive, which is an explicit AC.
      - Tests cover the call order, retry convergence, the `FulfillmentExecutor` repair on a reused connection, skipping when already set, and both 400 codes.
11. **Read hooks**
    - **Files**: `features/inventory/index.ts` (+ `useInventoryQuery` export), `features/fulfillment/api/*.types.ts` (+ `status?: FulfillmentWorkStatus[]` on `FulfillmentTaskFilters`, passed through as the backend already accepts it), `features/oms-onboarding/hooks/use-stock-located-progress.ts`.
    - **Action**: the progress hook reads `useInventoryQuery({locationId: mainId}, {limit: 1}).total` against `useInventoryQuery({}, {limit: 1}).total`. It polls (`refetchInterval` 15 s) only while located < total and the page is visible.
    - **Acceptance**: hook test covering polling on and off.

### Phase 4: Wizard UI
12. **Stepper navigation**
    - **File**: `shared/ui/setup-stepper.tsx` (+ test).
    - **Action**: add optional `onSelectStep?(index)` and `maxReachedStep?`. When `onSelectStep` is given, each item renders a `<button>` (`data-testid="wizard-stepper-button-${n}"`), disabled beyond `maxReachedStep`. Without it, rendering is byte-identical to today, so the six existing consumers are unaffected.
    - **Justification**: extending the shared primitive beats a second local stepper, which would split the visual vocabulary.
    - **Acceptance**: existing snapshot/tests unchanged; new tests for clickable/locked/`aria-current`.
13. **Shell**
    - **File**: `features/oms-onboarding/components/oms-onboarding-wizard.tsx` + `lib/oms-onboarding.copy.ts`.
    - **Action**:
      - `WizardLayout` + `SetupStepper` (`data-testid="wizard-stepper"`) + a step panel (`wizard-step-panel`, "Step N of 4", focus moves to the panel heading on step change, as in the mockup) + a footer (`wizard-step-footer`, `btn-back`).
      - It sets `data-state` / `data-source` on its root element. The mockup uses `body`; E2E (#3458) reads the wizard root. Record this in the PR.
    - **Acceptance**: component test for navigation, the locked-step refusal and focus.
14. **Step 1 (product master)**
    - **File**: `components/step-product-master.tsx`.
    - **Action**: covers the states `step-1-no-product-master` / `-product-master` / `-two-product-masters` / `-stock-syncing` / `-stock-complete`:
      - master cards;
      - `alert-no-product-master` with `link-connect-product-master` → `/connections/new`;
      - `alert-two-product-masters`;
      - the partial-capability hint;
      - `btn-confirm-product-master` running the confirm hook;
      - `stock-located-progress` (a `role="progressbar"`, `aria-live="polite"`);
      - `btn-continue-step-1`.
      - Confirm is disabled without admin write access, via `useWriteAccess('connections:write', demoMode)` together with `useIsAdmin()` (the sourcing-rules page's pairing).
    - **Acceptance**: tests per state; no warehouse name rendered (asserted); location created only on click (asserted: no bootstrap call on mount).
15. **Step 2 (packers)**
    - **File**: `components/step-packers.tsx` + `step-packers.schema.ts`.
    - **Action**:
      - Inputs `input-p-name`, `input-p-login`, `input-p-mail` → `useCreateUserMutation` with `role: 'packer'`.
      - `packer-created-notice` + `input-tmp-pass` (read-only) + `btn-copy-pass`, using the clipboard with a select-text fallback.
      - `packer-list` from the packers query.
      - 409 field errors.
      - "Someone already has an account?" links to `/users` for the role change.
      - `btn-continue-step-2` reads "Skip for now" with zero packers.
      - The temporary password lives only in component state and is cleared on unmount.
    - **Acceptance**: tests for create, the one-time display, duplicate username, the skip label, and that the password never appears after remount.
16. **Step 3 (what changes)**
    - **File**: `components/step-what-changes.tsx`.
    - **Action**:
      - `order-flow-diagram` (Today / After), `order-routing-summary` (three boxes), `what-changes-list`, and `ack-what-changes` / `input-ack` gating `btn-continue-step-3`.
      - All sentences come from the copy file. The one- vs two-master wording switches on `masters.length`.
      - Every sentence cites its backing issue in a comment in the copy file, so a reviewer can check each against the chain.
    - **Acceptance**: tests for the ack gate and the two-master wording.
17. **Step 4 (turn on)**
    - **File**: `components/step-turn-on.tsx`.
    - **Action**:
      - `setup-summary` (masters, stock progress with "still filling in", packers), plus `btn-go-step-1-stock` / `btn-go-step-2` links.
      - `btn-turn-on` → the set-packing hook (`enabled: true`). It captures the turn-on timestamp and switches to the waiting view.
      - The Q5 blocking alert when another connection claims A2.
      - The graceful 400 alert.
    - **Acceptance**: tests for success → waiting, the 400 mapping, and the Q5 block.

### Phase 5: After turning on
18. **Status views**
    - **File**: `components/packing-status.tsx`, `components/first-order-panel.tsx`, `components/stop-packing-dialog.tsx`.
    - **Action**:
      - `packing-status-banner` (`data-live`), `link-open-fulfilment` → `/fulfillment`, and `link-open-pack-bench` → the bench.
      - `first-order-panel`: poll `useFulfillmentTasksQuery({limit: 1})` every 10 s while waiting. It switches to `first-order-arrived` when the newest task's `createdAt` is at or after the turn-on moment, and stops polling then.
      - `setup-status`: open-task count per Q3.
      - `btn-ask-stop` → `dialog-stop-packing` (`data-state="dialog-stop-confirm"`, shared `Dialog`) → `btn-stop-now` writes `enabled: false`; `btn-close-dialog` cancels.
      - `status-off` offers `btn-turn-on` ("Start packing again").
    - **Acceptance**:
      - Tests for waiting → arrived, ignoring a pre-turn-on task, stop keeping the location and override (asserted on the PATCH body), and the restart.
      - A read-only role sees the banner and setup list with no stop/start controls.

### Phase 6: Page, route, entry points
19. **Page + OMS lookup**
    - **Files**: `pages/oms/oms-connection.ts` (`OMS_PLATFORM_TYPE`, `findOmsConnections`), `pages/oms/sourcing-rules-page.tsx` (use it), `pages/oms/oms-onboarding-page.tsx`.
    - **Action**: the page resolves the OMS connection and passes `packingConnection` + `omsPlatformType` down. It renders `PageLayout` with the title and description switching between "Pack orders in OpenLinker" and "Packing in OpenLinker", and a back link to `/settings`. It handles loading, error and retry.
    - **Acceptance**: page test; the sourcing-rules page tests stay green.
20. **Route**
    - **File**: `app/routes/oms-onboarding.route.tsx` (`path: 'settings/packing'`, crumb `{group: 'Settings', title: 'Pack orders in OpenLinker'}`, lazy), `app/routes/root.route.tsx`, `route-lazy.test.ts` (69 → 70 with a history line).
21. **Entry points**
    - **Files**:
      - `features/oms-onboarding/components/oms-onboarding-tile.tsx` + `pages/settings/settings-page.tsx`. The tile is ungated, since the status page is readable by every role, with a comment like its neighbours.
      - `plugins/oms/index.ts`: add `setupCard: {title, description, to: '/settings/packing', badge}` and update the docblock (it says "no setupCard, that is #2407").
      - `features/bench/lib/bench-work.copy.ts` (`emptyNotRouted.remedyBody` + link label) + `bench-work-empty.tsx` (`<Link to="/settings/packing">`, shown only in the not-routed empty state).
    - **Acceptance**: settings-page test pins the tile ungated; the platform-picker test shows the OMS card; the bench-empty test shows the link.
22. **Boundary test**
    - **File**: `features/oms-onboarding/__tests__/no-platform-type.test.ts`.
    - **Action**: read every file under the slice and fail on `platformType ===`, `platformType !==` or `.platformType ==`, with a comment citing D19.

### Phase 7: Docs and mockup sync
23. **Docs + mockup**
    - `docs/frontend-architecture.md` gets one line (page-resolved platform data, §5 gap) and the new slug under Feature Public Surface.
    - The mockup is updated **only** for the deviations this plan adopts: `data-state` on the wizard root, the Q1 sentence and the Q3 status line. If none are adopted, the PR says why the mockup still stands.

### Implementation Details
- **Domain / Application / Infrastructure**: none (frontend only).
- **Interface (backend)**: the `ROUTING_REQUIRES_ACTIVE_LOCATION` code (Phase 1, step 5).
- **Configuration changes**: none. The wizard writes existing config keys only (`stockLocationOverride`, `sourcingAuthority`).
- **Database migrations**: none.
- **Events**: none emitted or consumed.
- **Error handling**:
  - **Coded 400s** are mapped via mirrored constants: `STOCK_LOCATION_OVERRIDE_INVALID`, `ROUTING_REQUIRES_ACTIVE_LOCATION`, `CURRENT_PASSWORD_INCORRECT`, `PASSWORD_UNCHANGED`.
  - **409** on user create maps to its field.
  - **403 `PASSWORD_CHANGE_REQUIRED`** triggers a session re-read.
  - **Any other error** shows as an inline `Alert` with a retry; nothing is thrown past the step.
- **Idempotency**: every Confirm sub-step is safe to repeat (reuse the connection, idempotent bootstrap, skip an unchanged override), so "retry" never duplicates.

---

## 7. Alternatives Considered

### A. Turn packing on through the who-decides preset API
- **Why rejected**: no preset grants A2. `openlinker-decides` *disables* every assignable claim (`authority-presets.ts`), which is the opposite of what step 4 needs.
- **Trade-off**: the preset apply has a server-side ambiguity guard. We replicate the useful part client-side (Q5) and rely on the server's own `sourcing` row.

### B. A backend "enable OMS" endpoint that does all four writes in one transaction
- **Why rejected**:
  - It is not in scope for a frontend issue, and it would duplicate `ConnectionService` validation.
  - The writes span three contexts (integrations, inventory, users).
  - Idempotent sequential client writes already converge on retry.
- **Trade-off**: it would be atomic, but it adds a new orchestration seam. Worth revisiting in v2 (#3454), when two warehouses make the sequence longer.

### C. Put the wizard in `plugins/oms` (a plugin-owned route), so the literal `'openlinker'` is legal
- **Why rejected**: the issue places it in `features/oms-onboarding` with a core route, and the page-level lookup has a merged precedent (#3060). A plugin route would also hide a core onboarding flow behind a platform plugin.

### D. A local stepper instead of extending `SetupStepper`
- **Why rejected**: it would be a second visual vocabulary for the same concept. The extension is optional and leaves existing consumers byte-identical.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Dependency direction: `app` → `pages` → `features` → `shared`. Cross-feature imports go only through barrels; the `inventory` barrel gains one export (`useInventoryQuery`).
- ✅ There are no `platformType` comparisons outside `plugins/` or pages: the existing precedent, extracted into one shared helper.
- ✅ Server-state rules: TanStack Query throughout; wizard step in local state; nothing in a global store; no localStorage for progress (derived from the server).

### Naming Conventions
- ✅ `kebab-case.tsx`, `use-*.ts`, `*.copy.ts`, `*.schema.ts`, `*.route.tsx`, `*.test.tsx`.

### Existing Patterns
- ✅ The fetch-fresh-then-merge config write (sales-documents precedent).
- ✅ Mirrored error-code constants (#3207).
- ✅ The forced-redirect standalone route (`/consent`).
- ✅ Page-resolved OMS connection (#3060).

### Risks
- **Partial Confirm** (connection created, bootstrap fails): every step is idempotent. The hook reports the failed step and "Try again" resumes. There is a test for this.
- **Override not applied until the next inventory sync.** The progress bar can sit at 0 for up to one sync cycle (the `master.inventory.syncAll` cadence). The copy says so ("You don't need to wait here"), and step 4 does not require 100%, as the mockup allows.
- **An operator later runs the who-decides "OpenLinker decides" preset.** It sets `sourcingAuthority.enabled = false` and silently stops packing. The status page reads live state, so it shows `status-off` correctly. A cross-link note on the who-decides page is a follow-up, not this PR.
- **An existing session holds a stale `mustChangePassword`** (an admin creates an account while that user is signed in elsewhere). The claim is only on new logins, and a new account has no other session, so this is not reachable today.
- **The password-change gate misses a standalone surface.** Two surfaces exist (shell, bench), and both have tests. The api-client 403 handling is the backstop for any future third one.
- **Clipboard API is unavailable** (insecure context). Fall back to selecting the text, as the mockup does.

### Edge Cases
- **Three or more eligible masters**: step 1 blocks with the v1 copy ("one or two product masters").
- **A master that is active but has `InventoryMaster` off**: listed under "missing capability", and not eligible.
- **The packing connection exists but is `disabled`**: Confirm re-enables it via `PATCH {status: 'active'}`. This is stated in the copy and tested.
- **`MAIN` exists but is inactive**: bootstrap reports it in `existingCodes` and the override would be refused as retired. Step 1 shows a remedy linking to Inventory › Locations. Reactivating it is out of scope.
- **`data-source` for a master whose platform is not one of the mockup's three**: use the plugin's `platformType` key when it exists in the mockup set, otherwise `other`. This is display metadata only and is never branched on.
- **Demo mode**: write controls are visible but disabled (`useWriteAccess`), and the explanatory alerts render.

### Backward Compatibility
- ✅ `SetupStepper` props are additive.
- ✅ The #2407 400 keeps its message; adding a `code` is additive (the frontend matched no message before).
- ✅ The sourcing-rules page uses the extracted lookup with identical behaviour.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests (Vitest + RTL, `renderWithProviders` / `createMockApiClient`)
- **Pure**: `product-masters.test.ts`, `onboarding-state.test.ts` (one row per mockup state), `config-merge.test.ts` (unrelated keys survive).
- **Hooks**: confirm (order, idempotent retry, `FulfillmentExecutor` repair, override skip, Q2 block), set-packing (enable/disable keeps the claim, 400 mapping), create-user (no cache of the password), change-password (refresh after success, codes), stock progress (polling window).
- **Components**: each step's states; status views; the stop dialog; the tile; the platform-picker card; the bench empty link; the change-password form, layout redirect and bench overlay.
- **Guards**:
  - `no-platform-type.test.ts`;
  - `route-lazy.test.ts` (70);
  - `route-handle.test.ts`;
  - the ESLint slug lists;
  - `check-ui-vocabulary`.
- **Backend**: `connection.service.spec.ts` asserts `ROUTING_REQUIRES_ACTIVE_LOCATION`.

### Integration Tests
- No new backend int-spec is needed: every endpoint is existing and covered, and the only change is an additive error code.
- The mockup-parity E2E belongs to #3458. Every `data-testid` above matches the mockup verbatim so that spec can be written against this build.

### Mocking Strategy
- Mock the API client per namespace (`connections`, `inventory`, `users`, `fulfillmentAuthority`, `fulfillment`, `auth`). Never mock hooks.

### Acceptance Criteria (from #3457 + #3504 hand-off)
- [ ] OpenLinker OMS appears as a card in the connection platform picker and opens the wizard.
- [ ] The empty pack bench "No work can reach this bench" links to the wizard; the copy is in `*.copy.ts`.
- [ ] Each mockup `data-state` renders, with the same `data-testid` values.
- [ ] No warehouse name or rename control is rendered; the created location is named "Main warehouse".
- [ ] The packing connection is created (or repaired) with `FulfillmentExecutor` enabled.
- [ ] Step 1 blocks with no product master, accepts one or two (with a warning for two), and creates the location only on Confirm.
- [ ] With two masters, Confirm sets `stockLocationOverride` on both.
- [ ] Every write sends the full existing `config`; unrelated keys survive (unit test).
- [ ] Step 4 is refused gracefully on a 400 (no active location).
- [ ] "Stop packing" writes `sourcingAuthority.enabled = false` and keeps the location and override.
- [ ] No `platformType` comparison in `features/oms-onboarding/` (test); product masters come from capabilities alone; a single-capability connection is not offered, and the missing capability is named.
- [ ] A Subiekt-shaped connection declaring `ProductMaster` + `InventoryMaster` qualifies with no wizard change.
- [ ] A packer created in step 2 can sign in, both in the app and at the pack bench, set a new password, and continue (#3504 hand-off).
- [ ] The one-time password is shown once, never cached, never re-rendered after leaving step 2.
- [ ] `pnpm lint`, `pnpm type-check` and `pnpm test` are green.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (frontend layering; no domain logic in the browser)
- [x] Respects CORE vs Integration boundaries (no core/integration change)
- [x] Uses existing patterns (stepper, config merge, error-code mirrors, `/consent` gate, #3060 lookup)
- [x] Idempotency considered (every Confirm sub-step converges on retry)
- [x] Event-driven patterns used where applicable (none needed; polling only for the read-side progress and first order)
- [x] Rate limits & retries addressed (visibility-gated polling with 10–15 s intervals; no retry loops)
- [x] Error handling comprehensive (coded 400s, 409, 403 gate, inline retry)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md): Fulfillment Authority (#2352/#2353), Inventory locations (#2313/#2407/#3206), ADR-055 OMS connection
- [Frontend Architecture](../frontend-architecture.md): Feature Public Surface, Platform Plugins, Access Control, UX Mockups
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- Mockup: [`docs/plans/mockups/oms-onboarding-wizard.html`](./mockups/oms-onboarding-wizard.html)
