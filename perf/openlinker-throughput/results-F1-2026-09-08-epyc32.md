# F1 - order ingestion latency and throughput

_Run 2026-09-08 on the `lab` stand, host **`epyc32`** (see
`machine-spec-epyc32-2026-09-08.md` - 32 threads, 122 GiB, KVM guest).
Scenario `scenarios/f1-order-ingestion.sh` (#2847, epic #2840), unmodified.
Branch `perf-programme-2840` @ `4ff884d8e`. Dataset: **1 000 000 pre-seeded
`order_records`** from the F5 dataset - the same fixed dataset size the
reference host's F1 used._

> **VERDICT STATUS - read before quoting anything below.**
> The **latency** arm is `VALID`.
> All three **throughput** arms are `DISCARDED`, every one of them on the
> same single-order artefact described in §4. Their figures are reported
> here WITH that label attached to each, never without it.

---

## 0. This measures a stand that had to be repaired first

The first strict F1 run on this host discarded all four arms with
**25/25, 274/900, 294/900 and 900/900 orders failing at the destination**.
Two independent stand defects, each masking the next:

1. **No webhook pairing.** OpenLinker creates the destination order through
   the OL PrestaShop module's HMAC-authed `importorder` endpoint, which needs
   a shared secret. Neither side had one, and nothing in `bootstrap.sh`, the
   ops runbook or the scenario provisions it. Fixed with
   `POST /v1/connections/:id/webhooks/install` (after setting
   `config.openlinkerCallbackBaseUrl`).
2. **A tax-rules group containing no rule.** The runbook's documented SQL
   creates the group and points products at it, but the fixture has zero
   `ps_tax`, `ps_tax_lang`, `ps_tax_rule` and `ps_tax_rules_group_shop` rows,
   so OpenLinker refused every order rather than invent a net price.

Full detail, evidence and remedies: `campaign-notes-epyc32-2026-09-08.md`,
Findings 4 and 5. **Every figure in this file is from the repaired stand.**

---

## 1. Latency - one order, idle system (arm `latency`, `VALID`)

25 serial samples, real PrestaShop destination. **All 25 reached a
destination create.** All values **measured**, milliseconds.

| hop | what it spans | n | p50 | p95 | max |
|---|---|---:|---:|---:|---:|
| A | order pushed at stub -> poll enqueued | 25 | 31.4 | 35.4 | 38.0 |
| B | poll enqueued -> poll claimed | 25 | 726.3 | 786.2 | 791.5 |
| C | poll claimed -> child enqueued | 25 | 288.3 | 299.6 | 311.6 |
| D | child enqueued -> child claimed | 25 | 721.1 | 723.8 | 1 754.8 |
| E | child claimed -> `order_records` written | 25 | 1 139.0 | 1 151.0 | 1 153.0 |
| **F** | **`order_records` written -> destination `syncedAt`** | 25 | **2 875.0** | 2 914.0 | 2 927.0 |
| G | child claimed -> child terminal | 25 | 4 020.6 | 4 061.4 | 4 085.9 |
| **TOTAL** | order pushed -> destination `syncedAt` | 25 | **5 799.0** | 5 870.0 | 6 789.0 |

**An order takes 5.80 s end to end on an idle system**, and the single
biggest hop is the destination create (F, 2.88 s = 50% of the total). The
two queue-pickup hops (B + D) cost 1.45 s together - that is the runner's
1 s poll interval showing up twice, once for the poll job and once for its
child.

Hop A is **harness-chosen** (the scenario says so itself) - it is the
harness's own push-to-enqueue step, not a marketplace's delivery latency.

Both documented reconstruction caveats came back **zero** on this run, so
neither bites: 0 of 25 child jobs ran >= 180 s (no `lockedAt` heartbeat
rewrite could have been mistaken for a claim instant), and 0 of 25 took more
than one attempt.

## 2. Throughput - and exactly what binds it

Each arm offers a **900-order backlog** and measures a **~295 s window**.
All three arms are `DISCARDED` (§4).

Service time is the **mean `lastAttemptDurationMs` over succeeded
`marketplace.order.sync` rows inside that arm's own window** - deliberately
NOT the summary's p50, which spans requeued partial attempts and would
understate it. Each arm's row count matches its completed-order count
exactly (97 / 270 / 900), and every row had a non-null duration and exactly
one attempt.

| arm | destination rate limit | realtime lane cap | orders in window | **sustained rate** | **service time (mean)** | queue grew? |
|---|---|---|---:|---:|---:|---|
| `throughput-baseline` | 60/min, 4 concurrent (manifest default) | 4 / 2 | 97 / 295 s | **1 184 orders/h** | **5 539.4 ms** (n=97) | YES |
| `throughput-destination-raised` | 6 000/min, 32 concurrent | 4 / 2 | 270 / 296 s | **3 284 orders/h** | **2 002.4 ms** (n=270) | YES |
| `throughput-lane-raised` | 6 000/min, 32 concurrent | **16 / 16** | 900 / 294 s | **>= 11 020 orders/h** | **3 121.3 ms** (n=900) | **NO - drained** |

All **measured**. The ladder answers "what binds":

1. **At stock settings the destination's own rate limit binds.** 60/min with
   4 concurrent inflates per-order service time to 5.54 s. 1 184 orders/h.
2. **Raise that and the realtime lane cap binds.** Service time drops 2.8x to
   2.00 s - so the limiter really was the cost - but throughput only rises
   2.8x to 3 284/h, because 2 per-scope slots is now the constraint.
3. **Raise both and the offered load runs out.** The 900-order backlog
   drained inside the window, so 11 020 orders/h is a **FLOOR, not a
   ceiling** - the scenario's own summary says so ("the sustained rate above
   is a FLOOR on the ceiling, not the knee. Offer more ... and re-run").

### The arithmetic corroborates arms 1 and 2, and correctly refuses arm 3

`perScope slots / service time` is **derived**, never observed. Set against
the measured rates:

| arm | perScope | service (s) | arithmetic orders/h | observed orders/h | observed / arithmetic |
|---|---:|---:|---:|---:|---:|
| baseline | 2 | 5.5394 | 1 300 | 1 184 | 91% |
| destination-raised | 2 | 2.0024 | 3 596 | 3 284 | 91% |
| lane-raised | 16 | 3.1213 | 18 454 | 11 020 | 60% |

The two knee arms land at the same 91% of their slot arithmetic - the
missing 9% is the gap between a slot freeing and the next claim (the 1 s
poll). The drained arm lands at 60% precisely BECAUSE it ran out of work,
which is what a floor looks like. **18 454 orders/h is not a result** - it is
what the arithmetic would predict if the system had been kept saturated, and
no window here saturated it.

## 3. What the destination costs, and why arm 3's service time went back up

Arm 2's 2.00 s service time is the cheapest per-order figure here. Arm 3
raised the lane cap to 16 and service time rose to 3.12 s - the per-order
cost grows once 16 orders are in flight against one PrestaShop. That is real
contention at the destination, not measurement noise: min stayed at 1 892 ms
(an uncontended order still costs the same) while p95 went 2 081 -> 3 977 ms.

Stub upstream request counts over each window (**measured**), which show the
poll pump is not the cost:

| arm | `GET /order/checkout-forms/:id` | `GET /order/events` |
|---|---:|---:|
| baseline | 100 | 30 |
| destination-raised | 276 | 30 |
| lane-raised | 900 | 30 |

One checkout-form fetch per order, 30 event polls regardless - the source
side scales exactly with orders and nothing else.

## 4. Why all three throughput arms are DISCARDED, and why the data still stands

Every one carries the identical reason:

    DISCARDED post_guard_destination_creates:
      0 order(s) carry a failed syncStatus entry,
      1 lack syncedAt on the declared destination

**Zero failures. One order without a `syncedAt` yet.**

`post_guard_destination_creates` filters `WHERE "createdAt" >= window_start`
with **no upper bound**, and runs the instant the fixed 295 s window closes -
while the last order pushed into that window is still completing its
destination create (which §1 measures at 2.88 s). So it counts one order
that had not finished yet.

Verified post-hoc, across all three windows together:

```
orders created since the first throughput window start : 1283
  still lacking a PrestaShop syncedAt                  :    0
  carrying any failed syncStatus entry                 :    0
```

So the runs are DISCARDED on a **timing artefact of the guard, not a product
failure**, and the throughput figures describe windows in which every order
did eventually reach the destination. That is why they are reported - with
the discard stated at every point of use, per the campaign's own rule that a
figure whose only evidence is a discarded run must say so.

**This is NOT the known unscoped-`failed`-arm defect** (§5). Here the
correctly-scoped half fired, and it fired on a real, if transient, absence.

## 5. The WooCommerce arm did not run, and was not silently skipped

    SKIPPING the WooCommerce arm: the stand carries 10000 WooCommerce Product
    mappings and NONE of them names a numeric WC product id, so no order can
    resolve a line item there. ... Reported as not-run rather than
    run-and-discarded.

`seed-catalogue.sh` seeds mappings, never real WooCommerce products. The
scenario detects this and refuses the arm rather than producing a window of
guaranteed failures. Consequently **no order in any measured arm fanned out
to WooCommerce** - verified directly: of the 93 orders in the latency arm's
window, 0 carried a WooCommerce `syncStatus` entry and 0 carried any failure.

That also means the campaign's known `post_guard_destination_creates`
scoping defect (its `failed` arm carries no destination predicate while its
message says "the declared destination") **did not affect any F1 run on this
host** - there was no non-declared destination failing to trigger it. The
defect is real in the SQL and is reported in
`campaign-notes-epyc32-2026-09-08.md`, Finding 6, with a both-directions
demonstration; it simply did not bite here.

## 6. What this run did NOT establish

- **A ceiling.** No arm saturated the system with the lane cap raised. The
  honest upper figure is ">= 11 020 orders/h", and the next run needs a
  deeper backlog than 900 or a faster poll cadence.
- **Whether 16/16 is the right lane cap.** Arm 3 shows service time rising
  under it; where the knee sits between 2 and 16 is F8's question, not this
  one's.
- **Any WooCommerce destination figure.** §5.
- **Repeat agreement.** One run per arm.
- **Real marketplace latency.** The source is the local Allegro stub at its
  configured p50s (events 276 ms, checkout 1 106 ms), not Allegro.
- **Multi-replica behaviour.** Single worker replica throughout.
