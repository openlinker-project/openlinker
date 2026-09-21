# @openlinker/integrations-subiekt

Subiekt GT adapter for OpenLinker — issues faktura (FS) and paragon (PA) documents
in Subiekt GT (InsERT GT) via the OpenLinker Subiekt Bridge.

## What this package does

OpenLinker never talks to Subiekt directly. It sends an invoice command to the
**Subiekt Bridge** — a small .NET service running on the Windows machine where
Subiekt GT is installed — which drives Subiekt GT through classic **Sfera GT**
COM automation (COM ProgID `InsERT.GT`):

```
OpenLinker  →  HTTPS + Bearer  →  Subiekt Bridge  →  Sfera GT (COM)  →  Subiekt GT
```

Note: Sfera GT is unrelated to the newer .NET "Sfera SDK" (`InsERT.Moria.Sfera`),
which targets Subiekt nexo, a different InsERT product line this integration does
not use.

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
  "bridgeToken": "<the bridge's fixed invoicing bearer/x-token value>"
}
```

**Config**:

```json
{
  "bridgeBaseUrl": "https://192.168.1.50:5055",
  "invoicing": {
    "triggerModel": "manual"
  }
}
```

| Field | Values | Notes |
|---|---|---|
| `bridgeBaseUrl` | HTTPS URL **without** `/api` | The adapter appends `/api/...` paths. If OpenLinker runs on a different host than the bridge, use the bridge machine's address, e.g. `https://192.168.1.50:5055` |
| `invoicing.triggerModel` | `"manual"` \| `"auto-on-paid"` \| `"auto-on-shipped"` \| `"batched"` | `manual` = operator clicks Issue; others = worker-driven auto-issuance |

Authentication is not env-configurable per deployment: the bridge is compiled with
a fixed Basic-auth credential pair for its general endpoints, and a separate
bearer token (`x-token`) for invoicing endpoints specifically. Consult the bridge
operator for the actual values used in your deployment.

## Running the bridge

The bridge is launched via a `.bat` launcher script (`start-bridge.bat`) on the
Windows machine where Subiekt GT is installed. Run it directly — double-click it
or invoke it from `cmd` — and leave its console window open; it keeps the bridge
process alive and closing the window stops the bridge.

The bridge listens on two ports:

- **5055 (HTTPS, self-signed certificate)** — the primary API, used by OpenLinker.
- **5056 (plain HTTP)** — used only so a browser or image-fetcher (e.g. Allegro,
  fetching a product image URL the bridge returned) can reach the bridge without
  needing to trust the self-signed cert.

The one environment variable the bridge reads is `OL_BRIDGE_PUBLIC_BASE`
(default: `http://host.docker.internal:5056`) — it controls the base URL used
when the bridge builds image URLs in its responses, so those URLs resolve from
outside the bridge machine's own loopback (OpenLinker and Allegro fetch images
from outside that machine, not from `localhost` on it).

Confirmed working against Subiekt GT / InsERT GT 1.89 SP1.

## Operational limitations

- **No process supervision.** The bridge is a plain console process started by
  `start-bridge.bat` — there is no Windows Service wrapper and no auto-restart.
  If the console window is closed, the machine reboots, or the process crashes,
  the bridge stays down until someone re-runs the launcher by hand.

## Documentation

- **Operator tutorial** — [docs/tutorial.md](./docs/tutorial.md) — complete A-to-Z setup guide with screenshots
- **Developer setup guide** — [docs/setup-guide.md](./docs/setup-guide.md)
- **Operations runbook** — [docs/runbook.md](./docs/runbook.md)
