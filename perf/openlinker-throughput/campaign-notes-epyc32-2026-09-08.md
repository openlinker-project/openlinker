# Campaign notes - host `epyc32`, 2026-09-08

_Findings from the #2840 measurement campaign run on `epyc32`
(see `machine-spec-epyc32-2026-09-08.md`). Branch `perf-programme-2840`
@ `4ff884d8e`. Every finding below was hit while running the shipped
harness, not while looking for it._

**Nine findings. Five were stand defects that had to be repaired before a
number could be produced at all; three are guards that could not report a
failure; one is a product availability defect.**

| # | What | Class |
|---|---|---|
| 1 | `lib-test.sh` shipped with 1 failing assertion | test defect |
| 2 | `pg_stat_statements` preloaded but never created; seeders die on it | stand + dead fallback |
| 3 | `--smoke` leaves `sync_jobs` rows that block the strict run | harness friction |
| 4 | The stand is never paired with the PrestaShop module | stand defect |
| 5 | The documented tax SQL is incomplete; every order refused | stand defect |
| 6 | `post_guard_destination_creates` `failed` arm is unscoped | guard defect |
| 7 | F2 returned VALID having measured nothing | guard gap |
| 8 | The api DIES when Redis disappears, and no guard notices | **product + guard gap** |
| 9 | A second live session took the stand at 18:28:54 | coordination |

---

## Finding 1 - lib-test.sh had one failing assertion on the branch as shipped

`bash lib-test.sh` at 4ff884d8e: **165 passed, 1 failed**.

Failure: `omitting the feed argument leaves the verdict VALID (not applicable): expected [VALID] got [DISCARDED]` (lib-test.sh:629)

Actual discard reason:
`post_guard_containers_stable: no container baseline was captured at window_start`

Diagnosis: **test bug, not a library bug.** The `run_post_guards wiring`
block (lib-test.sh:665) calls `capture_container_starts "$RPGDIR"` first and
carries a comment saying exactly why. The newer `run_post_guards threads the
feed guard through` block omitted it, so the feed-guard assertions were
asserting against another guard's DISCARDED reason.

The library behaviour is CORRECT and must not change: a missing baseline
fails closed (lib.sh:1363-1369 says so in its own docblock).

Fix: added `capture_container_starts "$RPG_DIR"` to the feed-guard block.
-> 166 passed, 0 failed.

Both-directions verification of the guard after the fix:
- correct baseline  -> `status=VALID`
- baseline rewritten to a stale timestamp -> `status=DISCARDED ... container(s)
  restarted or recreated inside the measurement window - lab-api(...) ...`

So the patch restored the intended semantics without disabling the detector.
This is a pre-existing branch defect, host-independent.

---

## Finding 2 - the stand preloads pg_stat_statements but never CREATEs it, and the seeders die on that

`docker-compose.lab.yml` starts Postgres with
`shared_preload_libraries=pg_stat_statements,auto_explain`, but **nothing in
the repository issues `CREATE EXTENSION pg_stat_statements`** - not the
compose file, not `bootstrap.sh`, not the seeders, not
`docs/operations/perf-lab-stand.md`. Verified by grep: the only two mentions
are error strings.

On a fresh stand the extension is therefore absent from database
`openlinker`, and `SELECT pg_stat_statements_reset()` fails with
`function pg_stat_statements_reset() does not exist`.

### The dead fallback

`seed/seed-lib.sh:103` reads:

    pg_sql_write "SELECT pg_stat_statements_reset()" >/dev/null 2>&1 \
      || warn "... is the extension created? (CREATE EXTENSION pg_stat_statements)"

That `|| warn` is **dead code**. `pg_sql_write` does not return non-zero on a
failed statement - it calls `die`, which exits the script. So the intended
graceful degradation never happens; instead every seeder aborts at the very
end of `vacuum_analyze_reset`, AFTER inserting all its rows and running its
VACUUMs, but BEFORE its post-seed distribution assertions and its own
"done" log line.

Observed exactly that: `seed-catalogue.sh` exited 1 having inserted
10 000 products / 20 000 variants / 40 000 inventory_items /
40 000 identifier_mappings, with no error text in the log at all (the
`2>&1` on the failing call swallowed the message) and no distribution check
run. A reader of that log sees four VACUUM lines and then silence.

This is the "a guard that cannot report" shape one level down: the code
LOOKS like it degrades gracefully and does not.

