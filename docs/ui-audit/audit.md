# OpenLinker Frontend — UI/UX Audit (FE-001 Baseline)

**Audited:** 2026-04-19 against `http://localhost:4173/` (Vite preview) with 2 connections, 20 products, 20 inventory items, 1 customer, 1 offer mapping, 14 orders, 4,700+ sync jobs.

**Measured against:** `docs/frontend-ui-style-guide.md`, `docs/frontend-architecture.md`.

**Baseline artifacts:** `docs/ui-audit/baseline/` (34 screenshots + 5 Lighthouse reports).

---

## Table of contents

- [Executive summary](#executive-summary)
- [Severity scale](#severity-scale)
- [Findings by theme](#findings-by-theme)
  - [1. Shell & information architecture](#1-shell--information-architecture)
  - [2. Layout, spacing, whitespace](#2-layout-spacing-whitespace)
  - [3. Identity & labeling](#3-identity--labeling)
  - [4. Status visibility & counters](#4-status-visibility--counters)
  - [5. Tables & density](#5-tables--density)
  - [6. Forms & wizards](#6-forms--wizards)
  - [7. Raw data surfaces](#7-raw-data-surfaces)
  - [8. Empty states & stubs](#8-empty-states--stubs)
- [Findings by page](#findings-by-page)
- [Priority matrix](#priority-matrix)
- [Out of scope](#out-of-scope)

---

## Executive summary

**What works.** Accessibility is already in good shape (Lighthouse 96 across the board). The design tokens, spacing scale, and semantic color system in `index.css` are broadly aligned with the style guide. Tables are used as the dominant surface (correct for a cockpit). Semantic HTML and ARIA wiring are largely correct. Forms use React Hook Form + Zod per the architecture contract.

**What doesn't.** The UI reads as a generic admin template, not a commerce operations cockpit. Three systemic problems dominate:

1. **Identity is opaque.** Every list and detail screen shows internal IDs (`ol_order_7dc2043b1ce8…`, `ol_customer_2f3959…`, connection UUIDs) as the **primary** display value. Operators have to mentally translate UUIDs to mean "the Allegro sandbox connection." The style guide explicitly says names first, IDs as monospace metadata.
2. **Wasted vertical space everywhere.** Every page has ~15–25% of the viewport consumed by an empty "workspace strip" above the page header, plus generous card padding. Dashboard uses ~2 screens for information that would fit on ~1. Connections list has a huge empty band above the 2-row table. Category mappings wastes the right 60% of the screen on an empty-state card.
3. **Shell is noisy.** Every nav item carries a "Live"/"Planned" pill. The top utility bar duplicates workspace context ("Default organization" + "Development" + "Dev" pill + "admin authenticated" all visible simultaneously). "Add connection" sits as a top-level nav item next to "Integrations," duplicating a CTA.

These are not a11y or correctness problems; they are operator-efficiency problems. An operator watching 468 failed jobs should be able to triage at a glance. Today they scroll, squint at UUIDs, and cross-reference tabs.

**Recommended refactor direction.** Address the shell first (nav, top bar, page header primitives), then a shared `DataTable` pattern with name-first row models, then the detail/drilldown pages. Avoid redesigning forms until after the shell lands — they inherit the improvements automatically.

---

## Severity scale

- **P0** — blocks operator workflow or contradicts itself (data lies, counts disagree).
- **P1** — violates the style guide in a visible way that erodes "cockpit" feel across most pages.
- **P2** — inconsistency, polish, one-off improvement.
- **P3** — nice-to-have, defer.

---

## Findings by theme

### 1. Shell & information architecture

**#1.1 — Nav pills ("Live"/"Planned") are visual noise.** `P1` • *every page*
Every one of the 16 nav items has a green "Live" or grey "Planned" pill. That's ~32 tiny badges competing for attention before the operator reads a single label. Pills add no information inside the app (all live routes are live). Remove entirely, or reserve for the 3 "Planned" items — ideally with a subdued treatment.

**#1.2 — "Jobs & Logs" mislabeled as Planned.** `P1` • `/jobs-logs`
Nav shows `Jobs & Logs Planned` yet the route renders a fully working table with 4,677 rows. Labeling drift. (See [#12 Jobs & Logs](#12-jobs--logs))

**#1.3 — "Add connection" does not belong in nav.** `P1` • *every page*
`Add connection` is a top-level nav entry next to `Integrations` and `Adapters`. It is a *CTA*, not a destination. The same button already lives at the top of `/connections`. Remove from nav; it's the single most frequent cross-app leak of style-guide anti-pattern "menu jungle."

**#1.4 — Top utility bar duplicates context.** `P1` • *every page*
The top bar shows: `WORKSPACE Default organization` + `Development` pill + (sidebar already shows) `OpenLinker Dev` + `Default organization` + `admin authenticated`. Four ways to say the same thing. Pick one place for org/env context (top bar), strip from the sidebar header.

**#1.5 — Primary nav does not group by priority.** `P2` • *every page*
Operations and Platform groups are fine, but within Operations the order is alphabetical-ish (Dashboard → Orders → Products → Inventory → Customers → Listings → Cursors → Jobs & Logs → Webhooks → Automations) rather than frequency-of-use. `Cursors` is a debug surface; it shouldn't sit between `Listings` and `Jobs & Logs`. Consider: triage surfaces (Dashboard, Failed Orders, Jobs & Logs) → primary entities (Orders, Products, Inventory, Listings, Customers) → diagnostics (Cursors, Webhooks).

**#1.6 — "Integrations" vs "Connections" naming inconsistency.** `P2` • *nav + page*
Nav label: `Integrations`. Page title: `Connections`. URL: `/connections`. API terminology: `connection`. Pick one noun across the product.

### 2. Layout, spacing, whitespace

**#2.1 — Massive top-of-page empty band.** `P0` • *every authenticated page*
Between the top utility bar and the page header, every page has ~80–120 px of vertical whitespace plus the `WORKSPACE Default organization [Development]` strip. Then the page header adds another ~80 px. The *actual content* starts at roughly 200 px from the top of the viewport — on a 900 px viewport that's 22% of screen lost before the operator reads anything. Compress to ≤100 px total.

**#2.2 — Dashboard cards waste vertical space.** `P1` • `/` ([#02](#02-dashboard))
The 4-metric row is fine. But the 2×2 layout below (Connection health + System health row, Recent jobs + Failed jobs row) creates 4 huge cards each with their own heading + subheading + table. The style guide calls out "prefer tables, compact lists, and timelines over large descriptive cards." On this dashboard the first 5 "sync job" rows are visible only after scrolling.

**#2.3 — Connection detail page is a mosaic.** `P1` • `/connections/:id` ([#15](#15-connection-detail))
A single page stacks: Header, Alert banner, Overview card, Configuration card, Capabilities card, Health card (with its own 10-row table), Operator Actions card. 4–6 major cards in a 12-column grid, each with its own padding and heading. The result: a very long page where no single region dominates and the "Diagnostics" table is the only useful operational surface. Consider tabs (Overview / Health / Actions / Config) or a denser 2-column layout.

**#2.4 — Connections list starts mid-screen.** `P1` • `/connections` ([#14](#14-connections))
2-row table sits below a ~200-px empty region. Strip the empty WORKSPACE strip on list pages or collapse the header.

**#2.5 — Category mapping editor wastes 60% of screen.** `P1` • `/connections/:id/mappings/categories` ([#28](#28-category-mappings))
Left pane shows a single tree node ("Home"); right pane is an empty state that reads "Select a category." Both panes have heavy card chrome. For a mapping editor the pattern should feel like Shopify product variants: compact list on the left, detail inline on the right, no card borders around the editor itself.

**#2.6 — Form widths are unbounded.** `P1` • all wizard pages ([#19](#19-new-connection-prestashop), [#20](#20-new-connection-allegro), [#27](#27-connection-edit), [#34](#34-new-connection-advanced))
Inputs stretch the full width of the content column (~900 px on a 1440 viewport). Per the style guide, forms should be "concise" and "sectional." Max-width of 560–640 px for single-column forms; 2-column grid for paired fields.

### 3. Identity & labeling

**#3.1 — Raw internal IDs shown as primary labels.** `P0` • [#03](#03-orders-list), [#04](#04-order-detail), [#09](#09-customers), [#11](#11-cursors), [#12](#12-jobs--logs), [#22](#22-customer-detail)
- Orders list `ORDER ID` column shows `ol_order_f8a0bf168…` as the only identifier; no order number, no marketplace reference.
- Order detail heading: `Order — ol_order_7dc2043b1ce84dd4a82e0e773aa117f9`. The `orderNumber` field (`55e40ca0-3b4f-11f1-abf9-01a34c9125cd`) exists in the snapshot but isn't promoted.
- Customers list shows `ol_customer_2f3959408a3a441398dcfd804075995f` with `Name: —`, even though the customer projection has an `normalizedEmail`.
- Inventory list shows Product NAME but the variant column shows `—` everywhere.
- Jobs list shows `CONNECTION` as a raw UUID. Same UUID on every row.
- Connection cursors page shows connection ID only.

**Fix direction:** every row/entity must resolve to a human name (connection name, product name, marketplace order number, customer email hash short-form). Internal IDs stay reachable — in monospace, secondary, copy-to-clipboard — but never as the primary heading or first column.

**#3.2 — "Source Connection" column is always a UUID.** `P0` • [#03](#03-orders-list), [#04](#04-order-detail)
On every order row, `SOURCE CONNECTION` reads `e4d31124-f69c-4ec5-b843-fcf721c56314`. That's "Allegro sandbox." The frontend already has a `useConnectionsQuery`; join in-memory and display the name.

**#3.3 — Customer label is "dash" when name is missing.** `P2` • [#09](#09-customers)
When first/last name are missing (common for Allegro buyers), the table shows `—`. Fall back to masked email (`pa315mqn8b…@allegromail.pl`), then to short ID. Never `—` as the label.

**#3.4 — No connection name on Listings rows.** `P2` • [#10](#10-listings)
Shows `allegro` (platform) and the connection UUID. Replace with connection name.

**#3.5 — Order detail lacks an order-number context.** `P1` • [#04](#04-order-detail)
Page title uses the internal UUID. An operator opening this page from an email/slack link has no idea which marketplace order it corresponds to until they scroll to the Order Snapshot JSON blob.

### 4. Status visibility & counters

**#4.1 — Counter contradiction between dashboard and failed-orders page.** `P0` • [#02](#02-dashboard) vs [#05](#05-orders-failed)
Dashboard says `FAILED JOBS 468` (on the left, in huge numerals). `/orders/failed` says `0 failed — No failed orders. All orders are syncing successfully.` Same UI, different count, conflicting reassurance. They measure different things (all jobs vs `marketplace.order.sync` jobs) but the operator cannot tell. Either harmonize the counters, narrow the scope in both places, or link from one to the other with explicit scope labels.

**#4.2 — Order destination status = failed, but page says "Order sync status."** `P0` • [#04](#04-order-detail)
Order detail shows one sync entry: `0bfa1b70-…` (PrestaShop connection UUID), status `failed`, error "Failed to create PrestaShop order: Country with ISO2 code 'PL (country exists bu…" (truncated). This is the most valuable single piece of information on the page and it's rendered in a table cell with ellipsis. Elevate failed destinations to a prominent banner at the top (matches style-guide "status first" principle).

**#4.3 — Dashboard metric cards don't hint at severity.** `P1` • [#02](#02-dashboard)
`FAILED JOBS 468` is shown in black/default color. 468 is almost certainly a bad number, but the card gives no status tinting (no soft red border, no arrow/trend). Use `--status-error-soft` surface + `--status-error-border` when the count is nonzero. Apply a ratio/trend indicator if feasible.

**#4.4 — Status badges are correct but lonely.** `P2` • [#14](#14-connections), [#15](#15-connection-detail), [#03](#03-orders-list)
`active`/`failed`/`succeeded` pills use the right colors and always include text (good). But on the Connections list, the single-word `active` badge is the only status signal — there's no "last activity" or "last error" column. Style guide says "important entities should expose both current status and recency." Add `Last synced`, `Last error`, or a small activity heatline.

**#4.5 — Dashboard "All channels active" is too reassuring.** `P2` • [#02](#02-dashboard)
When 468 jobs are failing, reading "All channels active" on the Integration Health card is misleading. A channel is "active" in the DB but its jobs are failing in reality. Either change the copy or aggregate job failures into the channel health signal.

### 5. Tables & density

**#5.1 — Tables have too much vertical padding.** `P1` • [#03](#03-orders-list), [#06](#06-products), [#08](#08-inventory), [#12](#12-jobs--logs)
Each row is ~44 px tall with only ~20 px of actual content. On a 900 px viewport, orders list shows only 13 rows at once — dashboard shows only 5. Style guide: "dense but readable rows." Target 36 px rows; use 32 px for "compact" mode operators can toggle.

**#5.2 — Action column is always "View" link.** `P1` • every list
Every list table ends with a column whose only content is a link reading "View". That column occupies real estate for a pattern already achieved by "click the row." Remove the column; make the entire row clickable and use a link-wrapper (`a` element) for keyboard navigation. Add a secondary actions menu (•••) for bulk/single row actions when we have retry/pause/delete.

**#5.3 — Pagination controls are sparse.** `P2` • every list
`Previous | Next` with total count is fine for small datasets but Jobs & Logs has 4,677 rows and only offers `Previous (disabled) | Next`. Add: page size selector, jump-to-end, and URL-synced cursor so operators can share links.

**#5.4 — Error text truncation hides the important part.** `P1` • [#12](#12-jobs--logs), [#02](#02-dashboard)
Error strings like `"Master inventory sync failed (externalId: 36): insert or upd…"` are truncated with ellipsis after ~60 chars. The cause ("foreign key constraint…") is never visible without clicking through. Either show the first line of the real error (drop the prefix), or use a 2-line clamp with a tooltip.

**#5.5 — Column widths are uneven.** `P2` • [#03](#03-orders-list)
Order ID column is ~28% of the table; sync status column is ~8%. Rebalance so status is prominent and IDs use their natural width.

**#5.6 — No sorting indicators.** `P1` • every list
Style guide calls for sortable columns. No click-to-sort headers present today. At minimum mark CREATED/UPDATED columns sortable.

### 6. Forms & wizards

**#6.1 — Wizard pages are not stepped.** `P1` • [#19](#19-new-connection-prestashop), [#20](#20-new-connection-allegro)
Both "Connect PrestaShop" and "Connect Allegro" are single-screen long forms. Style guide: "integration onboarding should prefer step-by-step flows." Break into: (1) Credentials, (2) Capabilities, (3) Master catalog / mappings, (4) Review & connect.

**#6.2 — Advanced mode is an escape hatch but disguises as a primary option.** `P2` • [#18](#18-new-connection-picker)
Picker screen offers PrestaShop, Allegro, then a small "Use advanced mode" link. OK for devs; but the advanced form page ([#34](#34-new-connection-advanced)) is the same visual weight as the guided flows — it should be clearly labeled as an escape hatch (yellow/warning tone header, explicit "you probably want the guided flow" recommendation).

**#6.3 — Capability checkboxes all default to checked.** `P1` • [#19](#19-new-connection-prestashop)
ProductMaster, InventoryMaster, OrderSource, OrderProcessorManager all pre-checked. For a novice operator, this is fine; for someone who knows PrestaShop will only ever receive orders (not source them), they have to untick. The help text on each checkbox is good; but consider whether unticking capabilities actually results in different behavior or if it's cosmetic. If cosmetic, remove the checkboxes.

**#6.4 — "Product catalog connection" select in Allegro wizard is mandatory-in-spirit but optional in UI.** `P1` • [#20](#20-new-connection-allegro)
The field says "Optional — can be configured later." Past issue #206 showed that forgetting this results in offers never linking. Either make it required (with a dropdown that auto-selects the only ProductMaster connection) or add a prominent warning below "None (configure later)" about the consequences.

**#6.5 — Form error surface is invisible.** `P1` • all forms
Forms use React Hook Form + FormField but no validation summary is visible today. On submission failure the style guide expects `FormErrorSummary` (already a shared component per `docs/frontend-architecture.md`). Audit whether it's actually rendered.

**#6.6 — Connection edit form exposes raw Config JSON textarea.** `P1` • [#27](#27-connection-edit)
For the operator flow this is too low-level. Split into: name (text), config (structured form with a "JSON view" toggle). Advanced mode should still exist but default-hidden.

### 7. Raw data surfaces

**#7.1 — JSON blobs rendered as untitled `<pre>` with no controls.** `P1` • [#04](#04-order-detail), [#15](#15-connection-detail), [#24](#24-listing-detail), [#25](#25-job-detail-succeeded)
Order Snapshot, Config JSON, Context JSON, and Payload JSON all render the same way: a bare `StaticText` with the JSON serialized. No syntax highlighting, no copy button, no collapse/expand. Style guide explicitly lists `RawPayloadPanel` as a core primitive. Build it once; use across all pages.

**#7.2 — Hashed/sensitive values displayed without copy affordance.** `P2` • [#09](#09-customers), [#22](#22-customer-detail)
Email hash (`c2f6ed94def15310042192c120844c51…`) has no copy button. For debugging, operators will need to paste it — make it a click-to-copy field.

**#7.3 — Email displayed with Allegro-masked format.** `P2` • [#22](#22-customer-detail)
`Normalized Email: pa315mqn8b+78c501e63@user.allegrogroup.pl`. Show alongside a brief "what is this" hint (masked email from Allegro) — the style guide values "debuggable by design."

### 8. Empty states & stubs

**#8.1 — Planned stubs are identical to each other.** `P1` • [#29](#29-automations-stub), [#30](#30-shipping-stub), [#31](#31-invoices-stub)
Three pages differ only in their heading. Each is a full-page "This route is intentionally available now so future feature work can land without changing the shell structure or navigation contracts." That's developer rationale, not operator information. Either hide these from nav until they have value, or replace the body with an operator-facing "what will live here eventually" (one sentence + crossed-out functionality preview).

**#8.2 — "EMPTY STATE" label is a word above the empty-state component.** `P1` • [#05](#05-orders-failed), [#13](#13-webhook-deliveries), [#16](#16-connection-mappings), [#22](#22-customer-detail), [#28](#28-category-mappings)
Every empty state renders a `StaticText "EMPTY STATE"` eyebrow above the heading. That's a debug affordance, not copy. Either remove the eyebrow entirely or replace with contextual labels ("No failed orders" is the heading; the eyebrow is redundant).

**#8.3 — Empty states are oversized.** `P1` • [#16](#16-connection-mappings), [#28](#28-category-mappings)
Connection mappings empty state is a big card with a heading, subtext, and a collapsed form below. Category mappings empty state takes 60% of the viewport. These are the default states on pages operators open frequently. Shrink to 1/4 of the height or merge with the input surface so there's no "add your first" detour.

---

## Findings by page

References use the [baseline screenshot numbers](./baseline/README.md).

### #01 Login

- `P3` Card is centered on a large empty canvas — anti-pattern per style guide ("do not optimize for empty whitespace"). Acceptable for a login screen, but tightening the card + reducing empty area would make the app feel denser across the board.
- `P2` "Forgot password?" link is right-aligned next to the Sign in button. Unusual placement — typically below the form.
- `P3` No "Remember me" checkbox; not required for MVP.

### #02 Dashboard

- `P0` Counter contradiction with `/orders/failed` (see [#4.1](#41--counter-contradiction-between-dashboard-and-failed-orders-page)).
- `P1` Metric cards don't tint by severity (see [#4.3](#43--dashboard-metric-cards-dont-hint-at-severity)).
- `P1` "All channels active" while 468 jobs fail (see [#4.5](#45--dashboard-all-channels-active-is-too-reassuring)).
- `P1` Big cards instead of dense lists (see [#2.2](#22--dashboard-cards-waste-vertical-space)).
- `P1` Truncated error strings (see [#5.4](#54--error-text-truncation-hides-the-important-part)).
- `P2` "Refresh" button top-right has no timestamp of last refresh.
- `P2` No link from "Failed jobs" card to `/jobs-logs?status=dead`.

### #03 Orders list

- `P0` Raw IDs as primary labels (see [#3.1](#31--raw-internal-ids-shown-as-primary-labels), [#3.2](#32--source-connection-column-is-always-a-uuid)).
- `P1` Each row has a redundant "View" link column (see [#5.2](#52--action-column-is-always-view-link)).
- `P1` Row padding too heavy (see [#5.1](#51--tables-have-too-much-vertical-padding)).
- `P1` No sorting (see [#5.6](#56--no-sorting-indicators)).
- `P2` Filter is a single `All statuses` dropdown — no filter by connection, date range, or order number search.
- `P2` Link `Failed Orders` top-right: pills on `/orders/failed` say 0, so this button leads nowhere useful today.

### #04 Order detail

- `P0` Destination failure buried in a table cell (see [#4.2](#42--order-destination-status--failed-but-page-says-order-sync-status)).
- `P1` Title is a UUID (see [#3.5](#35--order-detail-lacks-an-order-number-context)).
- `P1` JSON blob rendering (see [#7.1](#71--json-blobs-rendered-as-untitled-pre-with-no-controls)).
- `P1` No operator actions on this page (retry, cancel, view connection). Detail pages must expose triage actions.
- `P1` "Updated" reads `18 Apr 2026, 17:58` while "Created" reads `18 Apr 2026, 19:58` — updated is *before* created. Likely a timezone bug (UTC vs local).
- `P2` "Source Connection" is a UUID; "Destination" in the sync table is a UUID.

### #05 Orders / Failed

- `P0` "0 failed" contradicts dashboard ([#4.1](#41--counter-contradiction-between-dashboard-and-failed-orders-page)).
- `P1` "EMPTY STATE" eyebrow (see [#8.2](#82--empty-state-label-is-a-word-above-the-empty-state-component)).
- `P2` Filter row for a page that might never have data (unless the order record feature is wired in as per issue #235).

### #06 Products list

- `P1` Price column shows no currency symbol — all values read "13.90", "12.90" with no "PLN" or "€".
- `P1` No image column. For a product catalog UI this is a significant omission.
- `P1` No `EXTERNAL IDS` column — operators can't tell which products are Allegro-linked.
- `P1` Action column is "View" link (see [#5.2](#52--action-column-is-always-view-link)).
- `P2` Search box is only one input; no category/status/price-range filters.

### #07 Product detail

- `P1` Variant table has columns SKU / EAN / GTIN / ATTRIBUTES / EXTERNAL IDS — good, but GTIN column is always `—` and ATTRIBUTES is always `—`. Hide empty columns dynamically, or keep them and note "None recorded" in the cell with a muted icon.
- `P1` Stock shows `100` but no "Low stock" indicator or threshold.
- `P2` No product image.
- `P2` External IDs section shows only `prestashop — 20`. Hard to tell if this means "PrestaShop product ID 20." Add label and copy button.

### #08 Inventory list

- `P1` "VARIANT ID" column shows `—` on every row. If variants aren't modeled for single-product SKUs, collapse the column.
- `P1` `AVAILABLE` is left-aligned (should be right-aligned for numerical values per common table conventions).
- `P1` No reorder-threshold or "needs reorder" status signal.
- `P2` Filter is "Filter by product ID" + "Filter by variant ID" — both take UUIDs, neither is searchable by name.

### #09 Customers list

- `P0` `NAME` column shows `—` for the only customer (see [#3.3](#33--customer-label-is-dash-when-name-is-missing)).
- `P1` EMAIL HASH column exposes the full hash (64 chars) — truncate + copy button.
- `P2` No summary row of "orders / last seen / total spent."

### #10 Listings (Offer mappings)

- `P1` Row shows external ID (`7781493452`), internal ID (`ol_product_7434e8bb…`), platform, "Offer", connection UUID, created date. No offer name/title.
- `P1` No status column — if the offer is retired/ended on Allegro, operator can't tell.
- `P2` "Entity Type" column shows `Offer` for every row (it's the only thing this page shows). Drop.

### #11 Cursors

- `P1` Route is a debug surface. Should be hidden from top-level nav and nested under an "Advanced" / "Diagnostics" sub-nav, or demoted per [#1.5](#15--primary-nav-does-not-group-by-priority).
- `P2` `VALUE` column shows `MTc3NjUzNTAyMjEyNTAyNw` (base64) — add a decoded tooltip.
- `P2` No "last event" timestamp in operator-readable form beyond "17h ago."

### #12 Jobs & Logs

- `P1` Nav says Planned but page is live ([#1.2](#12--jobs--logs-mislabeled-as-planned)).
- `P1` Truncated error strings (see [#5.4](#54--error-text-truncation-hides-the-important-part)).
- `P1` CONNECTION column is UUID (see [#3.1](#31--raw-internal-ids-shown-as-primary-labels)).
- `P1` No retry / abort / force-dead row actions — typical operator moves from a Jobs page.
- `P1` No attempt-number coloring — rows at `9/10` attempts should visibly differ from `0/10`.
- `P2` Page title "Sync Jobs" but nav says "Jobs & Logs" — label drift.

### #13 Webhook deliveries

- `P1` Empty state on what is a critical debugging page — the operator has to know webhooks are empty without landing on the page repeatedly.
- `P2` Filters (status / provider / connection) are present but the page shows empty state — filters should be disabled or hidden when there's no data.

### #14 Connections

- `P1` Connections list starts mid-screen (see [#2.4](#24--connections-list-starts-mid-screen)).
- `P1` No health indicator per connection beyond `active`/`disabled`/`error` — a connection with 468 failing jobs still reads `active`.
- `P1` "New connection" button is top-right; same functionality exists in nav (see [#1.3](#13--add-connection-does-not-belong-in-nav)).

### #15 Connection detail

- `P1` Mosaic of cards (see [#2.3](#23--connection-detail-page-is-a-mosaic)).
- `P1` Health diagnostics table is dense and useful — but buried below Configuration/Capabilities. Elevate.
- `P1` Alert banner about "Product catalog not linked" is good, but only shows when misconfigured. Add similar banners for "X jobs failing in last 24h."
- `P2` "Credentials: DB-managed" has no action — can the operator rotate them?
- `P2` Operator Actions card has 4 buttons stacked (Test, Edit, Trigger sync, Disable). Convert to a single action bar.
- `P2` "Trigger sync…" opens a modal presumably — no preview of what happens.

### #16 Connection mappings

- `P1` Tabs are visually OK (Order Statuses / Carriers / Payments) but the empty state + form below duplicates heading/chrome.
- `P1` Two-select "add a mapping" pattern is fine but doesn't preview whether the mapping will take effect on pending orders.
- `P2` Nothing to validate mappings against: no list of "unmapped statuses seen in source data."

### #17 Adapters

- `P1` Page is "read-only catalog" — but only 2 adapters exist. Design still takes full page. Consider merging with Integrations list (group connections by adapter).
- `P2` Capability badges wrap oddly (4 badges on PrestaShop row stack vertically narrow).

### #18 New connection picker

- `P1` Two tile options (PrestaShop + Allegro) — fine, but they each link to their own route. Future platforms will scale this to a grid.
- `P2` "Use advanced mode" is a link; make the intention clearer (see [#6.2](#62--advanced-mode-is-an-escape-hatch-but-disguises-as-a-primary-option)).

### #19 New connection / PrestaShop

- `P1` Long single-page form (see [#6.1](#61--wizard-pages-are-not-stepped)).
- `P1` Capability checkboxes all pre-checked (see [#6.3](#63--capability-checkboxes-all-default-to-checked)).
- `P1` "Connection name" field has no default — auto-suggest based on shop URL ("Shop at example.com") would reduce friction.
- `P2` No inline "Test connection" before submission.

### #20 New connection / Allegro

- `P1` Same wizard problems as #19.
- `P1` `Product catalog connection` says optional but is effectively required ([#6.4](#64--product-catalog-connection-select-in-allegro-wizard-is-mandatory-in-spirit-but-optional-in-ui)).
- `P2` Environment dropdown (Sandbox / Production) should warn prominently when switching to Production.

### #21 Settings

- `P1` Only 1 of the 5 sections is actionable (Environment, Account). Notifications / Organization / Preferences all say "Coming soon." Consider only showing sections that work.
- `P2` Account section says "Read-only" — no way to change email, reset password from inside the app.
- `P2` Build-time config (API base URL) exposes infrastructure info to the operator; acceptable in dev, hide in production.

### #22 Customer detail

- `P1` Heading is the raw customer UUID (see [#3.1](#31--raw-internal-ids-shown-as-primary-labels)).
- `P1` Addresses section renders empty state with debug eyebrow (see [#8.2](#82--empty-state-label-is-a-word-above-the-empty-state-component)).
- `P1` No list of this customer's orders — major debug value left on the table.
- `P2` Normalized email has no explanation (see [#7.3](#73--email-displayed-with-allegro-masked-format)).

### #23 Inventory detail

- `P1` Heading is the raw UUID.
- `P1` Sparse page — 8 key-value pairs with no related orders, activity, or sync history.
- `P2` No "Adjust stock" action.

### #24 Listing detail

- `P1` Heading is the external ID ("Mapping — 7781493452"), better than UUID but still not the offer title.
- `P1` "Edit offer" button in top-right — unclear what it opens.
- `P2` No link to the product it's mapped to (internal ID is there but no navigation).

### #25 Job detail (succeeded)

- `P1` Payload JSON has no syntax highlight / copy button (see [#7.1](#71--json-blobs-rendered-as-untitled-pre-with-no-controls)).
- `P1` "Next run at" shown for a `succeeded` job is misleading — either suppress or clearly label as "scheduled successor."

### #26 Job detail (failed/retrying)

- `P1` Error line wraps and is the most important content on the page, but rendered in default body text with no tinting.
- `P1` No retry button.
- `P1` No stack trace / attempts history (only "last error").

### #27 Connection edit

- `P1` Raw `Config JSON` textarea (see [#6.6](#66--connection-edit-form-exposes-raw-config-json-textarea)).
- `P2` "Platform type" field is disabled — OK, but give a hint why (can't change platform after creation).
- `P2` No "Disable connection" or "Delete connection" actions — they live on the detail page, so cross-linking is needed.

### #28 Category mappings

- `P1` Wasted screen space (see [#2.5](#25--category-mapping-editor-wastes-60-of-screen)).
- `P1` Single "Home" category — expand the tree by default to show context.
- `P1` Right pane empty state (see [#8.3](#83--empty-states-are-oversized)).

### #29–31 Planned stubs (Automations / Shipping / Invoices)

- `P1` Same placeholder body on all three (see [#8.1](#81--planned-stubs-are-identical-to-each-other)).
- `P2` Planned tag duplicated in nav pill and on the page — pick one.

### #32 Forgot password

- `P2` Standard card pattern consistent with login.

### #33 Reset password

- `P2` No password strength indicator.
- `P2` No visibility toggle (show/hide password).

### #34 Advanced new connection

- `P1` Looks identical to the guided wizards — it should look like an escape hatch (yellow/warning-styled header).
- `P2` "Credentials reference" field is cryptic without context — add a "What is this?" hyperlink.

---

## Priority matrix

A rough ranking of refactor *value* against *effort*, to inform the phased plan. High value + low effort comes first.

| Finding | Severity | Effort | Recommended phase |
|---|---|---|---|
| [#3.1](#31--raw-internal-ids-shown-as-primary-labels) raw IDs as primary labels | P0 | M | Phase 3 — list + detail primitives |
| [#4.1](#41--counter-contradiction-between-dashboard-and-failed-orders-page) counter contradiction | P0 | S | Phase 2 — shell cleanup |
| [#4.2](#42--order-destination-status--failed-but-page-says-order-sync-status) failed status buried | P0 | S | Phase 3 — detail primitives |
| [#2.1](#21--massive-top-of-page-empty-band) top-of-page whitespace | P0 | S | Phase 2 — shell cleanup |
| [#1.1](#11--nav-pills-liveplanned-are-visual-noise) nav pills | P1 | XS | Phase 2 |
| [#1.3](#13--add-connection-does-not-belong-in-nav) add connection in nav | P1 | XS | Phase 2 |
| [#1.4](#14--top-utility-bar-duplicates-context) top-bar duplication | P1 | S | Phase 2 |
| [#7.1](#71--json-blobs-rendered-as-untitled-pre-with-no-controls) RawPayloadPanel primitive | P1 | M | Phase 3 |
| [#5.2](#52--action-column-is-always-view-link) redundant View column | P1 | S | Phase 3 |
| [#5.1](#51--tables-have-too-much-vertical-padding) row padding | P1 | XS | Phase 3 |
| [#5.4](#54--error-text-truncation-hides-the-important-part) error truncation | P1 | S | Phase 3 |
| [#2.3](#23--connection-detail-page-is-a-mosaic) connection detail mosaic | P1 | L | Phase 4 — detail pages |
| [#6.1](#61--wizard-pages-are-not-stepped) wizard stepping | P1 | L | Phase 5 — forms & wizards |
| [#2.6](#26--form-widths-are-unbounded) form widths | P1 | XS | Phase 5 |
| [#8.2](#82--empty-state-label-is-a-word-above-the-empty-state-component) EMPTY STATE eyebrow | P1 | XS | Phase 2 |

**Phase mapping** (forward reference to the phased plan in step 6):
- Phase 1 — tokens & typography audit
- Phase 2 — shell (nav, top bar, page header, breadcrumbs)
- Phase 3 — shared primitives (`DataTable`, `StatusBadge`, `RawPayloadPanel`, `MetricCard`, `KeyValueList`)
- Phase 4 — detail pages (order, connection, product, customer)
- Phase 5 — forms & wizards (SetupStepper, connection wizards, mapping editors)
- Phase 6 — dashboard + triage surfaces

---

## Out of scope

- Allegro OAuth callback UX — live token required to capture.
- Performance optimization — Lighthouse best-practices = 100, no signal that the app is slow.
- Full a11y remediation — Lighthouse a11y = 96 across the board. Address the remaining 4% during the primitives phase (Phase 3).
- Internationalization — product is English-only for FE-001.
- Interactive editing on mobile for complex editors (mapping editors, wizards stay desktop-first).

## Scope expansion (2026-04-20)

Per review: **mobile (≤ 767 px) and tablet (768–1023 px) layouts are in scope.** Treat as a 4th cross-cutting theme alongside Shell, Identity, Status. New finding:

### 9. Responsive coverage

**#9.1 — Nothing is responsive below 1024 px.** `P1` • *every page*
Every baseline screenshot was captured at 1440 × 900 because the app is effectively desktop-only. Below ~1024 px the sidebar consumes too much width, tables overflow horizontally, and the top bar wraps awkwardly. **Operators should be able to triage failures from a phone during off-hours and from an iPad on the shop floor.** Full interactive editing on small screens is explicitly out of scope — but read + triage must work everywhere.

**Parity rules** (codified in `docs/plans/implementation-plan-ui-refactor.md §5`):
- Mobile: drawer nav, card-view tables, single-column detail pages, KPI strip stacked vertically.
- Tablet: drawer or persistent rail nav, tables with column hiding, 2×2 KPI grid.
- Desktop: current design anchor.
- Complex editors (category mappings, wizards, raw-config JSON): show "open on desktop to edit" below 1024 px.

Each phase PR carries after-shots at **three widths** (360 / 768 / 1440) so responsive regressions are caught in review.
