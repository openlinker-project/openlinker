# Pre-registration - re-measurement on the merged epic (2026-09-09)

Written **before** any window of this run was opened or any `verdict.txt` of it
read. Tree: `1f9a52d1b` (epic `perf-programme-2840`, #3022 merged).
Images rebuilt from that sha with `--build-arg OL_GIT_SHA`.
Host: 28 logical CPUs, 15 GiB RAM, WSL2.

Times are stated with an explicit `Z`.

## Why this run exists

Tonight's figures were taken across at least four tree states while eleven PRs
merged underneath them, and the guard chain itself changed. No coherent set
exists. This run produces one: one tree, one image, one guard chain.

## The headline question, and a correction to how it was framed

The brief states the headline as: the campaign's standing claim is that **no
throughput window ever reached `VALID`**, `post_guard_destination_creates` has
since been repaired, and *"whether they now pass is the headline of this run"*.

Reading the repaired guard against the scenarios that call it changes which
scenario can answer that. `post_guard_destination_creates` takes the
destination connection id as `run_post_guards`' **sixth** argument, and scopes
its `failed` and `missing` arms to it only when that argument is non-empty.
Otherwise it takes an `else` branch that leaves `failed` unscoped ("any
destination") and hardcodes `missing=0`.

Call sites on this tree:

| Scenario | 6th arg | Scoping fix bites? |
|---|---|---|
| `f1-order-ingestion` | `$dest` / `$PS_CONNECTION_ID` / `$WC_CONNECTION_ID` | **yes** |
| `f2-stock-propagation` | `""` | no - unscoped arm, `missing=0` |
| `f3-webhook-burst` (both windows) | `""` | no - unscoped arm, `missing=0` |
| `f5-read-path` | does not call `run_post_guards` | n/a |
| `f10-dependency-failure` | custom subset of six guards | to be read per arm |

## Pre-registered predictions

**P1.** A verdict can move from `DISCARDED` to `VALID` *because of the scoping
fix* only in `f1-order-ingestion`. For `f2` and `f3` the scoping half of the
fix is unreachable; only the fail-closed half (`as_count`) applies, and that
half can only ever move a verdict **toward** `DISCARDED`, never away from it.

**P2.** Therefore, if `f3` or `f2` reaches `VALID` in this run, the cause is
NOT the guard repair and must not be reported as such. The candidate causes are
the merged product changes or a quieter host, and separating those is out of
this run's reach - it will be recorded as unexplained rather than attributed.

**P3.** `post_guard_limiter_degraded` is unaffected by #2853's log rewording.
Verified offline before the run: the guard greps the literal phrase
`falling back to per-process in-memory limiting`, which survives inside the new
`rate_limiter_degraded_entered ...` message. It counts degraded-mode **entry**
events only; neither the still-degraded nor the recovered line contains the
phrase. The guard does **not** use #2853's stable token, which is a latent
fragility recorded here and deliberately NOT changed mid-run: altering a
guard's predicate during a re-measurement makes the result incomparable with
what it is being compared against.

**P4.** `f5-read-path` cannot produce a `VALID`/`DISCARDED` throughput verdict
at all, since it does not call `run_post_guards`. Its figures are read-path
latencies and will be labelled at the dataset actually present
(`order_records` 2 012 333), not reseeded to match an earlier figure.

## Acceptance criteria

1. Every window's `verdict.txt` is read before any figure from it is quoted.
2. Every figure is labelled **measured**, **derived** or **extrapolated**.
3. Each flow reports whether the **figure** moved and whether the **verdict**
   moved, as two separate answers.
4. A scenario that observed nothing (`n=0` on every hop) is reported as having
   measured nothing, whatever its verdict says. No guard asks this question, so
   it is asked by hand per flow.
5. No cause is published for anything this run did not isolate.
6. Container uptime per measured container is promoted from `.container-starts`
   into the report.

## Prerequisites already met

- `bash -n` clean on `lib.sh` and all five scenario scripts.
- `bash lib-test.sh` = **226 passed, 0 failed** - the figure the brief
  pre-registered, so there is no deviation to explain.
- Dataset matches the brief exactly and was NOT reseeded: `order_records`
  2 012 333, `products` 60 006, `sync_jobs` 164 917.
- `.env.lab` secrets verified byte-identical to the running stand's
  `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY` and `JWT_SECRET`, so the api can
  decrypt the connection credentials it already holds.

## What happened to the previous attempt

The earlier re-measurement was launched at ~01:45 local on 2026-09-09 and
never opened a window. Its session was **OOM-killed**; `lab-mysql` was killed
in the same memory-pressure episode (docker `FinishedAt`
2026-09-09T00:24:03Z, exit 137). The host was concurrently running a full
`vitest` suite at load average 186 on 28 CPUs. The only artefacts that attempt
produced are two `status=SUPERSEDED` retractions of earlier runs, which stand.

## Instrument defect found during setup, before the first window opened

Found 2026-09-09T06:18Z; this run's first window opened 2026-09-09T06:22:27Z.

`lib.sh:121` defaults `OL_API_URL` to `http://127.0.0.1:13000`. The `lab`
stand publishes its api on **19000** (`API_HOST_PORT=19000` in `.env.lab`,
and the compose default at `docker-compose.lab.yml:422` is also 19000).
`127.0.0.1:13000` is held by a **different OpenLinker instance** -
`ol-demo-fresh-api`, with its own database - and has been for two days.

So a scenario run without an explicit `OL_API_URL` export drives its
control-plane calls against the demo stack. Observed directly: the F3 attempt
at 06:18:25Z was answered
`404 {"message":"Connection not found: c9f4c835-...","error":"Not Found"}`
by the demo api, for a connection this run had already confirmed present and
`active` in the lab database. This run therefore exports
`OL_API_URL=http://127.0.0.1:19000` explicitly.

**Bounded claim - this does NOT invalidate earlier results.** Every
`ol_api`/`ol_login` call site dies on failure; none tolerates one
(`grep` over `lib.sh` and all scenarios finds no `|| true`, `|| printf` or
`2>/dev/null` on an `ol_api` line). A scenario pointed at the wrong api dies
at `ol_login` or at its first `enqueue_perf_job` and cannot produce a window
that reads valid. The k6 load itself is unaffected either way - it addresses
`api:3000` inside the docker network, not the host port.

**What cannot be audited.** No manifest records the api endpoint the run
drove - `manifest_gather_environment` captures container log limits and
container limits but not `OL_API_URL`. So whether any earlier run used 13000
or 19000 is not recoverable from the artefacts, only bounded by the
fail-closed argument above. Recording it belongs with the brief's own
"record what shaped a run" item.

Not fixed in this run's tree: changing a default mid-measurement is the same
class of act as changing a guard predicate mid-measurement. It is written up
here and left for a follow-up.
