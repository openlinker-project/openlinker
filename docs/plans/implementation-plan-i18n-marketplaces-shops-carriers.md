# Implementation Plan: i18n extraction 18/18 - plugins for marketplaces, shops, carriers and the OMS (#3885)

## 1. Task understanding

Move every operator-visible English string in the `inpost`, `erli`, `prestashop`, `woocommerce`, `dpd`,
`allegro` and `oms` plugins into each plugin's own namespace (`plugins/<id>/locales/en.json`, registered with
`definePluginMessages`, the #3883 pattern), and switch the no-literal-text lint on for those folders. English
only. Base: `3884-i18n-subiekt-eparagony` @ 7669cb596.

Non-goals: Polish; server `error.message`; backend adapters.

## 2. Findings

- ~260 rows in 28 files; one legacy `t()` user (`inpost-structured-section.tsx`).
- **Gap found:** `plugins/shoper` (~490 lines, setup route, credentials, structured section) is in no
  extraction issue - it landed after the inventory. It moves here too, as namespace `shoper`, so the whole
  `plugins/` tree is covered.
- Namespace names: core already has `allegro-core` and `oms-core` (named so they would not clash with these
  plugin namespaces), so the plugins take the plain `allegro` and `oms`.
- Issue notes:
  - credential and webhook copy repeats across plugins; a plugin cannot read another plugin's namespace and
    core copy may not name a platform, so each plugin keeps its own keys with identical wording (one key per
    sentence inside a plugin);
  - the InPost webhook e-mail template is bilingual (Polish first) - it is a message to InPost, so its text
    stays as written, in Polish and English, under one sub-key and is never translated;
  - route crumbs keep `group: 'platform'` (the nav key) and read their title through a getter.
- `allegro.mocks.ts` is test data, not UI.

## 3. Design

One namespace per plugin, `messages.ts` per plugin wired into `definePlugin`, crumbs and setup-card text as
getters, `displayName` stays English (the registry copies it once at mount). Lint scope += the eight plugin
folders.

## 4. Steps (2 agents, no tsc, ESLint once each)

1. Me: eight `messages.ts` + empty `en.json`, `definePlugin` wiring, lint scope.
2. Agent A: `inpost`, `dpd`, `prestashop`, `woocommerce`.
3. Agent B: `erli`, `allegro`, `oms`, `shoper`.
4. Me: sort, one ESLint, `check:invariants`.
