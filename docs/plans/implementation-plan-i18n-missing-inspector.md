# Implementation plan - Dev inspector for English fallbacks (#4017)

## 1. Task

In a development build, with `VITE_I18N_HIGHLIGHT_MISSING=true` and a non-English
language active, mark on the real screen every text that fell back to English, and
list every fallback key read on the current screen - including ones that never
reach the DOM.

- **Layer**: Frontend, `shared/i18n` (DX tooling). No backend, no API, no migration.
- **Non-goals**: hardcoded text (the pseudo-language's job); API data; production
  builds; English or `?lang=xx` ever being marked.

## 2. What exists

- `shared/i18n/merge.ts` `mergeOverEnglish(source, override)` - the only place a
  translation falls back to English. Called from `messages.ts` `loadMessages`.
- `messages.ts`: a namespace with **no** loader for a language is never merged; its
  English tree is returned as is from `namespaceFor`. In Polish that is a fallback too.
- Plural objects are `{ one, other }` in English; Polish adds `few` / `many`.
  `selectPluralForm` falls back to `other` when a form is missing.
- `main.tsx` calls `loadMessages(initialLocale)` before the first render.
- Status tokens `--status-warning*` exist for light and dark.

## 3. Design

### 3.1 Instrumentation seam (production code, tiny)

`merge.ts` gains an optional third argument:

```ts
export interface FallbackTagger {
  /** Called for a string that fell back; returns the string to store. */
  tag(fallback: { path: readonly string[]; english: string; kind: FallbackKind }): string;
}
export type FallbackKind = 'missing' | 'empty' | 'plural-form';
mergeOverEnglish(source, override, options?: { tagger: FallbackTagger; locale: SupportedLocale; namespace: string })
```

- `missing` = no translated string, `empty` = `''`.
- `plural-form`: for an English plural object (exactly `one` + `other`), every
  plural category the target locale needs (`Intl.PluralRules(...).resolvedOptions().pluralCategories`)
  that the translation lacks gets a tagged copy of the merged `other`, so the marker
  appears exactly when that form is rendered.
- Without options the function is byte-identical in behaviour to today.

`messages.ts` gains `installMessagesInstrumentation({ tagger, wrap })`:
- clears the non-base cache so the next `loadMessages` re-merges with tags;
- in `loadMessages`, when instrumented, also builds a tagged tree for a namespace
  with no loader for the language (every key a fallback);
- stores `wrap(merged)` so reads can be recorded (3.3).

No inspector logic lives in these files; they only accept a callback.

### 3.2 Markers (`missing-inspector/markers.ts`)

Zero-width encoding around the fallback string:
`OPEN = U+2063 U+2062 <id in base 4 over U+200B U+200C U+200D U+2060> U+2064`,
`CLOSE = U+2063 U+2061`. Pure functions: `encode(id, text)`, `decodeAll(text)`
(stack-based, nested markers keep their own id), `strip(text)`, `hasMarker(text)`.
Placeholders and `<tags>` are untouched, so `interpolate`, `formatPlural` and
`renderRich` keep working. The registry maps id -> `{ namespace, keyPath, english, kind }`.

### 3.3 Read tracking (`missing-inspector/read-tracker.ts`)

`wrap(tree)` returns a lazily-created `Proxy` per object (WeakMap cache, identity
stable for hook deps). A `get` returning a string with markers records each id as
"read on this screen". This covers document title, confirm dialogs, file names,
canvas charts and gone toasts.

### 3.4 Scanner (`missing-inspector/scan.ts`) - pure over a DOM root

Walks text nodes in document order with one marker stack (a sentence split by
`renderRich` spans nodes) and returns findings:
- `text` ranges (start node/offset, end node/offset, id);
- attribute findings for `placeholder`, `title`, `aria-label`, `aria-description`,
  `alt`, `value` (buttons and inputs, read from the property), `option` (text of an
  `<option>` reported on its `<select>`).
Skips the inspector's own UI (`[data-i18n-inspector]`) and `<script>/<style>`.

### 3.5 Painter + panel (`missing-inspector/overlay.ts`, `panel.ts`)

- Text: `CSS.highlights.set('i18n-missing', new Highlight(...ranges))` with
  `::highlight(i18n-missing) { text-decoration: wavy underline var(--status-warning) }`.
  Without the API, or inside SVG, absolutely positioned boxes from
  `Range.getClientRects()` in an overlay layer.
- Placeholder: `data-i18n-missing~="placeholder"` + `::placeholder` wavy underline.
- Attributes: `data-i18n-missing` dashed warning outline + a corner badge in the
  overlay layer naming the attributes.
- Tooltip on hover/focus: namespace, key path, English, kind.
- Panel (vanilla DOM, dev-only English, outside React): "Missing in Polish: N on this
  screen", grouped by namespace; per row key path, English, where used or "read but
  not on screen"; click scrolls and flashes; "Copy list"; reset on route change,
  "Keep across routes" toggle.
- `MutationObserver` on `document` (subtree, characterData, attributes) batched per
  animation frame; also re-paints on scroll/resize for overlay boxes.
- `copy` listener strips markers; `navigator.clipboard.writeText` is wrapped to strip.

- Styles are injected by the inspector module itself (a `<style data-i18n-inspector>`),
  not added to `index.css`, so a production stylesheet carries none of them. They use
  the existing `--status-warning*` / surface / font tokens, so light and dark both work.

### 3.6 Turning it on

- `VITE_I18N_HIGHLIGHT_MISSING` in `shared/config/env.ts` (boolean, default false).
- `main.tsx`: `if (import.meta.env.DEV && env.VITE_I18N_HIGHLIGHT_MISSING) await import('./shared/i18n/missing-inspector').then(m => m.installMissingInspector())`
  before `loadMessages`. The inspector marks only when the active locale is not the
  base (English) and pseudo is off; it reads `getLocale()` / `data-pseudo-locale`.
- Production: `import.meta.env.DEV` is a literal `false`, so Vite drops the branch and
  emits no chunk.

### 3.7 Build guard

`apps/web/scripts/check-i18n-inspector-not-in-build.mjs`: runs `vite build` with the
variable set into a temp dir and fails if the sentinel string
(`__OL_I18N_MISSING_INSPECTOR__`, exported from the inspector entry) appears in the
output. Wired as a step in the CI `test-web` job.

## 4. Steps

| # | File | Done when |
|---|---|---|
| 1 | `shared/i18n/merge.ts` (+ test) | tags each kind only with options; untouched without |
| 2 | `shared/i18n/messages.ts` (+ test) | instrumentation reloads, tags loader-less namespaces, wraps |
| 3 | `missing-inspector/markers.ts`, `registry.ts` (+ tests) | round trip, nesting, survives interpolate / plural / renderRich |
| 4 | `missing-inspector/read-tracker.ts` (+ test) | reads recorded, identity stable |
| 5 | `missing-inspector/scan.ts` (+ test) | text across nodes, placeholder, each attribute, option |
| 6 | `missing-inspector/overlay.ts`, `panel.ts`, `index.ts` | paints, tooltip, panel, clipboard strip |
| 7 | `shared/config/env.ts`, `main.tsx`, `.env.example` | off by default, on only in dev + non-English |
| 8 | `apps/web/scripts/check-i18n-inspector-not-in-build.mjs`, `ci.yml` | fails when the sentinel is in the bundle |
| 9 | `docs/frontend-architecture.md` § Internationalization | documented |

## 5. Risks

- A marked string used in logic (equality, `encodeURIComponent`, sorting) behaves
  differently while the inspector is on. Dev-only, opt-in, documented.
- Proxies over copy trees: anything that freezes or structured-clones copy would break;
  none found. Only installed when the inspector is on.
- Text truncated mid-string can leave an unclosed marker; the scanner closes it at the
  end of the node instead of corrupting later ranges.
