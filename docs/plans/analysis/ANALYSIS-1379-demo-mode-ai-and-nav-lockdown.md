# Pre-Implement Analysis: #1379 — Demo-mode lockdown (AI controls + Users nav)

**Date**: 2026-07-07
**Plan**: `docs/plans/implementation-plan-1379-demo-mode-ai-and-nav-lockdown.md`
**Gate**: read-only readiness check (no code written, plan unchanged)

---

## Verdict: **NEEDS-REVISION** (minor)

No contract breaks, no reuse collisions, no schema/migration impact. But the plan carries **two assumptions that are false or unaddressed against the live tree** and are cheap to fix now, expensive to discover mid-implementation:

1. **`TooltipProvider` is NOT mounted at the app root** (plan A4 assumes it is). Radix `Tooltip.Root` throws at runtime without a `Tooltip.Provider` ancestor — every new demo tooltip (SuggestionDialog, bulk checkbox) would crash until a provider is mounted.
2. **The ⌘K command palette bypasses the whole lockdown** — it iterates `BASE_NAV_GROUPS` directly (not `buildNavGroups`), so in demo mode a user can still jump to `/users`, `/ai/prompt-templates`, etc. The plan's nav work doesn't touch it. Either cover it or explicitly scope it out.

Fix those two in the plan and it's implementation-ready. Everything else checks out.

---

## Reuse findings (does it already exist?)

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `useDemoMode()` hook | **NEW (absent)** — safe to create | No `useDemoMode` anywhere in `apps/web/src`; `demoMode` is read inline as `useSystemConfigQuery().data?.demoMode ?? false` at `app-shell.tsx:206`, `LoginPage.tsx:7`, `RegisterPage.tsx:16`. Adding a shared hook is a genuine DRY improvement, not a duplicate. |
| `useSystemConfigQuery` + `SystemConfig.demoMode` | **EXISTS → reuse** | `features/system/index.ts` exports both; `system.types.ts` — `interface SystemConfig { demoMode: boolean }`. |
| Copy constants (`AI_GENERATION_DEMO_DISABLED_MESSAGE`, `NAV_DEMO_RESTRICTED_MESSAGE`) | **NEW (absent)** | No demo-copy constants exist; the only demo copy is inline in `shared/ui/demo-banner.tsx`. |
| `shared/lib/demo-mode.ts` location | **PARTIAL — dir does not exist** | There is **no `apps/web/src/shared/lib/`**. Existing `shared/` subdirs: `api, auth, config, format, hooks, i18n, plugins, theme, types, ui`. **Recommendation**: put the constants in the existing `shared/config/` (or `shared/format/`) rather than inventing a new `shared/lib/` convention. Not blocking, but avoids a one-off directory. |
| `RestrictedNavGroup` / `kind: 'restricted'` | **NEW (absent)** | `nav-registry.types.ts:60` — `NavGroup = LiveNavGroup \| PlannedNavGroup` (two members only). No `restricted` concept. |
| `buildNavGroups({ isAdmin, demoMode })` | **PARTIAL — signature change** | Today `{ isAdmin }` (`nav-registry.ts:85-97`). Single runtime caller: `app-shell.tsx:219`. Low-risk. |
| `SuggestionDialog` demo gate (`disabled?: boolean`) | **EXISTS → extend** | Prop already optional (`suggestion-dialog.tsx:34`, default `false`). Internal OR-gate composes cleanly with all 5 call sites. |
| Cross-feature barrel import (`content`/`listings` → `system`) | **EXISTS as a pattern** | Nothing imports `../../system` yet, but `../../<feature>` barrel imports are the sanctioned norm (`content-panel.tsx:26 → ../../allegro`; `EditOfferDrawer.tsx:24 → ../../content`). No new precedent needed. |

**No reuse collision.** Every "new" artifact is genuinely absent; the two "extend" items reuse existing seams correctly.

---

## Backward-compatibility findings

### Contract surfaces — all clear (no Critical)

| Surface | Result |
|---|---|
| Top-level core barrels (`@openlinker/core/<ctx>`) | ✅ Untouched — this is `apps/web` only. |
| Port method signatures | ✅ None touched. |
| DTO shapes | ✅ `BulkSharedConfig.generateDescription?: boolean` (`bulk-listings.types.ts:61`) is read, not changed. |
| Symbol tokens (`*.tokens.ts`) | ✅ None. |
| ORM schema / migration | ✅ None — no entity touched, no migration (`docs/migrations.md` N/A). |
| `check:invariants` (cross-context imports, service-interfaces, deep-barrel) | ✅ FE-only; core invariant scripts don't scan `apps/web`. FE dependency-rule ESLint (`shared` ⇏ `features`; barrel-only cross-feature) is respected: hook lives in `features/system`, constants in `shared/`, cross-feature imports via barrels. |

### Warnings (address before/at implementation)

