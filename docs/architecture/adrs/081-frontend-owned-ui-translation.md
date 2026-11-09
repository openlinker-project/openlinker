# ADR-081: Frontend-owned UI translation in JSON namespaces

- **Status**: Accepted
- **Date**: 2026-10-29
- **Authors**: @norbert-kulus-blockydevs

## Context

The admin SPA (`apps/web`) is English only. Operators are mostly Polish, so the
milestone "Interface language: Polish and English" adds Polish and keeps English
as a choice; a session opens in the browser's language when the app ships it,
and in English otherwise (#3890). The frontend already has a no-op seam
(`apps/web/src/shared/i18n`, #612): `t(key, fallback)` over an empty catalog,
used in about 520 places. An inventory found about 11,000 rows of user-facing
text across 553 components, about 1,500 of them already in `*.copy.ts` files
that `scripts/check-ui-vocabulary.mjs` reads. Polish needs one/few/many/other plural
forms. The API answers errors mostly with English sentences.

## Decision

1. **Copy lives in one JSON file per language and namespace.**
   The application core keeps its copy in `apps/web/src/locales/<lang>/<namespace>.json`
   (`locales/en/orders.json`, `locales/pl/orders.json` ...), one file per
   namespace named after the feature folder (`ui`, `format`, `orders` ...);
   `locales/en/index.ts` lists the core namespaces. A plugin keeps its own
   namespace in its own folder, `plugins/<id>/locales/<lang>.json`, and
   registers it with `definePluginMessages`, so a plugin built outside this
   repository can ship translations without touching core files. Each
   namespace has exactly one home and the registry refuses a second
   registration of the same name, so nothing is looked up across files; the
   only fallback is within a namespace, from the active language to its base
   language. English is the base: it holds every key, it gives the TypeScript
   types (`useMessages('orders')` is typed from `locales/en/orders.json` through
   the index, a plugin's hook from its own `en.json`), and
   `locales/pl/index.check.ts` makes `tsc` reject a Polish shape English lacks.
   English ships in the main bundle; every other language is a dynamic import,
   one chunk per namespace file, loaded before the first paint and before a
   language switch. Components read
   copy through `useMessages` from `shared/i18n`, the only import path.
   Character budgets for tight spots live in `limits.json` beside the copy.
2. **Polish plurals and formatting go through `Intl`**: `usePlural` on
   `Intl.PluralRules`, `useFormat` for numbers, money, dates and relative time.
   No plural or date is built by string concatenation.
3. **No locale in the URL.** The language is resolved as `?lang=` (saved), then
   `localStorage`, then the first browser language the app ships (`navigator.languages`,
   matched on the primary subtag, never stored; #3890), then `VITE_DEFAULT_UI_LOCALE`, then
   the built-in default `en`. An unset, blank or unsupported variable all resolve to `en`.
   (An earlier plan made `pl` the built-in default; on 2026-11-06 it was replaced by
   following the browser, so English stays the last resort.) A later step saves the choice
   on the user profile.
4. **The frontend owns every user-facing word.** The backend will gain stable
   error codes and params (an error envelope, #3860 to #3867) but never
   translated text. Until it does, the frontend maps the machine values an
   endpoint already sends and shows any other server sentence behind a
   translated prefix.
5. **Product rules**: brand and platform names are not translated; English copy
   uses British spelling ("fulfilment"); copy uses a plain hyphen, never an em
   dash; copy speaks to operators, not developers; copy addressed to a Polish
   provider is bilingual, Polish first; the KSeF statement (oświadczenie) stays
   Polish in both languages.

## Alternatives considered

- **Intlayer** (`*.content.ts`, `useIntlayer`): keeps languages side by side,
  but its plural syntax uses numeric ranges, which cannot express Polish "few"
  (22 vs 12); it adds a build plugin, a watcher and a generated folder, and most
  of its code comes from one maintainer. Rejected.
- **Typed `*.copy.ts` files with both languages side by side**
  (`defineCopy({ en, pl })`, the first version of this decision): one file to
  edit and a strict type check, but every language ships in the main bundle,
  translator tools cannot read TypeScript without an export script, and a
  plugin's copy is indistinguishable from core copy. Replaced by decision 1
  before any feature copy was migrated.
- **One JSON file per language for the core** (`locales/en.json` with the
  namespaces as top-level keys, the first version of decision 1): two files
  instead of about eighty, and no index to keep, but the extraction runs as
  eighteen parallel PRs plus translation batches, and every one of them edited
  the same file - a core file heading for 15,000+ lines, a chain of stacked
  branches to avoid conflicts, and diffs too large to review. Replaced by one
  file per namespace while the extraction was in its first PR (#3868).
- **i18next**: mature and correct on plurals, but its `count_one` / `count_few`
  suffix keys and its runtime are more than this app needs; the JSON layout
  here is close enough that moving later is a mechanical change.
- **A locale URL prefix** (`/pl/orders`): built for search engines and public
  pages. This is an app behind a login; it would touch every route and would
  open a colleague's link in the sender's language. Rejected.

## Consequences

**Pros:**
- Copy is plain JSON, which translator tools (Crowdin, Weblate, Lokalise) read as it is. A Polish file with the wrong shape (a key English lacks, a string where English has a section or the reverse) is a type error, but a missing Polish key is not: the runtime shows the English text for it, and `scripts/check-locales.mjs` lists every gap as a warning that never fails the build (#3891).
- Polish is downloaded only by a session that uses it.
- Plugins carry their own translations, the same model as Backstage's per-plugin translation refs.
- No new i18n runtime library (the language switch uses Motion, a general animation library).
- Tests stay English by pinning the locale in the Vitest setup file and `env`, with the shared render helper as a second pin.

**Cons / trade-offs:**
- About 1,400 lines of our own code (runtime in `shared/i18n/`, check scripts).
- Text sits away from the component that shows it.
- About eighty core files instead of two, and an index (`locales/en/index.ts`, `locales/pl/index.check.ts`) to keep in step with them; `scripts/check-locales.mjs` fails when a file and its index disagree, and `useMessages('<new>')` does not compile until the index lists it.
- Shared files remain for parallel PRs: the index line and `limits.json`, both sorted, so conflicts stay one line each.
- A plugin's Polish is checked by `scripts/check-locales.mjs`, not by `tsc`.

**Migration path:**
- `t(key, fallback)` was a compatibility shim with no new callers; #3891 removed it
  with its last call site.
- Extraction ran per feature folder into that feature's namespace, each PR
  switching the no-literal-text lint rule on for its folders; since #3891 the
  rule covers every folder (only the developer-only `/dev/ui` route is excluded).

## References

- Related issues: #3855, #3856, #3857, #3858, #3859, #612
- Primary doc section: [docs/frontend-architecture.md](../../frontend-architecture.md) § Internationalization
- Glossary: [docs/i18n-glossary.md](../../i18n-glossary.md)
