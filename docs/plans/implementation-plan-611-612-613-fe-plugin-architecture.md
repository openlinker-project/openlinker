# Implementation Plan — Thread H FE plugin architecture seams (#611, #612, #613)

**Parent epic**: #554 (Modularity Thread H — FE plugin architecture) under #546.
**Scope**: three independent seams that together unblock third-party FE plugin authors. None depend on each other; bundled for review coherence.
**Out of scope**: actual string migration for i18n; bidirectional token-drift coverage; rename of `resolveSuggestChannel` (it's structurally fine — the closed `PromptTemplateChannelValues` union is the real problem, tracked under #580).

---

## 1. Task understanding

### #612 — i18n seam (HIGH)
Ship `LocaleProvider` + `t(key, fallback)` + `useLocale()` + `useNumberFormat()`. The `t()` returns the fallback today (no-op). Replace the single hardcoded `new Intl.NumberFormat('en-US')` in `app-shell.tsx:174` with the new hook so the seam is visibly wired. **Do not** migrate any other strings — that's a future-PR concern (a "Migrate strings under feature X to t()" issue per feature).

### #611 — design-token contract (MEDIUM)
Two outputs: (a) a typed `tokens` object in `shared/theme/tokens.ts` listing every design token with its `var(--name)` reference, and (b) a `shared/ui/index.ts` barrel listing the public component catalog. Plus a drift-check script wired into `pnpm lint` via `check:invariants`. **Token scope**: ship **all ~150 tokens** in v1 — one-time tedious paste, then drift keeps it honest. Asymmetric friction: a plugin author hitting a missing token either falls back to the literal `var(--foo)` (defeating the contract) or eats a follow-up PR review cycle. **UI catalog scope**: ~25 high-leverage primitives v1; the catalog grows as plugins consume more. **Consumption model**: `tokens.ts` is the TS-side discovery / typed-inline-style contract for plugin authors. Existing component CSS continues to write `var(--name)` directly against `index.css` — the catalog doesn't replace that path.

### #613 — platform-neutral content errors (LOW)
Rename `extract-allegro-errors.ts` → `extract-platform-errors.ts` with a registry keyed by `platformType`. Move the Allegro extractor logic to `plugins/allegro/`. Register it through the existing `PlatformPlugin` slot pattern (extend the interface). Update the two callers.

### Layer classification
All work is **frontend** inside `apps/web/`. Touches `app/providers/`, `shared/i18n/` (new), `shared/theme/`, `shared/ui/`, `shared/plugins/`, `features/content/lib/`, `plugins/allegro/`, plus one `scripts/` invariant.

### Non-goals
- Migrating existing English strings to `t()` — that's a per-feature follow-up.
- Adding a real translation backend (no i18next, no message catalog files, no JSON loading).
- Storybook (issue mentions it as optional; deferred).
- Bidirectional token drift (orphan CSS vars not in `tokens.ts` are tolerated v1).
- Renaming `resolveSuggestChannel` — out of scope per #613 reading.

---

## 2. Research findings (anchors only — full report in tech-review research)

- **Provider stack** at `apps/web/src/app/providers/app-providers.tsx:1-51` — `ThemeProvider → PluginRegistryProvider → SessionProvider → ToastProvider → ApiClientProvider → QueryClientProvider`. `LocaleProvider` slots between Theme and PluginRegistry.
- **Existing context convention**: `shared/theme/` pattern — `*-provider.tsx` + `use-*.ts` + `*.types.ts` + `index.ts` barrel.
- **Hardcoded locale**: `apps/web/src/app/app-shell.tsx:174` — `const COUNT_FORMATTER = new Intl.NumberFormat('en-US');` used by sidebar nav counts.
- **No existing i18n libraries**: zero hits for `i18next`, `react-i18next`, `formatjs`, `lingui` across `apps/web/src/`.
- **CSS tokens**: `apps/web/src/index.css` has 150 `--name:` declarations split across `:root` (light) lines 187–293 and `html[data-theme='dark']` line 340+.
- **Invariant scripts**: `scripts/check-fixture-purity.sh`, `scripts/check-migration-timestamps.mjs`, `scripts/check-render-template-fixture-drift.mjs` — all chained into `check:invariants` (root `package.json:18`), which runs in `lint` (line 17).
- **PlatformPlugin contract**: `apps/web/src/shared/plugins/plugin.types.ts` — already has optional slot pattern (`StructuredConfigSection`, `ExtraConfigSection`, `CredentialsPanel`, etc.). Extend with `extractErrors?: (err: unknown) => StructuredError[] | null`.
- **Allegro extractor**: `features/content/lib/extract-allegro-errors.ts` (41 LOC) — single function `extractAllegroErrors(err)` returning `StructuredError[] | null`. Two callers: `content-editor.tsx:179` (uses it), plus the test file.

---

## 3. Design

### 3a. #612 — i18n seam

**New module**: `apps/web/src/shared/i18n/`
- `i18n.types.ts`
  ```ts
  export const LocaleCodeValues = ['en'] as const;
  export type LocaleCode = (typeof LocaleCodeValues)[number] | string;
  // ↑ open for plugin contributions; engineering-standards calls for `as const`
  //   but the seam must accept locales not yet in the closed set.

  export interface TranslationCatalog { readonly [key: string]: string; }

  export interface LocaleContextValue {
    readonly locale: LocaleCode;
    readonly t: (key: string, fallback: string) => string;
  }
  ```
- `locale-provider.tsx` — Context + Provider component. Today the catalog is empty; `t()` always returns `fallback`. Future: catalog comes from a per-locale JSON load. No exposed `setLocale` in v1 — there's no UI for switching, and YAGNI says don't ship surface that has no consumer yet (the PR that adds a switcher introduces `useLocale` + persistence + `setLocale` together).
- `use-translation.ts` — `useTranslation()` returns `{ t, locale }`. Throws if used outside provider.
- `use-number-format.ts` — `useNumberFormat(options?)` returns `Intl.NumberFormat` for current locale. Maps `'en'` → BCP 47 `'en-US'` via a tiny `localeToBcp47()` helper.
- `index.ts` — barrel.
- `locale-provider.test.tsx` — covers default locale, fallback behaviour of `t()`, catalog-hit behaviour, error on hook-outside-provider, `useNumberFormat` produces a valid `Intl.NumberFormat`.

**Modifications**:
- `apps/web/src/app/providers/app-providers.tsx` — insert `<LocaleProvider>` between `<ThemeProvider>` and `<PluginRegistryProvider>`.
- `apps/web/src/app/app-shell.tsx:174` — replace `const COUNT_FORMATTER = new Intl.NumberFormat('en-US');` with `const COUNT_FORMATTER = useNumberFormat();` (move inside component body — was at module scope; refactor.) Verify the consumer at lines 176–179 still works.

**Doc update**:
- `docs/frontend-architecture.md` — new § "Internationalization (i18n)" before § Components and Pages. Documents the seam, links to it as the migration target for future per-feature i18n work, and explicitly flags that **no strings are migrated in this PR**.

### 3b. #611 — design-token contract

**New module**: `apps/web/src/shared/theme/tokens.ts`
- Typed object covering **all ~150 tokens** declared in `:root` of `apps/web/src/index.css` (light theme; dark mode overrides the same names so the catalog is theme-independent). Generated initially via a one-time grep+sed, then hand-grouped by category: fonts/typography, spacing, radii, shadows, backgrounds, borders, text, accent, status (success / warning / error / info / review / conflict / disabled — each with `base` / `strong` / `soft` / `border` where applicable).
- Shape:
  ```ts
  export const tokens = {
    'bg-canvas': 'var(--bg-canvas)',
    'bg-shell': 'var(--bg-shell)',
    // ...all 150
  } as const satisfies Record<string, `var(--${string})`>;

  export type TokenName = keyof typeof tokens;
  ```
- **Consumption model**: TS-side discovery, typed inline styles, plugin-author contract. Component CSS continues to reference `var(--name)` directly in `.css` files — `tokens.ts` doesn't replace that path and isn't loaded by the runtime CSS engine.

**New module**: `apps/web/src/shared/ui/index.ts`
- Barrel exporting the public primitives by category, in the same order as the style guide. Excludes test files, internal helpers, and types that aren't part of the public surface.
- v1 target: ~25 primitives — `Alert`, `Button`, `Combobox`, `DataTable`, `Dialog`, `DropdownMenu`, `EmptyState`, `ErrorState`, `FormErrorSummary`, `FormField`, `Input`, `KeyValueList`, `LoadingState`, `MetricCard`, `PageHeader`, `PageLayout`, `Popover`, `RawPayloadPanel`, `Select`, `SetupStepper`, `StatusBadge`, `Tabs`, `Textarea`, `ThemeToggle`, `Timeline`, `Tooltip`. Plus the toast hook.

**New script**: `scripts/check-design-tokens.mjs`
- Reads `apps/web/src/shared/theme/tokens.ts` (regex-extract token names from the const object).
- Reads `apps/web/src/index.css`, collects every `--*:` declaration name.
- Asserts every name in `tokens.ts` exists at least once in `index.css`. Fails with a clear message listing the orphaned token names.
- v1 is **one-directional** (tokens → CSS). A second sweep (CSS → tokens, with a small opt-out list for internal-only vars) is a follow-up.
- Style matches `scripts/check-migration-timestamps.mjs` — pure `.mjs`, no ts-node, exits non-zero.

**Modifications**:
- `apps/web/src/shared/theme/index.ts` — re-export `tokens` and `TokenName`.
- Root `package.json` — wire `node scripts/check-design-tokens.mjs` into the `check:invariants` script (chained after the existing checks).

**Doc update**:
- `docs/frontend-architecture.md` — new § "Design tokens (`shared/theme/tokens.ts`)" inside the existing Components and Pages area. Documents the typed token contract, the drift-check guarantee, how plugin authors consume `import { tokens } from '@openlinker/web/shared/theme'` (or via the relative-import path).
- `docs/frontend-architecture.md` — new § "Shared UI catalog (`shared/ui/index.ts`)" with the same audience framing.

### 3c. #613 — platform-error registry

**Hoist `StructuredError` to shared**: new file `apps/web/src/shared/types/structured-error.types.ts`.
- Reason: the type now has two consumers — the platform-plugin slot signature in `shared/plugins/plugin.types.ts` and the Content feature's helper in `features/content/lib/`. Per `docs/frontend-architecture.md § Dependency Rules`, the cleaner long-term move is `shared/types/`; this PR is the "second consumer" the docs flag as the trigger for hoisting. Avoids stretching the narrow `shared/plugins/` type-import exemption.

**Slot extension**: `apps/web/src/shared/plugins/plugin.types.ts`
- Add to `PlatformPlugin` interface (importing `StructuredError` from the new `shared/types/`):
  ```ts
  /**
   * Optional platform-specific error extractor for the Content feature.
   * Given a thrown error from a publish mutation, return a list of
   * `StructuredError` for inline rendering, or `null` if the error
   * shape isn't one this plugin recognizes (caller falls back to
   * generic display).
   */
  extractContentPublishErrors?: (err: unknown) => StructuredError[] | null;
  ```

**File rename + refactor**:
- `apps/web/src/features/content/lib/extract-allegro-errors.ts` → `extract-platform-errors.ts`. New shape:
  ```ts
  export function extractPlatformErrors(
    err: unknown,
    platform: PlatformPlugin | undefined,
  ): StructuredError[] | null {
    if (!platform?.extractContentPublishErrors) return null;
    return platform.extractContentPublishErrors(err);
  }
  ```
  - Kept as a named helper (not inlined at the call site) so the Content feature has a stable, testable seam — and because the file rename itself is half the intent of #613 (removing "Allegro" from the Content feature's surface).
- `apps/web/src/features/content/lib/extract-allegro-errors.test.ts` → `extract-platform-errors.test.ts`. Rewritten to cover the registry-dispatch behaviour. Keep coverage of the Allegro-specific extraction in a separate test file under `plugins/allegro/`.

**Move Allegro extractor**:
- New file `apps/web/src/plugins/allegro/extract-content-publish-errors.ts` carrying the existing logic (currently inside `extract-allegro-errors.ts`).
- New colocated test `apps/web/src/plugins/allegro/extract-content-publish-errors.test.ts` (port the existing 17 test cases as-is; only the import path changes).
- Register on `allegroPlatformPlugin` in `apps/web/src/plugins/allegro/allegro.plugin.tsx` (or wherever the platform plugin is declared per the research).

**Callers updated**:
- `apps/web/src/features/content/components/content-editor.tsx:179` — replace `extractAllegroErrors(publishMutation.error)` with `extractPlatformErrors(publishMutation.error, usePlugin(connection.platformType))`. The `usePlugin` lookup is per the existing pattern documented in `docs/frontend-architecture.md`.
- No other callers (research confirmed only `content-editor.tsx` + the test).

---

## 4. Step-by-step plan (file by file)

### Sub-PR / Commit 1 — #612 i18n seam

Commit subject: `feat(web): i18n seam — LocaleProvider + useTranslation + useNumberFormat (#612)`

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `apps/web/src/shared/i18n/i18n.types.ts` | create | Types + `LocaleCodeValues` const present. Exports compile. |
| 2 | `apps/web/src/shared/i18n/locale-provider.tsx` | create | Provider mounts; default locale `'en'`; `t()` returns fallback when catalog empty. |
| 3 | `apps/web/src/shared/i18n/use-translation.ts` | create | Hook returns `{ t, locale }`. Throws when no provider. |
| 4 | `apps/web/src/shared/i18n/use-number-format.ts` | create | Hook returns memoized `Intl.NumberFormat` for current locale; `'en'` maps to BCP 47 `'en-US'`. |
| 5 | `apps/web/src/shared/i18n/index.ts` | create | Barrel; exports the three hooks + provider + types. |
| 6 | `apps/web/src/shared/i18n/locale-provider.test.tsx` | create | Tests: default locale, `t` fallback, `t` with catalog hit, hook-outside-provider error, `useNumberFormat` returns `Intl.NumberFormat`. |
| 7 | `apps/web/src/app/providers/app-providers.tsx` | modify | `<LocaleProvider>` slotted between `<ThemeProvider>` and `<PluginRegistryProvider>`. App boots. |
| 8 | `apps/web/src/app/app-shell.tsx` | modify | `COUNT_FORMATTER` replaced by `useNumberFormat()` call inside component. Existing sidebar count formatting unchanged. |
| 9 | `docs/frontend-architecture.md` | modify | New § "Internationalization (i18n)" added. Clearly states "no string migration in this PR". |

**Acceptance for commit**: `pnpm --filter @openlinker/web type-check && pnpm --filter @openlinker/web test` green; new `locale-provider.test.tsx` passes.

### Sub-PR / Commit 2 — #611 design-token contract

Commit subject: `feat(web): typed design-token catalog + shared/ui barrel + drift check (#611)`

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `apps/web/src/shared/theme/tokens.ts` | create | All ~150 typed token entries. `TokenName` type derived. |
| 2 | `apps/web/src/shared/theme/tokens.test.ts` | create | Tests: every entry's value matches `var(--name)`, `TokenName` is a non-empty union. |
| 3 | `apps/web/src/shared/theme/index.ts` | modify | Re-export `tokens`, `TokenName`. |
| 4 | `apps/web/src/shared/ui/index.ts` | create | Barrel of ~25 public primitives. |
| 5 | `scripts/check-design-tokens.mjs` | create | One-directional drift check; tokens.ts → index.css. Reports orphaned tokens with names. |
| 6 | Root `package.json` | modify | `check:invariants` chains `node scripts/check-design-tokens.mjs`. |
| 7 | `docs/frontend-architecture.md` | modify | New § "Design tokens" + § "Shared UI catalog". |

**Acceptance for commit**: `pnpm lint` green (including the new drift check); `pnpm test` green.

### Sub-PR / Commit 3 — #613 platform-error registry

Commit subject: `refactor(web): platform-neutral content-publish error registry (#613)`

| # | File | Action | Acceptance |
|---|---|---|---|
| 1 | `apps/web/src/shared/types/structured-error.types.ts` | create | Hoists `StructuredError` out of `features/content/lib/`. |
| 2 | `apps/web/src/shared/plugins/plugin.types.ts` | modify | Imports `StructuredError` from `shared/types/`; adds `extractContentPublishErrors?` slot. |
| 3 | `apps/web/src/plugins/allegro/extract-content-publish-errors.ts` | create | Carries the logic from the old `extract-allegro-errors.ts`. |
| 4 | `apps/web/src/plugins/allegro/extract-content-publish-errors.test.ts` | create | Ports the 17 existing tests. |
| 5 | `apps/web/src/plugins/allegro/allegro.plugin.tsx` | modify | Registers `extractContentPublishErrors: extractAllegroContentPublishErrors` on the plugin object. |
| 6 | `apps/web/src/features/content/lib/extract-platform-errors.ts` | create | Registry-dispatch helper. |
| 7 | `apps/web/src/features/content/lib/extract-platform-errors.test.ts` | create | Tests: no-platform → null; platform-without-slot → null; platform-with-slot → delegated. |
| 8 | `apps/web/src/features/content/lib/extract-allegro-errors.ts` | delete | Old file. |
| 9 | `apps/web/src/features/content/lib/extract-allegro-errors.test.ts` | delete | Old test. |
| 10 | `apps/web/src/features/content/components/content-editor.tsx` | modify | Replace `extractAllegroErrors(...)` with `extractPlatformErrors(..., usePlugin(connection.platformType))`. |

**Acceptance for commit**: `pnpm --filter @openlinker/web type-check && pnpm --filter @openlinker/web test` green; existing Content publish-error UI behaviour unchanged on Allegro path; deleted file does not appear in any grep.

---

## 5. Validation checklist

- **Architecture compliance**:
  - `shared/i18n/` — no imports from `features/` or `pages/`. ✓
  - `shared/theme/tokens.ts` — no imports. ✓
  - `shared/ui/index.ts` — re-exports only from `shared/ui/`. ✓
  - `shared/types/structured-error.types.ts` — no imports. ✓
  - `shared/plugins/plugin.types.ts` — imports `StructuredError` from `shared/types/`. ✓ (clean — no need to extend the existing narrow `Connection`/`EditConnectionFormValues` exemption).
  - `features/content/lib/extract-platform-errors.ts` — imports `PlatformPlugin` + `StructuredError` from `shared/`. ✓
  - `plugins/allegro/` — imports `StructuredError` from `shared/types/`. ✓
- **Naming**: kebab-case files; PascalCase named exports; `*.types.ts` / `*-provider.tsx` / `use-*.ts` / `*.test.ts(x)`.
- **File headers**: every new `.ts` / `.tsx` file ships a JSDoc header per `docs/engineering-standards.md § File Headers` — purpose + context + `@module` tag.
- **Strict TypeScript**: no `any`. The `t(key, fallback): string` signature is fully typed. Registry dispatch uses the optional-method idiom (no casts).
- **Tests**: each new module has colocated `*.test.ts(x)`. The Allegro extractor tests are ported verbatim — line-for-line behaviour preserved.
- **Security**: zero impact — no auth, no API, no secrets.

---

## 6. Risks

1. **Token catalog incompleteness** — v1 ships ~80 of 150 tokens; some plugins may need ones we didn't include. *Mitigation*: drift script makes it trivial to add — single-file edit + lint passes.
2. **`StructuredError` type placement** — currently inside `extract-allegro-errors.ts`. Moving it to `shared/plugins/` (for the slot signature) might create a dependency edge from `shared` to a type that morally belongs to the Content feature. *Mitigation*: keep `StructuredError` in `features/content/lib/structured-error.types.ts` and re-import in `shared/plugins/plugin.types.ts` via a typed-only `import type`. ESLint dependency-direction rule for FE permits type-only imports if the rule is so configured; if not, we hoist `StructuredError` to `shared/types/` (cleaner long-term anyway, mirrors the `Connection` / `EditConnectionFormValues` exemption documented in `frontend-architecture.md` § Dependency Rules).
3. **`useNumberFormat` performance** — replacing module-scope `COUNT_FORMATTER` with a per-render hook adds a `useMemo`. *Mitigation*: confirmed cheap; only invoked in app-shell.
4. **Bundle size** — three new modules adding ~300 LOC of TS plus the catalog. No external deps. Net impact: negligible (~3-5 KB minified).

---

## 7. Bundling decision

**Single PR, three commits.** Each issue closes via `Closes #N` in the PR body. Three commits keep git history clean for cherry-pick / revert. If review feedback singles out one slice, we can split at push time before opening the PR — easy with three commits already separated.

---

## 8. Out of scope / follow-ups

- Per-feature string migration to `t()` — file follow-up issues per feature module after this lands.
- Bidirectional token-drift coverage (CSS-only vars → tokens.ts with opt-out list).
- Storybook for `shared/ui/` (the catalog is a precursor).
- Rename `resolveSuggestChannel` — out of scope per #613 reading; the closed `PromptTemplateChannelValues` union is tracked under #580.
- Persistence of `setLocale` choice — needs design (localStorage? session? user pref API?). Today it's runtime-only.
- Plugin-author guide cross-references — wait for #562 / #563 to land, then weave these seams into the guide.
