import { describe, expect, it } from 'vitest';

import {
  deriveSetupStepState,
  readSetupSkipped,
  summariseSetup,
  withSetupSkipped,
} from './setup-steps';

describe('readSetupSkipped', () => {
  it('should return nothing when the key is absent or not a list', () => {
    expect(readSetupSkipped(undefined)).toEqual([]);
    expect(readSetupSkipped({ setupSkipped: 'automations' })).toEqual([]);
  });

  it('should ignore entries that are not a known step', () => {
    expect(readSetupSkipped({ setupSkipped: ['automations', 'nonsense', 7] })).toEqual(['automations']);
  });
});

describe('withSetupSkipped', () => {
  it('should add a step without touching the rest of the config', () => {
    expect(withSetupSkipped({ baseUrl: 'x' }, 'salesDocuments', true)).toEqual({
      baseUrl: 'x',
      setupSkipped: ['salesDocuments'],
    });
  });

  it('should not add a step twice', () => {
    const once = withSetupSkipped({}, 'automations', true);
    expect(withSetupSkipped(once, 'automations', true)).toEqual({ setupSkipped: ['automations'] });
  });

  it('should remove only the named step when undoing', () => {
    expect(withSetupSkipped({ setupSkipped: ['automations', 'whoDecides'] }, 'automations', false)).toEqual({
      setupSkipped: ['whoDecides'],
    });
  });
});

describe('deriveSetupStepState', () => {
  it('should read a skipped step as skipped even when its state is unknown', () => {
    expect(deriveSetupStepState(null, true)).toBe('skipped');
  });

  it('should keep an unreadable answer distinct from pending and done', () => {
    expect(deriveSetupStepState(null, false)).toBe('unknown');
    expect(deriveSetupStepState(false, false)).toBe('pending');
    expect(deriveSetupStepState(true, false)).toBe('done');
  });
});

describe('summariseSetup', () => {
  it('should be complete when every step is done or skipped', () => {
    expect(
      summariseSetup({ salesDocuments: 'done', automations: 'skipped', whoDecides: 'done' }).complete
    ).toBe(true);
  });

  it('should list pending and unknown steps as left, never as complete', () => {
    const summary = summariseSetup({ salesDocuments: 'pending', automations: 'unknown', whoDecides: 'done' });
    expect(summary.complete).toBe(false);
    expect(summary.left).toEqual(['salesDocuments', 'automations']);
  });
});
