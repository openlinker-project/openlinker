#!/usr/bin/env bash
#
# weak-shop-verdict.sh <run-dir> - render one markdown table per profile from a
# `scenarios/weak-shop-ramp.sh` run, and apply the verdict rule to each.
#
# WHY THE VERDICT IS COMPUTED AND NOT EYEBALLED
#
# The rule it applies is written down in the run's own
# `threshold-fixed-in-advance.md`, before any constrained profile produced a
# sample. Computing it here rather than reading the tables and deciding means
# the same arithmetic is applied to every profile, including the ones whose
# answer is inconvenient - which is the whole reason for fixing a threshold in
# advance rather than after.
#
# It reads the `#` summary block `drivers/ps-latency-probe.mjs` writes, exactly
# as `ps-latency-table.sh` does, so no percentile is re-derived here. One
# implementation of the arithmetic, not two.
#
# The comparison rate defaults to 5 req/s - what a `requestsPerMinute: 300`
# default offers - and the profile's OWN 1 req/s step is its idle control, so
# a slow box is judged against itself rather than against the 28-core baseline.
set -euo pipefail

DIR="${1:?usage: weak-shop-verdict.sh <run-dir>}"
JUDGE_RATE="${JUDGE_RATE:-5}"
IDLE_RATE="${IDLE_RATE:-1}"
RATIO_FREE="${RATIO_FREE:-2}"       # p99 <= 2x own idle p99
ABS_FREE_MS="${ABS_FREE_MS:-250}"   # ...and <= 250 ms absolute
RATIO_UNSAFE="${RATIO_UNSAFE:-10}"
ABS_UNSAFE_MS="${ABS_UNSAFE_MS:-1000}"

# field <file> <regex-with-one-group>
field() { sed -nE "s/$2/\1/p" "$1" | head -n 1; }

summary_row() {
  local f="$1" base off ach okn p50 p90 p99 mx st
  base="$(basename "$f" .summary)"
  off="$(field "$f" '^# offered rps *: (.*)')"
  ach="$(field "$f" '^# achieved rps *: ([0-9.]+).*')"
  okn="$(field "$f" '^# samples ok *: (.*)')"; okn="${okn// /}"
  p50="$(field "$f" '^# latency ok.*p50 ([0-9.]+).*')"
  p90="$(field "$f" '^# latency ok.*p90 ([0-9.]+).*')"
  p99="$(field "$f" '^# latency ok.*p99 ([0-9.]+).*')"
  mx="$(field "$f"  '^# latency ok.*max ([0-9.]+).*')"
  st="$(field "$f"  '^# status mix *: (.*)')"
  printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\n' \
    "$base" "${off:-?}" "${ach:-?}" "${okn:-?}" "${p50:-n/a}" "${p90:-n/a}" "${p99:-n/a}" "${mx:-n/a}" "${st:-?}"
}

# Integer-only comparison in tenths of a millisecond, so no bc dependency and
# no float drift. `n/a` (every sample non-ok) propagates rather than becoming 0.
tenths() {
  case "$1" in
    ''|n/a|'?') printf 'na' ;;
    *) printf '%s' "$(awk -v v="$1" 'BEGIN{printf "%d", v*10}')" ;;
  esac
}

