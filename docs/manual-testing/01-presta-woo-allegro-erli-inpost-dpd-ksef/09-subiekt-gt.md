# Manual walkthrough — Subiekt GT

ERP connection reached through a hand-deployed .NET bridge that drives Subiekt GT over classic COM
automation (ProgID `InsERT.GT`), NOT the .NET Sfera SDK — see ADR-026 for the country-agnostic
invoicing domain this sits under, and note that **Subiekt nexo is a different product with a
different bridge** (`subiekt.nexo.v1`); nothing here is a claim about it.

⚠️ **Prerequisite**: a live Subiekt GT on Windows with the bridge running. No CI runner has one, so
every automated spec covering this integration is opt-in (`E2E_TEST_SUBIEKT=true`) and skips
cleanly without it.

**Connection**: `Subiekt GT (DEMO) - Invoicing` — id `d0361bd0-5c2a-4f41-9ad2-e65062cf71a5`
**Config**: `bridgeBaseUrl` `http://host.docker.internal:5056`, five capabilities enabled —
`Invoicing`, `ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager`
**Run**: 2026-09-25, local demo stack (`ol-demo-fresh`, web `:8090`, api `:13000`) against the
Subiekt `DEMO` database on `DESKTOP-FJ0P3NU\INSERTNEXO`. Bridge built and restarted for this run.

