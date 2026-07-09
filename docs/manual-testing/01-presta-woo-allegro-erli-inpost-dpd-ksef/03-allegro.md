# Manual walkthrough — Allegro

Marketplace connection (sandbox), reads product data from the PrestaShop master catalog
(`masterCatalogConnectionId: b4c4b6f3-ebca-4aa3-8613-e4fafc688d4d`), creates offers + ingests
orders.

**Connection**: `allegro` — id `b1b78862-27f8-4555-b883-dfd345d1b1f1`
**Config**: sandbox environment, seller defaults already filled (ship-from location, safety
information, responsible producer) — required before offer creation will succeed
(`SELLER_DEFAULTS_NOT_CONFIGURED` otherwise).

## Part A — Connection already set up, confirm it

- [x] Open http://localhost:8090/connections/b1b78862-27f8-4555-b883-dfd345d1b1f1
- [x] Confirm status badge shows **Active**, environment shows **sandbox**

![Allegro connection overview, status Active, 2 of 2 capabilities enabled (OrderSource + OfferManager)](screenshots/allegro/01-connection-overview-2of2-capabilities.png)

- [x] Go to the **Actions** tab, click **Test connection** → expect a green success result

![Test connection success, "Connection OK (226ms)"](screenshots/allegro/02-test-connection-success.png)

## Part B — Create an offer via the bulk marketplace offer wizard

Used the **bulk** offer-creation wizard (`Operations · Listings → Bulk marketplace offer
creation`) rather than a single-offer flow — same underlying pipeline, and it's what the
Products page's bulk-select action opens by default. Config → Resolving → Review → Confirm.

- [x] Select the adidas tee product, launch **Bulk marketplace offer creation**, target = Allegro
      connection
- [x] Config step: pricing policy = **Use master price**, stock policy = **Use master stock**,
      **Publish immediately** checked

![Bulk wizard Config step — pricing/stock policy = use master, publish immediately checked](screenshots/allegro/03a-bulk-offer-config-step.png)

- [x] Per-row **Edit** → category step: EAN auto-match prefilled **T-shirty** under
      Root → Odzież

![Edit offer modal — category step, T-shirty auto-selected via EAN match](screenshots/allegro/04a-edit-offer-category-step.png)

- [x] Parameters step: required category parameters (Stan, Marka, Rozmiar, Wiek dziecka, Kolor,
      EAN, Liczba sztuk w ofercie) all prefilled/resolved correctly — including **Stan** (the
      condition field flagged as broken in the *bulk wizard* per earlier notes — it rendered fine
      here, so that regression looks fixed or was single-offer-wizard-specific)

![Edit offer modal — parameters step, all required fields filled (Stan: Nowy, Marka: Addis, Rozmiar: S, etc.)](screenshots/allegro/04b-edit-offer-parameters-step.png)

- [x] Review step: row shows **READY**, matched category `89528`, stock 100, price 149.00 PLN

![Review step — 1 product, status READY, matched category, stock + price shown](screenshots/allegro/05a-review-step-ready.png)

- [x] Submit → Bulk batch tracker opens, polling every 5s

> **Finding (real bug, not a demo artifact):** The PrestaShop cloudflared tunnel's control stream
> had died silently in the background — the local process kept running and endlessly retrying
> ("control stream encountered a failure while serving"), but never actually served traffic, so
> the tunnel URL stopped resolving. The Allegro adapter's per-variant image fetch failed with
> `Image URL '<stale tunnel URL>' unreachable`, and one of the 3 auto-expanded variants
> (multi-variant expansion, #824) landed in **FAILED** while the other two sat **PENDING**.

![Bulk batch tracker mid-run — 1 of 3 variants FAILED with an Image URL unreachable error, other 2 PENDING](screenshots/allegro/05b-batch-image-fetch-failed-tunnel-dead.png)

**Fixed**: killed the dead tunnel process, restarted `cloudflared` (fresh ephemeral URL:
`https://exercises-tours-stylish-finals.trycloudflare.com`), updated the PrestaShop connection's
`config.storefrontBaseUrl` to match, and verified reachability from inside the `api` container
before retrying. This is an environment/tooling issue (ephemeral quick-tunnel dying under a
long-running demo session), not an OpenLinker product bug — but it's a good example of why the
image-fetch failure surfaces clearly per-variant in the batch tracker instead of failing silently.

- [x] Re-run the offer creation now that the tunnel is fixed — confirm all 3 variants reach
      **SUCCEEDED** and check **Listings** for the new Allegro offers

![Bulk batch tracker — completed, 3/3 succeeded, 0 failed, each variant → its Allegro offer id](screenshots/allegro/05b-batch-completed-3of3.png)

![OpenLinker Listings page — the 3 new Allegro offers (7781851684/85/87) highlighted, mapped to the 3 adidas tee variants](screenshots/allegro/06-listings-page-3-new-allegro-offers.png)

> **Finding (minor, worth a second look — not filed):** the batch tracker's per-row status shows
> **DRAFT** even though the Config step had "Publish immediately" checked and the batch-level
> summary reports "Offers live on marketplace" / SUCCEEDED 100%. Likely `DRAFT` here just reflects
> OL's own listing-record lifecycle state distinct from Allegro's publication status (`active` /
> `activating`), not a real publish-immediately regression — but worth confirming against Allegro
> sandbox directly if this resurfaces.

## Part C — Order ingestion from Allegro (optional, requires placing a real sandbox order)

- [ ] If you have Allegro sandbox buyer access, place a test order against the offer created
      above
- [ ] Wait for the `allegro-orders-poll` scheduled job (every 5 min) or trigger manually
- [ ] Confirm the order appears in OpenLinker's **Orders** list

```
[SCREENSHOT: OpenLinker Orders list showing the Allegro order]
```

- [ ] Confirm the order was created on the PrestaShop side too (destination shop)

```
[SCREENSHOT: PrestaShop admin order list showing the same order]
```

> **Finding:** _(fill in if anything here doesn't match expectations)_
