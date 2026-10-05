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
| an order is marked realized once its goods leave | `ZK 41/2026` went `dok_Status` 6 → 8 on an invoice whose release document links to the INVOICE (`WZ 66 → FS 40`), with `Invoicing: marked ZK 230 realized` in the bridge log |

> **Finding (my own fix was dead code, caught by testing it):** the first version of the
> realize-the-order change sat inside `EnsureWarehouseRelease`. Both call sites skip that method
> **entirely** when the invoice already carries a stock movement (`dok_JestRuchMag = 1`) — which is
> exactly the auto-releasing install it was written for. FS 38 and FS 39 both proved it: auto-WZ
> present, ZK left at 6, and not one `EnsureWarehouseRelease` line in the bridge's stderr. The call
> moved to both call sites, and only then did a ZK actually move.

## Part H — What was NOT proven here

- [ ] **A shop order becoming a Subiekt document, end to end.** The gross price now reaches the
      order snapshot AND the destination command (three separate allowlists, each found by the run
      after the previous fix). What is NOT shown is a PrestaShop order becoming a ZK: on this stack
      no product exists in both catalogues, so every synthesised order is refused for the honest
      reason that its product is unknown to Subiekt. The realized-status row above was therefore
      proven on a Subiekt-sourced order instead. Closing this needs a fixture with one product in
      both catalogues, and until it exists the chain is proven in two halves rather than in one.
- [ ] **Fiscalization against Subiekt** — the bridge carries routes that have never been compiled
      against a live install in this walkthrough. Claiming it untested is more useful than a green
      line that exercised a stub.

## Part I — Open, and not mine to decide

- **An invoice can be issued for more than the buyer paid.** Neither shop mapper carries an
  order-level discount (`total_discounts*` is read nowhere; WooCommerce `fee_lines` are never mapped
  onto items), and the invoice mapper has no line-versus-total reconciliation — the fiscal-receipt
  mapper does. Before this round the gross-price gate refused those orders outright, so the gap was
  unreachable; it is reachable now. A reconciliation was written and **deliberately not landed**:
  it changes what OpenLinker refuses, and its effect on real orders could not be validated here.
- **A marketplace sale does not reduce Subiekt stock** — the order is written with reservation off,
  and nothing else decrements. "Synchronise stock **between** Subiekt and the channels" is true in
  one direction only.
- **A towar that joins a model gets a new variant identity**, so offers attached to its previous
  identity are orphaned — on the very grouping operation this feature introduces.

- [ ] `FiscalizationPort` against Subiekt — the bridge carries fiscalization routes that have never
      been compiled against a live install in this walkthrough. Not attempted here; claiming it
      untested is more useful than a green line that exercised a stub.

---

## Part J — Third round, and what it changes above

Parts H and I are left as written: they record what was true at the end of the second round. This
part says which of their claims no longer hold, because a reader who stops at Part I would carry
away four things that have since been fixed and one that was never right.

### Closed since

