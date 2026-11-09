# Implementation Plan: i18n extraction 16/18 - plugins KSeF and inFakt (#3883)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `plugins/ksef` and `plugins/infakt` into each plugin's
own namespace (`plugins/<id>/locales/en.json`, registered with `definePluginMessages`, ADR-081), replace the
legacy `t(key, fallback)` calls, and switch the no-literal-text lint on for both folders. English only - no
`pl.json` yet. Base: `3882-i18n-ai-mcp-mailer-posthog` @ 481ffe002.

**Non-goals.** Polish; server `error.message` (backend-msg rows wait for the error-code work); the backend
KSeF / inFakt packages.

## 2. Findings

- ~700 rows in 31 files (ksef ~540, infakt ~100). Two copy-ish modules: `ksef/lib/ksef-regulatory-status-labels.ts`,
  `ksef/lib/ksef-oswiadczenie.ts`.
- **First plugins to use `definePluginMessages`.** Nothing in `plugins/` registers a namespace yet. Pattern
  from `docs/frontend-architecture.md` § Internationalization: a `plugins/<id>/messages.ts` exporting
  `<id>Messages` + `use<Id>Messages`, referenced from the `messages` slot of `definePlugin`
  (`shared/plugins/plugin.types.ts:872`) so it registers at module load. Budgets: `plugins/<id>/locales/limits.json`
  as `"<key.path>": <max>`. `check-locales` already discovers plugin folders.
- **Legacy `t(key, fallback)`** in 7 files (ksef fa3 view, detail section, correction flow, issue options;
  infakt correction flow, structured section, detail section). As in #3879: the fallback is what renders, so
  each call becomes a typed read and the old key becomes the key path.
- `scripts/check-ksef-forma-platnosci-drift.mjs` reads the `TFormaPlatnosci` VALUE array in
  `ksef/components/ksef-setup.schema.ts` - the array stays where it is; only the zod messages move.
- **Watch-outs from the issue:**
  - the KSeF oświadczenie is legal text and stays Polish in every locale (its strings go in `en.json` as Polish,
    with a comment-free key group `oswiadczenie`; `pl.json` later copies them verbatim);
  - numbering descriptions show literal `{seq}`, `{FY}`, `{MM}` tokens: they must not be read as interpolation
    params - keep them out of `interpolate` (pass the token as a param value, e.g. `{token}`), so
    `check-locales` placeholder sets stay consistent;
  - provider tags like "inFakt · slot" look like leaked placeholder copy - rewrite for operators.
- Plugin display names (`displayName`, `setupCard`) in `index.ts` are module-level: they become keys read at
  render where the contract allows a function, otherwise stay English with a note (as #3868 did for crumbs).

## 3. Design

| Namespace | File | Holds |
|---|---|---|
| `ksef` | `plugins/ksef/locales/en.json` | setup form + page, structured section, credentials, invoice detail / correction / issue options, FA(3) view, numbering (editor, routing, series, audit, preview, actions, page), oświadczenie, regulatory status labels |
| `infakt` | `plugins/infakt/locales/en.json` | setup route, structured section, credentials, invoice detail / correction, webhook actions |

Sub-key per file (camelCase of the file name); helpers outside React read `ksefMessages.getMessages()` at call
time; zod via schema factories; plurals / numbers / dates via `usePlural` / `useFormat`. Lint scope +=
`plugins/ksef/**/*.tsx`, `plugins/infakt/**/*.tsx`.

## 4. Steps (light: 2 agents, no tsc, ESLint once each)

1. Me: `messages.ts` + empty `locales/en.json` for both plugins, wired into `definePlugin`; lint scope.
2. Agent A: `plugins/ksef` numbering (editor, routing card, series tab, audit tab, preview, actions, page,
   `ksef-numbering.lib.ts`, `ksef-numbering.schema.ts`, numbering route), oświadczenie (lib + document).
3. Agent B: rest of `plugins/ksef` (setup, structured, credentials, invoice detail / correction / issue options,
   FA(3) view, regulatory status labels, connection config, index, setup route) + all of `plugins/infakt`.
   Agents edit the plugin `en.json` directly (A and B never share a file: B owns `infakt` alone and the
   non-numbering `ksef` sub-keys; A writes numbering keys to a fragment that I merge).
4. Me: merge, `i18n:sort`, budgets, one ESLint, `check:invariants`, local commit.

## 5. Risks

- Both agents touch `plugins/ksef/locales/en.json`: A writes a fragment, I merge it, so no concurrent writes.
- Literal `{seq}`-style tokens would trip the placeholder checks if left inside a value; they are passed as
  param values instead.
