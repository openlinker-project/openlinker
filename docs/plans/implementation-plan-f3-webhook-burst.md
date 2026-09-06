# Implementation plan - F3: webhook ingress burst throughput (#2842)

Child of epic #2840. Stacked on #2841 (PR #2918), which supplies `perf/openlinker-throughput/lib.sh`.

---

## 1. Understand the task

**Goal.** Measure what `POST /webhooks/:provider/:connectionId` can absorb under a sustained arrival-rate burst, and what happens at the durability gate when the same `eventId` arrives many times at once.

**Layer.** DX / harness only. No product change: the measured surface is `apps/api/src/webhooks/**` and it is not edited.

**Why this scenario first.** It needs no upstream stub, no seeded catalogue and no auth handshake - a signed POST loop. So it exercises #2841's whole arrange / guard / window / sample / post-guard / verdict machinery end to end at the lowest cost. If the harness abstraction is wrong, it surfaces here rather than after four more scenarios are built on it.

**Explicit non-goals.**

- Not a correctness test. The gate's correctness is already covered by integration tests.
- Not a security test. The route is unthrottled and `webhook_auth_rejections` is append-only and reachable unauthenticated - both are recorded as findings, neither is exploited or fixed here.
- Not the epic's publishable F3 figure. See § 6.

---

## 2. Research findings

Everything below was read out of the tree or probed live on the local stand; nothing is assumed.

### 2.1 The request path, stage by stage

`WebhookService.processWebhook` (`apps/api/src/webhooks/application/services/webhook.service.ts`) in order:

| # | Step | Cost |
|---|---|---|
| 1 | `decoderRegistry.get(provider)` | in-memory |
| 2 | `authService.assertConnectionUsable` (`:93`) | 1 Postgres read of `connections` |
| 3 | `decoder.detectHandshake?.()` | absent on the default decoder |
| 4 | `authService.getSecret` (`:111`) | credential resolve + decrypt |
| 5 | `decoder.verify` | HMAC-SHA256 over `${ts}.${rawBody}`, CPU |
| 6 | `validateTimestampMs` | arithmetic |
| 7 | `decoder.extractEnvelope` | JSON parse + shape check |
| 8 | `inboundRouting.resolveEvent` (`:168`) | adapter metadata + translator + capability gate |
| 9 | `dedupService.markProcessing` | 1 Redis call, best-effort |
| 10 | **gate transaction** `jobGate.insertDeliveryWithJob` | 1 or 2 INSERTs in ONE Postgres transaction |
| 11 | `dedupService.markDone` | 1 Redis call, best-effort |

The AC requires a stage breakdown, not a sentence claiming one stage dominates.

### 2.2 The skew window is symmetric

`WebhookAuthService.validateTimestampMs` computes `Math.abs(Date.now() - timestampMs) > skewWindowMs`. So a timestamp up to `OL_WEBHOOK_SKEW_WINDOW_MS` (default 120 000 ms) **in the future** is accepted. This is what makes a pre-signed pool with several timestamp generations legal rather than a hack.

### 2.3 The default decoder has no `ignore` path

`DefaultWebhookDecoder.extractEnvelope` returns only `reject` (`:77`, `:87`) or `route` (`:95`). So `action === 'ignore'` is unreachable for an OL-HMAC provider, and the differential ladder in § 4.4 is built from the four states that *are* reachable.

### 2.4 The gate cannot produce a transaction-conflict rate

`webhook-job-gate.repository.ts` uses `INSERT ... ON CONFLICT DO NOTHING` at READ COMMITTED for both rows. A duplicate produces neither a serialization failure nor a rollback. The observable signals are the four the issue names: duplicate-ack count, `pg_stat_activity.wait_event` tuple-lock waits, `pg_stat_database.deadlocks`, and gate-transaction duration.

### 2.5 `perf-prestashop` cannot route an order event - this is the trap the issue names

