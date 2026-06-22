# PrestaShop — InPost paczkomat auto-read

OL can automatically populate the paczkomat locker ID for PrestaShop direct orders
when the official InPost PrestaShop module (published by InPost, available free) is
installed. Set **InPost PS module** to **Official InPost** in the connection settings.

## How it works

When `inpostPsModuleType = 'official_inpost'`, `PrestashopOrderSourceAdapter.getOrder()`
fetches the order's delivery address via the PS webservice `addresses` endpoint and
reads `address2`. If the value matches the paczkomat code format (`[A-Z]{3}\d{2}[A-Z]?`,
e.g. `POZ08A`), it is written to `IncomingOrder.pickupPoint.id` so OL can generate
an InPost label for the correct locker.

## Troubleshooting

**Paczkomat ID not auto-populated?**

- Make sure the connection's **InPost PS module** setting is set to **Official InPost**
  (not "Other / none").
- If your shop uses the **presta-mod.pl**, **prestahelp**, or **WP-Desk** InPost
  module, paczkomat ID will not auto-populate in v1 — these modules may use a different
  schema. Use the manual paczkomat picker in OL until v1.1 adds support for your module.
- Confirm the official InPost PS module is configured to save the locker code to the
  delivery address `address2` field (this is the default behaviour in the official module).
- If the delivery address `address2` contains a real street address line rather than a
  locker code, OL will leave `pickupPoint` empty rather than populate it with bad data.
  In this case use the manual picker in OL to assign the locker.
