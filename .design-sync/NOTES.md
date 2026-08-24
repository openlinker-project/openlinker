# design-sync notes — OpenLinker → claude.ai/design

Repo-specific gotchas for future syncs. Read this before re-running.
Project: **OpenLinker UI** (`9811a593-63ff-4c9d-95bc-e80fe2651c8d`).

## Setup this repo needs (not the converter's defaults)

- **Node 22 is mandatory.** The system default here is Node 25, whose built-in
  `localStorage` shadows happy-dom and breaks `apps/web` tests. Always
  `export PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"` first.
- **There is no library build, so a `.d.ts` tree must be generated.** `apps/web` is
  an application (`"private": true`, no `main`/`module`/`exports`), so the first
  build reported `[ZERO_MATCH] no component exports`. Fix, re-run on a fresh clone:

  ```sh
  cd apps/web
  npx tsc -p tsconfig.app.json --emitDeclarationOnly --declaration --noEmit false --outDir ./types
  printf "export * from './types/shared/ui';\n" > index.d.ts
  ```

  `findTypesRoot` probes `types/` under the package root, and the entry is
  `<pkgDir>/index.d.ts` — both artifacts are gitignored and regenerated.
  **Issue #2299 removes the need for this** by extracting `@openlinker/ui` as a
  real package; when it lands, drop this step and repoint `pkg`/`--entry`.
