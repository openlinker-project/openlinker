# KSeF — Operator Tutorial

Issue FA(3) VAT invoices from OpenLinker orders and submit them to KSeF
(Krajowy System e-Faktur) for government clearance — complete A-to-Z guide.

> **Happy path only.** For error handling, retry, and compliance caveats see
> [`setup-guide.md`](./setup-guide.md).

---

## What you need before you start

- OpenLinker running (API + worker + web).
- A source connection (PrestaShop, Allegro, …) already set up so orders flow in.
- Access to the KSeF 2.0 Taxpayer Application for your target environment:
  - **Test:** `https://ap-test.ksef.mf.gov.pl` — supports a built-in **test
    authentication** mechanism (no real Trusted Profile / qualified certificate
    needed; uses fictional data only)
  - **Demo:** pre-production environment, announced separately by the Ministry
    of Finance ahead of go-live
  - **Prod:** `https://ksef.mf.gov.pl` (requires a real Trusted Profile,
    qualified signature, or qualified seal)
- The **NIP** (Polish tax ID) of the seller entity you will invoice as.

> ⚠️ The older `ksef-test.mf.gov.pl` (KSeF 1.0) test portal was decommissioned
> on 1 September 2025. The current test environment lives at
> `ap-test.ksef.mf.gov.pl`.

---

## Part 1 — Get a KSeF authorisation token

KSeF uses token-based auth. You generate a token on the KSeF portal once and store
it in OpenLinker's encrypted credential store.

Open the test portal (`ap-test.ksef.mf.gov.pl`) and choose **Uwierzytelnienie
testowe** (test authentication) — no real Trusted Profile is required here.

![KSeF 2.0 portal — login page with test authentication option](./assets/p1-ksef-portal-home.png)

Accept the test-environment declaration (confirms you'll only use anonymised,
fictional data).

![Test-environment consent dialog](./assets/p2-ksef-portal-test-auth-consent.png)

Enter your test **NIP**, click **Generuj certyfikat** to mint a throwaway test
certificate (SHA256 + ID), then scroll down.

![NIP entered, test certificate generated](./assets/p3-ksef-portal-nip-and-cert.png)

In the **Podpisz testowe żądanie autoryzacyjne** section, enter the same NIP
again and click **Uwierzytelnij do aplikacji testowej**.

![Sign test authorization request — NIP filled in](./assets/p4-ksef-portal-sign-test-request.png)

You're now logged in to the Taxpayer Application as your test NIP.

![KSeF 2.0 dashboard — logged in, NIP shown top-right](./assets/p5-ksef-portal-dashboard.png)

Open **Tokeny → Lista tokenów** in the left menu to see existing tokens (if any),
then click **Generuj token**.

![Token list + Generuj token button](./assets/p6-ksef-portal-token-list.png)

Give the token a description and check **wystawianie faktur** (invoice issuance)
under permissions, then submit.

![Generate-token form — description filled, "wystawianie faktur" checked](./assets/p7-ksef-portal-generate-token-form.png)

Click **Odśwież** (refresh) once the request finishes processing. The token value
is shown **only this once**.

![Token generated and revealed — value redacted for this tutorial](./assets/p8-ksef-portal-token-revealed.png)

> ⚠️ **Copy the token now.** KSeF does not let you retrieve it again — store it
> in a password manager before navigating away.

---

## Part 2 — Create a KSeF connection in OpenLinker

In OpenLinker, go to **Connections** and click **Add connection**.

![Connections page — Add connection button highlighted](./assets/01-ol-connections-list.png)

On the platform picker, find and select **KSeF**.

![Platform picker — KSeF card](./assets/02-ol-platform-picker.png)

The KSeF connection wizard opens with all the fields needed for invoice issuance.

![KSeF setup wizard — empty form](./assets/03-ol-ksef-wizard-empty.png)

Fill in the form:

- **Connection name** — a human-readable label, e.g. `KSeF — main seller`.
- **Environment**: `test`, `demo`, or `prod` to match where you generated the
  token. The test environment is recommended for initial setup — documents
  issued there have no legal force.
- **Seller NIP** — the Polish tax ID (10 digits, no dashes).
- **Seller legal name** and the full seller address (street, city, postal
  code, country `PL`). These appear verbatim on every issued invoice.
