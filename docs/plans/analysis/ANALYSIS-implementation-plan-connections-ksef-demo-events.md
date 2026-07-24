# Pre-Implementation Analysis: Connections/Import, Category Mapping & KSeF Numbering Demo Events (#1789)

**Plan**: `docs/plans/implementation-plan-connections-ksef-demo-events.md`
**Date**: 2026-07-24
**Verdict**: ✅ **READY** (resolved — see Update below)

---

## Update — resolved by rebasing onto `1788-ecommerce-reel-events`

The user chose to branch `1789-connections-ksef-demo-events` from `origin/1788-ecommerce-reel-events` instead of `origin/main` (option 2 of the three presented). After `git reset --hard origin/1788-ecommerce-reel-events`, all previously-missing artifacts are confirmed present:

```
$ grep -n "captureDemoEvent" apps/web/src/features/demo/index.ts
2:  captureDemoEvent,

$ grep -n "onLockedClick" apps/web/src/shared/ui/read-only-lock.tsx
29:  onLockedClick?: () => void;
36:  onLockedClick,
46:        <span className="read-only-lock" tabIndex={0} onClick={onLockedClick}>

$ ls apps/web/src/features/demo/lib/demo-events.ts
apps/web/src/features/demo/lib/demo-events.ts
```

`pnpm install` re-run clean against this base. The original findings below are kept for the record (they were accurate against `origin/main` at the time) but no longer block implementation — the branch now has everything the plan assumes. Note for the eventual PR: it will target `main` as its base only once `1788-ecommerce-reel-events` merges; until then this branch's diff will show #1788's commits too when compared against `main` (expected, not a defect — this is the standard stacked-branch situation, not a new pattern).

---

## Critical finding: the plan's entire foundation is not on `origin/main`

The plan (correctly) states it depends on the demo-events catalog + `captureDemoEvent` helper (#1786) and reuses the exact wiring pattern from #1788. Both were verified to exist during plan-writing — but that verification was done **inside the `1788-ecommerce-reel-events` worktree**, on an unmerged feature branch. This worktree (`1789-connections-ksef-demo-events`) was correctly created fresh from `origin/main` per the `/work` Phase 2 procedure — and on `origin/main`, none of it exists:

```
$ git log --oneline -1                  # this worktree, reset to origin/main
328a17d4 fix(web/orders): surface ShipX per-field validation details...

$ git log --oneline --all --grep="1788"
3431d8ea Merge remote-tracking branch 'origin/1786-demo-events-framework' into 1788-ecommerce-reel-events
1ecdb6e7 test(demo): cover captureDemoEvent instrumentation across ecommerce-reel wizards
d9944a1e feat(demo): wire ecommerce reel PostHog events (#1788)
e17d93b8 feat(demo): add typed demo-events catalog + gated captureDemoEvent helper
```

None of these commits are reachable from `origin/main`. Concretely, on this fresh worktree:

| Plan artifact | Assumed state | Actual state on `origin/main` |
|---|---|---|
| `captureDemoEvent` | exists, importable from `features/demo` | **does not exist** — `features/demo/index.ts` only exports `disableDemoAnalytics`, `initDemoIntegrations`, `getDemoAnalyticsConsent`, `setDemoAnalyticsConsent` |
| `DemoEventCatalog` / `DemoEventGroup` / `deriveEventGroups` | exists, drives the `/settings` Product-events panel | **does not exist** — `features/demo/lib/` has only `demo-analytics-consent.ts` and `init-demo-integrations.ts` (pre-#1786 shape) |
| `ReadOnlyLock.onLockedClick` prop | already wired on `create-connection-form.tsx`, `ConnectionActionsPanel.tsx`, `ksef-numbering-editor.tsx` | `read-only-lock.tsx` exists, but the `onLockedClick` prop was added in the #1788 branch — **not confirmed present on main** (needs re-check once #1788 lands; likely absent) |
| `posthog_settings.product_events_enabled` / `enabled_event_groups` columns | exist server-side | **do not exist** — that migration (`1829000000000-add-posthog-product-events-settings.ts`) lives only on the unmerged branch |

The 11 target component files themselves **do** all exist on `origin/main` (verified — see table below), so the *call sites* the plan cites are real and current. The gap is purely the shared instrumentation infrastructure the plan builds on top of.

---

## Reuse audit

| Plan artifact | Classification | Evidence |
|---|---|---|
| `captureDemoEvent` helper | **MISSING ON MAIN** (exists only on unmerged `1788-ecommerce-reel-events`) | `apps/web/src/features/demo/index.ts` (this worktree) |
| `DemoEventCatalog` + 3 new groups | **MISSING ON MAIN** — no catalog file exists yet | `apps/web/src/features/demo/lib/` (this worktree) — file `demo-events.ts` absent |
| `ReadOnlyLock` component itself | EXISTS | `apps/web/src/shared/ui/read-only-lock.tsx` |
| `ReadOnlyLock.onLockedClick` prop | **LIKELY MISSING ON MAIN** — needs re-verification once #1788 merges | same file |
| All 11 cited target files (`platform-picker.tsx`, `adapters-catalog-page.tsx`, `connections-list-page.tsx`, `prestashop-setup-form.tsx` + 6 siblings, `create-connection-form.tsx`, `ConnectionActionsPanel.tsx`, `connection-category-mappings-page.tsx`, `MappingPanel.tsx`, 3 KSeF files) | EXISTS on main, unchanged from what the plan describes | confirmed present via `ls` in this worktree |
| `bucketResultCount`-style bucketing precedent (`products-list-page.tsx`) | Present on main independent of #1786-1788 (pre-existing #1788-adjacent feature) — **needs re-check**: this helper itself was added in #1788, so it too is likely absent on main | not yet re-verified; flag alongside the others |

## Backward-compatibility findings

Not applicable in the usual sense (no existing contract is being *changed*) — the issue here is a **missing prerequisite**, not a broken one. No Critical/Warning contract-break items apply because there is nothing on `main` yet to break.

## Open questions (blocking)

1. **Is #1788 (and its #1786 dependency) expected to merge to `main` before #1789 starts?** The issue's own "Dependencies" section says yes. If so, this worktree should not proceed with implementation until that merge lands — starting now means either re-doing the framework work here (duplicate, will conflict on merge) or branching from the wrong base.
2. **If #1788 must land first, should this session:**
   - (a) wait / stop and let the user land #1788 first, then re-run `/work` for #1789 from a clean `origin/main`, or
   - (b) rebase this `1789-*` branch onto the `1788-ecommerce-reel-events` branch instead of `main` (non-standard base, but unblocks work now — would need to be re-based onto `main` again after #1788 merges, and the eventual PR for #1789 would need to target `main` only after #1788 is in), or
   - (c) cherry-pick/merge the `1786`/`1788` commits into this branch now as a temporary foundation (duplicates history until #1788 merges, then needs cleanup)?
3. None of these are code-correctness questions — the *plan itself* (call sites, event shapes, catalog entries) is sound and doesn't need rewriting. The blocker is purely sequencing/branch-base, which is a human decision, not something `/pre-implement` should resolve unilaterally.

---

## Recommendation

**Do not proceed with Phase 4 (Implement) against this `origin/main`-based worktree as-is.** This is a sequencing problem, not a plan-quality problem — stop and ask the user which of the three options above (wait / branch-from-1788 / merge-1788-in-now) they want before writing any instrumentation code, since each has different consequences for how the eventual PR gets opened and merged.
