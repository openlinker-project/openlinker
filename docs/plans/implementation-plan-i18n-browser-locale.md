# Implementation Plan: open the interface in the browser's language (#3890)

## 1. Task understanding

**Goal.** A new session opens in the language the operator's browser asks for, when OpenLinker ships it.
English stays the last-resort default (decision 2026-11-06, which replaces the earlier plan to make
Polish the built-in default).

**Layer.** Frontend, `shared/i18n`, plus docs and build configuration.

**Base.** `3886-i18n-pl-daily-screens` (PR #3967): the browser can only usefully ask for Polish once
the screens are translated.

**Non-goals.** Saving the choice on the user profile (a later step); locking in the translations (#3891).

## 2. Design

Resolution order, first answer wins:

1. `?lang=` (saved, then removed from the address bar), unchanged.
2. The stored choice from the language switch, unchanged.
3. **New:** the browser. Walk `navigator.languages` (or `navigator.language` when the list is empty),
   match on the primary subtag through the existing `normalizeLocaleTag`, take the first supported one.
   An unsupported language (`de`) is skipped, not treated as an answer.
4. `VITE_DEFAULT_UI_LOCALE`, when it names a supported language.
5. `FALLBACK_LOCALE` (`en`, unchanged).

- `resolveLocale` stays the one pure function. It gains a required `browserLanguages` input, so a test
  states the browser it assumes instead of inheriting happy-dom's `en-US`.
- `readBrowserLocale(languages)` is pure; `readNavigatorLanguages()` reads `navigator` and is guarded
  (no `window`, a throwing getter, a non-array value).
- Detection never writes to storage. Only the switch stores, so a changed browser language shows on the
  next session.

## 3. Steps

1. `apps/web/src/shared/i18n/resolve-locale.ts`: `readBrowserLocale`, `readNavigatorLanguages`,
   `browserLanguages` in `ResolveLocaleInput`, `resolveInitialLocale` passes the navigator's list.
2. `resolve-locale.test.ts`: every step of the order with stubbed languages and env; detection writes
   nothing; header no longer says "Polish fallback".
3. `i18n.types.ts`: the `FALLBACK_LOCALE` comment no longer says #3890 changes it to Polish.
4. ADR-081 decision 3 and Consequences (the lock-in step is #3891, not #3890).
5. `docs/frontend-architecture.md` § Internationalization and § Environment.
6. `apps/web/.env.example`, `apps/web/Dockerfile`, `docker-compose.demo.yml`: build-time, needs a
   rebuild, used only when the browser gives no supported language.

## 4. Tests

- Unit: query, stored, browser (`pl-PL`, `en-US`, `en-GB`, `['de-DE', 'en-US']`), no supported browser
  language with env set, unset and unsupported, `navigator.language` fallback, storage untouched.
- `pnpm test` in `apps/web` with `VITE_DEFAULT_UI_LOCALE=pl` and unset (happy-dom reports `en-US`, so
  both stay English).

## 5. Release note (for the PR and the release)

> **The interface now opens in your browser's language.** If your browser asks for Polish, OpenLinker
> opens in Polish; otherwise it opens in English. The language switch in the top bar still lets you
> pick either one, and your choice is remembered on this browser. A deployment can set
> `VITE_DEFAULT_UI_LOCALE` for browsers that ask for neither language.
