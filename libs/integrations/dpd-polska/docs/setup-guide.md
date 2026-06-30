# DPD Polska Integration — Setup Guide

Step-by-step: from a DPD Polska account to a working OpenLinker shipping
connection that generates labels + handover protocols over the REST
`DPDServices` API and fetches tracking over the SOAP `DPDInfoServices` API.

**Adapter:** `dpd.polska.rest.v1` · **Capability:** `ShippingProviderManager`

## Prerequisites

- A DPD Polska account with API access.
- A **master FID** (`masterFid`, numeric) — your DPD customer/federation id.
- API **login + password** for the DPD services.
- OpenLinker API + worker running.
- A sender address (returned on labels) in Polish format.

> **Transport split:** labels + handover protocols use the REST `DPDServices`
> API; tracking uses the separate SOAP `DPDInfoServices` host. The adapter is
> dual-transport — both must be reachable.

## 1. Obtain your DPD credentials

1. Request API access from DPD Polska (gated; the REST `DPDServices` Swagger and
   the SOAP `DPDInfoServices` WSDL are issued with your account).
2. Note your **master FID** (`masterFid`) — numeric string.
3. Note your service **login** and **password** (the credentials half of the
   connection, stored encrypted).
4. Confirm which **environment** you've been issued — sandbox/demo or production.

## 2. Create a DPD connection in OpenLinker

1. Open OL Admin → Integrations → Connections → **New Connection**.
2. Platform: **DPD**.
3. Fill the **sender address**:
   - `address`, `city`
   - `postalCode` — PL format `NN-NNN`
   - `countryCode` — ISO 3166-1 alpha-2 (e.g. `PL`)
   - `company` / `name` / `phone` / `email` (optional)
4. **Master FID**: your numeric `masterFid`.
5. **Environment**: sandbox or production (must match the issued credentials).
6. **Login / password**: the DPD service credentials from Step 1.
7. Click **Test Connection**, then **Save**.

## 3. Capability

| Capability | What it does |
|---|---|
| `ShippingProviderManager` | Generate package numbers + labels and handover protocols over REST `DPDServices`; fetch tracking events over SOAP `DPDInfoServices`. |

## 4. Troubleshooting

- **`masterFid must be a numeric string`** — strip any non-digit characters from the FID.
- **`postalCode must match the PL format NN-NNN`** — sender postcode must be `NN-NNN`.
- **Auth / `needs_reauth`** — login, password, or environment mismatch; the DPD auth-failure classifier flags the connection for re-auth. Re-check credentials against the issued environment.
- **Labels generate but tracking is empty** — tracking is a *separate* SOAP host (`DPDInfoServices`); verify it's reachable independently of the REST endpoint.

## Related

- Reference plan / epic: [#961](https://github.com/openlinker-project/openlinker/issues/961) (children #962–#966)
- Capability port: `ShippingProviderManagerPort` (see [`docs/architecture-overview.md`](../../../../docs/architecture-overview.md))
