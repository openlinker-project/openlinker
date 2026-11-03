/**
 * Resolve Allegro GPSR Declaration - unit tests
 *
 * The matching rule: exact after normalisation, against the seller's label or
 * the registered trade name, and never a guess when two entries match.
 */
import {
  matchAllegroResponsibleProducer,
  normalizeProducerName,
  toAllegroSafetyText,
} from '../resolve-allegro-gpsr-declaration';

describe('resolve-allegro-gpsr-declaration', () => {
  it('should normalise case and whitespace when comparing producer names', () => {
    expect(normalizeProducerName('  ACME   Sp.  z o.o. ')).toBe('acme sp. z o.o.');
  });

  it('should match on the registered trade name when the label differs', () => {
    expect(
      matchAllegroResponsibleProducer(
        [{ id: 'rp-1', name: 'my label', producerData: { tradeName: 'Acme Sp. z o.o.' } }],
        'acme sp. z o.o.',
      ),
    ).toEqual({ kind: 'matched', id: 'rp-1' });
  });

  it('should not match a name that is only a prefix of a registered one', () => {
    expect(matchAllegroResponsibleProducer([{ id: 'rp-1', name: 'Acme Sp. z o.o.' }], 'Acme')).toEqual({
      kind: 'unmatched',
      reason: 'no-match',
    });
  });

  it('should treat one entry matching on both label and trade name as a single match', () => {
    expect(
      matchAllegroResponsibleProducer(
        [{ id: 'rp-1', name: 'Acme', producerData: { tradeName: 'Acme' } }],
        'Acme',
      ),
    ).toEqual({ kind: 'matched', id: 'rp-1' });
  });

  it('should report ambiguity when two distinct entries match', () => {
    expect(
      matchAllegroResponsibleProducer(
        [
          { id: 'rp-1', name: 'Acme' },
          { id: 'rp-2', producerData: { tradeName: 'acme' } },
        ],
        'Acme',
      ),
    ).toEqual({ kind: 'unmatched', reason: 'ambiguous' });
  });

  it('should refuse empty and over-long safety text rather than truncate it', () => {
    expect(toAllegroSafetyText('  ')).toBeNull();
    expect(toAllegroSafetyText('x'.repeat(5001))).toBeNull();
    expect(toAllegroSafetyText(' Warning. ')).toEqual({ type: 'TEXT', description: 'Warning.' });
  });
});
