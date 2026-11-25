/**
 * prefersMotion
 *
 * True only where the operator allows motion. Imperative animations (which
 * Motion's `MotionConfig` does not govern) and one-shot timed sequences ask it
 * first. Where `matchMedia` is absent (tests, old browsers) the answer is no, so
 * the end state is shown at once.
 *
 * @module shared/ui
 */
export function prefersMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}
