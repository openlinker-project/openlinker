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
| `Invoicing` | `RegulatoryStatusReader` (read the bridge-reported KSeF regulatory status), `CorrectionIssuer` (issue corrections of an already-issued document) |

See [`docs/capabilities.md`](../../../docs/capabilities.md) for the full sub-capability catalog.

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
