# Implementation Plan — #377 Promote AI to a Top-Level Nav Section

## 1. Understand the task

**Goal.** Move the prompt-templates surfaces out of Settings and into a new admin-gated `AI` top-level nav group. Routes move from `/settings/prompt-templates[/:id]` to `/ai/prompt-templates[/:id]`, with redirects so bookmarked URLs keep working. Zero backend changes; zero new primitives.

**Layer.** Frontend (`apps/web`) — route wiring, shell nav composition, one page cleanup.

**Non-goals (explicit).**
- No backend changes. `PromptTemplatesController` at `/api/prompt-templates` is untouched; the core `@openlinker/core/ai` module is untouched.
- No new AI features (telemetry, provider config, suggestion history). Those belong to a separate roadmap issue the PR description will flag.
- No `/ai` landing page. If `/ai` ever needs content beyond the nav entry, that's a follow-up.
- No cross-page visual restyling or token changes. The style guide is settled; this issue is structural IA only.

## 2. Research the codebase

- **Nav structure.** `apps/web/src/app/app-shell.tsx:66-106` declares a module-level `navGroups` array with `live` and `planned` kinds, rendered by `SidebarNav` (same file, lines 157-203). Each live item can optionally carry a `countKey` fed by `useNavCounts`. `SidebarNav` currently reads the module-level constant directly — adding an admin-gated group means threading `groups` through as a prop, because admin-ness is session-scoped and only known at render time.
- **Breadcrumbs.** `staticCrumbs` (lines 108-127) maps exact paths → `{ group, title }`; `resolveCrumbs` (129-142) adds prefix-based fallbacks for detail routes like `/orders/:id`.
- **Route module pattern.** Every route in `apps/web/src/app/routes/*.route.tsx` exports a `RouteObject` and is aggregated into `root.route.tsx`. No route uses `loader`; all use `element`. Redirects are done via `<Navigate to="..." replace />` at the layout level — see `authenticated-app-layout.tsx:29` and `guest-layout.tsx:18`.
- **Admin gating pattern.** `settings-page.tsx:9-10` already uses `useSession()` + `session.user?.role === 'admin'` to conditionally render the prompt-templates panel. This is the established pattern; reuse it for the nav group.
- **React Router v7.13.** Named imports from `react-router-dom`; `<Navigate>`, `<Outlet>`, `useParams`, `useNavigate` available.
- **References to `/settings/prompt-templates` in the tree** (11 hits, grep-verified):
  - `app-shell.tsx:126` — `staticCrumbs` entry (remove + add new AI entry)
  - `app/routes/prompt-templates-list.route.tsx:5` — path (rename)
  - `app/routes/prompt-template-detail.route.tsx:5` — path (rename)
  - `pages/settings/settings-page.tsx:140` — `<Link>` inside the AI panel (removed with the panel)
  - `pages/prompt-templates/prompt-template-detail-page.tsx:129,146,165,383` — 4 `navigate()` calls (rewrite to `/ai/...`)
  - `pages/prompt-templates/prompt-templates-list-page.tsx:203` — `rowHref` callback (rewrite)
  - `pages/prompt-templates/prompt-template-detail-page.test.tsx:59,63` — Route path + initial pathname (rewrite)
- **Existing tests to touch.** `settings-page.test.tsx` has zero references to `prompt` (grep-verified) — nothing to remove there. `app-shell.test.tsx` has 14 tests and will gain two new ones (admin sees AI, non-admin does not). The existing test "renders the three live nav groups plus a disabled Planned footer" asserts individual group labels, not group *count*, so adding AI in admin-context won't break it — but I must not over-specify the new admin test as "exactly these 5 groups" either.

## 3. Design the solution

### Nav group placement

**Decision: `AI` as its own live group**, admin-gated, positioned between `Platform` and `Planned`:

```
Operations   (6 items)
Diagnostics  (3 items)
Platform     (3 items: Connections, Adapters, Settings)
AI           (1 item: Prompt templates)    ← new, admin-only
Planned      (3 items)
```

