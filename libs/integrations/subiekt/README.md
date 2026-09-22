# @openlinker/integrations-subiekt

Subiekt nexo adapter for OpenLinker — issues faktura (FS) and paragon (PA) documents
in Subiekt nexo ERP via the OpenLinker Sfera Bridge.

## What this package does

OpenLinker never talks to Subiekt directly. It sends an invoice command to the
**Subiekt Bridge** — a small .NET 8 service running on the Windows machine where
Subiekt nexo is installed — which translates it into Sfera SDK business operations:

```
OpenLinker  →  HTTPS + Bearer  →  Subiekt Bridge  →  Sfera SDK  →  Subiekt nexo
```

Document type is driven by the buyer's tax ID **only on the auto-issue path**
(when no explicit `documentType` is supplied): an order **with** a NIP becomes a
**faktura** (FS); **without** one it becomes a **paragon** (PA). In the manual
Invoice panel the operator picks the document type explicitly - the UI defaults
to Invoice (faktura) and does not derive the type from the NIP.

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `subiekt.invoicing.v1` |
| **Platform type** | `subiekt` |
| **Package** | `@openlinker/integrations-subiekt` |

## Capabilities

| Capability | Sub-capabilities |
|---|---|
| `Invoicing` | `RegulatoryStatusReader` (read the bridge-reported KSeF regulatory status), `CorrectionIssuer` (issue corrections of an already-issued document, #1229), `BankAccountsReader` / `BankAccountDefaultSetter` (list and default the seller's payable bank accounts, #1303), `RegulatoryRecordLocator` (crash-recovery — locate a document by its original idempotency key when a prior issuance's outcome is unknown, #3389), `PaymentStatusReader` (read whether a document is settled, `dok_Rozliczony`, #3390) |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

## Scope (#3395)

Subiekt is an **`Invoicing`-only** integration — it never implements `ProductMaster`,
`InventoryMaster`, `OrderProcessorManager`, or any other capability. An operator who
wants Subiekt to also drive inventory or order fulfillment needs a second connection
on a different platform for those roles; Subiekt's adapter exists purely to make sure
every order OpenLinker processes also gets a correct fiscal document in Subiekt nexo.

What this integration **does**, end to end, live-verified against a real Sfera bridge:

- Issues faktura (FS) and paragon (PA) documents, and corrections (KFS) against an
  already-issued original — including Subiekt's own KSeF-gating business rules (a
  document not yet registered in KSeF, or with a prior unregistered correction,
  correctly refuses a further correction rather than silently accepting one).
- Every issuance and correction is idempotent: a retried request with the same
  `idempotencyKey` returns the *same* document rather than creating a duplicate — a
  fiscal-safety property, not just a convenience, and verified live under a real
  replay.
- Reads a document's KSeF regulatory status, its settlement (`paid`) status, and can
  crash-recover a lapsed-lease `issuing` record by locating it via its original
  idempotency key rather than re-issuing.
- Lists and defaults the seller's payable bank accounts.