**W1 — `TooltipProvider` not at root (plan A4 is wrong).** `TooltipProvider` (`shared/ui/tooltip.tsx`) is rendered in exactly one place: `features/ai-provider-settings/components/ai-provider-table.tsx:130`. It is **not** in `apps/web/src/app/**`. Radix requires a `Tooltip.Provider` ancestor for any `Tooltip.Root`; without it the demo tooltips throw. *Migration path*: mount `<TooltipProvider>` once at the app root (alongside `ToastProvider` / `PluginRegistryProvider`) as part of this work, and drop A4's "verified indirectly" claim. Cheap, low-risk, and benefits any future tooltip.

**W2 — ⌘K command palette bypasses the lockdown (coverage gap, not a break).** `command-palette-provider.tsx:166-167` iterates `BASE_NAV_GROUPS` directly and `continue`s on non-`live` — it never sees `buildNavGroups`'s demo transform. In demo mode it will still list and navigate to `/users`, `/ai/*`. The plan's inventory implies "every place the admin areas are reachable" but only covers the sidebar. *Options*: (a) add a demo filter in the command-palette source, or (b) explicitly scope ⌘K out in the plan (consistent with "route guards are out of scope" — the routes are still 403-gated server-side). Pick one; don't leave it silent.

**W3 — new `restricted` union member relies on non-exhaustive `.kind` branches (silent fallthrough).** No `switch (group.kind)` with a `never` check exists, so adding `RestrictedNavGroup` compiles everywhere — but two spots behave by fallthrough:
- `app-shell.tsx:90-101` `SidebarNav` else-branch renders `title={item.reason}`. `RestrictedNavGroup` items carry **no per-item `reason`** (plan puts the reason per-group). A restricted group falling into this branch would render `title={undefined}`. → The plan's explicit `kind === 'restricted'` render branch (Step 9) is **mandatory**, not optional; verify it reads `group.reason`, not `item.reason`.
- `merge-nav-contributions.ts:50` passes non-live groups through by reference (restricted survives unchanged — correct, matches intent).
- Also update the inaccurate doc comment on `NavRegistryGroup` (`nav-registry.types.ts:62-66`) and consider whether `NavRegistryGroup` needs the new member (it's authored-source-only; restricted is build-time-produced, so likely not — confirm).

**W4 — tests that pin current nav behavior will need updating (expected, in plan scope).**
- `app-shell.test.tsx:120-138` asserts the disabled "Planned/Automations" span shape (`role="link"`, `aria-disabled`, `title="Coming in a future release"`) — a restricted group using the same disabled-span shape must not collide with these selectors.
- `app-shell.test.tsx:149-166` asserts the **AI group is hidden for non-admin** — under plan assumption A1 (demo locks groups for everyone), the demo-mode case now renders them *restricted* instead of absent; the non-demo case must still assert hidden. Cover both.
- `merge-nav-contributions.test.ts` pins "planned groups preserved untouched" — add a restricted-preservation assertion.
- No `nav-registry.test.ts` exists yet (plan Step §9 creates one — good).

**W5 — test wiring for demo mode via the config query is unprecedented (minor).** No existing test toggles `demoMode` through `getConfig`; all current `demoMode: true` tests pass it as a component prop (auth/register forms). The mock seam exists (`test-utils.tsx:452-455`, default `{ demoMode: false }`), so new tests use `createMockApiClient({ system: { getConfig: vi.fn().mockResolvedValue({ demoMode: true }) } })`. Note: `suggestion-dialog.test.tsx` renders the dialog directly — adding an internal `useSystemConfigQuery` means those tests now need the query/API-client provider (present via `renderWithProviders`); `bulk-edit-modal.test.tsx:35` mocks the dialog as `() => null`, so it's unaffected.

---

## Open questions (carried from the plan, still unresolved)

- **Q1 (from plan §5) — who sees the nav lock in demo mode?** Plan assumes A1 (locked for *everyone*, including a demo-admin). This directly determines the `app-shell.test.tsx:149-166` rewrite and the `buildNavGroups` branch logic. Needs a human decision before implementation, not just an assumption — it changes observable behavior for admins.
- **Q2 — ⌘K scope** (see W2): cover or explicitly exclude.
- **Q3 — does the demo deployment block AI completions server-side?** Plan correctly scopes backend out, but if the server does *not* already reject completions in demo mode, the FE gate is cosmetic and a separate backend issue should be filed. Confirm/file.

---

## Summary

The plan is architecturally sound and collision-free — every new artifact is genuinely absent, the reused seams (`useSystemConfigQuery`, `SuggestionDialog.disabled`, cross-feature barrels) are correct, and there are **no contract, token, DTO, port, or schema breaks**. It needs a **minor revision** on two concrete points the live tree contradicts: (1) `TooltipProvider` must be mounted at the app root (it isn't today — the plan assumes it is), and (2) the ⌘K command palette reads `BASE_NAV_GROUPS` directly and will still navigate to the "locked" admin routes in demo mode, so it must be covered or explicitly scoped out. Also lock down Q1 (do demo-admins lose nav access?) since it drives both the builder logic and the app-shell test rewrite, and drop the `shared/lib/` directory in favor of the existing `shared/config/`. With those addressed, this is ready for `/work`.