**Why its own group.** The arch doc (`docs/architecture-overview.md` §13) already anticipates AI growth — `AiCompletionPort`, provider selection via `OL_AI_PROVIDER`, per-completion telemetry (`{ requestId, model, latencyMs, inputTokens, outputTokens, cachedInputTokens }`), and publish/revert audit logging. A dedicated group lands the shape before the shape matters. The alternative — nesting prompt templates under Platform — bakes in a rename cost the moment we add a second AI surface.

**Visual-weight concern** (the issue flags this as the one open design question). With only one child, the `AI` group is thinner than its siblings. Mitigations:
1. The existing `Planned` group renders with 3 items in muted styling — the shell already tolerates variable group density.
2. Admin-only gating means non-admins don't see the asymmetry at all.
3. The group header (`p.shell-nav__label`, 10 px / 600 / uppercase tracking in `--text-muted`) is decoupled from item count — a one-item group reads as intentional rather than empty.

If the one-child group reads poorly in QA, the cheap fallback is to demote AI into Platform as a second entry. I'll flag this in the PR description as a reviewable choice.

### Admin gating implementation

Lift `navGroups` from a module constant into a per-render value computed inside `AppShell`, because admin-ness is session-scoped:

```tsx
// Inside AppShell, before render:
const isAdmin = session.status === 'authenticated' && session.user?.role === 'admin';
const groups = useMemo(() => buildNavGroups({ isAdmin }), [isAdmin]);
```

`buildNavGroups({ isAdmin })` is a pure helper at module scope that returns the array, conditionally splicing the AI group in before `Planned`. `SidebarNav` receives `groups` as a new required prop (replacing the direct module-constant read).

Non-admins never see the AI group at all — not greyed out, not disabled. This matches the issue's "admin-gate the entire group" requirement.

### Redirects

Add two route entries in `root.route.tsx`, keyed at the existing legacy paths, whose `element` uses `<Navigate replace>`. For the `:id` variant, a tiny named component reads `useParams` and forwards to the new path:

```tsx
// apps/web/src/app/routes/prompt-templates-legacy-redirects.tsx
export const promptTemplatesLegacyListRedirectRoute: RouteObject = {
  path: 'settings/prompt-templates',
  element: <Navigate to="/ai/prompt-templates" replace />,
};

function PromptTemplateLegacyDetailRedirect(): ReactElement {
  const { id } = useParams();
  if (!id) return <Navigate to="/ai/prompt-templates" replace />;
  return <Navigate to={`/ai/prompt-templates/${id}`} replace />;
}
export const promptTemplateLegacyDetailRedirectRoute: RouteObject = {
  path: 'settings/prompt-templates/:id',
  element: <PromptTemplateLegacyDetailRedirect />,
};
```

Both redirects sit under `AuthenticatedAppLayout`, inheriting the existing auth gate. Anonymous users hitting the old URL get bounced to `/login` (current behavior), not a broken redirect.

File placement: one new file `apps/web/src/app/routes/prompt-templates-legacy-redirects.route.tsx` — the stem `*-legacy-redirects.route.tsx` names its purpose clearly; future removal is a single-file delete.

### Breadcrumbs

In `staticCrumbs` (drop one, add one):
- remove `'/settings/prompt-templates': { group: 'Platform', title: 'Prompt templates' }`
- add `'/ai/prompt-templates': { group: 'AI', title: 'Prompt templates' }`

In `resolveCrumbs` prefix branches, add before the final fallback:
- `if (pathname.startsWith('/ai/prompt-templates/')) return { group: 'AI', title: 'Prompt template' };` (singular for detail view, matching how Orders / Connections detail routes already do it)

### Settings page cleanup

Remove the entire AI panel block (`settings-page.tsx:127-144`) and drop the now-unused `Link` import if no longer referenced. The `isAdmin` computation above it becomes dead — remove it too to avoid eslint `noUnusedLocals` noise.

### Internal navigation inside prompt-template pages

Four `navigate()` calls in `prompt-template-detail-page.tsx` + one `rowHref` in `prompt-templates-list-page.tsx` — simple string swap `'/settings/prompt-templates'` → `'/ai/prompt-templates'`. All five stay inside the same templated URL shape, so the edit is mechanical.

