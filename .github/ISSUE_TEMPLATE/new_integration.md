---
name: 🧩 Add a New Integration
about: Propose a new platform integration (Shopify, WooCommerce, BigCommerce, …)
title: '[INTEGRATION] '
labels: ['enhancement', 'documentation']
assignees: ''
---

Use this template for proposals to add a **new platform adapter** under `libs/integrations/`. For changes to an existing adapter, use the Feature Request template instead.

Before filing, please skim:

- [`docs/plugin-author-guide.md`](../../docs/plugin-author-guide.md) — the contributor walkthrough.
- [`docs/architecture-overview.md` § Capability Abstractions](../../docs/architecture-overview.md#capability-abstractions-business-roles) — what the five built-in capability ports are.

---

## Platform

- **Name**:
- **Website / company**:
- **Why OpenLinker should support it** (one-line rationale, e.g., user demand, market position, gap in current adapter set):

## Proposed adapter key

Format is `<platform>.<transport>.v<n>` — lowercase, dot-separated. Examples in the tree: `prestashop.webservice.v1`, `allegro.publicapi.v1`. The `v<n>` suffix lets a v2 ship alongside a v1.

- **Adapter key**:

## Vendor API documentation

- **API reference URL**:
- **OpenAPI / Swagger spec** (URL or "none"):
- **SDK** (official client library, or "none"):
- **Sandbox / test environment** (URL, signup link, or "none"):
- **API versioning model** (semver / dated / none):

## Target capabilities

Which OpenLinker capability ports will this adapter implement? Tick all that apply. New capability names beyond the built-in five are allowed at the registry boundary (#576) — discuss with maintainers before claiming a new one.

- [ ] `ProductMaster` — source of truth for product catalog (read/write)
- [ ] `InventoryMaster` — source of truth for stock levels
- [ ] `OrderSource` — cursor-based order-event ingestion
- [ ] `OrderProcessorManager` — order lifecycle on the destination shop
- [ ] `OfferManager` — marketplace offer/listing management (split into sub-capabilities — see [`docs/architecture-overview.md`](../../docs/architecture-overview.md))
- [ ] Other / new capability:

## Authentication model

Tick **one**:

- [ ] API key (static, header or query param)
- [ ] OAuth 2.0 + refresh token
- [ ] OAuth 2.0 client-credentials (machine-to-machine)
- [ ] mTLS
- [ ] Request signing (HMAC / similar)
- [ ] Other:

**Token / credential lifecycle notes** (refresh interval, rotation policy, anything unusual):

## Rate limits

- **Known caps** (requests/second, requests/day, burst rules):
- **Retry-after / 429 behavior**:
- **Per-credential or per-IP**:

## Webhook support

Tick **one**:

- [ ] Push (vendor sends webhooks)
- [ ] Pull-only (no webhook support — polling required)
- [ ] Partial (webhooks for some event types, polling for others)

If push or partial, **which events does the vendor emit?**

## Identifier model

- **Product ID type** (numeric / UUID / SKU-based / external):
- **Order ID type**:
- **Customer ID type**:
- **Barcodes (EAN/GTIN) as first-class identifiers?** (yes / no / variant-only):
- **Tenant / shop ID required for any request?** (yes / no / sometimes):

## Inbound order semantics

Only if you ticked `OrderSource` above:

- **Cursor model** (event journal with `since`/`from` cursor / polling watermark like `date_upd` / both):
- **Idempotency surface** (does the API expose a stable per-event identifier?):
- **Latency expectation** (real-time push, ~5 min poll, hourly batch, …):

## Maturity target

What ship state is realistic for v1 of this adapter? Tick **one**:

- [ ] Alpha — partial capability coverage, hand-driven, not for production
- [ ] Beta — all declared capabilities work, edge cases acknowledged, opt-in
- [ ] Stable — production-ready, full test coverage, default-on

**What blocks promotion to the next stage?**

## Reference reading for the implementer

- [`docs/plugin-author-guide.md`](../../docs/plugin-author-guide.md) — package layout, port selection, factory wiring, credentials/OAuth, testing, host enablement.
- [`docs/architecture-overview.md`](../../docs/architecture-overview.md) — hexagonal architecture, capability ports, identifier mapping.
- [`libs/integrations/prestashop/`](../../libs/integrations/prestashop/) — the OpenLinker reference adapter.
- [`libs/integrations/allegro/`](../../libs/integrations/allegro/) — OAuth + plugin-owned migration example.

## Acceptance criteria

- [ ] Adapter implements every capability ticked above
- [ ] Connection-config and credentials shape validators registered (see plugin author guide § Step 7)
- [ ] Connection tester registered against `ConnectionTesterRegistryService`
- [ ] Unit tests cover request shape, response parsing, and error mapping for each capability
- [ ] Adapter package `README.md` + a `docs/setup-guide.md` in `libs/integrations/<name>/docs/` (if operator-facing setup is non-trivial)
- [ ] Adapter registered in `apps/api/src/plugins.ts`
