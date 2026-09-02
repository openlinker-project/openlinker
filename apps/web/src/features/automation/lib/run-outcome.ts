/**
 * Tone for a whole firing's outcome (#2386)
 *
 * One mapping, two renderers — the activity table and the per-rule fired log.
 * Both were correct while duplicated, which is exactly when it is cheapest to
 * unify: a later change to how `blocked` reads would otherwise land in one.
 *
 * **`nothing-to-do` and `blocked` are deliberately NOT `error`.** The first
 * fired and found the work already done; the second means nothing ran because a
 * sibling rule won the at-most-one gate. Toning either as a failure would put a
 * red count on a healthy install and pull both into an attention total they do
 * not belong in.
 *
 * @module apps/web/src/features/automation/lib
 */
export type RunOutcomeTone = 'success' | 'error' | 'warning' | 'neutral';

export function runOutcomeTone(outcome: string): RunOutcomeTone {
  if (outcome === 'done') return 'success';
  if (outcome === 'failed') return 'error';
  if (outcome === 'blocked') return 'warning';
  return 'neutral';
}
