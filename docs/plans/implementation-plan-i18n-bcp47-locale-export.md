# Implementation Plan — export `getBcp47Locale` from `shared/i18n` (#783)

## 1. Understand the task

**Goal:** Make the locale → BCP 47 resolution a single source of truth. Export
the helper currently private in `use-number-format.ts` so per-row formatters
(e.g. orders list `formatCurrency` / `formatFreshness`) stop mirroring
`locale === 'en' ? 'en-US' : locale` inline.

**Layer:** Frontend, `shared/i18n` seam + one page consumer. No backend.

**Chosen approach:** Option A from the issue (lighter touch) — export a pure
`getBcp47Locale(locale)` helper; consumers call it inline with their own
`Intl.NumberFormat` / `Intl.DateTimeFormat`. Defer Option B
(`useCurrencyFormatter()` hook) until a second real consumer needs that shape.

**Non-goals:** the `useCurrencyFormatter()` hook (Option B); migrating any other
formatter; changing `useNumberFormat`'s public surface or behaviour.

## 2. Research findings

- `apps/web/src/shared/i18n/use-number-format.ts:24-27` — private
  `localeToBcp47(locale)`; used by `useNumberFormat` at line 21. File header
  (lines 9-11) references `localeToBcp47` by name.
- `apps/web/src/shared/i18n/index.ts` — barrel; exports `useNumberFormat` but
  not the helper.
- `apps/web/src/pages/orders/orders-list-page.tsx` — **two** identical mirrors:
  `formatCurrency` (L87) and `formatFreshness` (L105). The issue cites only the
  first; the acceptance criterion ("the mirror is gone") covers both.
- No `use-number-format.test.ts` exists today. The mapping is exercised only
  indirectly through `locale-provider.test.tsx` (via `useNumberFormat`). The
  issue's "no new coverage needed beyond use-number-format.test.ts" is premised
  on a file that isn't there.

## 3. Design

Lift the private `localeToBcp47` into an exported `getBcp47Locale` (same 2-line
body) and re-export from the barrel. Pure function, zero behaviour change.
**Per the tech-review**, the helper lives in a dedicated `shared/i18n/locale.ts`
sibling (a non-hook export doesn't belong in a `use-*.ts` file); `useNumberFormat`
imports it from `./locale`.

```ts
// shared/i18n/locale.ts
export function getBcp47Locale(locale: LocaleCode): string {
  if (locale === 'en') return 'en-US';
  return locale;
}
```

## 4. Step-by-step implementation

### Step 1 — extract helper to `shared/i18n/locale.ts`
- Move the resolver into a new `locale.ts` as exported `getBcp47Locale`; have
  `use-number-format.ts` import it from `./locale` (drops its now-unused
  `LocaleCode` import) and update the file-header comment.
- **Acceptance:** `getBcp47Locale` exported from `locale.ts`; `useNumberFormat`
  unchanged in behaviour; no `localeToBcp47` identifier remains.

### Step 2 — `shared/i18n/index.ts`
- Add `getBcp47Locale` to the `./use-number-format` re-export.
- **Acceptance:** `import { getBcp47Locale } from '../../shared/i18n'` resolves.

### Step 3 — `orders-list-page.tsx`
- Import `getBcp47Locale` from `../../shared/i18n`.
- Replace the inline mirror in `formatCurrency` (L87) and `formatFreshness`
  (L105) with `getBcp47Locale(locale)`. Update both comments that say
  "Mirrors `localeToBcp47`" to reflect the shared helper.
- **Acceptance:** no `locale === 'en' ? 'en-US' : locale` remains in the file.

### Step 4 — `locale.test.ts` (new)
- Colocated unit test for the now-public `getBcp47Locale`: `'en' → 'en-US'`,
  plus a loop over `LocaleCodeValues` asserting a well-formed BCP 47 tag (guards
  the contract as locales grow).
- **Acceptance:** test passes; covers the public helper directly.

### Step 5 — Quality gate
- `pnpm --filter ./apps/web lint && … type-check && … test` green; `pnpm
  check:invariants` unaffected.

## 5. Validation

- **Architecture:** stays within `shared/i18n`; `pages → shared` dependency
  direction respected (orders page already imports from `shared/i18n`). No
  `shared → features/pages` violation.
- **Naming:** `getBcp47Locale` matches the issue's proposed name; colocated
  `*.test.ts`.
- **Risk:** essentially nil — pure-function extraction with no behaviour change.
  Only watch item: ensure both mirror sites are updated (Step 3) so the
  acceptance criterion is literally satisfied.

## References
- `apps/web/src/shared/i18n/use-number-format.ts:24-27`
- `apps/web/src/shared/i18n/index.ts`
- `apps/web/src/pages/orders/orders-list-page.tsx:86-89, 97-110`
- `docs/frontend-architecture.md` § Internationalization (i18n)
- #783; surfaced by tech-review on PR #782 (#778)
