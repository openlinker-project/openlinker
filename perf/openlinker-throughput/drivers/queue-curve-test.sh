#!/usr/bin/env bash
#
# Tests for drivers/queue-curve.awk (#2983).
#
# The point of this file is anti-vacuity, in the sense this campaign's own
# guards use the word: a convergence verdict that CANNOT return `growing`
# reads exactly like a healthy system, and a plateau band wide enough to
# swallow any slope makes every run look bounded. So each verdict is proved
# reachable against a curve whose right answer is known by construction, and
# the flattering answers are proved NOT to be returned for the others.
#
#   bash drivers/queue-curve-test.sh
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWK_PROG="$DIR/queue-curve.awk"
[ -f "$AWK_PROG" ] || { echo "queue-curve.awk not found beside this test"; exit 1; }

PASS=0
FAIL=0
FAILURES=()

# Column layout matches the scenario's own CSV closely enough to be
# meaningful: elapsed in column 1, depth in column 2, plus a third column so a
# trailing field cannot be silently read as the depth.
synth() {
  # synth <out> <start> <step_per_sample> <n> [jitter_amplitude]
  local out="$1" start="$2" step="$3" count="$4" jit="${5:-0}"
  printf 'elapsed,depth,other\n' > "$out"
  awk -v s="$start" -v st="$step" -v n="$count" -v j="$jit" 'BEGIN {
    srand(7);
    for (i = 0; i < n; i++) {
      d = s + st * i;
      if (j > 0) d += (int(rand() * (2 * j + 1)) - j);
      if (d < 0) d = 0;
      printf "%d,%d,x\n", i * 30, d;
    }
  }' >> "$out"
}

run_curve() {
  awk -F, -v ce=1 -v cq=2 -f "$AWK_PROG" "$1"
}

field() {
  awk -F= -v k="$2" '$1 == k { print $2; exit }' <<< "$1"
}

check() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    FAILURES+=("$name: expected [$want] got [$got]")
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "--- the three verdicts are each reachable ---"

# A queue growing by 2 jobs per 30s sample = 240 jobs/h, unmistakable.
synth "$TMP/grow.csv" 0 2 200
OUT="$(run_curve "$TMP/grow.csv")"
check "a monotonically rising curve is GROWING" growing "$(field "$OUT" verdict)"
check "and its tail slope is positive" 1 "$(awk -v v="$(field "$OUT" tail_slope_per_h)" 'BEGIN{print (v>0)?1:0}')"

# A flat queue with +/-3 jobs of jitter. This is the assertion that stops the
# band being cosmetic: without a noise band the sign of the tail slope here is
# a coin toss.
synth "$TMP/flat.csv" 500 0 200 3
OUT="$(run_curve "$TMP/flat.csv")"
check "a flat curve with jitter is PLATEAU" plateau "$(field "$OUT" verdict)"

# A draining queue.
synth "$TMP/drain.csv" 5000 -2 200
OUT="$(run_curve "$TMP/drain.csv")"
check "a falling curve is CONVERGING" converging "$(field "$OUT" verdict)"
check "and its tail slope is negative" 1 "$(awk -v v="$(field "$OUT" tail_slope_per_h)" 'BEGIN{print (v<0)?1:0}')"

echo "--- a peak that flattens is not reported as still growing ---"
# Rises hard for the first half, then flat. An OVERALL slope would call this
# growing for ever; the last third is what makes it a plateau. This is the
# "endpoint comparison cannot tell a plateau from a peak" case in the awk
# program's own header, proved rather than asserted.
{
  printf 'elapsed,depth,other\n'
  awk 'BEGIN { for (i = 0; i < 90; i++) printf "%d,%d,x\n", i*30, i*10 }'
  awk 'BEGIN { for (i = 90; i < 180; i++) printf "%d,%d,x\n", i*30, 890 }'
} > "$TMP/peak.csv"
OUT="$(run_curve "$TMP/peak.csv")"
check "a curve that rose and then flattened is PLATEAU" plateau "$(field "$OUT" verdict)"
check "even though its overall slope is clearly positive" 1 \
  "$(awk -v v="$(field "$OUT" overall_slope_per_h)" 'BEGIN{print (v>100)?1:0}')"

