#!/usr/bin/env bash
#
# Set-based sync_jobs history seeder (#2849). ~1 year of sweep-CHILD job
# history at real cadence - 'master.product.syncFromSweep' every 20 min and
# 'master.inventory.syncFromSweep' every 15 min per connection
# (docs/architecture-overview.md § Sync Manager - the cadence #2218/#2219
# actually run at), across the two connections the lab stand carries.
#
# Independent of order-dataset size on purpose: the sweep-child job types are
# catalogue-driven, not order-driven (they exist whether or not a single
# order was ever ingested), so this seeder is called ONCE, not once per
# order-side dataset size step. #2843's read-path routes that read
# sync_jobs (the jobs dashboard, GET /connections/:id/sync-status) are
# exercised against this history at every order-size step without re-seeding
# it.
#
# Usage: ./seed-jobs.sh   (DAYS=365 default)
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/seed-lib.sh"
LIB_LOG_PREFIX="seed-jobs"

DAYS="${DAYS:-365}"
GEN="${SEED_GEN:-1}"
CEILING_SECS="${CEILING_SECS:-180}"

require_connections
refuse_unless_forced "sync_jobs" "SELECT COUNT(*) FROM sync_jobs WHERE \"idempotencyKey\" LIKE '${PREFIX}:g%'" >/dev/null

log "seeding ~${DAYS}d of sweep-child sync_jobs history (gen=$GEN, rng=$SEED_RNG) for connections $PS_CONNECTION_ID / $WC_CONNECTION_ID"
START="$(epoch)"

# Ticks are minutes-since-window-start; 20-min and 15-min cadences are both
# exact divisors of 60, so `WHERE tick % N = 0` over a per-minute series
# reproduces the real schedule without a second generate_series per job type.
seed_sql <<SQL
BEGIN;
SELECT setseed($SEED_RNG);

CREATE TEMP TABLE perfseed_ticks AS
SELECT t AS tick, now() - (($DAYS * 24 * 60 - t) || ' minutes')::interval AS at
FROM generate_series(0, $DAYS * 24 * 60) AS t;

CREATE TEMP TABLE perfseed_job_conns (id text, tag text) ON COMMIT DROP;
INSERT INTO perfseed_job_conns VALUES ('${PS_CONNECTION_ID}', 'ps'), ('${WC_CONNECTION_ID}', 'wc');

-- master.product.syncFromSweep - every 20 minutes.
INSERT INTO sync_jobs (id, "jobType", "connectionId", "payloadJson", status, "idempotencyKey",
                        attempts, "maxAttempts", "nextRunAt", "createdAt", "updatedAt",
                        outcome, "outcomeReason", "lastAttemptDurationMs")
SELECT
  gen_random_uuid(),
  'master.product.syncFromSweep',
  c.id::uuid,
  jsonb_build_object('cycleId', 'perfseed-cycle-' || (t.tick / 20), 'externalIds', jsonb_build_array()),
  'succeeded',
  '${PREFIX}:g${GEN}:product-sweep:' || c.tag || ':' || t.tick,
  CASE WHEN random() < 0.03 THEN 1 ELSE 0 END,
  3,
  t.at, t.at, t.at,
  CASE WHEN random() < 0.03 THEN 'business_failure' ELSE 'ok' END,
  CASE WHEN random() < 0.01 THEN 'master_deleted' ELSE NULL END,
  (200 + (random() * 2500))::int
FROM perfseed_ticks t
CROSS JOIN perfseed_job_conns c
WHERE t.tick % 20 = 0;

-- master.inventory.syncFromSweep - every 15 minutes.
INSERT INTO sync_jobs (id, "jobType", "connectionId", "payloadJson", status, "idempotencyKey",
                        attempts, "maxAttempts", "nextRunAt", "createdAt", "updatedAt",
                        outcome, "outcomeReason", "lastAttemptDurationMs")
SELECT
  gen_random_uuid(),
  'master.inventory.syncFromSweep',
  c.id::uuid,
  jsonb_build_object('cycleId', 'perfseed-cycle-' || (t.tick / 15), 'externalIds', jsonb_build_array()),
  'succeeded',
  '${PREFIX}:g${GEN}:inventory-sweep:' || c.tag || ':' || t.tick,
  CASE WHEN random() < 0.03 THEN 1 ELSE 0 END,
  3,
  t.at, t.at, t.at,
  CASE WHEN random() < 0.02 THEN 'business_failure' ELSE 'ok' END,
  NULL,
  (150 + (random() * 1800))::int
FROM perfseed_ticks t
CROSS JOIN perfseed_job_conns c
WHERE t.tick % 15 = 0;

-- A thin dead-letter tail (~1 per connection per week), since a jobs
-- dashboard filtered to status='dead' is one of the routes this
-- programme measures (README "nav probes" / #2843 route list) and a
-- history with literally zero dead rows would measure an index-only
-- scan an operator's real dashboard never gets to see.
INSERT INTO sync_jobs (id, "jobType", "connectionId", "payloadJson", status, "idempotencyKey",
                        attempts, "maxAttempts", "nextRunAt", "createdAt", "updatedAt",
                        outcome, "lastError")
SELECT
  gen_random_uuid(),
  'master.product.syncByExternalId',
  c.id::uuid,
  jsonb_build_object('externalId', 'perfseed-dead-' || t.tick),
  'dead',
  '${PREFIX}:g${GEN}:dead:' || c.tag || ':' || t.tick,
  3, 3,
  t.at, t.at, t.at,
  NULL,
  'perfseed synthetic dead row (simulated permanent platform rejection)'
FROM perfseed_ticks t
CROSS JOIN perfseed_job_conns c
WHERE t.tick % (7 * 24 * 60) = 0;

COMMIT;
SQL

ELAPSED=$(( $(epoch) - START ))
seed_check_ceiling "sync_jobs (${DAYS}d sweep history)" "$ELAPSED" "$CEILING_SECS"

vacuum_analyze_reset sync_jobs

N="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"idempotencyKey\" LIKE '${PREFIX}:g${GEN}:%'")"
N_DEAD="$(pg_sql "SELECT COUNT(*) FROM sync_jobs WHERE \"idempotencyKey\" LIKE '${PREFIX}:g${GEN}:%' AND status='dead'")"
log "seed-jobs done in ${ELAPSED}s: sync_jobs=$N (dead=$N_DEAD) rng_seed=$SEED_RNG days=$DAYS"
