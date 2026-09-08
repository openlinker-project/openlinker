#!/usr/bin/env bash
#
# Summarizer for scenarios/sustained-mixed-load.sh (#2983, epic #2840).
#
# Reads the two CSVs the scenario wrote and prints the figures a soak is
# commissioned to produce: the queue-depth curve and whether it converged,
# memory and Postgres backends over time, the achieved order rate per phase,
# and the observed-vs-extrapolated limiter degradation.
#
# ---------------------------------------------------------------------------
# WHY THIS IS A SEPARATE SCRIPT, AND WHY IT IS SHELL
# ---------------------------------------------------------------------------
# It runs AFTER the window, so its own cost cannot contaminate a measurement,
# and being separate means a run whose numbers need re-reading does not have
# to be repeated - the CSVs are the record. Shell + awk rather than python
# because it reads two flat CSVs by column and needs no JSON parsing of the
# quoted blobs; #2930 records python's `csv.DictReader` silently truncating
# this file's `docker_stats_json` column at its first internal comma, and the
# safest response is not to parse that column here at all. Memory is read
# from `docker stats` at the point of use instead.
#
# ---------------------------------------------------------------------------
# THE ONE JUDGEMENT THIS SCRIPT MAKES, AND ITS LIMIT
# ---------------------------------------------------------------------------
# "Did the queue converge?" is answered from a least-squares slope over the
# LAST THIRD of the samples, not from the endpoints. An endpoint comparison
# cannot tell a plateau from a peak, and the last third is where a plateau
# would be if there were one.
#
# The verdict has exactly three values and the third is the honest one:
#
#   converging   slope is negative beyond noise - the queue is draining
#   plateau      |slope| is inside the noise band - depth is bounded
#   growing      slope is positive beyond noise - unbounded at this rate
#
# It NEVER reports a steady state from a rising curve. The commissioning task
# names this as the specific dishonesty a long run must avoid: if the queue
# was still growing when the window closed, the run ended before it
# converged, and the last sample is not an equilibrium.
#
# Usage: mixed-summarize.sh <results_dir> <window_start_iso> <src_conn> <dst_conn> <pushed_total>
#
set -euo pipefail

DIR="${1:?results dir required}"
WS_ISO="${2:?window start iso required}"
SRC_CONN="${3:?source connection id required}"
DST_CONN="${4:?destination connection id required}"
PUSHED="${5:-0}"

SUPP="$DIR/mixed-timeseries.csv"
PUSHES="$DIR/pushes.csv"
[ -f "$SUPP" ] || { echo "mixed-summarize: $SUPP not found"; exit 1; }

PG_CONTAINER="${PG_CONTAINER:-lab-postgres}"
PG_DB="${PG_DB:-openlinker}"
PG_USER="${PG_USER:-postgres}"

# Local copy rather than sourcing lib.sh: this script is run as a child of the
# scenario, which already holds the stand lock and has an EXIT trap installed -
# sourcing lib.sh here would install a second one in the child.
pg() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "$1"; }

# Same, but tab-separated columns instead of one hand-concatenated string.
#
# Concatenating inside the SELECT list looked tidier and is wrong the moment a
# GROUP BY is involved: `SELECT a || COUNT(*) ... GROUP BY 1` groups by the
# whole expression, which now contains an aggregate, and Postgres refuses with
# "aggregate functions are not allowed in GROUP BY". Found by running this
# summarizer against a synthetic results directory before a four-hour window
# depended on it - the failure would otherwise have surfaced after the
# measurement, with the CSVs intact but the report step broken.
pgcols() { docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -F$'\t' -c "$1"; }

hr() { printf '%s\n' '---------------------------------------------------------------------------'; }

