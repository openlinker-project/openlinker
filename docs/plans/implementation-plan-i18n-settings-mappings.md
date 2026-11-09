# Implementation Plan: i18n extraction 14/18 - settings, mappings and diagnostics (#3881)

## 1. Task understanding

**Goal.** Move every operator-visible English string in `features/settings`, `features/mappings`,
`features/sync-jobs`, `features/webhook-deliveries`, `features/cursors` and their pages into the
`settings`, `mappings`, `sync-jobs`, `webhook-deliveries`, `cursors` and `dev-ui` namespaces
(`locales/en/<namespace>.json`, ADR-081 as amended), delete the copy module, and switch the
no-literal-text lint on. English only.

**Layer.** Frontend. Base: `3880-i18n-analytics` @ a0a8186c0.

**Non-goals.** Polish; server `error.message`; making `pages/dev-ui` lint-clean (the issue excludes it -
only its 4 operator rows move).

## 2. Findings

- Area: ~90 non-test files, ~12,700 lines (settings 2.5k, mappings 4.2k, sync-jobs 1.2k, pages 3.3k,
  dev-ui 1.2k).
- Copy module: `features/mappings/lib/parcel-profile.copy.ts`.
- Scripts `check-job-type-mirror`, `check-job-outcome-reason-mirror` and `check-parcel-profile-bounds-mirror`
  read VALUE arrays (`sync-jobs.types.ts`, `parcel-profile.ts`) - untouched.
- Issue notes: `sync-pacing-changes.ts` builds sentences from fragments -> whole sentences;
  `deletion-audit-cadence.ts` can say "Every 1 minutes" -> plurals; job type codes rendered as text ->
  label map with raw fallback.
- **Gap found:** `pages/settings` also holds the buyer-email pages that `main` added in #3555
  (`buyer-emails-page`, `buyer-email-editor-page`) and the order-tags settings page. No extraction issue
  names them, and switching the lint on for `pages/settings` would fail on them. They move here too: the two
  buyer-email pages and `features/buyer-emails` (incl. `buyer-emails.copy.ts`) into a `buyer-emails`
  namespace, the order-tags page into `settings`.

## 3. Design

| Namespace | Holds |
|---|---|
| `settings` | settings hub, operational settings + sync pacing, sales-documents / who-decides / order-tags settings pages |
| `buyer-emails` | `features/buyer-emails` + the two buyer-email settings pages |
| `mappings` | mapping panels, attribute / routing rules, category tree and search, parcel profile |
| `sync-jobs` | jobs list and detail, trigger dialog, status badge, job type labels |
| `webhook-deliveries` | deliveries list and detail |
| `cursors` | cursors list |
| `dev-ui` | the 4 operator rows only |

Lint scope += features/settings, features/mappings, features/sync-jobs, features/webhook-deliveries,
features/cursors, features/buyer-emails, pages/settings, pages/sync-jobs, pages/webhook-deliveries,
pages/cursors (only folders with .tsx files).

## 4. Steps (2 agents, no tsc, ESLint once each)

1. Agent A: settings + buyer-emails (features and pages).
2. Agent B: mappings, sync-jobs, webhook-deliveries, cursors (features and pages) + dev-ui rows.
3. Me: limits, key check, one ESLint, `check:invariants`, local commit.
