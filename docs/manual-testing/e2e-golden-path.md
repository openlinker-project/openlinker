# E2E golden path (S0-S9) — full business flow

The **attended** end-to-end golden path across all six systems — PrestaShop,
WooCommerce, Allegro, Erli, InPost, KSeF — verifying **every parameter and every
amount** (field-level + amount-level parity), not image pixels. It is the
executable, durable reference for a full "does OpenLinker actually work end to
end" run.

- **Spec**: `apps/e2e/tests/golden-path/full-flow.spec.ts`
- **Project**: `full-flow` (headed, serial, `workers: 1`, `retries: 0`)
- **Builds on**: the `apps/e2e` substrate (#1479) — API client, world, fixtures,
  page objects, pollers, job helpers.

> This complements the operator-setup flow (`operator-setup.spec.ts`, S1-S4,
> shallow "counter went up" assertions). The full flow covers the whole
> lifecycle *and* asserts deep parity.

---

## Why attended (not CI)

The flow crosses a live buyer purchase and four external dashboards that cannot
be automated against sandboxes today. So it runs **headed, in a coordinated
session with an operator watching**, and pauses at a human checkpoint whenever a
step needs eyes on a dashboard. `retries: 0` because every segment mutates real
systems — a silent retry would double-buy or double-issue.

Unattended CI (order simulation + stack boot) is a separate milestone.

---

## What is automated vs manual

| Concern | How it is verified |
|---|---|
| OL neutral model (product/variant/listing/offer/order/invoice/shipment) | **Automated** — OL REST API |
| PrestaShop (product, stock, order, amounts) | **Automated** — PrestaShop **webservice API** (direct read) |
| WooCommerce (product, category, attributes, price, stock) | **Automated** — WooCommerce **REST API** (direct read) + light wp-admin visual |
| Allegro offer (category id, price, currency, qty, status) | **Automated** — OL adapter read (`GET /listings/:id/offer`) |
| Erli offer | **Mapping-level** — the Erli adapter ships no `OfferReader`, so the live read 422s; the spec asserts the mapping (external id + primary-variant link) and the dashboard checkpoint covers price/qty/category |
| Allegro category parameters (Brand/Model/condition, offer + product section) | **Automated (value-level)** — the persisted creation-request snapshot (`GET /listings/connections/:cid/offers/creation/:rid` → `request.overrides.parameters`, #1071) carries the SUBMITTED values, asserted against the category directory + master variant attributes; directory presence stays as the secondary assertion |
| InPost shipment (tracking, label PDF, dispatched) | **Automated** — OL shipping API |
| KSeF invoice (per-line net/VAT/gross, totals, buyer tax id, currency, doc type, KSeF number, UPO, FA(3) XML) | **Automated** — OL invoicing API (`/invoices/:id/content`, `/upo`, `/document`) |
| Allegro / Erli / InPost / KSeF dashboards | **Manual** — `manualCheckpoint` light visual confirmation, recorded in the HTML report |
| The buyer purchase | **Manual** — the pause between S4 and S5 |

### Expected-value sources

- **Master** (PrestaShop product) = name / price / EAN / attributes.
- **Configured mappings** (PS→Allegro category + attribute projections; Erli
  borrows Allegro) = expected category / parameters.
- **The order** = expected amounts (buyer-paid).

All money is compared in **minor units, currency-aware** (`toMinorUnits`), so
`19.9`, `19.90` and `"19.900"` reconcile and no float drift fails a run.

---

## Segments

| # | Segment | Key assertions |
|---|---|---|
| **S0** | Baseline: sync master catalogue, snapshot stock | multi-variant driver product picked; primary variant has an EAN; OL availability captured per variant |
| **S1** | PrestaShop parity | OL product name/EAN/price/currency == PS webservice; OL master total == PS `stock_availables` total |
| **S2** | WooCommerce publish + REST parity | listing mapping appears in OL; OL SKU/name == WC REST; wp-admin visual |
| **S3** | Allegro offers | offers created + mapped; OL adapter read price/currency/category/qty parity; **value-level parameter parity** — submitted values from the persisted creation-request snapshot vs the category directory + master variant attributes; **manual** Allegro panel |
| **S4** | Erli offers (borrowed taxonomy) | offers created; mapping-level assertions (external id + primary-variant link; no `OfferReader` on the Erli adapter); **manual** Erli panel |
| **PAUSE** | Operator buys the named offer | prints exact product / SKU / EAN / qty=1 to buy; instructs **InPost Paczkomat delivery** + a locker that exists in the InPost sandbox (`E2E_PACZKOMAT_ID` override for S6); waits for resume |
| **S5** | Order ready in OL + channel stock down | new `ready` order appears; line price×qty; tax-treatment-aware total identity (inclusive: subtotal+shipping; exclusive: subtotal+tax+shipping); source offer qty == baseline − 1 |
| **S6** | InPost label | routing rule ensured (`ol_managed_carrier`); label GENERATED with `pickup_point` intent (optional `E2E_PACZKOMAT_ID` locker override); tracking present; label PDF retrievable; DISPATCHED; status/tracking writeback confirmed at the checkpoint |
| **S7** | Order in PrestaShop + master stock down | destination sync `synced` with external order id; explicit `master.inventory.syncAll` trigger, then OL master availability == baseline − 1; PS order total (fails loudly if absent) + shipping + sold-line qty/unit-price parity |
| **S8** | KSeF issue → reconcile | issued via `POST /invoices` → reconcile (`schemaVersion: 1`) → `accepted` + KSeF number; expected line grosses derived from the ORDER snapshot (gross containment) + per-line net+VAT=gross consistency + totals + currency; UPO + source XML retrievable; **manual** KSeF env |
| **S9** | Final reconciliation | OL stock delta holds; order `ready` + synced; explicit `inventory.propagateToMarketplaces` trigger, then every OL-readable channel's offer qty == baseline − 1 (unreadable channels annotated); WC stock re-checked via REST (stale value annotated — OL has no WC quantity write-back today) |

The optional **S8b KOR** correction path (distinct number, before/after lines,
linked to the original) is a follow-up scenario on the same substrate.

---

## How to run (headed)

Prerequisites:

1. A running stack you control (**not** a shared demo stack in active manual
   use). All six connections configured and active.
2. Chromium installed once: `pnpm --filter @openlinker/e2e exec playwright install chromium`.
3. A package-local `.env` (`cp apps/e2e/.env.example apps/e2e/.env`) with the
   **secrets the OL API never exposes**:
   - `OL_PS_WEBSERVICE_KEY` — PrestaShop webservice key (else S1/S7 fall back to
     OL-only assertions).
   - `OL_WC_CONSUMER_KEY` / `OL_WC_CONSUMER_SECRET` — WooCommerce REST creds (else
     S2 falls back to OL-only).
   - Base URLs are read automatically from each connection's config
     (`config.baseUrl` / `config.siteUrl`); override only if needed. The PS admin
     is reached via `<config.baseUrl>/admin-dev` — never `localhost:8080`, which
     301-redirects (the tunnel is `ps_shop_url.domain`).

Run:

```bash
pnpm --filter @openlinker/e2e test:e2e -- --project=full-flow --headed
```

### Driving the manual checkpoints

When a segment needs eyes on a dashboard (or the purchase), the run prints a
banner with the **concrete expected values** and blocks. The **sentinel file is
the only resume mechanism** (Playwright workers are child processes whose stdin
is not your terminal, so pressing Enter can never work):

- **Pass**: `touch .e2e/resume`.
- **Fail**: `echo "reason" > .e2e/fail` (or write `fail …` into `.e2e/resume`)
  before resuming — the verdict is recorded as a report annotation.

Checkpoint verdicts (pass/fail) land in the Playwright HTML report
(`pnpm --filter @openlinker/e2e test:e2e:report`) as annotations, so the attended
run leaves a durable trail.

---

## Honest limits

- **Happy path only**, qty=1, one product / one order. Edge cases
  (cancel / return / out-of-stock / multi-item / invoice-reject /
  correction-of-correction) are follow-up scenarios on the same substrate.
- **Field parity for Allegro/Erli/KSeF covers what OL's neutral model exposes.**
  OL's live-offer read (`getOffer`) returns category id + price + quantity +
  status but **not** the marketplace-side *filled* parameter values or variant
  grouping. The full flow asserts the **submitted** parameter values from the
  persisted creation-request snapshot (value-level, vs the category directory +
  master variant attributes) — what actually landed on the marketplace side is
  confirmed visually via the Allegro/Erli manual checkpoints. Values the builder
  projects server-side (attribute projection, catalog-card inheritance) are not
  in the snapshot and stay checkpoint-verified. The Erli adapter ships no
  `OfferReader`, so its live parity degrades to mapping-level assertions.
  A raw platform field OL does not model stays manual or needs a targeted OL-read
  extension (case-by-case).
- **Attended run, not unattended CI.** The buyer purchase and external dashboards
  are human-in-the-loop.
- **Role/text selectors (no `data-testid`)** — some UI fragility until testids
  are added.

---

## How to extend

The point of this flow is the **reusable helpers** — new scenarios compose them:

- `manualCheckpoint(testInfo, { dashboard, url?, expect[], values? })` — prints
  expected values, pauses on the `.e2e/resume` sentinel file (the only resume
  mechanism), records a pass/fail annotation. `src/support/manual-checkpoint.ts`.
- `waitForOrder(api, { sourceConnectionId?, knownOrderIds?, timeoutMs? })` +
  `snapshotOrderIds(...)` — poll for a new `ready` order. `src/support/orders.ts`.
- `captureStock(api, variantIds)` / `assertStockDelta(...)` /
  `waitForStockDelta(...)` — qty-safe stock snapshots + deltas. `src/support/stock.ts`.
- `assertProductFieldParity(...)`, `assertOfferParameterParity(...)`,
  `assertInvoiceAmounts(...)`, `assertMoneyEqual(...)`, `toMinorUnits(...)` —
  money-safe, currency-aware, field-by-field. `src/support/parity.ts`.
- `PrestashopWebserviceClient` / `WooCommerceRestClient` — thin direct-read API
  clients. `src/api/`.
- `PrestashopAdminPage` / `WooCommerceAdminPage` — admin login + per-origin
  storageState. `src/pages/`.

Add a new segment by triggering work explicitly (a sync job via
`src/support/jobs.ts`, or a UI wizard) then `poll.until(...)` OL state — never a
blind sleep.
