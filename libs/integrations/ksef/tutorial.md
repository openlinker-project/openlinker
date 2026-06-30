# KSeF — Operator Tutorial

Issue FA(3) VAT invoices from OpenLinker orders and submit them to KSeF
(Krajowy System e-Faktur) for government clearance — complete A-to-Z guide.

> **Happy path only.** For error handling, retry, and compliance caveats see
> [`docs/integrations/ksef/setup-guide.md`](../../../docs/integrations/ksef/setup-guide.md).

---

## What you need before you start

- OpenLinker running (API + worker + web).
- A PrestaShop connection already set up in OpenLinker (as the order source).
- Access to the KSeF portal for your target environment:
  - **Test:** `https://ksef-test.mf.gov.pl` (no legal force, use a test NIP)
  - **Demo:** `https://ksef-demo.mf.gov.pl`
  - **Prod:** `https://ksef.mf.gov.pl`
- The NIP (Polish tax ID) of the seller entity you will invoice as.

---

## Part 1 — Get a KSeF authorisation token

KSeF uses token-based auth. You generate a token on the KSeF portal once and
store it in OpenLinker's encrypted credential store.

Open the KSeF portal for your environment and log in with your NIP.

![KSeF portal home page — NIP login](./assets/01-ksef-portal-home.png)

After logging in, navigate to **Zarządzanie tokenami** (Token management) in the
top navigation.

![KSeF portal — Zarządzanie tokenami menu item](./assets/02-ksef-token-menu.png)

The token list shows all existing tokens. If you have none, click **Wygeneruj token**
(Generate token).

![KSeF portal — empty token list with Wygeneruj token button](./assets/03-ksef-token-list.png)

Fill the form: give the token a description and select the role
**Wystawianie faktur** (Invoice issuance). Click **Generuj** (Generate).

![KSeF portal — generate token form, role selected](./assets/04-ksef-token-form.png)

> ⚠️ **Copy the token now.** It is shown **only once**. Store it in a password
> manager before closing this dialog — KSeF does not let you retrieve it again.

![KSeF portal — generated token (one-time display)](./assets/05-ksef-token-created.png)

---

## Part 2 — Create a KSeF connection in OpenLinker

In OpenLinker, go to **Connections** and click **Add connection**.

![OpenLinker Connections page — Add connection button](./assets/06-ol-connections-list.png)

On the platform picker, select **KSeF**.

![Platform picker — KSeF card](./assets/07-ol-ksef-platform-card.png)

The KSeF connection wizard opens. Fill in:

- **Connection name** — a label for your own reference, e.g. `KSeF Test`.
- **Environment** — choose `test`, `demo`, or `prod` to match where you got
  the token.
- **Seller NIP** — the Polish tax ID (NIP) of the entity issuing invoices.
- **Seller name** — legal name as it appears on the invoice.
- **Seller address** — street, postal code, city.
- **KSeF token** — paste the token you copied in Part 1.

![KSeF wizard — environment dropdown](./assets/08-ol-ksef-wizard-env.png)

![KSeF wizard — token field filled (value obscured)](./assets/09-ol-ksef-wizard-token.png)

Click **Connect KSeF**. The connection is created and shows the **Invoicing**
capability badge.

![KSeF connection created — Invoicing badge visible](./assets/10-ol-ksef-connection-created.png)

Click **Test connection** — OpenLinker authenticates against KSeF and confirms
the token is valid.

![Test connection — green result](./assets/11-ol-ksef-test-ok.png)

![KSeF connection detail page](./assets/12-ol-ksef-connection-detail.png)

---

## Part 3 — Get a PrestaShop B2B order into OpenLinker

KSeF issues a **faktura** (VAT invoice) when the buyer has a NIP. Create a
customer with a company address in PrestaShop.

In the PrestaShop back office, go to **Customers → Add new customer**. Fill in the
customer's details (first name, last name, email).

![PrestaShop — new customer form with company details](./assets/13-presta-customer-b2b.png)

