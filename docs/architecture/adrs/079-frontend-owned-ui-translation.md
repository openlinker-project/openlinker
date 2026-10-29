# ADR-079: Frontend-owned UI translation with typed per-feature copy files

- **Status**: Accepted
- **Date**: 2026-10-29
- **Authors**: @norbert-kulus-blockydevs

## Context

The admin SPA (`apps/web`) is English only. Operators are mostly Polish, so the
milestone "Interface language: Polish and English" makes Polish the default and
keeps English as a choice. The frontend already has a no-op seam
(`apps/web/src/shared/i18n`, #612): `t(key, fallback)` over an empty catalog,
used in about 520 places. An inventory found about 11,000 rows of user-facing
text across 553 components, about 1,500 of them already in `*.copy.ts` files
that `scripts/check-ui-vocabulary.mjs` reads. Polish needs one/few/many plural
forms. The API answers errors mostly with English sentences.

## Decision

1. **Copy lives in typed `*.copy.ts` files, English and Polish side by side**:
   `export const ordersCopy = defineCopy({ en: {...}, pl: {...} });` - English
   infers the shape and Polish is type-checked against it.
   One file per feature folder; a file of its own only for a very large
   component; one shared file for `shared/ui`. Components read it through
   `useCopy(ordersCopy)` from `shared/i18n`, the only import path.
2. **Polish plurals and formatting go through `Intl`**: `usePlural` on
   `Intl.PluralRules`, `useFormat` for numbers, money, dates and relative time.
   No plural or date is built by string concatenation.
3. **No locale in the URL.** The language is resolved as `?lang=` (saved), then
   `localStorage`, then `VITE_DEFAULT_UI_LOCALE`, then `pl`. A later step saves
   it on the user profile.
4. **The frontend owns every user-facing word.** The backend gains stable error
   codes and params (an error envelope) but never translated text.
5. **Product rules**: brand and platform names are not translated; English copy
   uses British spelling ("fulfilment"); copy uses a plain hyphen, never an em
   dash; copy speaks to operators, not developers; copy addressed to a Polish
   provider is bilingual, Polish first; the KSeF statement (oswiadczenie) stays
   Polish in both languages.

## Alternatives considered

- **Intlayer** (`*.content.ts`, `useIntlayer`): keeps languages side by side,
  but its plural syntax uses numeric ranges, which cannot express Polish "few"
  (22 vs 12); it adds a build plugin, a watcher and a generated folder, and most
  of its code comes from one maintainer. Rejected.
- **i18next with per-feature JSON namespaces**: mature and correct on plurals,
  but each language sits in a separate file, so an agent or developer edits two
  files and TypeScript checks only that keys exist, not that Polish does.
  Rejected; the copy-file shape stays close to i18next's suffix style, so moving
  later is a mechanical export.
- **A locale URL prefix** (`/pl/orders`): built for search engines and public
  pages. This is an app behind a login; it would touch every route and would
  open a colleague's link in the sender's language. Rejected.

## Consequences

**Pros:**
- One file holds both languages, so a missing Polish string is a type error once
  the type is strict, and an agent sees what to translate.
- Extends an existing convention and check script; no new runtime dependency.
- Tests stay English by pinning the locale in the shared render helper.

**Cons / trade-offs:**
- About 150 lines of our own code (types, hooks, plurals, rich text, checks).
- Every language ships in the main bundle until per-locale splitting is added.
- Export to translator tools needs a script.

**Migration path:**
- `t(key, fallback)` stays as a compatibility shim and gets no new callers; it is
  removed once the extraction issues have moved its call sites.
- Extraction runs per feature folder; each PR switches the no-literal-text lint
  rule on for its folders.

## References

- Related issues: #3855, #3856, #3857, #3858, #3859, #612
- Primary doc section: [docs/frontend-architecture.md](../../frontend-architecture.md) § Internationalization
- Glossary: [docs/i18n-glossary.md](../../i18n-glossary.md)
