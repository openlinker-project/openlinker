# Manual walkthrough — DPD Polska

Shipping provider connection. Full field reference: `libs/integrations/dpd-polska/docs/setup-guide.md`.

⚠️ **Prerequisite**: you need real DPD sandbox credentials (login/password + payer FID) issued by
DPD — nothing is seeded/hardcoded in the repo for this. If you don't have sandbox credentials
handy, skip this walkthrough for now and note it as blocked rather than guessing values.

> ⚠️ **Sender postal code must be real, deliverable, and consistent with the sender city.**
> A syntactically valid but out-of-region code (e.g. `city: Warszawa` + `postalCode: 22-213`)
> passes OL's format validation but DPD rejects **every** shipment with
> `INCORRECT_SENDER_POSTAL_CODE`, surfaced opaquely as `NOT_PROCESSED`. Use a code matching the
> sender city (e.g. Warsaw `02-222`). Tracked in #1778 (validate at setup) and #1777 (surface the
> real reason).

## Part A — Create the connection

- [x] Go to `/connections/new`
- [x] Pick **DPD Polska** from the platform picker
- [x] Step through the 3-step wizard, filling:
  - Connection name (e.g. `DPD Demo`)
  - `login` / `password` (DPD Basic-auth credentials)
  - `environment` = **sandbox**
  - `payerFid` (numeric DPD account/payer id, e.g. `1495`)
  - `masterFid` (leave blank unless you have a multi-account setup)
  - Sender address block: company/name (optional), street address, city, **postal code
    consistent with the city** (`NN-NNN`), country code (defaults `PL`), phone/email (optional)
- [x] Submit, confirm the connection is created and shows **Active**
- [x] Go to the **Actions** tab, click **Test connection** → green success

> **Finding:** Connection created and Active; Test connection succeeds. **Gotcha confirmed live:**
> the demo connection was initially saved with `city: Warszawa` + `postalCode: 22-213` (Lublin
> region). It passed OL's `NN-NNN` format validation and Test connection (auth is independent of
> the sender address), but every label generation then failed at DPD (see Part B). Fixing the
> sender postal code to `02-222` (valid Warsaw) resolved it. OL does not currently validate
> deliverability at setup — filed as #1778.

## Part B — Generate a shipping label

Same pattern as InPost — needs an existing order to attach a shipment to.

- [x] Go to **Orders**, open an order
- [x] Find the shipment panel / **Generate label** action
- [x] Select DPD (courier / `address` delivery intent), fill in required fields
- [x] Submit, confirm the label is generated (waybill / tracking reference appears)

> **Finding:** ✅ Works end-to-end after the sender postal-code fix. Generating a label via
> `POST /shipments/generate-label` (Erli order `ol_order_162bc9…`, `sourceDeliveryMethodId: "dpd"`,
> `deliveryIntent: "address"`) returned `kind: dispatched` with a real DPD waybill
> (`0000876013430Q`), shipment status `generated`. The OL request shape and adapter are correct —
> confirmed by replaying the exact request against the DPD demo (real waybills returned for a valid
> Warsaw sender; rejected only for the bad `22-213` code).
>
> **Two gaps observed on the generated DPD shipment:**
> - The Delivery panel shows `CARRIER: — (awaiting)` and never resolves the carrier (DPD tracking
>   mapper doesn't emit `carrier` on the snapshot) — filed as #1775.
> - On an Erli-sourced order the orders list/detail omit the delivery-method label + ship-by
>   (Erli order snapshot carries no `shipping.methodName` / `dispatchByAt`) — filed as #1776.[^1776]

[^1776]: #1776 was filed for the narrow finding above (missing delivery-method label + ship-by on
    Erli-sourced orders) but has since been promoted to the epic "[EPIC] Orders - mapping-aware
    delivery + non-Allegro ship-by", covering the full mapping-aware delivery-resolution surface.
    The sub-finding recorded here is one item within that broader epic scope.

## Part C — Tracking status sync

- [x] Wait for the `dpd-shipment-status-sync` scheduled job (every 30 min) or trigger manually
- [x] Confirm the SOAP tracking path reaches DPD

> **Finding:** ✅ Scheduler `dpd-shipment-status-sync` fires every 30 min (`succeeded`). The DPD
> InfoServices SOAP **demo** host `dpdinfoservicesdemo.dpd.com.pl` (previously carrying a
> `// TODO confirm against the demo WSDL` note) is confirmed reachable: `getEventsForWaybillV1`
> returns HTTP 200 with a valid `getEventsForWaybillV1Response` (`confirmId 0`, no events yet for a
> freshly-generated waybill — expected). Host, SOAP client, and auth all work. Carrier backfill from
> the tracking snapshot does not happen for DPD (see #1775).
