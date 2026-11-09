# Implementation Plan: i18n extraction 4/18 - listings (#3871)

Written after the fact, from what PR #3927 ships (review follow-up), so the bulk wizard extraction (#3872) and
the Polish batch (#3886) can rely on the same decisions.

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/listings` (outside the bulk offer wizard,
which is #3872) and `pages/listings` into the `listings` namespace, `apps/web/src/locales/en/listings.json`
(one file per namespace, ADR-081 as amended by #3920), and switch the no-literal-text lint on. English only.

**Non-goals.** The bulk offer wizard (#3872); Polish (#3886); server error codes (#3864, #3865).

## 2. Scope

- Pages: listings list, listing detail, bulk batch progress and the bulk wizard page shell.
- Offer creation and publication status badges, panel and tracker; the edit-offer drawer and description
  editor.
- Shop publishing: the publish wizard, launcher and tracker, the destination rail, the product picker and the
  duplicate guard.
- Category parameters, parameter restrictions, and the marketplace-specific offer fields and validations
  (`components/allegro`, `components/erli`).

## 3. Decisions

- **Reading copy.** Components use `useMessages('listings')`; helpers outside React (plugin validators,
  view-model builders) read `getMessages` when called, never at module level. Marketplace blocker labels are
  getters, so the plugin contract is unchanged while the words follow the active language.
- **Platform names.** Core copy may not name a platform (`check-provider-name-boundary`). Where the operator
  needs to know which platform an action concerns (which seller panel to open, which account), the copy takes
  a `{platform}` parameter filled from the connection's display name, rather than saying "the marketplace".
- **Forms.** Zod schemas are factories taking the namespace slice; validation-copy and form types live in
  `*.types.ts` files.
- **Formatting.** Counts use plurals; money, numbers, percentages, durations and relative times go through
  `useFormat`. Non-React validators format lists and numbers with `Intl` for the active locale.
- **Server text.** A server `message` is wrapped in `listings.common.serverSaid` ("The server said:
  {message}") through `lib/server-error-text.ts`. Adapter-authored operator sentences (offer problems, #2231)
  and messages already behind a translated prefix are shown as they are.
- **Copy rules.** Plain hyphens (no em or en dash), operator wording (no "enqueue", "upsert", "route",
  "polling"), British spelling.
- **Budgets.** Table headers, lifecycle tabs, batch metrics, status badges, chips and the main buttons carry
  character budgets in `locales/limits.json` (`listings:*`).
- **Removed exports.** `PUBLISH_DESTINATION_*` constants were folded into the namespace; nothing outside
  listings used them.

## 4. Tests

- Tests that pin English keep passing; assertions follow copy-rule changes (hyphens, operator wording).
- Schema factories (edit-offer fields, Erli offer fields, shop publish wizard) are tested for messages coming
  from the copy argument; the server-message helper has its own spec.

## 5. Lint

The migrated listings folders (`components`, `components/allegro`, `components/erli`, `pages/listings`) join
the no-literal-text scope in `.eslintrc.js` and `EXPECTED_SCOPE`; the bulk wizard folder joins with #3872.
