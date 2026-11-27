# Implementation Plan: i18n extraction 17/18 - plugins Subiekt GT, Subiekt nexo and eParagony (#3884)

## 1. Task understanding

Move every operator-visible English string in `plugins/eparagony`, `plugins/subiekt-gt` and
`plugins/subiekt-nexo` into each plugin's own namespace (`plugins/<id>/locales/en.json`, registered with
`definePluginMessages`, the pattern #3883 introduced), replace the legacy `t(key, fallback)` calls, and switch
the no-literal-text lint on for the three folders. English only. Base: `3883-i18n-ksef-infakt` @ 7f5403f35.

Non-goals: Polish; server `error.message`; backend packages.

## 2. Findings

- ~270 rows in 22 files (eparagony ~107, subiekt-gt ~84, subiekt-nexo ~82).
- `t(key, fallback)` in 10 files (both Subiekt plugins, eParagony detail + correction flow). The fallback is
  what renders; the old key becomes the key path.
- **Subiekt GT and nexo are two products and must stay separate** (`subiekt-identity-is-split.test.ts`,
  `scripts/check-subiekt-identity-mirror.mjs`). The issue says nexo reuses GT's keys: they get the SAME key
  shape in two namespaces (`subiekt-gt`, `subiekt-nexo`), written once and copied, never one shared namespace
  - a shared namespace would join the two plugins, which the split forbids. Identity literals stay in code.
- `scripts/check-eparagony-config-mirror.mjs` parses constants, not copy: `TAX_RATE_STRICT_ENV_VAR` in
  `components/eparagony-tax-fallback-copy.ts`, `EPARAGONY_DEFAULT_PAYMENT_FORM` and the clamp bounds in
  `eparagony-config.types.ts`, value arrays in `eparagony-setup.schema.ts` / `eparagony-seller.ts`. Those stay
  where they are. The tax-fallback sentences move into the namespace; the file keeps only the env-var
  constant. Sentences that state a bound or the default payment form interpolate it from the constant, so
  the copy cannot drift from the guarded value.
- `eparagony-structured-section.tsx` has no `t()`: plain literals.

## 3. Design

| Namespace | File |
|---|---|
| `eparagony` | `plugins/eparagony/locales/en.json` |
| `subiekt-gt` | `plugins/subiekt-gt/locales/en.json` |
| `subiekt-nexo` | `plugins/subiekt-nexo/locales/en.json` (same key shape as GT) |

`messages.ts` per plugin (as #3883), wired into `definePlugin`; crumbs and setup-card text as getters;
`displayName` stays English (registry copies it at mount). Lint scope += the three plugin folders.

## 4. Steps (2 agents, no tsc, ESLint once each)

1. Me: three `messages.ts` + empty `en.json`, `definePlugin` wiring, lint scope.
2. Agent A: `plugins/eparagony`.
3. Agent B: `plugins/subiekt-gt` then `plugins/subiekt-nexo` (same key shape, product names per plugin).
4. Me: sort, budgets, one ESLint, `check:invariants`, local commit.
