# Subiekt GT — Operator Tutorial

Issue faktura (FS) and paragon (PA) documents in Subiekt GT for OpenLinker orders —
complete A-to-Z guide covering the bridge, the OpenLinker wizard, and the full
order → invoice flow.

> **Happy path only.** For TLS config, firewall, version matrix, and troubleshooting
> see [`runbook.md`](./runbook.md).

---

## What you need before you start

- **Windows machine** with Subiekt GT (InsERT GT product line) and Sfera GT —
  the classic COM automation layer for Subiekt GT (ProgID `InsERT.GT`). This is
  a different product/API from the .NET Sfera SDK (`InsERT.Moria.Sfera`) used
  by Subiekt nexo — the bridge does not use that SDK at all.
- **.NET 8 runtime** on the Windows machine.
- The [`openlinker-subiekt-bridge`](https://github.com/openlinker-project/openlinker-subiekt-bridge)
  repository cloned. It is public; the GT bridge lives in `bridge-gt/` and is run from
  source with `dotnet run`, so the machine also needs the **.NET 8 SDK**, not just the
  runtime. There is no installer and no packaged `.exe` to download.
- OpenLinker running (API + worker + web) and reachable from the Windows machine.
- A **source connection** (e.g. PrestaShop or Allegro) already set up in OpenLinker
  so that orders flow in.

---

## Part 1 — Configure and run the bridge

The bridge translates OpenLinker's neutral invoice command into Sfera GT COM
automation calls that Subiekt GT executes. It runs as a console app on Windows,
started via a `.bat` launcher script.

### 1a — Configure `appsettings.json`

Copy the template that ships beside the bridge and edit your copy:

```powershell
cd openlinker-subiekt-bridge\bridge-gt
copy appsettings.example.json appsettings.json
notepad appsettings.json
```

The file lives **next to the executable**, and it is flat — one level of keys, no
sections:

```json
{
  "SqlServer": "YOUR-HOST\\INSERTGT",
  "SqlDatabase": "YOUR-DB",
  "SferaOperator": "Szef",
  "SferaPassword": "",
  "InvoiceToken": "pick-a-long-random-string",
  "HttpPort": 5056,
  "HttpsPort": 5055
}
```

Every key also resolves from an environment variable named
`OL_BRIDGE_<KEY_UPPER_SNAKE_CASE>` — `SqlServer` is `OL_BRIDGE_SQL_SERVER`,
`InvoiceToken` is `OL_BRIDGE_INVOICE_TOKEN` — which takes precedence over the file.
Anything you leave out falls back to a built-in default, except the three credentials,
which have none.

> **`SqlConnectionString`** overrides `SqlServer` / `SqlDatabase` entirely. Use it when
> the installation needs SQL authentication rather than the integrated security the other
> two compose.

### 1a-bis — Choose the bridge token

`InvoiceToken` is a shared secret **you invent**. Nobody issues it, it is not printed
anywhere, and it is not compiled into the binary. Pick a long random string, put it here,
and paste **the same value** into the *Bridge token* field in Part 2.

Until you set it, every `/api/*` request answers `401` with
`bridge token is not configured`. An unset token is not a "no security" mode — it is a
bridge that serves OpenLinker nothing.

> An earlier version of this tutorial said auth was "two fixed credential pairs, not
> user-configurable" and told you to consult your bridge operator. That was wrong, and
> wrong in the direction that leaves you stuck: there is nobody to consult.

### 1b — Configure the public base URL (optional)

If OpenLinker or Allegro need to fetch images that the bridge returns (e.g.
product photos referenced from a generated document), those URLs must resolve
from *outside* the bridge machine — the bridge's own loopback address won't
work for a remote caller. Set:

```
OL_BRIDGE_PUBLIC_BASE = http://<this-machine-host-or-ip>:5056
```

If unset, it defaults to `http://host.docker.internal:5056`, which is correct
when OpenLinker runs in Docker on the same machine as the bridge.

### 1c — Start the bridge

Run `start-bridge.bat` (double-click it, or run it from a `cmd` window). This
keeps a console window open for as long as the bridge runs — **closing the
window stops the bridge process.** There is no Windows Service wrapper and no
automatic restart on crash or reboot; if the bridge needs to stay up
unattended, you're responsible for supervising the process yourself (e.g. a
scheduled task, NSSM, or similar).

The console should print that the bridge is listening and that a Sfera GT
session opened successfully.

The bridge listens on two ports:

- **5056** — plain HTTP, always open. With no certificate configured this is the port
  OpenLinker reaches the bridge on, and the one images are served from.
