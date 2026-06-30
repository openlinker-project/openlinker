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

Document type is driven by the buyer's tax ID: an order **with** a NIP becomes a
**faktura** (FS); **without** one it becomes a **paragon** (PA).

## Adapter

| Property | Value |
|---|---|
| **Adapter key** | `subiekt.invoicing.v1` |
| **Platform type** | `subiekt` |
| **Package** | `@openlinker/integrations-subiekt` |

## Capabilities

| Capability | Notes |
|---|---|
| `Invoicing` | Issue faktura / paragon; read document status and KSeF regulatory badge |

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
| `bridgeBaseUrl` | HTTPS URL **without** `/api` | The adapter appends `/api/...` paths. From WSL: use the Windows host gateway IP, e.g. `https://172.26.96.1:5005` |
| `invoicing.triggerModel` | `"manual"` \| `"auto-on-paid"` \| `"auto-on-shipped"` \| `"batched"` | `manual` = operator clicks Issue; others = worker-driven auto-issuance |

## Running the bridge

The bridge lives in the [`openlinker-subiekt-bridge`](https://github.com/openlinker-project/openlinker-subiekt-bridge)
repository (not yet published). Start from a console (PowerShell in WSL
or a native Windows terminal — not as a compiled exe):

```powershell
# PowerShell (in WSL: pwsh, or Windows Terminal)
cd /mnt/c/Users/<user>/repos/openlinker-subiekt-bridge    # adjust path

$env:Sfera__NexoPassword = "your-nexo-password"
$env:Sfera__SqlPassword  = "your-sql-password"
$env:Auth__ApiKey        = "your-bridge-bearer-token"
$env:Tls__CertPassword   = "your-cert-password"
$env:ASPNETCORE_URLS     = "https://0.0.0.0:5005"

dotnet run -c Release --project bridge/Subiekt.Bridge.Api
```

A healthy bridge prints `Now listening on: https://…:5005` and `Sfera: zalogowano`.
Smoke-test: `curl -k https://<bridge-host>:5005/health` → `{"status":"ok","sferaSession":"valid","subiekt":"reachable"}`.

See the bridge repo's `docs/DEPLOYMENT.md` for TLS, firewall, and SQL config.

## Documentation

- **Operator tutorial** — [docs/tutorial.md](./docs/tutorial.md) — complete A-to-Z setup guide with screenshots
- **Developer setup guide** — [docs/setup-guide.md](./docs/setup-guide.md)
- **Operations runbook** — [docs/runbook.md](./docs/runbook.md)

## Source layout

```
src/
├── subiekt-plugin.ts               # Plugin descriptor + manifest
├── subiekt-integration.module.ts   # NestJS module
└── infrastructure/
    └── adapters/
        ├── subiekt-invoicing.adapter.ts   # InvoicingPort implementation
        └── subiekt-http-client.ts         # HTTPS client with Bearer auth
```