`bootstrap.sh` (#2860) seeds `perf-prestashop` with `enabledCapabilities: ["ProductMaster","InventoryMaster","OrderProcessorManager"]`. The `order` domain gates on **`OrderSource`**, which is absent, so `InboundRoutingPolicy.resolve` answers `ungated`, the delivery is written `deadlettered` and **no `sync_jobs` row is created**.

Measured against that connection, the AC "rows/s into `sync_jobs`" would be structurally zero and the run would silently measure a one-insert transaction. F3 therefore seeds its **own** connection (§ 4.1), which also keeps it off the operator's.

### 2.6 The signer already exists and is importable

`apps/e2e/src/support/webhooks.ts` reproduces the OL-HMAC scheme byte-for-byte. Probed live: `node --experimental-strip-types` imports it directly from a `.mjs` script and produces a signature, because the file uses only erasable TypeScript syntax and imports nothing but `node:crypto`.

```
$ node --experimental-strip-types /tmp/probe-strip.mjs
{"headers":{"X-OpenLinker-Timestamp":"1700000000000",
 "X-OpenLinker-Signature":"sha256=874db3ba...c84c"},"bodyLen":220}
```

Host Node is v22.14.0; the images run 22.23.1, where stripping is on by default and the flag is still accepted. If that file ever gains non-erasable syntax the pre-signer breaks loudly, which is the point of importing rather than copying.

### 2.7 `pg_stat_statements` is available but not loaded

On the stand: `pg_available_extensions` lists `pg_stat_statements 1.11`, and `SHOW shared_preload_libraries` is **empty**. Enabling it needs a Postgres restart, which is a stand change and belongs to #2854. The scenario therefore uses it when present and reports its absence when not - never silently.

### 2.8 k6 and the network

k6 is not on `PATH` and no image was present. `grafana/k6:1.0.0` pulled successfully. The api container sits on the `ol-demo-fresh_default` bridge network and publishes `127.0.0.1:13000`.

Local quirk worth recording: `~/.docker/config.json` sets `credsStore: desktop.exe`, whose helper fails, so `docker pull` errors with `error getting credentials`. `DOCKER_CONFIG=/tmp/docker-anon docker pull ...` works. This is a workstation issue, not a stand requirement.

---

## 3. Design

### 3.1 Two processes, and k6 computes no HMAC at all

The issue asks for two things that look separate and are in fact one design:

- signing must **reuse** `apps/e2e/src/support/webhooks.ts`, not restate the scheme in k6;
- k6 must **not** contend with the api for CPU signing HMACs during the window, because the stand pins no CPUs.

A Node pre-signer that imports the real signer and writes a pool of fully-signed requests satisfies both: k6 replays bytes and never calls `crypto`. The generator's per-request cost during the window is an array index and a string, not an HMAC.

```
presign-webhooks.mjs   (node, host)      -> pool.json
       imports apps/e2e/src/support/webhooks.ts  [the real scheme]

webhook-burst.js       (k6, container)   <- pool.json via open()
       replays pre-signed bodies + headers, ramping-arrival-rate
```

### 3.2 Generations keep the pool inside the skew window

Each pool entry belongs to a **generation** `g`, signed with `timestampMs = windowStartMs + g * GEN_INTERVAL_MS` (default 60 000). k6 picks its generation from elapsed run time. Because the window is symmetric (§ 2.2), generation `g` is legal from `windowStart + (g-2)*60s` to `windowStart + (g+2)*60s`, so a 60 s stride sits comfortably inside 120 s of slack on both sides.

The pre-signer refuses to build a pool whose last generation would fall outside the window given the configured duration, rather than producing requests that 401 mid-run.

### 3.3 Three arms, never one number

| Arm | eventId supply | What it isolates |
|---|---|---|
| `unique` | fresh id per request | headline ingress throughput, no index contention |
| `replay-committed` | ids already committed by `unique` | pure unique-index probe, lock-free duplicate path |
| `replay-concurrent` | a small pool of ids fired simultaneously | every waiter serializes on ONE index tuple |

`replay-committed` and `replay-concurrent` are reported separately and never averaged: one is lock-free, the other fully serialized. `replay-concurrent` additionally watches for the failure the issue names - with `OL_DB_POOL_MAX = 40`, enough concurrent same-id requests can occupy the whole pool waiting on one tuple, at which point p99 measures pool exhaustion rather than the gate. The report says which it measured, using the tuple-lock-wait and gate-duration numbers to tell them apart.

### 3.4 Stage breakdown by differential probing - no product change

Four probe classes reach four different depths of § 2.1. Each is a small sequential probe (not part of the burst), and the deltas are the stages:

| Probe | Request | Stops after | HTTP |
|---|---|---|---|
| `P1 auth-fail` | valid envelope, wrong signature | 2, 4, 5 (+1 auth-rejection upsert) | 401 |
| `P2 decode-reject` | valid signature over a non-envelope body | + 7 | 400 |
| `P3 unroutable` | valid `product.updated` envelope (connection has no `ProductMaster`) | + 8, 9, 10-delivery-row-only, 11 | 202 |
| `P4 routed` | valid `order.created` envelope | full path, delivery + `sync_jobs` | 202 |

- `P2` is the baseline for connection read + secret resolve + verify + decode. It is the baseline rather than `P1` because `P1` additionally writes an auth-rejection row.
- `P3 - P2` = routing + two Redis calls + the delivery INSERT.
- `P4 - P3` = the `sync_jobs` INSERT inside the same transaction.
- `P1` is reported on its own as the unauthenticated cost, which is also the attack surface the issue flags.

Where `pg_stat_statements` is loaded, its per-statement totals are captured across the window as a second, independent view. Where it is not, the report says so and carries the differential breakdown alone.

### 3.5 Postgres-side sampling

Alongside #2841's `sampler_start` / `sampler_stop`, a second sampler polls during the window:

- `pg_stat_activity` filtered to `wait_event_type = 'Lock'` / `'LWLock'`, counting `wait_event` occurrences - this is the tuple-lock evidence;
- `pg_stat_database.deadlocks` as a before/after delta;
- `pg_stat_activity` connection count against `OL_DB_POOL_MAX`, so pool exhaustion is visible rather than inferred.

### 3.6 Runner posture

`WORKER_RUNNER_ENABLED=false`, declared and asserted by `guard_runner_state disabled`. The gate commits real executable `sync_jobs` rows; with the runner on, a burst of N routable webhooks becomes N `marketplace.order.sync` jobs executing against the same Postgres inside the measurement window, and `guard_queue_empty` cannot see it because the run generates it.

`guard_runner_state disabled` deliberately does **not** require the lane-caps startup line (verified in `lib.sh:365-388`), so the two halves are consistent.

An `enabled` posture is a legitimate second experiment - ingress plus induced execution load - but it is a different measurement and is out of scope here.

---

## 4. Step-by-step implementation

### 4.1 Seed a routable connection - `bootstrap.sh`

Add a fifth connection to `step_connections`:

```
perf-webhook-ingress   platformType: prestashop
                       enabledCapabilities: ["OrderSource"]
                       config: { baseUrl: <stand PS>, shopId: 1 }
```

`OrderSource` alone is what makes an `order.*` event routable (§ 2.5) while leaving `product.*` ungated, which is exactly what probe `P3` needs. Export `WEBHOOK_CONNECTION_ID` in `stand-ids.env`.

This edits a file that PR #2918 also touches. #2842 is stacked on that branch, so the diff is clean against the stack tip; the PR body says so.

**Acceptance:** `bootstrap.sh --verify-only` reports the connection; a signed `order.created` POST to it yields `webhook_deliveries.status = 'job_enqueued'`.

### 4.2 Rotate and hold the webhook secret - `scenarios/f3-webhook-burst.sh`

`POST /connections/:id/webhooks/secret/rotate` returns the plaintext once. Because the connection is F3's own and points at no live shop, rotation damages nothing and no `install` restore is owed - unlike the e2e suite's situation, which `apps/e2e/src/support/webhook-secret.ts` documents at length. The scenario states that in a comment so the difference is deliberate rather than an oversight.

**Acceptance:** the secret is never written to the results directory or the manifest.

### 4.3 Pre-signer - `drivers/presign-webhooks.mjs`

Node script, run on the host with `--experimental-strip-types`. Inputs: connection id, secret, arm, request count, window start, generation stride, payload size. Output: `pool.json` with `{ generations: [ { timestampMs, entries: [ { body, signature } ] } ] }`.

- imports `signWebhook` / `computeOlHmacSignature` from `apps/e2e/src/support/webhooks.ts` - never restates the scheme;
- refuses to emit a pool whose last generation falls outside the skew window;
- pads `payload` to a configured byte size, recorded in the manifest.

**Acceptance:** a unit-ish self-check asserts that a pool entry, replayed verbatim, is accepted by the live API (one real POST), so a silent signing drift cannot pass.

### 4.4 k6 driver - `drivers/webhook-burst.js`

- `ramping-arrival-rate`, never `ramping-vus`;
- `open()`s the pool at init, replays bytes;
- `check()`s status and tags it; non-2xx is counted in its own metric and excluded from the reported percentiles;
- custom trend per arm so the three arms never share a bucket.

**Acceptance:** a dry 5-second run at a trivial rate produces a JSON summary with the expected metric names.

### 4.5 Scenario - `scenarios/f3-webhook-burst.sh`

Sources `lib.sh` and contains **no** copy of login, guard, manifest, sampler or verdict logic. Order:

1. `require_tools`, plus a k6 image check
2. every #2841 pre-flight guard, with `guard_runner_state disabled`
3. probe: assert `webhook_deliveries.status = 'job_enqueued'` for one routed event, or abort
4. record `webhook_deliveries` starting row count into the manifest
5. `P1`-`P4` differential probes, sequential
6. `window_start` -> arm `unique` -> `window_stop`
7. arms `replay-committed`, `replay-concurrent`, each with `reset_between_repeats`
8. pg sampler across each window
9. `run_post_guards`, `verdict_write`
10. write the dated report

**Acceptance:** runs unattended; a non-2xx rate above 0.5 % writes `DISCARDED`.

### 4.6 Report - `results/results-F3-<date>.md`

Standard results contract: figures labelled measured / derived, percentiles with their within-run `n`, a stage breakdown table, both replay arms separately, and a *"What this did not establish"* section.

---

## 5. Validation

| Rule | How this plan satisfies it |
|---|---|
| No product change | Only `perf/` and one connection row; `apps/api/src/webhooks/**` untouched |
| No copy of harness logic | Scenario sources `lib.sh`; AC-checked by grep in self-review |
| Signer reused | `presign-webhooks.mjs` imports the e2e module; a live POST proves it |
| Non-2xx excluded | Separate k6 metric + a 0.5 % `DISCARDED` threshold |
| Percentiles carry `n` | k6 summary reports count per trend; the report prints it beside each figure |
| Guards run | `run_post_guards` + every pre-flight from `lib.sh` |
| Secrets | The rotated secret stays in shell locals; never in the manifest or the report |

---

## 6. The honest limit of this PR

**#2854, the isolated lab stand, does not exist yet.** The only stand available is the shared local demo stack, which declares no `cpuset`, no `cpus` and no `deploy.resources` limit, and which currently shares a host with a second full OpenLinker stack.

Worse, the workstation stand **cannot pass the guards**, and that was verified rather than assumed:

```
$ docker exec ol-demo-fresh-worker printenv OL_SCHEDULER_ENABLED
(unset -> defaults true)    -> guard_scheduler_off dies: a cron could fire mid-window
$ docker inspect ol-demo-fresh-api --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
(no label)                  -> guard_build would die: image predates the LABEL
$ docker exec ol-demo-fresh-worker printenv WORKER_RUNNER_ENABLED
(unset -> defaults enabled) -> guard_runner_state disabled would die
```

**Correction to this plan, found by running it.** An earlier draft of this section predicted `guard_build` as the abort point. It is not: `guard_scheduler_off` runs earlier in the guard order, so that is the one the script actually trips, and the run never reaches the other two. Their failure was re-confirmed by direct inspection instead. The plan's claim - this stand cannot pass the guards - holds; the predicted abort point was wrong and is corrected here rather than left standing.

All three refusals are the guards working. Making them pass would mean rebuilding the shared demo stack's images from this branch and restarting its worker with the runner off - mutating a stack the user relies on, for a number that still could not be published because the host is contended and pins no CPUs.

So this PR delivers **the rig, and does not claim an F3 figure**:

- **The strict scenario stays strict.** No skip flag, no override. On this workstation it aborts at `guard_build`, and the report records that abort as evidence the guard chain works.
- **A `--smoke` mode proves the moving parts**, and is deliberately incapable of producing a measurement: it runs the pre-signer, fires the four differential probes and a short low-rate burst against the live API, and **writes nothing into `results/`** - no manifest, no verdict, no dated report. It is a driver self-test, labelled as one.
- **Each piece is proved individually**: a pre-signed entry replayed verbatim is accepted by the live API (proving the signer reuse), `P1`-`P4` return 401 / 400 / 202-deadlettered / 202-job_enqueued (proving the differential ladder reaches four distinct depths), and k6 emits the expected metric names.

The publishable figure is taken on #2854's stand by re-running the same unmodified scenario. Calling a workstation number "F3" would be exactly the trap #2840 lists: a figure whose conditions cannot be reproduced, quoted as though they could.
