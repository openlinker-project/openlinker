# Implementation Plan: Polish translation, batch D - plugins (#3889)

## 1. Task understanding

A Polish value for every key of every plugin namespace (extraction issues #3883-#3885), so plugin setup,
credentials and invoice panels read in Polish. Base: `3888-i18n-pl-platform`.

| Plugin | Strings | Plugin | Strings |
|---|---|---|---|
| `ksef` | 541 | `prestashop` | 48 |
| `eparagony` | 221 | `shoper` | 41 |
| `infakt` | 183 | `woocommerce` | 19 |
| `subiekt-gt` | 73 | `dpd` | 15 |
| `subiekt-nexo` | 71 | `allegro` | 10 |
| `erli`, `inpost` | 56 each | `oms` | 1 |

About 1,335 strings.

## 2. Design

- `plugins/<id>/locales/pl.json` per plugin, same key tree as its `en.json`; budgets from the plugin's own
  `locales/limits.json` (`"<key.path>": <max>`). `check-locales` checks plugin Polish against English.
- Each plugin's `messages.ts` gains `loaders: { pl: () => import('./locales/pl.json').then((m) => m.default) }`,
  the pattern in docs/frontend-architecture.md, so Polish loads lazily like core.
- Copy already Polish stays as is: the KSeF oświadczenie (legal text) and its toolbar, eParagony vendor payment
  form words, inFakt webhook event labels, the InPost e-mail to InPost.
- Same rules as batches A-C; terms reused from the core Polish files.

## 3. Steps (2 agents, no tsc / tests)

1. Me: the 13 `pl` loaders.
2. Agent A: `ksef`, `infakt`. Agent B: the other 11.
3. Me: coverage, `check-locales`, `check:invariants`, `tsc -b`, local commit.

## 4. Still needed after this

A Polish speaker's on-screen review in `pl` and the overflow pass.
