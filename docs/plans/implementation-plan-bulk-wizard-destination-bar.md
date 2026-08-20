# Implementation plan — Bulk wizard destination context bar (#2227)

## 1. Understand the task

**Goal.** The bulk offer-creation wizard asks for the destination connection on step 1 and then never
shows it again. Steps 2-4 render identically for Allegro production, Allegro sandbox, Erli and a
WooCommerce shop, so a client screenshot of step 3 cannot be diagnosed, and the batch settings
committed on step 1 (currency, price rule, stock rule, publish mode, AI description, platform
params) are invisible from step 2 onward.

Render a destination context bar from step 2 onward that carries the connection identity + the
environment always, and the full step-1 config behind a disclosure.

**Layer.** Frontend only (`apps/web`). No CORE, no integration, no interface-layer change, no
migration. Every value the bar shows is already in `BulkWizard`'s own state (`activeConnection`,
`config`, `platforms`).

**Design source.** Issue #2227 plus the interactive mockup linked there. The governing rule from the
mockup review: *only what an operator would act on stays visible; everything else is one click
away.* A dense strip of settings reads as noise and gets ignored, which defeats the purpose.

**Non-goals.**
- No change to `BulkWizardConfig`, the submit payload, or any BE contract.
- No redesign of the step bodies, the Review table, or the Edit modal.
- No change to the single-product publish flows outside the bulk wizard.
- No new shared primitive, no new design token.
- **Sticky-on-scroll is deferred** — see §5 *Deliberate deferrals*.
- **Batch progress page is already done** — `bulk-batch-progress-page.tsx:139` already renders
  `connectionName` in its description, so nothing to add there.

## 2. Research — what already exists

| Need | Existing thing | Notes |
|---|---|---|
| Connection identity disc | `ConnectionDot` (`features/orders`, exported from that barrel) | Props `name`, `platformType`, `variant`. Fixed 14 px. Cross-feature import must go through the barrel (`.eslintrc.js` bans `**/orders/components/**`); precedent: `features/shipments/hooks/use-notify-dispatched-mutation.ts:16`. |
| Badges | `StatusBadge` | Label is `children`, tones `error/info/neutral/review/success/warning`, `withDot`. |
| Settings panel | `KeyValueList` | `KeyValueItem { id, label: ReactNode, value: ReactNode, mono? }`. |
| Confirm dialog | `ConfirmDialog` | `open` / `onOpenChange` / `title` / `description` / `confirmLabel` / `cancelLabel` / `tone` / `onConfirm`. Escape + focus trap handled by the Radix `Dialog` underneath. Exact precedent: `connection-mappings-page.tsx:709` ("Discard unsaved changes?"). |
| Tooltip | `Tooltip` / `TooltipTrigger asChild` / `TooltipContent` | Already used inside this folder (`bulk-confirm-modal.tsx:105`). |
| Destination kind | `publishDestinationKind(connection)` | `'marketplace' \| 'shop' \| null`. Already computed in the wizard as `isShop`. |
| Platform label | `resolvePlatformLabel(platforms, connection)` | Wizard already holds `platforms` and calls this at line 527. |
| Environment | nothing | `Connection.config` is `Record<string, unknown>`; `config.environment` is untyped. Established read pattern is a local narrowing guard (`readInfaktEnvironment` / `readInpostEnvironment` in `EditConnectionForm.tsx`, `sync-job-detail-page.tsx:174`). |
| Chip styling | `.context-chip` (`index.css:1612`) via `EnvironmentBadge` | That badge is the **app** environment (`VITE_APP_ENV`), not a connection's. Not reusable as logic; reusable as a styling precedent. |

**Two findings that shape the design:**

1. `InlineDisclosure` is a native uncontrolled `<details>` with a fixed `label / value / "Change →"`
   summary. The bar needs a *controlled* disclosure (open state must survive the wizard re-rendering
   its body on every step change) and a different summary. Modifying a shared primitive is out of
   scope, so the bar uses a plain `<button aria-expanded aria-controls>` + panel. **`InlineDisclosure`
   drops off the reuse list** stated in the issue.
2. A connection-scoped environment chip does not exist anywhere in `apps/web`. This is the first one.

## 3. Design

New component, one file, no state of its own:

```
apps/web/src/features/listings/components/bulk/
  bulk-destination-bar.tsx        # presentational; open state is a prop
  bulk-config-summary.ts          # pure: BulkWizardConfig -> summary rows + changed-from-default list
  bulk-config-summary.test.ts
  bulk-destination-bar.test.tsx
```

`BulkDestinationBar` props:

```ts
interface BulkDestinationBarProps {
  connection: Connection;               // resolved by the wizard (activeConnection)
  config: BulkWizardConfig | null;      // null before commit; bar then shows identity only
  settingsOpen: boolean;                // owned by the wizard, survives step changes
  onToggleSettings: () => void;
  onChangeDestination: () => void;      // wizard opens the ConfirmDialog
}
```

**Always visible:** `ConnectionDot` + `connection.name`, environment `StatusBadge`
(`Sandbox` warning / `Production` success / omitted when `config.environment` is absent — never
guessed), a health `StatusBadge` only when `connection.status !== 'active'`, one changed-settings
chip, and the `Show settings` / `Hide settings` toggle.

**Changed-settings chip** — from `bulk-config-summary.ts`:

