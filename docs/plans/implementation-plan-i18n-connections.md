# Implementation Plan: i18n extraction 10/18 + 11/18 - connections (#3877, #3878)

## 1. Task understanding

**Goal.** Move every operator-visible English string of the connections area into core namespaces of
`apps/web/src/locales/en.json`, delete the copy modules, and switch the no-literal-text lint on.
English only; Polish lands with batch C.

- **#3877**: connections list, detail, edit, panels and sections, mappings pages, adapters catalogue,
  Allegro connect callback and the core `features/allegro` setup form.
- **#3878**: the eight guided setup forms (PrestaShop, inFakt, eParagony, DPD, InPost, Subiekt,
  WooCommerce, Erli), their pages and `edit-connection.schema.ts`.

Both write the `connections` namespace, so they share ONE branch (`3877-3878-i18n-connections`) with one
commit per issue (#3877 first).

**Layer.** Frontend. Base: `3876-i18n-shipments-inventory-automations` (committed), because
connections consumes `features/inventory` exports #3876 rewrote.

**Non-goals.** Polish text; server `error.message` (error-code track); `plugins/*` (#3883-#3885).

## 2. Findings

- Area: `features/connections` 83 files (~12,800 lines), `features/allegro` 11, `features/adapters` 5,
  `pages/connections` 16, `pages/adapters`, `pages/integrations` (~16,300 lines in total).
- Copy module: `features/connections/lib/fulfilment-ownership.copy.ts`; the rest is inline.
- **Namespace clash**: `allegro` is a plugin id -> core `features/allegro` copy goes to **`allegro-core`**
  (same answer as `oms-core` in #3875). `adapters` is free.
- **Scripts**:
  - `check-core-capability-mirror.mjs` reads the KEYS of `CAPABILITY_HELP` in `capability-metadata.ts`.
    The help text moves to `connections.capabilityHelp`; the script reads its keys from `en.json` (set).
  - `check-subiekt-identity-mirror.mjs` reads identity constants in `subiekt-setup.schema.ts` - these are
    values, not copy; they stay. Only validation messages move (schema factory).
  - backlog-status, location-page-size, stock-and-pricing-preview and system-connection-id mirrors read
    values / logic only - untouched.
- `Intl.NumberFormat('en-GB')` in `connection-sync-status-panel.tsx` -> `useFormat`.
- Raw status codes in `StatusBadge` -> label map with raw fallback.
- Developer wording ("file an issue", env var names) rewritten for operators.
- Polish inFakt UI labels quoted in copy stay verbatim (they name buttons in inFakt's own Polish UI).
- Eight wizards share "Integrations" / "Guided setup" -> one shared key each.

## 3. Design

| Namespace | Holds |
|---|---|
| `connections` | everything in features/connections and pages/connections (sub-key per file; shared wizard labels under `connections.setup`) |
| `allegro-core` | features/allegro (setup form, summary, schema, error translation) and the connect callback page |
| `adapters` | features/adapters + pages/adapters |

Helpers outside React read copy when called; zod schemas become factories; plurals via `usePlural`;
numbers / dates via `useFormat`. Lint scope += features/connections, features/allegro, features/adapters,
pages/connections, pages/adapters, pages/integrations.

## 4. Steps (light on the machine: at most 2 agents, no tsc, ESLint once each)

1. Agent A (#3877, part 1): `features/connections` components and lib EXCEPT the setup forms / schemas
   listed in #3878.
2. Agent B (#3877, part 2): `pages/connections` (non-setup pages), `features/allegro`, `features/adapters`,
   `pages/adapters`, `pages/integrations`.
3. Me: integration of #3877 (capability mirror, limits, ESLint, invariants) -> commit message #3877.
4. Agent C (#3878): the eight setup forms, their schemas, `edit-connection.schema.ts`, the setup pages.
5. Me: integration of #3878 -> commit message #3878.

## 5. Risks

- Shared wizard labels: #3878 reads `connections.setup.*`; #3877 must not create a conflicting shape there.
- `allegro-core` / `oms-core` naming departs from "namespace = feature folder"; it is the registry's
  one-name-one-home rule winning.