### What was done

`CREATE EXTENSION pg_stat_statements` in database `openlinker`. This is the
correct stand configuration rather than a workaround - F5 (#2843) captures
`pg_stat_statements` top-20-by-total-time as one of its outputs, so a stand
without the extension cannot produce that half of F5's result at all.

The dead `|| warn` was left as-is: it is not on the path of any measurement
once the extension exists, and changing seeder control flow to chase it
would be a larger edit than the defect warrants. Recorded here so the next
reader does not trust it.

---

## Finding 3 - `--smoke` leaves sync_jobs rows that then block the strict run

`f3-webhook-burst.sh --smoke` ends with:

  "--smoke complete. Nothing was written under .../results."

True of the results directory, and misleading about the stand. The smoke
mode's P4 probe and its 8-request burst are ROUTABLE `order.created`
webhooks, so the durability gate commits a real `sync_jobs` row for each -
9 rows here. F3 runs with the runner DISABLED by design, so nothing ever
executes or drains them.

The next strict run then dies in pre-flight:

  FATAL guard_queue_empty: 9 queued/running sync_jobs row(s) already present
  for connection(s) ['29a98157-...']

The guard is right; the smoke mode simply leaves work behind that only a
runner could clear, and F3 is the one scenario that must not have one.

Same applies BETWEEN strict arms: every arm commits one row per accepted
unique webhook, so a second run refuses unless the rows are cleared. The
campaign's own `reset_between_repeats` does not cover this (it clears
connection cursors and `jobdedup:*` Redis keys, not `sync_jobs`).

Handled by deleting the webhook connection's queued rows before each F3
invocation - they are this scenario's own detritus on a wipeable stand,
carry no measurement value, and are created after the manifest's
`sync_jobs` start count is taken. Recorded rather than silently worked
around.

---

## Finding 4 - the stand is never paired with the PrestaShop module, so every destination order-create fails

F1's latency arm on this host: 25/25 samples `synced=NONE`, arm DISCARDED:

  DISCARDED post_guard_destination_creates: 25 order(s) carry a failed
  syncStatus entry, 25 lack syncedAt on the declared destination

The per-order `syncStatus` gives the cause verbatim:

  "error": "Failed to create PrestaShop order: Webhook secret not found for
            provider=prestashop connectionId=ccadaf52-..."
  "status": "failed"

Root cause: OpenLinker creates a destination order through the OL PrestaShop
module's HMAC-authed `importorder` endpoint (ADR-016 / #905). That needs a
SHARED secret on both sides. Neither side had one:

- OpenLinker: `integration_credentials` held exactly one
  `webhook-secret:*` ref, for the F3 webhook-ingress connection
  (created by F3 itself). Nothing for the PrestaShop connection.
- PrestaShop: `ps_configuration` has `OPENLINKER_WEBHOOK_SECRET = NULL`,
  `OPENLINKER_CONNECTION_ID = NULL`, `OPENLINKER_BASE_URL = NULL`. The
  module is installed but unpaired.

**Nothing in the stand setup performs the pairing.** Grepped for
`webhook.?secret` / `installWebhooks` / `webhooks/install` across
`bootstrap.sh`, `docs/operations/perf-lab-stand.md` and
`scenarios/f1-order-ingestion.sh`: zero hits in all three. The env fallback
(`OPENLINKER_WEBHOOK_SECRET__PRESTASHOP[__<CONNID>]`) is not in
`.env.lab.example` either.

The product route that does it is `POST /v1/connections/:id/webhooks/install`
(admin-only, `connection.controller.ts:415`).

### Why this matters for the campaign, not just for this run

This is NOT the `post_guard_destination_creates` scoping defect the campaign
already knows about. Here the CORRECTLY-scoped half fired too - 25 of 25
orders lacked `syncedAt` on the DECLARED destination. The guard is right and
the stand was broken.

It also means the first F1 run measures the wrong thing even where it does
not discard: with the secret missing, the create fails while building the
request, so the PrestaShop call never happens and the child job skips the
most expensive hop. Any throughput figure from that run describes ingestion
WITHOUT destination creation and must not be quoted as an order-throughput
number.

Remedy applied: `POST /v1/connections/<ps>/webhooks/install`, then re-run F1.

---

## Finding 5 - the documented tax-group SQL is incomplete; a group with no RULE still refuses every order

