# ADR-085: Release center is a leaf context with two-scope database state and a catalog of setup steps

- **Status**: Proposed
- **Date**: 2026-11-17
- **Authors**: @norbert-kulus-blockydevs

## Context

After an update an operator is not told what changed or which settings now need a decision. Two real cases: `config.shipping.notifyMarketplaceOnLabelPurchase` could not be set in the UI at all, and who generates shipping labels per delivery method is visible only on the Mappings page. The topbar "Alerts" button is a static placeholder with no feed, and the settings screens each lay themselves out differently.

The feature needs three kinds of state that have different owners:

- what this user has already seen (a version cursor),
- what this user did with an item (archived, snoozed, deleted),
- what the whole installation has decided (a step is done, or "not applicable").

None of it belongs in `users` (identity), `operational-settings` (system knobs) or browser storage (it must follow the user across devices, and the demo and viewer roles must behave the same).

## Decision

1. **A `release-center` leaf context** (`libs/core/src/release-center`, `@openlinker/core/release-center`, not in the root barrel). It imports no sibling core context and is registered in `ZERO_SIBLING_EDGE_LEAVES` with an empty allow-set, the `sales-documents` / `fulfillment-authority` posture. The user id arrives as an argument from the token.
2. **Two tables, two scopes.** `user_release_state` holds one row per user: the version cursor, and `skipDialog`. `release_item_states` holds item state with `scope` `installation | user`; a user-scope row carries `userId`, an installation row does not. Uniqueness is two partial unique indexes (one per scope), a CHECK ties `scope = 'user'` to `userId IS NOT NULL`, `doneVia` is a closed list, and foreign keys exist in the migration only (`userId` CASCADE, `actedByUserId` SET NULL). No Postgres enums. Per-user rows are capped at 500 (oldest `deleted` rows are evicted first, else 422); the installation scope has a ceiling of 2000 and rejects an unknown connection id.
3. **The cursor is text plus four numbers.** `lastSeenVersion` is the display value; `major/minor/patch/rank` carry the comparison, with the prerelease encoded in `rank` (final 3 000 000, `rc.N` 2 000 000 + N, `beta.N` 1 000 000 + N, `alpha.N` N) so a row-comparison `WHERE` can refuse a regression atomically. A rejected write returns the current state, not an error.
4. **Steps are a catalog in code, text is in locale files.** Each step declares `id`, `scope`, `introducedIn`, `importance(ctx)`, `appliesWhen(ctx)`, `route`, `target` and `completeOn`. `introducedIn` is written by hand as the next minor and is guarded by `scripts/check-release-center-catalog.mjs` (in `check:invariants` and as a required status on the release-please PR). A step whose `introducedIn` is greater than `APP_VERSION` is hidden at runtime. Importance is computed from data, never stored.
5. **The dialog opens only on a minor or major increase**, never empty and never on a patch (a patch's new steps go to the bell). An empty cursor is set to `APP_VERSION` and opens nothing.
6. **Completion is observed, not wired in.** `useUpdateConnectionMutation` gains a stable `mutationKey`; the release center watches the `MutationCache` by key and runs the step's predicate against the value before the save. `features/connections` does not import the release center.
7. **The changelog is English and comes from release-please.** A Vite plugin reads `CHANGELOG.md` in `buildStart`, skipped under vitest, with the hand-written `0.1.0` entry recognised as a baseline. The dialog shows up to four curated highlights; the rest is the full changelog.
8. **Roles.** Everyone with read access reads state; only an admin completes installation steps; a packer has no access; user-scope writes (archive, snooze, cursor) are open to admin, operator and viewer. A viewer seeing write controls disabled with a reason (the read-only banner, "Needs an administrator") is a registered exception to the hide-write-affordance rule in `docs/frontend-architecture.md`.
9. **A kill switch with three rungs.** `operational_settings` gets a nullable boolean; resolution is setting, then `OL_RELEASE_CENTER_ENABLED`, then default on, reported with its `source`. When off, `GET /release-state` answers `{enabled:false}` without touching the tables and the frontend renders no dialog, bell or tour; the history page stays and state survives re-enable. The leaf does not import `operational-settings`; the API layer composes `enabled`.
10. **Product boundary.** A step is a pointer to an existing screen, never a second editor. Carrier assignment stays in the Mappings panel; the release center links to it and never suggests or auto-assigns a carrier.

## Alternatives considered

- **Browser storage for state.** Rejected: per-device, lost on clearing, invisible to other admins, and it cannot carry an installation decision.
- **Put it in `users` or `operational-settings`.** Rejected: neither owns per-item state, and `operational-settings` is numeric and system-wide.
- **One table with a nullable `userId` and a single unique index.** Rejected: Postgres treats NULLs as distinct, so the installation uniqueness would not hold; two partial indexes and two `ON CONFLICT` statements are explicit.
- **Derive `introducedIn` from `package.json` automatically.** Rejected: release-please picks the version after the code is written, so the step would be wrong exactly when it matters; a manual value plus a release check fails loudly instead.
- **Parse changelog entry order for the highlights.** Rejected: release-please sorts entries alphabetically by scope, so order carries no meaning; the highlights are a curated list.
- **Wire step completion inside each form.** Rejected: it couples every settings feature to the release center. Observing a keyed mutation keeps the dependency one-way.

## Consequences

**Pros:**
- State is shared across devices and survives clearing a browser; demo, viewer and packer behaviour is defined in one place.
- A new setup step is one catalog entry plus two locale keys, checked by CI.
- The leaf property keeps the context cycle-safe.

**Cons / trade-offs:**
- Two new tables and a migration, plus a column on `operational_settings`.
- `introducedIn` is a manual value; the check catches a wrong guess only at release time.
- Observation covers only writers that use a keyed hook; other writers (e.g. buyer e-mail settings) are not observed and their steps are completed manually.

**Migration path:**
- One migration adds both tables, the indexes, the CHECKs and the `operational_settings` column; `down()` drops them. Existing installs start with an empty cursor, so nothing opens on the first load.

## Amendment: message notifications (#4244)

The bell now also lists plain message notifications (an expiring token, a finished import, a failed sync) that a feature publishes with `publishNotification` or that an action creates through `registerNotificationRule`. They are not release state: there is no server-side source for them, and nothing in the database records their title or body.

- **The one exception to "no browser storage".** The content of a message is kept per signed-in user in this browser (`localStorage`, key `ol:notifications:v1:<user id>`), so it never shows for another account that signs in on the same machine. The exception is confined to `lib/notification-store.ts` (an ESLint override names that single file); the rest of the release center still may not touch browser storage.
- **What stays in the database.** Whether a message was read, archived or deleted is the caller's own release-state user row (`msg-<dedupe key>`), exactly like a release card, so that part follows the user across devices and the demo and viewer roles behave the same.
- **Consequences.** A message exists only on the device that published it, so a feature publishes a condition again on each load (the dedupe key makes that a no-op); a one-off event is lost if it was never opened on that device; title and body are stored as published and are not re-translated. A server-side `notifications` table (per-user targeting, jobs as writers, polling) is a separate, larger task and would replace the local store.
- **A notification action points at a real route.** `pnpm check:release-center-catalog` validates every `to: '/...'` literal in a file that publishes a notification or registers a rule against the router.

## References

- Related issues: epic #4131, #4140, #4141, #4142, #4143, #4145, #4146
- Related ADRs: [ADR-053](./053-fulfillment-authority-vocabulary-leaf.md) (leaf posture), [ADR-069](./069-operator-settable-sweep-pacing.md), [ADR-071](./071-pack-station-principal.md), [ADR-081](./081-frontend-owned-ui-translation.md)
- Primary doc sections: [docs/architecture-overview.md](../../architecture-overview.md), [docs/frontend-architecture.md](../../frontend-architecture.md)
- Mockup: [release-center.html](../../plans/mockups/release-center.html)
