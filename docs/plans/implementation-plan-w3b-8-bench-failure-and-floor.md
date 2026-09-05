# W3b-8 (#2421) — Surface H + C4

## Findings from the live repo (pre-implement, done by hand)

1. **There is no optimistic UI to remove.** `BenchParcelView` renders only from the server's
   answer; `useBenchVerifyMutation.onSuccess` writes `result.parcel` into the cache. So H2's first
   half already holds — but it holds *by accident of construction*, nothing asserts it, and the
   **second half fails**: the in-flight state is invisible. `verify.isPending` only disables the
   manual buttons. A packer scanning at speed sees nothing move and cannot tell whether their last
   scan counted.
2. **`ApiError.isNetworkError()` (status 0) already distinguishes a request that never reached the
   server** from an HTTP refusal — `fromNetworkFailure` and `fromTimeout` both mint it. That is the
   truthful offline signal; `navigator.onLine === false` is the cheap corroborating one.
3. **`index.css` carries NO `.bench-parcel*` rules at all** (it ends at `.bench-work-row` /
   `.bench-work-empty`). #2418 shipped the components unstyled. So C4's targets/contrast are not a
   tightening of existing rules — they are the missing block.
4. `features/bench` is **not** in `check-ui-vocabulary`'s `SCAN_ROOTS`. The naming rule still binds
   by hand; widening the roots is not this issue's.
5. `custody-touch-targets.test.ts` (#2380) is the width-keyed-target test template. Reuse its
   brace-counting stripper.
6. No server change is needed anywhere. No new route, so no `RolesGuard` / `PACKER_GRANTED_ROUTES`
   work, and `test:integration` is unaffected.

## Applied review findings

- **Out-of-order responses move the count backwards.** Two scans in flight are two requests with no
  ordering guarantee; the shipped `setQueryData(result.parcel)` lets the *earlier* answer land last
  and the surface then shows `1 of 2` for a box the server has at `2 of 2`. H2's mirror image, and
  invisible under auto-close. Guard every cache write on `BenchParcel.version` — never accept an
  older one. This is a latent defect in #2418, not one this slice introduces.
- **The offline flag must not latch.** `navigator.onLine` never goes false when the *server* is
  unreachable over a working LAN, so no `online` event ever fires and a "clear on `online` only"
  design refuses work forever on a network that recovered. Clearing comes from a positive
  reachability signal that arrives without the packer's help — any successful query or mutation.
- **A success handler must not clear a newer refusal.** Sequence-stamp gestures; a handler clears a
  notice only at or below its own sequence.
- **`verify.isPending` is not the in-flight instrument.** One observer reports the latest mutation
  only. The per-line counter is the sole source; `isPending` must not back any in-flight rendering.
- **Announce a refusal once.** `Alert tone="error"` is already `role="alert"`; the announcer carries
  acceptance and in-flight only.
- **Audio:** one lazily-created `AudioContext`, `resume()` before playing, try/catch, feature-detect.
  Pure pattern table so distinguishability is testable without WebAudio.
- **Copy says "cannot reach OpenLinker"**, never "you are offline" — one failed request is not proof
  about the packer's network.
- **CSS is scoped** to target size, type scale, status-as-text, reduced motion, and the minimum
  layout that makes the surface usable at a bench.

## Measured during implementation — TanStack Query orphans per-call callbacks

A probe (two concurrent `mutate` calls on one `useMutation` observer, the later resolving first)
established that:

- the hook's **config-level** `onSuccess` fires for **both** mutations — so `settleGesture` and the
  guarded cache write in `use-bench-verify-mutation.ts` are honest for every gesture (G3 safe);
- the **per-call** callbacks passed to `mutate(vars, { onSuccess, onError })` fire only for the
  **latest** mutation. Every overtaken gesture's callbacks are silently dropped.

The first draft put the in-flight decrement, the refusal notice and the announcement in those
per-call callbacks — which would have left an overtaken gesture showing "sent — waiting" for ever
and its refusal never rendered: a packer permanently unable to tell whether a scan counted, i.e.
the exact H2 failure this slice exists to remove. `submit` therefore uses `mutateAsync` and settles
on the promise it returns, which is per call whatever the observer does.

Two of my own tests were **false passes** before this was found — the version guard and the
sequence guard both appeared proved while the mutation that should have broken them stayed green,
because the orphaned callback never ran at all. Both were re-verified after the fix.

## H2 — in flight is a first-class state

- `BenchParcelView` keeps `inFlight: Record<workLineId, number>`, incremented before `verify.mutate`
  and decremented in both settle paths. It is **never** added to `verifiedQuantity` and never
  changes `benchLineState`: the count and the badge stay the server's answer.
- `BenchParcelLineRow` gains one additive `pending` prop rendering a distinct "sent — waiting"
  note. `verified` / `in-progress` / `not-started` are untouched, so D20's byte-identity test still
  compares two settled rows.
- A **single `aria-live="polite"` running commentary** (`bench-parcel__announcer`) states the
  outcome of every gesture: sent, recorded, refused, refused-offline, not-delivered. That is the
  literal "never left unable to tell whether their last scan counted".
- The `failed` notice carries the line so it names *which* scan did not go through.

## H1 — offline, refusing honestly

- `useBenchConnection` hook: offline when `navigator.onLine === false` **or** the last verify failed
  with `isNetworkError()`. Back online on the `online` event **or** any successful request.
  Not a queue. Nothing is replayed.
- The scanner stays **enabled** while offline and the offline check runs *first* in `onScan`, so a
  scan is refused out loud rather than swallowed by a removed listener (C3's rule).
- The manual confirm button is disabled while offline.
- A persistent banner above the lines. Confirmed state survives because the cached parcel is never
  cleared — a failed background refetch keeps `data` — and a test pins that.

## C4 — audible, visible, gloved

- `lib/bench-scan-sound.ts`: pure `SCAN_SOUND_PATTERNS` (a frequency/duration tuple list per kind)
  plus a thin WebAudio player that no-ops when `AudioContext` is absent or muted. `wrong-item` is a
  two-pulse descending pair; `over-scan` is one long high pulse — different pulse **count**,
  **direction** and **pitch**, so they differ by ear on a loud floor.
- Mute persists in `localStorage`, toggled from the footer. Muting changes nothing visible — pinned
  by a test comparing the rendered alert markup muted vs unmuted.
- CSS: the missing `.bench-parcel` block. Every control ≥44 px **unconditionally**, big type,
  status carried by text, `prefers-reduced-motion` guarding the one pulse animation.
- `bench-parcel-targets.test.ts` on the #2380 template.
