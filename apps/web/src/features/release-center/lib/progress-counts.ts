/**
 * Progress counts
 *
 * What a card's tally says, split the way the strip is drawn: required steps,
 * optional steps and guides to look at. One function so the bell card, the
 * /whats-new rail and the dialog cannot count differently.
 *
 * @module features/release-center
 */
import type { ProgressSegmentKind } from '../components/progress-segment';

export interface ProgressCount {
  done: number;
  total: number;
}

export type ProgressCounts = Record<ProgressSegmentKind, ProgressCount>;

export function emptyProgressCounts(): ProgressCounts {
  return {
    required: { done: 0, total: 0 },
    optional: { done: 0, total: 0 },
    showcase: { done: 0, total: 0 },
  };
}

export function addToProgressCounts(counts: ProgressCounts, kind: ProgressSegmentKind, done: boolean): void {
  counts[kind].total += 1;
  if (done) counts[kind].done += 1;
}
