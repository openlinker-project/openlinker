# Pre-Implementation Analysis: Frontend Viewer Events (Batch 3) — #1790

**Verdict**: NEEDS-REVISION (one contract-breaking assumption; everything else is either confirmed or a trivial line-number drift resolvable at edit time)

---

## Reuse Findings

Pure frontend instrumentation task — no ports/services/tokens/ORM entities in play. Reuse audit instead targets the plan's factual claims about existing code state.

| Plan artifact | Status | Note |
|---|---|---|
| 7 new `DemoEventCatalog` keys | NEW (confirmed absent) | No collision with the 14 existing keys in `demo-events.ts` |
| `conversion-intent` group reuse | EXISTS | `demo-events.ts` — used by existing `demo_offer_create_attempted` etc. |
| `ai-descriptions` / `opensource` / `baseline` groups | NEW | Only `conversion-intent` and `ecommerce-reel` exist today; plan's claim of prior per-reel groups from "settings-panel/batch 1/batch 2" is inaccurate — those batches reused the same 2 groups. Adding 3 new groups is still safe (auto-derived by `product-events-section.tsx`, confirmed no hardcoded list). |
| Buffer-and-replay in `init-demo-integrations.ts` | NEW, structurally accurate | Current file has 2 early-return branches (missing key, consent not accepted) + 1 success path — plan's try/finally sketch must wrap all 3. |
| `captureDemoEvent` import in `app-shell.tsx` | PARTIAL — plan's claim is wrong | File imports `disableDemoAnalytics`, `getDemoAnalyticsConsent`, `initDemoIntegrations`, `setDemoAnalyticsConsent`, `DemoAnalyticsConsent` from `../features/demo`, but **not** `captureDemoEvent`. Must be added to the same import line. |

---

## Backward-Compatibility Findings

### Critical
- **`response.user.role` does not exist.** `LoginResponse` (`features/auth/api/auth.types.ts:14-16`) is `{ access_token: string }` only. The plan's Phase 4 step 2 code (`captureDemoEvent('demo_login_succeeded', { role: response.user.role })`) will not compile.
  - **Fix**: read the role from session state after `await refreshSession()` — the established pattern is `session.user?.role` (already used at `command-palette-provider.tsx:162`). `use-login.ts` needs access to the session object (via `useSession()`, already imported) after refresh, e.g. `const session = useSession(); ... await refreshSession(); captureDemoEvent('demo_login_succeeded', { role: session.user?.role ?? 'unknown' })` — exact shape to be confirmed by reading `useSession()`'s return type at implementation time (does `refreshSession()` update `session` synchronously in the same closure, or does the hook need a re-render?). This is a real design question, not just a typo — flag for implementer to resolve before writing the call site.

### Warnings
- Line numbers throughout the plan (suggestion-dialog.tsx ~136-142 vs actual 136-143 close; app-shell.tsx WorkspaceFooter ~325-330/350-355 vs actual 327/352) are all minor drift, non-blocking — plan already tells the implementer to re-read files at edit time.
- Command-palette recents: confirmed that a recent-click's `entry.id` still carries its *original* source prefix (not `recent:`) when it reaches `handleSelect` — this matches the plan's own chosen default (prefix-derived `source`, richer signal over a flat `'recent'` bucket), so no plan change needed, just confirms the assumption in §5 is accurate to current code.
- `demo_analytics_disabled`'s empty-props shape must be added to the existing `NO_PROPS_EVENTS` set in `demo-events.test.ts` (structural test, not exhaustive-list) — small addition the plan didn't explicitly call out but is required for that test file's existing convention.
- `use-login.test.ts` does not exist yet — plan already anticipates this ("if no test file exists yet... create one").

---

## Open Questions

1. Exact mechanics of `useSession()` / `refreshSession()` — does the hook's returned `session` reflect the just-refreshed value synchronously inside the same `mutationFn`, or is a fetch-then-read needed (e.g. `refreshSession()` returning the fresh session directly)? Implementer must read `shared/auth/use-session.ts` before writing Phase 4 step 2.
2. All other open questions from the plan itself (§5) stand unchanged — GitHub URL, GitHub-link demo-gating scope.

---

## Summary

The plan is executable with one required correction: `demo_login_succeeded`'s `role` prop cannot come from the login mutation's response (no `user` field on `LoginResponse`) and must instead be sourced from session state after `refreshSession()` resolves, following the `session.user?.role` pattern already used in `command-palette-provider.tsx`. Every other artifact in the plan is either confirmed accurate or only trivially stale on line numbers (which the plan already instructs the implementer to re-verify at edit time). No reuse collisions, no cross-context contract breaks, and the settings-panel's auto-group-derivation confirmed safe for the 3 new event groups. Proceed with implementation, adjusting Phase 4 step 2 per the fix above.