| Part I said | now |
|---|---|
| "An invoice can be issued for more than the buyer paid" — reconciliation written and deliberately not landed | **Landed.** The invoice mapper refuses lines that contradict the order's own total, sharing the receipt mapper's tolerance (one minor unit of the order's currency). It found five self-contradicting fixtures on its first run, including a base fixture declaring a total of 123 for a single gross-priced line of 100 |
| "Neither shop mapper carries an order-level discount" | **PrestaShop does now.** `total_discounts_tax_incl` is carried as `OrderTotals.discountTotal`, and the refusal above names it when it exactly accounts for the gap — a diagnosis rather than an arithmetic complaint. Nothing apportions it: FA(3) expresses a discount only per line (`P_10`, inside `FaWiersz`), so folding it in would mean inventing an attribution for a legal document. WooCommerce `fee_lines` remain unmapped |
| "A towar that joins a model gets a new variant identity" | **Fixed.** The model path minted under the bare `{symbol}` while the standalone path used `{symbol}::variant`. It now consults the bare key first and reuses it, then mints the canonical one — so a towar grouped from here on keeps the identity it had, and an install already carrying bare keys is not re-identified on upgrade |
| Part H: "a shop order becoming a Subiekt document, end to end … no product exists in both catalogues" | **The blocker is gone, the proof is not.** The line could not resolve at all: publishing writes a `ShopProduct` mapping and the order resolver read `Offer` / `Product` / `ProductVariant` / `Sku` and never `ShopProduct`. It does now. `apps/e2e/tests/subiekt/published-product-order.spec.ts` publishes a Subiekt towar to the shop and sells it, so the fixture no longer has to be hoped for — but the spec has not been run |

### Corrected

**"A marketplace sale does not reduce Subiekt stock — the order is written with reservation off, and
nothing else decrements."** The first half is true and the conclusion does not follow. The
connection runs `triggerModel: auto-on-paid`, so OpenLinker issues the document itself, and issuing
it moves stock: WZ 64, 65 and 66 each carry one unit of `PUYAR06`. Measured across eight orders,
including real Allegro ones, the window from OpenLinker seeing the order to the document being
issued is **25–79 s, median ~54 s**. What was genuinely missing was the re-read: the post-sale
inventory refresh fired right after the order was mirrored, half a minute before the document moved
anything, and nothing read again afterwards. That is now called after the document too.

### Still not proven, and precisely why

- [ ] **The whole chain in one piece.** Every link is proven and two of them were proven on
      different orders — the gross price on a PrestaShop order, the realize-and-release on a
      Subiekt-sourced one. One run of the new spec against a live stack closes it.
- [ ] **The bridge carries three fixes that are not deployed.** Currency read from
      `tw_Cena.tc_IdWaluta1` instead of a hardcoded `"PLN"`, the primary barcode written where the
      read looks for it (`KodyKreskowe.Podstawowy`, before `Zapisz`, rather than the ADDITIONAL
      collection after it), and `UpdateProduct` writing the `Waluta` and `KodKreskowy` it had always
      accepted and discarded. Compiled clean against the real project; the deployed copy at
      `gtspike\bridge` is a separate flat folder and still runs the previous build.
- [ ] **A receipt (PA).** It takes the same `IssueInvoice` path as an invoice — `DocumentType == "PA"`
      selects `DodajPA()` and then the identical release-and-realize sequence — so the code is
      shared rather than parallel, but no PA has been issued in this walkthrough.
- [ ] **The waybill reaching Allegro.** Unchanged from Part H: not attempted this round.

### One shipping behaviour changed deliberately

Cancelling a label used to be refused once the shipment was `dispatched`, and since the dispatch
notification is now automatic that window closed within seconds of a label being bought — an
operator who bought the wrong one could not void it at all. `dispatched` is cancellable now.
Nothing is sent to the marketplace to withdraw the notification, because there is no event that
would be true: `OrderLifecycleEvent` carries `dispatched` and `cancelled`, and `cancelled` says the
buyer's ORDER was cancelled. The operator is warned before confirming and settles it with the
channel by hand. `in-transit` stays refused — there the carrier has moved something.

---

## Part K — The fourth round's live run, and why the chain still cannot be proven here

Everything Part J listed as "not deployed" is deployed. The bridge carries the three fixes
(`GtBridge.dll` built 26.09 08:42 with `SetPrimaryBarcode`, `SetPriceLevelCurrency`,
`ResolvePriceLevel`; `/health` 200 from inside the worker container), and the api and worker images
were rebuilt from the branch tip and confirmed to carry `resolveViaShopProduct` in **both**
compiled copies before anything was read from them.

`subiekt` project, final run: **7 passed, 2 failed, 3 skipped, 3 did not run.**

### The two failures, and what each one is

| failure | cause |
|---|---|
| `a product image URL loads FROM A BROWSER` | unchanged from Part G: `DefaultInboundAction = Block` on the WSL VM. The assertion is right and the environment fails it. |
| `an order reaches Subiekt as a ZK` | the stand's two catalogues do not overlap. OpenLinker says so precisely: *"No Subiekt product mapping for ol_product_7d7… — the product must be synced from this Subiekt connection (ProductMaster) before an order referencing it can be created here."* |

### Four things the run found before it could even start

Each would have failed the new spec for a reason that had nothing to do with what it tests. They
are recorded because three of them are facts about the product, not about the spec.

1. The PrestaShop connection did not have `ProductPublisher` **enabled**. The adapter advertises
   it; `enabledCapabilities` is stamped at create and never retro-filled (#2085).
2. `synthesizeOrder` looked the shop-side product id up from the product's `Product` identifier
   mappings. A publish writes `ShopProduct`, keyed by VARIANT, and `GET /products/:id` returns
   `Product` mappings only — so a published product is invisible to OpenLinker's own products API.
3. The publish DTO's `price` is a money OBJECT, not a number.
4. `PrestashopProductPublisherAdapter` sets `body.reference = internalVariantId`, deliberately —
   it is the stable server-side key its create-idempotency guard adopts an orphan by (#1107) — so
   a lookup by SKU finds nothing.

### And one that was making a shipped spec lie

`world.connectionFor` answers POSITIONALLY, and this stand carries three PrestaShop connections.
The first active one is `E2E bench seed source`: zero enabled capabilities, zero products. So
`order-to-documents` scoped its driver search to the seed fixture and reported *"no catalogue
product with a priced, EAN-complete variant"* about a stand whose real store has six. Fixed by
resolving the store by capability (`resolvePrestashopStore`), which is what let that spec get as
far as the honest refusal quoted above.

### Why the end-to-end chain is still not proven, stated as a finding

It needs one product present in both catalogues. Three routes were tried and each is closed for a
different real reason:

- **Publish a Subiekt towar to PrestaShop** — refused by the stand's own topology guard, correctly:
  a shop that is simultaneously a `ProductMaster` and points at another master *"will re-import
  products published to it as NEW OpenLinker products, splitting one product in two."* That is the
  duplicate this round's resolver fix exists to survive at the ORDER level, and the guard is right
  to refuse creating it deliberately.
- **Publish to WooCommerce**, the stand's only publish-only shop — its REST keys are stored hashed
  in the WordPress database and cannot be recovered.
- **Map the same product by hand** — there is no identifier-mapping write API; no mapping
  controller exists and the products controller has no `@Post`.

A fourth route exists and was **deliberately not taken**: seeding the mapping directly into
`identifier_mappings`. It would assert that a PrestaShop product IS a Subiekt towar when they are
two different items, and the document would then be issued for one product's data while releasing
another's stock. The chain would go green because the fixture lied — the same failure mode this
round spent its time removing from the invoicing fixtures.

**So the honest conclusion is a topology one, not a defect one.** OpenLinker supports either one
master published out to shops, or each system its own master with separate products. This stand is
the second, so a PrestaShop order has no business reaching Subiekt, and OpenLinker refuses it with
the right sentence. Proving the chain needs a stand in the first topology: a publish-only shop
whose `masterCatalogConnectionId` is the Subiekt connection. `published-product-order.spec.ts`
runs unchanged the moment one exists, and skips with that requirement stated until then.

---

## Part L — The fifth round: what three production audits found, and what is now proven

Three parallel audits (day-one-at-a-customer, e2e-coverage, ship-readiness) read both
branches. Four of the seven promises were judged not shippable, and almost every blocker
turned out to live in the C# bridge rather than in OpenLinker.

### Measured, not reasoned about

The bridge's own header said the numeric `dok_Typ` for a ZK "was never established live"
and printed the query that would establish it. That query was run against the live DEMO
database on 2026-09-27:

| FZ | FS | KFS | MM | PZ | WZ | PW | RW | ZD | ZK | PA |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2 | 6 | 9 | 10 | 11 | 12 | 13 | 15 | 16 | 21 |

229 documents, one code per prefix, no overlap. Also measured on the same database:

- **`sl_Magazyn` has two rows** (`1 MAG Główny`, `2 MAP Magazyn pomocniczy`) and `tw_Stan`
  holds stock in both — 11 363 units in magazyn 1, 9 in magazyn 2. The demo is NOT a
  single-warehouse install, and every WZ written so far landed in magazyn 1 only because
  the Sfera session default happens to agree with what OpenLinker publishes.
- **`rb__RachBankowy.rb_TypObiektu` is the owner discriminator**: `0` → 4 seller accounts,
  `1` → **43 accounts belonging to the seller's own kontrahents**, `3` → 4 others. The
  operator's picker was offering all 51.
- `dok_DataWyst` exists; the watermark-column guess was right.

### Two audit claims corrected

- *"Every `/api` route is unauthenticated"* — false. `Program.cs` carries a bearer gate with
  a constant-time comparison that fails closed when no token is configured. What IS true is
  that it serves plaintext on `0.0.0.0`, and that `/gt-image` was outside both gates.
- *"The price read and the price write point at different levels"* — false. Sfera level
  `Id == 0` IS `tc_*1`, which this project had already confirmed live. The real defect was
  narrower: one level hardcoded, with no way to choose another.

### The e2e suite could not fail

`grep -rn -i subiekt .github/` returned zero. The project was not in
`test:e2e:unattended`, not in `workflow_dispatch`'s options list — so it could not even be
PICKED — and `E2E_TEST_SUBIEKT` was set nowhere. The last recorded run reported
`{"total": 15, "skipped": 15, "ok": true}`: fifteen tests, zero passed, and green.

All four doors are open now, and an all-skipped run fails.

### The stand finally has the topology Part K asked for

Part K concluded that proving the chain needs "a publish-only shop whose
`masterCatalogConnectionId` is the Subiekt connection", and recorded three closed routes.
WooCommerce was ruled out on the grounds that its REST keys are hashed — true, and beside
the point: the actual blocker is that it serves HTTPS with a self-signed `CN=example.com`
certificate the api container does not trust, which is a compose change.

The route taken instead is a **third PrestaShop connection**, `ProductPublisher` +
`OrderSource`, mastered by Subiekt. It passes the topology preflight (which is per
connection) and additionally exercises the `ShopProduct` resolution fallback. Connection
test: 200.

Two real blockers surfaced while standing it up:

1. **The PrestaShop webservice key had no `categories` permission** — 97 permissions, none
   for categories. The connection test passes because it reads `products`, so this is
   invisible until a publish tries to provision a category. Granted GET/POST/PUT/HEAD.
2. **Signing image URLs invalidates every URL stored before the gate.** Mine, and recorded
   in the bridge: it self-heals on the next catalogue sweep and nothing already published
   to a marketplace is affected, but OpenLinker's own thumbnails 404 in the window.

### The run

**7 passed / 2 failed / 3 skipped / 3 never ran** → **11 passed / 2 failed / 2 never ran.**

`published-product-order.spec.ts` **executed for the first time in its existence**, and the
assertion the file was written for — that an order for a published product resolves back to
the SAME Subiekt product rather than to a duplicate — **passes**.

Confirmed in the database rather than inferred from a green tick: PrestaShop order 43 was
ingested twice, `ready` under the publish-only connection with its line resolved to the
Subiekt variant, and `awaiting_mapping` under the catalogue master. Both correct.

### Three test bugs of one family

Every one resolved something by POSITION or by habit instead of by the fact the spec is
about:

1. `world.connectionFor` answering positionally onto a zero-product seed connection
   (fixed in round four).
2. The image test picking the first product with images — including a RETIRED one, whose
   variant #1599 staled when its towar joined a model. Its stored URL is not what the
   catalogue reports and nothing will ever refresh it.
3. `synthesizeOrder` waiting for the catalogue master to ingest an order for a product
   OpenLinker had PUBLISHED. Only the publishing connection can resolve that line.

### Still not proven, stated plainly

`the sale reaches Subiekt and moves the towar stock` fails: stock read 517 where 516 or less
was required.

**Two diagnoses were written here before the right one, and both are kept rather than
quietly replaced, because the way they were wrong is the useful part.**

*First:* the `realtime` lane's per-scope cap, on a stand carrying 8 430 dead jobs. Dead rows
are terminal and are never claimed, so they block nothing, and the cap was not wedged either
— eight jobs were running at the moment of the check, two of them for this very connection.

*Second:* the fixture's own one-time cost. That one is a REAL observation — a second
`OrderSource` on a shop holding ~47 orders back-fills that entire history, and 43 of those
jobs can never succeed because the products were never published through this connection, so
they retry up the ladder holding lane slots. Worth knowing before anyone points a second
source connection at a live shop. It was not the cause of this failure.

*The actual cause:* **the `api` and `worker` containers were built on 26 September and
carried none of this round's OpenLinker changes.** `Subiekt rejected the request: Parametr
jest niepoprawny` is the OLD `resolveTowarSymbol` putting `model:1` on the wire as a towar
symbol, straight into a catch-less `Pozycje.Dodaj` — precisely the defect `a837e9588`
fixed. The bridge had been redeployed twice during the round; OpenLinker had not, and every
conclusion drawn from these runs about the OpenLinker side was a conclusion about code from
two days earlier.

What ruled the bridge out first was replaying the same order through it by hand in six
shapes — with a buyer name, with `uwagi`, with a symbol-less shipping line, in PLN and in
EUR. All six created a ZK. Only then did the image become the obvious suspect, and
`docs/lessons.md` had the entry already: *green locally does not mean green in the image*.
It was applied to the bridge and not to OpenLinker.

The 8 430 dead rows were cleared anyway — 24 days of debris, and `sync_jobs` has no
retention sweep anywhere in the tree — but that is hygiene, not a fix.

### After the rebuild: the ZK is created, and the last link is a FIXTURE defect

Re-run against images built from the branch tip:

**`Order ol_order_eb2e… synced to destination d0361bd0… (destination order: 237, orderNumber:
ZK 46/2026)`** — `syncStatus` records `"status": "synced"` against the Subiekt connection.

So the chain runs: Subiekt towar → published to the shop → bought there → ingested by the
publishing connection with the line resolved to the Subiekt VARIANT → **a ZK in Subiekt**.
`Parametr jest niepoprawny` is gone, because `resolveTowarSymbol` now resolves a model
member's towar instead of sending the grouping key.

The document and the stock drop still do not happen, and the reason is exact: the
synthesised PrestaShop order lands in **state 8, "Payment error"** — not the state 2
("Payment accepted") the synthesiser asks for. PrestaShop reassigns it when the order total
does not reconcile with its cart. OpenLinker reads state 8 correctly as `pending` (and warns
by name that it is one of eight states carrying no flag it recognises), so the connection's
`auto-on-paid` trigger correctly does not fire. No invoice, therefore no WZ, therefore no
stock movement.

That is a defect in the ORDER SYNTHESISER, not in the chain: it builds an order the shop
refuses to mark paid. Closing it means reconciling the cart and order totals it writes, and
it is the one thing standing between this stand and the whole promise set being proven end
to end.

`an order reaches Subiekt as a ZK` still fails for Part K's original reason: the order it
builds uses the catalogue master's own driver product, which has no Subiekt mapping. The new
fixture does not change that spec — repointing it is the obvious follow-up now that a
publish-only connection exists.
