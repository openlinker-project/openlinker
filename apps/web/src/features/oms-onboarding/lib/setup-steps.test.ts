import { describe, expect, it } from 'vitest';

import type { SalesDocumentRow } from '../../sales-documents';
import {
  deriveSetupStepState,
  hasAutomaticDocumentIssuing,
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
    const summary = summariseSetup({ salesDocuments: 'pending', automations: 'done', whoDecides: 'unknown' });
    expect(summary.complete).toBe(false);
    expect(summary.left).toEqual(['salesDocuments', 'whoDecides']);
  });

  it('should not count automations as left, since nothing is set on that step', () => {
    const summary = summariseSetup({ salesDocuments: 'done', automations: 'pending', whoDecides: 'done' });
    expect(summary.complete).toBe(true);
    expect(summary.left).toEqual([]);
  });
});

describe('hasAutomaticDocumentIssuing', () => {
  const row = (overrides: Partial<SalesDocumentRow>): SalesDocumentRow => ({
    connectionId: 'c1',
    name: 'inFakt',
    platformType: 'infakt',
    status: 'active',
    capability: 'Invoicing',
    documentKind: 'invoice',
    isPrimary: true,
    triggerModels: { invoice: 'auto-on-paid', 'fiscal-receipt': 'manual' },
    ...overrides,
  });
  const models = (invoice: string, receipt = 'manual'): SalesDocumentRow['triggerModels'] => ({
    invoice,
    'fiscal-receipt': receipt,
  });

  it('should be true for an active primary connection with an automatic trigger', () => {
    expect(hasAutomaticDocumentIssuing([row({})])).toBe(true);
    expect(
      hasAutomaticDocumentIssuing([row({ triggerModels: models('auto-on-shipped') })]),
    ).toBe(true);
  });

  it('should be false while the trigger is manual', () => {
    expect(hasAutomaticDocumentIssuing([row({ triggerModels: models('manual') })])).toBe(false);
  });

  // #3583: a scheduled batch run issues without anyone asking.
  it('should count a batched trigger as automatic', () => {
    expect(hasAutomaticDocumentIssuing([row({ triggerModels: models('batched') })])).toBe(true);
  });

  // #3582: only the kinds the row issues count.
  it('should read the trigger of the kind the row issues, not the other kind', () => {
    expect(
      hasAutomaticDocumentIssuing([row({ triggerModels: models('manual', 'auto-on-paid') })]),
    ).toBe(false);
    expect(
      hasAutomaticDocumentIssuing([
        row({
          documentKind: 'fiscal-receipt',
          triggerModels: models('manual', 'auto-on-paid'),
        }),
      ]),
    ).toBe(true);
  });

  it('should count a both-kinds row when either kind is automatic', () => {
    expect(
      hasAutomaticDocumentIssuing([
        row({ documentKind: 'both', triggerModels: models('manual', 'auto-on-paid') }),
      ]),
    ).toBe(true);
  });

  it('should be false when no connection goes first, issues nothing, or is not active', () => {
    expect(hasAutomaticDocumentIssuing([row({ isPrimary: false })])).toBe(false);
    expect(hasAutomaticDocumentIssuing([row({ documentKind: null })])).toBe(false);
    expect(hasAutomaticDocumentIssuing([row({ status: 'needs_reauth' })])).toBe(false);
    expect(hasAutomaticDocumentIssuing([])).toBe(false);
  });
});
