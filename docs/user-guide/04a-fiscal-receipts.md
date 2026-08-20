# Fiscal receipts

OpenLinker can register a Polish fiscal e-receipt for an order through a connected
provider — today, eparagony.pl. This section covers the connection setup and the
per-order **Fiscal receipt** panel.

**OpenLinker never issues the receipt itself.** Issuance is reserved to your own
certified fiscal printer; this connection hands a completed sale to eparagony.pl,
which registers it with your device. **Nothing is registered automatically** —
whether a given order legally requires a receipt is your call, and your
accountant's, never OpenLinker's.

---

## Prerequisites

Fiscal receipts are capability-gated per connection, the same way `Invoicing` or
`ProductMaster` are. Before the **Fiscal receipt** panel appears on an order, you
need at least one **active** connection with the `Fiscalization` capability enabled
— today that means eparagony.pl (`eparagony.documents.v3`). See
[Connecting a Platform](./02-connecting-a-platform.md#all-available-adapters) and
the [eparagony.pl setup guide](../../libs/integrations/eparagony/docs/setup-guide.md)
for the full connection walkthrough, including the three things that must already
be true on your side (a networked fiscal printer, the vendor's printer-control
software running, and the device configured for e-receipts by your printer
servicer) — none of which OpenLinker configures or can fully verify.

If no active Fiscalization connection exists, the panel does not render at all.

---

## The Fiscal receipt panel

Open any order's detail page.

<!-- screenshot: Fiscal receipt panel, not-registered state, with the Register receipt button -->
![Fiscal receipt panel — not registered](./images/04a-fiscal-not-registered.png)

### Registering a receipt

Click **Register receipt**. This is the *only* way a receipt gets registered in
v1 — there is no automatic trigger. The call can take up to about a minute: it
sends the sale to the provider and waits briefly for the fiscal device to confirm.

One of three outcomes follows:

| Outcome | What you see | What to do |
|---|---|---|
| **Registered** | Receipt number, signing identity, and (once available) a link to the hosted receipt. An outcome with no link yet is still a full success — some providers report identifiers only. | Nothing — done. |
| **Rejected** | A reason (e.g. an unresolved tax rate) and an enabled **Register receipt** button. | Fix the cause and register again — safe, because nothing was created. |
| **Unconfirmed** | A warning that the sale *may* already be registered, and a **Look it up** button — no retry button anywhere on this surface. | Click **Look it up**. If the device is simply slower than the check, wait and look it up again later — this is normal, not a fault. |

<!-- screenshot: Fiscal receipt panel, registered state, showing receipt number + signing identity + artefact link -->
![Fiscal receipt panel — registered](./images/04a-fiscal-registered.png)

<!-- screenshot: Fiscal receipt panel, unconfirmed (in-doubt) state, showing the warning and Look it up button -->
![Fiscal receipt panel — unconfirmed](./images/04a-fiscal-in-doubt.png)

### Why there is no retry for "Unconfirmed"

A fiscal receipt registered twice for the same sale is a legal problem for the
seller, not a data-quality one. If OpenLinker cannot confirm whether a request
landed, resending it risks exactly that. **Look it up** asks the provider directly
by the same registration reference instead of resubmitting — it can only confirm
what already happened, never create a second registration.

### The two required identifiers

Once registered, both the **receipt number** and the **signing identity** are
shown, independently, and copyable. Polish law requires both to enter an obvious
error into the correction register (rozporządzenie MF 29.04.2019, §3 ust. 4) — a
missing one shows as **Not reported**, never as blank, so you can tell "not
provided by this receipt" apart from "hidden by a rendering bug."

---

## What's next

- [Connecting a Platform](./02-connecting-a-platform.md) — adding the eparagony.pl connection
- [Invoices](./04-invoices.md) — the sibling fiscal-document surface (a fiscal receipt and an invoice are never the same document)
