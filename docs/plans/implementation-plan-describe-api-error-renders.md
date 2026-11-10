# Implementation Plan: every API error the operator reads goes through describeApiError (#3867)

## 1. Task understanding

**Goal.** No operator-facing surface renders a server's English `error.message` any more. Every toast, `Alert`,
`ErrorState` and inline error built from a failed request reads `describeApiError(error, namespace?)`, which picks the
copy by the error's stable `code` in the active language (#3862). Polish lives only in `apps/web` locale files; the
backend keeps sending a code, params and an English developer message.

**Layer.** Frontend (`apps/web/src/features`, `pages`, `plugins`, `app/layouts`, one lint guard).

**Base.** `3863-fe-error-helpers` (PR #4012), the top of the error-code stack, which sits on current `main`
(`facdefa0d`). `describeApiError`, `errors.json` (391 codes, EN + PL) and the code-reading helpers are in the base.

**Non-goals.**
- No backend change and no backend copy. Fields that are stored English sentences (`dlqReason`,
  `salesDocumentBlockDetail`, settings bound reasons, connection-test `message`, `sync_jobs.lastError`) are #3866.
  Here they keep their raw text, under a translated "Technical details" label where they are shown as text.
- Form validation messages (`errors.<field>.message`, `fieldState.error.message`, zod issues): already our own
  translated copy, untouched.
- `applyFieldErrors` for server 400 `fields` on every form: separate follow-up, only where a form already maps
  server field errors by hand.
- Taking Polish out of beta (#3901).

## 2. What changes on screen

A Polish operator who hits a failed request sees the copy for its code (`errors.codes.<CODE>`), a feature's more
specific copy (`<namespace>.apiErrors.<CODE>`) when one exists, or the status-family sentence (404, 409, 5xx,
network, timeout) when the endpoint has no code yet. Never the raw English sentence. A provider refusal
(`PROVIDER_REJECTED`) keeps the provider's own words behind a translated prefix. In a development build an error
with no copy reads `[untranslated:<CODE>] <message>`, so gaps are visible.

## 3. Inventory (measured on the base)

- 843 `.message` reads in non-test `apps/web/src`; 281 are form field errors and 136 are copy keys, both out of
  scope.
- **333 reads in 202 files** are request errors rendered to the operator. Largest areas: connections 40, listings
  25, orders 18, analytics 15, plugins/ksef 12, products pages 10, sales-documents 10, returns 10, plugins/infakt 9,
  settings pages 9, auth 9, mappings 8.
- The rest are local, non-server texts (`notice.message`, `problem.message` from a marketplace status read,
  `testResult.message`) - each checked by hand, most stay.

## 4. Design

### 4.1 Replacement rules (one per shape)

| Today | After |
|---|---|
| `{mutation.error.message}` / `message={query.error.message}` | `describeApiError(mutation.error, '<ns>')` |
| `error instanceof Error ? error.message : copy.fallback` | `describeApiError(error, '<ns>')` (never blank, so the fallback key goes) |
| `(error as Error).message` in a toast | `describeApiError(error, '<ns>')` |
| `interpolate(copy.loadError, { message: query.error.message })` | the sentence from `describeApiError`; the `{message}` template key is deleted or loses the placeholder |
| `serverErrorText(copy.serverSaid, error.message, copy.fallback)` (orders, listings) | `describeApiError(error, '<ns>')`; both helpers and their `serverSaid` keys deleted once unused |
| `readServerReason(error, fallback)` (orders cancel) | `describeApiError(error, 'orders')`; helper deleted |
| A text a screen must word more specifically | a key under `<namespace>.apiErrors.<CODE>` in EN and PL, read through the namespace argument |
| Stored English sentence (#3866 fields) | unchanged raw text under the translated label `ui.errors.technicalDetails` |

The namespace argument is the feature's own namespace (`'orders'`, `'connections'`, a plugin id) so a feature can
override a shared code's copy without code changes. `describeApiError` already tolerates a namespace with no
`apiErrors` section. Plugin namespaces are registered by `definePluginMessages(id, ...)`; `featureCopyFor` resolves
them through the same registry - verified in step 1.

### 4.2 Keys

- New copy only where a screen needs it (`apiErrors.<CODE>`), always EN + PL in the same edit, Polish written by
  hand per `docs/i18n-glossary.md`, keys sorted.
- Keys left unread by a replacement (`serverSaid`, `errorFallback`, `loadError` with `{message}`, …) are deleted in
  the same commit (CLAUDE.md: delete a key the moment nothing reads it). `check-locales` reports leftovers as
  unused-key warnings; the count must not grow.

### 4.3 Guard against regressions

ESLint `no-restricted-syntax` in the web override, scoped to `features/**`, `pages/**`, `plugins/**`, `app/**`:

- `MemberExpression[property.name='message'][object.property.name='error']` - `x.error.message`
  (query / mutation errors), excluding `fieldState.error.message`;
- `MemberExpression[property.name='message'][object.name=/^(error|err|cause|apiError|saveError|dataError|optionsError|mutationError)$/]`
  - a caught error's message.

Message: "Render an API error with describeApiError (ADR-081, #3867), never error.message." A legitimate non-render
use (logging, a `details` object) carries an `eslint-disable-next-line` with its reason, per CLAUDE.md. A grep-based
`check:invariants` script was the alternative; ESLint is chosen because it points at the line in the editor and the
selectors are exact, where a grep would need its own allow-list.

## 5. Steps (one commit per area, so the PR reads in slices)

1. **Probe** - `describeApiError` with a plugin namespace (`'ksef'`) and a missing `apiErrors` section; add a unit
   test to `describe-api-error.test.ts` if either path is untested. Add `ui.errors.technicalDetails` (EN + PL).
2. **Connections** (40) - setup forms, actions panel, capabilities panel, archive / restore / enable buttons,
   pricing-and-sync, seller defaults. Connection-test `testResult.message` stays (#3866), labelled.
3. **Listings** (25) - incl. deleting `features/listings/lib/server-error-text.ts`.
4. **Orders** (18) - incl. `serverErrorText`, `readServerReason` and their keys.
5. **Analytics, insights, sales documents, invoicing pages** (~35).
6. **Returns, inventory, shipments, fulfillment, bench, OMS** (~30).
7. **Products, customers, mappings, content, price changes, automation, prompt templates** (~40).
8. **Settings: auth, users, mailer, PostHog, AI providers, MCP tokens, currency, sync jobs, layouts** (~35).
9. **Plugins**: ksef, infakt, eparagony, subiekt, allegro, woocommerce, dpd (~35) - plugin namespace argument.
10. **Guard** - the ESLint rule; fix whatever it still finds; document the rule in `docs/frontend-architecture.md`
    § Internationalization and in `CLAUDE.md` § User-facing copy (one line).

Each step: update the tests that asserted the old raw text (they assert the code's copy, read from the locale
file, never a hardcoded string), run ESLint + `check-locales` + `check-api-error-code-mirror` on the area.

## 6. Tests

- Component tests that rendered a server message now build an `ApiError` with a `code` and assert
  `getMessages('errors').codes.<CODE>` (or the feature's `apiErrors` copy); one per area keeps an un-coded error
  and asserts the status-family copy.
- No new unit logic beyond step 1; the resolver itself is tested in #3862.

## 7. Risks

- **Lost detail.** Some raw messages carried useful specifics an un-coded endpoint now hides behind a status-family
  sentence. Mitigation: every backend endpoint is coded by #3864/#3865; where a code's copy needs a param the
  backend already sends it. Anything still generic after this is a backend code gap, listed in the PR.
- **Size.** ~200 files. One commit per area keeps review tractable; the guard lands last so it cannot fail the
  intermediate commits.
- **Plugin namespaces** may not be registered when `describeApiError` runs before the plugin loads - it falls back
  to the shared copy, never throws (`featureCopyFor` catches).
