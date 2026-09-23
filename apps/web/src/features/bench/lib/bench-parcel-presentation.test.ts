/**
 * Scan-refusal sentences (#3415)
 *
 * The pure chooser had no test of its own, and the one case worth pinning is
 * the pair that used to share a sentence: a parcel that must not be packed,
 * and a parcel that must not be packed BY YOU. They send the packer to two
 * different places, so a fallthrough here is an operational error rather than
 * a wording one.
 *
 * @module apps/web/src/features/bench/lib
 */
import { describe, expect, it } from 'vitest';

import { describeUndoCompletionRefusal, describeVerificationRefusal } from './bench-parcel-presentation';

describe('describeVerificationRefusal', () => {
  it('sends the packer back to the trolley only when the box really must not be packed', () => {
    expect(describeVerificationRefusal('not-packable', undefined)).toContain('take it back to the trolley');
  });

  it('does NOT send the packer back to the trolley when the box is merely somebody else’s', () => {
    // The box is fine. Returning a good parcel to the trolley because its
    // owner changed is the error this split exists to prevent.
    const message = describeVerificationRefusal('not-claimable-by-viewer', undefined);

    expect(message).toContain('another packer');
    expect(message).not.toContain('trolley');
  });

  it('never confuses the two', () => {
    expect(describeVerificationRefusal('not-claimable-by-viewer', undefined)).not.toBe(
      describeVerificationRefusal('not-packable', undefined)
    );
  });

  it('falls back to its own unknown sentence rather than guessing at a newer reason', () => {
    const message = describeVerificationRefusal('a-reason-this-build-does-not-know', undefined);

    expect(message).not.toContain('trolley');
    expect(message).not.toContain('another packer');
  });
});

/**
 * `describeUndoCompletionRefusal` (#3415) — the counterpart to
 * `describeCompletionRefusal`, over the wider refusal union that shares the
 * ADR-074 lock. The one reason worth pinning here directly, rather than only
 * through the component: `not-claimable-by-viewer` must NOT reuse the
 * trolley-bound wording a held or cancelled box gets, because the box is
 * fine — it is simply assigned to someone else right now.
 */
describe('describeUndoCompletionRefusal', () => {
  it('names the standing lock without sending the packer to the trolley', () => {
    const message = describeUndoCompletionRefusal('not-claimable-by-viewer');

    expect(message).toContain('assigned to someone else');
    expect(message).not.toContain('trolley');
  });

  it('says there was nothing to take back, when the box was never marked done', () => {
    expect(describeUndoCompletionRefusal('not-completed')).toContain(
      'there is nothing to take back'
    );
  });

  it('says the screen moved on, on a stale token', () => {
    expect(describeUndoCompletionRefusal('version-conflict')).toContain(
      'Somebody else changed this box'
    );
  });

  it('falls back to its own unknown sentence rather than guessing at a newer reason', () => {
    const message = describeUndoCompletionRefusal('a-reason-this-build-does-not-know');

    expect(message).not.toContain('trolley');
    expect(message).not.toContain('assigned to someone else');
  });

  it('never confuses the lock with the nothing-to-undo reason', () => {
    expect(describeUndoCompletionRefusal('not-claimable-by-viewer')).not.toBe(
      describeUndoCompletionRefusal('not-completed')
    );
  });
});
