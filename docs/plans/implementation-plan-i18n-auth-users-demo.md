# Implementation Plan: i18n extraction 2/18 - auth, users and demo (#3869)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `pages/auth`, `features/auth`,
`features/users`, `pages/users` and `features/demo` into `locales/en/<namespace>.json` (ADR-081 as amended by #3920; namespaces `auth`,
`users`, `demo`), read it with `useMessages` / `getMessages`, and switch the no-literal-text lint
on for those folders. English only; Polish lands with batch A (#3886).

**Layer.** Frontend (`apps/web`). Stacked on #3868 (branch `3868-i18n-shell-navigation`, PR #3920),
whose `app` namespace, `ui.demo` / `ui.apiError` keys and lint scope this builds on.

**Non-goals.**
- Polish text - #3886.
- `backend-msg` rows (`error.message` from the API in toasts / error states) - error-code track (#3862/#3867).
- `features/posthog-settings` copy around the demo events (headings, group labels) - #3882; only the
  event descriptions move, because they live in `features/demo`.

## 2. Findings (branch 3868 @ 2fc4fb2ab)

- Inventory: 233 rows / 21 files. Since then: `ChangePasswordForm.tsx` + `change-password-form.schema.ts`
  (auth) and `create-user-conflict.ts` (users) were added - in scope too.
- No `*.copy.ts` in these folders; all copy is inline.
- Raw enum values rendered to operators: user role (`admin`, `operator`, `viewer`, `packer`) in selects
  and the "Role changed to {role}" toast; user status in the users table -> label maps.
- Dates in the users table ("Requested", "Member since") -> `useFormat().date`.
- Zod schemas (`*-form.schema.ts`) hold validation messages at module level -> must read copy at
  validation time (schema factory taking the copy, or `getMessages` inside the refinement).
- `DemoEventCatalog.description` (37 strings) is rendered by `features/posthog-settings`; a feature may
  not read another feature's namespace, so `features/demo` exports a hook returning the descriptions.
- 17 em dashes in this copy -> plain hyphens.

## 3. Design

| Namespace | Holds |
|---|---|
| `auth` | login, register page shell, forgot / reset / change password, confirm email, the auth form schemas |
| `users` | users page (tabs, columns, toasts, dialogs, empty / error states), register form, pack-station dialog, role + status labels, create-user conflict field reader (no copy of its own) |
| `demo` | consent gate, session-recording bullets, marketing footnote, `events.<eventName>` descriptions |

- **Shared phrases** within a namespace use one key ("Try again", "Back to sign in").
- **Role / status labels**: `users.roles.<role>`, `users.statuses.<status>` read through one helper
  (`userRoleLabel(role, copy)`), unknown values fall back to the raw value.
- **Zod schemas**: each `*.schema.ts` exports `create<X>Schema(copy)` taking the namespace slice; the
  form builds it with `useMemo([copy])`. The copy types live in `auth-form.types.ts` /
  `users-form.types.ts`, so the schemas do not import one another. A module-level schema would freeze the first language.
- **Demo events**: the catalog drops `description`; descriptions live in `demo.events.<eventName>`
  (the event name is the key - a stable identifier, the one place keys are not camelCase). `features/demo`
  exports `useDemoEventDescriptions()`; `product-events-section.tsx` uses it instead of `entry.description`.
- **Plurals / dates**: no count in this area needs a plural; `useFormat` for dates.
- **Budgets** in `limits.json` for buttons, tabs and table headers.
- **Lint**: `no-literal-string` scope += the five folders; `EXPECTED_SCOPE` updated.

## 4. Steps

1. `locales/en/{auth,users,demo}.json` (sorted, no em dash, British spelling); `limits.json`.
2. `features/auth`: forms + schemas (+ ChangePasswordForm); `pages/auth`: page shells.
3. `features/users`: register form + schema, pack-station dialog + schema, role/status labels (`create-user-conflict.ts` reads the conflicting field only, no copy).
4. `pages/users/users-page.tsx`: columns, selects, toasts, tabs, dialogs, empty/error states, dates.
5. `features/demo`: consent gate, bullets, footnote, events -> `demo.events`, `useDemoEventDescriptions`;
   update `features/posthog-settings/components/product-events-section.tsx`.
6. Tests that assert copy keep passing (English pinned); new tests: role/status label helper, a schema
   factory's message, the demo descriptions hook covers every catalog event.
7. Lint scope + `EXPECTED_SCOPE`; quality gate (tsc, ESLint changed files, `check:invariants`, `i18n:sort`).
8. Pseudo-locale check of login, users page and consent gate.

## 5. Risks

- Schema factories change how forms build their resolver - every form test must still pass.
- `product-events-section.tsx` belongs to #3882's area; the change there is one line (the description source).