What this integration **does not, and cannot, do** on this Sfera SDK tier (both
researched and confirmed live, not assumed — see #3392 / #3393 for the full evidence):

- **`PaymentMarker.markPaid`** — there is no writable path to mark a document as paid.
  The session object exposes exactly two managers (`SuDokumentyManager`,
  `KontrahenciManager`); neither creates a payment/settlement record, and the one
  plausible property on a loaded document (`Rozliczony`) is silently read-only in
  effect — setting it and saving reports success but never persists.
- **`RegulatoryDocumentReader`** — there is no headless way to retrieve a rendered
  document (PDF or otherwise). The only export-shaped method on a document object,
  `Drukuj`, is unconditionally interactive (blocks on a modal dialog) regardless of
  whether it is called with or without a file-path argument, on every code path
  tested.

Both gaps are structural to the exposed Sfera automation surface, not something this
adapter's implementation could route around safely. If InsERT exposes a broader
finance/reporting manager in a future Sfera license tier, both should be revisited.

## Ingestion latency (#3396)

Subiekt has **no outbound webhook or event mechanism** of any kind — it is a
Windows-desktop ERP with a COM automation surface, not a service that can call back
out to OpenLinker. Every fact this integration reads from Subiekt (KSeF regulatory
status, settlement status, a crash-recovered document lookup) is therefore either an
**on-demand read** (triggered by an operator action or another OL flow) or a
**scheduled poll**, never a push.

- **KSeF regulatory status** (`RegulatoryStatusReader`) is kept fresh by the shared
  `invoicing.regulatoryStatus.reconcile` scheduler task
  (`OL_REGULATORY_RECONCILE_CRON`, **default every 30 minutes**), which runs for
  every `Invoicing`-capable connection, Subiekt included. A KSeF status change inside
  Subiekt nexo is therefore visible in OpenLinker within one reconcile interval, not
  instantly.
- **Settlement/paid status** (`PaymentStatusReader`, #3390) has **no periodic sweep
  at all** on this adapter. The only existing caller of this capability
  (`PaymentStatusRefreshHandler` / `invoicing.paymentStatus.refreshByExternalId`) is
  itself webhook-triggered — enqueued when a provider like inFakt calls back with a
  `invoice_marked_as_paid` event. Since Subiekt has no webhook to trigger that job,
  `PaymentStatusReader.getPaymentStatus` is reachable today only through a direct,
  on-demand call (e.g. a future manual "refresh payment status" action); an operator
  marking an invoice paid inside Subiekt's own UI does **not** automatically
  propagate into OpenLinker. Wiring a periodic sweep for poll-only providers is a
  reasonable follow-up if this capability needs to stay fresh unattended, but is not
  implemented here.

There is no way to get push-based freshness without InsERT itself exposing an
outbound event mechanism, which does not exist on this Sfera SDK tier.

## Credentials & config

**Credentials** (stored encrypted, set via the connection wizard):

```json
{
  "bridgeToken": "<Bearer token matching Auth__ApiKey on the bridge>"
}
```

**Config**:

```json
{
  "bridgeBaseUrl": "https://192.168.1.50:5005",
  "invoicing": {
    "triggerModel": "manual"
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `bridgeBaseUrl` | HTTPS URL **without** `/api` | The adapter appends `/api/...` paths. If OpenLinker runs on a different host than the bridge, use the bridge machine's address, e.g. `https://192.168.1.50:5005` |
| `invoicing.triggerModel` | `"manual"` \| `"auto-on-paid"` \| `"auto-on-shipped"` \| `"batched"` | `manual` = operator clicks Issue; others = worker-driven auto-issuance |

## Running the bridge

The bridge lives in the [`openlinker-subiekt-bridge`](https://github.com/openlinker-project/openlinker-subiekt-bridge)
repository. Start it from a Windows PowerShell prompt (not as a compiled exe):

```powershell
cd C:\Users\<user>\repos\openlinker-subiekt-bridge    # adjust path

$env:Sfera__NexoPassword = "your-nexo-password"
$env:Sfera__SqlPassword  = "your-sql-password"
$env:Auth__ApiKey        = "your-bridge-bearer-token"
$env:Tls__CertPassword   = "your-cert-password"
$env:ASPNETCORE_URLS     = "https://0.0.0.0:5005"

dotnet run -c Release --project bridge/Subiekt.Bridge.Api
```

A healthy bridge prints `Now listening on: https://…:5005` and `Sfera: zalogowano`.
Smoke-test: `curl -k https://<bridge-host>:5005/health` → `{"status":"ok","bridge":"up","sferaSession":"valid","subiekt":"reachable"}`.

See the bridge repo's `docs/DEPLOYMENT.md` for TLS, firewall, and SQL config.

## Documentation

- **Operator tutorial** — [docs/tutorial.md](./docs/tutorial.md) — complete A-to-Z setup guide with screenshots
- **Developer setup guide** — [docs/setup-guide.md](./docs/setup-guide.md)
- **Operations runbook** — [docs/runbook.md](./docs/runbook.md)