- **5055** — HTTPS, opens only when `CertificatePath` / `CertificatePassword` are set.

### 1d — Smoke-test the bridge

Run both checks **from the machine OpenLinker runs on**, not from the Windows box:

```powershell
# Is it up? /health is anonymous by design.
Invoke-RestMethod http://<bridge-host>:5056/health

# Does the token work? /health cannot tell you - it is exempt from auth.
Invoke-RestMethod http://<bridge-host>:5056/api/bank-accounts `
  -Headers @{ Authorization = "Bearer <your-token>" }
```

The first reports whether the Sfera GT session is valid and Subiekt GT is reachable.
The second is the one that proves your token works — a `200` with a
`{ success: true, ... }` envelope. A `401` names which problem you have.

This tutorial was verified live against **InsERT GT 1.89 SP1**.

---

## Part 2 — Create a Subiekt connection in OpenLinker

In OpenLinker, go to **Connections** and click **Add connection**.

![Connections page — Add connection button highlighted](./assets/06-ol-connections-list.png)

On the platform picker, find and select **Subiekt GT**.

![Platform picker — Subiekt GT card](./assets/07-ol-platform-picker.png)

The guided setup wizard opens. Fill in the fields:

![Subiekt setup wizard — empty form](./assets/08-ol-subiekt-wizard-empty.png)

- **Connection name** — a human-readable label, e.g. `My Subiekt`.
- **Bridge URL** — the bridge base URL **without** a path suffix, e.g.
  `http://127.0.0.1:5005` (same machine) or `http://192.168.1.50:5005` (bridge
  on a different machine). The adapter appends `/api/…` paths automatically.
- **Bridge token** — paste the bearer token your bridge operator configured
  for the invoicing endpoints. Stored encrypted; never shown again after save.

![Wizard — all fields filled in](./assets/09-ol-wizard-filled.png)

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
> `Platform type = subiekt-gt`, `Adapter key = subiekt.gt.v1`,
> `Enabled capabilities = Invoicing`,
> `Credentials JSON = { "bridgeToken": "<token>" }`,
> `Config JSON = { "bridgeBaseUrl": "http://<host>:5005" }`.

---

## Part 3 — Get an order into OpenLinker

Orders flow into OpenLinker from any configured source connection (PrestaShop,
Allegro, WooCommerce, Erli, …). For a B2B faktura, the buyer address must
include a **NIP** (Polish VAT number) - Subiekt needs it on the issued
document. You pick the document type yourself in Part 4.

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
The dropdown always defaults to **Invoice (faktura)** - it is NOT derived from the
buyer's NIP, so check the selection matches the order (Invoice for a B2B buyer
with a NIP, Receipt for B2C) before issuing.

![Invoice panel — connection selected, "Issue invoice" button ready](./assets/23-ol-invoice-panel-ready-to-issue.png)

Click **Issue invoice**. OpenLinker sends the command to the bridge → bridge calls
Sfera GT → Subiekt GT creates the document. The panel briefly shows **Issuing…**
then flips to **Issued**.

The **Issued** state shows the Subiekt document number (e.g. `FS 175/CENTRALA/2026`)
and, if KSeF submission is configured, the regulatory status badge.

![Invoice panel — issued state with FS document number](./assets/25-ol-invoice-issued-state.png)

---

## Part 5 — Verify in Subiekt GT

Open Subiekt GT and go to **Dokumenty → Sprzedaży** (Sales documents). The
new FS document appears at the top of the list. Open it to verify the line items,
VAT breakdown, and buyer NIP — the document number matches the one shown in
OpenLinker's Invoice panel.

![Subiekt GT — FS document detail, line items, NIP, VAT breakdown](./assets/27-subiekt-nexo-fs-detail.png)

---

## Part 6 — Invoices list in OpenLinker

Go to **Operations → Invoices** (`/invoices`). Every issued document appears
here with its number, document type, issue date, and a PDF link (when the
bridge returns one).

![/invoices list — issued documents with FS numbers and status](./assets/26-ol-invoices-list.png)

---

## Part 7 — B2C receipt (paragon) variant

An order placed by an individual buyer (no NIP in the address) should be issued
as a **paragon** (PA). Create an order for a customer without a VAT number.

In the Invoice panel, manually select **Receipt (paragon)** in the document-type
dropdown - the dropdown defaults to Invoice (faktura) and OpenLinker does NOT
switch it for you based on the missing NIP. Then click **Issue invoice** - the
bridge routes the command to Sfera GT as a paragon issuance.

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
the existing document silently (no duplicate in Subiekt GT).

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
