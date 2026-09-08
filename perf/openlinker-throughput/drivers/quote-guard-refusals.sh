#!/usr/bin/env bash
# Prints post_guard_generator_saturated's own refusal text for the three
# historical 1000/s F3 arms, fed their own recorded figures. Quoted in the
# #2933 withdrawal so the answer to "would they have passed?" is the guard's
# words, not mine.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. ./lib.sh >/dev/null 2>&1 || . ./lib.sh
D="$(mktemp -d)"
one() {
  local name="$1" used="$2" cfg="$3" dropped="$4" reqs="$5"
  jq -n --argjson u "$used" --argjson c "$cfg" --argjson d "$dropped" --argjson r "$reqs" \
    '{metrics:{vus:{max:$u},vus_max:{max:$c},dropped_iterations:{count:$d},http_reqs:{count:$r}}}' > "$D/x.json"
  printf -- '--- %s ---\n' "$name"
  post_guard_generator_saturated "$D/x.json" ramping-arrival-rate
  printf '\n'
}
one "arm 1  dropped 19.6%  VU 96.4%" 964 1000 19600 80400
one "arm 2  dropped 24.1%  VU 96.8%" 968 1000 24100 75900
one "arm 3  dropped 26.7%  VU 91.7%" 917 1000 26700 73300

# Each arm breached BOTH limits, but the guard returns only the first message
# (jq `.[0]`, lib.sh:1495). Re-fed with a deliberately clean VU count so the
# dropped-iteration arm is shown to fire on its own for each of the three -
# i.e. neither breach depends on the other.
two() {
  local name="$1" dropped="$2" reqs="$3"
  jq -n --argjson d "$dropped" --argjson r "$reqs" \
    '{metrics:{vus:{max:200},vus_max:{max:1000},dropped_iterations:{count:$d},http_reqs:{count:$r}}}' > "$D/y.json"
  printf -- '--- %s (VU forced clean at 20%%) ---\n' "$name"
  post_guard_generator_saturated "$D/y.json" ramping-arrival-rate
  printf '\n'
}
two "arm 1 dropped-only 19.6%" 19600 80400
two "arm 2 dropped-only 24.1%" 24100 75900
two "arm 3 dropped-only 26.7%" 26700 73300
rm -rf "$D"
