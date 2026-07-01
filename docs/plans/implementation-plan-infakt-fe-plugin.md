# Implementation Plan: inFakt FE Plugin + Invoice-Section Host Redesign

**Date**: 2026-07-01
**Status**: Draft
**Estimated Effort**: 2-3 days

---

## 1. Task Summary

**Objective**: Ship the inFakt frontend plugin (guided connection setup, credentials rotation,
invoice detail region, KOR correction flow) and, alongside it, a visual redesign of the shared
`OrderInvoicePanel` regulatory-section host chrome that all three invoicing providers
(KSeF, Subiekt, inFakt) render into.

**Context**: The inFakt backend (epic #1279) is code-complete on two open PRs — #1292
(`InfaktInvoicingAdapter` implementing `InvoicingPort` + `RegulatoryStatusReader` +
`CorrectionIssuer`, hardening + unit tests) and #1293 (plugin registration + webhook
ingestion, stacked on #1292, still draft). Issue #1282 tracks the FE half and has already
been updated (this session) to include the correction-flow scope item that was missing from
the original spec. A design-review mockup was built and approved by the user
(https://claude.ai/code/artifact/2c542a0c-0719-4db1-b9d0-c962be23dadb, 7 screens) covering
every screen/state for both pieces of work — this plan turns that approved mockup into an
execution-ready implementation.

**Classification**: Frontend (`apps/web`). No CORE, Integration, or Infrastructure changes —
the backend capability surface (`InvoicingPort`, `RegulatoryStatusReader`, `CorrectionIssuer`,
`POST /invoices/:invoiceId/correct`, `PUT /connections/:id/credentials`) already exists and is
generic/capability-gated.

---

## 2. Scope & Non-Goals

### In Scope

- New `infakt` plugin under `apps/web/src/plugins/infakt/` (descriptor, invoice-detail-section,
  correction-flow, structured-config section).
- Guided single-step connection setup form + page + route
  (`features/connections/components/infakt-setup-form.tsx` + schema,
  `pages/connections/infakt-setup-page.tsx`, `plugins/infakt/infakt-setup.route.tsx`) — mirrors
  the Erli pattern (single `apiKey` credential + optional `baseUrl` config override), **not**
  the generic inline `CreateConnectionForm` the original issue #1282 text implied (see
  §7 Alternatives).
- `InfaktCredentialsPanel` (post-create key rotation) — near-identical port of
  `ErliCredentialsPanel`.
- `InfaktStructuredSection` (post-create `baseUrl` edit in `EditConnectionForm`) — near-identical
  port of `WoocommerceStructuredSection`'s single-field shape.
- `InfaktInvoiceDetailSection` (regulatory-status region: not-applicable / submitted /
  accepted / rejected) — reuses the neutral `RegulatoryStatusBadge`; no `cleared` label per the
  verified `RegulatoryStatusValues` contract (terminal success is `accepted` only, see §4).
- `InfaktInvoiceCorrectionFlow` (KOR modal) — near-1:1 port of `KsefInvoiceCorrectionFlow`'s
  line-row model, since both ride the same generic `useIssueCorrectionMutation` +
  `POST /invoices/:invoiceId/correct` contract.
- Registration in `apps/web/src/plugins/index.ts`.
- Redesign of the shared `.invoice-panel__inline-alert` / raw `.slot-row` host chrome in
  `OrderInvoicePanel` (`features/invoicing/components/order-invoice-panel.tsx`) and the
  KSeF/Subiekt detail sections' outer chrome, into the "reg-card" treatment validated in
  mockup screen 07 (severity-stripe card, icon header, progress bar for pending, grouped
  actions + copyable chip for accepted, proper `Alert`-style callout for rejected). Reuses
  only existing OKLCH status tokens — no new colors.

### Out of Scope

- Any backend change. #1292/#1293 already ship the full capability surface this plugin
  consumes.
- `WebhookProvisioningPort` UI — inFakt's webhook is BE-only per #1293's PR description
  ("No `WebhookProvisioningPort` … webhook setup is UI-only, per issue scope" — meaning no FE
  work needed either way).
- i18n string migration — new strings use `t(key, fallback)` per the existing no-op i18n seam
  convention; no catalog entries are added (matches every other plugin today).
- Changing `RegulatoryStatusValues` / adding a `cleared`-distinct UI state — confirmed no
  provider emits `cleared` today; out of scope for this plan (see §4, §5 Assumptions).
- A full visual overhaul of unrelated shared UI primitives — the redesign is scoped to the
  invoice regulatory-section chrome only (§ In Scope), not a broader design-system pass (per
  saved user feedback: apply incrementally, don't big-bang redesign unprompted).

### Constraints

- Must not introduce a new GitHub issue's worth of backend work — this is FE-only.
- Branch/PR: single branch `1282-infakt-fe-plugin` (this worktree), single PR closing #1282.
  The host-panel redesign rides in the same PR (see §7 Alternatives for why a separate issue
  was filed but not a separate PR).
- Must pass `pnpm --filter @openlinker/web lint`, `type-check`, `test` before commit.

---

## 3. Architecture Mapping

**Target Layer**: Frontend only — `plugins/`, `features/connections/`, `features/invoicing/`,
`pages/connections/`.

**Capabilities Involved** (backend, already shipped): `Invoicing` (base port),
`RegulatoryStatusReader`, `CorrectionIssuer` — all resolved server-side; the FE never
capability-checks directly, it renders based on neutral `InvoiceRecord.regulatoryStatus` and
the presence of the plugin's `invoiceCorrectionFlow` / `invoiceDetailSection` slots.

**Existing Services/Hooks Reused** (zero new hooks needed):
- `useCreateConnectionMutation`, `useTestConnectionMutation`, `useUpdateConnectionCredentialsMutation`
  (`features/connections`)
- `useIssueCorrectionMutation`, `RegulatoryStatusBadge` (`features/invoicing` public barrel)
- `usePlatform` / `usePlatforms` (`shared/plugins`)
- `definePlugin` (`plugins/define-plugin`)

**New Components Required**:
- `plugins/infakt/index.ts` (descriptor)
- `plugins/infakt/infakt-setup.route.tsx`
- `plugins/infakt/components/infakt-structured-section.tsx`
- `plugins/infakt/components/infakt-credentials-panel.tsx`
- `plugins/infakt/components/infakt-invoice-detail-section.tsx`
- `plugins/infakt/components/infakt-invoice-correction-flow.tsx`
- `features/connections/components/infakt-setup-form.tsx`
- `features/connections/components/infakt-setup.schema.ts`
- `pages/connections/infakt-setup-page.tsx`
- (redesign) modifications to `features/invoicing/components/order-invoice-panel.tsx` and a new
  shared `reg-card` CSS block in `index.css`; light edits to `ksef-invoice-detail-section.tsx`
  and `subiekt-invoice-detail-section.tsx` outer `<section>` wrappers to adopt the new class.

**Core vs Integration Justification**: N/A — no CORE or Integration change. All contract
surfaces (`InvoiceRecord`, `RegulatoryStatus`, `POST /invoices/:invoiceId/correct`,
`PUT /connections/:id/credentials`) are pre-existing and generic.

---

## 4. External / Domain Research

### Backend contract (verified against `1280-infakt-plugin-hardening-tests` branch, PR #1292)

- `InfaktCredentials = { apiKey: string }`, `InfaktConnectionConfig = { baseUrl?: string }`
  (`libs/integrations/infakt/src/domain/types/infakt-connection.types.ts`) — confirms issue
  #1282's field list is accurate and minimal.
- `InfaktInvoicingAdapter implements InvoicingPort, RegulatoryStatusReader, CorrectionIssuer` —
  `issueCorrection` is real, confirming the correction-flow scope item added to #1282 this
  session is backed by working code, not speculative.
- adapterKey: `infakt.accounting.v1` (per epic #1279 / PR #1293 description).

### Neutral invoicing contract (verified against `apps/web/src/features/invoicing/api/invoicing.types.ts`, current main)

- `RegulatoryStatusValues = ['not-applicable', 'submitted', 'cleared', 'accepted', 'rejected']`
  but the file's own doc-comment states: *"Terminal success is `accepted`… `cleared` is
  reserved for split-clearance regimes and no current provider emits it, so the FE never
  renders a `cleared` success label."* This **corrects** one of the mockup's open design
  questions (mockup screen 04 flagged uncertainty between `cleared` vs `accepted`) — the
  answer is: **only `accepted` gets the success/UPO-style treatment; `cleared` needs no
  distinct UI in this plan.**
- `InvoiceRecord` has no seller/buyer/line-item fields — confirmed by the mockup agent's own
  research; `InfaktInvoiceDetailSection` renders only from `clearanceReference`,
  `providerInvoiceNumber`, `regulatoryStatus`, `failureReason`.
- `POST /invoices/:invoiceId/correct` body: `{ reason?, lines: [{ originalLineNumber,
  newQuantity?, newUnitPriceGross? }], idempotencyKey? }` — identical shape KSeF already uses;
  `InfaktInvoiceCorrectionFlow` needs no new types.

### Internal patterns (verified by reading current-main source, this session)

- **Setup flow**: every FE plugin with a non-OAuth single/few-credential shape (Erli is the
  closest analog to inFakt: one `apiKey` + optional `baseUrl`) ships a guided route
  (`plugins/<name>/<name>-setup.route.tsx`) → page (`pages/connections/<name>-setup-page.tsx`)
  → form (`features/connections/components/<name>-setup-form.tsx` + `.schema.ts`). The
  `PlatformPicker` component (`features/connections/components/platform-picker.tsx`) always
  navigates via `setupCard.to` to that dedicated route — there is **no** inline generic-form
  path for a plugin with a `setupCard` (the generic `CreateConnectionForm`'s raw-JSON path is
  reserved for platforms with no plugin at all, or the `/connections/new/advanced` escape
  hatch). This is a **correction to issue #1282's original text**, which implied wiring
  `StructuredConfigSection` into the generic create form — the actual codebase convention is
  the guided-form pattern. Erli's `ErliSetupForm` (`features/connections/components/erli-setup-form.tsx`)
  + `erli-setup.schema.ts` are the reference implementation to port almost verbatim.
- **Credentials rotation**: `ErliCredentialsPanel` is the exact single-`apiKey` analog (KSeF's
  panel additionally rotates an `authType` enum, which inFakt doesn't have).
- **Post-create structured-edit**: `WoocommerceStructuredSection`'s single-field `siteUrl`
  shape is the closest analog for editing `baseUrl` after creation via `EditConnectionForm`
  (Erli deliberately skips this and falls back to raw JSON — inFakt keeps it per #1282's
  explicit ask, and the field count is the same as WooCommerce's, so the precedent is sound).
- **Invoice detail section**: `SubiektInvoiceDetailSection` is the simpler analog (badge + KV
  rows, no dialog); `KsefInvoiceDetailSection` shows the same shape plus UPO/FA(3) dialogs that
  inFakt does not need (inFakt has no UPO/FA3 endpoints — it only reports KSeF status +
  `clearanceReference`, matching Subiekt's posture more closely than KSeF's). **Decision**:
  base `InfaktInvoiceDetailSection` on `SubiektInvoiceDetailSection`'s structure (badge + KV,
  no dialogs), not KSeF's.
- **Correction flow**: `KsefInvoiceCorrectionFlow` (`plugins/ksef/components/ksef-invoice-correction-flow.tsx`)
  is the exact contract match (`InvoiceCorrectionFlowProps`, `useIssueCorrectionMutation`,
  same line-row model) — port near-verbatim, only the section title / copy changes.
  `SubiektInvoiceCorrectionFlow` exists too and is worth a quick diff-check during
  implementation in case it diverged from KSeF's in a way worth adopting, but KSeF is the
  primary reference since the mockup was built against it.
- **`OrderInvoicePanel` current host chrome** (verified by reading the full current
  implementation): it is **already more polished than the mockup's "before" baseline assumed**
  — it has `InvoiceStatusBadge` + `RegulatoryStatusBadge` in the header, a real
  `.invoice-panel__inline-alert` component for `failed`/`in-doubt` (colored bar + bold title +
  body), and a proper KV block for `issued`. The redesign's real value-add is: (a) a dedicated
  card treatment for the *provider's own* `invoiceDetailSection` slot content (today it's a
  bare `<section>` inside the KV block, mockup's "after" wraps it in a severity-stripe card),
  and (b) consistent iconography + a progress bar for the `submitted`/pending window. Plan
  scope is narrowed accordingly — see Phase 2 below.

---

## 5. Questions & Assumptions

### Open Questions

- Setup-card icon/monogram and its color (mockup open item #1/#2) — no existing plugin uses an
  icon badge on its setup card (KSeF, Erli, WooCommerce all use title + `badge` chip only).
  **Default**: drop the invented "iF" monogram, match the established title+badge-chip
  convention exactly (no icon) unless the user says otherwise.
- Whether the host-panel redesign should also touch `not-issued` / `pending` / `issuing` /
  `failed` / `in-doubt` panel states beyond the provider-slot card, or stay narrowly scoped to
  the provider `invoiceDetailSection` region. **Default**: narrow scope — only the provider
  slot's card wrapper + its internal submitted/accepted/rejected states change; the panel's
  own `not-issued`/`pending`/`issuing`/`failed`/`in-doubt` states (which are already
  well-designed per §4) are left untouched in this plan.

### Assumptions

- `cleared` needs no distinct UI (confirmed in §4 — safe default, not a guess).
- inFakt has no PDF/UPO/FA3-equivalent document to surface — only `clearanceReference` /
  `providerInvoiceNumber` / `failureReason`. If this turns out wrong once #1292/#1293 merge
  and a real sandbox response is inspected, `InfaktInvoiceDetailSection` is a single small
  component to extend later — not a blocking assumption.
- The host-panel redesign is CSS/markup-only — no new props on `InvoiceDetailSectionProps` /
  `InvoiceCorrectionFlowProps` are needed. The card wrapper can be added by `OrderInvoicePanel`
  around the slot's rendered output without changing the slot contract, since the slot already
  renders a self-contained `<section>` (see `SubiektInvoiceDetailSection`) — the host can wrap
  that section in a `.reg-card` div, or the redesign can standardize each section's own root
  class name to `reg-card` directly. **Decision**: change the section components' own root
  class (KSeF, Subiekt, inFakt all switch to `reg-card` + a `--tone` modifier) rather than
  double-wrapping from the host, since the section owns its own semantic content (title, rows)
  and is best positioned to know its own severity tone.

### Documentation Gaps

- None — `docs/frontend-architecture.md` § Platform Plugins fully documents the slot contract;
  the guided-setup-route pattern isn't written down as a named convention anywhere, it only
  exists as consistent precedent across 6+ plugins. Worth a follow-up doc note, out of scope
  for this plan.

---

## 6. Proposed Implementation Plan

### Phase 1: inFakt plugin — connection lifecycle

**Goal**: An operator can create, view, and rotate credentials for an inFakt connection.

**Steps**:

1. **Setup schema**
   - **File**: `apps/web/src/features/connections/components/infakt-setup.schema.ts`
   - **Action**: Port `erli-setup.schema.ts` verbatim, renaming `ERLI_ADAPTER_KEY` →
     `INFAKT_ADAPTER_KEY = 'infakt.accounting.v1'`, `platformType: 'infakt'`. Keep the same
     `name` / `apiKey` / `baseUrl` (https-only, optional) Zod shape.
   - **Acceptance**: `infaktSetupSchema` exports match Erli's shape 1:1 minus naming.

2. **Setup form**
   - **File**: `apps/web/src/features/connections/components/infakt-setup-form.tsx`
   - **Action**: Port `erli-setup-form.tsx` verbatim, swap copy ("inFakt" / "API key from your
     inFakt account settings" instead of "Shop API key" / seller-panel copy), swap the
     `BackLink` target stays `/connections/new`, swap toast copy.
   - **Acceptance**: form renders name/apiKey/baseUrl fields, submit creates the connection via
     `useCreateConnectionMutation`, shows "Test connection" affordance after create (reuses
     `useTestConnectionMutation` — no changes needed there).

3. **Setup page + route**
   - **Files**: `apps/web/src/pages/connections/infakt-setup-page.tsx`,
     `apps/web/src/plugins/infakt/infakt-setup.route.tsx`
   - **Action**: Port `erli-setup-page.tsx` / `erli-setup.route.tsx` verbatim with inFakt copy
     and path `connections/new/infakt`.
   - **Acceptance**: navigating to `/connections/new/infakt` renders the page with the form.

4. **Credentials panel**
   - **File**: `apps/web/src/plugins/infakt/components/infakt-credentials-panel.tsx`
   - **Action**: Port `ErliCredentialsPanel` verbatim (single `apiKey` rotate, same
     `credentialsBacked` fallback).
   - **Acceptance**: matches `erli-credentials-panel.test.tsx`'s five assertions when ported
     to an `infakt-credentials-panel.test.tsx` (see Phase 4).

5. **Structured config section (post-create `baseUrl` edit)**
   - **File**: `apps/web/src/plugins/infakt/components/infakt-structured-section.tsx`
   - **Action**: Port `WoocommerceStructuredSection`'s single-field pattern, one `FormField`
     for `baseUrl` bound via `syncStructuredToJson('baseUrl', value)`, helper text explaining
     sandbox vs. production (per issue #1282's original ask).
   - **Acceptance**: editing an existing inFakt connection's `baseUrl` in `EditConnectionForm`
     round-trips through `configText` JSON correctly (mirror
     `woocommerce-structured-section.test.tsx`'s assertions).

### Phase 2: inFakt plugin — invoice surfacing

**Goal**: Regulatory status and KOR corrections are visible/actionable on an inFakt-issued
invoice, using the redesigned host chrome.

**Steps**:

6. **Redesign the provider-slot host chrome** (do this before wiring inFakt's own section, so
   inFakt is born with the new look and KSeF/Subiekt get it as a drive-by improvement)
   - **Files**:
     - `apps/web/src/index.css` — new bounded section `/* ── Regulatory section card (#1282) ── */`
       adding `.reg-card`, `.reg-card--info` / `.reg-card--success` / `.reg-card--error`
       (severity-stripe via `border-left` + existing `--status-*` tokens, no new colors),
       `.reg-card__header` (icon + title row), `.reg-card__progress` (indeterminate bar for
       `submitted`), `.reg-card__summary` (accepted: reference chip + grouped actions).
     - `apps/web/src/plugins/ksef/components/ksef-invoice-detail-section.tsx` — change the root
       `<section className="invoice-detail-section invoice-detail-section--ksef">` to also
       carry `reg-card reg-card--{tone}` (tone derived from `regulatoryStatus`: `submitted` →
       info, `accepted` → success, `rejected` → error, `not-applicable`/other → no card, keep
       returning `null`).
     - `apps/web/src/plugins/subiekt/components/subiekt-invoice-detail-section.tsx` — same
       root-class change.
   - **Acceptance**: existing KSeF/Subiekt detail-section tests still pass unchanged (class
     name is additive, not a DOM restructure) — run
     `pnpm --filter @openlinker/web test ksef-invoice-detail-section subiekt-invoice-detail-section`
     to confirm no visual-only test asserts the old class name exclusively.
   - **Risk**: if any existing test asserts `container.querySelector('.invoice-detail-section')`
     exactly, keep that class alongside the new one (additive) rather than replacing it — see
     §8 Risks.

7. **Invoice detail section**
   - **File**: `apps/web/src/plugins/infakt/components/infakt-invoice-detail-section.tsx`
   - **Action**: Base on `SubiektInvoiceDetailSection`'s structure (badge + KV rows, no
     dialogs), applying the new `reg-card` root class from step 6 directly (inFakt ships with
     the redesigned look from day one — no "before" version to migrate). Render:
     - `not-applicable` → return `null` (no card)
     - `submitted` → `reg-card--info`, `RegulatoryStatusBadge`, progress bar, "Pending KSeF
       clearance…" copy
     - `accepted` → `reg-card--success`, `RegulatoryStatusBadge`, KV row with
       `clearanceReference` (copyable — reuse existing copy-to-clipboard affordance if one
       exists in `shared/ui`, else a plain `<code>` + a small "Copy" button using
       `navigator.clipboard.writeText`)
     - `rejected` → `reg-card--error`, `RegulatoryStatusBadge`, `failureReason` text
   - **Acceptance**: matches mockup screen 04's four states exactly; unit test covers all four
     `regulatoryStatus` values plus the `not-applicable` no-render case.

8. **Correction flow**
   - **File**: `apps/web/src/plugins/infakt/components/infakt-invoice-correction-flow.tsx`
   - **Action**: Port `KsefInvoiceCorrectionFlow` near-verbatim (per the issue #1282 update
     made this session) — same line-row model (`originalLineNumber` / `newQuantity` /
     `newUnitPriceGross`), one empty row + "Add line", reuses
     `useIssueCorrectionMutation` from `features/invoicing`. Swap only the dialog title/copy
     to inFakt-specific wording.
   - **Acceptance**: matches `ksef-invoice-correction-flow.test.tsx`'s assertions 1:1 when
     ported (empty-row start, add-line, validation, submit success/error).

### Phase 3: Registration

**Steps**:

9. **Plugin descriptor**
   - **File**: `apps/web/src/plugins/infakt/index.ts`
   - **Action**:
     ```typescript
     export const infaktPlugin: OpenLinkerPlugin = definePlugin({
       id: 'infakt',
       platformType: 'infakt',
       build: { routes: [infaktSetupRoute] },
       platform: {
         displayName: 'inFakt',
         setupCard: {
           title: 'inFakt',
           description: 'Polish accounting platform with native KSeF integration',
           to: '/connections/new/infakt',
           badge: 'API key',
         },
         StructuredConfigSection: InfaktStructuredSection,
         CredentialsPanel: InfaktCredentialsPanel,
         invoiceDetailSection: InfaktInvoiceDetailSection,
         invoiceCorrectionFlow: InfaktInvoiceCorrectionFlow,
       },
     });
     ```
   - **Acceptance**: `assertUniquePluginInvariants` passes with the new entry (no id/platformType
     collision — trivially true, `infakt` is new).

10. **Barrel registration**
    - **File**: `apps/web/src/plugins/index.ts`
    - **Action**: add `import { infaktPlugin } from './infakt';` and append to the `plugins`
      array (position: after `subiektPlugin`, before `ksefPlugin`, keeping the existing
      invoicing-providers-last-ish grouping — exact order doesn't affect correctness, only
      setup-card display order).
    - **Acceptance**: `/connections/new` shows the inFakt card; `pnpm --filter @openlinker/web test`
      green (covers the module-load duplicate-id/platformType assertion).

### Implementation Details

**New Components**: listed in §3 above — all `apps/web`, no domain/application/infrastructure
layers touched (this is a pure-FE plan).

**Configuration Changes**: none (no new env vars — inFakt's `baseUrl` is a per-connection
config field, not a build-time var).

**Database Migrations**: none.

**Events**: none emitted or consumed — this is synchronous CRUD + query/mutation hooks only.

**Error Handling**: reuses existing `ApiError` normalization (`useCreateConnectionMutation`,
`useUpdateConnectionCredentialsMutation`, `useIssueCorrectionMutation` all already surface
`.error` for the form/panel to render via `Alert`). No new error types.

---

## 7. Alternatives Considered

### Alternative 1: Wire `StructuredConfigSection` into the generic `CreateConnectionForm` (issue #1282's literal text)

- **Description**: Skip the guided setup route/page/form and rely on the generic
  `/connections/new` inline form (raw JSON config + credentials JSON) with inFakt's
  `StructuredConfigSection` swapped in.
- **Why Rejected**: Verified against the actual `CreateConnectionForm` + `PlatformPicker`
  source: every plugin with a `setupCard` unconditionally navigates to its own dedicated route
  via `setupCard.to` — there is no live code path where `StructuredConfigSection` renders
  inside the generic form for a plugin that also has a `setupCard`. Issue #1282's text
  described a shape that doesn't match any existing plugin's actual wiring. Following the
  guided-route pattern (Erli is the near-identical analog: one credential + optional advanced
  URL) is both correct and less work per-field than reproducing the generic form's raw-JSON UX.
- **Trade-offs**: none of substance — the guided-form approach is strictly better UX
  (dedicated instructional copy, inline "Test connection" affordance) and is what every
  comparable plugin already does.

### Alternative 2: Open a separate PR (and possibly a separate issue) for the host-panel redesign

- **Description**: File a standalone issue + PR for the `reg-card` redesign, keep the inFakt
  plugin PR narrowly scoped to #1282.
- **Why Rejected**: The redesign's only realistic motivation right now is "inFakt's new
  section should look like the approved mockup" — splitting it into a separate PR would mean
  either (a) inFakt ships with the *old* bare-section look first and gets restyled later
  (churn, two review passes on the same lines), or (b) the redesign PR has to land first and
  block inFakt for no benefit. Per the user's saved preference (single PR for plan +
  implementation; apply UI-redesign direction incrementally as related work touches each
  component — not as a big-bang), bundling the two is more consistent with how this specific
  redesign was scoped: as *inFakt's* section design, generalized to its two existing siblings
  as a drive-by improvement since they share one CSS class contract.
- **Trade-offs**: the PR diff is slightly larger (touches 2 existing provider sections instead
  of 0) and a reviewer sees an unrelated-looking CSS section in an "inFakt plugin" PR — mitigated
  by a clear PR description section explaining the redesign is additive/non-breaking and
  why it's bundled.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ No CORE/Integration/Infrastructure changes — pure `apps/web` work.
- ✅ Dependency direction respected: `plugins/infakt/*` imports only `features/invoicing`,
  `features/connections` (public barrels) and `shared/*`; the setup form itself lives in
  `features/connections/components/` per the established convention (pages deep-import it,
  which is a documented, accepted gap — see `docs/frontend-architecture.md` § Feature Public
  Surface, "Out of scope today").
- ✅ No plugin does `platformType === 'infakt'` string comparison anywhere outside
  `plugins/infakt/` — all cross-cutting logic stays capability/slot-driven.

### Naming Conventions

- ✅ Components: `kebab-case.tsx` files, `PascalCase` exports (`InfaktCredentialsPanel`, etc.)
- ✅ Hooks: none new.
- ✅ Route module: `infakt-setup.route.tsx`.
- ✅ Tests: `*.test.tsx` colocated.

### Existing Patterns

- ✅ Guided setup flow matches Erli precedent exactly.
- ✅ Credentials panel matches Erli precedent exactly.
- ✅ Structured section matches WooCommerce precedent exactly.
- ✅ Correction flow matches KSeF precedent exactly (mandated by the shared backend contract).

### Risks

- **Redesign regresses existing KSeF/Subiekt visual tests**: mitigated by making the class
  change additive (keep old class, add new) rather than a replace, and running the existing
  test suites for both sections before considering Phase 2 Step 6 done (see acceptance
  criteria in Step 6).
- **`baseUrl` sandbox-override semantics unclear to operators**: mitigated by the helper text
  specified in Phase 1 Step 5 (explicit "leave blank for production" copy), matching Erli's
  and Woo's existing helper-text conventions.
- **inFakt sandbox response shape for `clearanceReference` diverges from assumption**: low
  risk (assumption documented in §5, cheap to fix — one component, no contract change needed)
  since the neutral `InvoiceRecord` shape is already fixed regardless of provider.

### Edge Cases

- Connection with `credentialsBacked: false` (env-var-backed) → `InfaktCredentialsPanel` falls
  back to the disabled read-only input, matching Erli's tested behavior exactly.
- Multiple active inFakt connections → already handled by `OrderInvoicePanel`'s existing
  connection-picker logic (`selectInvoicingConnections`), no inFakt-specific change needed.
- `regulatoryStatus === 'cleared'` (never emitted today per §4) → `InfaktInvoiceDetailSection`
  should not crash if it ever appears; treat as a no-card/no-render fallback identical to
  `not-applicable` (safe default, matches the "FE never renders a cleared label" contract).

### Backward Compatibility

- ✅ No breaking changes — additive plugin registration, additive CSS classes, no changes to
  `InvoiceDetailSectionProps` / `InvoiceCorrectionFlowProps` / any exported type.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- `apps/web/src/features/connections/components/infakt-setup-form.test.tsx` — port
  `erli-setup-form`'s test suite shape if one exists (check during implementation; if Erli's
  form has no dedicated test file, write one covering: renders fields, submit calls
  `createConnection.mutateAsync` with the right payload, shows test-connection affordance
  after create).
- `apps/web/src/features/connections/components/infakt-setup.schema.test.ts` (if Erli's schema
  has one — port it) — validates `apiKey` required, `baseUrl` optional/https-only.
- `apps/web/src/plugins/infakt/components/infakt-credentials-panel.test.tsx` — port
  `erli-credentials-panel.test.tsx`'s 5 cases verbatim (renders rotate affordance, env-backed
  fallback, sends new apiKey + toast, disables save while empty, collapses after success).
- `apps/web/src/plugins/infakt/components/infakt-structured-section.test.tsx` — port
  `woocommerce-structured-section.test.tsx`'s applicable cases (renders field, propagates via
  `syncStructuredToJson`, disables when `!configIsParseable`, shows validation error).
- `apps/web/src/plugins/infakt/components/infakt-invoice-detail-section.test.tsx` — new: one
  case per `RegulatoryStatus` value (`not-applicable` → null, `submitted` → pending copy +
  progress bar, `accepted` → clearance reference chip, `rejected` → failure reason visible).
- `apps/web/src/plugins/infakt/components/infakt-invoice-correction-flow.test.tsx` — port
  `ksef-invoice-correction-flow.test.tsx`'s cases verbatim.
- `apps/web/src/plugins/index.test.ts` (existing suite, if present covering plugin count/ids) —
  update expected count / add `infakt` to any hardcoded id list.
- Redesign regression: re-run `ksef-invoice-detail-section.test.tsx` and
  `subiekt-invoice-detail-section.test.tsx` unmodified — must stay green after the additive
  class change.

### Integration Tests

- None needed — no backend/API changes; existing `apps/api` int-specs for
  `/connections`, `/invoices/*` already cover the generic endpoints this plugin calls.

### Mocking Strategy

- All tests use `createMockApiClient()` / `renderWithProviders()` from
  `apps/web/src/test/test-utils.tsx` per the existing convention — no real network calls, no
  new mocking infrastructure needed.

### Acceptance Criteria

- [ ] `pnpm --filter @openlinker/web lint` passes
- [ ] `pnpm --filter @openlinker/web type-check` passes
- [ ] `pnpm --filter @openlinker/web test` passes (all new + all existing invoicing/connections
  suites)
- [ ] `/connections/new` shows the inFakt card (title "inFakt", badge "API key", no icon)
- [ ] Selecting the inFakt card navigates to `/connections/new/infakt` and shows the guided form
- [ ] Empty API key on submit shows a validation error, no request sent
- [ ] Successful create shows the connection in the list with `infakt` platformType, offers
  "Test connection"
- [ ] Editing an existing inFakt connection shows the masked-key credentials panel + rotate,
  and the `baseUrl` structured field
- [ ] An inFakt invoice with `regulatoryStatus: 'submitted'` shows the info-tone reg-card with
  a progress indicator
- [ ] An inFakt invoice with `regulatoryStatus: 'accepted'` shows the success-tone reg-card
  with a copyable `clearanceReference`
- [ ] An inFakt invoice with `regulatoryStatus: 'rejected'` shows the error-tone reg-card with
  `failureReason` visible
- [ ] "Issue correction" opens the KOR modal with one empty line row + "Add line"; missing
  line number blocks submit; success closes the dialog + refetches the invoice
- [ ] KSeF and Subiekt invoice-detail-section existing tests remain green after the redesign

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — pure FE, no layer violations introduced)
- [x] Respects CORE vs Integration boundaries (no CORE/Integration touched)
- [x] Uses existing patterns (Erli setup flow, WooCommerce structured section, KSeF/Subiekt
  detail sections and correction flow — all ported, not invented)
- [x] Idempotency considered (correction submit reuses the existing idempotency-keyed mutation;
  no new mutating flow introduced)
- [ ] Event-driven patterns used where applicable — N/A, no events in this slice
- [ ] Rate limits & retries addressed — N/A, no new external calls (all via existing generic
  connection/invoice endpoints)
- [x] Error handling comprehensive (reuses existing `ApiError` + `Alert` patterns throughout)
- [x] Testing strategy complete (§9)
- [x] Naming conventions followed (§8)
- [x] File structure matches standards (§3, §6)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Frontend Architecture](../frontend-architecture.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Mockup artifact: https://claude.ai/code/artifact/2c542a0c-0719-4db1-b9d0-c962be23dadb
- Issue #1282 (FE plugin, correction-flow scope added 2026-07-01)
- PR #1292 (backend hardening), PR #1293 (backend registration + webhook, draft)
