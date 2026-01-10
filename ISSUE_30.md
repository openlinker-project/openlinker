# Developer Task

## Description
Deliver MVP Allegro integration aligned to OpenLinker:
1) Pull Allegro orders using event journal (/order/events) and fetch full details (/order/checkout-forms/{id}).
2) Push inventory changes to Allegro offer quantities using command endpoints (/sale/offer-quantity-change-commands/{commandId}).

## Tasks
- [ ] CORE: Audit & unify marketplace abstraction (avoid duplicate ports vs Listings marketplace integration)
- [ ] CORE: Define Marketplace capability port contract (orders feed + updateOfferQuantity)
- [ ] CORE: Add missing OrderProcessorManagerPort (capability exists; port + minimal types needed)
- [ ] CORE: Fix IntegrationsService.listCapabilityAdapters to return factory-created adapters (not placeholders)
- [ ] CORE: Add cursor persistence (connection_cursors + repository port + migration) for lastEventId
- [ ] CORE: Define job types + payload types (allegro.orders.poll, allegro.order.syncByCheckoutFormId, allegro.offerQuantity.update)
- [ ] PLUGIN: Create libs/integrations/allegro package + adapter factory registration + registry entry
- [ ] API: Allegro connection config schema (sandbox/prod) + OAuth connect/callback + validate endpoint
- [ ] CORE/API: DB-backed credential store + CredentialsResolver backend for credentialsRef indirection
- [ ] PLUGIN: HTTP client wrapper (headers, retries, rate limit, trace-id logging)
- [ ] PLUGIN: Allegro marketplace adapter (events → checkout-form → unified order + internal IDs via IdentifierMappingService)
- [ ] WORKER: Handlers (poll → enqueue order sync jobs; order sync; offer quantity update)
- [ ] CORE: OrderSync pipeline wiring: Allegro source → at least one OrderProcessorManager destination
- [ ] CORE/API: MVP Offer↔Product mapping to support stock sync (prefer Listings domain OfferMapping)
- [ ] OBS: Persist offer quantity command status + expose failures (API endpoints / logs)
- [ ] QA: Unit + integration tests
- [ ] Docs: setup + runbook

## Acceptance Criteria
- [ ] Allegro connection can be created and validated (prod + sandbox)
- [ ] Orders are ingested via /order/events and mapped to OpenLinker unified schema (internal IDs)
- [ ] OrderSync pipeline routes orders to at least one OrderProcessorManager adapter
- [ ] Inventory updates trigger Allegro quantity commands and failures are observable (persisted status + queryable)
- [ ] Cursor (lastEventId) is persisted per connection and advances safely (idempotent under retries)
- [ ] All tests pass
- [ ] Code follows Engineering Standards
- [ ] Documentation updated

## Notes
- Non-goals: full offers CRUD, advanced order lifecycle, webhook-based ingestion (polling only).
- If PrestaShop order create is too large for MVP, implement a StubOrderProcessorManager adapter as the MVP sink (still satisfies routing acceptance).
