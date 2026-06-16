# InPost ShipX SDK (prototype)

A small, **hexagonal** SDK for the InPost ShipX API. The application client knows
only about ShipX URL shapes and the shipment state machine; every external
concern — HTTP transport, bearer token, logging — is an injected **port**, so
nothing in the core depends on `fetch` or on how credentials are stored.

> Throwaway prototype living in the `inpost-sandbox-probe` worktree. Its purpose
> is to validate the end-to-end shipping flow OpenLinker needs against the InPost
> sandbox before it's reshaped into a real `@openlinker/integrations-inpost`
> adapter implementing the (future) `ShippingProviderManagerPort`.

## Architecture

```
src/
  domain/
    ports/            HttpClientPort · LoggerPort · TokenProviderPort   ← the seams
    types/            point · organization · shipment wire types
    errors/           InpostApiError (normalized ShipX error)
  application/
    inpost-shipx.client.ts   ← the facade; depends only on ports
  adapters/
    fetch-http-client.adapter.ts     (default transport, fetch — injectable)
    console-logger.adapter.ts        (+ NoopLoggerAdapter)
    static-token-provider.adapter.ts
  index.ts            public barrel + createInpostShipXClient() wiring factory
examples/
  probe.ts            read-only: points + organizations + shipments
  full-flow.ts        create → offer → buy → confirm → label → tracking
```

Dependency direction: `application → domain (ports)`, `adapters → domain (ports)`.
The factory in `index.ts` is the only place concrete adapters are chosen — swap
any of them (e.g. a retrying HTTP client, OpenLinker's `Logger`, an
OAuth-refreshing token provider) without touching the client.

## Usage

```ts
import { createInpostShipXClient } from './src/index.ts';

const client = createInpostShipXClient({
  token: process.env.INPOST_TOKEN!,        // string, or a custom TokenProviderPort
  // baseUrl defaults to the sandbox; pass INPOST_SHIPX_PRODUCTION_BASE_URL for prod
  // httpClient / logger / organizationId are all optional overrides
});

const shipment = await client.createShipment({
  receiver: { first_name: 'Jan', last_name: 'Testowy', email: 'j@example.com', phone: '888000000' },
  parcels: [{ template: 'small' }],
  service: 'inpost_locker_standard',
  custom_attributes: { target_point: 'KRA012', sending_method: 'parcel_locker' },
});
```

## Running the examples

Requires Node 18+ (uses `--experimental-strip-types`, so `.ts` runs directly).

```bash
INPOST_TOKEN="<jwt>" npm run probe
INPOST_TOKEN="<jwt>" npm run full-flow      # writes out/label-<id>.pdf
```

Env: `INPOST_TOKEN` (required), `INPOST_BASE` (default = sandbox),
`INPOST_ORG_ID`, `INPOST_TARGET_POINT`.

## Verified ShipX flow (sandbox)

Confirmed live against `sandbox-api-shipx-pl.easypack24.net`:

1. `POST /organizations/{org}/shipments` → `201`, status `created`.
2. ShipX prepares offers async → `offers_prepared`; passing a `service`
   auto-selects one.
3. `POST /shipments/{id}/buy { offer_id }` → settles against the org balance
   (async). **Insufficient funds surface as a `failure` transaction with
   `error: debt_collection`** — top up virtual funds in the sandbox manager's
   "Płatności".
4. Poll `GET /shipments/{id}` → `offer_selected` → `confirmed`; a
   `tracking_number` is assigned.
5. `GET /shipments/{id}/label?format=pdf&type=normal` → PDF bytes (only valid
   once `confirmed`; earlier it returns `invalid_action / shipment_status_incorrect`).
6. `GET /tracking/{number}` → status (404 until the first scan — expected for a
   fresh shipment).

## OpenLinker simulation layer (`openlinker/`)

To exercise the *exact* operations OpenLinker needs from a shipping provider,
`openlinker/` mirrors the real `@openlinker/core/shipping` contract on top of the
SDK:

