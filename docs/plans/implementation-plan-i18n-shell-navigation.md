# Implementation Plan: i18n extraction 1/18 - shell, navigation, breadcrumbs, shared core (#3868)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `apps/web/src/app/**` and in the
non-`ui` parts of `apps/web/src/shared/**` into `locales/en.json`, read it through
`useMessages` / `getMessages`, and switch the no-literal-text lint rule on for those folders.
English only; Polish lands in batch A (#3886).

**Layer.** Frontend only (`apps/web`). No backend, no migration, no plugin copy.

**Governing decision.** ADR-081 and `docs/frontend-architecture.md § Internationalization`.
The issue body was written before ADR-081 settled and says `useCopy` / `*.copy.ts` /
`{ en, pl }`; the ADR wins: one `en.json`, namespace per folder, `useMessages`.

**Non-goals.**
- Polish text (`pl.json` stays without the new keys; per-key English fallback covers it) - #3886.
- Plugin crumb titles and plugin nav labels (`plugins/*/…-setup.route.tsx` "Connect Allegro" …) - #3883-#3885.
- Raw backend enums shown in the command palette (`platformType`, order status, job type,
  job status). They need feature-owned label maps (connections, orders, jobs), not shell copy.
- `backend-msg` rows in `shared/api/api-error.ts` (server text passthrough) - error-code track #3860-#3867.
- Developer-only thrown errors (`must be used inside <Provider>` ×6, dev-ui crumb) stay English.
- The `Alerts (0 new)` topbar stub: copy is extracted, the hard-coded `0` is not turned into a plural.

## 2. Findings from the live repo (origin/main @ 9e35aec9d)

| Inventory item | State on main | Action |
|---|---|---|
| `shared/format/*` (amount, date, duration, relative, ship-by) | already on `format` namespace / `Intl` (#3857) | none |
| `shared/lib/iso-3166-1-countries.ts` | names served via `formatCountryName` + `Intl.DisplayNames` (#3857) | none |
| `shared/format/format-tax-rate.ts` `{code}%` | `%` suffix, same in PL | none (note in PR) |
| `shared/hooks/use-paginated-total.ts` `—` placeholder | a glyph, not copy | none |
| `shared/lib/oldest-age-suffix.ts` ` · oldest {n} d/h` | literal | extract → `format.oldestAge` |
| `shared/config/demo-mode.ts` 2 tooltips | module constants, ~155 call sites | extract, turn into functions |
| `shared/api/api-error.ts` 3 fallbacks | literal | extract → `ui.apiError` |
| `app/nav-registry.ts` 28 labels | module constants (`BASE_NAV_GROUPS`) | keys resolved at render |
| `app/routes/*.route.tsx` crumbs (40 files) | `{ group: 'Operations', title: 'Orders' }` | group key + title resolver |
| `app/app-shell.tsx`, layouts, palette | literal JSX / props / toast | extract → `app` namespace |

New since the inventory: nav item **Stock movements** (`/inventory/movements`) and its route crumb.

Contract constraints:
- `NavContribution.groupLabel` (plugin contract) matches a base group **by its label string**.
  No in-tree plugin contributes nav items today, but the contract must keep working.
- Ten plugin routes set `crumb: { group: 'Platform', title: 'Connect …' }`.
- `LocaleKeyed` remounts the routed tree on a switch, but module-level constants are evaluated
  once, so any label held in a module constant must be resolved at render time.

## 3. Design

### Namespaces

| Namespace | New sections | Holds |
|---|---|---|
| `app` (new) | `brand`, `shell`, `userMenu`, `topbar`, `drawer`, `loading`, `nav.groups`, `nav.items`, `crumbs`, `palette` | everything under `app/` |
| `ui` (existing) | `demo`, `apiError` | shared tooltips + `ApiError` fallbacks (read from shared code, no feature owns them) |
| `format` (existing) | `oldestAge` | the oldest-age chip suffix |

`app` follows the "namespace = folder" rule (`apps/web/src/app`). The docs line "The shell (`app/`)
has no namespace yet" is updated.

### Localised text type (nav + crumbs)

`apps/web/src/app/nav-registry.types.ts`:

```ts
/** A literal (plugin, not extracted yet) or a resolver read at render time. */
export type LocalizedText = string | (() => string);
export function resolveText(text: LocalizedText): string;
```

- `LiveNavItem.label`, `LiveNavGroup.label`, `PlannedNavItem.label`, `RestrictedNavGroup.reason`,
  `RouteCrumbHandle.crumb.title` become `LocalizedText`.
- Base data uses resolvers: `label: () => nav().items.orders` where `nav = () => getMessages('app').nav`.
  `getMessages` reads the active language, so the shell's render after a switch sees the new text.
- `LiveNavGroup` gains `id: NavGroupId` (`'operations' | 'diagnostics' | 'platform' | 'ai' | 'administration'`)
  for base groups. `mergePluginNavContributions` matches a contribution when
  `groupLabel === group.id` **or** `groupLabel` equals the group's **English** label
  (`messagesIn('app', 'en')`), so an existing plugin passing `'Operations'` still lands in the group
  in either language.
- `RouteCrumbHandle.crumb.group` becomes `NavGroupId` (a key, not text). The ten plugin routes change
  `'Platform'` → `'platform'`; their titles stay literal strings (plugin issues own them).
  `isCrumbHandle` accepts `title` as string or function. `DEFAULT_CRUMB` → `{ group: null, title: '' }`,
  shell renders the brand name when `group` is null.
- One place resolves everything: `AppShell` (sidebar, breadcrumb) and `command-palette-provider.tsx`
  call `resolveText` / `copy.nav.groups[id]` during render.

### Demo-mode messages

`DEMO_READ_ONLY_ACTION_MESSAGE` / `NAV_DEMO_RESTRICTED_MESSAGE` (module strings) become
`demoReadOnlyActionMessage()` / `navDemoRestrictedMessage()` reading `getMessages('ui').demo`.
Mechanical rename across the ~155 call sites (all use it at render). Tests asserting the text keep
passing (English pinned).

### ApiError fallbacks

`ApiError.fromResponse` / `fromNetworkError` / timeout read `getMessages('ui').apiError` at
construction (outside React). The timeout message drops the raw API path from operator copy
("The request timed out.") - the path stays in `details.path`. Product rule: no technical strings.

## 4. Steps

Paths relative to `apps/web/src/`.

1. **`locales/en.json`** - add `app` namespace (sorted), `ui.demo`, `ui.apiError`, `format.oldestAge`
   (`oldestDays` / `oldestHours` as `{n}` templates). British spelling ("Fulfilment"), no em dash.
   Repeated texts share one key (Sign out ×2, Loading/Checking session ×2, brand ×4; crumb titles that
   equal nav items read `nav.items.*`).
   *AC:* `pnpm i18n:sort` clean, `check-locales` passes.
2. **`locales/limits.json`** - budgets for `app:nav.items.*`, `app:nav.groups.*`, `app:userMenu.signOut`,
   `app:topbar.alerts` (sidebar width; ~24 for items, ~16 for groups).
3. **`app/nav-registry.types.ts`** - `LocalizedText`, `resolveText`, `NavGroupId`, `id` on base groups,
   widened `isCrumbHandle`. Unit test for `resolveText` + guard.
4. **`app/nav-registry.ts`** - labels → resolvers, `id` on groups, restricted reason →
   `navDemoRestrictedMessage`. `sessionNeedsOmsRouting` unaffected.
5. **`plugins/merge-nav-contributions.ts`** - match by `id` or English label; tests for both.
6. **`app/breadcrumbs.ts`** - `DEFAULT_CRUMB` group `null`; resolver returns raw handle, resolution in shell.
   Update `breadcrumbs.test.ts`.
7. **`app/routes/*.route.tsx`** (40 files) - `group: '<id>'`, `title: () => crumbs().<key>`; crumbs equal to a
   nav item reuse `nav.items.*`. `dev-ui` crumb stays literal (dev-only, `eslint-disable` with reason).
8. **`plugins/*/…-setup.route.tsx`** (10) - `group: 'platform'` only.
9. **`app/app-shell.tsx`** - `useMessages('app')`; JSX text, aria props, toast; render nav/crumb labels via
   `resolveText`; brand stays "OpenLinker" (key with the brand value, not translated).
10. **`app/command-palette-provider.tsx`** - group headings from `app.palette.groups`; nav entries via
    `resolveText`. Raw enum descriptions untouched (non-goal, listed in PR).
11. **`app/layouts/{authenticated-app-layout,consent-layout,guest-layout}.tsx`** - `app.loading.*`, `app.brand.*`.
12. **`shared/config/demo-mode.ts`** + rename call sites (scripted, then type-check).
13. **`shared/api/api-error.ts`** - fallbacks from `ui.apiError`; update `api-error` test if it asserts text.
14. **`shared/lib/oldest-age-suffix.ts`** - take `locale` param like the formatters, read `format.oldestAge`;
    callers (`order-list-filter-bar.tsx`, `invoices-list-page.tsx`) pass the active locale. Test.
15. **Lint scope** - `.eslintrc.js` i18next override `files` += `apps/web/src/app/**/*.tsx`,
    `apps/web/src/shared/!(ui)/**/*.tsx`; `scripts/check-i18n-lint-rule.mjs` `EXPECTED_SCOPE` updated in
    the same change. (Rule is JSX-text only, so `.ts` files are covered by review, as the docs state.)
16. **Docs** - `docs/frontend-architecture.md § Copy files`: replace "The shell (`app/`) has no namespace
    yet" with the `app` namespace and the `LocalizedText` rule for module-level data.
17. **Quality gate** - `pnpm lint`, `pnpm type-check`, `pnpm check:invariants` (incl. `check-locales`,
    `check-ui-vocabulary`, `check-i18n-lint-rule`). Unit tests run on CI (team practice).
18. **Manual check** - `pnpm start:dev:web`, `?lang=xx`: sidebar, breadcrumb, user menu, palette and
    loading screens fully pseudo-localised; switching language updates nav without reload.

## 5. Validation

- **Architecture:** `app → shared` only; `shared` gains no `app`/`features` import (`ui.demo` lives in `ui`).
- **Contracts:** plugin `NavContribution` and `RouteCrumbHandle` stay source-compatible for string labels;
  only the crumb `group` value changes (all in-tree callers updated).
- **Tests:** English pinned, so text assertions keep passing; new tests for `resolveText`, the crumb guard,
  merge-by-id/English, `oldestAgeSuffix` in `pl`.
- **Risks:** (a) the ~155-site demo rename - mechanical, caught by `tsc`; (b) a stale label captured in a
  `useMemo` in the shell - deps include the locale; (c) `getMessages` called at module load would freeze
  English - every resolver is a function, never evaluated at import.

## 6. Open questions

1. Namespace name `app` (folder rule) vs `shell` (inventory's proposed prefix). Plan uses `app`.
2. Timeout copy without the API path - acceptable to drop the path from the operator message?
