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
| **S0** | Baseline: sync master catalogue, snapshot stock | driver product picked (default: EAN-complete multi-variant whose primary variant has an ACTIVE, mapped offer on the purchase source; falls back to the first EAN-complete multi-variant on a fresh stack; `E2E_PRODUCT_SKU` pins an exact product); primary variant has an EAN; OL availability captured per variant |
| **S1** | PrestaShop parity | OL product name/EAN/price/currency == PS webservice; OL master total == PS `stock_availables` total |
| **S2** | WooCommerce publish + REST parity | listing mapping appears in OL; OL SKU/name == WC REST; wp-admin visual |
| **S3** | Allegro offers | offers created + mapped; OL adapter read price/currency/category/qty parity; **value-level parameter parity** — submitted values from the persisted creation-request snapshot vs the category directory + master variant attributes; **manual** Allegro panel |
| **S4** | Erli offers (borrowed taxonomy) | offers created; mapping-level assertions (external id + primary-variant link; no `OfferReader` on the Erli adapter); **manual** Erli panel |
| **PAUSE** | Operator buys the named offer | prints exact product / SKU / EAN / qty=1 to buy; instructs **InPost Paczkomat delivery** + a locker that exists in the InPost sandbox (`E2E_PACZKOMAT_ID` override for S6); waits for resume |
| **S5** | Order ready in OL + channel stock down | new `ready` order appears; line price×qty; tax-treatment-aware total identity (inclusive: subtotal+shipping; exclusive: subtotal+tax+shipping); source offer qty == baseline − 1 |
| **S6** | InPost label | routing rule ensured (`ol_managed_carrier`); label GENERATED with `pickup_point` intent (optional `E2E_PACZKOMAT_ID` locker override); label PDF retrievable; DISPATCHED; **tracking-number backfill polled** — drives `marketplace.shipment.statusSync` and waits (bounded 120s) for `Shipment.trackingNumber` to be minted, then asserts it (see sandbox note below); status/tracking writeback confirmed at the checkpoint |
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

### Optional run knobs

| Env | Effect |
|---|---|
| `E2E_PRODUCT_SKU` | Pin the driver product by SKU (S0 escape hatch). Overrides the heuristic — use it when the default pick's marketplace offer is a draft/inactive listing, or to re-run against a known-good product. Single-variant products are allowed on this path. |
| `E2E_SOURCE_PLATFORM` | Purchase-source marketplace (`allegro` \| `erli`, default `allegro`). Threads through the purchase pause, order ingestion (S5) and label dispatch (S6), so the flow can run with **Erli** as the marketplace source. S3 (Allegro) and S4 (Erli) still create offers on both channels for the cross-channel checks; only the *purchase* source is switched. |
| `E2E_FRESH_PRODUCT` | Opt-in (`true`). Provision a brand-new PrestaShop product before the catalogue sync so the run exercises the create-paths everywhere. See § Fresh product per run. |

### Driver-product selection (S0)

The default picker requires the chosen product's primary variant to have an
**ACTIVE, OL-mapped marketplace offer** on the purchase source — a draft/inactive
offer would strand S3, the purchase, and S5. When no candidate has an active offer
yet (a genuinely fresh stack where S3/S4 will create them), it falls back to the
first EAN-complete multi-variant product so a clean run is never blocked. For a
source adapter with no `OfferReader` (Erli), "active" degrades to "mapped". Set
`E2E_PRODUCT_SKU` to bypass the heuristic entirely.

### Fresh product per run (E3)