`docs/operations/perf-lab-stand.md` says a fresh PrestaShop fixture under
`PS_COUNTRY=US` carries no `ps_tax_rules_group` row, and gives:

    INSERT INTO ps_tax_rules_group (name, active, deleted, date_add, date_upd) ...
    UPDATE ps_product SET id_tax_rules_group = LAST_INSERT_ID();

Applied verbatim, that is NOT enough. The fixture has no tax rows at all:

    ps_tax                   0
    ps_tax_lang              0
    ps_tax_rule              0
    ps_tax_rules_group_shop  0

So the group exists, every product points at it, and it contains nothing.
OpenLinker's destination create then refuses the order - correctly, and with
an excellent message:

    PrestaShop product #25 (perf-allegro-a-offer-1): tax rate unknown -
    tax-rule group 1 has no usable rule. Refusing to pin PLN 11.49 gross as
    net; no order was created. Fix the tax configuration in PrestaShop,
    then retry.

Note this refusal fires with `OL_TAX_RATE_STRICT_ENABLED` unset - it is the
destination adapter refusing to invent a net price, not the ADR-063
enforcement switch.

Two further gaps the documented SQL leaves:

- `UPDATE ps_product` alone leaves `ps_product_shop.id_tax_rules_group` at 0
  for all 6 products. PrestaShop 9 keeps a shop-scoped copy and reads it in
  a shop context. `bootstrap.sh`'s own tax step (`bootstrap.sh:294-308`) is
  `ps_product`-only too, so it cannot repair this either.
- `ps_tax_rules_group_shop` is empty, so the group is not attached to shop 1.

### What was done

Completed the configuration the doc starts:

    ps_tax                   1 row   (rate 23.000, active)
    ps_tax_lang              1 row   (one per installed language)
    ps_tax_rule            241 rows  (one per ps_country, id_state=0, no zip
                                      bounds - so no buyer country can miss)
    ps_tax_rules_group_shop  1 row   (group 1 -> shop 1)
    ps_product_shop                  synced to ps_product

23% was chosen to match the campaign's own PL VAT default. **It is a stand
configuration choice, not a validated fiscal figure** - no figure in any
report here depends on the rate's value, only on a rate existing.

### Proof

`f1-order-ingestion.sh --smoke` before: hop F
`order_records written -> destination syncedAt` **n=0 (never observed)**.
After: **n=1, 3338.0 ms**, TOTAL order-pushed -> destination-syncedAt
**5827.0 ms**, and `ps_orders` gained a real row
(`mtsp6b2o7eaef6-perf-allegro-a-order-1`, total_paid 21.48, tax_excl 19.33).

Order of discovery matters and is recorded: the webhook-pairing gap
(Finding 4) MASKED this one. Only once the create request could be
authenticated did PrestaShop get far enough to reject it on tax.

---

## Finding 6 - post_guard_destination_creates: the `failed` arm is unscoped. Demonstrated, not asserted.

`lib.sh:1282-1300`. The `missing` arm correctly scopes to the declared
destination. The `failed` arm carries **no destination predicate at all**,
while both the docblock and the emitted message say "the declared
destination".

### Demonstrated in both directions

Two synthetic `order_records` rows in a far-future window (2027-01-01),
`guardprobe_a` / `guardprobe_b`, run against the SHIPPED guard one at a time
(rows since deleted):

| case | `syncStatus` | shipped guard |
|---|---|---|
| A | declared dest `synced` **with** `syncedAt`; a NON-declared dest `failed` | **DISCARDED** - "1 order(s) carry a failed syncStatus entry, **0 lack syncedAt on the declared destination**" |
| B | declared dest `failed` | DISCARDED (correct) |

Case A is the defect in one line: **0 orders lacked `syncedAt` on the
destination under test, and the run was still discarded.** A window in which
the measured destination was 100% healthy is thrown away because an
unrelated connection failed.

On this stand the WooCommerce connection fails every order it is offered
("No WC product mapping for OL product ..." - `seed-catalogue.sh` seeds
mappings, never real WC products), so any scenario that fans an order out to
it inherits a guaranteed discard.

### A candidate fix, verified red-first in all three directions

Scope the `failed` arm to the declared destination when one is declared;
keep the whole-window behaviour when none is; and `warn` about peer-destination
failures so nothing is hidden. Verified with the same two probe rows:

