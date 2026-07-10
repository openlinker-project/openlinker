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
| Allegro / Erli offer (category id, price, currency, qty, status) | **Automated** — OL adapter read (`GET /listings/:id/offer`) |
| Allegro / Erli category parameters (Brand/Model/condition, offer + product section) | **Automated (directory)** — `GET /listings/.../categories/:id/parameters`; per-offer *filled* values are a manual checkpoint (honest limit below) |
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
| **S3** | Allegro offers | offers created + mapped; OL adapter read price/currency/category/qty parity; category parameter directory parity; **manual** Allegro panel |
| **S4** | Erli offers (borrowed taxonomy) | offers created; adapter-read parity; **manual** Erli panel |
| **PAUSE** | Operator buys the named offer | prints exact product / SKU / EAN / qty=1 to buy; waits for resume |
| **S5** | Order ready in OL + channel stock down | new `ready` order appears; line price×qty, subtotal+tax+shipping==total; source offer qty == baseline − 1 |
| **S6** | InPost label | routing rule ensured (`ol_managed_carrier`); label GENERATED; tracking present; label PDF retrievable; DISPATCHED; writeback best-effort (annotated) |
| **S7** | Order in PrestaShop + master stock down | destination sync `synced` with external order id; OL master availability == baseline − 1; PS order total == OL order total |
| **S8** | KSeF issue → reconcile | issued → reconcile → `accepted` + KSeF number; FA(3) per-line net/VAT/gross + totals + currency + doc type parity; UPO + source XML retrievable; **manual** KSeF env |
| **S9** | Final reconciliation | OL stock delta holds; order `ready` + synced; channel offer qty reflects the sale |

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
banner with the **concrete expected values** and blocks. To continue:

- **Pass**: press **Enter** in the terminal, or `touch .e2e/resume`.
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
  Notably, OL's live-offer read (`getOffer`) returns category id + price +
  quantity + status but **not** the per-offer *filled* category parameter values
  or variant grouping. The full flow asserts the **category parameter directory**
  (which parameters exist, in which section) via the category endpoint, and
  confirms the *filled* values visually via the Allegro/Erli manual checkpoints.
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
  expected values, pauses on `.e2e/resume` (Enter fallback), records a pass/fail
  annotation. `src/support/manual-checkpoint.ts`.
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
