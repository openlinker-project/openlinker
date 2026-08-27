# Spike finding - #2612: is a shop-side stock change log worth building

**Issue**: #2612 (child of epic #2590)
**Date**: 2026-08-27
**Type**: spike. No implementation was merged under this issue.
**Verdict**: **Do not build it.** Build the narrower thing described in the last section instead.

## The question

`ps_stock_available` has no timestamp column of any kind. The Webservice therefore cannot
answer "what stock changed since X", so every stock sweep reads the whole catalogue. A
shop-side change log - a table the module writes on every stock mutation, that OpenLinker
polls with a cursor - is the only capability a PHP module offers that the Webservice can
never match.

The issue asks three things. How much of the stock cycle stays painful once the catalogue
cycle is minutes rather than hours. Whether three-layer capture is affordable. How the
`seq` visibility gap is handled.

## Finding 1 - the push half already exists and already works

This is the finding that decides the spike. The module already captures stock changes and
already delivers them, end to end, and has since before this epic.

| Step | Where |
|---|---|
| Hook registered on install | `apps/prestashop-module/openlinker/openlinker.php:126` (`actionUpdateQuantity`) |
| Handler enqueues to the outbox | `openlinker.php:1595`, event type `stock.changed` at `:1646` |
| Durable outbox row | `openlinker_webhook_outbox`, DDL at `openlinker.php:717` |
| Claimed and delivered by cron | `controllers/front/cron.php:79` via `OutboxRepository::claimBatchDueForDelivery` |
| Decoded on the OpenLinker side | `prestashop-webhook-event-translator.adapter.ts:38` - `stock` maps to domain `inventory` |
| Routed to a job | `inbound-routing-policy.service.ts:164` - `master.inventory.syncByExternalId`, gated on `InventoryMaster` |
| Stock read back per product | `prestashop-inventory-master.adapter.ts:95` (`listInventory`) |

Stock events are on by default: install sets `ENABLE_STOCK_EVENTS` to 1
(`openlinker.php:1170`).

So the premise "we have no incremental stock path" is false. We have one. It is a push
path rather than a pull path, and it has known defects, but every defect is already filed
as a sibling of this epic. None of them is fixed by adding a second capture mechanism.

The event id is keyed on the product id, not the combination id
(`openlinker.php:1650`, "always use product ID"). The combination id rides in the payload
and is ignored downstream. That looks like a bug and is not. The OpenLinker side re-reads
every stock row for the product, so coalescing several combination changes of one product
into one event is correct and cheaper. A change log keyed per row would deliver three
events where the outbox delivers one, and all three would trigger the same read.

## Finding 2 - the Webservice-write gap is real, verified, and does not matter

The issue's premise is correct. I verified it against real PrestaShop source, extracted
from the `prestashop/prestashop:9.0.2-2.0-classic-8.4` image.

- `actionUpdateQuantity` is fired from exactly two places:
  `StockAvailable::setQuantity()` (`classes/stock/StockAvailable.php:454`) and
  `StockManager::updateQuantity()` (`src/Core/Stock/StockManager.php:189`).
- The Webservice write path is different. `stock_availables` declares
  `objectMethods.update => updateWs` (`StockAvailable.php:103`), and `updateWs()` just
  calls `$this->update()` (`:110`), which calls `parent::update()` and `postSave()`
  (`:314`). `ObjectModel::update()` fires `actionObjectStockAvailableUpdateAfter`
  (`classes/ObjectModel.php:801`) and never `actionUpdateQuantity`.

So a Webservice PUT on a stock row is invisible to the hook we register. That is the gap.

It does not matter, for one reason: **the only thing that writes stock over the Webservice
is us.** `PrestashopProductPublisherAdapter` does it at
`prestashop-product-publisher.adapter.ts:301`. A shop where a third party writes stock
through the Webservice is possible but is not a shape we have seen, and if it appeared, the
periodic sweep already covers it.

There is also a partial accident in our favour. On a product with combinations, a
Webservice write on a combination row runs `postSave()`, which calls
`setQuantity(id_product, 0, total)` to refresh the aggregate row
(`StockAvailable.php:358`), and that call *does* fire `actionUpdateQuantity`. So a
Webservice combination write already produces a `stock.changed` event today, by side
effect. A simple product does not - `postSave()` returns early when
`id_product_attribute == 0` (`:336`).

## Finding 3 - the feedback loop is already contained, and the containment is fragile

