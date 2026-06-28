# InPost (ShipX) Integration — Setup Guide

Step-by-step: from an InPost ShipX account to a working OpenLinker shipping
connection that generates labels (paczkomat + kurier), fetches tracking, and
ingests shipment-status webhooks.

**Adapter:** `inpost.shipx.v1` · **Capability:** `ShippingProviderManager`

## Prerequisites

- An InPost **ShipX** account with an organization (`organizationId`) provisioned by InPost.
- A long-lived **ShipX Bearer API token** generated in the InPost manager portal.
- OpenLinker API + worker running.
- A sender address (returned on labels) in Polish format.

## 1. Obtain your ShipX credentials

1. Log in to the InPost ShipX manager portal.
2. Note your **organization id** (`organizationId`) — the numeric id of your ShipX organization.
3. Generate a **Bearer API token** (long-lived, portal-generated). Copy it — it's the secret half of the connection (`apiToken`).

> Sandbox vs production are distinct ShipX environments with separate base URLs and tokens. Use a sandbox token while validating, then swap to production.

## 2. Create an InPost connection in OpenLinker

1. Open OL Admin → Integrations → Connections → **New Connection**.
2. Platform: **InPost**.
3. Fill the **sender address** (used as the label's sender):
   - `street`, `buildingNumber`, `city`
   - `postCode` — PL format `NN-NNN`
   - `countryCode` — ISO 3166-1 alpha-2 (e.g. `PL`)
   - `name` (optional), `email`, `phone`
4. **Organization id**: your ShipX `organizationId`.
5. **API token**: paste the ShipX Bearer token from Step 1 (stored encrypted).
6. Click **Test Connection** — exercises a ShipX call and expects a success result.
7. Click **Save**.

## 3. Capability

| Capability | What it does |
|---|---|
| `ShippingProviderManager` | Generate labels (paczkomat + kurier) + handover protocols, fetch tracking snapshots, and receive ShipX shipment-status webhooks. |

## 4. Webhooks (optional but recommended)

InPost ShipX can push shipment-status events to OpenLinker so terminal states
(`delivered`, etc.) propagate without polling. Configure the webhook target in
the ShipX portal to point at your OL webhook endpoint for this connection.
Without webhooks, OL falls back to polling tracking at a conservative cadence.

## 5. Troubleshooting

- **Test Connection fails with 401** — the `apiToken` is wrong, expired, or from the other environment (sandbox token against production URL or vice-versa).
- **`postCode must match the PL format NN-NNN`** — the sender postcode must be `NN-NNN` (e.g. `01-234`).
- **Labels missing the sender** — re-check the sender address block on the connection config.

## Related

- Reference plan: [#727](https://github.com/openlinker-project/openlinker/issues/727)
- Capability port: `ShippingProviderManagerPort` (see [`docs/architecture-overview.md`](../../architecture-overview.md))
