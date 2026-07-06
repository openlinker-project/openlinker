# Changelog

All notable changes to OpenLinker are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(pre-1.0: **minor** carries new features *and* breaking changes, **patch** carries
fixes — see [RELEASING.md](./RELEASING.md)).

From `0.2.0` onward this file is generated automatically by
[release-please](https://github.com/googleapis/release-please) from Conventional
Commits. The `0.1.0` entry below is the hand-curated baseline of what shipped
before automated releases began.

## [0.1.0]

First tracked release — the baseline snapshot of OpenLinker as a self-hosted,
API-first, pluggable e-commerce orchestration platform: sync products, inventory,
listings, and orders between your own shop and the marketplaces you sell on.

### Platform & architecture

- **Hexagonal core** (ports & adapters) organised into bounded contexts —
  products, inventory, orders, customers, listings/offers, invoicing, content,
  AI, sync, shipping — with a strict CORE ↔ integration boundary.
- **Capability ports** so a new platform is *new implementations, not core
  changes*: `ProductMasterPort`, `InventoryMasterPort`, `OrderSourcePort`,
  `OrderProcessorManagerPort`, `OfferManagerPort`, `InvoicingPort`,
  `ShippingProviderManagerPort`, each with composable sub-capabilities.
- **Plugin SDK** (`@openlinker/plugin-sdk`) — framework-neutral adapter-plugin
  contract, per-connection adapter resolution, and self-registering capability /
  connection-test / webhook-provisioning / validator registries.
- **Identifier mapping** from a single unified seed (`ol_product_*`, `ol_order_*`,
  `ol_variant_*`, …) so core logic works in internal IDs regardless of source.
- **Multi-connection per platform type** (e.g. two PrestaShop stores from one
  instance), encrypted credentials store, and PII-aware storage (full or
  hash-only).

### HTTP API

- Versioned REST API under **`/v1`** (URI versioning) with a runtime version
  surface at `GET /v1/health` reporting the product + API version.
- JWT auth with refresh-token rotation, role-based authorization
  (admin / operator / viewer), and self-service registration + admin approval.
- Inbound webhook ingestion with HMAC verification, replay protection, and
  Postgres-authoritative dedup.

### Core workflows

- **Order sync** — cursor-based ingestion from marketplaces *and* shops, unified
  order model, destination order creation with auto-provisioned guest customers,
  status lifecycle, cancellations/returns, and order-status writeback (ADR-027).
- **Inventory sync** — variant-keyed master stock propagated to marketplace
  offers, including per-combination stock for multi-variant products.
- **Listings / offers** — offer creation, quantity + field updates, category &
  attribute projection across platforms, seller-policy discovery, offer-status
  snapshots, and a bulk offer-creation flow.
- **Invoicing** — country-agnostic `InvoicingPort` (issue / clear / correct
  fiscal documents), with a browser-based invoice detail + correction surface.
- **Content + AI** — per-channel product content with draft write-through and
  provider-agnostic AI description suggestions (Anthropic, OpenAI) plus editable,
  versioned prompt templates.
- **Shipping / dispatch** — neutral delivery intent, label generation, pickup
  points, tracking, and shipment-status sync.
- **Customer identity resolution** — multi-origin identity with optional
  email-fallback and address reuse.
- **Sync-job orchestration** — scheduled + webhook-triggered jobs with retry
  classification and a status-vs-outcome split.

### Integrations

Shops:

- **PrestaShop** (`prestashop.webservice.v1`) — full shop surface (catalog +
  inventory reads, order ingestion via `date_upd`, order creation, lifecycle,
  cancellations, returns); ships the OL Dynamic Carrier module so marketplace
  buyer-paid shipping round-trips correctly.
- **WooCommerce** (`woocommerce.restapi.v3`) — source + destination + inventory.

Marketplaces:

- **Allegro** (`allegro.publicapi.v1`) — order ingestion via the event journal,
  the full `OfferManager` sub-capability set, OAuth with refresh-on-401, and
  masked-buyer-email normalization.
- **Erli** (`erli.shopapi.v1`) — offers + order source, reconciliation-first
  posture, borrowing Allegro-id taxonomy.

Invoicing:

- **Subiekt nexo** (`subiekt.invoicing.v1`) — first `InvoicingPort` adapter, via
  the Sfera bridge.
- **KSeF** (`ksef.publicapi.v2`) — Polish national e-invoicing (FA(3) issue +
  clear + KOR corrections through the async submit → poll → UPO model).
- **inFakt** (`infakt.accounting.v1`) — accounting/invoicing with KSeF
  indirection and read-back of clearance status.

Shipping:

- **InPost** (`inpost.shipx.v1`) — ShipX (paczkomat + courier), labels, webhooks.
- **DPD Polska** (`dpd.polska.rest.v1`) — REST labels + protocols, SOAP tracking.

Content:

- **AI router** (Anthropic, OpenAI) — content-suggestion completions behind a
  provider-agnostic `AiCompletionPort`.

### Frontend

- Browser-first admin SPA (React + TypeScript + Vite + TanStack Query) — an
  operator cockpit for connections, orders, products, inventory, listings,
  invoices, jobs & logs, webhooks, and cursors, with a build-time plugin registry
  for per-platform UI.

### Ops & docs

- Real integration tests against Postgres/Redis (and a real PrestaShop install)
  via Testcontainers; TypeORM migrations as the schema source of truth.
- Architecture Decision Records, per-context engineering standards, and
  per-integration setup guides.

<!-- This link goes live when the maintainer cuts the one-time v0.1.0 tag —
     see RELEASING.md § Cutting the first tag. Until then it intentionally 404s. -->
[0.1.0]: https://github.com/openlinker-project/openlinker/releases/tag/v0.1.0