echo "--- a still-rising tail is never softened to plateau ---"
# The inverse of the case above, and the one that matters: flat for the first
# half, rising at the end. Reporting this as a plateau would publish the
# endpoint of an unconverged run as an equilibrium.
{
  printf 'elapsed,depth,other\n'
  awk 'BEGIN { for (i = 0; i < 90; i++) printf "%d,%d,x\n", i*30, 100 }'
  awk 'BEGIN { for (i = 90; i < 180; i++) printf "%d,%d,x\n", i*30, 100 + (i-90)*5 }'
} > "$TMP/late.csv"
OUT="$(run_curve "$TMP/late.csv")"
check "a curve rising only at the end is GROWING" growing "$(field "$OUT" verdict)"

echo "--- failed samples are dropped, never read as zero ---"
# The sampler writes -1 when a query failed. Reading those as 0 would drag a
# rising curve toward the flattering answer, so they must be dropped and
# COUNTED.
{
  printf 'elapsed,depth,other\n'
  awk 'BEGIN { for (i = 0; i < 200; i++) printf "%d,%d,x\n", i*30, (i%20==0) ? -1 : 1000 + i*2 }'
} > "$TMP/neg.csv"
OUT="$(run_curve "$TMP/neg.csv")"
check "negative depths are dropped" 10 "$(field "$OUT" dropped)"
check "and the surviving samples still read GROWING" growing "$(field "$OUT" verdict)"
check "n counts only the surviving samples" 190 "$(field "$OUT" n)"

echo "--- too little data refuses rather than guessing ---"
{
  printf 'elapsed,depth,other\n'
  printf '0,5,x\n30,9,x\n'
} > "$TMP/tiny.csv"
OUT="$(run_curve "$TMP/tiny.csv")"
check "two samples cannot describe a curve" insufficient-samples "$(field "$OUT" verdict)"

# Eleven samples is one below the floor: a rising curve this short must be
# refused rather than labelled, because its tail would be three points and the
# noise band would come from three samples. This is the assertion that keeps
# MIN_SAMPLES from being lowered back to the n>=4 the first draft used.
{
  printf 'elapsed,depth,other\n'
  awk 'BEGIN { for (i = 0; i < 11; i++) printf "%d,%d,x\n", i*30, 10+i*5 }'
} > "$TMP/eleven.csv"
OUT="$(run_curve "$TMP/eleven.csv")"
check "eleven samples is below the floor and is refused" insufficient-samples "$(field "$OUT" verdict)"
check "and the refusal names the floor it applied" 12 "$(field "$OUT" min_samples)"

# Twelve is the floor exactly, and must produce a verdict rather than refusing -
# a floor that is never cleared is a floor that disables the instrument.
{
  printf 'elapsed,depth,other\n'
  awk 'BEGIN { for (i = 0; i < 12; i++) printf "%d,%d,x\n", i*30, 10+i*5 }'
} > "$TMP/twelve.csv"
OUT="$(run_curve "$TMP/twelve.csv")"
check "twelve samples clears the floor" growing "$(field "$OUT" verdict)"

echo "--- a header-only file does not crash ---"
printf 'elapsed,depth,other\n' > "$TMP/empty.csv"
OUT="$(run_curve "$TMP/empty.csv")"
check "an empty body reports zero samples" 0 "$(field "$OUT" n)"
check "and refuses a verdict" insufficient-samples "$(field "$OUT" verdict)"

echo
if [ "$FAIL" -eq 0 ]; then
  printf '=== %d passed, 0 failed ===\n' "$PASS"
  exit 0
fi
printf '=== %d passed, %d failed ===\n' "$PASS" "$FAIL"
printf 'FAILURES:\n'
for f in "${FAILURES[@]}"; do printf '  - %s\n' "$f"; done
exit 1
