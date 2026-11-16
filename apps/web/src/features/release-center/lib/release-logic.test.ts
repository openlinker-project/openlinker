import { describe, expect, it } from 'vitest';

import { RELEASE_STEPS } from '../catalog/release-steps';
import { compareVersions, isMinorOrMajorIncrease, isValidVersion } from './compare-versions';
import { shouldOpenDialog } from './should-open-dialog';
import { visibleSteps } from './visible-steps';

const release = (version: string) => ({
  version,
  groups: [{ title: 'Features', entries: [{ scope: null, text: 'x', refs: [] }] }],
});
const step = (introducedIn: string) => ({ introducedIn });

describe('compareVersions', () => {
  it.each([
    ['0.19.0', '0.19.1', -1],
    ['0.20.0', '0.19.9', 1],
    ['1.0.0', '1.0.0', 0],
    ['0.20.0-rc.1', '0.20.0', -1],
    ['0.20.0-rc.2', '0.20.0-rc.10', -1],
    ['0.20.0-alpha', '0.20.0-rc.1', -1],
  ])('should order %s against %s as %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('should throw when a version is invalid', () => {
    expect(() => compareVersions('nope', '0.1.0')).toThrow();
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });

  it('should treat a patch as no minor or major increase', () => {
    expect(isMinorOrMajorIncrease('0.19.0', '0.19.3')).toBe(false);
    expect(isMinorOrMajorIncrease('0.19.3', '0.20.0')).toBe(true);
    expect(isMinorOrMajorIncrease('0.19.3', '1.0.0')).toBe(true);
  });
});

describe('shouldOpenDialog', () => {
  const steps = [step('0.20.0')];

  it('should not open for a patch update', () => {
    const d = shouldOpenDialog('0.19.0', '0.19.1', [release('0.19.1')], steps);
    expect(d).toMatchObject({ open: false, reason: 'patch-only' });
  });

  it('should open for a minor update with content', () => {
    const d = shouldOpenDialog('0.19.0', '0.20.0', [release('0.20.0')], steps);
    expect(d.open).toBe(true);
  });

  it('should open for a release candidate that raises the minor', () => {
    const d = shouldOpenDialog('0.19.0', '0.20.0-rc.1', [release('0.20.0-rc.1')], []);
    expect(d.open).toBe(true);
  });

  it('should open once for a multi-version jump', () => {
    const d = shouldOpenDialog('0.12.0', '0.20.0', [release('0.15.0'), release('0.20.0')], []);
    expect(d.open).toBe(true);
  });

  it('should not open on a downgrade or the same version', () => {
    expect(shouldOpenDialog('0.20.0', '0.19.0', [], steps).reason).toBe('downgrade');
    expect(shouldOpenDialog('0.20.0', '0.20.0', [], steps).reason).toBe('same-version');
  });

  it('should initialise an empty cursor to the app version without a dialog', () => {
    for (const cursor of [null, undefined, '', 'garbage']) {
      expect(shouldOpenDialog(cursor, '0.20.0', [release('0.20.0')], steps)).toEqual({
        open: false,
        initialiseCursorTo: '0.20.0',
        reason: 'no-cursor',
      });
    }
  });

  it('should stay closed when the app version is invalid', () => {
    const d = shouldOpenDialog('0.19.0', 'bad', [release('0.20.0')], steps);
    expect(d).toMatchObject({ open: false, initialiseCursorTo: null });
  });

  it('should never open an empty dialog', () => {
    const d = shouldOpenDialog('0.19.0', '0.20.0', [], []);
    expect(d.reason).toBe('nothing-to-show');
  });
});

describe('visibleSteps', () => {
  it('should hide steps newer than the app version', () => {
    expect(visibleSteps([step('0.20.0'), step('0.21.0')], '0.20.0')).toEqual([step('0.20.0')]);
  });

  it('should hide everything for an invalid app version', () => {
    expect(visibleSteps([step('0.20.0')], '')).toEqual([]);
  });
});

describe('RELEASE_STEPS', () => {
  const ctx = (unassigned: number) => ({
    connection: {
      id: 'c1',
      platformType: 'allegro',
      capabilities: ['OrderSource'],
      config: {},
    },
    unassignedCarrierMethods: unassigned,
  });

  it('should make shipping routing required only while carrier methods are unassigned', () => {
    const routing = RELEASE_STEPS.find((s) => s.id === 'shipping-routing');
    expect(routing?.importance(ctx(3))).toBe('required');
    expect(routing?.importance(ctx(0))).toBe('optional');
  });

  it('should have unique ids', () => {
    const ids = RELEASE_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
