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
(`delivered`, etc.) propagate without polling. Without webhooks, OL falls back to
polling tracking at a conservative cadence — status still converges, just slower.

### Registering the endpoint

InPost has **no self-service webhook registration** ("Please contact InPost
Account Manager and/or Integration Team. Self-service portal is under
development."), so OL cannot auto-provision it. Ask InPost's integration team to
deliver `Shipment.Tracking` events to your connection's endpoint:

```
{OL public API base}/webhooks/inpost/{connectionId}
```

The **InPost Webhook Runbook** on the connection page surfaces the exact URL, a
copy-paste email template for `integration@inpost.pl`, and one-click secret
rotation.

### Signature scheme

OL authenticates every delivery by **HMAC-SHA256, base64-encoded**, read from the
`x-inpost-signature` header, using the shared secret you rotate in the runbook and
hand to InPost. Give them that secret over a trusted channel or every delivery is
rejected with `401 Invalid webhook signature`.

InPost makes the **signed content configurable per client**, in two documented
forms:

| Variant | Signed content |
|---|---|
| 1 | the raw request body alone |
| 2 | `{x-inpost-timestamp}.{body}` (dot separator) |

**You do not need to know or request which one InPost configured** — OL
authenticates both (#1556). Under variant 2 the signed timestamp additionally
feeds OL's replay-window check; under variant 1 the durable event-id dedup gate
is the replay backstop.

InPost's other signing method — an RSA digital signature over the same content —
is **not** supported: OL's runbook issues a shared secret, so request HMAC.

## 5. Troubleshooting

- **Test Connection fails with 401** — the `apiToken` is wrong, expired, or from the other environment (sandbox token against production URL or vice-versa).
- **Webhooks 401 with `Invalid webhook signature`** — the secret InPost holds differs from OL's. Rotate it in the runbook and re-send it to the integration team. Note the shipment status still converges via the 30-minute tracking poll, so a dead webhook path is easy to miss — check the logs, not just the status.
- **`postCode must match the PL format NN-NNN`** — the sender postcode must be `NN-NNN` (e.g. `01-234`).
- **Labels missing the sender** — re-check the sender address block on the connection config.
- **Paczkomat label rejected with `providerCode: "target_point"` (message: "There are some validation errors…")** — ShipX doesn't recognise the pickup-point id (`paczkomatId`) sent for the shipment; it's not provisioned in that environment (common for Allegro-sandbox test orders, which mint locker ids that don't exist in the ShipX sandbox point network) or has been decommissioned. Not a receiver/mapper bug — the fix is to pick a different, currently-valid pickup point (`findPickupPoints` / `GET /v1/points`) for that shipment (#1807). Confirmed live: ShipX returns this as a **nested** field error, `details: { custom_attributes: [{ target_point: ["does_not_exist"] }] }` (not the flat `{ field: [...] }` shape most other rejections use) — `InpostHttpClient` flattens both shapes onto the leaf field key so the adapter's existing `target_point` re-tag (#885) fires correctly.
- **Receiver fields for a paczkomat shipment** — ShipX's `receiver` object for a locker shipment needs at minimum `email` + `phone`; `first_name`/`last_name`/`company_name` are accepted when present but not required for point delivery (confirmed live, #1807 — the earlier working hypothesis that a missing receiver name caused rejections was not what ShipX actually rejected in the reproduced case).
- **"Test Connection" is green but a specific label still fails** — expected, not a bug: the connection test (`InpostConnectionTesterAdapter`) only probes `GET /v1/points?per_page=1` to confirm the API token + environment are valid; it never calls the shipment-creation endpoint, so it cannot catch a shipment-payload-specific rejection like the `target_point` case above (#1807). Don't read a green connection test as "the next label will generate" — it only means auth/connectivity are fine.
- **"It worked before and now it doesn't, with no OL-side changes" (apparent sandbox flakiness)** — before assuming ShipX sandbox instability, check whether the *specific* `paczkomatId` differs between the working and failing attempts. Live evidence (#1807): across several Allegro-sandbox orders on the same InPost connection, some pickup-point ids generated a label successfully while others were rejected with `target_point: does_not_exist` — including the **same id rejected identically on two different days**, and a rejection recorded *before* several same-day successes with different ids. That pattern is per-point-id, not time-based degradation — each Allegro test order is stamped with its own (sometimes fictitious) locker code, and only some of those codes exist in the ShipX point network. If a *previously-succeeding* id starts failing, that's worth escalating to InPost as sandbox data drift; a *new* id failing on first use is expected and not a regression.

## Related

- Reference plan: [#727](https://github.com/openlinker-project/openlinker/issues/727)
- Capability port: `ShippingProviderManagerPort` (see [`docs/architecture-overview.md`](../../../../docs/architecture-overview.md))
