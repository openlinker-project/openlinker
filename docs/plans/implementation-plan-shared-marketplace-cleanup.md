# Implementation Plan — Clean up shared/ marketplace code (#607)

**Issue:** [#607] [H4 HIGH] shared/ marketplace cleanup
**Layer:** Frontend (`apps/web/src/`)
**Branch:** `607-shared-marketplace-cleanup`

---

## 1. Goal & Non-Goals

### Goal

`shared/` is the lowest layer in the frontend dependency rule (`app → pages → features → shared`). It must remain **domain-agnostic** — no marketplace-specific names, types, or string literals leak in. Today two `shared/` modules violate that:

- `shared/ui/allegro-error-list.tsx` — primitive named after Allegro, hard-imports an Allegro translator helper. Already used by **two** features (`listings` for offer-create, `content` for content-publish) and would be used by a third tomorrow (Amazon, eBay, etc.).
- `shared/lib/allegro-error-mapping.ts` — pure Allegro-specific code-→-friendly-message lookup table sitting in `shared/`.

The cleanup makes the primitive marketplace-neutral and pushes the Allegro lookup table into `features/allegro/lib/`, while preserving identical rendering behavior. We also lock the door behind us with a lint rule.

### Non-Goals

- Adding additional marketplace translators (Prestashop / Amazon / etc.) — defer until needed.
- Reworking the rendering UX, copy semantics, or "click-to-copy" breadcrumb behavior — purely a relocation + rename.
- Touching `shared/ui/category-tree-browser.tsx` beyond a one-line verification — issue description listed it as suspect but the file is already domain-agnostic by design (own `CategoryTreeNode` interface, explicit header comment). **No code change needed**, only confirmed in the plan.
- API surface changes for `OfferCreationErrorList` (still a thin wrapper, callers in flight don't need migration).

---

## 2. Current State (Research Findings)

### Files in `shared/` that violate the rule

| File | Lines | Issue |
|---|---|---|
| `apps/web/src/shared/ui/allegro-error-list.tsx` | 144 | Component named `AllegroErrorList`. Imports `translateAllegroError` directly. Type alias `AllegroLikeError`. CSS classes `.allegro-error-list*`. `aria-label="Allegro errors"`. |
| `apps/web/src/shared/lib/allegro-error-mapping.ts` | ~90 | Allegro-specific allowlist of 6 error codes → friendly English strings. Exports `AllegroLikeError`, `AllegroErrorTranslation`, `translateAllegroError`. |

### Consumers (verified via grep)

| Consumer | Imports |
|---|---|
| `features/listings/components/OfferCreationErrorList.tsx` | `AllegroErrorList` from `shared/ui/allegro-error-list` |
| `features/content/components/content-panel.tsx` | `AllegroErrorList` (component) + `AllegroLikeError` (type) |
| `features/content/lib/extract-allegro-errors.ts` | `AllegroLikeError` (type only) |
| `shared/ui/allegro-error-list.test.tsx` | Tests for primitive |
| `shared/lib/allegro-error-mapping.test.ts` | Tests for translator |
| `features/content/components/content-editor.test.tsx` | Asserts on `.allegro-error-list` CSS classes / aria-label text |
| `apps/web/src/index.css` | `.allegro-error-list*` BEM block (~30 selectors L5021-5193) |

### Files already domain-agnostic (verification only)

- `shared/ui/category-tree-browser.tsx` — header comment already says "Domain-agnostic by design", defines its own `CategoryTreeNode` interface, doesn't import from `features/`. **No change needed.**

---

## 3. Design

### Renames & Moves

1. **Primitive rename** (shared/ stays neutral):
   - File: `shared/ui/allegro-error-list.tsx` → `shared/ui/structured-error-list.tsx`
   - Component: `AllegroErrorList` → `StructuredErrorList`
   - Inline helper: `AllegroErrorRow` → `StructuredErrorRow` (keeps file-local, no rename collision)
   - Type: `AllegroLikeError` → `StructuredError` (same shape `{ field?: string; code: string; message: string }`)
   - CSS: `.allegro-error-list*` → `.structured-error-list*` (all ~30 selectors in `index.css`)
   - `aria-label="Allegro errors"` → `aria-label="Errors"`
   - The "Allegro's original message" `<summary>` text is now driven by **whatever the `translate` callback returned** — see (2). When no translation runs, no `<details>` block renders.

2. **Translator move** (Allegro-specific code goes into the Allegro feature):
   - `shared/lib/allegro-error-mapping.ts` → `features/allegro/lib/translate-allegro-error.ts`
   - Exports unchanged: `translateAllegroError`, `AllegroErrorTranslation`
   - The shape `AllegroLikeError` is replaced — the file `import { type StructuredError } from '../../../shared/ui/structured-error-list'` and re-exports a local alias `type AllegroError = StructuredError` so call sites don't lose the marketplace-flavored name.
   - The translation contract is widened to return a `{ message: string; originalLabel?: string }` so the primitive renders "Allegro's original message" as a string the *translator* owns, not the primitive. Default `originalLabel = "Original message"` when undefined.

3. **`StructuredErrorList` API**:
   ```ts
   interface StructuredError {
     field?: string;
     code: string;
     message: string;
   }

   interface StructuredErrorTranslation {
     message: string;
     /** Label for the collapsed `<details>` block. Default: "Original message". */
     originalLabel?: string;
   }

   interface StructuredErrorListProps {
     errors: StructuredError[] | null | undefined;
     translate?: (error: StructuredError) => StructuredErrorTranslation | null;
     className?: string;
     /** Overrides the default `aria-label="Errors"`. */
     ariaLabel?: string;
   }
   ```

   When `translate` is omitted, the primitive renders `error.message` verbatim and never opens a `<details>` block — i.e., Allegro-style "original message" disclosure is opt-in per call site.

4. **Consumer updates**:
   - `OfferCreationErrorList.tsx`: now imports `StructuredErrorList` + `translateAllegroError`, passes the translator explicitly:
     ```tsx
     return (
       <StructuredErrorList
         errors={errors}
         translate={translateAllegroError}
         className={className}
       />
     );
     ```
   - `content-panel.tsx`: same wiring — replace `AllegroErrorList` with `StructuredErrorList` and pass `translate={translateAllegroError}`. Type import `AllegroLikeError` → `AllegroError` from new translator file (since panel state is typed against the error shape).
   - `extract-allegro-errors.ts`: `import type { AllegroError } from '../../allegro/lib/translate-allegro-error'` (same-feature is fine; sibling feature is also fine — `extract-allegro-errors` is Allegro-specific anyway and the import direction is content → allegro, which doesn't violate any layer rule).

5. **Lint rule** (preserves the win):
   Add to the `shared/**` block in `.eslintrc.js`:
   ```js
   {
     group: ['**/*allegro*', '**/*prestashop*', '**/*shopify*', '**/*ebay*', '**/*amazon*'],
     message:
       'shared/ must stay domain-agnostic — no marketplace-specific imports. Move the marketplace bit into features/{platform}/ and pass it as a prop or callback.',
   },
   ```
   This catches filename leaks (the actual failure mode #607 exposes) without forbidding legitimate import paths that happen to contain "amazon" in a third-party package name (no `@aws-sdk/*` or similar in the FE — verified).

### Why pass the translator as a prop, not import it inside?

- The primitive doesn't need to know who is talking. Anything that gives it a `(err) => { message } | null` callback gets identical visual output.
- A future Prestashop translator drops in with zero changes to the primitive: `<StructuredErrorList errors={errs} translate={translatePrestashopError} />`.
- Bundling/tree-shaking: callers that don't translate (`Amazon` flow tomorrow) don't pull in any other marketplace's lookup table.

### Files moved or renamed (summary)

| From | To | Reason |
|---|---|---|
| `shared/ui/allegro-error-list.tsx` | `shared/ui/structured-error-list.tsx` | Domain-neutral name |
| `shared/ui/allegro-error-list.test.tsx` | `shared/ui/structured-error-list.test.tsx` | Match source |
| `shared/lib/allegro-error-mapping.ts` | `features/allegro/lib/translate-allegro-error.ts` | Marketplace-specific code |
| `shared/lib/allegro-error-mapping.test.ts` | `features/allegro/lib/translate-allegro-error.test.ts` | Match source |
| `shared/lib/` (folder) | **kept** | Other shared/lib/* may exist; only one file moves |

Use `git mv` for renames so history is preserved.

### Files modified (summary)

- `apps/web/src/index.css` — rename `.allegro-error-list*` block to `.structured-error-list*` (and the responsive `@media` rule at L5186).
- `apps/web/src/features/listings/components/OfferCreationErrorList.tsx`
- `apps/web/src/features/content/components/content-panel.tsx`
- `apps/web/src/features/content/lib/extract-allegro-errors.ts`
- `apps/web/src/features/content/components/content-editor.test.tsx` — update asserted class names / aria-label text
- `.eslintrc.js` — add filename denylist for `shared/**`

---

## 4. Step-by-Step Implementation

### Phase A — Move and rename

1. **`git mv shared/ui/allegro-error-list.tsx shared/ui/structured-error-list.tsx`**
2. **`git mv shared/ui/allegro-error-list.test.tsx shared/ui/structured-error-list.test.tsx`**
3. **`git mv shared/lib/allegro-error-mapping.ts features/allegro/lib/translate-allegro-error.ts`** — create `features/allegro/lib/` dir if it doesn't exist.
4. **`git mv shared/lib/allegro-error-mapping.test.ts features/allegro/lib/translate-allegro-error.test.ts`**

### Phase B — Rewrite the primitive

5. **Edit `shared/ui/structured-error-list.tsx`**:
   - Update header comment: drop Allegro references; new intent is "Structured `{field?, code, message}` error list. Marketplace-agnostic — accepts an optional `translate` callback per-call so feature layers own marketplace-specific copy."
   - Remove `import { translateAllegroError, type AllegroLikeError } from '../lib/allegro-error-mapping'`.
   - Define local types: `StructuredError`, `StructuredErrorTranslation`.
   - Rename `AllegroErrorList` → `StructuredErrorList`, `AllegroErrorRow` → `StructuredErrorRow`.
   - Accept `translate?: (err: StructuredError) => StructuredErrorTranslation | null` and `ariaLabel?: string` props.
   - Inside `StructuredErrorRow`, replace `translateAllegroError(error)` with `translate?.(error) ?? null`.
   - `aria-label`: default to `"Errors"`, allow override via prop.
   - `<details><summary>` label: use `translation.originalLabel ?? 'Original message'`.
   - CSS classes: replace every `.allegro-error-list*` token with `.structured-error-list*`.

### Phase C — Rewrite the translator

6. **Edit `features/allegro/lib/translate-allegro-error.ts`**:
   - Update header: location moved, purpose unchanged.
   - Replace `import type` of locally-defined `AllegroLikeError` with `import type { StructuredError, StructuredErrorTranslation } from '../../../shared/ui/structured-error-list'`.
   - Re-export `export type AllegroError = StructuredError;` for ergonomic call-site use.
   - Tighten the function signature: `translateAllegroError(error: AllegroError): StructuredErrorTranslation | null`.
   - The existing `AllegroErrorTranslation` type can be kept as a local alias of `StructuredErrorTranslation` for back-compat, or removed if nothing else uses it. Check + remove if dead.
   - Allowlist contents (6 codes) unchanged.

### Phase D — Update consumers

7. **`features/listings/components/OfferCreationErrorList.tsx`**:
   - Switch imports: `StructuredErrorList` from `shared/ui/structured-error-list`, `translateAllegroError` from `../../allegro/lib/translate-allegro-error`.
   - Pass `translate={translateAllegroError}`.

8. **`features/content/components/content-panel.tsx`**:
   - Switch imports: `StructuredErrorList` from `shared/ui/structured-error-list`, `translateAllegroError` + type `AllegroError` from `../../allegro/lib/translate-allegro-error`.
   - The `errors?: AllegroLikeError[] | null` prop type becomes `errors?: AllegroError[] | null` (or `StructuredError[]` — pick `AllegroError` since this panel is the Allegro publish flow and the name preserves intent).
   - Pass `translate={translateAllegroError}` to `<StructuredErrorList>`.

9. **`features/content/lib/extract-allegro-errors.ts`**:
   - Switch import: `import type { AllegroError } from './translate-allegro-error'` — wait, this lives in `content/lib/`, not `allegro/lib/`. Use sibling-feature import: `import type { AllegroError } from '../../allegro/lib/translate-allegro-error'`.
   - Replace `AllegroLikeError[]` with `AllegroError[]` in the return type + intermediate types.

10. **`features/content/components/content-editor.test.tsx`**:
    - Update any `screen.getByRole('list', { name: /allegro errors/i })` → `name: /^errors$/i`.
    - Update CSS class selectors `.allegro-error-list*` → `.structured-error-list*` if used.

### Phase E — CSS rename

11. **`apps/web/src/index.css`**:
    - In the block starting around L5021, rewrite every `.allegro-error-list` token to `.structured-error-list`. The selectors are flat BEM (`.allegro-error-list__item`, `.allegro-error-list--single`, etc.) so a scoped find/replace inside the block (NOT global file replace) is safe.
    - Sanity-check: the responsive `@media` block at L5186 also uses these classes.

### Phase F — Lint denylist

12. **`.eslintrc.js`** — in the `apps/web/src/shared/**/*.{ts,tsx}` override block (around L65-86), append a second `patterns` entry to the existing `no-restricted-imports` block:
    ```js
    patterns: [
      {
        group: ['**/features/**', '**/pages/**', '**/app/**', '**/plugins/**'],
        message: 'Shared modules must not import feature, page, app, or plugin modules.',
      },
      {
        group: ['**/*allegro*', '**/*prestashop*', '**/*shopify*', '**/*ebay*', '**/*amazon*'],
        message:
          'shared/ must stay domain-agnostic — no marketplace-named imports. Move the marketplace bit into features/{platform}/ and pass it as a prop or callback.',
      },
    ],
    ```
    Verify nothing in `shared/` legitimately imports something matching these globs (it shouldn't, after this PR).

### Phase G — Validate

13. **Quality gate**:
    ```bash
    pnpm lint
    pnpm type-check
    pnpm test
    ```
    All three must pass with zero errors. The new lint rule should catch nothing (because we just moved the offenders out); we'll verify by temporarily re-introducing a fake `shared/test-leak.ts` that imports from `features/allegro/lib/translate-allegro-error.ts` — should fail — then delete it.

14. **Confirm `category-tree-browser.tsx` already passes the new lint rule** (it doesn't import anything matching the new denylist; verified during research).

---

## 5. Testing Strategy

| File | What to verify |
|---|---|
| `structured-error-list.test.tsx` | Renamed component renders rows for translated and untranslated errors. With `translate` omitted: no `<details>` block opens, `error.message` is the only text. With `translate` returning `{ message, originalLabel }`: friendly message renders, `<details>` shows `originalLabel`. Existing breadcrumb / copy / leaf-segment tests carry over unchanged. |
| `translate-allegro-error.test.ts` | All 6 existing allowlist cases still pass with the new return type (`StructuredErrorTranslation`). Cases returning `null` for unknown codes still return `null`. |
| `content-editor.test.tsx` | aria-label and CSS-class assertions updated; behavioral assertions unchanged. |
| Lint validation | After Phase F, run `pnpm lint` — passes. Manually re-introduce one bad import in `shared/` to confirm the new rule triggers (then remove). |

No new test files required — the existing test files move alongside their source files.

---

## 6. Architecture Compliance Check

- ✅ Dependency direction preserved: `features/allegro/lib/translate-allegro-error.ts` imports a *type* from `shared/ui/structured-error-list.tsx`. Type imports from `shared/` into `features/` are the *intended* direction.
- ✅ `shared/` no longer references any marketplace by name in code, type, or filename.
- ✅ Cross-feature import (`content/lib/extract-allegro-errors.ts` → `allegro/lib/translate-allegro-error.ts`) is not forbidden by current rules. Sibling features can talk to each other through type-only or thin pure helpers — they just can't import from `pages/` or `plugins/`.
- ✅ `app → pages → features → shared` still holds.
- ✅ New lint rule is additive; doesn't loosen existing constraints.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `index.css` find/replace touches unrelated rules. | Scope the rewrite to the `.allegro-error-list*` block only (~L5021-5193) via Edit-tool `replace_all` on the prefix string `allegro-error-list` after first verifying via grep that the string appears nowhere else in `index.css`. |
| Tests assert on CSS classes / aria-label text we forget to update. | Grep the test tree for `allegro-error-list` and `Allegro errors` after edits; expect zero matches. |
| `AllegroLikeError` is also used in API typings somewhere we haven't found. | Pre-rename grep: `AllegroLikeError` matches only 4 files (content-panel, extract-allegro-errors, mapping file, list file). All covered above. |
| New ESLint glob denylist accidentally bans a legitimate identifier (e.g. a future `shared/ui/empty-state.tsx` referencing `amazonAffiliateLink` field). | Glob is `**/*allegro*` — matches *paths*, not symbol names. Won't trip on variable identifiers. Confirmed by reading `no-restricted-imports` semantics in current ESLint docs. |
| Future contributor adds a Prestashop translator inside `shared/lib/` again. | Lint rule now catches it. Plus the file-header on `structured-error-list.tsx` is updated to call out the contract explicitly. |
| Cross-feature import from `content/` → `allegro/` feels unusual. | Documented in the file header of `extract-allegro-errors.ts` (1 line). `content/` is the consumer that publishes to Allegro; reaching into `features/allegro/` for the translator is the same direction the runtime flow takes. Alternative considered: leave the translator in `content/lib/` since today's only `content/` consumer talks to Allegro — rejected because `listings/` is also a consumer and putting it under `features/allegro/lib/` keeps it where the *next* Allegro-needing feature will look. |

---

## 8. Out of Scope (Defer)

- Adding translators for non-Allegro marketplaces — wait until we have failing error UX for one.
- Generalizing `OfferCreationErrorList.tsx` into something marketplace-routed via the plugin registry — the listings flow is Allegro-only today; revisit when a second marketplace ships an offer-create wizard.
- Splitting the `originalLabel` plumbing into i18n strings — single-language project today.

---

## 9. Open Questions

None expected — the surface is small enough that all decision points are resolved above. If the user wants the new lint glob denylist split into one rule per marketplace (instead of a single combined pattern) for readability, that's a one-line edit at implementation time.