- **Authentication type** — either **KSeF authorization token** (paste the
  token you generated in Part 1 — the common case) or **Qualified electronic
  seal** for entities using a qualified e-seal certificate.
- **Authentication secret** — the token or seal reference. Stored encrypted
  and never shown again.

![Wizard — all fields filled in, ready to submit](./assets/04-ol-ksef-wizard-filled.png)

Click **Connect KSeF**. The connection is created with the **Invoicing**
capability and appears in the Connections list:

![Connections list — KSeF entry with Invoicing capability badge](./assets/11-ol-connections-with-ksef.png)

Click the connection row to view its detail page — environment, NIP, status, and
the capability breakdown.

![KSeF connection detail page](./assets/12-ol-ksef-detail.png)

---

## Part 3 — Get a B2B order into OpenLinker

KSeF issues a **faktura VAT** when the buyer address contains a **NIP**. Orders
without a NIP use a different document type (or are skipped by KSeF rules).

Orders flow into OpenLinker automatically from any configured source connection
(PrestaShop, Allegro, etc.). For the issuance flow to work, the order must have
arrived with a buyer NIP in the address block.

> **PrestaShop:** fill the **VAT number** field on the customer's company address
> in the PrestaShop back office. OpenLinker reads this field during order ingestion
> and stores it on the order snapshot.

---

## Part 4 — Issue the invoice

Open **Operations → Orders**. Find the order you want to invoice and click it.

The order detail page shows the full order with the **Invoice** panel. If you
have multiple Invoicing connections, the panel first shows a **connection picker**
— select your KSeF connection.

The panel shows **Not issued** with the document type pre-set to
**Invoice (faktura VAT)** (when a NIP is present). Click **Issue invoice**.

OpenLinker builds the FA(3) XML payload, calls KSeF, and the panel transitions
to **Issued**. The KSeF regulatory status badge appears as **Submitted** while
KSeF processes the document asynchronously.

> **Async clearance:** KSeF processes documents asynchronously. The badge updates
> to **Accepted** (green) or **Rejected** (red) when OpenLinker's
> regulatory-reconcile worker polls KSeF for the clearance status — typically
> within seconds on the test environment.

---

## Part 5 — Track clearance and download the UPO

Go to **Operations → Invoices** (`/invoices`) to see all issued documents.

![Invoices list — issued documents with KSeF regulatory status badges](./assets/13-ol-invoices-ksef-status.png)

Each row shows the document number, issue date, document type, invoice status,
and the KSeF regulatory badge (`pending → submitted → accepted` or `rejected`).

Click a row to open the invoice detail. The detail page shows the full issuance
timeline: when the document was sent to KSeF, when it was accepted, and the
official KSeF reference number.

![Invoice detail — issuance timeline, KSeF reference, UPO download](./assets/14-ol-invoice-detail-ksef.png)

Once the status reaches **Accepted**, the **Download UPO** button becomes active.
Click it to save the *Urzędowe Poświadczenie Odbioru* — the official government
receipt of clearance. Store it alongside the invoice PDF for compliance.

---

## Part 6 — Correction invoices (KOR)

When a previously accepted invoice needs correction (wrong amount, buyer data,
etc.):

1. Open the invoice detail page.
2. Click **Issue correction** — the correction flow pre-fills the original
   document data and the KSeF reference number.
3. Adjust the fields that changed (quantity, price, VAT rate) and confirm.

OpenLinker issues a KOR document that references the original KSeF number. Both
the original and the correction appear on the `/invoices` list.

---

## Next steps

- **Automatic issuance** — instead of clicking per order, change the connection's
  **Invoice trigger** to `auto-on-paid` or `auto-on-shipped`. Edit the connection
  and set the trigger model; OpenLinker enqueues issuance automatically.

- **Pair with Subiekt nexo** — if you also use Subiekt nexo, you can issue the
  document via the Subiekt bridge and separately submit the resulting FS number to
  KSeF through the KSeF connection. See
  [`subiekt tutorial`](../../subiekt/docs/tutorial.md).

- **Operational reference** — environments table, auth types, FA(3) schema
  constraints, compliance caveats, troubleshooting:
  [`setup-guide.md`](./setup-guide.md).
