/**
 * Obligation predicate (#2346)
 *
 * The fold is the fail-closed rule, so this is where "indeterminate never
 * becomes a release" is pinned.
 *
 * @module libs/core/src/inventory/domain/types
 */
import {
  ReservationObligationKindValues,
  foldObligationVerdicts,
  resolveObligation,
  type ObligationReaders,
  type ObligationVerdict,
} from './reservation-obligation.types';

describe('foldObligationVerdicts', () => {
  it('should fold an empty set to indeterminate — asking nobody is not evidence of absence', () => {
    expect(foldObligationVerdicts([])).toBe('indeterminate');
  });

  it('should let present win over everything', () => {
    expect(foldObligationVerdicts(['absent', 'present', 'indeterminate'])).toBe('present');
  });

  it('should let indeterminate win over absent, so a reader that cannot answer is never outvoted', () => {
    expect(foldObligationVerdicts(['absent', 'indeterminate'])).toBe('indeterminate');
    expect(foldObligationVerdicts(['indeterminate', 'absent', 'absent'])).toBe('indeterminate');
  });

  it('should fold to absent only when every reader positively confirmed absence', () => {
    expect(foldObligationVerdicts(['absent', 'absent'])).toBe('absent');
  });
});

describe('resolveObligation', () => {
  const readersAnswering = (verdict: ObligationVerdict): ObligationReaders => ({
    'open-order-hold': () => Promise.resolve(verdict),
  });

  it.each(['present', 'indeterminate', 'absent'] as const)(
    'should carry a single reader’s %s verdict through',
    async (verdict) => {
      expect(await resolveObligation(readersAnswering(verdict), 'ol_order_1')).toBe(verdict);
    }
  );

  it('should fold a REJECTING reader to indeterminate rather than propagating', async () => {
    const readers: ObligationReaders = {
      'open-order-hold': () => Promise.reject(new Error('hold store unavailable')),
    };

    // Never `absent`: an unavailable source must degrade the sweep to "extend",
    // and never abort a run that could still safely extend the rest of its page.
    expect(await resolveObligation(readers, 'ol_order_1')).toBe('indeterminate');
  });

  it('should ask every declared kind', async () => {
    const asked: string[] = [];
    const readers: ObligationReaders = {
      'open-order-hold': (orderRecordId) => {
        asked.push(orderRecordId);
        return Promise.resolve('absent');
      },
    };

    await resolveObligation(readers, 'ol_order_7');

    expect(asked).toEqual(['ol_order_7']);
    // Guards the mapped type's purpose: every declared kind is consulted, so a
    // kind added without a reader cannot silently go unasked.
    expect(ReservationObligationKindValues).toHaveLength(asked.length);
  });
});