- `ol-shipping.types.ts` — trimmed mirror of the core neutral types
  (`GenerateLabelCommand`, `TrackingSnapshot`, `ShipmentStatus`, `ShippingMethod`,
  `DeliveryIntent`, `PickupPoint`, …).
- `delivery-intent-resolution.ts` — copy of the pure `resolveCarrierMethod`
  seam (`pickup_point | address` → carrier method).
- `inpost-shipping.adapter.ts` — a prototype `InpostShippingAdapter` mirroring
  the real one (`generateLabel` / `getTracking` / `getSupportedMethods` +
  `ShipmentCanceller` / `PickupPointFinder` / `LabelDocumentReader`), including
  the full ShipX status table copied from `inpost-shipx.mapper.ts`.

  **Deliberate difference:** the real `generateLabel` just POSTs and returns
  (production contract accounts auto-confirm server-side). The *sandbox* account
  doesn't, so this prototype's `generateLabel` runs the offer→buy→confirm dance
  (idempotent against ShipX auto-buying first → `already_bought`).

### OpenLinker example scripts (`examples/openlinker/`)

Each script plays the role of a real OL service:

| Script | Simulates | Cost |
|---|---|---|
| `01-pickup-points.ts` | `PickupPointLookupService` (locker search) | free |
| `02-dispatch-paczkomat.ts` | `ShipmentDispatchService` (locker) → label PDF | sandbox balance |
| `03-status-sync.ts <id>` | `ShipmentStatusSyncService` (status mapping) | free |
| `04-cancel.ts` | `ShipmentCanceller` (pre-confirm cancel + confirmed-reject) | sandbox balance |
| `05-dispatch-kurier.ts` | dispatch via `address` intent → courier | sandbox balance |
| `06-order-lifecycle.ts` | order → intent → dispatch → status → label, end to end | sandbox balance |
| `07-sending-methods.ts` | the SENDING-method axis (courier-collect / drop-at-locker / drop-at-point) | free (unbought drafts) |

```bash
INPOST_TOKEN=… npm run ol:pickup-points
INPOST_TOKEN=… npm run ol:dispatch-paczkomat
INPOST_TOKEN=… npm run ol:order-lifecycle      # ORDER_MODE=address for courier
```

### Verified sandbox findings (beyond the basic flow)

- **Paczkomat works out of the box; courier (`inpost_courier_standard`) does
  not** — a fresh sandbox org returns `missing_trucker_id` until the courier /
  trucker service is configured on the org in the sandbox manager.
- **Funded accounts may auto-buy** the selected offer before an explicit `buy`
  lands (race → `400 validation_failed { shipment: ['already_bought'] }`). The
  adapter treats this as success.
- **Cancellation window is narrow** — `DELETE` is only accepted at `created` /
  `offers_prepared`; once ShipX auto-selects the offer (`offer_selected`, which
  a funded account reaches in well under a second) or confirms, cancel returns
  `400 invalid_action / shipment_status_incorrect`.
- **Sending method is a separate axis from delivery method.**
  `custom_attributes.sending_method` controls how the parcel enters the network
  — `dispatch_order` (courier collects), `parcel_locker` (drop at a paczkomat;
  needs `dropoff_point` ≠ `target_point`), `pop` (drop at a PUDO point) — all
  verified live for both locker and courier c2c deliveries. The real in-repo
  adapter hardcodes `dispatch_order`; this prototype exposes it via the
  `DispatchOptions` arg + `defaultSendingMethod` adapter option.

## Notes / token environments

- Sandbox tokens are issued by `sandbox-login.inpost.pl`; production tokens by
  `login.inpost.pl`. A production token is rejected by sandbox ShipX with
  `401 token_invalid` (the `apipoints`/points service is lenient and accepts
  either, which is misleading).
- `getOrganization`-style `/organizations/{id}/services` does **not** exist;
  the enabled services live on the organization object itself.
