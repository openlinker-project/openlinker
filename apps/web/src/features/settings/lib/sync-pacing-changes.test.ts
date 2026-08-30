/**
 * Sync Pacing Changes — unit tests
 *
 * The property under test is that the confirmation is built from the diff: no
 * change, no entry. A modal that says the same thing every time is clicked
 * through by reflex, so "only what moved" is the feature, not a detail.
 *
 * @module apps/web/src/features/settings/lib
 */
import { describe, expect, it } from 'vitest';
import {
  CADENCE_TIMING_NOTE,
  diffSyncPacing,
  type SyncPacingValues,
} from './sync-pacing-changes';
import { resolveValueLimits } from './resolve-value-limits';

const SAVED: SyncPacingValues = {
  catalogueSweepBudget: 500,
  inventorySweepBudget: 100,
  sweepPageSize: 100,
  deletionAuditBudget: 100,
  deletionAuditCadence: '0 * * * *',
};

const CONTEXT = { hostProcessLimitSeconds: 300, catalogueSize: 100_000 };

const LIMITS = resolveValueLimits(
  {
    value: 500,
    source: 'default',
    recommendedMax: 2000,
    recommendedReason: 'Past this the queue deepens.',
    absoluteMax: 20_000,
    absoluteReason: 'A sanity backstop.',
  },
  { min: 1, default: 500 },
);

describe('diffSyncPacing', () => {
  it('should report nothing when nothing changed', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED }, CONTEXT);

    expect(diff.changes).toEqual([]);
    expect(diff.lengthensDeletionWindow).toBe(false);
  });

  it('should list only the fields that actually moved', () => {
    const diff = diffSyncPacing(
      SAVED,
      { ...SAVED, catalogueSweepBudget: 2000, deletionAuditCadence: '0 */4 * * *' },
      CONTEXT,
    );

    expect(diff.changes.map((change) => change.field)).toEqual([
      'catalogueSweepBudget',
      'deletionAuditCadence',
    ]);
  });

  it('should name both run lengths and whether the host limit still holds', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 2000 }, CONTEXT);

    const [change] = diff.changes;
    expect(change.fromLabel).toBe('500');
    expect(change.toLabel).toBe('2000');
    expect(change.effect).toContain('46 s');
    expect(change.effect).toContain('184 s');
    expect(change.effect).toContain('still fits');
  });

  it('should say a value will not fit when it passes the host limit', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 2000 }, {
      ...CONTEXT,
      hostProcessLimitSeconds: 120,
    });

    expect(diff.changes[0].effect).toContain('will not fit');
  });

  it('should flag a less frequent deletion audit as lengthening the window', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditCadence: '0 */4 * * *' }, CONTEXT);

    expect(diff.lengthensDeletionWindow).toBe(true);
    expect(diff.changes[0].effect).toContain('41.7 d');
    expect(diff.changes[0].effect).toContain('166.7 d');
  });

  it('should flag a smaller deletion-audit run as lengthening the window too', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditBudget: 50 }, CONTEXT);

    expect(diff.lengthensDeletionWindow).toBe(true);
  });

  it('should not flag a change that leaves the deletion window shorter', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditBudget: 500 }, CONTEXT);

    expect(diff.changes).toHaveLength(1);
    expect(diff.lengthensDeletionWindow).toBe(false);
  });

  it('should not flag a catalogue change as touching the deletion window', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 100 }, CONTEXT);

    expect(diff.lengthensDeletionWindow).toBe(false);
  });

  it('should still compare the deletion window when the catalogue size is unknown', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditCadence: '0 3 * * *' }, {
      ...CONTEXT,
      catalogueSize: null,
    });

    expect(diff.lengthensDeletionWindow).toBe(true);
    expect(diff.changes[0].effect).toContain('does not know how many products');
  });

  it('should note when a cadence change lands, from what the API reported', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditCadence: '0 */4 * * *' }, {
      ...CONTEXT,
      cadenceAppliesAt: 'next-scheduler-start',
    });

    expect(diff.changes[0].timing).toBe(CADENCE_TIMING_NOTE);
  });

  it('should say nothing about timing when the API reported a value it does not know', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, deletionAuditCadence: '0 */4 * * *' }, {
      ...CONTEXT,
      cadenceAppliesAt: 'immediately',
    });

    expect(diff.changes[0].timing).toBeUndefined();
  });

  it('should not put a timing note on a change that lands on the next run', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 2000 }, {
      ...CONTEXT,
      cadenceAppliesAt: 'next-scheduler-start',
    });

    expect(diff.changes[0].timing).toBeUndefined();
  });

  it('should say which ceiling a change crossed, in the API\'s own words', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 5000 }, {
      ...CONTEXT,
      limits: { catalogueSweepBudget: LIMITS },
    });

    expect(diff.changes[0].aboveRecommended).toEqual({
      recommendedMax: 2000,
      reason: 'Past this the queue deepens.',
    });
  });

  it('should say nothing about a ceiling for a change that stays inside it', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 1500 }, {
      ...CONTEXT,
      limits: { catalogueSweepBudget: LIMITS },
    });

    expect(diff.changes[0].aboveRecommended).toBeUndefined();
  });

  it('should not flag lowering a value that stays above the recommendation', () => {
    // Still above, but moving the right way - crying wolf on the one edit
    // that improves matters would teach the operator to ignore the flag.
    const diff = diffSyncPacing(
      { ...SAVED, catalogueSweepBudget: 8000 },
      { ...SAVED, catalogueSweepBudget: 5000 },
      { ...CONTEXT, limits: { catalogueSweepBudget: LIMITS } },
    );

    expect(diff.changes[0].aboveRecommended).toBeDefined();
  });

  it('should say nothing about ceilings when the API reported none', () => {
    const diff = diffSyncPacing(SAVED, { ...SAVED, catalogueSweepBudget: 5000 }, CONTEXT);

    expect(diff.changes[0].aboveRecommended).toBeUndefined();
  });
});
