# Subiekt GT — operator runbook

Operational reference for the Subiekt GT integration. For the step-by-step setup see the
[setup guide](./setup-guide.md).

---

## Architecture at a glance

OpenLinker → (HTTPS + Bearer) → **Subiekt Bridge** (`openlinker-subiekt`, .NET 8, on the
Windows box next to Subiekt) → Sfera GT (COM automation, ProgID `InsERT.GT`) →
**Subiekt GT**. Adapter key `subiekt.gt.v1`, platform type `subiekt-gt`, capabilities
`Invoicing`, `ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager`.

Sfera GT is the classic COM automation surface InsERT GT products expose (ProgID
`InsERT.GT`) — it is **not** the same thing as the separate .NET Sfera SDK
(`InsERT.Moria.Sfera`), which targets Subiekt nexo and is unrelated to this bridge.

---

## Connection configuration

| Field (wizard) | Config key | Notes |
|---|---|---|
| Bridge URL | `config.bridgeBaseUrl` | `http://<host>:5056`, or `https://<host>:5055` once a certificate is configured — **no** `/api` suffix. |
| Bridge token | credential `bridgeToken` | **Required.** The bridge's `InvoiceToken`, which the operator chooses and sets in the bridge's `appsettings.json` (or `OL_BRIDGE_INVOICE_TOKEN`). Sent as both `Authorization: Bearer` and `x-bridge-token`; the bridge accepts either. Without it every `/api/*` route answers 401. Stored encrypted. |
| Request timeout | `config.timeoutMs` | optional, 1000–120000 ms. |
| Trigger model | `config.invoicing.triggerModel` | `manual` \| `auto-on-paid` \| `auto-on-shipped` \| `batched`. |

## Bridge configuration (Windows)

The bridge is launched by double-clicking (or running from `cmd`) `start-bridge.bat`, which
keeps a console window open for the life of the process. **There is no process supervision**:
no Windows Service, no auto-restart, no crash recovery. Closing the console window — or the
window closing on a crash — stops the bridge, and nothing brings it back automatically. Recovery
means an operator physically or remotely re-running `start-bridge.bat`.

The bridge listens on two ports:

- **5056 (plain HTTP)** — always open. With no certificate configured, this is the port
  OpenLinker reaches the bridge on, and the one images are served from.
- **5055 (HTTPS)** — opens only when `CertificatePath` / `CertificatePassword` are set. Use it
  when the bridge and OpenLinker are not on the same trusted network.

Auth is two credentials the **operator chooses**: `ApiUser` / `ApiPassword` guard the
WooCommerce-dialect shim routes, and `InvoiceToken` guards every `/api/*` route — the one
OpenLinker uses. Neither has a default, and unset means the routes they guard are CLOSED, not
open: a credential compiled into a binary is a credential everybody has.

> An earlier version of this runbook said these were "hardcoded constants baked into the
> bridge" and told the reader to consult their bridge operator. That was wrong, and wrong in
> the direction that leaves an operator stuck: there is nobody to consult, and until the value
> is set the bridge serves OpenLinker nothing.

Every key resolves in the same order: the environment variable `OL_BRIDGE_<KEY_UPPER_SNAKE>`,
then `appsettings.json` beside the executable, then a built-in default. So the invoicing token
is `OL_BRIDGE_INVOICE_TOKEN` or `InvoiceToken` in the file, and `OL_BRIDGE_PUBLIC_BASE` /
`PublicBase` is one key among many rather than the only one — it controls how image URLs the
bridge returns are resolved, since OpenLinker and Allegro fetch those images from outside the
bridge machine's own loopback.

- **Firewall.** Open inbound TCP on the bridge ports (5056, and 5055 once TLS is configured).
- **Auth.** Every `/api/*` route requires the Bearer token and answers 401 without it.
  `/health` is anonymous by design, so **a passing `/health` proves nothing about the token** —
  check `GET /api/bank-accounts` with the token instead. OpenLinker's own *Test connection*
  does exactly that.

## <a name="license"></a>License note

The bridge automates Subiekt GT through Sfera GT (COM `InsERT.GT`) — this requires a Subiekt GT
installation with COM automation available. Confirm licensing and session limits with InsERT /
your partner before going live.

---

## Version support matrix (v1)

