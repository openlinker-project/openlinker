# OpenLinker — Operator Guide

OpenLinker is a self-hosted orchestration platform that keeps your shop and the marketplaces you sell on in sync — orders, inventory, listings, and content — from a single admin UI. This guide is for operators and self-hosters who have OpenLinker running and want a tour of that UI: what each screen does, how to connect a platform, and what to look at when something stalls.

If you haven't set up the platform yet, start with **[Getting Started](../getting-started.md)** — it walks you from a clean machine to a working PrestaShop + Allegro install. Come back here once the stack is running and you've logged in for the first time.

The guide is organized around the left-navigation groups in the admin UI:

---

## Sections

1. **[Overview & First Login](./01-overview.md)**
   Shell layout, nav groups, dashboard orientation, and first-login flow.

2. **[Connecting a Platform](./02-connecting-a-platform.md)**
   Full walkthrough: pick a platform, run the setup wizard, test the connection, read connection health. Uses PrestaShop as the worked example.

3. **[Catalog & Inventory](./03-catalog-and-inventory.md)**
   Products list and detail, inventory per-variant stock, sync state chips, and how to tell when a sync has stalled.

4. **[Invoices](./04-invoices.md)**
   Issuing invoices per order, the Invoices list and detail pages, regulatory (KSeF) clearance status, and fiscal-safety retry rules.

5. **[Listings & Offers](./05-listings.md)**
   Listings list, offer status chips, and the offer-creation wizard end-to-end: category, parameters, GPSR, seller policies, AI description, submit.

6. **[Orders](./06-orders.md)**
   Orders list, order detail, status timeline, line items, and the shipment panel.

7. **[Diagnostics](./07-diagnostics.md)**
   Jobs & Logs, Webhooks, and Cursors — how to inspect and unblock a stalled sync.

8. **[Settings & Admin](./08-settings-and-admin.md)**
   General settings, AI provider configuration, prompt templates, and the Adapters registry.

---

## Prerequisites

- OpenLinker is installed and the API + web app are running (see [Getting Started](../getting-started.md)).
- You have admin credentials — on first boot the API prints them to the log once; use the **Forgot password?** flow on the login screen if you've lost them.
- At least one connection configured (PrestaShop or WooCommerce as the master shop, Allegro as the marketplace) is assumed for most screenshots. The [Connecting a Platform](./02-connecting-a-platform.md) section covers adding connections from scratch.

---

## Screenshot notes

All screenshots in this guide were captured at **1440×900, dark theme**. The UI also ships a light theme (toggle in the top bar). If your app looks different, you may be on a different version — the recapture comments above each image note what should be visible.

**Invoices** is a fully functional nav item covered in section 4 above. The **Automations** nav item is still a planned future feature — it's visible in the sidebar in a muted style but is not yet functional and is not covered by this guide.
