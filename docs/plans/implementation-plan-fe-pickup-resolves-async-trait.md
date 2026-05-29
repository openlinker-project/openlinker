# Implementation Plan — FE `pickupPointResolvesAsync` platform trait (#893)

## 1. Understand the task

**Goal.** Replace two `platformType === 'allegro'` literal compares in `features/orders/` with a
declarative `PlatformContribution` trait, so the orders feature stays platform-agnostic and any future
platform with async pickup-point semantics opts in by declaring the trait. Tighten the ESLint selector
that should have caught the optional-chained form.

**Classification.** Frontend (`apps/web`). No backend change, no migration.

**Explicit non-goals (from the issue).**
- The broader Modularity Thread H / FE plugin-contract redesign (#554) — this is a narrow doc-vs-code
  reconciliation on the *existing* `PlatformContribution` surface.
- Migrating other `platformType` literal compares — the widened ESLint rule surfaces them; address
  opportunistically (and the sweep below shows there are none left to migrate anyway).

## 2. Research findings

**The two call sites (both genuinely Allegro-specific async-pickup UX):**

1. `features/orders/components/generate-label-form.tsx:108-111` — AC-3 retry hint gated on
   `sourceConnection?.platformType === 'allegro'` (**optional-chained** — this is the form the current
   ESLint rule misses).
2. `features/orders/components/order-shipment-panel.tsx:191-194` — paczkomat-row caption
   (`buildShipmentFieldItems` helper) gated on a standalone `shippingPlatformType === 'allegro'`
   variable (the panel passes `shippingConnection?.platformType ?? null` down through
   `OrderShipmentPanelBody`).

**Existing trait surface** (`shared/plugins/plugin.types.ts:182`): `PlatformContribution` already holds
~11 optional slots (`setupCard`, `supportsListingEdit`, `extractContentPublishErrors`, …). Adding one
more optional boolean is the established extension shape. `usePlatform(platformType)` (`shared/plugins/
use-platform.ts`) returns the flattened `Platform = { platformType } & PlatformContribution` or
`undefined` for unknown platforms.

**Allegro plugin** (`plugins/allegro/index.ts:40`): `platform.displayName === 'Allegro'`. So a generalized
caption `(buyer-selected via ${displayName})` renders byte-identical to today's `(buyer-selected via Allegro)`.

**Tests** (`renderWithProviders` defaults `plugins = inTreePlugins`, the real registry — so `usePlatform`
resolves the real Allegro/PrestaShop plugins in tests):
- `order-shipment-panel.test.tsx` — asserts `operator-selected` for an **InPost** shipping connection
  (no FE plugin → `usePlatform` undefined → falsy ✓) and `buyer-selected via Allegro` for Allegro ✓.
- `generate-label-form.test.tsx` — Allegro-source ⇒ hint shown ✓; **PrestaShop-source ⇒ no hint**
  (line 220, the AC's required negative test **already exists**); old Allegro order outside window ⇒
  no hint ✓.

**ESLint sweep** (`platformType [=!]== <literal>` under `apps/web/src` excl. `plugins/` and tests):
the only optional-chained member-access-vs-literal compare is `generate-label-form.tsx:110` — which this
migration deletes. The other matches compare against **identifiers/sentinels** (`MASTER_CHANNEL_SENTINEL`,
a `platformType` variable), not string literals, so the widened `[…type='Literal']`-guarded selector
won't newly fire on them. `allegro-seller-panel-url.ts:29` is a standalone-variable compare the rule
intentionally exempts.

## 3. Design

**New trait slot** (`shared/plugins/plugin.types.ts`, on `PlatformContribution`):

```ts
/**
 * `true` when the platform's order pickup-point payload resolves asynchronously
 * after the order is received (the buyer selects the locker on the platform, but
 * it arrives on a later poll). Drives the OrderShipmentPanel paczkomat caption
 * and the GenerateLabelForm pickup-point retry hint. Omit for platforms whose
 * pickup-point arrives synchronously with the order payload.
 */
pickupPointResolvesAsync?: boolean;
```

Allegro plugin sets `pickupPointResolvesAsync: true`. PrestaShop/others omit it (falsy).

**Migration — generate-label-form.tsx:** the component already calls `useConnectionsQuery` and computes
`sourceConnection`. Add `const sourcePlatform = usePlatform(sourceConnection?.platformType);` and gate on
`sourcePlatform?.pickupPointResolvesAsync === true`. (Hook call is unconditional, top-level of the
component — safe.)

**Migration — order-shipment-panel.tsx:** call `usePlatform` inside `OrderShipmentPanelBody` (a component
rendered unconditionally in the active-shipment branch — no early returns before it, so the hook is
safe). Pass the resolved `Platform | undefined` into `buildShipmentFieldItems`, which derives:
```ts
const caption = shippingPlatform?.pickupPointResolvesAsync
  ? `(buyer-selected via ${shippingPlatform.displayName})`
  : '(operator-selected)';
```
`buildShipmentFieldItems` stays a pure function (takes `Platform | undefined`, no hook). The parent keeps
passing `shippingConnection?.platformType ?? null` to Body; Body resolves it. Caption is byte-identical
for Allegro (`displayName: 'Allegro'`).

**ESLint widening** (`.eslintrc.js`, the `no-restricted-syntax` block ~503-518): keep the two existing
general selectors and **add two optional-chain branches**, preserving generality (any Literal, `===`/`!==`,
either side) rather than the issue's narrower `right.value='allegro'`/`===`-only proposal:
```
BinaryExpression[operator=/^(===|!==)$/][left.expression.property.name='platformType'][right.type='Literal']
BinaryExpression[operator=/^(===|!==)$/][right.expression.property.name='platformType'][left.type='Literal']
```
(`left.expression` reaches through the `ChainExpression` wrapper that optional chaining produces.)

## 4. Step-by-step implementation

1. **`shared/plugins/plugin.types.ts`** — add `pickupPointResolvesAsync?: boolean` + JSDoc to
   `PlatformContribution`. AC: slot added with JSDoc.
2. **`plugins/allegro/index.ts`** — set `pickupPointResolvesAsync: true` in the `platform` bag.
   AC: Allegro sets the trait.
3. **`features/orders/components/generate-label-form.tsx`** — import `usePlatform`; replace the
   `sourceConnection?.platformType === 'allegro'` gate with the trait lookup. AC: site migrated.
4. **`features/orders/components/order-shipment-panel.tsx`** — `usePlatform` in `OrderShipmentPanelBody`;
   change `buildShipmentFieldItems` to take `Platform | undefined`; caption uses the trait + `displayName`.
   AC: site migrated.
5. **`.eslintrc.js`** — add the two optional-chain selector branches. AC: selector tightened.
6. **Tests** — the AC's PS-negative test already exists (`generate-label-form.test.tsx:220`) and the panel
   has the InPost `operator-selected` negative. Verify both green unchanged; add an explicit
   `pickupPointResolvesAsync` assertion only if coverage is thin (decide during impl — likely no new test
   needed beyond confirming existing ones pin the trait behaviour).
7. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test` (run `pnpm build` first so workspace
   `dist` artifacts exist — the dist-resolution gotcha hit last session, tracked by #869).

## 5. Validation

- **Architecture / dependency direction**: `features → shared` (`usePlatform` from `shared/plugins`) — legal;
  `plugins/allegro` declaring the trait — legal. No `shared → features` edge introduced. ✅
- **Naming/state**: no new files; trait is an optional boolean on an existing interface. ✅
- **Behaviour preserved**: Allegro caption + hint identical (`displayName: 'Allegro'`); InPost/PS fall to
  the generic/no-hint path exactly as today. ✅
- **Lint regression risk**: swept — the widened selector fires only on the deleted line; no pre-existing
  literal-vs-`platformType` member compares remain. ✅
- **Security**: none (pure FE display logic). ✅

## Resolved after tech-review

- **Doc-table update (IMPORTANT):** added a `pickupPointResolvesAsync` row to the `PlatformContribution`
  slot-reference table in `docs/frontend-architecture.md` — the doc enumerates every slot and #893
  anchors on it, so a new slot must be listed.
- **ESLint selector:** kept general (any Literal, `===`/`!==`, both sides) + added the two optional-chain
  branches (`{left,right}.expression.property.name`). Verified disjoint from the existing branches.
- **Tests:** no new test required (AC's PS-negative + the InPost panel negative already exist); added
  intent comments documenting that both now pin the trait path, not the literal compare.

## Open question (minor)

- The issue's proposed ESLint selector hardcodes `right.value='allegro'` and only `===`. I'm keeping the
  rule **general** (any literal, both operators, both sides) and only adding optional-chain reach — a
  strict improvement over the issue text. Flagging in case the issue author specifically wanted the
  narrower form (I don't think so — the existing rule is general and #893 is about closing the
  optional-chain gap, not narrowing scope).