| Subiekt | Status |
|---|---|
| **GT** | ✅ Full support — driven via Sfera GT (COM automation, ProgID `InsERT.GT`). Verified live against InsERT GT 1.89 SP1. |
| **nexo** | ❌ Not served by *this* adapter — it is a different product on a different bridge. Use [`@openlinker/integrations-subiekt-nexo`](../../subiekt-nexo/README.md), which ships alongside. |

| Component | Verified |
|---|---|
| Bridge runtime | .NET 8 (`net8.0-windows`) |
| OpenLinker adapter | `subiekt.gt.v1` |
| Subiekt GT | InsERT GT 1.89 SP1 |
| Order source (example) | PrestaShop 9.0.2 webservice |

---

## Document types & buyer

- OpenLinker's neutral `documentType` is **`invoice`** (→ faktura `FS …`) or **`receipt`**
  (→ paragon `PA …`). The Polish wire codes `FV`/`PA` are an adapter-internal detail.
- **Buyer tax id drives B2B/B2C:** a `buyerTaxId` of `{ scheme: "pl-nip", value: "…" }`
  present → faktura (company); absent → paragon (private). The NIP checksum is validated.
- The buyer profile is derived from the order's billing/shipping address (company name wins,
  else the person name). The order must carry an address — OpenLinker's PrestaShop order
  source hydrates it from the order's invoice address.

## Idempotency

One document per order. Issuance is keyed `invoice:{connectionId}:{orderId}`; a repeat
request (or a repeated auto-trigger event) returns the **same** document and never creates a
duplicate (HTTP 409 on an explicit re-issue of an already-issued order).

## KSeF / e-faktura

The KSeF badge reflects the status the bridge reports (`pending → sent → accepted` /
`rejected`), refreshed asynchronously by the regulatory-status reconcile job. On a
demo/trial database the status is **not** an authoritative government clearance.

## Paragon & the fiscal printer

A non-fiscal paragon issues on the demo database without a fiscal printer. **In production,
issuing a fiscal paragon requires a configured fiscal printer** attached to Subiekt — plan
for that hardware/driver before relying on the receipt path live.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Connection test / `/api/*` → **401** | Wrong/missing Bearer — the OpenLinker bridge token must equal the fixed credential configured on the bridge (general endpoints use the Basic-auth pair; invoicing endpoints use the separate bearer/`x-token` value). |
| Bridge is down / unreachable (outage) | **There is no auto-restart** — `start-bridge.bat` keeps a console window open, and closing it (or a crash) stops the bridge with nothing to bring it back. Recovery is manual: an operator must physically or remotely re-run `start-bridge.bat`. As of #3358 a periodic reachability sweep (every 5 minutes) logs a structured `subiekt_bridge_reachability_sweep_failed` line on the worker when the bridge can't be reached, so an operator watching worker logs (or a log-based alert they configure themselves — OpenLinker ships no built-in alerting/Slack/PagerDuty integration) can detect an outage faster than waiting for a failed sync job. |
| OpenLinker can't reach the bridge (timeout) | Firewall not open on the bridge port (5055 for OpenLinker traffic), or `bridgeBaseUrl` wrong (must be `https://…:5055`, no `/api`). |
| Image URLs from the bridge don't resolve outside the bridge machine | `OL_BRIDGE_PUBLIC_BASE` not set (or set to a loopback address) on the bridge — it must point to an address OpenLinker/Allegro can reach, defaulting to `http://host.docker.internal:5056`. |
| Issue → 422 `Subiekt does not support document type "FV"/"PA"` | Send the neutral `invoice`/`receipt`, not the Polish wire codes. |
| Issue → 422 `buyer details are unavailable` | The order has no usable address — ensure the order source hydrates the billing/shipping address. |
| Issue → 422 `Invalid NIP checksum` | Buyer NIP is malformed — fix it (B2B) or issue without a NIP (paragon). |
| Re-issue → 409 `Invoice already issued for order` | Expected — one document per order (idempotency guard). |
| Self-signed cert rejected by OpenLinker | Dev: trust the cert / allow self-signed; production: use a real CA cert. |

---

## Scheduler / env flags

| Flag | Effect |
|---|---|
| `config.invoicing.triggerModel = auto-on-paid` | Worker auto-enqueues issuance when an order is marked paid. |
| Regulatory-status reconcile job | Periodically refreshes `regulatoryStatus` (KSeF) for issued documents. |
| Bridge reachability sweep (#3358) | Every 5 minutes, the worker checks bridge reachability and logs `subiekt_bridge_reachability_sweep_failed` on failure — no built-in alerting, an operator must watch worker logs or wire their own alert on that log line. |
