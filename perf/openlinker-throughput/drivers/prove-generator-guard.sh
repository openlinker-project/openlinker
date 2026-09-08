#!/usr/bin/env bash
# Can post_guard_generator_saturated actually REFUSE?
#
# The whole F3 sweep rests on this guard's silence meaning "the generator was
# healthy". A guard that is silent for the wrong reason makes the run
# worthless, and this campaign has now produced FIVE instruments that were
# confidently wrong while nothing errored - including two of the three
# versions of my own destination-guard test, which stayed green against
# deliberately broken SQL.
#
# So: feed it known positives and watch it refuse, then a clean input and
# watch it pass. Both directions, before the window opens.
#
# Fixtures are synthetic k6 summary JSON carrying exactly the four fields the
# guard reads (lib.sh:1475-1478):
#     .metrics.vus.max                 -> VUs actually used
#     .metrics.vus_max.max             -> VU ceiling configured
#     .metrics.dropped_iterations.count
#     .metrics.http_reqs.count
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck disable=SC1091
. ./lib.sh >/dev/null 2>&1 || { . ./lib.sh; }

D="$(mktemp -d)"
PASS=0; FAIL=0
say() { printf '%s\n' "$*"; }

mk() { # mk <file> <vus_used> <vus_cfg> <dropped> <reqs>
  jq -n --argjson u "$2" --argjson c "$3" --argjson d "$4" --argjson r "$5" \
    '{metrics:{vus:{max:$u},vus_max:{max:$c},dropped_iterations:{count:$d},http_reqs:{count:$r}}}' \
    > "$D/$1"
}

expect() { # expect <desc> <fire|pass> <file> [substring]
  local desc="$1" want="$2" f="$3" needle="${4:-}" out
  out="$(post_guard_generator_saturated "$D/$f" ramping-arrival-rate)"
  case "$want:$out" in
    pass:ok) PASS=$((PASS+1)); say "  ok    PASS  $desc" ;;
    pass:*)  FAIL=$((FAIL+1)); say "  FAIL  expected pass, got: $out    [$desc]" ;;
    fire:ok) FAIL=$((FAIL+1)); say "  FAIL  expected REFUSAL, got ok    [$desc]" ;;
    fire:*)
      if [ -z "$needle" ] || case "$out" in *"$needle"*) true ;; *) false ;; esac; then
        PASS=$((PASS+1)); say "  ok    FIRED $desc"
      else
        FAIL=$((FAIL+1)); say "  FAIL  fired but on the wrong arm: $out    [$desc]"
      fi ;;
  esac
}

say "thresholds in force: VU utilisation max=$GENERATOR_VU_UTILISATION_MAX  dropped ratio max=$GENERATOR_DROPPED_RATIO_MAX"
say ""
say "=== 1. KNOWN POSITIVES - the guard must refuse ==="
mk vu.json      950 1000 0 100000   ; expect "VU utilisation 95% (> 90%)"          fire vu.json      "virtual users"
mk drop.json    100 1000 20000 80000; expect "dropped 20% (> 5%)"                   fire drop.json    "intended iterations"
mk both.json    950 1000 20000 80000; expect "both arms breached (reports one)"     fire both.json    ""
mk novus.json   null null 0 100000  ; expect "no vus/vus_max at all"                fire novus.json   "cannot be established"
expect "summary file absent entirely"                                               fire missing.json "wrote no summary"

say ""
say "=== 2. CLEAN INPUT - the guard must pass, so it is not refusing everything ==="
mk clean.json   500 1000 100 100000 ; expect "VU 50%, dropped 0.0999%"              pass clean.json
mk edge.json    900 1000 5000 95000 ; expect "exactly at both limits (not over)"    pass edge.json

say ""
say "=== 3. constant-vus skips the VU arm by design (lib.sh:1487) ==="
mk cv.json      1000 1000 0 100000
out="$(post_guard_generator_saturated "$D/cv.json" constant-vus)"
if [ "$out" = "ok" ]; then PASS=$((PASS+1)); say "  ok    PASS  100% VU use is not a fault under constant-vus"
else FAIL=$((FAIL+1)); say "  FAIL  $out"; fi

say ""
say "=== 4. THE THREE HISTORICAL 1000/s ARMS (#2933) ==="
say "    Their own recorded figures, fed to today's guard. This IS the answer to"
say "    'would they have passed?' - not an opinion about them."
# dropped ratios 0.196 / 0.241 / 0.267 ; VU utilisation 0.964 / 0.968 / 0.917
mk armA.json 964 1000 19600 80400 ; expect "arm 1: dropped 19.6%, VU 96.4%"  fire armA.json ""
mk armB.json 968 1000 24100 75900 ; expect "arm 2: dropped 24.1%, VU 96.8%"  fire armB.json ""
mk armC.json 917 1000 26700 73300 ; expect "arm 3: dropped 26.7%, VU 91.7%"  fire armC.json ""

say ""
say "=== $PASS passed, $FAIL failed ==="
rm -rf "$D"
[ "$FAIL" -eq 0 ]
