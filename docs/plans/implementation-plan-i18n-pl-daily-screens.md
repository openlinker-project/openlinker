# Implementation Plan: Polish translation, batch A - daily screens (#3886)

## 1. Task understanding

**Goal.** Give every key of batch A's namespaces a Polish value, so an operator who picks Polish sees
Polish on the daily screens. Batch A = the extraction issues #3868-#3873:

| Namespace | Strings | Plurals | From |
|---|---|---|---|
| `app`, `format`, `ui` | 94 / 18 / 183 | 0 / 2 / 10 | #3868 (`format`, `ui` partly translated already) |
| `auth`, `demo`, `users` | 67 / 50 / 109 | 0 | #3869 |
| `orders` | 1,964 | 74 | #3870 |
| `listings` | 1,226 | 81 | #3871, #3872 |
| `products`, `customers`, `content`, `currency-settings`, `price-changes` | 370 / 69 / 61 / 41 / 165 | 22 / 0 / 1 / 2 / 10 | #3873 |

About 4,400 strings and 200 plurals (the issue's 3,199 predates the extraction, which split some sentences).

**Layer.** Frontend, data only: new `apps/web/src/locales/pl/<namespace>.json` files plus their entries in
`locales/pl/index.check.ts`. No component change. Base: `3885-i18n-marketplaces-shops-carriers` @ 2c95e9a09.

**Non-goals.** Batches B-D (#3887-#3889); making Polish the default (#3890); requiring Polish everywhere
(#3891); changing English copy, except where a budget forces a shorter Polish string (English untouched).

## 2. Findings

- Polish loads lazily: `shared/i18n/messages.ts` globs `locales/pl/*.json`, so a new file needs no wiring
  beyond `pl/index.check.ts`, which `tsc` uses to reject a Polish shape English lacks (a missing plural form,
  a string where English has a section). `check-locales` fails when a `pl` file is missing from that index.
- `scripts/check-locales.mjs` (the issue's `check-copy-locales.mjs`) checks every Polish file against
  English: no extra keys, same placeholders (`few` / `many` against `other`), budgets from `limits.json`
  in both languages, no em dash, sorted keys. It warns when Polish is over 1.6x the English length.
- A missing Polish key falls back to English for that key only, so a partial file is safe but the
  acceptance criterion is every key.
- `docs/i18n-glossary.md` sets the terms and the voice (imperative buttons, neutral messages, no
  "Pan/Pani", brand and tax names untranslated, `{n}` kept, plurals `one / few / many / other`).
- Existing `pl/format.json` and `pl/ui.json` are partly filled (`ui` lacks 6 keys).

## 3. Design

- One `pl/<namespace>.json` per batch A namespace, same key tree as English, written by the agents.
- Plurals: every English `{ one, other }` gets `{ one, few, many, other }` in Polish.
- Budgets: a Polish value over its `limits.json` budget is shortened (glossary short forms such as
  "realizacja", "korekta"), never answered by raising the budget without a reason.
- Copy addressed to Polish providers stays as written (Polish first).
- A small script I run at the end lists every English key with no Polish value, so "every key" is checked,
  not assumed.

## 4. Steps (2 agents, no tsc / tests, the sizes split evenly)

1. Agent A: `orders` (1,964) + `auth`, `demo`, `users`, `app`, `format`, `ui` (521) - about 2,500.
2. Agent B: `listings` (1,226) + `products`, `customers`, `content`, `currency-settings`, `price-changes`
   (706) - about 1,900.
   Each agent writes its own `pl/<ns>.json` files only; I own `pl/index.check.ts`.
3. Me: add the files to `pl/index.check.ts`, `i18n:sort`, the coverage script, `check-locales`,
   `check:invariants`, one spot-check read of each namespace against the glossary.
4. You commit locally (I give the folder and command).

## 5. What I cannot do here

- **Human review (acceptance criterion):** machine-drafted Polish is never merged without a Polish
  speaker's review - you, on screen in the `pl` locale.
- **Overflow screenshot pass in `pl`:** needs the app running on your stack; budgets catch the tight spots
  statically, the screenshot pass is for the rest.

## 6. Risks

- Volume: ~4,400 strings is the largest step so far; quality varies most in long operator explanations.
  The glossary and a per-namespace spot check limit drift.
- English keys may still change after CI and review on the extraction PRs; each such change then needs the
  same change in the Polish file (`check-locales` flags a key English no longer has).