Add a company address: in the **Company** field put the company name; in
**VAT number** put the buyer's NIP (e.g. `1234567890` for test). This field
drives OpenLinker's document-type decision.

![PrestaShop — company address with NIP/VAT number](./assets/14-presta-address-b2b.png)

Create an order for this customer (**Orders → Add new order**): pick the
customer, add a product, select the company address as the delivery address,
choose a carrier, set **Payment = accepted**, and click **Create the order**.

![PrestaShop — order builder with company address selected](./assets/15-presta-order-builder.png)

![PrestaShop — created order confirmation](./assets/16-presta-order-created.png)

OpenLinker ingests the order on its next PrestaShop poll (or webhook trigger). It
appears in **Orders** with the buyer's NIP visible in the address block.

![OpenLinker Orders list — ingested order](./assets/17-ol-orders-list.png)

![OpenLinker Order detail — buyer address with NIP](./assets/18-ol-order-detail-buyer.png)

---

## Part 4 — Issue the invoice

Open the order in OpenLinker. The **Invoice** panel shows **Not issued**
with a document-type dropdown and an **Issue invoice** button.

If you have more than one Invoicing connection active, the panel also shows a
connection picker — select your KSeF connection.

Select **Invoice (faktura)** in the dropdown (OpenLinker pre-selects it when a
buyer NIP is present), then click **Issue invoice**.

![Order detail — Invoice panel, Not issued, faktura type selected](./assets/19-ol-order-invoice-panel-empty.png)

OpenLinker builds the FA(3) XML, calls KSeF, and the panel flips to **Issued**.
The regulatory badge shows **Pending** (→ **Submitted**) while KSeF processes
the document asynchronously.

![Order detail — Invoice panel: issued, KSeF badge = Pending](./assets/20-ol-order-invoice-issued-pending.png)

> **Note:** KSeF processes documents asynchronously. The badge updates to
> **Accepted** (or **Rejected**) when the regulatory-reconcile worker job polls
> the clearance status — typically within seconds on the test environment.

---

## Part 5 — Track clearance and download the UPO

Go to **Operations → Invoices** (`/invoices`) to see all issued documents.
Your invoice appears with its KSeF document number and regulatory badge.

![/invoices list — document row with KSeF badge and document number](./assets/21-ol-invoices-list.png)

Click the row to open the invoice detail. Once KSeF clears the document the
badge moves to **Accepted** and the KSeF reference number is shown.

![Invoice detail — badge = Accepted, KSeF reference number visible](./assets/22-ol-invoice-detail-accepted.png)

Click **Download UPO** to save the Urzędowe Poświadczenie Odbioru — the official
government receipt of clearance. Store it alongside the invoice PDF for
compliance purposes.

![Invoice detail — Download UPO button](./assets/23-ol-invoice-upo-download.png)

---

## Next steps

- **Automatic issuance** — instead of clicking per order, set an auto-trigger:
  on the connection edit page set **Invoice trigger** to
  **Auto on order paid** (or **shipped**). OpenLinker enqueues issuance
  automatically when orders reach that state.

- **Correction invoices (KOR)** — reopen the issued invoice and click
  **Issue correction**. The KOR document references the original KSeF number.

- **Operational reference** — environments table, auth types, compliance
  caveats, troubleshooting:
  [`docs/integrations/ksef/setup-guide.md`](../../../docs/integrations/ksef/setup-guide.md).

---

## Screenshot capture notes

> **For the person running the capture session:**
>
> OL-side screenshots (`06-` through `12-`, `17-` through `23-`) are automated
> by `apps/web/e2e/ksef-walkthrough.mjs` and `ksef-invoice.mjs`. Run against
> a preview build on `:4173`.
>
> KSeF portal screenshots (`01-` through `05-`) are **manual** — taken in the
> browser on `ksef-test.mf.gov.pl`. Use a test NIP (e.g. `9999999999`); blur or
> crop out any real tax IDs before committing.
>
> Place all PNGs in `libs/integrations/ksef/assets/` with the exact filenames
> above. The `./assets/*.gitkeep` placeholder will be replaced when the first
> image is added.
