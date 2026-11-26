/**
 * Progress segment (shared)
 *
 * The one capsule every progress strip in the release center is made of: the tour
 * card's rail, the bell card and the /whats-new setup rail. Required work is a
 * solid capsule, optional work is striped, a guide to look at ("Do obejrzenia")
 * is blue, and the state (todo, current, done, skipped) only changes the fill, so
 * a viewer reads kind and progress from the same two cues everywhere.
 *
 * @module features/release-center/components
 */
import type { ReactElement } from 'react';

export type ProgressSegmentKind = 'required' | 'optional' | 'showcase';
export type ProgressSegmentState = 'todo' | 'current' | 'done' | 'skipped';

export interface ProgressSegmentProps {
  kind: ProgressSegmentKind;
  state: ProgressSegmentState;
  /** Present: the segment is a button (the tour rail); absent: a plain capsule. */
  onSelect?: () => void;
  'aria-label'?: string;
  'aria-current'?: 'step';
  'aria-disabled'?: boolean;
  title?: string;
}

export function ProgressSegment({ kind, state, onSelect, ...aria }: ProgressSegmentProps): ReactElement {
  if (onSelect) {
    return (
      <button type="button" className="pseg pseg--button" data-kind={kind} data-state={state} onClick={onSelect} {...aria} />
    );
  }
  return <span className="pseg" data-kind={kind} data-state={state} aria-hidden={aria['aria-label'] ? undefined : true} {...aria} />;
}
