# eparagony.pl Integration — Setup Guide

This walkthrough takes you from nothing to a working **eparagony.pl** connection in
OpenLinker, through registering your first receipt, and (optionally) issuing your first
invoice.

> For the architecture and design rationale, see
> [ADR-042](../../../../docs/architecture/adrs/042-fiscalization-capability.md) and the
> [product spec #1902](../../../../docs/specs/product-spec-1902-eparagony-e-receipts.md).
> For day-2 operations and troubleshooting, see the [runbook](./runbook.md).

---

## What you get

eparagony.pl is a Polish e-receipt distribution hub that can also issue VAT invoices
and relay them to KSeF (Poland's national e-invoicing hub). The OpenLinker adapter
(`eparagony.documents.v3`) delivers two independent capabilities on one connection:

- **Fiscalization** — registers a completed order's sale so your fiscal printer issues
  an electronic receipt for it, without re-keying the order lines into printer software.
- **Invoicing** (since #3192) — issues a VAT invoice through the same vendor account,
  optionally relaying it to KSeF for legal clearance.

You can enable either role, or both, on one connection — see Step 3.

**What this is not**: OpenLinker never issues the receipt itself. Issuance happens on
your own certified fiscal device, driven by eparagony.pl's own software running next to
it. This connection hands the sale to that device and reads back what happened. The
invoicing role is different — eparagony.pl itself creates and relays the invoice
document, so there is no physical device dependency for that half.

**What v1 does not do**: register anything automatically by itself. Whether a given
order legally requires a receipt or an invoice, and which of your connections handles
it, is decided by your sales-document routing rules (see the rule composer) — not a
default OpenLinker guesses at.

---

## Prerequisites — three things that must already be true

None of these are configured by OpenLinker. Get them working first, or the connection
test will pass while every real registration times out.

1. **An online fiscal printer with a steady internet connection.** Posnet, Novitus or
   Elzab, in the "online" (networked) configuration required for e-receipts.
2. **eparagony.pl's own printer-control software running** on a machine next to the
   printer. eparagony.pl reaches your printer through this software, not directly.
3. **The device configured for electronic receipts by your printer servicer
   (`serwisant`).** OpenLinker cannot verify this step — the sandbox has no attached
   device and reports every device number as a constant `INACTIVE` stub, so there is no
   way to demonstrate "device ready" from here even in principle. Confirm it directly
   with your servicer.

Registration with eparagony.pl itself (getting a `client_id` / `client_secret` /
`posId`) happens on their side — see their onboarding docs. OpenLinker's own
registration confirmed the technical access path against their public OpenAPI 3.0
contract; commercial terms (pricing tier, partner programme) are a separate
conversation with the vendor and are not part of this guide.

---

## Step 1 — Connect eparagony.pl in OpenLinker

1. Go to **Connections → New connection** and choose **eparagony.pl**.
2. Read the preconditions panel — it states plainly which of the three items above
   OpenLinker can and cannot check.
3. Fill in:
   - **Connection name** — any label you'll recognise later.
   - **Environment** — `Sandbox` while testing (no fiscal device attached, nothing
     prints or registers for real), `Production` once you're ready.
   - **Client ID** / **Client secret** — from your eparagony.pl account.
   - **POS ID** — the register/till identifier eparagony.pl stamps on every document.
   - **Integration ID** (optional) — only if eparagony.pl issued you one of the form
     `openlinker:<secret>` (multi-customer integrators only).
4. Click **Connect eparagony.pl**.
5. Click **Test connection**. A pass confirms your credentials and granted scopes are
   correct — it does **not** confirm the fiscal device is reachable end to end (see the
   prerequisites above).

> **Developer aside**: this is `POST /connections` with `platformType: "eparagony"`,
> `adapterKey: "eparagony.documents.v3"`, credentials `{ clientId, clientSecret,
> integrationId? }`, and config `{ environment, posId }`. Every other config field
> (`taxRates`, `defaultTaxRateCode`, `print`, `paymentForm`, `fiscalDeviceUniqueNumber`)
> is edited later via the connection's raw config editor — see the [README](../README.md)
> for the full field list.

> **Before registering anything for real, confirm `taxRates` matches your actual
> device.** OpenLinker ships a default slot table (`A`=23%, `B`=8%, `C`=5%,
> `D`/`F`/`G`=0%, `E`=exempt) and assumes it silently if you leave `taxRates`
> unconfigured. OpenLinker cannot see how your printer servicer (`serwisant`)
> actually programmed the device — a mismatch registers real sales under the
> wrong rate with no error shown anywhere. Ask your `serwisant` for the device's
> actual slot layout and set `taxRates` to match before your first production
> registration.

---

## Step 2 — Register a receipt for an order

1. Open any order's detail page. You'll see a **Fiscal receipt** panel.
2. If nothing has been registered yet, it reads **Not registered** with a **Register
   receipt** button — and says plainly that whether this order needs one is your call.
3. Click **Register receipt**. The call blocks while OpenLinker asks eparagony.pl to
   create the document and polls briefly for a confirmed status, so this can take up to
   about a minute.
4. One of three things happens:
   - **Registered** — you'll see the receipt number, the signing identity (both
     required for the correction register under §3 ust. 4), and, once available, a link
     to the hosted receipt.
   - **Rejected** — the provider definitely created nothing (e.g. an unresolvable tax
     rate). The reason is shown, and you can register again once it's fixed.
   - **Unconfirmed (in-doubt)** — the request was sent but OpenLinker could not confirm
     what happened before its poll budget ran out. **There is no retry button here on
     purpose** — resending could double-register a sale that may have already landed.
     Click **Look it up** instead: this asks eparagony.pl directly by the same document
     reference, never by resubmitting. If the device confirms later (this is normal on
     the sandbox, whose device takes longer than the poll budget), a later "Look it up"
     resolves it to Registered.

> **Developer aside**: `POST /fiscal-registrations` with `{ connectionId, orderId }`;
> `GET /fiscal-registrations?orderId=` to read the record(s); `POST
> /fiscal-registrations/:id/reconcile` for "Look it up".

---

## Step 3 — Enable Invoicing, and (optionally) relay to KSeF

Skip this step if you only want receipts.

1. On the connection's edit page, open **Capabilities**. Toggle **Invoicing** on
   alongside (or instead of) **Fiscalization** — the two are independent switches;
   enabling one does not route any order to it.
2. Fill in the invoice-lane fields: **Seller NIP** (`merchantTIN`), **Seller name**
   (`merchantName`), **Seller address** (`merchantAddress`). All three are validated by
   eparagony.pl against the taxpayer registered on your account when you issue the first
   invoice — a wrong NIP fails every invoice on this connection, not just one order.
3. **To relay invoices to KSeF**, first grant permission in the **KSeF Taxpayer App**
   (the Polish tax authority's own portal): grant NIP `5213796333` (Platforma
   Detalistów Sp. z o.o. — eparagony.pl's KSeF-relay identity) the permission
   *"Podmiotowi do wystawiania i przeglądania faktur"*, scope *"wystawianie faktur"*.
   This is done once, on the KSeF portal, entirely outside OpenLinker. Then toggle
   **Relay to KSeF** on the connection. Skipping this step still issues invoices —
   they simply report `not-applicable` on the regulatory-clearance axis instead of
   `pending-submission`/`accepted`.
4. A routing rule (rule composer) decides which orders reach the Invoicing role versus
   the Fiscalization role on this connection — see the rule-composer guide.
5. Once an invoice is issued, its detail page shows the same waiting/registered ladder
   the receipt panel uses — a `pending-submission` invoice has **no retry button**, on
   purpose (see the [runbook](./runbook.md)).

> **Developer aside**: the invoice-lane config keys (`merchantTIN`, `merchantName`,
> `merchantAddress`, `eInvoicingHubEnabled`) are edited via the same raw config editor
> as the receipt-lane fields — see the [README](../README.md) for the full field list.

---

## Verifying it end to end

The fastest live check without waiting on real order traffic: pick any order already in
OpenLinker and run through Step 2 against your **sandbox** connection. A `Registered`
or an `Unconfirmed` outcome that later resolves via "Look it up" both confirm the full
path is wired correctly — the sandbox device confirming later than the poll budget is
expected behaviour, not a fault.
