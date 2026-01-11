# Goal (Outcome)

Make Allegro → OpenLinker → PrestaShop order routing work end-to-end, reliably, even when:
- PrestaShop has **no customer/address data** yet,
- the same person buys via multiple origins with the same email but different addresses,
- PII storage must be configurable,
- future PrestaShop multi-shop requires shop scoping.

# User Stories

1) As an operator, I want Allegro orders to be created in PrestaShop even if the buyer doesn’t exist in PrestaShop yet, so fulfillment doesn’t break.

2) As an operator, I want OpenLinker to keep minimal customer/order projections (optionally with PII) to debug failures and support retries.

3) As a platform engineer, I want customer identity to remain consistent across origins, so “same email, different address” results in the same customer with multiple addresses (not duplicates).

# Architecture Context

- Destination OrderProcessorManager adapter resolves internal → destination external IDs via IdentifierMappingService.getExternalIds(), including Customer. If mapping is missing, adapter must provision and create mapping. (architecture-overview.md)
- We keep customers **destination-owned** (Model A) and store only a lightweight projection in OL (Model C).

# Scope

## In Scope
- Destination provisioning in PrestaShop adapter:
  - Create **guest** customer if missing
  - Create/reuse delivery & invoice addresses
  - Create IdentifierMappings for customer and optional address mappings
- CustomerProjection (Model C) with emailHash (always) and optional PII
- Address history (multiple addresses per customer)
- PII toggle via env var
- Multi-shop readiness in PrestaShop adapter/config (no full multishop now)

## Out of Scope (MVP)
- Full Customer domain aggregate (CRM)
- UI flows for manual merge/split
- Advanced identity graph rules beyond deterministic modes

# Tasks

## 1) Customer identity resolution rules (multi-origin safe default)

- [ ] Add `CustomerIdentityResolverService` (core) to determine canonical internalCustomerId for inbound order:
  - Primary: external buyer id mapping (sourceConnectionId scoped)
  - Optional: emailHash fallback to link across origins
- [ ] Add config:
  - `OL_CUSTOMER_IDENTITY_MODE=external_only|email_fallback`
  - default: `email_fallback` (your requirement), with doc warning about shared emails
- [ ] When email_fallback is enabled:
  - if no external mapping exists but emailHash matches an existing CustomerProjection index → reuse that internalCustomerId and create mapping for the new source buyer id

Acceptance
- [ ] Same email across Allegro + Presta resolves to same internalCustomerId (in email_fallback mode)
- [ ] Mode can be switched to external_only to avoid risky merges

## 2) CustomerProjection + Address history (Model C)

- [ ] Add `customers` projection module (projection-only, not authoritative):
  - `CustomerProjection` fields:
    - internalCustomerId
    - emailHash (always)
    - normalizedEmail (ONLY if OL_STORE_PII=true)
    - firstName/lastName (ONLY if OL_STORE_PII=true)
    - lastSeenAt, lastSourceConnectionId
- [ ] Add `CustomerAddressProjection` (address history):
  - internalCustomerId, addressHash, addressType (shipping|billing), lastSeenAt
  - store full address only if OL_STORE_PII=true
- [ ] Upsert projection(s) during order ingest/sync handler (before destination send)

Acceptance
- [ ] Multiple addresses can exist for the same customer (no overwriting)
- [ ] emailHash is always persisted

## 3) PII toggle (env)

- [ ] Add env `OL_STORE_PII=true|false` (default true)
- [ ] When false:
  - store only emailHash + addressHash + minimal metadata (no raw email/names/address lines)
- [ ] Define hashing:
  - normalized email → SHA-256 + org-level salt env (`OL_PII_HASH_SALT`) (hash is still deterministic per org)
- [ ] Docs describing impact

Acceptance
- [ ] Pipeline remains functional with OL_STORE_PII=false
- [ ] emailHash persists in both modes

## 4) PrestaShop customer provisioning as GUEST (Model A)

Reference: PrestaShop customer resource includes `is_guest` and requires `passwd`, `firstname`, `lastname`, `email`. (Prestashop devdocs). 
- [ ] In `PrestashopOrderProcessorManagerAdapter.createOrder()` implement `resolveOrCreateGuestCustomer()`:
  1) Try IdentifierMappingService.getExternalIds(Customer, internalCustomerId) for destination connection
  2) If missing: find customer by email in PrestaShop
  3) If not found: create **guest** customer:
     - set is_guest=1
     - generate random password for required `passwd`
     - set active=1
     - (optional) set id_shop/id_shop_group if configured
  4) Create IdentifierMapping for Customer

Acceptance
- [ ] If PrestaShop is empty, customer gets created and mapped
- [ ] Retries do not create duplicate customers (find-by-email + mapping convergence)

## 5) PrestaShop address provisioning (delivery + invoice)

Reference: Address requires `id_country`, `alias`, `firstname`, `lastname`, `address1`, `city`. (Prestashop devdocs).
- [ ] Implement `resolveOrCreateAddresses()` in PrestaShop adapter:
  - compute `addressHash` from normalized address fields
  - attempt reuse:
    - if we have OL mapping internalAddressHash → prestashopAddressId for this customer, use it
    - else query destination addresses for the customer and match by hash (best effort)
  - if not found: create address with required fields and return IDs
- [ ] Ensure the second order with same email but different address:
  - uses same customer, creates additional address (new hash)

Acceptance
- [ ] Two orders with same email but different address → same customer + two addresses
- [ ] Addresses are reused when hash matches exactly

## 6) Multi-shop readiness (not implementing full multishop now)

Reference: PrestaShop webservice supports `id_shop` parameter in multishop mode; customer has `id_shop` fields.
- [ ] Extend PrestaShop connection config to include optional:
  - `prestashopShopId?: number` (default undefined / 1 later)
  - `prestashopShopGroupId?: number` (optional future)
- [ ] Plumb config into customer/address creation and key lookups when multishop is enabled later:
  - include `id_shop` fields on created customer when provided
  - document that in multishop mode requests may need `id_shop` parameter

Acceptance
- [ ] No behavior change today, but adapters are ready to scope operations by shopId later

## 7) Minimal order persistence (recommended foundation)

- [ ] Add OrderRecord + OrderSyncState minimal persistence:
  - store customerId + order snapshot
  - store sync status per destination
  - respect OL_STORE_PII (store snapshots or hashes)

Acceptance
- [ ] Failed order sync is diagnosable and retryable without re-polling Allegro

## 8) Tests + Docs

- [ ] Integration test: Allegro order (new buyer) → guest customer created → address created → order created
- [ ] Integration test: same email, different address → same customer + new address
- [ ] Integration test: OL_STORE_PII=false still passes (hash-only mode)
- [ ] Docs: Customer handling Model A+C, identity mode, PII mode, multishop readiness

# Acceptance Criteria (Overall)

- [ ] Allegro → OL → Presta order flow works E2E when PrestaShop has no customer/address data
- [ ] Guest customer creation is used (is_guest=1)
- [ ] Multi-origin identity works under email_fallback (same email → same internal customer)
- [ ] Different addresses create additional addresses (not customer duplication)
- [ ] OL_STORE_PII toggles raw PII storage; emailHash always persisted
- [ ] Order persistence enables retry/debug
- [ ] Tests pass and docs updated