### Data flow (unchanged)

- Query keys, API endpoints, and mutations stay put.
- `useApiClient()` calls `/api/prompt-templates/*` — unaffected.
- `PromptTemplateService` in `libs/core/src/ai/` — unaffected.

## 4. Step-by-step implementation plan

### Step 1 — Route path renames

- `apps/web/src/app/routes/prompt-templates-list.route.tsx` → `path: 'ai/prompt-templates'`
- `apps/web/src/app/routes/prompt-template-detail.route.tsx` → `path: 'ai/prompt-templates/:id'`

**Acceptance:** path strings updated; nothing else changes in these files.

### Step 2 — Legacy redirect routes

- Create `apps/web/src/app/routes/prompt-templates-legacy-redirects.route.tsx` exporting `promptTemplatesLegacyListRedirectRoute` and `promptTemplateLegacyDetailRedirectRoute` as described in §3.
- Register both in `root.route.tsx` alongside the renamed routes.

**Acceptance:** visiting `/settings/prompt-templates` lands on `/ai/prompt-templates`; visiting `/settings/prompt-templates/tmpl-42` lands on `/ai/prompt-templates/tmpl-42`. Browser back button does not loop (ensured by `replace`).

### Step 3 — AppShell: AI nav group + breadcrumbs

- Extract `buildNavGroups({ isAdmin })` as a module-level pure helper in `app-shell.tsx`.
- Inside `AppShell`, compute `isAdmin` from `useSession()` and pass `groups` through to both `SidebarNav` calls (sidebar + drawer).
- `SidebarNav` gains a required `groups: NavGroup[]` prop, replacing the module-constant read.
- Update `staticCrumbs` and `resolveCrumbs` per §3.

**Acceptance:** admin session sees all 5 groups in order (Operations → Diagnostics → Platform → AI → Planned); non-admin sees 4 (no AI). Breadcrumb on `/ai/prompt-templates` reads `AI / Prompt templates`; on `/ai/prompt-templates/:id` reads `AI / Prompt template`.

### Step 4 — Settings page cleanup