By default the flow **reuses** an existing driver product (and its offers, via
create-if-missing-else-reuse). Reuse is fast and deterministic, but it means a run
does **not** exercise the brand-new-create paths (#1500 / #1502 / #1498) — a
regression in offer/order creation can hide behind reuse.

`E2E_FRESH_PRODUCT=true` provisions a new PrestaShop product at the start of S0
(via the PS webservice, `PrestashopWebserviceClient.createProduct`) with a unique
timestamped `reference`/SKU and EAN, then pins the run to it — so every offer and
the order are created fresh.

**Implemented now:** a **simple (single-variant)** product — name, unique
reference/SKU, parent-level valid EAN-13, price, default category, and starting
stock (`stock_availables`). Requires `OL_PS_WEBSERVICE_KEY`.

**TODO (deferred — needs live verification):**
- **Multi-variant provisioning** — `combinations` + per-combination `ean13` +
  per-combination `stock_availables`. Today's scaffold is simple-product only, so
  the multi-variant expansion paths (#824) are not exercised by the fresh flow.
- **Tax** — `price` is net; the product inherits the store's default tax rule. A
  run asserting a specific gross may need an explicit `id_tax_rules_group`.
- **Live verification** — the write path (POST/PUT XML) has not been exercised
  against a live PrestaShop; some stores require extra required fields. If the
  create is rejected, drop `E2E_FRESH_PRODUCT` and fall back to the pin/heuristic
  (the flag is off by default, so it never blocks a normal run).

### Driving the manual checkpoints

When a segment needs eyes on a dashboard (or the purchase), the run prints a
banner with the **concrete expected values** and blocks. The **sentinel file is
the only resume mechanism** (Playwright workers are child processes whose stdin
is not your terminal, so pressing Enter can never work):

- **Pass**: `touch .e2e/resume`.
- **Fail**: `echo "reason" > .e2e/fail` (or write `fail …` into `.e2e/resume`)
  before resuming — the verdict is recorded as a report annotation.

The external-dashboard checkpoints (Allegro / Erli / InPost / KSeF) are
**observational**: a FAIL is annotated but does **not** abort the run, so the
downstream serial segments (the purchase + S5-S9) still execute even if a visual
confirmation is flagged. Only the **purchase pause is fatal** — nothing after it
can run without a real order. (Severity is `manualCheckpoint`'s `severity` option:
`observational` default, `soft`, `fatal`.)

Checkpoint verdicts (pass/fail) land in the Playwright HTML report
(`pnpm --filter @openlinker/e2e test:e2e:report`) as annotations, so the attended
run leaves a durable trail.

---

## Honest limits

- **Happy path only**, qty=1, one product / one order. Edge cases
  (cancel / return / out-of-stock / multi-item / invoice-reject /
  correction-of-correction) are follow-up scenarios on the same substrate.
- **Field parity for Allegro/Erli/KSeF covers what OL's neutral model exposes.**
  With #1482 deployed, OL's live-offer read (`getOffer`) carries the
  marketplace-side **filled parameter values** (offer + product section) and
  productSet linkage, so the flow asserts a full **round-trip**: the SUBMITTED
  values from the persisted creation-request snapshot (value-level, vs the
  category directory + master variant attributes) AND that Allegro **accepted**
  them (`assertMarketplaceParameterRoundTrip` — submitted == live, by
  valuesIds / values / rangeValue). On a stack whose API predates #1482 the
  field is absent and the marketplace-side half degrades to the Allegro manual
  checkpoint (annotated, non-fatal). Values the builder projects server-side
  (attribute projection, catalog-card inheritance) are not in the snapshot;
  with #1482 they ARE included in the live read's filled values (the
  offer-section presence assertion covers e.g. condition). The Erli adapter
  ships no `OfferReader`, so its live parity degrades to mapping-level
  assertions. A raw platform field OL does not model stays manual or needs a
  targeted OL-read extension (case-by-case).
- **Attended run, not unattended CI.** The buyer purchase and external dashboards
  are human-in-the-loop.
- **InPost/ShipX tracking number is minted asynchronously.** In the ShipX sandbox
  `tracking_number` is `null` until the shipment reaches `confirmed` and the
  carrier-generic `marketplace.shipment.statusSync` poll (#838) has run to
  backfill it (the #1426 path). A null immediately after label creation /
  dispatch is expected sandbox timing, NOT an OL defect. S6 drives that poll
  explicitly and waits (bounded 120s) for the backfill before asserting the
  tracking number; on a genuine sandbox delay past the budget it annotates
  rather than fails (#1521).
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

## First full-run findings & prerequisites (2026-07-10)

The first end-to-end attended run (S0-S3 automated-verified against a live demo
stack) surfaced these. Framework fixes are already committed; the items marked
PREREQUISITE / PRODUCT are for whoever runs the attended half.

### Stack prerequisites (do these before the run)
- **WooCommerce connection needs `config.masterCatalogConnectionId`** pointing at
  the PrestaShop (master) connection — without it shop publish fails
  `MASTER_CATALOG_NOT_CONFIGURED`. Set it on the connection-edit page.
- **Allegro fresh-offer creation needs the product's category resolvable** (a
  PS→Allegro category mapping, or a working EAN category match). On a stack where
  the driver product has **no** existing Allegro offer, S3 runs the bulk wizard
  and a review row flags "manual category" (needs attention) if the category does
  not auto-resolve. The flow now **reuses** an existing offer when present
  (create-if-missing, else reuse), so a stack that already has the offer mapped
  skips this; a truly clean stack must have the category mapping configured.
- `.env` must carry `OL_PS_WEBSERVICE_KEY`, `OL_WC_CONSUMER_KEY/SECRET` for full
  parity (else those segments degrade to annotated OL-only checks).

### Product findings (tracked as issues on main)
- **Shop publish carries the SKU** (#1485): S2 now prefers `getProductBySku`
  (falling back to name for stacks predating #1485). A missing SKU is annotated as
  a "stack predates #1485" gap rather than the previous name-only default.
- **Filled offer parameter values in the read model** (#1482): needed for
  marketplace-side value parity; when deployed, S3 asserts submitted == accepted.
- WooCommerce publish lands **uncategorised** (category mapping "not implemented
  in MVP") — annotated, not failed.

### How the attended half completes (S3 checkpoint → S9)
The run pauses at each external dashboard checkpoint (Allegro/Erli/InPost/KSeF)
and at the purchase step. To continue a checkpoint: `touch .e2e/resume`
(record a fail with `echo reason > .e2e/fail`). At the PAUSE, buy the named
offer on the marketplace (delivery = InPost Paczkomat; a sandbox-valid locker,
or set `E2E_PACZKOMAT_ID`), then resume. These steps require a human and cannot
be run unattended.

## Second-run hardening (2026-07-13)

A second attended run surfaced framework issues E1-E7, now fixed:

- **E1 — picker requires an active mapped offer.** S0 now prefers a driver product
  whose primary variant has an ACTIVE, OL-mapped offer on the purchase source
  (degrades to "mapped" for Erli; falls back to the first EAN-complete
  multi-variant on a fresh stack). See § Driver-product selection.
- **E2 — WooCommerce SKU lookup.** S2 prefers `getProductBySku` with a name
  fallback (SKU set on publish per #1485); more robust for names with `/`.
- **E3 — fresh product per run.** `E2E_FRESH_PRODUCT` + a PS-webservice
  `createProduct` scaffold (simple product). Multi-variant / tax / live
  verification remain TODO — see § Fresh product per run.
- **E4 — S3/S4 speed.** Reuse-detection and mapping resolution are now EXACT
  (filtered by `internalId`) instead of scanning a page, so a reused offer resolves
  on the first poll rather than missing the window, re-running the wizard, and
  blocking on the create-wait. Mapping-resolution timeout right-sized to 60 s.
- **E5 — checkpoints no longer abort the chain.** External-dashboard checkpoints
  are `observational` (record-only); only the purchase pause is `fatal`. A flagged
  visual mismatch no longer skips the whole downstream serial chain.
- **E6 — configurable purchase source.** `E2E_SOURCE_PLATFORM=allegro|erli` threads
  through the pause + S5 + S6, so the run can use Erli as the marketplace source.
- **E7 — `E2E_PRODUCT_SKU` pin** retained as the deterministic escape hatch (see
  § Optional run knobs).