The epic warns that registering the generic `actionObject*` hook closes a feedback loop
across every product. The loop does not close today, and the reason is worth writing down
because it is the thing a future change could break.

Two independent gates stop it:

1. The inbound routing gate requires `InventoryMaster` on the connection
   (`inbound-routing-policy.service.ts:167`). A publish-only PrestaShop destination has no
   `InventoryMaster`, so its stock events are dropped as ungated.
2. The propagation fan-out excludes any connection carrying `InventoryMaster` from being a
   write-back target (`inventory-propagate-to-marketplaces.handler.ts:183`, described in
   the code as "the authoritative runtime authority guard").

Together those mean no single connection can be both the writer and the reader. Break
either one and the loop closes across the whole catalogue.

The amplification is worse than one event per write. With both hooks registered, one
Webservice PUT on a combination row produces: one
`actionObjectStockAvailableUpdateAfter` on the combination, then `postSave()` fires
`actionUpdateQuantity` plus a second `actionObjectStockAvailableUpdateAfter` on the
aggregate row. Three captures for one write. The outbox dedup window collapses them today,
which is only true while the window survives - and #2603 removes it.

## Finding 4 - what is left to save, in numbers

The epic's measurements bound this. Requests per SKU went from 7.96 to 3.97. A 100-product
tick went from 977 s to 471 s. With `OL_LANE_REALTIME_SCOPE_CAP` raised, throughput reached
~277 req/min at a p95 store-impact ratio of 0.995, which puts the full catalogue at ~2.4 h
instead of 26.5 h. #2593 measured the bulk product read at 3 requests, 0.38 s and 1.33 MB
for 100 fully-hydrated products, and adds a paged `stock_availables` read in the same
change.

Take the epic's own test shape: 10 000 products with 3 variants each. That is 30 000
combination rows plus 10 000 aggregate rows, 40 000 rows of stock. A paged
`stock_availables` read at 1 000 rows per page is about 40 requests for a complete
whole-catalogue stock snapshot. Today the same information costs one read per product,
so about 10 000 requests.

A change log would replace those ~40 requests with about 1 per poll. So the saving the
change log buys, measured against the state of the code *after* #2593 lands, is roughly
39 requests per stock cycle. At a five-minute cadence that is ~470 requests per hour
against a shop that was measured at 0.989x idle under a far heavier load. That is the whole
prize.

It is also the wrong comparison, because the outbox already means the sweep is not how a
stock change reaches us. The sweep is the backstop. A change log would make the backstop
cheaper. It would not make anything faster, because the push path is already immediate.

## Finding 5 - the `seq` visibility gap, and why it disappears

The issue asks how we would handle it. An `AUTO_INCREMENT` value is assigned at insert and
becomes visible at commit, so a reader that polls `WHERE seq > lastSeen` and advances its
cursor to the highest value it saw will permanently skip any row that was inserted with a
lower value by a transaction that had not yet committed. Under concurrent order placement
that is not rare, and the loss is silent.

The three usual remedies all cost something. A safety lag (only read rows older than N
seconds) trades latency for correctness and needs N larger than the longest write
transaction, which nobody can bound on a shop we do not run. A commit-time timestamp
watermark with overlap needs a timestamp column, which is the thing `ps_stock_available`
does not have and which the log would have to add anyway. A table lock around insert puts
our module in the critical path of every sale.

The existing outbox does not have this problem at all, and that is not luck. It uses a
claim-and-lease model rather than a cursor: `claimBatchDueForDelivery`
(`OutboxRepository.php:270`) atomically stamps rows as `processing` with a run id and then
selects only what it stamped. A row that becomes visible late is simply claimed by the next
run. Nobody reads a monotonic sequence, so nothing can be skipped by one.

Choosing a pull cursor over the existing push claim would reintroduce a solved problem.

## Cost, including retention and reconciliation

If we built it anyway:

- **Hook registration plus the loop fix as one indivisible change.** Registering
  `actionObjectStockAvailableUpdateAfter` alone is not shippable, per Finding 3. The change
  must also carry an origin marker so a write we made ourselves is not captured, and the
  marker has to survive a Webservice request that our own process did not open. That is the
  largest and riskiest single item of the original module design and it has not got smaller.
- **A second table with the same retention problem the outbox already has.** #2604 records
  that the outbox has no `DELETE` anywhere and grows without bound on every install that
  has the module today. A change log written on every sale grows faster than the outbox
  does. It needs pruning and a hard cap from the first commit, not later.