- `apps/web/src/pages/settings/settings-page.tsx`: delete lines 127-144 (the admin-only AI panel), drop the unused `useSession` import and `isAdmin` local (they're used only by the deleted panel per `settings-page.tsx` read).

**Acceptance:** `/settings` no longer renders the Prompt Templates panel for any role. No TS "unused" warnings.

### Step 5 — Internal link updates

- `pages/prompt-templates/prompt-template-detail-page.tsx`: rewrite the 4 `navigate('/settings/prompt-templates...')` → `'/ai/prompt-templates...'`.
- `pages/prompt-templates/prompt-templates-list-page.tsx`: rewrite `rowHref` → `/ai/prompt-templates/${row.latestId}`.

**Acceptance:** grep for `/settings/prompt-templates` in `apps/web/src` returns only the two legacy redirect route entries.

### Step 6 — Test updates + new tests

- `pages/prompt-templates/prompt-template-detail-page.test.tsx`: flip the `Route path` and the initial `route:` option to `/ai/prompt-templates/:id` and `/ai/prompt-templates/tmpl-1`.
- `app-shell.test.tsx`: add two tests
  - `renders the AI nav group for admin sessions` — default `createAuthenticatedSessionAdapter()` in the existing helper already defaults to admin, so an explicit admin assertion + label check is sufficient.
  - `hides the AI nav group for non-admin sessions` — render with a `viewer` role adapter; assert `queryByText('AI')` within the Primary nav returns `null`.
- New test file `app/routes/prompt-templates-legacy-redirects.test.tsx` (or a section in `app.test.tsx`) — render with `initialEntries: ['/settings/prompt-templates']`, assert landing on `/ai/prompt-templates`; repeat for the `:id` variant.

**Acceptance:** all three tests pass. Existing prompt-template tests pass with the updated paths.

### Step 7 — Quality gate

```bash
pnpm --filter @openlinker/web lint
pnpm --filter @openlinker/web type-check
pnpm --filter @openlinker/web test
```

Followed by the workspace-wide gate:

```bash
pnpm lint
pnpm type-check
pnpm test
```

## 5. Validate

- **Architecture compliance.** All changes inside `apps/web/src/app` and `apps/web/src/pages` — layer direction preserved (`app` → `pages` → `features` → `shared`). No `features` → `features` imports introduced. No `shared` touched.
- **Naming.** New file `prompt-templates-legacy-redirects.route.tsx` follows `*.route.tsx` convention. Named export `promptTemplates…RedirectRoute` matches the existing `settingsRoute` / `ordersRoute` shape. Kebab-case stem + PascalCase export per frontend rules.
- **State ownership.** Session state continues to flow through `SessionProvider`; the new `isAdmin` check is a local derivation, not a new store. URL state for the redirects is handled by React Router, not re-created.
- **Testing strategy.** Matches the page-rules doc: happy path (admin sees group), edge (non-admin does not see it), redirect (old URLs resolve). No backend work → no integration tests needed.
- **Security.** Admin gating is **UI-only** — hiding the nav entry does not protect the prompt-templates endpoints; that's the backend's job (`PromptTemplatesController` uses `@Roles('admin')` per the arch doc). A non-admin who types `/ai/prompt-templates` into the URL bar will get a 403 from the API, which the existing page already handles with an inline error state (confirmed in `prompt-template-detail-page.test.tsx` — "blocks viewer sessions with an inline error").
- **A11y.** Redirects use `replace` so the browser history doesn't trap users in a back-button loop. The AI group header is a `<p class="shell-nav__label">` matching every other group; no new a11y semantics introduced.

## 6. Risks / open questions

- **Visual weight of a one-child AI group.** Flagged in the issue itself and in §3 above. I'll include before/after screenshots of the admin sidebar in the PR description and mark this as a reviewable design choice. If the reviewer prefers Platform-nested, the revert is a 10-line diff in `app-shell.tsx`.
- **`isAdmin` check consistency.** The settings page currently uses `isReady && session.status === 'authenticated' && session.user?.role === 'admin'`. The shell doesn't currently have `isReady`. For the nav gate I'll use the simpler `session.user?.role === 'admin'` because `useSession()` in the shell is already past the auth gate (`AuthenticatedAppLayout` redirects anonymous users to `/login` before `AppShell` renders). A non-ready session inside `AppShell` would be a bug elsewhere, not a concern here.
- **Deprecation window for old URLs.** The redirect is indefinite for now; the issue explicitly lists "Decide whether to retire the redirect after a deprecation window" as a follow-up, not part of this PR. Fine as-is.

## Files expected to change

| File | Change |
|---|---|
| `apps/web/src/app/routes/prompt-templates-list.route.tsx` | path string |
| `apps/web/src/app/routes/prompt-template-detail.route.tsx` | path string |
| `apps/web/src/app/routes/prompt-templates-legacy-redirects.route.tsx` | **new** — 2 `RouteObject` exports |
| `apps/web/src/app/routes/root.route.tsx` | register 2 redirect routes |
| `apps/web/src/app/app-shell.tsx` | `buildNavGroups({ isAdmin })` helper, `SidebarNav` takes `groups` prop, breadcrumbs updated |
| `apps/web/src/app/app-shell.test.tsx` | +2 tests (admin visibility, non-admin absence) |
| `apps/web/src/pages/settings/settings-page.tsx` | drop AI panel + unused `useSession` / `isAdmin` / `Link` if now unused |
| `apps/web/src/pages/prompt-templates/prompt-template-detail-page.tsx` | 4 `navigate()` path rewrites |
| `apps/web/src/pages/prompt-templates/prompt-templates-list-page.tsx` | `rowHref` path rewrite |
| `apps/web/src/pages/prompt-templates/prompt-template-detail-page.test.tsx` | Route path + initial `route:` rewrite |
| `apps/web/src/app/routes/prompt-templates-legacy-redirects.test.tsx` | **new** — redirect smoke tests |