# Column indices, resolved from the header by NAME rather than hardcoded, so a
# column added to the scenario's CSV cannot silently shift every figure here.
col() {
  awk -F, -v want="$1" 'NR==1 {for(i=1;i<=NF;i++) if ($i==want) {print i; exit}}' "$SUPP"
}
C_ELAPSED="$(col elapsed)"
C_PHASE="$(col phase)"
C_QDUE="$(col g_queued_due)"
C_QDEF="$(col g_queued_deferred)"
C_RUN="$(col g_running)"
C_DEAD="$(col g_dead)"
C_OSQ="$(col ord_sync_queued)"
C_OSS="$(col ord_sync_succeeded)"
C_ING="$(col orders_ingested)"
C_BE="$(col pg_backends)"
C_BEA="$(col pg_backends_active)"
C_MAXC="$(col pg_max_conn)"
C_DEG="$(col limiter_degraded_delta)"
for v in C_ELAPSED C_PHASE C_QDUE C_QDEF C_RUN C_DEAD C_OSQ C_OSS C_ING C_BE C_BEA C_MAXC C_DEG; do
  [ -n "${!v}" ] || { echo "mixed-summarize: could not resolve column for $v from $SUPP header"; exit 1; }
done

NSAMPLES="$(awk 'NR>1' "$SUPP" | wc -l | tr -d ' ')"
ELAPSED="$(awk -F, -v c="$C_ELAPSED" 'NR>1 {v=$c} END {print v+0}' "$SUPP")"

echo
hr
echo "SUSTAINED MIXED LOAD - summary"
hr
printf 'window start (UTC)      %s\n' "$WS_ISO"
printf 'window length           %ss (%.2f h)\n' "$ELAPSED" "$(awk -v e="$ELAPSED" 'BEGIN{printf "%.2f", e/3600}')"
printf 'samples                 %s\n' "$NSAMPLES"
printf 'orders pushed to stub   %s\n' "$PUSHED"

# --- 1. Queue depth curve -------------------------------------------------
hr
echo "1. QUEUE DEPTH (install-wide, all connections; DUE rows only)"
echo "   A 'queued' row whose nextRunAt is in the future is backing off on its"
echo "   own schedule and is not queue depth - it is reported separately."
hr
# The curve rule lives in ONE place - drivers/queue-curve.awk - and is
# exercised by drivers/queue-curve-test.sh against three synthetic curves
# whose right answers are known by construction. An inline copy here is
# exactly the shape `perf/prestashop-baseline` grew seven times, one of them
# wrong in a way nobody noticed until a results file reported the wrong
# offset (lib.sh's own header records it).
CURVE_AWK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/queue-curve.awk"
[ -f "$CURVE_AWK" ] || { echo "mixed-summarize: $CURVE_AWK not found"; exit 1; }
CURVE="$(awk -F, -v ce="$C_ELAPSED" -v cq="$C_QDUE" -f "$CURVE_AWK" "$SUPP")"
cv() { awk -F= -v k="$1" '$1==k {print $2; exit}' <<< "$CURVE"; }

CV_VERDICT="$(cv verdict)"
printf '   samples used / dropped         : %s / %s\n' "$(cv n)" "$(cv dropped)"
if [ "$CV_VERDICT" = "insufficient-samples" ]; then
  printf '   verdict                        : INSUFFICIENT SAMPLES (floor %s)\n' "$(cv min_samples)"
else
  printf '   depth first / min / max / last : %s / %s / %s / %s\n' "$(cv first)" "$(cv min)" "$(cv max)" "$(cv last)"
  printf '   deferred (backing off) at end  : %s\n' \
    "$(awk -F, -v c="$C_QDEF" 'END{print $c}' "$SUPP")"
  printf '   running at end                 : %s\n' \
    "$(awk -F, -v c="$C_RUN" 'END{print $c}' "$SUPP")"
  printf '   overall slope                  : %s jobs/h (least squares)\n' "$(cv overall_slope_per_h)"
  printf '   last-third slope               : %s jobs/h (n=%s over %ss)\n' \
    "$(cv tail_slope_per_h)" "$(cv tail_n)" "$(cv tail_span_s)"
  printf '   noise band (+/-)               : %s jobs/h (sd=%s)\n' "$(cv noise_band_per_h)" "$(cv tail_sd)"
  case "$CV_VERDICT" in
    growing)
      echo "   verdict                        : GROWING - unbounded at this offered rate"
      echo "   NOTE: the window ENDED BEFORE THE QUEUE CONVERGED. The last sample"
      echo "         is not an equilibrium and must not be quoted as one." ;;
    converging) echo "   verdict                        : CONVERGING - draining" ;;
    plateau)    echo "   verdict                        : PLATEAU - bounded at this offered rate" ;;
    *)          printf '   verdict                        : UNRECOGNISED [%s]\n' "$CV_VERDICT" ;;
  esac