- **A reconciliation pass we still cannot delete.** A change log never lets the periodic
  full read go away, for the same reason the outbox does not: a lost row is indistinguishable
  from no change. #2593's paged stock read is that pass, so we would be paying for both.
- **A new authenticated read endpoint on the shop.** The epic explicitly cut ten endpoints
  of the original design and recorded them so they do not return. A `/stock/changes` cursor
  endpoint is one of them coming back through a different door.
- **A visibility hazard we do not have today**, per Finding 5.
- **Real hosting makes it worse, not better.** #2618 found OVH cron granularity of one
  hour, file-based cron on home.pl and AZ.pl where arguments cannot be passed, and
  `cron.prestashop.com` returning HTTP 200 while doing nothing since December 2025. A pull
  log needs OpenLinker to reach into the shop on a schedule we control, which sidesteps that
  - but the shop-side capture still depends on the same PHP the outbox depends on, so the
  hosting risk does not go away, it just moves.

## Recommendation

**Do not build a stock change log.** The incremental stock path it was meant to create
already exists as the outbox. What is actually broken is that path's reliability, and every
one of those defects is already filed:

- #2603 - dedup collides with delivered rows and silently drops stock events. This is the
  real incremental-stock bug. At a one-minute cron with a five-minute window roughly 80% of
  stock events are discarded with no log and no error.
- #2604 - the outbox never deletes anything.
- #2614 - backoff has no reset on recovery and no jitter.
- #2624 - the response is not flushed before draining the outbox.
- #2618 - cron delivery does not work on common Polish hosting.
- #2593 - the paged `stock_availables` read, which makes the backstop cheap.

Fixing #2603 alone recovers more stock events than a change log would ever add, and costs
one file. A change log built on top of an outbox that silently drops 80% of its rows would
inherit the same delivery path and the same defect.

### The narrower thing worth doing

Two items, both small, both inside the existing mechanism:

1. **Register `actionObjectStockAvailableUpdateAfter` for simple products only, behind the
   origin marker.** This closes the one genuine capture gap - a Webservice stock write on a
   product with no combinations, which today produces no event at all because `postSave()`
   returns early. Multi-variant products are already covered by the `postSave()` side
   effect described in Finding 2. Restricting to `id_product_attribute == 0` also removes
   the three-captures-per-write amplification, because the aggregate row is the only thing
   captured. This is still not shippable without the origin marker, and it is still one
   indivisible change.
2. **Make the sweep's stock read the honest backstop it claims to be.** That is #2593, and
   it needs no new PHP.

## Kill condition, stated the other way round

I am recommending against, so the useful statement is what would change the answer:

- **The outbox proves unfixable on real hosting.** If, after #2618 and #2624, a material
  share of shops still cannot run delivery often enough - hourly OVH cron with no pinger
  available, say - then push is not viable and a pull log becomes the only mechanism. That
  is a hosting finding, not a performance one, and it should be measured by #2625.
- **The measured stock cycle after #2593 exceeds the freshness a seller needs.** If the
  paged stock read plus the raised lane cap still leaves a whole-catalogue stock cycle above
  roughly 15 minutes on the 10 000 x 3 shape, the backstop is too slow to cover a dropped
  event and the log earns its cost. If it lands in single-digit minutes, as the 40-request
  estimate suggests, it does not.
- **A third party starts writing stock over the Webservice.** Today only we do. If a shop
  runs another integration writing `stock_availables`, the capture gap in Finding 2 becomes
  a real correctness hole and the generic hook stops being optional.
- **Store impact stops being 0.989x idle.** Every number here rests on the shop not caring.
  If a larger catalogue or slower hosting moves p95 materially above 1.0 under the post-#2593
  sweep, request count becomes worth buying down and the log is one way to buy it.

## For the epic to note

Two things surfaced that are not covered by an existing sibling issue. Neither is filed and
neither is in this spike's scope:

1. **The loop containment is undocumented and load-bearing.** The two gates in Finding 3
   are the only thing keeping a stock feedback loop closed across the whole catalogue, they
   live in two different files in two different packages, and neither one says it is half of
   a pair. The `InventoryMaster` exclusion in the propagation handler has a comment; the
   routing gate does not. A future change that gives a publish-only PrestaShop connection
   `InventoryMaster` for an unrelated reason closes the loop with no test failing.
2. **A Webservice stock write on a simple product produces no event, on a multi-variant
   product produces one by accident.** That asymmetry is undocumented and is the narrower
   fix recommended above.
