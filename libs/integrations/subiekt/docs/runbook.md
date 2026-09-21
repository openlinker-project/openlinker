# Subiekt GT — operator runbook

Operational reference for the Subiekt GT integration. For the step-by-step setup see the
[setup guide](./setup-guide.md).

---

## Architecture at a glance

OpenLinker → (HTTPS + Bearer) → **Subiekt Bridge** (`openlinker-subiekt`, .NET 8, on the
Windows box next to Subiekt) → Sfera GT (COM automation, ProgID `InsERT.GT`) →
**Subiekt GT**. Adapter key `subiekt.invoicing.v1`, capability `Invoicing`.

Sfera GT is the classic COM automation surface InsERT GT products expose (ProgID
`InsERT.GT`) — it is **not** the same thing as the separate .NET Sfera SDK
(`InsERT.Moria.Sfera`), which targets Subiekt nexo and is unrelated to this bridge.

---

## Connection configuration

| Field (wizard) | Config key | Notes |
|---|---|---|
| Bridge URL | `config.bridgeBaseUrl` | `https://<host>:5005` — **no** `/api` suffix. |
| Bridge token | credential `bridgeToken` | Basic-auth credential pair for general endpoints, sent as `Authorization: Bearer` (the only header the bridge checks — a redundant `x-bridge-token` header is also sent but ignored). Invoicing endpoints use a **separate** bearer/`x-token` value. Both are fixed values configured on the bridge — consult the bridge operator for the actual values used in your deployment. Stored encrypted. |
| Request timeout | `config.timeoutMs` | optional, 1000–120000 ms. |
| Trigger model | `config.invoicing.triggerModel` | `manual` \| `auto-on-paid` \| `auto-on-shipped` \| `batched`. |

## Bridge configuration (Windows)

The bridge is launched by double-clicking (or running from `cmd`) `start-bridge.bat`, which
keeps a console window open for the life of the process. **There is no process supervision**:
no Windows Service, no auto-restart, no crash recovery. Closing the console window — or the
window closing on a crash — stops the bridge, and nothing brings it back automatically. Recovery
means an operator physically or remotely re-running `start-bridge.bat`.

The bridge listens on two ports:

- **5055 (HTTPS, self-signed cert)** — the port OpenLinker talks to.
- **5056 (plain HTTP)** — used only so a browser or image-fetcher can reach the bridge without
  cert-trust issues.

Auth is two fixed, hardcoded credentials baked into the bridge (`Program.cs`), not environment
variables: a Basic-auth username/password pair for general endpoints, and a separate
Bearer/`x-token` value for invoicing endpoints specifically. Consult the bridge operator for the
actual values used in your deployment.

The one real environment variable the bridge reads is `OL_BRIDGE_PUBLIC_BASE` (defaults to
`http://host.docker.internal:5056`) — it controls how image URLs the bridge returns are
resolved, since OpenLinker and Allegro fetch those images from outside the bridge machine's own
loopback.

- **Firewall.** Open inbound TCP on the bridge ports (5055 for OpenLinker, 5056 if
  browser/image access is needed from elsewhere).
- **Auth.** `/health` is anonymous; every `/api/*` route requires the Bearer token (401 otherwise).

## <a name="license"></a>License note

The bridge automates Subiekt GT through Sfera GT (COM `InsERT.GT`) — this requires a Subiekt GT
installation with COM automation available. Confirm licensing and session limits with InsERT /
your partner before going live.

---

## Version support matrix (v1)

| Subiekt | Status |
|---|---|
| **GT** | ✅ Full support — driven via Sfera GT (COM automation, ProgID `InsERT.GT`). Verified live against InsERT GT 1.89 SP1. |
| **nexo** | ❌ Not supported by this integration (a different bridge, targeting the .NET Sfera SDK, would be required). |

| Component | Verified |
|---|---|
| Bridge runtime | .NET 8 (`net8.0-windows`) |
| OpenLinker adapter | `subiekt.invoicing.v1` |
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