- **Entry is the curated catalog barrel**, not a dist file:
  `--entry ./apps/web/src/shared/ui/index.ts`. That barrel (#611) is the repo's own
  declared public surface, so it is the correct scope by construction.
- **Fonts need a CSS entry, not bare `.woff2` paths.** Listing the 14 woff2 files in
  `extraFonts` copied them but emitted no `@font-face`, so `[FONT_DANGLING]` persisted
  and every design would have rendered in fallback while looking fine. Fix:
  `.design-sync/fonts.css` (committed) holds the real rules with urls repointed at
  `../apps/web/public/fonts/…`, and `extraFonts` points at that one file.
- **`cfg.provider` must be `MemoryRouter`.** Six catalog components use router hooks
  (`back-link`, `data-table`, `entity-label`, `kpi-card`, `metric-card`, `theme-toggle`);
  without it they render blank with
  `useNavigate() may be used only in the context of a <Router>`.
  `react-router-dom` is in `extraEntries` so the name exists on the bundle global.

## Preview authoring — house rules learned the hard way

- **Every export must be a component FUNCTION**, never a JSX element. The harness
  collects `typeof === 'function'` + uppercase name, then mounts via `createElement`.
  `export const X = (<div/>)` yields "preview module evaluated to no exports".
- **Check `index.css` before sweeping a prop.** `.status-badge--solid` paints one dark
  chip and has ZERO tone-specific rules, so a `solid × tones` sweep rendered three
  identical chips and implied tone mattered. Cards are imitated by the design agent, so
  a misleading card teaches the wrong API. Batch D correctly verified
  `.kpi-card--{success,warning,error}` and `.metric-card--{…,info}` before sweeping.
- **Curate from `/dev/ui`** (`apps/web/src/pages/dev-ui/sections/{brandbook,primitives,patterns}-section.tsx`)
  — the repo's own live design system, with real operator copy and real fixtures. It is
  also the visual regression reference for any CSS change.
- Emitted `.d.ts` files **under-report** inherited native props (Input/Textarea/Select)
  and do not expand referenced interfaces (`KeyValueList.items` is typed
  `KeyValueItem[]` with the member shape unexported). Verify against
  `apps/web/src/shared/ui/<name>.tsx`. This is a consequence of the missing library
  build — more evidence for #2299.
- `Combobox` takes `ariaLabel`, not `aria-label`. Avoid `React.CSSProperties`
  annotations in previews. Use `defaultValue`, not `value`, for uncontrolled inputs.
- `Textarea rows={6}` is not honoured in the harness (content clips).

## Component-specific facts

- `EmptyState`, `ErrorState` and `LoadingState` all live in ONE file,
  `apps/web/src/shared/ui/feedback-state.tsx` — a name-based file search misses them.
  They are also **not prop-symmetric**: `ErrorState` has no `liveRegion` (hard-codes
  `role="alert"`), and `ErrorState`/`LoadingState` default their `eyebrow`, so the real
  axis is overriding it.
- `Alert.children` is **required**; `title` is the optional half. A title-only story is
  not a legal use.
- `BulkActionBar` renders invisibly at `count === 0` — `.bulk-action-bar--hidden`
  (`opacity: 0` + `aria-hidden`). Its blank card was correct behaviour, NOT a config
  bug. Pass a real selection.
- `StructuredErrorList` returns `null` on an empty array, so no empty story exists. Its
  only axis is `translate`.
- `CheckboxCell` is ~14px tall; its card viewport is pinned to `320x120`. A first pass
  with 4 labelled rows was **silently clipped** with no warning on the sheet. A fifth
  state would need ~160px.

## Known render warns (triaged — a warn NOT listed here is new)

- `[RENDER_THIN]` / floor cards on unauthored components are the deliberate baseline,
  not failures.

## Blocked, not broken

- **`Dialog` and `Tooltip` ship as floor cards.** `shared/ui/index.ts` re-exports only
  the bare Radix Root (lines 54, 58); every sub-part carrying the DS CSS
  (`DialogContent/Title/Description/Footer`, `TooltipProvider/Trigger/Content`) is
  absent from the barrel and therefore from the bundle global — verified: `DialogContent`
  appears 0 times in `_ds_bundle.js` vs `TabsList` twice. `<Dialog open>` alone is a
  context provider with no portal or surface, so there is no honest render.
  **Real call sites deep-import them** (`import { Dialog, DialogContent, DialogFooter,
  DialogTitle } from '../../../shared/ui/dialog'`), which contradicts the catalog's own
  "anything not re-exported here is internal" contract. Resolving that belongs to
  **#2299** (deep imports break under an `exports` map), not to a tooling run.
  The authored previews are parked as
  `.design-sync/previews/{Dialog,Tooltip}.tsx.blocked-on-barrel-export` — they are
  written against the correct sub-part API and need only a rename + rebuild once the
  barrel is widened.

## Repo defect found during this sync (not fixed here)

- **`<Input invalid />` never paints the red border.** `.control--invalid` (specificity
  0,1,0, `index.css:834`) loses to the base `input[type='text'], …` block (0,1,1,
  `index.css:718`) which sets `border: 1px solid var(--border-default)`. It only looks
  right in-app because `FormField` injects `aria-invalid`, matching the 0,1,1
  `input[aria-invalid='true']` selector in the same group. `Textarea`/`Select` are
  unaffected (bare-element base selectors). Fix would be `input.control--invalid`.
  The preview passes both `invalid` and `aria-invalid` to mirror real rendering.

## Re-sync risks — what can silently go stale

- **The generated `.d.ts` tree is NOT committed.** A fresh clone must re-run the `tsc`
  command above or the build reports `[ZERO_MATCH]` and imports zero components.
- **`.design-sync/fonts.css` is a snapshot** of the `@font-face` rules scraped from
  `index.css`. If font families, weights or the `public/fonts/` filenames change, it
  goes stale silently — the build still succeeds and designs quietly fall back.
  Regenerate it from `ds-bundle/fonts/fonts.css`, repointing urls to
  `../apps/web/public/fonts/`.
- **Authored previews are pinned to today's component APIs.** A prop rename upstream
  makes a preview compile-fail, which silently drops that component to a floor card —
  check the build log for `! preview build failed: <Name>`.
- **`Dialog`/`Tooltip` stay floor cards until #2299 or a barrel widening.**
- `TabsList` / `TabsTrigger` / `TabsContent` have standalone manifest entries with no
  previews (they are composed inside `Tabs`). They may deserve
  `componentSrcMap: {…: null}` exclusion on a future sync — deliberately left alone here
  rather than shrinking the published surface as a side effect.
- The catalog's non-component exports (`FORMAT`, `MASTER`, `Length`, `Id`,
  `DESCRIPTION`, `Density`, …) were NOT excluded; the converter classified them out on
  its own (45 components from 53 identifiers). If a future sync over-includes them, use
  `componentSrcMap: {"<Name>": null}`.