| direction | requirement | result |
|---|---|---|
| 1. declared destination FAILED | must still DISCARD - the detector must not be disabled | **DISCARDED** |
| 2. only a peer FAILED | must PASS, and must say so rather than hide it | **ok**, plus `WARN ... 1 order(s) failed on a destination OTHER than the declared ... - REPORTED, not discarded` |
| 3. no destination declared | must be unchanged from shipped | DISCARDED, same as shipped |

Direction 1 is the one that matters and was checked FIRST: a fix that merely
made things pass would have failed it.

One cosmetic flaw in the candidate, stated rather than hidden: in direction 3
its message still reads "on the declared destination" when none was declared.
The wording needs a conditional; the logic is right.

### NOT applied to lib.sh

Deliberately. The campaign's rule is not to tune a guard to pass, and
changing the guard partway through would leave my own runs measured against
two different guard versions. **Every verdict in every
`results-*-epyc32.md` file is from the guard exactly as shipped at
`4ff884d8e`.** The fix above is offered as a tested patch, not applied.

It also did not need to be applied: no F1 arm on this host was affected,
because F1 correctly SKIPS its WooCommerce arm on this stand (see
`results-F1-2026-09-08-epyc32.md` §5), so no non-declared destination was
ever in the fan-out. The three F1 throughput discards have a different and
unrelated cause (§4 of that report).

---

## Finding 7 - F2 returned VALID having measured nothing, because stale outbox rows silently swallowed every write

`f2-stock-propagation.sh` run 1788875917: **`verdict.txt` = `status=VALID`**,
and in the same report:

    rows with NO outbox row at all: 24 / 24
    Hop B  outbox created -> outbox delivered:        n=0 (never observed)
    Hop C  outbox delivered -> OL commits:            n=0 (never observed)
    Hop D  OL commit -> inventory_items updated:      n=0 (never observed)
    Hop E/F/G                                          n=0 (never observed)
    TOTAL  stock write -> landed in inventory_items:  n=0 (never observed)

Only Hop A reported a figure (n=24), and Hop A is `t1_ms - t0_ms` - the
duration of the harness's own PHP `StockAvailable::setQuantity()` call. It
does not depend on an outbox row existing. So **every hop this scenario
exists to measure was unobserved, and the run still certified VALID.**

That is the campaign's own stated failure mode - "a guard that cannot report
a failure passes everything" - reproduced live. `run_post_guards` asks about
attempts, deferrals, requeues, destination creates, limiter degradation,
container stability and generator saturation. **None of them asks whether the
scenario observed its own subject.** An `n=0` in every hop is not a
post-guard condition anywhere.

### Root cause (verified, not inferred)

`ps_openlinker_webhook_outbox` held **exactly 6 `stock.changed` rows, one per
product 20-25, all `status='pending'`, all with `processing_started_at IS
NULL`** - created 15:20-15:25 shop-local, which is 13:20-13:25 UTC, i.e.
during the `f1-order-ingestion.sh --smoke` runs earlier in this campaign.

The module's `OutboxRepository::enqueueEvent` derives `dedup_key` from
`(provider, connectionId, eventType, objectType, externalId)` and inserts
with `INSERT IGNORE`; the key is released only when a drainer CLAIMS the row,
not when it is delivered. F2's own report documents this mechanism. Nothing
on this stand drains the outbox on a schedule (the container's crontab is
empty and the module's `fastcgi_finish_request` fast path does not exist
under `apache2handler`), so those 6 rows sat `pending` indefinitely and
every one of F2's 24 writes collided with one and was silently dropped.

Corroboration: the table also holds **1 313 `order.created` rows, every one
`pending`** - the same never-drained backlog, produced by F1 creating real
PrestaShop orders.

### A second, smaller trap found alongside it

PrestaShop's stored timestamps run **+2 h from the container clock**
(`docker exec lab-prestashop date` -> 14:09 UTC; the row written at that
moment reads 16:09). Any comparison of an outbox `created_at` against a
harness UTC timestamp is off by the shop's timezone. F2's own CSV column is
named `outbox_created_local`, so the scenario is aware of the distinction -
but it is a live trap for anything new that queries that table.

### Remedy for the re-run

Clear the stale outbox before F2 so no dedup key is pre-held, then re-run.
The rows are undelivered webhooks belonging to earlier arms of this same
campaign on a wipeable stand; deleting them loses no measurement.

