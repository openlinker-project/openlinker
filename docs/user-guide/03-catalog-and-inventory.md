# Catalog & Inventory

OpenLinker treats your master shop (PrestaShop or WooCommerce) as the single source of truth for product data and stock levels. The Products and Inventory surfaces in the admin UI are read-only views into that synced state — you manage products in your shop, and OpenLinker keeps its copy in sync.

---

## Products

Open **Products** in the sidebar (under **Operations**).

<!-- screenshot: products list showing product rows with name, SKU, price, and creation date columns -->
![Products list](./images/03-products-list.png)

### Products list

Each row in the products list represents one product synced from your master shop. Columns include:

- **Name** — product name (with thumbnail image) as it appears in the shop
- **SKU** — the shop's internal reference code
- **Price** — the product's base price
- **Created** — when this product was first synced into OpenLinker

Use the **search bar** to filter by product name or SKU.

### Product detail

Click any product row to open the product detail page.

<!-- screenshot: product detail page showing product information, variants table, and stock section -->
![Product detail](./images/03-products-detail.png)

The product detail has two tabs:

**Overview tab** — shows:
- **Product metadata** — PRODUCT ID, SKU, PRICE, CREATED, UPDATED, DESCRIPTION
- **External IDs** — the identifiers this product has on each connected platform
- **Variants table** — all variants (combinations) with columns: SKU, EAN, GTIN, ATTRIBUTES, EXTERNAL IDS. Simple products have one synthetic variant.
- **Stock section** — per-variant stock rows with VARIANT ID, AVAILABLE, RESERVED, LOCATION

**Content tab** — shows the product's content fields (e.g. description) that OpenLinker manages for cross-channel publishing.

OpenLinker does not provide an edit UI for product data — changes to names, descriptions, or pricing are made in your master shop and picked up on the next catalog sync (every 20 minutes by default, or immediately after clicking **Trigger sync** on the connection detail page).

---

## Inventory

Open **Inventory** in the sidebar (under **Operations**).

<!-- screenshot: inventory list showing per-variant rows with available/reserved quantity columns -->
![Inventory list](./images/03-inventory-list.png)

### Inventory list

The inventory list shows stock levels per product variant, as last read from the master shop. Columns include:

- **Product** — product name with variant label (size, colour, etc.) for multi-variant products
- **Variant ID** — OpenLinker's internal variant identifier
- **Available** — units available for sale (total stock minus reserved)
- **Reserved** — units reserved by pending orders
- **Location** — warehouse or stock location identifier (if configured)
- **Updated** — timestamp of the most recent inventory read for this row

Inventory is refreshed on a 15-minute schedule by default (`OL_INVENTORY_SYNC_ENABLED` in the API config). Stock changes in your shop are reflected after the next scheduled sync.

### Marketplace quantity propagation

When inventory levels change, OpenLinker automatically updates the quantity on any active marketplace offers linked to that variant. The propagation is triggered by the inventory sync job — you don't need to do anything manually. Check **Jobs & Logs** to see the `inventory.propagate` jobs if you want to confirm propagation has run.

---

## How sync works

Both catalog and inventory syncs follow the same pattern:

1. A scheduled job (or a manual trigger from the connection detail page) reads data from the master shop via the shop's API.
2. OpenLinker updates its internal projection of each product and variant.
3. For inventory, updated stock levels are propagated to any linked marketplace offers.

If a sync fails (network error, API key expired, etc.), check the corresponding job in **Jobs & Logs** for the error detail.

---

## What's next

With the catalog synced, you can create marketplace offers:

→ **[Listings & Offers](./04-listings.md)** — create Allegro offers from your synced catalog
