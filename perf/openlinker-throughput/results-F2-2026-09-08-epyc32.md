# F2 - stock propagation latency

_Run 2026-09-08 on the `lab` stand, host **`epyc32`** (see
`machine-spec-epyc32-2026-09-08.md` - 32 threads, 122 GiB, KVM guest).
Scenario `scenarios/f2-stock-propagation.sh` (#2848 lineage, epic #2840),
unmodified. Branch `perf-programme-2840` @ `4ff884d8e`. Run group
`run1788876647`, `status=VALID`. The scenario's own full report is preserved
verbatim as `results-F2-2026-09-08-epyc32-scenario.md`._

> The FIRST F2 run on this host (`run1788875917`) also returned `VALID` and
> measured **nothing** - every hop `n=0`. That is a finding in its own right,
> not a footnote: see §5 and `campaign-notes-epyc32-2026-09-08.md` Finding 7.
> The numbers below are from the second run, after the cause was removed.

---

## 1. Headline

6 products x 4 cycles = **24 stock-write cycles, 0 swallowed**, all 24
`master.inventory.syncByExternalId` jobs `succeeded`. All **measured**, ms.

| chain | n | p50 | p95 | max |
|---|---:|---:|---:|---:|
| stock write -> landed in OL's own `inventory_items` | 24 | **824** | 1 239 | 1 757 |
| stock write -> `marketplace.offerQuantity.update` child **enqueued** | 24 | **1 804** | 2 199 | 2 206 |
| stock write -> that child **answered** (stub ACCEPT) | 24 | **2 946** | 3 339 | 3 345 |

**A stock change reaches OpenLinker's own record in 0.82 s and is dispatched
toward the marketplace in 1.80 s** on this host, EXCLUDING the shop's own
outbox-delivery cadence (§3 - this is the load-bearing caveat).

## 2. Per hop

| hop | spans | n | p50 | p95 |
|---|---|---:|---:|---:|
| A | `setQuantity()` -> outbox row inserted (same PHP call) | 24 | 72 | 91 |
| B | outbox created -> outbox delivered | 24 | **-251** | 200 |
| C | outbox delivered -> OL commits the #2280 gate | 24 | 470 | 862 |
| D | OL commit -> `inventory_items` updated | 24 | 550 | 934 |
| E | `inventory_items` updated -> propagate job enqueued | 24 | 0 | 7 |
| F | propagate enqueued -> `offerQuantity.update` child enqueued | 24 | 973 | 985 |
| G | child enqueued -> child terminal (stub round-trip) | 24 | 1 140 | 1 148 |

Two hops deserve reading rather than quoting:

- **Hop B's p50 is NEGATIVE (-251 ms)**, i.e. the delivered timestamp precedes
  the created one. It is not a fast hop; it is not a hop at all on this stand
  (§3). The reference host's own F2 reported the same sign and magnitude
  (`p50=-302 ms`), so this is a systematic artefact of comparing two clocks,
  reproducible across machines - not a local fluke. It must never be quoted
  as "delivery is instant".
- **Hops E is ~0 and F is ~973 ms.** The propagate job is enqueued the instant
  the inventory row is written, then waits for the runner's next 1 s poll.
  Hop F is the poll interval, not work. Same for most of Hop G (1 140 ms =
  the stub's 120 ms configured latency plus another poll pickup).

So of the 1 804 ms to dispatch, roughly **1 s is queue-pickup latency from
the runner's fixed 1 s poll**, and only ~0.8 s is work.

## 3. What is EXCLUDED, and why the total is not a "shop to marketplace" figure

The scenario force-drains the shop's outbox after every write by calling the
module's cron controller directly. On this stand nothing else ever would:
the container's crontab is empty, and the module's response-flush fast path
(#2624) cannot fire because the SAPI is `apache2handler`/mod_php, where
`fastcgi_finish_request()` does not exist.

**So hop B is excluded by construction.** In a real deployment shaped like
this one, hop B is bounded below by whatever cron interval the operator
configures - commonly minutes. To build a real end-to-end figure from this
report: take A + C + D + E (+ F + G for the marketplace dispatch) and **add
your own PrestaShop cron interval**, which will dominate everything else here.
Behind php-fpm the fast path fires and hop B collapses toward zero instead.

Hop G is a real HTTP round-trip, but against the local Allegro **stub**, whose
latency for `PUT /sale/offer-quantity-change-commands/{id}` has no measured
sandbox basis (it uses the stub's 120 ms default). It establishes that OL
submitted the write and got a definitive ACCEPT - never that Allegro's
catalogue updated. Per #2621 the terminal-status poll is a separate job this
scenario does not exercise.

## 4. Amplification

- One webhook event per stock-changed **product** (the module always attributes
  to the product id), one `master.inventory.syncByExternalId` job per event.
- `inventory_items` rows touched per event: **1 to 3** (1 for the simple
  products, up to the combination count for products 22/23/24).
- `offerQuantity.update` children per event: **exactly 2** - one per Allegro
  connection, never 36. The enqueue idempotency key omits the target offer id,
  so the 18 synthetic offer mappings per variant collapse onto one enqueue per
  connection. That collapse is an artefact of reusing F1's seed data, not a
  defect (one variant : one live offer per connection is the guarded norm,
  #1837).

## 5. The first run certified VALID while measuring nothing

`run1788875917`: `status=VALID`, and `rows with NO outbox row at all: 24/24`,
with hops B through G all `n=0 (never observed)`.

Cause: `ps_openlinker_webhook_outbox` held 6 stale `pending` `stock.changed`
rows - one per product 20-25 - left by an earlier `f1 --smoke` run. The
module's `dedup_key` is `(provider, connectionId, eventType, objectType,
externalId)` inserted with `INSERT IGNORE`, and the key is released only when
a drainer CLAIMS the row. Nothing drains this stand on a schedule, so those 6
rows silently swallowed all 24 writes. (The same table held 1 313 equally
undelivered `order.created` rows from F1.)

**No post-guard in `lib.sh` asks whether a scenario observed its own
subject**, so `n=0` in every hop is not a discard condition. Clearing the
outbox before the re-run produced 0/24 swallowed. This is the one place in
this campaign where a VALID verdict had to be rejected on inspection rather
than trusted.

## 6. What this run did NOT establish

- **A production shop-to-OpenLinker latency.** Hop B is excluded (§3) and is
  the dominant term in any real deployment on this image.
- **A real marketplace write latency.** Hop G is a stub with an unmeasured
  latency for the endpoint used, and never observes Allegro's own
  asynchronous application of the change.
- **Anything about the located-position (#2324/#2325) shapes.** PrestaShop
  reports no location for any of these products, so every position is pooled
  by construction; the scenario says so rather than implying coverage.
- **Behaviour under load.** 24 serial cycles on an otherwise idle stand. Hop F
  and much of Hop G are queue-pickup latency, which is exactly the term that
  changes under contention.
- **Repeat agreement.** One measured run (the first produced no data).
