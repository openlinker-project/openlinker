/**
 * Dispatch a scanner burst at a FROZEN clock (#3271).
 *
 * `useScannerInput` tells a scanner apart from a person by inter-keystroke
 * timing: `pruneStaleKeystrokes` drops anything more than
 * `SCANNER_MAX_KEY_GAP_MS` (50 ms) older than the key being handled. A test
 * that dispatches its keydowns in a plain loop is therefore asserting
 * something about the HOST as well as about the component - the loop is
 * synchronous, but the process can still be descheduled between two
 * iterations, and on a loaded CI runner a 50 ms gap is ordinary.
 *
 * When that happens the earliest keystrokes are pruned and the component sees
 * a truncated barcode: `5901234123457` arrives as `901234123457`, which is a
 * mismatch, which fails a test that has nothing to do with mismatches. Seen on
 * a real run (#3271) once four packages started sharing the box.
 *
 * Freezing `Date.now` for the duration of the burst makes the simulation say
 * what it means - these keystrokes arrived together, the way a scanner sends
 * them - instead of leaving that to how busy the machine happens to be. It is
 * not a tolerance bump: the gap rule is still exercised by
 * `scanner-gesture.test.ts`, which constructs keystroke timings directly and
 * is the right place to test it.
 *
 * @module features/bench/lib
 */

/**
 * Run `body` with `Date.now` pinned, so every timestamp it reads is identical.
 *
 * Restored in a `finally`, so a throwing body cannot leak the stub into the
 * next test.
 */
export function atFrozenClock<T>(body: () => T): T {
  const realNow = Date.now;
  const frozen = realNow.call(Date);
  Date.now = () => frozen;
  try {
    return body();
  } finally {
    Date.now = realNow;
  }
}

/**
 * Dispatch `value` as one scanner burst, terminated by Enter.
 *
 * Callers wrap this in `act()` where the component under test needs it; the
 * helper deliberately does not, so it stays usable from the hook-level tests
 * that assert on the raw listener.
 */
export function dispatchScannerBurst(value: string, target?: HTMLElement | Document): void {
  atFrozenClock(() => {
    const sink = target ?? document;
    for (const char of value) {
      sink.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
    }
    sink.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}
