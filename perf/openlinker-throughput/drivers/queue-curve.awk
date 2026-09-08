# Queue-depth curve analysis for the sustained mixed-load soak (#2983).
#
# Reads a CSV on stdin and prints one `key=value` line per figure. Kept as its
# own program, rather than inline in mixed-summarize.sh, for one reason: it is
# the only place in this scenario that makes a JUDGEMENT rather than reporting
# a number, and the commissioning task names the specific dishonesty it must
# avoid - "reporting an endpoint as if it were a steady state". A judgement
# that cannot be tested against a known-growing curve is a judgement nobody
# should believe, and `queue-curve-test.sh` feeds it three synthetic curves
# whose right answers are known by construction.
#
# Required variables (-v):
#   ce  1-based column index of the elapsed-seconds field
#   cq  1-based column index of the queue-depth field
# Optional:
#   skip  number of leading data rows to ignore (default 0)
#
# Input contract: row 1 is a header and is skipped. A row whose depth field is
# negative is DROPPED, not read as zero - the sampler writes -1 when a query
# failed, and averaging a failed sample in as 0 would drag a rising curve
# toward "plateau", i.e. toward the flattering answer.
#
# ---------------------------------------------------------------------------
# WHY THE LAST THIRD, AND WHY A NOISE BAND
# ---------------------------------------------------------------------------
# An endpoint comparison (last minus first) cannot tell a plateau from a peak,
# and an overall slope over a curve that rose and then flattened reports the
# rise for ever. The last third is where a plateau would be if there were one.
#
# The noise band is one sample-to-sample standard deviation of that last
# third, converted to a per-hour slope over the sub-window it spans. Without
# it, a curve jittering by a few jobs around a flat mean would be labelled
# `growing` or `converging` at random depending on which sample happened to be
# last. `plateau` is therefore the answer only when the slope is INSIDE the
# band - it is a claim about being unable to distinguish the slope from
# jitter, not a claim that the slope is zero.
#
# The three verdicts are exhaustive and there is deliberately no fourth
# "steady state" value: `plateau` is as strong a claim as this instrument can
# support, and `growing` carries an explicit note that the window ended before
# the queue converged.
# The minimum surviving-sample count a verdict may be computed from.
#
# 12 rather than 4, and the reason is the TAIL rather than the whole curve:
# the verdict is a slope over the last third compared against that third's own
# standard deviation, so the floor has to leave the tail with enough points
# for an sd to mean anything. At n=12 the tail is 4 points; below that the
# band is computed from two or three samples and would label a curve on the
# strength of essentially nothing.
#
# A real window is nowhere near this bound - the scenario samples every 30s,
# so four hours is ~480 samples. The floor exists so a truncated or
# interrupted run REFUSES rather than publishing a confident verdict from a
# handful of rows, which is the same failure `post_guard_feed_starved` refuses
# for offered load.
BEGIN { n = 0; nskipped = 0; ndropped = 0; MIN_SAMPLES = 12 }

NR == 1 { next }

{
  if (skip > 0 && nskipped < skip) { nskipped++; next }
  if ($cq + 0 < 0) { ndropped++; next }
  n++
  e[n] = $ce + 0
  q[n] = $cq + 0
  if (n == 1) { mn = q[n]; mx = q[n]; first = q[n] }
  if (q[n] < mn) mn = q[n]
  if (q[n] > mx) mx = q[n]
  last = q[n]
  sx += e[n]; sy += q[n]; sxx += e[n] * e[n]; sxy += e[n] * q[n]
}

END {
  printf "n=%d\n", n
  printf "dropped=%d\n", ndropped
  if (n < MIN_SAMPLES) {
    printf "min_samples=%d\n", MIN_SAMPLES
    print "verdict=insufficient-samples"
    exit 0
  }
  printf "first=%d\nmin=%d\nmax=%d\nlast=%d\n", first, mn, mx, last

  denom = n * sxx - sx * sx
  if (denom != 0) printf "overall_slope_per_h=%.1f\n", (n * sxy - sx * sy) / denom * 3600
  else print "overall_slope_per_h=nan"

  lo = int(n * 2 / 3); if (lo < 1) lo = 1
  m = 0; tx = 0; ty = 0; txx = 0; txy = 0
  for (i = lo; i <= n; i++) { m++; tx += e[i]; ty += q[i]; txx += e[i] * e[i]; txy += e[i] * q[i] }
  tdenom = m * txx - tx * tx
  if (m < 3 || tdenom == 0) {
    printf "tail_n=%d\n", m
    print "verdict=insufficient-samples"
    exit 0
  }
  ts = (m * txy - tx * ty) / tdenom * 3600

  mean = ty / m; ss = 0
  for (i = lo; i <= n; i++) ss += (q[i] - mean) * (q[i] - mean)
  sd = (m > 1) ? sqrt(ss / (m - 1)) : 0
  span = e[n] - e[lo]; if (span <= 0) span = 1
  band = sd / span * 3600

  printf "tail_n=%d\ntail_span_s=%d\ntail_mean=%.1f\ntail_sd=%.1f\n", m, span, mean, sd
  printf "tail_slope_per_h=%.1f\nnoise_band_per_h=%.1f\n", ts, band

  if (ts > band)       print "verdict=growing"
  else if (ts < -band) print "verdict=converging"
  else                 print "verdict=plateau"
}