shopt -s nullglob
any=0
for prof_dir in "$DIR"/*/; do
  prof="$(basename "$prof_dir")"
  case "$prof" in warmup-*) continue ;; esac
  files=("$prof_dir"step-*.summary)
  [ "${#files[@]}" -gt 0 ] || continue
  any=1

  printf '\n#### %s\n\n' "$prof"
  printf '| offered req/s | achieved | ok/total | p50 | p90 | p99 | max | status mix |\n'
  printf '|---:|---:|---:|---:|---:|---:|---:|---|\n'

  # Glob order is LEXICOGRAPHIC, which puts `step-drift-1` first and
  # `step-rate-10` between `step-rate-1` and `step-rate-2`. A latency curve
  # printed in that order is not a curve, and the drift control - whose whole
  # meaning is "this rate again, LAST" - would be read as the opening
  # measurement. So the rows are sorted by offered rate, with the drift step
  # forced last whatever its rate.
  ordered="$(
    for f in "${files[@]}"; do
      b="$(basename "$f" .summary)"
      case "$b" in
        step-drift-*) printf '999999\t%s\n' "$f" ;;
        *)            printf '%s\t%s\n' "${b#step-rate-}" "$f" ;;
      esac
    done | sort -g -k1,1
  )"

  idle_p99=''; judge_p99=''; judge_ok=''; judge_off=''; judge_ach=''; refused=''; ratio_na=0
  for f in $(printf '%s\n' "$ordered" | cut -f2-); do
    # A step still being written has no summary block yet. Rendering it would
    # put a row of `?` in the table, which reads as a measurement that failed
    # rather than one that has not happened - so it is skipped, and the missing
    # step shows up as the verdict saying it was NOT MEASURED.
    grep -Eq '^# latency ok' "$f" || continue
    IFS='|' read -r base off ach okn p50 p90 p99 mx st <<<"$(summary_row "$f")"
    # `$base` is the file stem, i.e. `step-drift-1` / `step-rate-5` - matching
    # on `drift-*` silently never fires and the drift control renders as an
    # ordinary row indistinguishable from the opening one.
    drift_tag=''
    case "$base" in step-drift-*) drift_tag=' **(drift, run last)**' ;; esac
    printf '| %s%s | %s | %s | %s | %s | %s | %s | %s |\n' \
      "$off" "$drift_tag" "$ach" "$okn" "$p50" "$p90" "$p99" "$mx" "$st"
    case "$base" in
      "step-rate-$IDLE_RATE")  idle_p99="$p99" ;;
    esac
    case "$base" in
      "step-rate-$JUDGE_RATE") judge_p99="$p99"; judge_ok="$okn"; judge_off="$off"; judge_ach="$ach" ;;
    esac
    # Any status other than the two the mix legitimately contains (200 for
    # every endpoint, 401 for the `configurations` probe, which EXPECTS it) is
    # a refusal signal and is reported separately from latency.
    case "$st" in
      *'"429"'*|*'"503"'*|*'"500"'*|*'"502"'*|*'"504"'*|*'"0"'*) refused="$refused $base:$st" ;;
    esac
  done

  # --- verdict -------------------------------------------------------------
  if [ -z "$judge_p99" ]; then
    printf '\n**Verdict at %s req/s: NOT MEASURED** (no `step-rate-%s` in this profile).\n' "$JUDGE_RATE" "$JUDGE_RATE"
  else
    v='FREE'; why=''
    ok_n="${judge_ok%%/*}"; ok_d="${judge_ok##*/}"
    [ "$ok_n" = "$ok_d" ] || { v='UNSAFE'; why="$why not every sample returned its expected status ($judge_ok);"; }

    jp="$(tenths "$judge_p99")"; ip="$(tenths "$idle_p99")"
    # An ABSENT idle control and an UNCOMPUTABLE judged p99 are different
    # facts and must not share a verdict. A soak directory legitimately holds
    # only the judged rate, so it has no 1 req/s step to be its own control -
    # collapsing that into "no p99 could be computed (every sample non-ok)"
    # reported the 10-minute sustained window as UNSAFE while every one of its
    # 3000 samples had in fact succeeded. The ratio half of the rule is simply
    # not applicable there; the absolute half still is, and is applied.
    if [ "$jp" = "na" ]; then
      v='UNSAFE'; why="$why no p99 could be computed (every sample non-ok);"
    elif [ "$ip" = "na" ]; then
      ratio_na=1
      [ "$jp" -le "$(( ABS_UNSAFE_MS * 10 ))" ] || { v='UNSAFE'; why="$why p99 ${judge_p99} ms is over the ${ABS_UNSAFE_MS} ms absolute ceiling;"; }
      if [ "$v" = 'FREE' ] && [ "$jp" -gt "$(( ABS_FREE_MS * 10 ))" ]; then
        v='DEGRADING'; why="$why p99 ${judge_p99} ms is over the ${ABS_FREE_MS} ms free ceiling;"
      fi
    else
      [ "$jp" -le "$(( ABS_UNSAFE_MS * 10 ))" ] || { v='UNSAFE'; why="$why p99 ${judge_p99} ms is over the ${ABS_UNSAFE_MS} ms absolute ceiling;"; }
      [ "$ip" -eq 0 ] || [ "$jp" -le "$(( ip * RATIO_UNSAFE ))" ] || { v='UNSAFE'; why="$why p99 is over ${RATIO_UNSAFE}x its own idle p99 (${idle_p99} ms);"; }
      if [ "$v" = 'FREE' ]; then
        if [ "$jp" -gt "$(( ABS_FREE_MS * 10 ))" ]; then
          v='DEGRADING'; why="$why p99 ${judge_p99} ms is over the ${ABS_FREE_MS} ms free ceiling;"
        elif [ "$ip" -gt 0 ] && [ "$jp" -gt "$(( ip * RATIO_FREE ))" ]; then
          v='DEGRADING'; why="$why p99 ${judge_p99} ms is over ${RATIO_FREE}x its own idle p99 (${idle_p99} ms);"
        fi
      fi
    fi

    # The achieved-rate condition: a probe that could not deliver the offered
    # rate mislabelled its own x-axis, so the row is not evidence about that
    # rate at all.
    ja="$(tenths "$judge_ach")"; jo="$(tenths "$judge_off")"
    if [ "$ja" != "na" ] && [ "$jo" != "na" ] && [ "$jo" -gt 0 ]; then
      [ "$(( ja * 100 / jo ))" -ge 95 ] || { v='UNSAFE'; why="$why achieved ${judge_ach} against ${judge_off} offered - the rate was not delivered;"; }
    fi

    printf '\n**Verdict at %s req/s: %s**' "$JUDGE_RATE" "$v"
    [ -n "$why" ] && printf ' -%s' "${why% }"
    printf '\n'
    if [ "$ratio_na" = "1" ]; then
      printf '\nNo %s req/s step in this directory, so the profile has no idle control of its own: the\nRATIO half of the rule is not applicable and only the absolute ceiling was applied.\n%s req/s p99 %s ms.\n' \
        "$IDLE_RATE" "$JUDGE_RATE" "$judge_p99"
    else
      printf '\nidle (%s req/s) p99 %s ms -> %s req/s p99 %s ms.\n' \
        "$IDLE_RATE" "${idle_p99:-n/a}" "$JUDGE_RATE" "$judge_p99"
    fi
  fi

  if [ -n "$refused" ]; then
    printf '\n**REFUSED** (a status the mix should never contain):%s\n' "$refused"
  else
    printf '\nNo refusal at any step: every status was 200 or the `configurations` probe'\''s expected 401.\n'
  fi
done

[ "$any" = "1" ] || { echo "weak-shop-verdict.sh: no profile directories with step-*.summary under $DIR" >&2; exit 1; }
