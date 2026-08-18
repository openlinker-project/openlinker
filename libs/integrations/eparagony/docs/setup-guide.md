# eparagony.pl Integration — Setup Guide

This walkthrough takes you from nothing to a working **eparagony.pl** fiscalization
connection in OpenLinker, and through registering your first receipt on an order.

> For the architecture and design rationale, see
> [ADR-042](../../../../docs/architecture/adrs/042-fiscalization-capability.md) and the
> [product spec #1902](../../../../docs/specs/product-spec-1902-eparagony-e-receipts.md).
> For day-2 operations and troubleshooting, see the [runbook](./runbook.md).

---

## What you get

eparagony.pl is a Polish e-receipt distribution hub. The OpenLinker adapter
(`eparagony.documents.v3`) delivers the **Fiscalization** capability: registering a
completed order's sale so your fiscal printer issues an electronic receipt for it,
without re-keying the order lines into printer software.

**What this is not**: OpenLinker never issues the receipt itself. Issuance happens on
your own certified fiscal device, driven by eparagony.pl's own software running next to
it. This connection hands the sale to that device and reads back what happened.

**What v1 does not do**: register anything automatically. Whether a given order legally
requires a fiscal receipt is your call, and your accountant's — not OpenLinker's. You
register a receipt for a specific order from that order's page, whenever you decide to.

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

## Verifying it end to end

The fastest live check without waiting on real order traffic: pick any order already in
OpenLinker and run through Step 2 against your **sandbox** connection. A `Registered`
or an `Unconfirmed` outcome that later resolves via "Look it up" both confirm the full
path is wired correctly — the sandbox device confirming later than the poll budget is
expected behaviour, not a fault.
