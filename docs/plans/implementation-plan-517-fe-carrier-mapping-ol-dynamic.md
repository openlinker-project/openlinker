# Implementation Plan — #517 FE: carrier-mapping picker exposes OL Dynamic carrier; surface fallback

**Branch:** `517-fe-carrier-mapping-ol-dynamic`
**Closes:** #517 (part of epic #513; depends on #516, just merged)

**Revision history:**
- v1: initial draft
- **v2** (current): incorporated tech-review feedback — replaced inline literal type with `as const` + derived union; **dropped soft-prefill** in favour of relying on the BE runtime fallback chain (#516); collapsed per-row hint into a single banner with muted per-row state; added save-time warning banner; expanded test plan to cover the missing edge cases; documented the pre-existing `id_reference` vs `id_carrier` convention split.

---

## 1. Understand the task

**Goal.** Now that the BE routes per-method shipping through PS carriers and falls back to the OL Dynamic carrier (#516), the FE needs to:

1. Show the OL Dynamic carrier as a clearly-labelled option in every PS-carrier dropdown (mapping page + connection-edit page). No mode toggle.
2. Surface `defaultCarrierId` (the connection-level fallback) on the connection-edit form. Today it's only editable via raw JSON.
3. Make the runtime fallback chain visible to operators when rows are unmapped — no validation duplication, but no silent surprise either.

**Layer.** Frontend (pages + features) + a small CORE/Integration extension to expose a discriminator on `MappingOption`.

**Explicit non-goals** (per issue + tech-review):
- Per-Allegro-method PS-carrier clones (one PS carrier per Allegro method) — future enhancement.
- Bulk-apply UI (set all unmapped to dynamic) — future.
- **Soft-prefill of `defaultCarrierId`** — dropped in v2. The BE runtime already falls back to the OL Dynamic carrier when `defaultCarrierId` is unset (#516), so there's nothing to prefill — the system already does the right thing. We surface this transparently in the help text instead of by silently writing a value into the form.
- Required-when-any-unmapped *validation* — BE owns this; FE doesn't duplicate.
- Fixing the pre-existing `id_reference` vs `id_carrier` split (see §6).

---

## 2. Research summary

### Backend (already in place)
- `MappingOption` (`libs/core/src/orders/domain/types/mapping-option.types.ts`) — neutral `{ value, label }`. No discriminator today.
- `MappingOptionResponseDto` (`apps/api/src/mappings/http/dto/mapping-option-response.dto.ts`) — mirrors above.
- `PrestashopOrderProcessorManagerAdapter.listCarriers()` — queries PS `/carriers` with `display=full` default. The OL Dynamic row is already in the response set; the rows already include `external_module_name` thanks to `display=full`. No extra HTTP call needed.
- `PrestashopConnectionConfigDto.defaultCarrierId` — `@IsOptional()`, `@IsInt()`, `@Min(1)`. Already validated on create/edit.

### Frontend (current state)
- `MappingPanel` — renders one row per source method, native `<select>` per row using `shared/ui/select.tsx`. No per-option decoration.
- `useMappingOptions` — fetches all 6 option lists in parallel.
- `connection-mappings-page.tsx` — composes the page; tests at `connection-mappings-page.test.tsx`.
- Edit-connection schema (`apps/web/src/features/connections/components/edit-connection.schema.ts`) — has `baseUrl`, `shopId`, `storefrontBaseUrl`, `masterCatalogConnectionId`. **No `defaultCarrierId` field.** Operators currently edit it via raw `configText` JSON.
- `Select` primitive — thin wrapper over native `<select>`. Native limitation: option labels are text-only.

### Constraints
- Native `<select>` per `frontend-ui-style-guide.md` §"Inputs, Selects, And Textareas".
- `frontend-architecture.md` dependency direction: `app → pages → features → shared`. Shared must not import features/pages.
- `engineering-standards.md` §"Union Types: `as const` Pattern (Default)" — domain constants crossing API/event/DB boundaries must use `as const` + derived union.

---

## 3. Design

### 3.1 BE: discriminator on `MappingOption`

Per `engineering-standards.md` §"Union Types: `as const` Pattern (Default)":

```ts
// libs/core/src/orders/domain/types/mapping-option.types.ts

/**
 * Behaviour kinds for a MappingOption. Today only `'dynamic'` exists,
 * meaning the option's behaviour is computed by an external module at
 * runtime (e.g. the OpenLinker PS Dynamic carrier reads buyer-paid
 * shipping from the sidecar table at order-total time, #516). Static
 * options omit `kind`. Open for future kinds without breaking changes.
 */
export const MappingOptionKindValues = ['dynamic'] as const;
export type MappingOptionKind = (typeof MappingOptionKindValues)[number];

export interface MappingOption {
  value: string;
  label: string;
  kind?: MappingOptionKind;
}
```

DTO mirrors with `@ApiPropertyOptional({ enum: MappingOptionKindValues })`.

**Why `kind`, not `module: 'openlinker'`.** The FE decorates *behaviour*, not *platform*. `kind` is open-ended; future dynamic carriers (Shopify shipping rates, USPS real-time) reuse the same field. A `module` field would leak PS-specific naming through a neutral CORE type.

### 3.2 BE: PS adapter — populate `kind` for OL Dynamic

In `PrestashopOrderProcessorManagerAdapter.listCarriers()`:
- Extend the local `PrestashopCarrier` row type with `external_module_name?: string`.
- Map `kind: 'dynamic'` when `row.external_module_name === 'openlinker'`. Static rows omit `kind`.

### 3.3 FE: types + label decoration

- Mirror the const + union in the FE types module so FE doesn't carry a parallel literal.
- `MappingPanel` builds the visible label as: `${label} — exact Allegro cost` when `kind === 'dynamic'`. **Shorter copy than v1** to mitigate truncation risk in narrow column widths (tech-review SUGGESTION). If truncation is still observed during dev (≤1024 px viewport), promote the carrier-mapping select to the existing `Select` (enhanced) Radix wrapper — already in shared/ui per `frontend-ui-style-guide.md`. Decision recorded after manual visual check during impl; default is native `<select>` until proven insufficient.

### 3.4 FE: fallback transparency on the mapping page

Per tech-review SUGGESTION 5 — single banner, not per-row repetition.

When the carrier `MappingPanel` loads, render a single `Alert tone="info"` banner above the table when:
- (a) at least one row is unmapped, AND
- (b) `connection.config.defaultCarrierId` is set: *"{N} method(s) unmapped — will use fallback: {fallbackName}."*
- (c) `connection.config.defaultCarrierId` is NOT set AND OL Dynamic carrier exists: *"{N} method(s) unmapped — will use the OpenLinker Dynamic carrier (exact Allegro cost) at sync time."* (Soft, not alarmist.)
- (d) neither set nor OL available: *"{N} method(s) unmapped — these will fail at sync until a carrier mapping or fallback is configured."* (Operator-actionable.)

Per-row state: unmapped rows render with a muted placeholder (italic `--text-muted`) — visual cue without per-row text repetition.

### 3.5 FE: `defaultCarrierId` on edit-connection form (no soft-prefill)

Per tech-review IMPORTANT/SUGGESTION — option (A): **no auto-prefill**. Field is blank-allowed. Help text and a save-time warning banner make the consequences explicit.

- Extend `editConnectionSchema` with `defaultCarrierId: z.string().optional()` (form-level string, mirrors `shopId`).
- `mergeStructuredIntoConfig`: when blank → omit; when set → coerce to integer + validate `>= 1`; surface invalid as a Zod refine error.
- Render a `<Select>` field for PS connections (hidden for non-PS).
- Options sourced from `getMappingOptions(connectionId, 'destination', 'carriers')`.
- OL Dynamic option decorated identically to the mapping panel.
- **No prefill.** Field starts whatever the saved config has (empty for fresh connections).
- Help text: *"When unset, OpenLinker uses its Dynamic carrier (exact Allegro shipping cost) as the runtime fallback. Pick a static PS carrier here only if you want a different fallback."*
- **Save-time warning banner** (tech-review IMPORTANT 2) — when the operator submits with `defaultCarrierId` blank AND any carrier-mapping row is also blank AND the connection has no OL Dynamic carrier installed, the form renders an `Alert tone="warning"` summary above the submit button: *"This connection has no fallback carrier and {N} unmapped shipping methods. Install the OpenLinker PS module or pick a fallback to avoid sync failures."* This is information, not blocking validation. It mirrors the BE's actual failure mode (#516 throws `PrestashopOlCarrierMissingException` if neither is set).
  - **Note:** detecting "no OL Dynamic carrier installed" requires a successful response from `listCarriers()` that contains zero `kind: 'dynamic'` options. If the call fails, the warning is suppressed (we can't be sure).

### 3.6 Data flow (unchanged from v1)

```
EditConnectionPage / MappingsPage
  ↓ useMappingOptions(connectionId)
  ↓ GET /connections/:id/mappings/options/destination/carriers
  ↓ MappingOptionResponseDto[] including kind?: 'dynamic'
  ↓
MappingPanel / EditConnectionForm
  ↓ render <select> with decorated label per option
  ↓ render banner / help-text using kind discriminator
```

`kind` is presentation-only, never persisted.

---

## 4. Step-by-step plan

### S1 — `MappingOptionKindValues` + `MappingOption.kind` (CORE)
**File:** `libs/core/src/orders/domain/types/mapping-option.types.ts`
**Change:** add `MappingOptionKindValues` const + `MappingOptionKind` derived union; add `kind?: MappingOptionKind` to `MappingOption`.
**Acceptance:** type-check passes; existing call sites unaffected (field is optional).

### S2 — DTO mirrors `kind`
**File:** `apps/api/src/mappings/http/dto/mapping-option-response.dto.ts`
**Change:** add `@ApiPropertyOptional({ enum: MappingOptionKindValues }) kind?: MappingOptionKind`. Re-export the const from the DTO module if convenient.
**Acceptance:** Swagger reflects the field; existing serialization unaffected.

### S3 — PS adapter `listCarriers()` populates `kind`
**Files:**
- `libs/integrations/prestashop/src/domain/types/prestashop-options.types.ts` — extend `PrestashopCarrier` with `external_module_name?: string` (already returned by PS WS via `display=full`).
- `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` — in `listCarriers()`, set `kind: 'dynamic'` when `row.external_module_name === 'openlinker'`.

**Acceptance:** unit tests in `__tests__/prestashop-order-processor-manager.adapter.spec.ts` cover (a) row with `external_module_name='openlinker'` → option carries `kind: 'dynamic'`; (b) static row → option omits `kind`.

### S4 — BE tests
**File:** `libs/integrations/prestashop/src/infrastructure/adapters/__tests__/prestashop-order-processor-manager.adapter.spec.ts`
**Acceptance:** `pnpm --filter @openlinker/integrations-prestashop test` passes.

### S5 — Mirror `kind` in FE option types
**File:** `apps/web/src/features/mappings/api/mappings.types.ts` (confirm during impl — likely re-exports BE shape).
**Acceptance:** FE type-check passes; FE option type carries the optional `kind`.

### S6 — `MappingPanel` label decoration + per-row muted state
**File:** `apps/web/src/features/mappings/components/MappingPanel.tsx` (+ co-located CSS)
**Changes:**
1. Compute `displayLabel` for each option: `${label} — exact Allegro cost` when `kind === 'dynamic'`.
2. Per-row muted placeholder when the row's value is empty (italic via `--text-muted`).
3. Manual visual check during impl at 1024 px and 1440 px column widths. If truncation is observed, switch to the existing `Select` (enhanced) wrapper. Decision documented in commit message.

**Acceptance:** existing `MappingPanel.test.tsx` extended with: (a) dynamic-option label rendered with the suffix; (b) unmapped row visually distinct.

### S7 — `connection-mappings-page.tsx` wires fallback banner
**File:** `apps/web/src/pages/connections/connection-mappings-page.tsx`
**Changes:**
1. Read `connection.config.defaultCarrierId` (already loaded via `useConnectionQuery`).
2. Look up the fallback name and dynamic-availability against the loaded carrier options.
3. Render a single `Alert` banner above the carrier `MappingPanel` when there are unmapped rows:
   - tone `'info'` when fallback present (cases b/c in §3.4)
   - tone `'warning'` when no fallback and no OL Dynamic (case d)
4. Banner suppressed when carriers query is loading or errored.

**Acceptance:** `connection-mappings-page.test.tsx` covers: (i) banner with static fallback name, (ii) banner with OL Dynamic name, (iii) warning banner when neither, (iv) no banner when nothing is unmapped, (v) no banner during loading state.

### S8 — Edit-connection form: `defaultCarrierId` field + save-time warning banner
**Files:**
- `apps/web/src/features/connections/components/edit-connection.schema.ts`
- `apps/web/src/features/connections/components/edit-connection-form.tsx` (confirmed exists; will extend)
- co-located CSS

**Changes:**
1. Extend `editConnectionSchema` with `defaultCarrierId: z.string().optional()`.
2. `mergeStructuredIntoConfig`: blank → omit; set → coerce to integer + `>= 1`.
3. Render a `<Select>` field for PS connections only. Help text per §3.5.
4. Options from `getMappingOptions(connectionId, 'destination', 'carriers')`.
5. Decorate `kind === 'dynamic'` identically to `MappingPanel`.
6. **No prefill.**
7. Save-time warning banner per §3.5 — `Alert tone="warning"` rendered above the submit button when (a) `defaultCarrierId` blank, (b) any mapping row blank (queryable from `useCarrierMappingsQuery`), (c) zero `kind: 'dynamic'` options in the loaded carriers. Information, not blocking.

**Test file decision (tech-review SUGGESTION 8):** Pick `edit-connection.schema.test.ts` (new, small, focused) for schema validation logic. Form-component tests live in `edit-connection-form.test.tsx` — extend if it exists, create if not. Confirm during impl.

**Acceptance:** schema test covers blank/valid/invalid integer; form-component tests cover (a) field renders with the dynamic option decorated, (b) operator selection persists on submit, (c) blank submit allowed (no validation error), (d) save-time warning banner renders only when all three conditions match, (e) **no soft-prefill happens at any time** (regression test for v1's design that we explicitly dropped — pin it down so no one reintroduces it).

### S8a — New tests added per tech-review IMPORTANT 3

The "edge cases for soft-prefill" tests from v1 are obsolete since prefill is gone. Replaced with:
- Connection with no OL Dynamic option (operator hasn't installed module): banner tone is `warning` per §3.4 case (d); edit-form `defaultCarrierId` Select renders without the dynamic decoration in any option (since none is dynamic).
- Carriers query in error state: no banner, no save-time warning, form remains usable (defaults to the previously-saved value).
- Operator picks a static carrier as `defaultCarrierId`, then *also* maps every row → no banner (everything routed).

### S9 — Quality gate
`pnpm lint && pnpm type-check && pnpm test`. Build BE packages between BE-only changes and FE consumption (cross-package dist).

### S10 — Self-review per `code-review-guide.md`
Architecture, naming, type-safety, test coverage, security.

### S11 — Commit + PR
Conventional commit. PR body uses `Closes #517`.

---

## 5. Validation

- **Architecture compliance:** CORE owns the type extension; PS adapter (Integration) owns the discriminator detection; FE consumes via the existing capability-options endpoint. No CORE→Integration leakage. Native `<select>` preserved per FE style guide.
- **Naming:** `MappingOption.kind` — neutral, behaviour-not-platform discriminator. `as const` + derived union per engineering-standards.md.
- **Tests:** BE — adapter spec extends `listCarriers` describe with two cases. FE — `MappingPanel.test.tsx`, `connection-mappings-page.test.tsx`, `edit-connection.schema.test.ts` (new), `edit-connection-form.test.tsx` (extended), each with the cases enumerated in S6/S7/S8/S8a.
- **Security:** no new credentials, no PII added to logs. `defaultCarrierId` is operator config, exposed today via JSON editor.

## 6. Pre-existing convention split (documented; not fixed here)

`MappingOption.value` returns PS `id_reference` (stable across BO carrier edits), while `PrestashopConnectionConfig.defaultCarrierId` is documented as `id_carrier` and used directly as `id_carrier` in the cart/order body by the PS adapter (#516). On a fresh PS install they're identical; on a shop where carriers have been cloned/edited in BO they diverge. The mapping config table also stores `id_reference` and the BE adapter passes it through as `id_carrier` — so there's already inconsistent behaviour on edited shops.

**#517 reuses the same dropdown for `defaultCarrierId`, inheriting the convention** (`id_reference` stored). Doesn't make the situation worse; doesn't fix it. Fixing requires either a separate `defaultCarrierId` dropdown sourced from `id_carrier` directly OR standardising both ends on `id_reference` and updating the BE adapter to dereference. Out of scope here. Track as a follow-up issue when this PR opens.

## 7. Risks

- **R1** — *PS WS schema drift on `external_module_name`.* Mitigated by BE tests on both branches.
- **R2** — *Native `<select>` decoration text-only.* Suffix shortened to "exact Allegro cost"; visual check during impl; escape hatch is `Select` (enhanced) wrapper already in shared/ui.
- **R3** — *Save-time warning banner false-negative when carriers query errors.* Acceptable: banner is informational; the BE rejects the actual failure mode at order-create time anyway.
- **R4** — *Operators ignore the warning banner and ship with no fallback + no module installed.* Acceptable: same failure mode as today (orders fail at sync), but now visible at config time.

## 8. Out of scope (recap)
- Per-method PS-carrier clones.
- Bulk-apply UI.
- Required-when-empty validation duplication on the FE.
- Auto-create OL Dynamic carrier defaults on connection-create.
- Soft-prefill of `defaultCarrierId`.
- Promoting native `<select>` to Radix unconditionally (only if visual check finds truncation).
- Fixing the `id_reference` vs `id_carrier` convention split.
