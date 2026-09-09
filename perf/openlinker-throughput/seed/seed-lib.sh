#!/usr/bin/env bash
#
# Shared helpers for the #2849 set-based seeders. Sourced by
# seed-catalogue.sh / seed-orders.sh / seed-jobs.sh / cleanup.sh - never
# executed directly. Sources the harness lib.sh (#2841) for pg_sql /
# ol_login / epoch / log / die etc. so nothing here re-implements those.
#
# Every seeded row carries the PREFIX below, so cleanup.sh can remove a
# whole generation by matching on it alone (the seed-products.sh precedent,
# perf/prestashop-baseline/seed-products.sh:7-8) - and so it can NEVER be
# mistaken for demo data or for anything stand-down.sh already knows about.
#
set -euo pipefail

SEED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SEED_DIR/../lib.sh"

PREFIX="perfseed"

# A single-session multi-statement runner, distinct from lib.sh's pg_sql /
# pg_sql_write. Both of those open a FRESH connection per call (`docker exec
# -i ... psql -c "$1"`), and setseed() (see below) is a per-SESSION call -
# it must land in the SAME connection as the INSERT that consumes random(),
# or the "recorded RNG seed" claim in the manifest would be fiction. `-f -`
# reads the whole heredoc as one script over one connection.
seed_sql() {
  # `SET statement_timeout = 0` (SESSION-scoped, not `ALTER ROLE`) is
  # prepended to every seed script, in the SAME psql invocation as the
  # caller's heredoc. Found live (#2843/#2849): `f5-read-path.sh`'s
  # `apply_statement_timeout` does `ALTER ROLE "$PG_USER" SET
  # statement_timeout = ...` to bound the API's runaway-read risk, and on
  # this lab stand the seeder connects as that SAME role (`postgres`) - so
  # the 1M order-seed's own 900k-row bulk INSERT got cancelled by the very
  # guard meant to protect the *read* path, mid-transaction, with no partial
  # rows left behind (the whole statement rolled back cleanly, so this is a
  # lost run rather than corrupt data - but a lost run all the same). A
  # session-level `SET` overrides a role-level default for JUST this
  # session and leaves the role config - and every other session under it,
  # including the api's own pool - untouched.
  { printf 'SET statement_timeout = 0;\n'; cat; } \
    | docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -tA -f - \
    || die "seed SQL failed - see psql output above"
}

# The RNG seed setseed() takes: [-1, 1]. Fixed by default so a re-run of this
# script (same GEN, same PREFIX, same seed) reproduces the identical
# distribution - #2849 AC "recording the seed is what lets a later campaign
# regenerate the identical dataset". Override with SEED_RNG=<float> to get a
# genuinely different generation.
SEED_RNG="${SEED_RNG:-0.271828}"

# Wall-clock ceiling check. Not fatal (the AC calls it "a target to tighten
# once the first real run is timed, not a promise") - logs a WARN naming the
# overrun rather than dying, since a slow-but-successful seed is still a
# seed, and the number is what the manifest/report needs, not a hard gate.
seed_check_ceiling() {
  local label="$1" elapsed_secs="$2" ceiling_secs="$3"
  if [ "$elapsed_secs" -gt "$ceiling_secs" ]; then
    warn "seed_check_ceiling: $label took ${elapsed_secs}s, over its ${ceiling_secs}s target - recorded, not fatal (#2849: 'a target to tighten once the first real run is timed, not a promise')"
  else
    log "seed_check_ceiling: $label took ${elapsed_secs}s (target <= ${ceiling_secs}s) - ok"
  fi
}

# refuse_unless_forced <what> <count_sql>
# Mirrors seed-products.sh's prefix-exists refusal verbatim (:56-67): a
# second generation under the same prefix would make cleanup counts and
# "which generation is this" both stop meaning anything. FORCE_SEED=1
# overrides, exactly as in the MySQL precedent.
refuse_unless_forced() {
  local what="$1" count_sql="$2" existing
  existing="$(pg_sql "$count_sql" 2>/dev/null || printf 0)"
  existing="${existing:-0}"
  if [ "$existing" != "0" ]; then
    if [ "${FORCE_SEED:-0}" != "1" ]; then
      die "refuse_unless_forced: $existing $what row(s) already carry the '$PREFIX' prefix. Run seed/cleanup.sh first, or FORCE_SEED=1 to add another generation anyway."
    fi
    warn "refuse_unless_forced: FORCE_SEED=1, continuing with $existing existing $what row(s)"
  fi
  printf '%s' "$existing"
}

require_connections() {
  [ -n "${PS_CONNECTION_ID:-}" ] || die "PS_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first"
  [ -n "${WC_CONNECTION_ID:-}" ] || die "WC_CONNECTION_ID not set - source stand-ids.env (bootstrap.sh) first"
}

# cleanup.sh deletes every perfseed-tagged row on the stand plus its
# PrestaShop/WooCommerce counterparts, with no dry-run and no undo. An
# operator already ran it once by accident against a live lab stand while
# testing the #3025 WooCommerce teardown block, wiping order_records/
# order_line_items (see that PR's own "Incident during verification" note) -
# with nothing between typing the command and the first DELETE. Mirrors
# refuse_unless_forced's FORCE_SEED gate: an explicit, named opt-in rather
# than a bare confirmation prompt (which a scripted/CI caller can't answer).
require_cleanup_confirmed() {
  [ "${CONFIRM_CLEANUP:-0}" = "1" ] \
    || die "cleanup.sh deletes every '${PREFIX}'-prefixed row on this stand, plus the PrestaShop/WooCommerce rows it tagged - no dry-run, no undo. Re-run with CONFIRM_CLEANUP=1 once you are sure this is the stand you mean to clear."
}

# vacuum_analyze_reset <table...> - #2849/#2843 AC: fresh planner statistics
# per size step, plus a pg_stat_statements reset so the NEXT thing measured
# (a scenario's own read-path window) is not attributing this seeder's own
# multi-row INSERTs to whatever query happens to sort to the top.
# The scenario itself resets pg_stat_statements AGAIN right before its own
# measurement window (belt and suspenders - a seeder run and the read-path
# window that follows it are not always the same invocation), so this is the
# seeder's own hygiene, not a substitute for that.
vacuum_analyze_reset() {
  local t
  for t in "$@"; do
    log "VACUUM ANALYZE $t"
    pg_sql_write "VACUUM ANALYZE $t" >/dev/null
  done
  pg_sql_write "SELECT pg_stat_statements_reset()" >/dev/null 2>&1 \
    || warn "vacuum_analyze_reset: pg_stat_statements_reset() failed - is the extension created? (CREATE EXTENSION pg_stat_statements)"
}

seed_manifest_note() {
  local dir="$1" note="$2"
  mkdir -p "$dir"
  printf '%s\n' "$note" >> "$dir/seed-manifest.jsonl"
}