```ts
export interface BulkConfigChange { label: string; value: string }
export function collectBulkConfigChanges(config: BulkWizardConfig): BulkConfigChange[]
export function buildBulkConfigRows(config, connection, platformLabel): KeyValueItem[]
```

A change is anything off the defaults: `pricingPolicy.mode !== 'use-master'`,
`stockPolicy.mode !== 'use-master'`, `publishImmediately === false`, `generateDescription === true`.
Zero changes → **no chip at all**. One change → that change (`markup +12%`). More → `N settings
changed`, with the list in a `Tooltip`.

**Behind the disclosure:** `KeyValueList` with listing currency, price rule, stock rule, on-create
(with the AI-description state under it), platform label + slug + shortened connection id
(`shortenId`), and every `config.platformParams` entry as its own row. Plus the `Change destination`
button — it is the one action that throws work away, so it does not sit next to a disclosure toggle.

**Wizard wiring** (`bulk-wizard.tsx`, inside the existing `<div className="bulk-wizard">`, directly
above `.bulk-wizard__stepper`):

```tsx
{step !== 'config' && activeConnection && (
  <BulkDestinationBar … />
)}
```

Two new pieces of wizard state: `settingsOpen` and `changeDestOpen`. `onChangeDestination` opens a
`ConfirmDialog` (`tone="danger"`, title `Change destination?`, description naming the connection and
what is discarded, `confirmLabel="Change destination"`, `cancelLabel="Keep this batch"`); confirming
calls `setStep('config')`.

**Browser tab title.** No `document.title` pattern exists anywhere in `apps/web` (zero runtime hits).
Rather than introduce a shared hook, the wizard sets it in one local `useEffect` and restores the
previous value on unmount. Scoped to this file; if a second surface needs it, that is when a shared
hook earns its place.

**CSS.** One block in `apps/web/src/index.css` next to the existing `/* ── Bulk listing wizard ── */`
section, classes `.bulk-destbar`, `__id`, `__name`, `__badges`, `__actions`, `__panel`, following the
`.bulk-wizard__*` naming already there and using only existing tokens. `.bulk-destbar__name` needs
`display: block; max-width: 26ch; text-overflow: ellipsis` (an inline span ignores `text-overflow`,
which is what made the 320 px layout blow up in the mockup). Badges wrap; the left accent edge is
`--accent-primary`, re-tinted to `--status-warning-strong` on `[data-environment='sandbox']`.

## 4. Steps

1. **`bulk-config-summary.ts`** — pure module: `readConnectionEnvironment(config)` narrowing guard,
   `collectBulkConfigChanges`, `describePricingPolicy`, `describeStockPolicy`, `buildBulkConfigRows`.
   No React import. AC: every branch of `PricingPolicy` / `StockPolicy` renders a human string; an
   unknown `platformParams` value type is stringified, never `[object Object]`.
2. **`bulk-config-summary.test.ts`** — table-driven over the policy unions + the changes list
   (all-defaults ⇒ `[]`, one change ⇒ one entry, three changes ⇒ three).
3. **`bulk-destination-bar.tsx`** — presentational component per §3. AC: no `useState`, no data
   fetching, no `any`, file header comment per engineering standards.
4. **CSS block** in `index.css`. AC: tokens only; holds at 320 px; no new token.
5. **Wire into `bulk-wizard.tsx`** — render above the stepper for every non-Config step (marketplace
   and shop paths alike), add `settingsOpen` + `changeDestOpen` state, the `ConfirmDialog`, and the
   `document.title` effect. AC: Config step renders no bar; confirming the dialog lands on Config.
6. **`bulk-destination-bar.test.tsx`** — marketplace vs shop, sandbox vs production, absent
   `config.environment` (no badge), `status: 'needs_reauth'` (health badge), all-defaults (no chip),
   one change (named), three changes (`3 settings changed`), disclosure toggle calls the callback,
   `Change destination` calls its callback.
7. **Quality gate** — `pnpm lint`, `pnpm type-check`, and the `apps/web` vitest suite.

## 5. Validation

- **Architecture.** Frontend-only; `features → shared` respected; the one cross-feature import
  (`ConnectionDot`) goes through the `features/orders` barrel, which `.eslintrc.js` allows.
- **Capability-driven.** Destination kind comes from `publishDestinationKind`, platform naming from
  the plugin registry via `resolvePlatformLabel`. No `platformType` literal anywhere in the bar.
- **Naming.** `PascalCase.tsx` component, `*.test.tsx` test, pure helpers in a `*.ts` sibling.
- **Types.** `config.environment` narrowed by a guard, never cast. No `any`.
- **Security.** The panel shows a shortened connection id via the existing `shortenId`; no
  credentials, no `config` blob dump — only the known keys plus `platformParams`.

**Deliberate deferrals** (stated rather than silently dropped):

- **Sticky-on-scroll.** `.demo-banner` is itself `position: sticky; top: 52px` in the same scroll
  container, and there is no layout token for "topbar + banner height". A sticky bar at `top: 52px`
  would sit under the banner in demo mode. Doing it correctly needs a shared offset token, which is a
  layout change beyond this issue. The bar sits directly under the page title, which is where a
  screenshot of a wizard step is normally framed. Follow-up if it turns out to matter.

**Open question for the user:** `ConnectionDot` is a fixed 14 px disc. The mockup drew a 26 px disc,
which reads better as an identity anchor. Reuse the 14 px component as-is (no shared-component
change), or give it an optional `size` prop? Plan assumes reuse as-is.
