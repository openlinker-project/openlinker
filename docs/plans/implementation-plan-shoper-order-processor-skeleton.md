# Implementation plan - Shoper OrderProcessorManager skeleton (#3692)

Sub-issue of epic #3642. Base branch: `3642-shoper-order-processor-manager`.

## 1. Goal and layer

Integration layer (`libs/integrations/shoper`). Make the plugin able to WRITE and resolve the Shoper user an order must reference, without creating orders yet.

Non-goals (later slices): `POST /orders` / `POST /order-products` (#3693), idempotency lock (#3694), stock double-deduction policy (#3695), customer ADDRESSES (Shoper `POST /addresses`; decide in #3693).

## 2. Research findings

- `ShoperHttpClient` has `get` and `put`; `request()` is typed `'GET' | 'PUT'`. Adding `post` is one method plus the union member. Same safety properties apply (no redirects, capped body, timeout).
- Closest precedent: WooCommerce - `WooCommerceCustomerProvisioner` (mapping fast path -> `SyncLockPort` lock -> create -> on duplicate-email 400 look up by email -> record `Customer` mapping) and `WooCommerceOrderProcessorAdapter`.
- `OrderCreate` carries only the INTERNAL `customerId`, no email or name. WooCommerce gets those from `CustomerProjectionRepositoryPort` (`@openlinker/core/customers`), injected through a hand-written Nest module.
- `HostServices` has NO `SyncLockPort` and no customer projection repository. `ShoperIntegrationModule` today is `createNestAdapterModule({ plugin })` with no providers of its own.
- SPIKE-3638 (live): `user_id=0` rejected on `POST /orders`; `POST /users` enforces email uniqueness with `400 "już istnieje"`.

## 3. Design

1. `ShoperHttpClient.post(path, body)`; widen `request` method union. Shape of the answer typed `unknown` until confirmed live (as `put`).
2. `ShoperCustomerProvisioner` (infrastructure/provisioners): `resolveOrCreateCustomer({ internalCustomerId, email, firstName, lastName, connectionId })` -> Shoper user id.
   - mapping `Customer` (internal -> external, per connection) fast path;
   - lock `shoper:customer-provision:{connectionId}:{emailHash}` via `SyncLockPort`, re-check mapping;
   - `POST /users`; on 400 duplicate-email `GET /users?filters[email]=...`, pick the exact email match; record mapping (swallow `DuplicateIdentifierMappingError`, then re-read);
   - **no guest fallback**: Shoper rejects `user_id=0`, so a missing email or customer is a terminal `ShoperCustomerUnresolvableException` (retry classifier: terminal), not a silent guest like WooCommerce.
3. `ShoperOrderProcessorAdapter implements OrderProcessorManagerPort`: `createOrder` throws `ShoperNotSupportedException('createOrder')` in this slice.
4. Wiring: `OrderProcessorManager` added to `shoperAdapterManifest` and the dispatch table together with the adapter. Nest module gains providers for the provisioner (needs `SYNC_LOCK_TOKEN` and `CUSTOMER_PROJECTION_REPOSITORY_TOKEN`), mirroring `WooCommerceIntegrationModule`; `createShoperPlugin(deps)` takes them.
5. README: capability documented, existing connections must enable it (never retro-filled).

## 4. Steps (files)

1. `infrastructure/http/shoper-http-client.ts` (+ spec): `post`.
2. `domain/exceptions/shoper-customer-unresolvable.exception.ts`; retry classifier terminal + spec.
3. `domain/types/shoper-api.types.ts`: `ShoperUser`, `ShoperUserCreateRequest`.
4. `infrastructure/provisioners/shoper-customer.provisioner.ts` (+ spec): first create, repeat email, mapping fast path, concurrent duplicate, no email, auth failure propagates.
5. `infrastructure/adapters/order-processor/shoper-order-processor.adapter.ts` (+ spec).
6. `shoper-plugin.ts`, `shoper-integration.module.ts`, `application/shoper-adapter.factory.ts`, `shoper-plugin.spec.ts`, README.
7. Smoke on the trial shop (GET-only probes of `/users` filter shape; a `POST /users` for a throwaway email needs explicit go-ahead because it writes).

## 5. Validation

- No core change; adapter implements a core port only. Barrel imports only.
- Plugin keeps no `console.log`/`any`; credentials stay in the http client.
- Tests: unit only here (the integration test belongs to #3694/#3695).

## 6. Open questions

1. Does Shoper `POST /users` require fields beyond email/name (password, group, language)? Needs a live probe.
2. Where do the buyer email and names come from for a destination that is not WooCommerce-shaped: confirm `CustomerProjectionRepositoryPort` (PII mode `OL_STORE_PII=false` stores hashes only, so a hash-only deployment cannot provision a named user). Proposed: terminal `ShoperCustomerUnresolvableException` and say so in the README.
3. Whether to wire the Nest module like WooCommerce (new providers and role-import impact per ADR-051) or widen `HostServices` with a lock (ADR-062 says no).
