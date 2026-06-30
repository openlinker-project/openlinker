# Subiekt nexo — Operator Tutorial

Issue faktura (FS) and paragon (PA) documents in Subiekt nexo for OpenLinker orders —
complete A-to-Z guide covering the bridge, the OpenLinker wizard, and the full
order → invoice flow.

> **Happy path only.** For TLS config, firewall, version matrix, and troubleshooting
> see [`runbook.md`](./runbook.md).

---

## What you need before you start

- **Windows machine** with Subiekt nexo PRO + Sfera (the SDK ships with the
  demo/trial database; a production nexo requires the paid Sfera add-on).
- **.NET 8 runtime** on the Windows machine.
- The [`openlinker-subiekt-bridge`](https://github.com/openlinker-project/openlinker-subiekt-bridge)
  repository cloned (not yet published).
- OpenLinker running (API + worker + web) and reachable from the Windows machine.
- A **source connection** (e.g. PrestaShop or Allegro) already set up in OpenLinker
  so that orders flow in.

---

## Part 1 — Configure and run the bridge

The bridge translates OpenLinker's neutral invoice command into Sfera SDK operations
that Subiekt nexo executes. It runs as a console app on Windows (started via
PowerShell — **not** a compiled exe).

### 1a — Configure `appsettings.json`

Open `bridge/Subiekt.Bridge.Api/appsettings.json` and fill in the Sfera paths
and SQL connection. Secrets go in **environment variables only** — never in the file.

```json
{
  "Port": 5005,
  "Auth": { "Enabled": true, "ApiKey": "", "HeaderName": "X-Api-Key" },
  "Sfera": {
    "BinariesDir": "%LOCALAPPDATA%\\InsERT\\Deployments\\Nexo\\<deployment>\\Binaries",
    "SqlServer":   "localhost\\INSERTNEXO",
    "SqlDatabase": "Nexo_Demo_1",
    "SqlUseWindowsAuth": true,
    "NexoUser":    "Szef"
  }
}
```

Replace `<deployment>` with the folder name visible under
`%LOCALAPPDATA%\InsERT\Deployments\Nexo\`.

> **Windows auth:** `SqlUseWindowsAuth: true` uses the current Windows session —
> no SQL password needed. Set `false` and supply `Sfera__SqlPassword` if you use
> SQL Server auth instead.

### 1b — Set secrets in PowerShell

Open **PowerShell** and navigate to the repository root. Set the secret
environment variables for the current session:

```powershell
cd C:\Users\<user>\repos\openlinker-subiekt-bridge

$env:Auth__ApiKey       = "a-strong-random-token"   # copy this — it's your bridgeToken
$env:Sfera__NexoPassword = "your-nexo-operator-password"
# Only needed when SqlUseWindowsAuth = false:
# $env:Sfera__SqlPassword = "your-sql-password"
```

> **WSL users:** the Windows host IP seen from WSL is your default gateway.
> Find it with:
> ```bash
> ip route show default | awk '{print $3}'
> # example: 172.26.96.1
> ```
> Use this IP as the **Bridge URL** when you create the connection in Part 2.

### 1c — Start the bridge

```powershell
dotnet run -c Release --project bridge/Subiekt.Bridge.Api
```

The console should print:

```
Now listening on: http://127.0.0.1:5005
...
Sfera session opened — zalogowano
```

> **Non-loopback binding (remote):** if OpenLinker runs on a different machine,
> the bridge must listen on a non-loopback address with TLS. Generate a dev cert:
> ```powershell
> dotnet dev-certs https -ep dev-cert.pfx -p your-cert-password
> $env:Tls__CertPassword = "your-cert-password"
> $env:ASPNETCORE_URLS = "https://0.0.0.0:5005"
> dotnet run -c Release --project bridge/Subiekt.Bridge.Api
> ```

### 1d — Smoke-test the bridge

From a WSL terminal or any shell that can reach the Windows machine:

```bash
curl http://172.26.96.1:5005/health
# → {"status":"ok","bridge":"up","sferaSession":"valid","subiekt":"reachable"}
```

A `"sferaSession":"valid"` confirms the bridge authenticated with Sfera and
Subiekt nexo is reachable.

---

## Part 2 — Create a Subiekt connection in OpenLinker

In OpenLinker, go to **Connections** and click **Add connection**.

![Connections page — Add connection button highlighted](./assets/06-ol-connections-list.png)

On the platform picker, find and select **Subiekt nexo**.

![Platform picker — Subiekt nexo card](./assets/07-ol-platform-picker.png)

The guided setup wizard opens. Fill in the fields:

![Subiekt setup wizard — empty form](./assets/08-ol-subiekt-wizard-empty.png)

- **Connection name** — a human-readable label, e.g. `My Subiekt`.

  ![Wizard — connection name filled in](./assets/09-ol-wizard-name.png)

- **Bridge URL** — the bridge base URL **without** a path suffix, e.g.
  `http://172.26.96.1:5005`. The adapter appends `/api/…` paths automatically.

  ![Wizard — bridge URL filled in](./assets/10-ol-wizard-bridge-url.png)

- **Bridge token** — paste the value you set as `Auth__ApiKey` in Part 1b.
  Stored encrypted; never shown again after save.

  ![Wizard — bridge token field filled (value obscured)](./assets/11-ol-wizard-token-filled.png)

Click **Connect Subiekt**. OpenLinker creates the connection record:

![Connection created — success state with Test connection button](./assets/12-ol-subiekt-created.png)

Click **Test connection** — OpenLinker calls `GET /health` on the bridge and
shows the result inline.

![Test connection result — bridge healthy, sferaSession valid](./assets/13-ol-test-ok.png)

The connection now appears in the Connections list with the **Invoicing** capability badge:

![Connections list — Subiekt entry with Invoicing badge](./assets/14-ol-connections-with-subiekt.png)

Click the connection to view its detail page:

![Subiekt connection detail — capabilities, status, edit surface](./assets/15-ol-subiekt-detail.png)

> **Advanced mode (alternative):** Add connection → Use advanced mode:
> `Platform type = subiekt`, `Adapter key = subiekt.invoicing.v1`,
> `Enabled capabilities = Invoicing`,
> `Credentials JSON = { "bridgeToken": "<token>" }`,
> `Config JSON = { "bridgeBaseUrl": "http://<host>:5005" }`.

---

## Part 3 — Get an order into OpenLinker

Orders flow into OpenLinker from any configured source connection (PrestaShop,
Allegro, WooCommerce, Erli, …). For a B2B faktura, the buyer address must
include a **NIP** (Polish VAT number) — OpenLinker reads this to auto-select
the `VAT` document type.

For a quick test with PrestaShop:

1. In the PrestaShop back office, go to **Customers → Add new customer** and
   create a customer.
2. Add a company address: fill **Company** and **VAT number (NIP)**.
3. Go to **Orders → Add new order**: pick the customer, add a product, select
   the company address, set **Payment = accepted**, click **Create the order**.

OpenLinker ingests the order on its next poll (or via webhook). It appears in
**Operations → Orders**.

---

## Part 4 — Issue the invoice

Open **Operations → Orders**. Find the ingested order and click it.

![Orders list — ingested orders](./assets/20-ol-orders-list.png)

The order detail page shows the full order with the **Invoice** panel at the bottom.

![Order detail — line items, buyer address, Invoice panel](./assets/21-ol-order-detail.png)

If you have multiple invoicing connections configured, the Invoice panel first
shows a **connection picker** — select the Subiekt connection you want to issue
through.

![Invoice panel — connection picker with Subiekt connections](./assets/22-ol-invoice-panel-connection-picker.png)

After selecting the connection, the panel loads the invoice state. If no invoice
exists yet, it shows the document-type dropdown and the **Issue invoice** button.
OpenLinker pre-selects **Invoice (faktura VAT)** when the buyer address contains
a NIP.

![Invoice panel — connection selected, "Issue invoice" button ready](./assets/23-ol-invoice-panel-ready-to-issue.png)

Click **Issue invoice**. OpenLinker sends the command to the bridge → bridge calls
Sfera → Subiekt nexo creates the document. The panel transitions through
**Issuing…** to **Issued**.

![Invoice panel — shortly after clicking Issue](./assets/24-ol-invoice-issuing-or-issued.png)

The **Issued** state shows the Subiekt document number (e.g. `FS 168/CENTRALA/2026`)
and, if KSeF submission is configured, the regulatory status badge.

![Invoice panel — issued state with FS document number](./assets/25-ol-invoice-issued-state.png)

---

## Part 5 — Verify in Subiekt nexo

Open Subiekt nexo and go to **Dokumenty → Sprzedaży** (Sales documents). The
new FS document appears at the top of the list. Open it to verify the line items,
VAT breakdown, and buyer NIP — the document number matches the one shown in
OpenLinker's Invoice panel.

![Subiekt nexo — FS document detail, line items, NIP, VAT breakdown](./assets/27-subiekt-nexo-fs-detail.png)

---

## Part 6 — Invoices list in OpenLinker

Go to **Operations → Invoices** (`/invoices`). Every issued document appears
here with its number, document type, issue date, and a PDF link (when the
bridge returns one).

![/invoices list — issued documents with FS numbers and status](./assets/26-ol-invoices-list.png)

---

## Part 7 — B2C receipt (paragon) variant

An order placed by an individual buyer (no NIP in the address) becomes a
**paragon** (PA). Create an order for a customer without a VAT number.

OpenLinker auto-selects **Receipt (paragon)** in the document-type dropdown.
Click **Issue invoice** — the bridge routes the command to Sfera as a paragon
issuance.

The Issued state shows a `PA …` document number instead of `FS …`.

---

## Part 8 — Automatic issuance

Instead of clicking per order, change the connection's **Invoice trigger model**
to fire automatically. Edit the connection (**Connections → My Subiekt → Edit**)
and set the trigger (e.g. `auto-on-paid` or `auto-on-shipped`).

OpenLinker enqueues issuance automatically when an ingested order reaches that
state — the document appears in the Invoice panel and on `/invoices` exactly as
a manual issue does.

**Idempotency:** a repeated trigger or a double-click never creates a second
document. OpenLinker keys each issuance attempt by
`invoice:{connectionId}:{orderId}`. Re-triggering an already-issued order returns
the existing document silently (no duplicate in Subiekt nexo).

---

## Next steps

- **Retry a failure:** if issuance fails (bridge unreachable, malformed NIP,
  Sfera error), the panel shows **Failed** with a **Retry** button and the
  error message. Fix the root cause and click Retry — the same idempotency key
  applies, so no duplicate is created.

- **PDF download:** when the bridge returns a PDF URL in its response,
  the `/invoices` row shows an **Invoice PDF** link.

- **KSeF integration:** pair the Subiekt connection with a KSeF connection to
  automatically submit the issued FS document for e-invoicing clearance. See
  [`ksef tutorial`](../../ksef/docs/tutorial.md).

- **Operational reference** — version matrix, TLS/auth/firewall, troubleshooting:
  [`runbook.md`](./runbook.md).