fi

echo
echo "   curve (every ~10th sample): elapsed_s  due  deferred  running"
awk -F, -v ce="$C_ELAPSED" -v cq="$C_QDUE" -v cd="$C_QDEF" -v cr="$C_RUN" '
  NR>1 { n++; if (n % 10 == 1) printf "     %8d %6d %9d %8d\n", $ce, $cq, $cd, $cr }' "$SUPP"

# --- 2. Order throughput --------------------------------------------------
hr
echo "2. ORDER THROUGHPUT"
echo "   'ingested'  = order_records rows created in the window for the source"
echo "   'completed' = marketplace.order.sync jobs that reached status=succeeded"
hr
awk -F, -v ce="$C_ELAPSED" -v ci="$C_ING" -v cs="$C_OSS" -v cp="$C_PHASE" '
  NR>1 && $ci >= 0 {
    if (!seen) { e0=$ce; i0=$ci; s0=$cs; seen=1 }
    e1=$ce; i1=$ci; s1=$cs;
    # Per-phase first/last so a fault window can be reported separately.
    if (!(($cp) in pf)) { pf[$cp]=$ce; pi[$cp]=$ci; ps[$cp]=$cs }
    pl[$cp]=$ce; pil[$cp]=$ci; psl[$cp]=$cs;
  }
  END {
    if (!seen) { print "   no samples"; exit }
    dur = e1-e0; if (dur<=0) dur=1;
    printf "   whole window : ingested %d, completed %d over %ds\n", i1-i0, s1-s0, dur;
    printf "                  = %.1f orders/h ingested, %.1f orders/h completed  [measured]\n", (i1-i0)*3600/dur, (s1-s0)*3600/dur;
    print  "";
    print  "   by phase:";
    for (p in pf) {
      d = pl[p]-pf[p]; if (d<=0) continue;
      printf "     %-10s %5ds  ingested %5d (%7.1f/h)  completed %5d (%7.1f/h)\n", \
        p, d, pil[p]-pi[p], (pil[p]-pi[p])*3600/d, psl[p]-ps[p], (psl[p]-ps[p])*3600/d;
    }
  }' "$SUPP"

# --- 3. Memory and connections --------------------------------------------
hr
echo "3. POSTGRES BACKENDS AND MEMORY"
hr
awk -F, -v cb="$C_BE" -v ca="$C_BEA" -v cm="$C_MAXC" '
  NR>1 && $cb >= 0 {
    n++; if (n==1 || $cb>bmax) bmax=$cb; if (n==1 || $cb<bmin) bmin=$cb; bs+=$cb;
    if (n==1 || $ca>amax) amax=$ca; as+=$ca; mx=$cm; last=$cb;
  }
  END {
    if (!n) { print "   no samples"; exit }
    printf "   backends  min %d  mean %.1f  max %d  last %d   (max_connections %s)\n", bmin, bs/n, bmax, last, mx;
    printf "   active    mean %.1f  max %d\n", as/n, amax;
    if (mx+0 > 0) printf "   peak utilisation %.1f%% of max_connections\n", bmax*100/mx;
  }' "$SUPP"

