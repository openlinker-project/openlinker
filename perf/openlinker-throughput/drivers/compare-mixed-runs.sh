#!/usr/bin/env bash
# Side-by-side of two sustained-mixed-load runs, computed the SAME way for both.
#
# Reads only `mixed-timeseries.csv`, whose schema is identical across the two
# runs, and resolves every column by NAME from the header rather than by index.
#
# Deliberately does NOT recompute the summarizer's sections 6-9: those run live
# SQL, and the baseline's teardown has since purged its queued rows, so a
# by-hand re-run against that dir would report against a table that no longer
# holds what the window held. For those sections the two runs' own summary.txt
# files - each written inside its own window - are the record.
#
# Usage: compare-mixed-runs.sh <baseline_run_dir> <fixed_run_dir>
set -euo pipefail

A="${1:?compare-mixed-runs.sh <baseline_run_dir> <fixed_run_dir>}"
B="${2:?compare-mixed-runs.sh <baseline_run_dir> <fixed_run_dir>}"

one() {
  local dir="$1" label="$2"
  local csv="$dir/mixed-timeseries.csv"
  [ -f "$csv" ] || { printf '%s: MISSING %s\n' "$label" "$csv"; return 0; }
  awk -F, -v label="$label" '
    NR==1 { for (i=1;i<=NF;i++) h[$i]=i; next }
    {
      el=$(h["elapsed"]); ph=$(h["phase"]); due=$(h["g_queued_due"]);
      ing=$(h["orders_ingested"]); comp=$(h["ord_sync_succeeded"]);
      deg=$(h["limiter_degraded_delta"]); dfr=$(h["g_queued_deferred"]);
      run=$(h["g_running"]); dead=$(h["g_dead"]);
      bk=$(h["pg_backends"]);

      n++
      if (n==1) { e0=el; i0=ing; c0=comp; d0=due }
      e1=el; i1=ing; c1=comp; d1=due; dfr1=dfr; run1=run; dead1=dead

      # limiter: a failed sample is -1 and must not be summed as data
      if (deg+0 >= 0) { degtot+=deg; degn++; if (deg+0 > 0) degsamp++ }
      if (due+0 >= 0) { if (duemax=="" || due+0>duemax+0) duemax=due }
      if (bk+0 >= 0)  { bktot+=bk; bkn++; if (bkmax=="" || bk+0>bkmax+0) bkmax=bk }

      # per-phase first/last
      if (!(ph in pf)) { pf[ph]=el; pfi[ph]=ing; pfc[ph]=comp }
      pl[ph]=el; pli[ph]=ing; plc[ph]=comp
    }
    END {
      dur = e1-e0; if (dur<=0) dur=1
      printf "== %s ==\n", label
      printf "  samples                  : %d over %ds (%.2f h)\n", n, dur, dur/3600
      printf "  orders ingested          : %d  = %.1f/h   [measured, whole window]\n", i1-i0, (i1-i0)*3600/dur
      printf "  order.sync completed     : %d  = %.1f/h   [measured, whole window]\n", c1-c0, (c1-c0)*3600/dur
      for (p in pf) {
        d = pl[p]-pf[p]; if (d<=0) continue
        printf "    phase %-9s %5ds : ingested %4d (%6.1f/h)  completed %4d (%6.1f/h)\n", \
               p, d, pli[p]-pfi[p], (pli[p]-pfi[p])*3600/d, plc[p]-pfc[p], (plc[p]-pfc[p])*3600/d
      }
      printf "  queue due  first/max/last: %d / %d / %d\n", d0, duemax, d1
      printf "  queue growth over window : %+d jobs  = %+.1f jobs/h [endpoint, not least-squares]\n", d1-d0, (d1-d0)*3600/dur
      printf "  deferred / running / dead at end : %d / %d / %d\n", dfr1, run1, dead1
      printf "  limiter degradation      : %d episode(s) over %d good sample(s) = %.1f/h; %d sample(s) carried >=1 (%.1f%%)\n", \
             degtot, degn, degtot*3600/dur, degsamp, (degn?100*degsamp/degn:0)
      printf "  pg backends mean / max   : %.1f / %d\n", (bkn?bktot/bkn:0), bkmax
      printf "\n"
    }
  ' "$csv"
}

one "$A" "BASELINE  shared intake client"
one "$B" "FIXED     dedicated intake client (#2984)"

printf 'Least-squares slopes and the growing/plateau/converging verdict come from\n'
printf 'drivers/queue-curve.awk, which decides on the LAST-THIRD slope against a\n'
printf 'noise band - not from the endpoint figure above. Run it per dir:\n'
printf '  awk -F, -v ce=3 -v cq=5 -f drivers/queue-curve.awk <dir>/mixed-timeseries.csv\n'
