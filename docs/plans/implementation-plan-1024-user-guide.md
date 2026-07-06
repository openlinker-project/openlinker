# Implementation Plan: Screenshot-Driven End-User Platform Guide (#1024)

**Date**: 2026-06-12
**Status**: Ready for Review
**Estimated Effort**: 2–3 days (writing + screenshot capture)
**Issue**: [#1024](https://github.com/openlinker-project/openlinker/issues/1024)
**Implementation branch**: `1024-user-guide` (fresh worktree from `main`)

---

## 1. Task Summary

**Objective**: Add a screenshot-driven operator guide under `docs/user-guide/` that walks a self-hoster through the shipped admin UI — first login, connecting platforms, day-to-day operations, and diagnostics — so a running OpenLinker instance has matching documentation.

**Context** (#1024): The existing documentation is developer-oriented. `docs/getting-started.md` bootstraps the dev stack; `docs/integrations/{allegro,woocommerce}/setup-guide.md` covers platform-specific developer wiring. Nothing guides an operator who already has the platform running through "here is the UI, here is how to use it." This issue creates that guide, structured around the shipped left-nav information architecture defined in `docs/frontend-ui-style-guide.md § Shell Layout`.

**Classification**: Documentation (DX layer — no code, no architecture, no migrations).

---

## 2. Scope & Non-Goals (#1024)

### In Scope

1. `docs/user-guide/README.md` — index file linking all sections below.
2. `docs/user-guide/01-overview.md` — what OpenLinker is, shell layout (sidebar groups, top bar), dashboard orientation, first login.
3. `docs/user-guide/02-connecting-a-platform.md` — `/connections` → `/connections/new`: pick platform, run wizard (PrestaShop worked example), test connection, read status/health on the detail page.
4. `docs/user-guide/03-catalog-and-inventory.md` — Products and Inventory surfaces: synced state, how to read sync health.
5. `docs/user-guide/04-listings.md` — Listings surface and the offer-creation wizard at a high level.
6. `docs/user-guide/05-orders.md` — Orders list → detail, status timeline, shipment panel.
7. `docs/user-guide/06-diagnostics.md` — Jobs & Logs, Webhooks, Cursors: how an operator inspects and retries when something stalls.
8. `docs/user-guide/07-settings-and-admin.md` — Settings, AI provider / prompt templates (admin-gated), theme toggle.
9. `docs/user-guide/images/` — all screenshots committed here, referenced by relative path (no hot-links).
10. Cross-links from `README.md` (root) and `docs/getting-started.md` to the new guide.

### Out of Scope

- Planned / unshipped surfaces: **Automations, Shipping, Invoices** (disabled in the nav per `docs/frontend-ui-style-guide.md`) — explicitly excluded from every section.
- Mobile / tablet captures — desktop (1440×900) is the canonical target for v1.
- Dark-mode screenshots — optional nice-to-have; not a v1 acceptance criterion.
- Integration-specific deep-dives — those belong in `docs/integrations/{platform}/setup-guide.md`. Reuse or reference shots where sensible (see [Adjacent issue #1022](#adjacent-work)).
- Code, architecture, or migration changes — this is docs-only.
- Developer-audience content (that lives in `docs/getting-started.md` and contributor guides).

### Constraints

- All images must be committed under `docs/user-guide/images/` with no secrets, credentials, tokens, or personal data visible.
- Screenshots captured at **1440×900, light theme** — the canonical spec from `docs/frontend-ui-style-guide.md § Responsive`.
- The guide documents **shipped surfaces only** (the Operations, Diagnostics, and Platform nav groups that are live in the UI).
- File naming: `docs/user-guide/*.md` (kebab-lower, 2-digit prefix for order); `docs/user-guide/images/*.png`.
- Image filenames: `{section-prefix}-{screen-noun}.png` (e.g. `01-dashboard-overview.png`, `02-connections-list.png`).
- No `/dev/ui` screenshots (internal dev tooling, not user-facing).

### Adjacent Work

- **[#1022](https://github.com/openlinker-project/openlinker/issues/1022)** — WooCommerce master-shop setup guide screenshots. Separate PR, integration-specific. Reuse any shots that overlap (e.g. Connections list) rather than capturing duplicates — reference the image from this guide by relative path.

---

## 3. Architecture Mapping (#1024)

**Target Layer**: `docs/` — documentation only. No `libs/`, `apps/`, or migration paths touched.

**Capabilities Involved**: None — no ports or services.

**Existing Services Reused**: None — this is prose + screenshots.

**Existing Patterns Reused**:
- Section structure follows the nav IA from `docs/frontend-ui-style-guide.md § Shell Layout` (three groups: Operations / Diagnostics / Platform).
- Cross-link pattern already used in `docs/getting-started.md` (links to `docs/integrations/*/setup-guide.md`).
- Screenshot naming convention mirrors `docs/plans/*.png` (descriptive noun, light/dark suffix when both captured).

**Core vs Integration Justification**: N/A — documentation task.

**ADR**: Not warranted. Pure documentation addition with no cross-context contract or architectural trade-off.

---

## 4. External / Domain Research (#1024)

### Internal Findings

**Existing docs consulted**:
- `docs/frontend-ui-style-guide.md` — canonical nav IA, shell layout, typography, screenshot spec (1440×900 light).
- `docs/getting-started.md` — developer bootstrap; insertion point for the hand-off link to the user guide.
- `docs/integrations/allegro/setup-guide.md`, `docs/integrations/woocommerce/setup-guide.md` — integration-specific; out of scope but reference material for Connections section screenshots.
- `README.md` — insertion point for the user-guide link; already embeds `docs/plans/371-*.png` screenshots.

**Existing screenshots available for reuse** (all in `docs/plans/`):

| File | Content | Reusable in which section |
|---|---|---|
| `371-dashboard-light.png` | Dashboard overview | `01-overview.md` — can be reused or recaptured at 1440×900 |
| `371-connections-light.png` | Connections list | `02-connecting-a-platform.md` |
| `371-wizard-light.png` | Create-offer wizard | `04-listings.md` |
| `371-login-light.png` | Login page | `01-overview.md` |
| `analysis-01-dashboard.png` | Dashboard (audit shot) | Reference only — too small for UG |
| `analysis-03-connections.png` | Connections list (audit) | Reference only |
| `analysis-05-new-connection.png` | New connection wizard | `02-connecting-a-platform.md` |
| `analysis-06-connection-detail.png` | Connection detail | `02-connecting-a-platform.md` |

**Recommendation**: Copy `371-*-light.png` files to `docs/user-guide/images/` with renamed filenames that match the section prefix convention; recapture at 1440×900 if the existing shots pre-date the Visual System v2 (#775) palette.

**Nav IA (from `docs/frontend-ui-style-guide.md` — authoritative)**:

```
Operations:   Dashboard · Orders · Products · Inventory · Customers · Listings
Diagnostics:  Jobs & Logs · Webhooks · Cursors
Platform:     Integrations · Adapters · Settings
Planned(off): Automations · Shipping · Invoices  ← NOT documented
```

**Screenshot capture environment**: the dev stack at `http://localhost:5173` (pnpm start:dev:web) started per `docs/getting-started.md` is the standard capture surface. Browser DevTools → Responsive → 1440×900, or just a maximized browser at that viewport.

---

## 5. Questions & Assumptions (#1024)

### Open Questions

1. **Existing `371-*-light.png` shots**: were they captured pre or post Visual System v2 (#775)? If pre, the accent color differs from the current UI and should be recaptured. The plan assumes recapture is needed for any screenshot where the current app looks materially different; reuse otherwise.
2. **"Integrations" vs "Connections" naming**: `docs/frontend-ui-style-guide.md` notes "Route label, page title, and URL should use the same noun — either 'Connections' or 'Integrations' throughout, not both." The guide uses **Connections** as the section noun (consistent with the URL `/connections`) — this should be verified against the shipped nav label before writing.
3. **Customers surface**: listed in the nav under Operations but not called out in the issue's proposed structure. The plan includes it inside `01-overview.md` (mentioned as a nav item) and leaves a dedicated page deferred; the AC only requires "at least one section covering Customers" — flag in the PR if a dedicated subsection is warranted.

### Assumptions

- **A1**: The implementer (author) has a running local dev stack (per `docs/getting-started.md`) and at least one active PrestaShop connection for the Connection walkthrough screenshots.
- **A2**: The guide audience is the self-hoster / operator — not a developer contributing to the codebase. Terminology should be UI-first, not API-first.
- **A3**: Screenshots are **not** automatically updated by CI — manual recapture is the process when the UI changes. A `<!-- screenshot: {description} -->` HTML comment is placed above each `![]()` embed as a recapture cue.
- **A4**: No dedicated Customers section page is required for v1 AC; Customers is covered as part of the nav overview in `01-overview.md`.
- **A5**: The "Adapters" Platform nav item is documented only briefly (it shows registered adapter metadata) since it has limited operator-actionable content today.
- **A6**: PrestaShop is the worked example for the Connection walkthrough (it has the most complete wizard flow); Allegro is mentioned as the marketplace side.

### Documentation Gaps

- `docs/frontend-ui-style-guide.md` does not specify the `Adapters` page's content — documenting it from the shipped UI is sufficient.
- The issue lists "Connecting a platform" as its own walkthrough but does not define which wizard steps exist for WooCommerce — assume PrestaShop is primary, WooCommerce gets a one-liner cross-reference to `docs/integrations/woocommerce/setup-guide.md`.

---

## 6. Proposed Implementation Plan (#1024)

### Phase 1 — Directory Scaffold and Index

**Goal**: Establish the `docs/user-guide/` skeleton so sections can be written in parallel.

**Steps**:

1. **Create directory structure** (#1024)
   - **Action**: Create the following empty files/directories:
     ```
     docs/user-guide/
     docs/user-guide/README.md         ← index (written in this phase)
     docs/user-guide/images/           ← placeholder for screenshots (at least a .gitkeep)
     docs/user-guide/01-overview.md
     docs/user-guide/02-connecting-a-platform.md
     docs/user-guide/03-catalog-and-inventory.md
     docs/user-guide/04-listings.md
     docs/user-guide/05-orders.md
     docs/user-guide/06-diagnostics.md
     docs/user-guide/07-settings-and-admin.md
     ```
   - **Acceptance**: `ls docs/user-guide/` shows all files; `cat docs/user-guide/README.md` renders a navigable index in GitHub Markdown preview.
   - **Dependencies**: None.

2. **Write `docs/user-guide/README.md`** (index) (#1024)
   - **File**: `docs/user-guide/README.md`
   - **Action**: Write a 3-paragraph intro (what OpenLinker is, who this guide is for, how it is organized) followed by a numbered section list with one-line descriptions and relative links. Include a "Prerequisites" note pointing back to `docs/getting-started.md`.
   - **Required content**:
     ```markdown
     # OpenLinker — Operator Guide (#1024)

     This guide is for operators and self-hosters who have OpenLinker running and want
     a tour of the admin UI. ...

     ## Sections

     1. [Overview & First Login](./01-overview.md)
     2. [Connecting a Platform](./02-connecting-a-platform.md)
     3. [Catalog & Inventory](./03-catalog-and-inventory.md)
     4. [Listings & Offers](./04-listings.md)
     5. [Orders](./05-orders.md)
     6. [Diagnostics](./06-diagnostics.md)
     7. [Settings & Admin](./07-settings-and-admin.md)
     ```
   - **Acceptance**: All links resolve; Markdown renders cleanly; no broken anchors.
   - **Dependencies**: Directory scaffold (Step 1).

### Phase 2 — Section Content (Operations group)

**Goal**: Write the four Operations-group sections with inline screenshot placeholders or committed screenshots.

Each section follows this internal structure:
```markdown
# {Section Title} (#1024)

Brief one-paragraph orientation.

## {Sub-section or screen}

![{alt text}](./images/{prefix}-{noun}.png)
<!-- screenshot: {description of what should be visible} -->

Prose explanation (2–5 sentences). What the operator sees, what to do.
```

3. **Write `docs/user-guide/01-overview.md`** (#1024)
   - **File**: `docs/user-guide/01-overview.md`
   - **Action**: Cover:
     - **First login**: navigate to `http://your-host:5173`, enter credentials; screenshot of the login page.
     - **Shell layout**: annotated screenshot showing the three nav groups (Operations / Diagnostics / Platform), top bar, and main workspace area; reference `docs/frontend-ui-style-guide.md § Shell Layout` for the group structure.
     - **Dashboard orientation**: what each card/widget shows (jobs, connections, recent orders, sync health); screenshot of the live Dashboard at 1440×900.
     - **Theme toggle**: where it is in the top bar; one sentence.
   - **Screenshots needed** (→ `docs/user-guide/images/`):
     - `01-login.png` — login screen
     - `01-dashboard-overview.png` — full Dashboard view
     - `01-shell-layout-annotated.png` — shell with nav groups labelled (can be the dashboard shot with annotation arrows, or a clean nav-only crop)
   - **Acceptance**: Dashboard and login screenshots present; shell layout annotated; no Planned surfaces mentioned.
   - **Dependencies**: Running dev stack; Phase 1.

4. **Write `docs/user-guide/02-connecting-a-platform.md`** (#1024)
   - **File**: `docs/user-guide/02-connecting-a-platform.md`
   - **Action**: Full step-by-step walkthrough:
     1. Navigate to **Connections** (Platform group in nav).
     2. Connections list — what status indicators mean (active / error / needs_reauth / disabled).
     3. Click **+ New Connection** — platform picker dialog/wizard.
     4. Fill in connection details — worked example: **PrestaShop** (URL, API key). Include a ⚠️ callout: no real API keys in screenshots.
     5. **Test connection** button — what a passing result looks like vs. a failure.
     6. Connection detail page — health panel, last-sync timestamps, enabled capabilities, webhook status.
     7. Cross-reference: WooCommerce-specific wizard → `docs/integrations/woocommerce/setup-guide.md`.
   - **Screenshots needed**:
     - `02-connections-list.png` — Connections list with at least one active connection
     - `02-new-connection-picker.png` — platform-picker step
     - `02-new-connection-prestashop-form.png` — PrestaShop credential form (sanitized)
     - `02-connection-test-success.png` — test result: success state
     - `02-connection-detail.png` — connection detail page
   - **Acceptance**: End-to-end walkthrough covers picker → wizard → test → detail with all 5 screenshots present; credentials sanitized.
   - **Dependencies**: Running dev stack with a PrestaShop connection configured; Phase 1.

5. **Write `docs/user-guide/03-catalog-and-inventory.md`** (#1024)
   - **File**: `docs/user-guide/03-catalog-and-inventory.md`
   - **Action**: Cover:
     - **Products**: the product list — columns, sync state chip, search/filter bar, click through to product detail (variants, sync history tab).
     - **Inventory**: inventory list — per-variant stock rows, last-sync timestamp, manual-refresh option.
     - How to read "sync state" across both surfaces (synced / pending / error).
     - Note that Products and Inventory are synced from the master shop (PrestaShop/WooCommerce) — operators view, not edit, here.
   - **Screenshots needed**:
     - `03-products-list.png` — Products list with sync state chips visible
     - `03-product-detail.png` — product detail with variants
     - `03-inventory-list.png` — Inventory list
   - **Acceptance**: Both Products and Inventory surfaces covered; sync state chips explained; 3 screenshots present.
   - **Dependencies**: Dev stack with synced catalog; Phase 1.

6. **Write `docs/user-guide/04-listings.md`** (#1024)
   - **File**: `docs/user-guide/04-listings.md`
   - **Action**: Cover:
     - **Listings list**: offer status chips (active / activating / inactive / ended), filter by connection, search by SKU/EAN.
     - **Offer creation wizard** at a high level: picking a product, category selection (or EAN barcode lookup), parameters, GPSR data, seller policies, AI description toggle, submit.
     - **Bulk offer creation**: mention briefly that the wizard supports multi-select from the Products page.
     - Do **not** document the full Allegro parameter taxonomy — that's integration-specific. Link to `docs/integrations/allegro/setup-guide.md` for deep dives.
   - **Screenshots needed**:
     - `04-listings-list.png` — Listings list with status chips
     - `04-offer-creation-wizard-category.png` — wizard: category step
     - `04-offer-creation-wizard-parameters.png` — wizard: parameters step
     - `04-offer-creation-wizard-submit.png` — wizard: review & submit step
   - **Acceptance**: Listings list and wizard flow documented; 4 screenshots present; no Planned surfaces (Automations disabled) referenced.
   - **Dependencies**: Dev stack with Allegro connection + at least one synced product; Phase 1.

7. **Write `docs/user-guide/05-orders.md`** (#1024)
   - **File**: `docs/user-guide/05-orders.md`
   - **Action**: Cover:
     - **Orders list**: columns (order ID, source, status, buyer, date, amount), status chip taxonomy, filter bar.
     - **Order detail**: header (status, timeline), line items, buyer/shipping address, activity timeline showing ingestion and processing events.
     - **Shipment panel**: where to see shipment status once dispatched (InPost / carrier).
     - How orders get ingested (webhook-first, poll fallback) — one short paragraph, operator-facing, not API internals.
   - **Screenshots needed**:
     - `05-orders-list.png` — Orders list
     - `05-order-detail-top.png` — order detail header + timeline
     - `05-order-detail-shipment.png` — shipment panel (if active)
   - **Acceptance**: Orders list and detail covered; timeline concept explained; 3 screenshots present.
   - **Dependencies**: Dev stack with at least one ingested order; Phase 1.

### Phase 3 — Section Content (Diagnostics + Platform groups)

8. **Write `docs/user-guide/06-diagnostics.md`** (#1024)
   - **File**: `docs/user-guide/06-diagnostics.md`
   - **Action**: Cover three Diagnostics surfaces:
     - **Jobs & Logs**: what jobs are, the job list (type, status, started, duration), filter by status (queued / running / succeeded / dead), click into a job for logs and payload.
     - **Webhooks**: inbound webhook delivery log — event type, connection, received timestamp, delivery status, payload inspector. How to use it to debug a missing order.
     - **Cursors**: what a cursor is (sync progress bookmark), how to read the cursor key and value, when an operator needs to reset a cursor (stalled sync).
     - Operator playbook callout for each: "If X is stalled, check Y first."
   - **Screenshots needed**:
     - `06-jobs-list.png` — Jobs & Logs list
     - `06-job-detail.png` — single job log + payload
     - `06-webhooks-list.png` — Webhooks delivery log
     - `06-cursors.png` — Cursors page
   - **Acceptance**: All three Diagnostics surfaces covered; at least one "what to do when X stalls" callout per surface; 4 screenshots.
   - **Dependencies**: Dev stack; Phase 1.

9. **Write `docs/user-guide/07-settings-and-admin.md`** (#1024)
   - **File**: `docs/user-guide/07-settings-and-admin.md`
   - **Action**: Cover:
     - **Settings**: general platform settings reachable from the Platform nav group.
     - **AI Provider Settings** (admin-gated): how to configure the active AI provider (Anthropic / OpenAI), where to paste API keys, how to switch providers.
     - **Prompt Templates** (admin-gated): the template list, edit/publish/revert lifecycle, channel axis (master / per-platform), preview pane.
     - **Adapters**: brief — lists registered adapter manifests (adapterKey, version, capabilities). Read-only for the operator.
     - **Theme toggle**: where to find light/dark mode.
     - Use a ⚠️ Admin-only callout for AI-gated sections.
   - **Screenshots needed**:
     - `07-settings.png` — Settings page
     - `07-ai-provider-settings.png` — AI Provider Settings (sanitized keys)
     - `07-prompt-templates.png` — Prompt Templates list
   - **Acceptance**: AI and Settings surfaces covered; admin-gated sections marked; no API keys in screenshots; 3 screenshots.
   - **Dependencies**: Dev stack with admin role; AI provider configured (or placeholder state); Phase 1.

### Phase 4 — Cross-Links and Polish

10. **Add cross-link in `README.md`** (#1024)
    - **File**: `README.md` (root)
    - **Action**: Add a "Operator Guide" entry under the Documentation section (or after the integrations table) linking to `docs/user-guide/README.md`. One line; do not restructure the README.
    - **Accepted change**:
      ```markdown
      - [Operator Guide](./docs/user-guide/README.md) — UI walkthrough for self-hosters (setup + day-to-day usage)
      ```
    - **Acceptance**: Link resolves from the repo root on GitHub.
    - **Dependencies**: Phase 1.

11. **Add hand-off link in `docs/getting-started.md`** (#1024)
    - **File**: `docs/getting-started.md`
    - **Action**: At or near the end of the getting-started guide (after the stack is running and configured), add a "Next: use the platform" paragraph directing the reader to `docs/user-guide/README.md`.
    - **Accepted change** (placed after the final setup step):
      ```markdown
      ## What's next

      Your dev stack is running and your connections are configured.
      → **[Operator Guide](./user-guide/README.md)** — tour of the admin UI, day-to-day usage, and diagnostics.
      ```
    - **Acceptance**: Link resolves from `docs/getting-started.md`.
    - **Dependencies**: Phase 1.

12. **Image audit and sanitization pass** (#1024)
    - **Action**: Review all committed screenshots for:
      - No API keys, passwords, tokens, personal emails, or real customer names visible.
      - Consistent 1440×900 viewport (check image dimensions with `file` or `identify`).
      - Light theme active in every shot.
      - No `/dev/ui` or internal tooling pages captured.
      - No Planned (disabled) nav items highlighted or documented as available.
    - **Tool**: `file docs/user-guide/images/*.png` should show `1440 x 900` for every image.
    - **Acceptance**: All images pass review; a checklist comment in the PR body lists each image checked.
    - **Dependencies**: All section phases complete.

13. **Proofreading and link-check pass** (#1024)
    - **Action**: Read each `.md` file once for:
      - Broken relative links (`[text](./path)` resolves in the filesystem).
      - Alt text present on every `![]()`.
      - `<!-- screenshot: ... -->` recapture comments present above every image embed.
      - Section headings consistent with `README.md` index links.
    - **Acceptance**: No broken links (`find docs/user-guide -name "*.md" | xargs grep -oP '\!\[.*?\]\(.*?\)' | grep -v http` returns no hot-linked external URLs).
    - **Dependencies**: All prior steps complete.

---

## 7. Alternatives Considered (#1024)

### Alternative 1: Single monolithic `docs/user-guide.md` file

- **Description**: One long document covering all surfaces instead of the 7-file structure.
- **Why Rejected**: A single file exceeds GitHub's comfortable inline-render threshold (~500 KB with embedded screenshots), makes per-section PR splits impossible, and breaks deep-link anchors when sections are long. The 7-file structure matches the nav IA 1:1 and enables the "split per nav group" fallback described in the issue Notes.
- **Trade-offs**: Slightly more overhead per section (separate ToC, cross-links); offset by maintainability and the clean per-PR split path.

### Alternative 2: Embed screenshots as hot-links to a CDN / external host

- **Description**: Store images externally and reference by URL; smaller repo size.
- **Why Rejected**: The acceptance criteria explicitly require images committed under `docs/user-guide/images/` with no external hot-links. Externally hosted images break in private/airgapped deployments, which is a core self-hosting use case.
- **Trade-offs**: Larger repo (`~15–30 MB` for 30 screenshots at 1440×900 PNG) vs. guaranteed availability. The existing `docs/plans/*.png` precedent already accepts this trade-off.

### Alternative 3: Automated screenshot via Playwright/Cypress in CI

- **Description**: Capture screenshots programmatically on every merge to keep them up-to-date.
- **Why Rejected**: Out of scope for this issue. Would require a full E2E harness, seeded DB state, and CI infrastructure. Manual-capture with `<!-- screenshot: ... -->` recapture cues is the pragmatic v1. Can be added as a follow-up issue.
- **Trade-offs**: Automated screenshots never go stale but require significant test infra investment.

---

## 8. Validation & Risks (#1024)

### Architecture Compliance

- ✅ No code changes — documentation only. Zero risk of architecture violation.
- ✅ Follows `docs/` structure conventions (existing pattern: `docs/integrations/*/setup-guide.md`).

### Naming Conventions

- ✅ File naming: `docs/user-guide/NN-kebab-name.md` — consistent with existing `docs/plans/` numeric-prefix convention.
- ✅ Image naming: `{NN}-{screen-noun}.png` — descriptive, section-scoped.

### Existing Patterns

- ✅ Cross-link pattern matches `docs/getting-started.md → docs/integrations/*/` existing links.
- ✅ Screenshot embed pattern (`![alt](./images/...)`) matches the README.md existing embeds.

### Risks

- **UI Drift**: The UI may change between screenshot capture and PR merge. Mitigation: `<!-- screenshot: ... -->` recapture comments + a PR checklist reminding reviewers to run the app and spot-check.
- **Planned surfaces (Automations, Shipping, Invoices)**: The disabled nav items are visible in the nav. Mitigation: explicitly note in `01-overview.md` that items marked "Coming in a future release" are not yet functional and are not covered by this guide.
- **Screenshot sanitization failure**: A real API key or customer email inadvertently included. Mitigation: the image audit step (Step 12) plus PR review checklist; use placeholder/fixture data in the dev stack throughout capture.
- **Split PR needed**: If capturing all 7 sections proves too large for one PR (>30 images ≈ 25–30 MB diff), split at the nav group boundary — Connections walkthrough as PR 1, Operations group as PR 2, Diagnostics + Platform as PR 3 — and track under a milestone referencing #1024.

### Edge Cases

- **Section with no current screenshot available** (e.g. Cursors page with empty state): commit a placeholder image or note the placeholder clearly; do not ship a broken `![]()` reference.
- **Admin-gated pages not accessible with non-admin test account**: use the dev-stack admin account as documented in `docs/getting-started.md`.

### Backward Compatibility

- ✅ Adding new files under `docs/user-guide/` and two cross-link additions to existing files are purely additive. No existing links break.

---

## 9. Testing Strategy & Acceptance Criteria (#1024)

### Verification (Documentation Tasks)

Documentation-only tasks have no unit or integration tests. Verification is:

1. **Link-check**: all relative links in `docs/user-guide/*.md` resolve to existing files.
2. **Image-check**: every `![]()` reference points to a file that exists in `docs/user-guide/images/`.
3. **Dimension-check**: `file docs/user-guide/images/*.png` shows `1440 x 900` for all captures.
4. **Secrets-check**: reviewer manually confirms no credentials, tokens, or PII visible in any image.
5. **Coverage-check**: every shipped nav item (Dashboard, Orders, Products, Inventory, Customers, Listings, Jobs & Logs, Webhooks, Cursors, Settings) appears in at least one section.

### Acceptance Criteria (from #1024)

- [ ] `docs/user-guide/README.md` exists and indexes all 7 sections.
- [ ] Each shipped nav surface (Dashboard, Connections, Products, Inventory, Customers, Listings, Orders, Jobs & Logs, Webhooks, Cursors, Settings) is covered by at least one section with at least one embedded screenshot.
- [ ] A complete "connect a platform" walkthrough exists end-to-end (pick platform → wizard → test → connection detail) with screenshots of each step.
- [ ] All images committed under `docs/user-guide/images/` and referenced by relative path (no external hot-links).
- [ ] Screenshots captured at 1440×900; no secrets/credentials/tokens visible in any image.
- [ ] `README.md` and `docs/getting-started.md` link to `docs/user-guide/README.md`.
- [ ] No Planned/unshipped surfaces (Automations, Shipping, Invoices) documented as available.
- [ ] `<!-- screenshot: ... -->` recapture comments present above every image embed.

---

## 10. Alignment Checklist (#1024)

- [x] Follows hexagonal architecture — N/A (docs only)
- [x] Respects CORE vs Integration boundaries — N/A (docs only)
- [x] Uses existing patterns — cross-link + image embed patterns match existing `README.md` and `docs/getting-started.md`
- [x] Idempotency considered — N/A (docs only)
- [x] Event-driven patterns used where applicable — N/A (docs only)
- [x] Rate limits & retries addressed — N/A (docs only)
- [x] Error handling comprehensive — N/A (docs only)
- [x] Testing strategy complete — link/image/secrets verification defined in § 9
- [x] Naming conventions followed — `docs/user-guide/NN-kebab.md`, `images/NN-noun.png`
- [x] File structure matches standards — new `docs/user-guide/` directory; no existing files restructured
- [x] Plan is execution-ready — each step has file path, action, and acceptance criterion
- [x] Plan is saved as markdown file — `docs/plans/implementation-plan-1024-user-guide.md`

---

## Related Documentation

- [Issue #1024](https://github.com/openlinker-project/openlinker/issues/1024) — [TASK] Docs — screenshot-driven end-user platform guide (setup + day-to-day usage)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md) — Shell Layout, screenshot spec (1440×900 light)
- [Getting Started](../getting-started.md) — Developer bootstrap (insertion point for hand-off link)
- [WooCommerce Setup Guide](../../libs/integrations/woocommerce/docs/setup-guide.md) — related per-platform guide
- [Allegro Setup Guide](../../libs/integrations/allegro/docs/setup-guide.md) — related per-platform guide
- [Issue #1022](https://github.com/openlinker-project/openlinker/issues/1022) — WooCommerce screenshot guide (adjacent, do not merge)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
