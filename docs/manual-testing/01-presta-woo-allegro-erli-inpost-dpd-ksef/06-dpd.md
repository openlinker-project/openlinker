# Manual walkthrough — DPD Polska

Shipping provider connection — no connection exists yet in this demo instance, this walkthrough
starts from scratch. Full field reference: `libs/integrations/dpd-polska/docs/setup-guide.md`.

⚠️ **Prerequisite**: you need real DPD sandbox credentials (login/password + payer FID) issued by
DPD — nothing is seeded/hardcoded in the repo for this. If you don't have sandbox credentials
handy, skip this walkthrough for now and note it as blocked rather than guessing values.

## Part A — Create the connection

- [ ] Go to http://localhost:8090/connections/new
- [ ] Pick **DPD Polska** from the platform picker

```
[SCREENSHOT: connection platform picker showing DPD Polska card]
```

- [ ] Step through the 3-step wizard, filling:
  - Connection name (e.g. `DPD Polska (demo)`)
  - `login` / `password` (DPD Basic-auth credentials)
  - `environment` = **sandbox**
  - `payerFid` (numeric DPD account/payer id)
  - `masterFid` (leave blank unless you have a multi-account setup)
  - Sender address block: company/name (optional), street address, city, postal code
    (`NN-NNN` format), country code (defaults `PL`), phone/email (optional)

```
[SCREENSHOT: DPD setup wizard, all three steps filled before submit]
```

- [ ] Submit, confirm the connection is created and shows **Active**

```
[SCREENSHOT: DPD connection detail page after creation]
```

- [ ] Go to the **Actions** tab, click **Test connection** → expect a green success result

```
[SCREENSHOT: DPD connection detail page, Actions tab, Test connection = success]
```

> **Finding:** _(fill in if anything here doesn't match expectations — e.g. the
> `payerFid must be a numeric string` / postal-code-format validation errors documented in the
> setup guide's troubleshooting section)_

## Part B — Generate a shipping label

Same pattern as InPost — needs an existing order to attach a shipment to.

- [ ] Go to **Orders**, open an order
- [ ] Find the shipment panel / **Generate label** action
- [ ] Select DPD as the carrier, fill in any required fields
- [ ] Submit, confirm the label is generated (PDF/label reference appears)

```
[SCREENSHOT: order shipment panel showing the generated DPD label + tracking number]
```

> **Finding:** _(fill in if anything here doesn't match expectations)_

## Part C — Tracking status sync (optional)

- [ ] Wait for the `dpd-shipment-status-sync` scheduled job (every 30 min) or trigger manually
- [ ] Confirm the shipment status updates in OpenLinker

```
[SCREENSHOT: order shipment panel showing an updated tracking status]
```

> **Finding:** _(fill in if anything here doesn't match expectations)_