This document records the SECOND verification round on branch `subiekt-gt-full-capabilities`
(PR #3365). The first round closed five defects; this one was opened by re-reading the seven
promises made to the client and asking what was still not true.

## Part A — What the client was promised

Recorded verbatim, because the rest of this document is an answer to it:

1. pull the catalogue from Subiekt GT — products, variants, prices, EANs and stock
2. push orders from Allegro and other channels into Subiekt GT
3. create the customer, the invoice or receipt, and the warehouse-release document
4. honour the real marketplace sale price
5. buy shipping labels from inside OpenLinker
6. relay the waybill and order status back to Allegro automatically
7. keep stock in sync between Subiekt and the sales channels

## Part B — The catalogue read is bounded by requests per product, not by a rate limit

- [x] Measure a live catalogue sweep

The connection declares `60 requests/minute, maxConcurrent: 1`. That second number is not an
arbitrary throttle: the bridge serves **every** request through one STA COM worker thread with one
queue (`subiekt-plugin.ts:95-112`), so it never handles more than one at a time. Raising the limit
moves the queue into the bridge, where a call OpenLinker gave up on still executes and still
commits — which is exactly the duplicate-order failure #3369 closed.

> **Finding (real inefficiency, fixed — PR #3365):** four methods on
> `SubiektProductMasterAdapter` asked the bridge for the SAME resource while serving one product.
> A model-keyed product fetched `/api/models/{id}` from `getProduct`, `getProductVariants`,
> `readProductTaxRate` and `getProductCategories`; a plain towar fetched
> `/api/products/{symbol}` twice. The responses were identical.
>
> `getJson` now memoizes per adapter INSTANCE. `getCapabilityAdapter` constructs a fresh adapter
> per call, so the memo lives exactly as long as one sync child and cannot hand stale data to the
> next one. A rejection is evicted (a transient bridge error must not poison the rest of the
> child), and a write clears it on both sides of the request.

**The honest limit of this measurement.** The structural claim — three product-level questions,
one request — is asserted directly by a unit test that counts the URLs the adapter requests. A
wall-clock speedup is NOT published here, because the sweep on this stack ran alongside an
inventory sweep (143 s), an order poll and a tax-rate backfill competing for the same execution
slots: 49 products spanned 843 s, against 8 products spanning 25 s in a quiet window earlier the
same day. Those two numbers measure contention, not the change, and quoting a ratio from them
would be the mistake ADR-066 correction 1 already records once.

## Part C — An order from a shop could not become a document at all

- [x] Confirm the refusal, and then confirm the premise underneath it

Every order whose source prices its lines net — PrestaShop, WooCommerce — was refused by
`describeNetPricedOrderRefusal` before anything was written, on the grounds that OpenLinker may
never compute `net × (1 + rate)` to reach the gross figure a document's lines require. That
reasoning is correct and is unchanged.

> **Finding (real bug, fixed — PR #3365):** the sentence beside it called the refusal "a PERMANENT
> limitation of a net-line-price source". It is not. Both shops report gross amounts already and
> both mappers discarded them. Read live from the demo shop's own database:
>
> | column | value |
> |---|---|
> | `ps_order_detail.product_price` | `1499.000000` — what OpenLinker read |
> | `ps_order_detail.unit_price_tax_incl` | `1843.770000` — what it discarded |
> | `ps_orders.total_paid_tax_incl` | `1843.770000` — the same figure, confirming it |
>
> WooCommerce reports `total` + `total_tax` per line, whose sum is what the buyer paid.
>
> `OrderItem.unitPriceGross` and `OrderTotals.shippingGross` carry them. **Carrying a figure the
> source computed is not computing tax** — ADR-063 § 5 permits grouping and division and forbids
> applying a rate, and no rate is read anywhere on this path. The guard is narrowed, not relaxed:
> it still refuses when the source prices net AND reports no gross, it requires EVERY line to
> carry one, and it requires gross shipping whenever the order charges any.

The adapter had also grown a private copy of the same test, which would have gone on refusing
orders the shared rule had started admitting. It now asks core, which is why the refusal vocabulary
gained a third, deliberately platform-neutral value.

## Part D — The order sat in Subiekt as permanently unfulfilled

- [x] Read every order OpenLinker has written, and its status

Baseline immediately before this run, straight from `dok__Dokument`:

| `dok_Status` | meaning | count |
|---|---|---|
| 6 | order does not reserve stock — i.e. **not realized** | 28 |
| 7 | order reserves stock | 3 |
| 8 | **realized** | 7 |

Twenty-eight orders the operator had in fact invoiced and shipped were still showing as
outstanding work.

> **Finding (real bug, fixed — PR #3365 / bridge PR #7):** the bridge's own comment said "Subiekt
> has no dedicated fulfillment-status field on a ZK". That is false. `SuDokument.StatusDokumentu`
> is a settable attribute and `SubiektDokumentStatusEnum` carries four values scoped to orders —
> 5, 6, 7 and 8 each say *"Dotyczy dokumentów typu Zamówienie (ZM, ZK i ZD)"* in the GT Sfera help.
>
> The cause is an early return. Subiekt derives realization from the documents linked to an order;
> OpenLinker's invoice is created standalone, so nothing links back. On an install that releases
> stock automatically the auto-generated release document is linked to the **invoice**, not to the
> order — confirmed in the data: every recent release document carries `dok_DoDokId` pointing at an
> invoice or receipt, every recent invoice carries none. `EnsureWarehouseRelease` returned before
> it had even resolved the order id. The other branch already calls `NaPodstawie(zkId)`, and those
> orders do reach status 8 on their own.
>
> **Note for whoever checks this next:** a `sfera-api-main` dump sitting on the same machine has an
> identically-named enum. That is Subiekt **nexo** (`InsERT.Moria.*`, zero `SuDokument` entries)
> and proves nothing about GT. The GT help file is the only admissible evidence.

## Part E — A status write destroyed the previous one

- [x] Trace what reaches `dok_Uwagi` / `dok_UwagiExt`

`Sfera.WriteShipping` ASSIGNS both remarks fields. The WooCommerce-shim route merged first; the
native `/api/orders/{id}/shipping` route did not.

> **Finding (real bug, fixed — bridge PR #7):** every status write erased the previous one. A
> shipped-then-cancelled order ended up carrying only `Anulowane`, with no trace that a waybill had
> ever been recorded, and the first status write wiped the `OpenLinker order …` note written at
> creation. The merge already existed, in the wrong place; it moved to a shared helper, the inline
> copy was deleted, and both routes now call it. The adapter also sends the carrier, which it had
> been dropping along with four other fields.

## Part F — A return label would have been announced as a dispatch

- [x] Read every path into `notifyDispatched`

> **Finding (latent bug, guarded — PR #3365):** `notifyDispatched` resolves its shipment by id
> through a deliberately direction-blind read, and nothing downstream re-checked the cohort. On a
> `direction = 'return'` row the lifecycle relay would have told the marketplace that the **seller
> dispatched the order**, off a label moving goods the other way. Nothing writes `'return'` yet, so
> this is a guard placed ahead of the first writer — and it matters now because this branch gave
> the service a second way in, an automatic job that likewise carries no direction.

## Part G — Live verification

- [x] Rebuild the stack onto this branch, restart the bridge, re-run the opt-in specs

> **Finding (real trap, cost two full verification cycles):** `docker compose up -d` reported
> success and left the container running the PREVIOUS image. The first "verification" of the
> pricing change therefore exercised code that did not contain it, and read as a clean refusal.
> Every claim below was re-taken after confirming, inside the running container, that the compiled
> file carries the change — `grep -c` against the built `.js`, not against the source tree.

- [x] `model-variants.spec.ts` — 6 of 7 pass, including the VAT rate a model's members agree on
- [ ] `a product image URL loads FROM A BROWSER` — **not a code failure.** The stored URL points at
      the bridge on the Windows host, and `Get-NetFirewallHyperVVMSetting` reports
      `DefaultInboundAction = Block` for the WSL VM, so Playwright's browser cannot reach it while
      the operator's own browser (and the worker container, over a different path) can. Recorded
      rather than worked around: the assertion is correct and the environment is what fails it.

**Live confirmations, taken from the databases rather than from a UI:**

| claim | evidence |
|---|---|
| a PrestaShop order's gross unit price now reaches the order snapshot | `unitPriceGross = 1843.77` beside `price = 1499`, order `OBOYAMRZY` |
| the shop reports it and always did | `ps_order_detail.unit_price_tax_incl = 1843.770000` on the same order |
| the bridge answers after the restart | `/health` 200 from inside the worker container |
| the renumbered migration is genuinely self-healing | its `up()` deleted the row recorded under `…1894000000000`, the guarded `ADD COLUMN IF NOT EXISTS` no-opped, and the new class name was inserted — on a database that had already applied it |

## Part H — Not run, and why (fiscalization)

- [ ] `FiscalizationPort` against Subiekt — the bridge carries fiscalization routes that have never
      been compiled against a live install in this walkthrough. Not attempted here; claiming it
      untested is more useful than a green line that exercised a stub.
