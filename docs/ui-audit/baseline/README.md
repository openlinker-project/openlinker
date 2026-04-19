# UI Refactor — Baseline Capture

Captured against `http://localhost:4173` (Vite preview build) on 2026-04-19 with real seeded data: 2 connections (PrestaShop + Allegro sandbox), 20 products, 20 inventory items, 1 customer projection, 1 offer mapping, 14 persisted orders (all `failed` destination status), 4,677 sync jobs (468 failed).

Viewport: 1440×900 desktop. Session: `admin`.

## Screenshots

| # | Route | File |
|---|---|---|
| 01 | `/login` (unauth) | `screenshots/01-login.png` |
| 02 | `/` — Dashboard | `screenshots/02-dashboard.png` |
| 03 | `/orders` — list | `screenshots/03-orders-list.png` |
| 04 | `/orders/:id` — detail | `screenshots/04-order-detail.png` |
| 05 | `/orders/failed` — triage queue | `screenshots/05-orders-failed.png` |
| 06 | `/products` — list | `screenshots/06-products.png` |
| 07 | `/products/:id` — detail | `screenshots/07-product-detail.png` |
| 08 | `/inventory` — list | `screenshots/08-inventory.png` |
| 09 | `/customers` — list | `screenshots/09-customers.png` |
| 10 | `/listings` — offer mappings | `screenshots/10-listings.png` |
| 11 | `/cursors` | `screenshots/11-cursors.png` |
| 12 | `/jobs-logs` — sync jobs | `screenshots/12-jobs-logs.png` |
| 13 | `/webhook-deliveries` — empty state | `screenshots/13-webhook-deliveries.png` |
| 14 | `/connections` — list | `screenshots/14-connections.png` |
| 15 | `/connections/:id` — detail | `screenshots/15-connection-detail.png` |
| 16 | `/connections/:id/mappings` — mapping editor | `screenshots/16-connection-mappings.png` |
| 17 | `/adapters` — catalog | `screenshots/17-adapters.png` |
| 18 | `/connections/new` — platform picker | `screenshots/18-new-connection-picker.png` |
| 19 | `/connections/new/prestashop` — wizard | `screenshots/19-new-connection-prestashop.png` |
| 20 | `/connections/new/allegro` — wizard | `screenshots/20-new-connection-allegro.png` |
| 21 | `/settings` | `screenshots/21-settings.png` |
| 22 | `/customers/:id` — detail | `screenshots/22-customer-detail.png` |
| 23 | `/inventory/:id` — detail | `screenshots/23-inventory-detail.png` |
| 24 | `/listings/:id` — offer mapping detail | `screenshots/24-listing-detail.png` |
| 25 | `/jobs-logs/:id` — succeeded job | `screenshots/25-job-detail-succeeded.png` |
| 26 | `/jobs-logs/:id` — failed/retrying job | `screenshots/26-job-detail-failed.png` |
| 27 | `/connections/:id/edit` — edit form | `screenshots/27-connection-edit.png` |
| 28 | `/connections/:id/mappings/categories` — category mapping editor | `screenshots/28-category-mappings.png` |
| 29 | `/automations` — planned stub | `screenshots/29-automations-stub.png` |
| 30 | `/shipping` — planned stub | `screenshots/30-shipping-stub.png` |
| 31 | `/invoices` — planned stub | `screenshots/31-invoices-stub.png` |
| 32 | `/forgot-password` (unauth) | `screenshots/32-forgot-password.png` |
| 33 | `/reset-password/:token` (unauth) | `screenshots/33-reset-password.png` |
| 34 | `/connections/new/advanced` — advanced wizard | `screenshots/34-new-connection-advanced.png` |

## Lighthouse (desktop navigation mode)

Run against a representative subset spanning the main page patterns.

| # | Route | A11y | Best Practices | SEO | Report |
|---|---|---|---|---|---|
| 01 | `/` Dashboard | 96 | 100 | 82 | `lighthouse/01-dashboard.html` |
| 02 | `/orders` list | 96 | 100 | 82 | `lighthouse/02-orders-list.html` |
| 03 | `/orders/:id` detail | 96 | 100 | 82 | `lighthouse/03-order-detail.html` |
| 04 | `/connections/:id` health | 96 | 100 | 82 | `lighthouse/04-connection-detail.html` |
| 05 | `/connections/new/allegro` form | 96 | 100 | 82 | `lighthouse/05-new-connection-allegro.html` |

**Signal:** a11y + best-practices are already in good shape (96 / 100 across the board). The refactor opportunity is visual, informational, and interaction-level — not accessibility remediation.

## Pages not captured

- `/integrations/allegro/connect/callback` — transient OAuth callback, requires live state/token.
- No other live routes missing.

## Notes during capture

Observations worth carrying into the audit:

- `/orders/failed` shows **"0 failed"** while the Dashboard shows **468 failed jobs**. Different scopes (order-sync jobs vs all jobs), but the counts read as contradictory to an operator.
- Every list surface exposes raw internal IDs (`ol_order_...`, `ol_customer_...`, connection UUIDs) as the primary display value. The cockpit-style guide calls for names first, IDs in monospace metadata.
- Every detail page renders `Source Connection` as a raw UUID instead of "Allegro sandbox".
- Sidebar IA: `Add connection` appears as a top-level nav item alongside `Integrations` and `Adapters`. The top-level slot duplicates the CTA that already lives on the Integrations list.
- "Live"/"Planned" badges next to every nav item add visual weight but low information density.
- Jobs & Logs nav label says "Planned" while the route actually works and shows 4,677 rows — labeling drift.
