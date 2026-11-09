# Implementation Plan: lock in the translations (#3891)

## 1. Task understanding

**Goal.** After the last Polish batch, new hardcoded text must be impossible and a missing Polish key must be
visible, without ever breaking the build: a missing key already shows the English text at runtime
(`mergeOverEnglish`, ADR-081 decision 1) and English stays the fallback (decision 2026-11-06).

**Layer.** Frontend (`shared/i18n`, `features`), DX (`scripts`, `.eslintrc.js`), docs.

**Base.** `3890-i18n-browser-locale` (PR #4019), which sits on the Polish epic (#3967).

**Non-goals.** Making `PolishCopy` required (decided against); saving the language on the user profile
(follow-up issue, below); moving the remaining `error.message` renders (#3867).

## 2. Design

- **Missing Polish keys warn.** `scripts/check-locales.mjs` gets rule 10, `findMissingTranslations`: one
  warning per English key a translation lacks (empty string counts, a plural counts once), core and plugins,
  built on the existing `coverageOf`. It never changes the exit code. `--self-check` covers it.
- **`PolishCopy` stays deep-partial.** `locales/pl/index.check.ts` keeps rejecting a key English lacks and a
  string/section mismatch; a missing key is not a type error. A type-level test (`copy.types.test.ts`) pins
  both directions with `@ts-expect-error`. Being partial, a plural missing `few` / `many` is not caught either,
  which the docs now say instead of claiming the opposite.
- **Lint on for every folder.** The `i18next/no-literal-string` override covers `app`, `features`, `pages`,
  `plugins` and `shared`. Excluded: tests, copy files and the developer-only `pages/dev-ui` route (component
  descriptions for developers, never shown to an operator). `scripts/check-i18n-lint-rule.mjs` pins the scope
  and the exclusions and proves the rule is on for a real component in each top-level folder.
- **`delivery-on-documents`** (#3905, written after the extraction) was the one feature folder with hardcoded
  text; its copy moves to a new `delivery-on-documents` namespace in English and Polish.
- **The `useTranslation` / `t(key, fallback)` shim is removed**, with the `catalog` prop of `LocaleProvider`,
  `TranslationCatalog`, and the unused `_t` parameters of the invoicing / fiscalization helpers. Its last
  call site (the document-type label in `SalesDocumentPanel`) reads `DOCUMENT_TYPE_LABEL_FALLBACK` directly,
  which is what `t` returned over the always-empty catalog.
- **Docs**: ADR-081 Consequences and Migration path, the `copy.types.ts` and `pl/index.check.ts` comments,
  `docs/frontend-architecture.md` § Internationalization (shim, lint scope, check-locales warnings, steps 2
  and 12 of "Adding another language").

## 3. Tests

- `check-locales --self-check` (missing-key warning, no Polish file at all).
- `check-i18n-lint-rule` (scope, exclusions, rule on per top-level folder).
- `copy.types.test.ts` (type level), `locale-provider.test.tsx` (shim tests removed, `useLocale` outside the
  provider throws), the invoicing / fiscalization helper tests without the translator argument.
- A missing Polish key renders English: already covered by `messages.test.ts`
  ("should fall back to the base language per key when a translation is missing").

## 4. Follow-up issue (to file)

> **Frontend + Backend - Save the interface language on the user profile.** The language an operator picks
> with the switch is stored in `localStorage` only, so it does not follow them to another browser or device.
> Store it on the user (`uiLocale`, `pl | en | null`), return it from `GET /auth/me`, write it when the switch
> is used, and resolve it after `?lang=` and before the browser language (#3890). `null` keeps today's order.