echo
echo "   container memory, first and last sample (from the stored docker stats blob):"
for pos in first last; do
  if [ "$pos" = first ]; then row="$(awk 'NR==2' "$SUPP")"; else row="$(tail -1 "$SUPP")"; fi
  # The blob is the second-to-last RFC4180-quoted field. Pulled out with sed
  # rather than a CSV parser for the reason in this script's header.
  blob="$(printf '%s' "$row" | sed -n 's/.*,"\(\[.*\]\)","{.*/\1/p' | sed 's/""/"/g')"
  if [ -n "$blob" ]; then
    printf '     %-5s ' "$pos"
    printf '%s' "$blob" | jq -r '[.[] | select(.name|test("lab-(api|worker|postgres|redis|prestashop)")) | "\(.name)=\(.mem|split(" / ")[0])"] | join("  ")' 2>/dev/null || echo "(unparseable)"
  else
    printf '     %-5s (blob not found in row)\n' "$pos"
  fi
done

# --- 4. Limiter degradation ------------------------------------------------
hr
echo "4. LIMITER DEGRADATION"
echo "   Each line is an EPISODE, not a call: the fallback message is logged on"
echo "   the transition into degraded mode and then at most once per 30s"
echo "   (DEGRADED_LOG_INTERVAL_MS). The number of individual calls that fell"
echo "   back is NOT established by this figure."
echo
echo "   The AUTHORITATIVE total for the window is post_guard_limiter_degraded's,"
echo "   in verdict.txt: it reads the whole window in one grep. The sum below is"
echo "   a sum of per-interval counts, kept because it is the only thing that"
echo "   shows the SHAPE over time - whether episodes cluster at boot and early"
echo "   load, as F7 found, or accumulate. The two can differ by a line landing"
echo "   on an interval boundary; quote the verdict's figure as the total."
hr
awk -F, -v cd="$C_DEG" -v ce="$C_ELAPSED" '
  NR>1 && $cd >= 0 { n++; t+=$cd; if ($cd>mx) mx=$cd; e=$ce }
  END {
    if (!n) { print "   no samples"; exit }
    dur = (e>0) ? e : 1;
    printf "   observed total          : %d episode(s) over %ds  [measured]\n", t, dur;
    printf "   observed rate           : %.1f episodes/h\n", t*3600/dur;
    printf "   busiest sample interval : %d episode(s)\n", mx;
    print  "";
    printf "   For comparison, extrapolating the retest campaign 300s arm-A figure\n";
    printf "   (40-49 episodes per 300s window, MEASURED 2026-09-07) to this\n";
    printf "   window length predicts %.0f-%.0f episodes  [extrapolated].\n", 40*dur/300, 49*dur/300;
    printf "   Observed / low-end extrapolation = %.2fx.\n", (40*dur/300>0) ? t/(40*dur/300) : 0;
  }' "$SUPP"

# --- 5. Where the queue went ----------------------------------------------
hr
echo "5. WHAT THE QUEUE WAS MADE OF (last sample)"
hr
tail -1 "$SUPP" | sed -n 's/.*,"{\(.*\)}"$/{\1}/p' | sed 's/""/"/g' \
  | jq -r 'to_entries | sort_by(-.value) | .[] | "     \(.value)\t\(.key)"' 2>/dev/null \
  || echo "     (unparseable)"

# --- 6. Terminal job outcomes ---------------------------------------------
hr
echo "6. JOBS CREATED IN THE WINDOW, BY TYPE AND TERMINAL STATE  [measured]"
hr
pgcols "SELECT \"jobType\", status, COALESCE(outcome,'-'), COUNT(*)
    FROM sync_jobs WHERE \"createdAt\" >= '$WS_ISO'
    GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 40" \
  | awk -F'\t' '{printf "     %-44s %-10s %-16s %s\n", $1, $2, $3, $4}'

# --- 7. Destination outcome ----------------------------------------------
hr
echo "7. DESTINATION CREATES FOR ORDERS INGESTED IN THE WINDOW  [measured]"
echo "   This is the one syncStatus containment read in the whole run - F5"
echo "   measured it at ~142ms and ~540MB of buffer traffic per execution at"
echo "   1M rows, so it is computed once here rather than sampled."
hr
pg "SELECT
      COUNT(*)::text || E'\t' || 'ingested'
    FROM order_records WHERE \"createdAt\" >= '$WS_ISO' AND \"sourceConnectionId\" = '$SRC_CONN'
    UNION ALL
    SELECT COUNT(*)::text || E'\t' || 'with syncedAt on the destination'
    FROM order_records WHERE \"createdAt\" >= '$WS_ISO' AND \"sourceConnectionId\" = '$SRC_CONN'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(\"syncStatus\") e
                  WHERE e->>'destinationConnectionId' = '$DST_CONN' AND e->>'syncedAt' IS NOT NULL)
    UNION ALL
    SELECT COUNT(*)::text || E'\t' || 'carrying a FAILED syncStatus entry'
    FROM order_records WHERE \"createdAt\" >= '$WS_ISO' AND \"sourceConnectionId\" = '$SRC_CONN'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(\"syncStatus\") e WHERE e->>'status' = 'failed')
    UNION ALL
    SELECT COUNT(*)::text || E'\t' || 'with NO syncStatus entry at all'
    FROM order_records WHERE \"createdAt\" >= '$WS_ISO' AND \"sourceConnectionId\" = '$SRC_CONN'
      AND (\"syncStatus\" IS NULL OR jsonb_array_length(\"syncStatus\") = 0)" \
  | awk -F'\t' '{printf "     %8s  %s\n", $1, $2}'

# --- 8. Per-attempt duration ---------------------------------------------
hr
echo "8. PER-ATTEMPT DURATION, sync_jobs.lastAttemptDurationMs  [measured]"
echo "   Real precision, not the ~1Hz sampler floor. NULL is EXCLUDED and the"
echo "   non-null sample size is printed beside each row: the column is null on"
echo "   every row predating its migration and is reset on every enqueue, so"
echo "   counting nulls as zero would understate every duration (#2611)."
hr
pgcols "SELECT \"jobType\", COUNT(*),
      COALESCE(ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY \"lastAttemptDurationMs\"))::text,'-'),
      COALESCE(ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY \"lastAttemptDurationMs\"))::text,'-'),
      COALESCE(MAX(\"lastAttemptDurationMs\")::text,'-')
    FROM sync_jobs
    WHERE \"createdAt\" >= '$WS_ISO' AND \"lastAttemptDurationMs\" IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 20" \
  | awk -F'\t' 'BEGIN {printf "     %-44s %6s %8s %8s %8s\n", "jobType", "n", "p50ms", "p95ms", "maxms"}
               {printf "     %-44s %6s %8s %8s %8s\n", $1, $2, $3, $4, $5}'

# --- 9. Attempts / deferrals ----------------------------------------------
hr
echo "9. RETRIES AND DEFERRALS FOR WINDOW JOBS  [measured]"
hr
# Explicitly ORDERed. A bare UNION ALL has no defined row order, and it came
# back shuffled on the dry run - harmless for a labelled list, but a report
# whose rows move between runs is one a reader cannot diff.
pgcols "SELECT label, value FROM (
      SELECT 1 AS o, 'jobs with attempts>1' AS label, COUNT(*)::text AS value FROM sync_jobs
        WHERE \"createdAt\" >= '$WS_ISO' AND attempts > 1
      UNION ALL
      SELECT 2, 'max attempts seen', COALESCE(MAX(attempts)::text,'-') FROM sync_jobs
        WHERE \"createdAt\" >= '$WS_ISO'
      UNION ALL
      SELECT 3, 'jobs with deferredTotalMs>0', COUNT(*)::text FROM sync_jobs
        WHERE \"createdAt\" >= '$WS_ISO' AND \"deferredTotalMs\" > 0
      UNION ALL
      SELECT 4, 'max deferredTotalMs seen', COALESCE(MAX(\"deferredTotalMs\")::text,'-') FROM sync_jobs
        WHERE \"createdAt\" >= '$WS_ISO'
      UNION ALL
      SELECT 5, 'dead jobs', COUNT(*)::text FROM sync_jobs
        WHERE \"createdAt\" >= '$WS_ISO' AND status='dead'
    ) t ORDER BY o" \
  | awk -F'\t' '{printf "     %-32s %s\n", $1, $2}'

# --- 10. Database growth --------------------------------------------------
hr
echo "10. DATABASE SIZE  [measured]"
hr
if [ -f "$DIR/timeseries.csv" ]; then
  awk -F, 'NR==2 {a=$7} END {b=$7} END {
    printf "     first sample %.1f MB, last sample %.1f MB, delta %+.1f MB\n", a/1048576, b/1048576, (b-a)/1048576 }' \
    "$DIR/timeseries.csv"
else
  echo "     (lib.sh timeseries.csv absent)"
fi

hr
echo "Pushes log:      $PUSHES"
echo "Queue timeseries: $SUPP"
echo "lib timeseries:   $DIR/timeseries.csv"
hr
