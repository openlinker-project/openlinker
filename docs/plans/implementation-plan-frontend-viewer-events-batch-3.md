# Implementation Plan: Frontend — AI, Open-Source Link, Cross-Cutting Viewer Events (Batch 3)

**Date**: 2026-07-24
**Status**: Draft
**Estimated Effort**: 3-4 hours

---

## 1. Task Summary

**Objective**: Instrument the remaining demo-mode PostHog viewer events for issue [#1790](https://github.com/openlinker-project/openlinker/issues/1790) — the AI-description reel (reel 9), the open-source reel (reel 10, which requires adding a "View on GitHub" link to the shell that doesn't exist yet), and the cross-cutting baseline events (login, command palette, analytics opt-out) that every other funnel is divided by.

**Context**: Part of the broader demo-events framework ([#1785](https://github.com/openlinker-project/openlinker/issues/1785) → [#1786](https://github.com/openlinker-project/openlinker/issues/1786) catalog/helper → [#1787](https://github.com/openlinker-project/openlinker/issues/1787) settings panel → [#1788](https://github.com/openlinker-project/openlinker/issues/1788) e-commerce reel). Batches 1-2 already wired `captureDemoEvent(...)` for the e-commerce reel (products/orders/labels/invoices) and the settings panel. This batch closes out the remaining funnels so marketing has full-session visibility across every demo reel, not just e-commerce.

**Classification**: Frontend / Interface layer (no backend, no CORE/Integration change).

**Related Issues**:

| Issue | Title | Status |
|---|---|---|
| [#1785](https://github.com/openlinker-project/openlinker/issues/1785) | [EPIC] Frontend — PostHog product analytics: demo app + marketing site | Open |
| [#1786](https://github.com/openlinker-project/openlinker/issues/1786) | [TASK] Frontend — typed demo-events catalog + gated `captureDemoEvent` helper | Open |
| [#1787](https://github.com/openlinker-project/openlinker/issues/1787) | [TASK] Frontend — Product-events settings panel with auto-generated groups | Open |
| [#1788](https://github.com/openlinker-project/openlinker/issues/1788) | [TASK] Frontend — instrument full e-commerce reel viewer events (batch 1) | Open |
| [#1789](https://github.com/openlinker-project/openlinker/issues/1789) | [TASK] Frontend — instrument connections, category mapping, KSeF numbering viewer events (batch 2) | Open |
| [#1790](https://github.com/openlinker-project/openlinker/issues/1790) | [TASK] Frontend — instrument AI, open-source link, cross-cutting viewer events (batch 3) — **this plan** | Open |

All statuses fetched live via `gh issue view` at plan-authoring time (2026-07-24). [#1786](https://github.com/openlinker-project/openlinker/issues/1786)-[#1789](https://github.com/openlinker-project/openlinker/issues/1789) show as still **open** on GitHub even though their code has already landed in sibling worktrees/branches (`1786-demo-events-framework`, `1787-demo-events-settings-panel`, `1788-ecommerce-reel-events`, `1789-connections-ksef-demo-events`) — they are presumably pending merge/close via their PRs, not yet actually shipped to `main`. This plan ([#1790](https://github.com/openlinker-project/openlinker/issues/1790)) branches off the tip of the [#1789](https://github.com/openlinker-project/openlinker/issues/1789) branch, so it assumes [#1786](https://github.com/openlinker-project/openlinker/issues/1786)-[#1789](https://github.com/openlinker-project/openlinker/issues/1789)'s code is available even though the issues themselves aren't closed yet.

---

## 2. Scope & Non-Goals

### In Scope
- Add 7 new entries to `DemoEventCatalog` (`features/demo/lib/demo-events.ts`).
- Wire `captureDemoEvent(...)` at 7 call sites across `features/content`, `app/`, `features/auth`, `shared/ui`.
- Add a "View on GitHub" link to the app shell (`app/app-shell.tsx`) — the open-source reel is currently untrackable because no such link exists anywhere in `apps/web/src` (confirmed by the issue's own grep, re-verified below).
- Ensure `demo_login_succeeded` is not silently dropped if it fires before PostHog's async init resolves.
- Unit test coverage for every new call site, mirroring the existing `captureDemoEvent` mocking pattern used in batch 2 (e.g. `products-list-page.test.tsx`).

### Out of Scope
- Any change to the demo-events **catalog schema**, the `captureDemoEvent` helper itself, or the settings panel ([#1787](https://github.com/openlinker-project/openlinker/issues/1787)) — all already shipped and stable.
- Any backend/API change — these are 100% client-side PostHog events, gated by the existing `productEventsEnabled` + per-group `enabledEventGroups` settings.
- Making the GitHub link a permanent (non-demo) shell affordance — it ships gated the same way `DemoBanner` is (`demoMode` check), per the issue's own "Docs impact" note that a permanent affordance is a follow-up if ever decided.
- Any change to `demo_offer_create_attempted`/`demo_invoice_issue_attempted`/etc. (batch 2, already shipped).

### Constraints
- Must not break the `demo_login_succeeded` gate: PostHog initializes asynchronously in `app-shell.tsx` (`initDemoIntegrations`), gated on consent + config load. A login that completes before that resolves must not silently lose its event.
- `captureDemoEvent` props must stay low-cardinality (bounded strings/booleans), matching every existing catalog entry — no free text, no entity IDs (per the module header in `demo-events.ts`).
- No event may fire in a self-hosted (non-demo) build — this is already guaranteed by `captureDemoEvent`'s internal `posthogInstance` guard, which is only ever set when `config.demoMode` is true (see `initDemoIntegrations`), so this constraint requires no *new* guard code at any call site — just confirming no call site is written to bypass it.

---

## 3. Architecture Mapping

**Target Layer**: Frontend — Interface (`apps/web/src`), spanning `features/content`, `features/auth`, `app/`, `shared/ui`.

**Capabilities Involved**: None (no backend port/capability). This is pure FE event instrumentation against the existing `features/demo` public barrel (`captureDemoEvent`, `DemoEventCatalog`).

**Existing Services Reused**:
- `captureDemoEvent<E>(event, props)` — `features/demo/lib/init-demo-integrations.ts` (unchanged).
- `DemoEventCatalog` — `features/demo/lib/demo-events.ts` (extended with 7 new entries, see §6).
- `ReadOnlyLock`'s `onLockedClick` prop — `shared/ui/read-only-lock.tsx` (unchanged; existing precedent used by `demo_offer_create_attempted`, `demo_invoice_issue_attempted`, `demo_label_generate_attempted`-adjacent flows).

**New Components Required**: None. This batch only adds catalog entries + call-site wiring + one new `<a>` link in `app-shell.tsx`.

**Core vs Integration Justification**: N/A — no CORE or Integration involvement. All work is frontend-only, consistent with the demo-events framework's existing shape (a pure client-side PostHog wrapper with a catalog gate).

---

## 4. External / Domain Research

### External System
PostHog JS SDK (`posthog-js`), already integrated via `initDemoIntegrations` / `captureDemoEvent`. No new integration surface — this batch only adds `.capture(eventName, props)` call sites through the existing wrapper.

### Internal Patterns (from codebase research)

**Catalog shape** (`features/demo/lib/demo-events.ts`): each entry has `description` (marketing-facing copy), `group` (drives the settings-panel toggle and must be one of the existing four groups — `conversion-intent`, `ecommerce-reel`, or a new group per reel), and `props` (a placeholder-typed object, never real values).

**Intent-to-convert click pattern** (`bulk-confirm-modal.tsx:151`, `order-invoice-panel.tsx:547`, `WoocommercePublishWizard.tsx:666/886`, `AllegroCreateOfferWizard.tsx:1359`):
```tsx
<ReadOnlyLock
  active={write.demoReadOnly}
  message={DEMO_READ_ONLY_ACTION_MESSAGE}
  onLockedClick={() => captureDemoEvent('demo_x_attempted', { ... })}
>
  <Button disabled>...</Button>
</ReadOnlyLock>
```
`ReadOnlyLock.onLockedClick` fires on click of the disabled-but-wrapped control — the only reachable click signal since a native `disabled` button emits no pointer events. This is the exact shape needed for `demo_ai_suggest_attempted` in `suggestion-dialog.tsx`.

**Direct-fire pattern** (no `ReadOnlyLock` in the chain — `generate-label-form.tsx:344`, `content-editor.tsx` publish confirm): `captureDemoEvent` called directly inside a handler at the point of user intent, unconditionally (the helper itself is the demo-mode gate; call sites never re-check `demoMode`).

**"Fire once" pattern** (`products-list-page.tsx:287-294`): a `useRef` boolean guards a `useEffect` so a page-view event fires once per successful load, not on every refetch.

**Test pattern** (`products-list-page.test.tsx:13-16,136,185-188`):
```tsx
const captureDemoEvent = vi.fn();
vi.mock('../../features/demo', () => ({
  captureDemoEvent: (...args: unknown[]): unknown => captureDemoEvent(...args),
}));
// in beforeEach: captureDemoEvent.mockClear();
// in test: expect(captureDemoEvent).toHaveBeenCalledWith('demo_x', { ... });
```

**Verified absence of a GitHub/source link** (re-confirming the issue's premise):
```
$ grep -rniE "github\.com/openlinker|view on github|open.?source" apps/web/src
(no matches)
```

---

## 5. Questions & Assumptions

### Open Questions
- What is the canonical public GitHub repo URL to link to? Assumed `https://github.com/openlinker-project/openlinker` (matches the `gh` remote used throughout this repo's tooling). **Flag for confirmation before merge** if this isn't the intended public-facing URL (e.g. if there's a separate marketing-facing mirror).
- Should the GitHub link be visible to every authenticated user or gated to `demoMode` only? Assumption below treats it as demo-only for this batch (matches the issue's "Docs impact" framing of it as an open question for a *future* permanent affordance).

### Assumptions
- `demo_login_succeeded`'s `role` prop is the authenticated user's role string (`'admin' | 'operator' | 'viewer'`), read off `response` from `apiClient.auth.login` / the refreshed session — matches the existing session/role shape used elsewhere (e.g. `command-palette-provider.tsx`'s `session.user?.role === 'admin'`).
- The GitHub link's `location` prop values are `'sidebar_footer'` (desktop) and `'mobile_drawer_footer'` (mobile drawer) — the two places `WorkspaceFooter` renders (app-shell.tsx:325-330 and :350-355) — since the plan places the link inside `WorkspaceFooter`, not `SidebarBrand` (see §6.2 rationale).
- `demo_command_palette_opened`'s `trigger` prop is `'keyboard'` | `'click'` — the two ways the palette can open (global ⌘K listener vs. `TopbarSearchTrigger`'s click).
- `demo_command_palette_result_selected`'s `source` prop is derived from the existing `entry.id` prefix (`nav:`, `conn:`, `order:`, `product:`, `job:`, `recent:`) inside `handleSelect`, mapped to `'navigation' | 'connections' | 'orders' | 'products' | 'sync_jobs' | 'recent'` — avoids threading a new parameter through all 6 call sites.
- `demo_ai_suggest_attempted`'s `channel` prop reuses the existing `channelLabel` local (`channel === null ? 'master' : channel`) already computed in `suggestion-dialog.tsx`.
- `demo_content_publish_attempted`'s `channel` prop is `'master'` for the master tab and `channel.platformType` for a channel tab (mirrors the existing `promptChannel` local already passed to `SuggestionDialog` for the channel case in `content-editor.tsx`).
- Login-before-PostHog-init: the simplest correct fix is to make `captureDemoEvent` itself queue-and-replay (a tiny in-module buffer flushed by `initDemoIntegrations` once `posthogInstance` is set), rather than pushing buffering logic into `use-login.ts`. This centralizes the fix in the one module that already owns `posthogInstance` lifeccle, and automatically protects any *other* future event that could theoretically fire in the same narrow race window. Alternative considered in §7.

### Documentation Gaps
None — `docs/frontend-architecture.md` and the demo-events module header in `demo-events.ts` fully cover the conventions needed; no doc update required for this batch (the GitHub link ships demo-gated, so the "Docs impact" note in the issue about a permanent affordance doesn't apply yet).

---

## 6. Proposed Implementation Plan

### Phase 1: Catalog additions

**Goal**: Add all 7 new event definitions to the single source of truth before wiring any call site (matches the existing catalog-first convention — every prior batch added its group's entries in one block).

**Steps**:

1. **Add AI-description reel entries**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**: Add a new `// ── AI descriptions ([#1790](https://github.com/openlinker-project/openlinker/issues/1790)) ──` block with:
     ```ts
     demo_ai_suggest_attempted: {
       description:
         'Viewer clicked "Suggest with AI" — the locked write action — the primary AI-description intent-to-convert signal',
       group: 'conversion-intent',
       props: { channel: '' } as { channel: string },
     },
     demo_content_publish_attempted: {
       description: 'Viewer clicked "Publish" on a content (description) draft',
       group: 'ai-descriptions',
       props: { channel: '' } as { channel: string },
     },
     ```
   - **Acceptance**: `demo_ai_suggest_attempted` uses the existing `conversion-intent` group (consistent with every other `*_attempted` intent-click event in the catalog — `demo_offer_create_attempted`, `demo_label_generate_attempted`, `demo_invoice_issue_attempted`); `demo_content_publish_attempted` gets its own new `ai-descriptions` group since it's reel-scoped, not a locked-action click.

2. **Add open-source reel entry**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**: Add:
     ```ts
     // ── Open source ([#1790](https://github.com/openlinker-project/openlinker/issues/1790)) ──────────────────────────────────────────────
     demo_opensource_link_clicked: {
       description: 'Viewer clicked the "View on GitHub" link in the app shell',
       group: 'opensource',
       props: { location: '' } as { location: string },
     },
     ```
   - **Acceptance**: New `opensource` group (this is the only event in the reel — a single-entry group is consistent with how `ai-descriptions` starts small too; the settings panel already auto-derives its toggle list from whatever groups exist in the catalog, per `product-events-section.tsx`, [#1787](https://github.com/openlinker-project/openlinker/issues/1787) — no settings-panel code change needed).

3. **Add cross-cutting baseline entries**
   - **File**: `apps/web/src/features/demo/lib/demo-events.ts`
   - **Action**: Add:
     ```ts
     // ── Cross-cutting baseline ([#1790](https://github.com/openlinker-project/openlinker/issues/1790)) ───────────────────────────────────
     demo_login_succeeded: {
       description: 'Viewer successfully logged in',
       group: 'baseline',
       props: { role: '' } as { role: string },
     },
     demo_command_palette_opened: {
       description: 'Viewer opened the ⌘K command palette',
       group: 'baseline',
       props: { trigger: '' } as { trigger: 'keyboard' | 'click' },
     },
     demo_command_palette_result_selected: {
       description: 'Viewer selected a result in the command palette',
       group: 'baseline',
       props: { source: '' } as { source: string },
     },
     demo_analytics_disabled: {
       description: 'Viewer opted out of demo analytics via the banner',
       group: 'baseline',
       props: {} as Record<string, never>,
     },
     ```
   - **Acceptance**: All four share a new `baseline` group — matches the issue's own framing ("cross-cutting baseline ... that every other funnel divides by"), giving marketing a single settings-panel toggle for the denominator events.

4. **Update the catalog test**
   - **File**: `apps/web/src/features/demo/lib/demo-events.test.ts`
   - **Action**: Read the existing test file first; if it asserts an exhaustive key list or group enumeration (common for this kind of catalog test), add the 7 new keys / 3 new groups to the expected set. If it's a structural/shape test (e.g. "every entry has description+group+props"), no change needed — it should pass automatically for new entries.
   - **Acceptance**: `pnpm --filter web test demo-events.test.ts` passes.

---

### Phase 2: AI-description reel wiring

**Goal**: Instrument the two AI-description events.

**Steps**:

1. **`demo_ai_suggest_attempted`**
   - **File**: `apps/web/src/features/content/components/suggestion-dialog.tsx`
   - **Action**: Import `captureDemoEvent` from `../../demo` (mirrors the existing cross-feature import convention used by `bulk-confirm-modal.tsx`, `generate-label-form.tsx`, etc.). In the `write.demoReadOnly` branch (currently ~line 136-142), add `onLockedClick` to the existing `<ReadOnlyLock>`:
     ```tsx
     if (write.demoReadOnly) {
       return (
         <ReadOnlyLock
           active
           message={DEMO_READ_ONLY_ACTION_MESSAGE}
           onLockedClick={() => captureDemoEvent('demo_ai_suggest_attempted', { channel: channelLabel })}
         >
           <Button type="button" tone="ghost" disabled>
             ✨ Suggest with AI
           </Button>
         </ReadOnlyLock>
       );
     }
     ```
     `channelLabel` is already computed a few lines above (`channel === null ? 'master' : channel`) — no new local needed.
   - **Acceptance**: Clicking the disabled "Suggest with AI" button as a demo viewer fires `demo_ai_suggest_attempted` with `{ channel: 'master' | <platformType> }`.
   - **Dependencies**: Phase 1 step 1.

2. **`demo_content_publish_attempted`**
   - **File**: `apps/web/src/features/content/components/content-editor.tsx`
   - **Action**: Import `captureDemoEvent` from `../../demo`. Wire both `onPublish` closures (the master `<ContentPanel>` around line 248, and the per-channel `<ContentPanel>` around line 310) to fire before/alongside `setPendingPublish`:
     ```tsx
     // master tab
     onPublish={() => {
       captureDemoEvent('demo_content_publish_attempted', { channel: 'master' });
       setPendingPublish({ kind: 'master' });
     }}
     // per-channel tab (inside the channels.map)
     onPublish={() => {
       captureDemoEvent('demo_content_publish_attempted', { channel: promptChannel });
       setPendingPublish(target);
     }}
     ```
     `promptChannel` (`channel.platformType`) is already computed above the per-channel `<ContentPanel>` — reused, not duplicated.
   - **Acceptance**: Clicking "Publish" on either the master or a channel tab fires `demo_content_publish_attempted` with the correct channel — fires on the *click that opens the confirm dialog*, matching the issue's intent (publish-attempted, not publish-succeeded), and matching how `demo_offer_create_attempted` fires on the button click that opens/confirms the write, not on mutation success.
   - **Dependencies**: Phase 1 step 1.

---

### Phase 3: Open-source reel — add the link, then instrument it

**Goal**: Make the open-source reel trackable by adding the missing "View on GitHub" affordance, then wire its click event.

**Steps**:

1. **Add the GitHub link to the shell**
   - **File**: `apps/web/src/app/app-shell.tsx`
   - **Action**: Add a `location` parameter to `WorkspaceFooter` and render a demo-gated link there (footer chosen over the brand mark — the brand area is a tight icon+wordmark row with no room for a second affordance without a redesign; the footer already has room next to "Default organization" / sign-out). Sketch:
     ```tsx
     interface WorkspaceFooterProps {
       onLogout?: () => void;
       username?: string;
       location: 'sidebar_footer' | 'mobile_drawer_footer';
       demoMode: boolean;
     }

     function WorkspaceFooter({ onLogout, username, location, demoMode }: WorkspaceFooterProps): ReactElement {
       return (
         <div className="shell-workspace">
           <div className="shell-workspace__header">
             <strong className="shell-workspace__name">Default organization</strong>
           </div>
           {demoMode ? (
             <a
               className="shell-workspace__github-link"
               href="https://github.com/openlinker-project/openlinker"
               target="_blank"
               rel="noopener noreferrer"
               onClick={() => captureDemoEvent('demo_opensource_link_clicked', { location })}
             >
               View on GitHub ↗
             </a>
           ) : null}
           {/* ...existing username/logout block unchanged... */}
         </div>
       );
     }
     ```
     Update both call sites (desktop sidebar ~line 325-330, mobile drawer ~line 350-355) to pass `location="sidebar_footer"` / `location="mobile_drawer_footer"` and the existing `demoMode` value already computed in `AppShell` (line 234).
   - **Acceptance**: In a demo build, a "View on GitHub ↗" link renders in the sidebar footer (and mobile drawer footer) linking to the public repo, opening in a new tab. In a non-demo build, nothing renders (no new DOM, no dead affordance).
   - Add one CSS rule for `.shell-workspace__github-link` in `apps/web/src/index.css` (small text link, muted color token, hover underline) — follow the existing `.shell-workspace__username` sibling styling for visual consistency; no new design tokens needed (reuse `var(--text-tertiary)` or nearest existing token).

2. **Wire the click event** — folded into step 1 above (the `onClick` handler is part of the same edit, since the link and its instrumentation are inseparable per the issue). Import `captureDemoEvent` from `../features/demo` in `app-shell.tsx` (already imports `disableDemoAnalytics` etc. from the same barrel — one import line addition).
   - **Acceptance**: Clicking the link fires `demo_opensource_link_clicked` with `{ location: 'sidebar_footer' }` or `{ location: 'mobile_drawer_footer' }` depending on which rendering fired.
   - **Dependencies**: Phase 1 step 2.

---

### Phase 4: Cross-cutting baseline wiring

**Goal**: Instrument login, command-palette open/select, and analytics opt-out.

**Steps**:

1. **`demo_login_succeeded`** (with the init-ordering fix)
   - **File**: `apps/web/src/features/demo/lib/init-demo-integrations.ts`
   - **Action**: Add a small pending-event buffer so an event captured before `posthogInstance` is set is replayed once init resolves, instead of silently dropped:
     ```ts
     let pendingEvents: Array<{ event: DemoEventName; props: unknown }> = [];

     export async function initDemoIntegrations(config: SystemConfig | undefined): Promise<void> {
       // ...existing guards (return early) unchanged...
       // ...existing posthog.init(...) unchanged...
       const buffered = pendingEvents;
       pendingEvents = [];
       for (const { event, props } of buffered) {
         captureDemoEvent(event, props as DemoEventProps<typeof event>);
       }
     }

     export function captureDemoEvent<E extends DemoEventName>(event: E, props: DemoEventProps<E>): void {
       if (!posthogInstance) {
         // Buffer only while init might still be pending — never grows once
         // initDemoIntegrations has resolved (success or early-return), because
         // every early-return path below leaves `posthogInstance` null forever
         // for this session, so an unbounded buffer would otherwise be possible
         // for events fired outside demo mode. Guarded by a one-shot flag instead.
         if (!initSettled) {
           pendingEvents.push({ event, props });
         }
         return;
       }
       if (!productEventsEnabled) return;
       const group = DemoEventCatalog[event].group;
       if (!enabledEventGroups.has(group)) return;
       posthogInstance.capture(event, props);
     }
     ```
     Add a module-local `let initSettled = false;` flipped to `true` at the very end of `initDemoIntegrations` (in a `finally`, covering both the early-return-not-demo-mode path and the full-init path) so a non-demo build's buffer never grows unboundedly across a long session. **Re-derive the exact early-return placement by reading the current file at edit time** — the sketch above must set `initSettled = true` on *every* exit path (not-demo-mode, no-key, consent-not-accepted, and success), via a top-level `try { ... } finally { initSettled = true; }` wrapping the whole function body.
   - **Acceptance**: A unit test (Phase 5) simulates `captureDemoEvent` firing before `initDemoIntegrations` resolves and asserts the event is still captured once init completes; a second test confirms a non-demo build (init exits early, non-demo) never leaks a growing buffer (call `captureDemoEvent` many times after early-return settles, assert no unbounded array growth — practically: assert `pendingEvents` conceptually empty via a subsequent successful init capturing nothing unexpected).
   - **Rationale for buffering here vs. in `use-login.ts`**: centralizes the fix in the one module that owns `posthogInstance`'s lifecycle — see §7 Alternative 1 for the rejected per-call-site alternative.

2. **Fire `demo_login_succeeded`**
   - **File**: `apps/web/src/features/auth/hooks/use-login.ts`
   - **Action**:
     ```ts
     import { useMutation, type UseMutationResult } from '@tanstack/react-query';
     import { useApiClient } from '../../../app/api/api-client-provider';
     import { useSession } from '../../../shared/auth/use-session';
     import { captureDemoEvent } from '../../demo';
     import type { LoginRequest, LoginResponse } from '../api/auth.types';

     export function useLogin(): UseMutationResult<LoginResponse, Error, LoginRequest> {
       const apiClient = useApiClient();
       const { adapter, refreshSession } = useSession();

       return useMutation({
         mutationFn: async (input: LoginRequest) => {
           const response = await apiClient.auth.login(input);
           await adapter.persistSession(response.access_token);
           await refreshSession();
           captureDemoEvent('demo_login_succeeded', { role: response.user.role });
           return response;
         },
       });
     }
     ```
     **Verify `LoginResponse`'s exact shape** (`features/auth/api/auth.types.ts`) before finalizing — the `role` field's actual path (`response.user.role` vs. some other nesting) must be confirmed by reading that file at implementation time; this plan assumes a `user.role` field mirroring the session shape used elsewhere (`session.user?.role`).
   - **Acceptance**: A successful login fires `demo_login_succeeded` with the user's role, even in the (normally momentary) window before `initDemoIntegrations` has resolved — verified by the buffer added in step 1.
   - **Dependencies**: Phase 1 step 3, Phase 4 step 1.

3. **`demo_command_palette_opened`**
   - **File**: `apps/web/src/app/command-palette-provider.tsx`
   - **Action**: Import `captureDemoEvent` from `../features/demo`. Fire at both open paths:
     ```tsx
     // global ⌘K / Ctrl+K shortcut
     function handleKeyDown(event: KeyboardEvent): void {
       if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
         event.preventDefault();
         setIsOpen((prev) => {
           const next = !prev;
           if (next) captureDemoEvent('demo_command_palette_opened', { trigger: 'keyboard' });
           return next;
         });
       }
     }
     ```
     ```tsx
     // click trigger
     const ctx = useMemo<CommandPaletteContextValue>(
       () => ({
         open: () => {
           captureDemoEvent('demo_command_palette_opened', { trigger: 'click' });
           setIsOpen(true);
         },
       }),
       [],
     );
     ```
   - **Acceptance**: Opening the palette via ⌘K fires `{ trigger: 'keyboard' }`; opening via the topbar search trigger fires `{ trigger: 'click' }`. Toggling closed via ⌘K does not fire (guarded by the `next` check).
   - **Dependencies**: Phase 1 step 3.

4. **`demo_command_palette_result_selected`**
   - **File**: `apps/web/src/app/command-palette-provider.tsx`
   - **Action**: Derive `source` from the existing `entry.id` prefix inside `handleSelect`, so no call site needs a new parameter:
     ```tsx
     const SOURCE_BY_PREFIX: Record<string, string> = {
       nav: 'navigation',
       conn: 'connections',
       order: 'orders',
       product: 'products',
       job: 'sync_jobs',
       recent: 'recent',
     };

     const handleSelect = useCallback(
       (entry: RecentEntry, isRecentClick = false): void => {
         const prefix = entry.id.split(':')[0] ?? '';
         captureDemoEvent('demo_command_palette_result_selected', {
           source: SOURCE_BY_PREFIX[prefix] ?? 'unknown',
         });
         if (!isRecentClick) {
           const next = pushRecent(entry, recents);
           setRecents(next);
           saveRecents(next);
         }
         setIsOpen(false);
         void navigate(entry.to);
       },
       [navigate, recents],
     );
     ```
     Note: a click on a **Recent** entry re-navigates via the *original* `entry.id` (e.g. `'nav:/orders'`), so its prefix still resolves to `'navigation'`, not `'recent'` — this is arguably more useful for marketing (which underlying source got re-clicked) than a flat `'recent'` bucket. **Flagged as an assumption** — if marketing wants recents tracked as their own bucket, gate on `isRecentClick` instead: `isRecentClick ? 'recent' : (SOURCE_BY_PREFIX[prefix] ?? 'unknown')`. Default to the prefix-only derivation (richer signal) unless told otherwise.
   - **Acceptance**: Selecting any result fires `demo_command_palette_result_selected` with the correct `source` for all six origins (five live sources + recents).
   - **Dependencies**: Phase 1 step 3, Phase 4 step 3 (same file, sequential edits).

5. **`demo_analytics_disabled`**
   - **File**: `apps/web/src/app/app-shell.tsx`
   - **Action**: The existing `handleDisableAnalytics` callback (lines 313-317) already imports from `../features/demo`. Add the capture call:
     ```tsx
     const handleDisableAnalytics = useCallback((): void => {
       setDemoAnalyticsConsent('declined');
       setAnalyticsConsent('declined');
       captureDemoEvent('demo_analytics_disabled', {});
       disableDemoAnalytics();
     }, []);
     ```
     Fire `captureDemoEvent` **before** `disableDemoAnalytics()` — the latter calls `posthog.opt_out_capturing()`, and `captureDemoEvent`'s own gate checks `posthogInstance` truthiness, not the opt-out flag, so ordering doesn't strictly matter for delivery — but firing before opt-out is the more defensible ordering (records the disable action while still "in" analytics) and avoids any future PostHog SDK behavior change where `opt_out_capturing()` might suppress an immediately-following `capture()` call.
   - **Acceptance**: Clicking "Disable" in the `DemoBanner` fires `demo_analytics_disabled` exactly once, then subsequent capture calls in the session are no-ops (already guaranteed by `opt_out_capturing()`).
   - **Dependencies**: Phase 1 step 3.

---

### Implementation Details Summary

**New Components**: None (no new files) — this batch is entirely additive edits to existing files.

**Files touched**:
- `apps/web/src/features/demo/lib/demo-events.ts` (+7 catalog entries, +3 groups)
- `apps/web/src/features/demo/lib/demo-events.test.ts` (assert new entries if the test is exhaustive)
- `apps/web/src/features/demo/lib/init-demo-integrations.ts` (buffer-and-replay fix)
- `apps/web/src/features/demo/lib/init-demo-integrations.test.ts` (buffer tests)
- `apps/web/src/features/content/components/suggestion-dialog.tsx` (+`onLockedClick`)
- `apps/web/src/features/content/components/suggestion-dialog.test.tsx` (test)
- `apps/web/src/features/content/components/content-editor.tsx` (+2 capture calls)
- `apps/web/src/features/content/components/content-editor.test.tsx` (test)
- `apps/web/src/features/auth/hooks/use-login.ts` (+1 capture call)
- `apps/web/src/features/auth/hooks/use-login.test.ts` (new or extended test — verify existing file first)
- `apps/web/src/app/app-shell.tsx` (+GitHub link, +2 capture calls, `WorkspaceFooter` prop changes)
- `apps/web/src/app/app-shell.test.tsx` (test — verify existing file/coverage first)
- `apps/web/src/app/command-palette-provider.tsx` (+2 capture call sites)
- `apps/web/src/app/command-palette-provider.test.tsx` (test — verify existing file first)
- `apps/web/src/index.css` (+1 small CSS rule for the GitHub link)

**Configuration Changes**: None.

**Database Migrations**: None (frontend-only).

**Events**:
- **Emitted** (client-side PostHog only, gated by demo mode + settings): `demo_ai_suggest_attempted`, `demo_content_publish_attempted`, `demo_opensource_link_clicked`, `demo_login_succeeded`, `demo_command_palette_opened`, `demo_command_palette_result_selected`, `demo_analytics_disabled`.
- **Consumed**: None.

**Error Handling**: No new error paths — `captureDemoEvent` is already fully defensive (no-ops silently outside demo mode / consent / enabled groups). The buffer-and-replay addition (Phase 4 step 1) must not throw if `props` fails to satisfy `DemoEventProps<E>` at replay time — since the buffer stores already-validated call-time props, this is a non-issue (TypeScript enforces the shape at the original `captureDemoEvent` call site, not at replay).

---

## 7. Alternatives Considered

### Alternative 1: Buffer the login event inside `use-login.ts` instead of `init-demo-integrations.ts`
- **Description**: Instead of a generic pending-event buffer inside the module that owns `posthogInstance`, add ad-hoc retry/delay logic (e.g. a `setTimeout` poll, or an event emitter) local to `use-login.ts` only for this one event.
- **Why Rejected**: Scatters buffering logic to every call site that could theoretically race init, rather than fixing it once at the source. The chosen approach (buffer inside `init-demo-integrations.ts`) is also transparent to future call sites — nothing at any future call site needs to know about the race at all.
- **Trade-offs**: The chosen approach adds a small amount of module-local state (`pendingEvents`, `initSettled`) to a file that was previously stateless-except-for-`posthogInstance`; justified by centralizing a whole class of races in one place instead of per-caller workarounds.

### Alternative 2: Fire `demo_command_palette_result_selected` at each of the 6 individual `onSelect` call sites instead of inside `handleSelect`
- **Description**: Add `captureDemoEvent('demo_command_palette_result_selected', { source: 'navigation' })` (etc.) at each of the 6 `.map()` callback sites that build `navItems`/`connectionItems`/etc.
- **Why Rejected**: Duplicates the capture call 6 times instead of once, and requires touching every future new result-source addition twice (once for the item, once for the event) instead of once. Deriving `source` from the already-unique `entry.id` prefix inside the single `handleSelect` is strictly less code and can't drift.
- **Trade-offs**: Slightly more implicit (the `id` prefix convention becomes load-bearing for analytics, not just for React `key`/dedup purposes) — mitigated by the `SOURCE_BY_PREFIX` map being colocated and self-documenting.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE/Integration/Infrastructure touched — pure frontend Interface-layer change.
- ✅ Respects `features` → `shared` and `app` → `features` dependency direction — every new import is either same-feature-internal or a cross-feature/app-level import of `features/demo`'s existing public barrel (already an established precedent per `docs/frontend-architecture.md`'s "Cross-feature consumption example ([#1787](https://github.com/openlinker-project/openlinker/issues/1787))").
- ✅ No new global store — all new state (`pendingEvents`, `initSettled`) is module-local to `init-demo-integrations.ts`, matching the existing `posthogInstance`/`productEventsEnabled` module-local pattern already there.

### Naming Conventions
- ✅ New catalog keys follow the existing `demo_<noun>_<verb_past_tense_or_ing>` shape (`demo_ai_suggest_attempted`, `demo_login_succeeded`, etc.), matching every existing entry.
- ✅ New groups (`ai-descriptions`, `opensource`, `baseline`) follow the existing kebab-case group naming (`conversion-intent`, `ecommerce-reel`).

### Existing Patterns
- ✅ Every call site mirrors an existing, already-shipped precedent (§4 Internal Patterns) — no new interaction shape is invented.

### Risks
- **GitHub URL accuracy**: if `https://github.com/openlinker-project/openlinker` isn't the intended public-facing link (private mirror, different org), the link ships wrong. Mitigation: flagged as an open question (§5); trivial one-line fix if wrong.
- **`LoginResponse.user.role` shape mismatch**: the plan assumes a specific field path for the role prop; if the actual DTO nests it differently (or omits role entirely from the login response, requiring a follow-up `refreshSession()` read instead), the implementer must adjust — flagged explicitly in Phase 4 step 2.
- **Settings-panel group auto-discovery**: the plan assumes the `product-events-section.tsx` ([#1787](https://github.com/openlinker-project/openlinker/issues/1787)) panel auto-derives its group toggle list from `DemoEventCatalog` with zero hardcoded group names. If some part of that panel *does* hardcode the group list (contradicting the auto-generation description in the codebase), the 3 new groups (`ai-descriptions`, `opensource`, `baseline`) won't appear as togglable there without an additional edit. **Action for implementer**: read `product-events-section.tsx` before Phase 1 to confirm zero-hardcoding, and if not, add the 3 groups to whatever list needs it.

### Edge Cases
- **Palette closed via ⌘K while open**: `handleKeyDown`'s toggle must not fire `demo_command_palette_opened` on the *closing* toggle — handled by only calling capture inside the `next === true` branch (see Phase 4 step 3 sketch).
- **Recents click source attribution**: addressed as an explicit assumption in §5/Phase 4 step 4 — defaults to prefix-derived source (richer), not a flat `'recent'` bucket.
- **Buffer growth in a non-demo build**: addressed via the `initSettled` one-shot flag (Phase 4 step 1) so a long session in a self-hosted (non-demo) build never accumulates an unbounded array from repeated `captureDemoEvent` calls that all no-op forever.
- **Content publish confirm dialog cancelled**: `demo_content_publish_attempted` fires on the *initial* "Publish" click (which opens the confirm dialog), not on final confirm — consistent with how `demo_offer_create_attempted` fires on the locked-button click, not on a later confirm step, and matches the issue's "intent-to-convert" framing (the click is the signal, not the eventual outcome).

### Backward Compatibility
- ✅ No breaking changes — all edits are additive (new catalog entries, new optional-by-default UI element, new capture calls). No existing prop, type, or exported symbol is removed or renamed. `WorkspaceFooterProps` gains two new **required** props (`location`, `demoMode`) — since `WorkspaceFooter` is a module-private (non-exported) component with exactly 2 call sites, both updated in the same change, this is safe and not a public API break.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
All new tests follow the exact `vi.mock('../../features/demo', ...)` / `vi.mock('../features/demo', ...)` pattern already used in `products-list-page.test.tsx` (§4).

- **`suggestion-dialog.test.tsx`**: clicking the locked "Suggest with AI" button (demo-read-only state) fires `captureDemoEvent('demo_ai_suggest_attempted', { channel: 'master' | <platform> })` exactly once.
- **`content-editor.test.tsx`**: clicking "Publish" on the master panel fires `{ channel: 'master' }`; clicking "Publish" on a channel panel fires `{ channel: <platformType> }`.
- **`init-demo-integrations.test.ts`** (extend existing suite): (1) a `captureDemoEvent` call issued before `initDemoIntegrations` resolves is replayed exactly once after init succeeds with matching demo-mode+consent config; (2) a `captureDemoEvent` call issued before a *non-demo* / *no-key* / *no-consent* early-return-resolved `initDemoIntegrations` never replays (buffer discarded, no leak); (3) existing tests (already-initialized capture, disabled analytics, etc.) continue passing unmodified.
- **`use-login.test.ts`**: a successful login mutation fires `demo_login_succeeded` with the response's role. If no test file exists yet for this hook, create one following the existing mutation-hook test conventions elsewhere in `features/auth` (or the nearest sibling hook test, whichever exists) — read the directory first to match the file's real existing test setup (renderHook + QueryClientProvider wrapper, etc.).
- **`app-shell.test.tsx`**: (1) in demo mode, the "View on GitHub" link renders and clicking it fires `demo_opensource_link_clicked` with the correct `location`; (2) in non-demo mode, the link does not render at all; (3) clicking "Disable" in the banner fires `demo_analytics_disabled` before/alongside the existing disable-analytics assertions already covered by the current suite (verify current coverage first — extend, don't duplicate).
- **`command-palette-provider.test.tsx`**: (1) pressing ⌘K to open fires `{ trigger: 'keyboard' }`; (2) clicking the topbar search trigger fires `{ trigger: 'click' }`; (3) pressing ⌘K to close does NOT fire a second open event; (4) selecting a result from each of the 5 live sources + recents fires `demo_command_palette_result_selected` with the correct `source` value.

### Integration Tests
None required — this is pure client-side event instrumentation with no server round-trip; `pnpm test:integration` is unaffected.

### Mocking Strategy
- Mock `../../features/demo` / `../features/demo` (path depends on the importing file's depth) to intercept `captureDemoEvent`, exactly as `products-list-page.test.tsx` already does — never mock PostHog directly at this layer (that's already covered by `init-demo-integrations.test.ts`'s own existing PostHog-level mocks).
- Reuse `renderWithProviders()` / `createMockApiClient()` / `createAuthenticatedSessionAdapter()` from `test/test-utils.tsx` for any page/shell-level test, per `docs/frontend-architecture.md`'s testing baseline.

### Acceptance Criteria (mirrors the GitHub issue's own checklist)
- [ ] A GitHub / open-source link exists in the app shell (demo-mode-gated) and fires `demo_opensource_link_clicked`.
- [ ] Each of the 7 events fires from its cited handler with the listed props.
- [ ] `demo_login_succeeded` is not dropped when it precedes PostHog init (buffer-and-replay verified by test).
- [ ] Catalog entries exist for every event above, correctly grouped (`conversion-intent`, `ai-descriptions`, `opensource`, `baseline`).
- [ ] No event fires on a self-hosted (non-demo) build — verified by the existing `posthogInstance` guard plus the non-demo link-doesn't-render test.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` all pass with zero errors.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — frontend-only, no layer violation risk)
- [x] Respects CORE vs Integration boundaries (N/A — no backend touched)
- [x] Uses existing patterns (no unnecessary abstractions) — every call site mirrors a shipped precedent
- [x] Idempotency considered — N/A for client-side analytics events (fire-and-forget by design, matches every existing `captureDemoEvent` call site)
- [x] Event-driven patterns used where applicable — this *is* the event-instrumentation work
- [x] Rate limits & retries addressed — N/A (PostHog SDK handles its own batching/retry internally; out of scope)
- [x] Error handling comprehensive — no new failure modes introduced; buffer addition is defensive
- [x] Testing strategy complete — unit tests specified per call site, mocking pattern matches existing convention
- [x] Naming conventions followed — catalog keys, groups, file names all match existing conventions
- [x] File structure matches standards — no new files/directories, all edits to existing feature/app modules
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md) — Feature Public Surface ([#609](https://github.com/openlinker-project/openlinker/issues/609)), cross-feature consumption precedent ([#1787](https://github.com/openlinker-project/openlinker/issues/1787))
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue [#1790](https://github.com/openlinker-project/openlinker/issues/1790) — part of [#1785](https://github.com/openlinker-project/openlinker/issues/1785)
