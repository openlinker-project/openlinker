# Subiekt nexo — operator runbook

Operational reference for the Subiekt nexo integration. For the step-by-step setup see the
[setup guide](./setup-guide.md).

---

## Architecture at a glance

OpenLinker → (HTTPS + Bearer) → **Subiekt Bridge** (`openlinker-subiekt`, .NET 8, on the
Windows box next to Subiekt) → Sfera SDK → **Subiekt nexo**. Adapter key
`subiekt.invoicing.v1`, capability `Invoicing`.

---

## Connection configuration

| Field (wizard) | Config key | Notes |
|---|---|---|
| Bridge URL | `config.bridgeBaseUrl` | `https://<host>:5005` — **no** `/api` suffix. |
| Bridge token | credential `bridgeToken` | == bridge `Auth__ApiKey`; sent as `Authorization: Bearer` (the only header the bridge checks — a redundant `x-bridge-token` header is also sent but ignored). Stored encrypted. |
| Request timeout | `config.timeoutMs` | optional, 1000–120000 ms. |
| Trigger model | `config.invoicing.triggerModel` | `manual` \| `auto-on-paid` \| `auto-on-shipped` \| `batched`. |

## Bridge configuration (Windows)

Secrets go in **environment variables**, never in `appsettings*.json`:
`Auth__ApiKey`, `Sfera__NexoPassword`, `Sfera__SqlPassword`, `Tls__CertPassword`.

- **Bind / TLS.** Loopback by default. A non-loopback listener **requires** an `https://`
  URL (`ASPNETCORE_URLS=https://0.0.0.0:5005`) plus a cert in the `Tls` section, **and**
  `Auth.Enabled=true` with a non-empty key — otherwise the bridge refuses to start
  (fail-closed). Or terminate TLS at a reverse proxy and bind to loopback.
- **Firewall.** Open inbound TCP on the bridge port (default `5005`).
- **Auth.** `/health` is anonymous; every `/api/*` route requires the Bearer token (401 otherwise).

## <a name="license"></a>License note

The bridge works only through **Sfera for Subiekt nexo**. The demo/test database has Sfera
built in (so the trial works out of the box); a **purchased** Subiekt nexo needs the
**paid Sfera add-on** — without an active Sfera licence the bridge's `Połącz()`/`Zaloguj()`
calls fail. Confirm the licence and session limits with InsERT / your partner before going live.

---

## Version support matrix (v1)

| Subiekt | Status |
|---|---|
| **nexo PRO** | ✅ Full support (Sfera ships with the package). |
| **nexo (vanilla)** | ⚠️ Best-effort — depends on Sfera availability in the licence. |
| **GT** | ❌ Not supported in v1 (a separate bridge would be required). |

| Component | Verified |
|---|---|
| Bridge runtime | .NET 8 (`net8.0-windows`) |
| OpenLinker adapter | `subiekt.invoicing.v1` |
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
| Connection test / `/api/*` → **401** | Wrong/missing Bearer — the OpenLinker bridge token must equal the bridge `Auth__ApiKey`. |
| Bridge **refuses to start** (`non-localhost requires https`) | Network listener without TLS — set `Tls:CertPath` (+ `Tls__CertPassword`) or use a reverse proxy on loopback. |
| Bridge crashes loading the cert (`CryptographicException`) | `dev-cert.pfx` password ≠ `Tls__CertPassword` — regenerate with `dotnet dev-certs https -ep dev-cert.pfx -p <pwd>` using the same password. |
| OpenLinker can't reach the bridge (timeout) | Firewall not open on the bridge port, or `bridgeBaseUrl` wrong (must be `https://…`, no `/api`). |
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