---

## Finding 8 - the API process DIES when Redis disappears, and nothing brings it back

Found while recovering the stand after F10, not by looking for it.

`lab-api` was `Exited (1)` for **3 hours**. Cause, from its own last log lines:

    SocketClosedUnexpectedlyError: Socket closed unexpectedly
        at RedisSocket._RedisSocket_onSocketError (@redis/client/dist/lib/client/socket.js:219)
    Emitted 'error' event on Commander instance at:
        at RedisSocket.<anonymous> (@redis/client/dist/lib/client/index.js:413)
    Node.js v22.23.1

An `error` event on the Redis `Commander` instance is **unhandled**, so Node
terminates the whole api process. Redis went away because F10's `I2` arm
("infrastructure: Redis drops entirely mid-window") deliberately dropped it -
so this is the fault injector doing exactly its job, and the api not
surviving it.

### Three consequences, each worse than the last

1. **The api does not come back.** No compose service in
   `docker-compose.lab.yml` declares a `restart:` policy, so a dead api stays
   dead. Redis itself was restarted by the injector and reads `Up 3 hours`;
   the api next to it read `Exited (1) 3 hours ago`.

2. **F10's own restore could not run.** The teardown reaches the api over
   HTTP, so it failed with `could not log in to restore perf-prestashop`, and
   `config.baseUrl` was left pointing at the (already deleted) fault proxy.
   F10 printed the exact repair command rather than claiming success - the
   behaviour commit `4a26691d2` ("a cleanup that logs a restore it did not
   perform") exists to guarantee.

3. **`I2` was still certified `VALID`.** `post_guard_containers_stable`
   compares each container's `{{.State.StartedAt}}` before and after the
   window. **A container that CRASHES does not change its `StartedAt`** - only
   a restart or recreate does. So a process that died mid-window and never
   returned is invisible to the one guard whose entire job is noticing that
   the stand moved under the measurement. The guard reports on RESTARTS, not
   on LIVENESS, and its name reads like the second.

   That is the campaign's own "a guard that cannot report a failure passes
   everything" shape for the third time in this run - and here it certified
   an arm whose headline subject (what happens when Redis dies) had a second,
   unreported casualty.

### The fix a future arm needs

`post_guard_containers_stable` should also assert each baselined container is
still `running`. That is a one-line addition to the same loop and would have
turned this from a 3-hour silent outage into a DISCARDED verdict naming
`lab-api`. **Not applied here** - every verdict in this campaign is from the
guard chain exactly as shipped at `4ff884d8e`, and changing a guard midway
would leave my own runs measured against two versions.

Whether the api SHOULD die on Redis loss is a product question outside this
campaign, but it is a real availability finding: OpenLinker's api has no
Redis-outage tolerance, and on a deployment without a process supervisor it
does not recover.

### Addendum found on the I3 retry - the restore verifies ONE field, not both

The successful I3 run logged:

    perf-prestashop config restored and VERIFIED (baseUrl=http://prestashop)
    perf-woocommerce enabledCapabilities restored to []

`baseUrl` is read back and verified; `enabledCapabilities` is logged as
restored without a read-back. So when the api was dead, the crashed run's
line `perf-woocommerce enabledCapabilities restored to ["OrderProcessorManager"]`
was a claim it could not have carried out - and it did not warn, unlike its
`baseUrl` sibling one line above.

Confirmed by the state left behind: `perf-woocommerce.enabledCapabilities`
read `[]` when the I3 retry started, i.e. bootstrap's
`["OrderProcessorManager"]` had been silently lost, and the retry then
faithfully "restored" that empty value as its own baseline. Two runs of
capability loss, no warning on either.

Restored by hand to bootstrap's value. Same fix class as the `baseUrl`
verify: read the field back and warn on mismatch.

### Residue left behind by F10, and why it was cleared rather than drained

After F10 the queue held 97 `queued` + 2 `running` `marketplace.order.sync`
rows, 71 of them already due, with `attempts` up to 2 - fault-injected orders
part-way up the retry ladder. Observed drain: **1 job per 45 s**, against the
~1 per 3 s the `realtime` per-scope cap of 2 and a ~6 s service time predict.

They were terminated rather than drained. Draining them would have created up
to 97 real PrestaShop orders from deliberately corrupted arms, put hours of
background load under F7/F4/F8, and measured a retry mix rather than a
scenario. Terminating is the same action `drain_wait` takes on its own
timeout.

---

## Finding 9 - a SECOND session started measuring the same stand at 18:28:54, and the guard caught it

`f7-lane-starvation.sh` refused to start:

    FATAL guard_stand_exclusive: the stand is already being measured by
    [f1-order-ingestion:pid1313605@silksh-...:2026-09-08T18:28:52Z]

That is not my process. It runs from a DIFFERENT checkout of the repo:

    /home/norbert.kulus/ol-perf-f1f2/perf/openlinker-throughput/scenarios/f1-order-ingestion.sh --latency-only

and it re-execs itself - observed pids 1313605 (parent, `ppid=1`), 1324388
(its child) and 1360413 appearing ~2 minutes apart, so it is a loop rather
than a single run.

### Scope of the contamination - bounded, and my results are outside it

| | |
|---|---|
| Peer checkout created | **2026-09-08 18:28:54** (`stat` on the directory) |
| Peer's own first result | 18:29 (`.../results/f1-order-ingestion/`), log at 18:31 |
| **Latest `generatedAt` across ALL my manifests** | **2026-09-08T18:08:21Z** |
| Peer writing into my results tree? | **no** - `find -newermt '18:26'` over my tree returns nothing |

So every measurement in this campaign - F3 (11:39-12:35), F5 (12:35-12:45),
F1 (13:22-13:51), F2 (14:10-14:13), the catalogue-pull probe (14:16-14:23),
F10's 12 arms (14:31-15:51) and F10 `I3` (18:08-18:25) - completed **at least
20 minutes before the peer existed**. None of the published figures is
affected, and this is verified from the artefacts rather than assumed from
memory.

### What the guard bought

`guard_stand_exclusive` is the reason F7 produced no numbers instead of
producing wrong ones. It is the one guard in this campaign that prevented a
bad measurement rather than discarding one afterwards, and it fired on its
first real occasion.

### One thing I did that touched the peer's work, stated plainly

At 18:33 I terminated 105 `queued`/`running` `sync_jobs` rows, believing them
to be F10 residue. Some of them were almost certainly the peer session's -
its arms push 12 orders each on the same `perf-allegro-a` connection, and the
queue's failure to drain (1 job per 45 s) is better explained by two sessions
contending for one `realtime` per-scope cap of 2 than by retry backoff alone.
That was a destructive action against another session's in-flight work, taken
without knowing the session existed. It is recorded here rather than
discovered later from a confusing peer log.

### Consequence for the remaining scenarios

F7, F4 (`--scale worker=3`), F8 and the sustained run cannot run while the
peer holds the lock - correctly. F4 in particular would rescale the shared
`worker` service out from under the peer, and F8 WRITES a lane cap into
`.env.lab` and recreates the worker. Proceeding is not a measurement question
but a coordination one, so it stops here for a decision.

---

## Observation carried alongside - connection create enqueues a sync it cannot run


On a fresh stand, `bootstrap.sh` creates five connections. Two of them
(`perf-woocommerce`, `perf-webhook-ingress`) do NOT have `ProductMaster`
enabled, yet each received a `master.product.syncAll` job at creation:

  master.product.syncAll failed: Connection <id> has capability ProductMaster
  disabled (adapter ...)

Each had reached `attempts=4` and was still `queued` with a future
`nextRunAt`, i.e. climbing the retry ladder toward `maxAttempts=10` (~30h
with 6h backoff cap). Two consequences for a measurement stand:

1. `guard_queue_empty` refuses every scenario while they exist - correctly.
2. They wake the worker periodically inside otherwise-quiet windows.

They were marked `dead` before measurement (the same terminal action
`drain_wait` takes on its own timeout). This is stand cleanup of our own
rows, not a change to any guard or to product code.

Whether `enqueueInitialCatalogSync` should be gated on the connection
actually having `ProductMaster` is a product question outside this
campaign's scope; recorded here because it is a real, reproducible
behaviour a first-run operator will also hit.

Separately, both Allegro connections' `destination.taxonomy.sync` jobs died
immediately on `Allegro API error (404): http://allegro-stub:8080/sale/categories`
- the stub implements the two order-ingestion endpoints only. These are
terminal (`dead`), so they do not block `guard_queue_empty`.
