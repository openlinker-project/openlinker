/**
 * Delivery Rider Heuristic Unit Tests (#1792)
 *
 * @module libs/core/src/mappings/domain
 */
import { matchCandidateCarrier } from './delivery-rider-heuristic';
import { CANDIDATE_CARRIER_HEURISTICS } from './types/delivery-rider.types';

describe('matchCandidateCarrier', () => {
  it('maps a "paczkomat" method name to InPost', () => {
    expect(
      matchCandidateCarrier({ name: 'Allegro Paczkomat InPost', typeId: 'abc-123' })
    ).toEqual({ platformType: 'inpost', displayName: 'InPost' });
  });

  it('maps an "inpost" method name to InPost', () => {
    expect(matchCandidateCarrier({ name: 'InPost Kurier', typeId: null })).toEqual({
      platformType: 'inpost',
      displayName: 'InPost',
    });
  });

  it('maps a "dpd" method name to DPD', () => {
    expect(matchCandidateCarrier({ name: 'Kurier DPD', typeId: null })).toEqual({
      platformType: 'dpd',
      displayName: 'DPD',
    });
  });

  it('matches case-insensitively', () => {
    expect(matchCandidateCarrier({ name: 'PACZKOMAT INPOST', typeId: null })?.platformType).toBe(
      'inpost'
    );
  });

  it('matches against the typeId when the name carries no keyword', () => {
    expect(
      matchCandidateCarrier({ name: 'Punkt odbioru', typeId: 'ALLEGRO-INPOST-LOCKER' })
        ?.platformType
    ).toBe('inpost');
  });

  it('returns null for a method with no carrier keyword', () => {
    expect(matchCandidateCarrier({ name: 'Kurier standardowy', typeId: 'courier-1' })).toBeNull();
  });

  it('returns null when both name and typeId are null', () => {
    expect(matchCandidateCarrier({ name: null, typeId: null })).toBeNull();
  });

  it('returns null when both fields are empty/whitespace', () => {
    expect(matchCandidateCarrier({ name: '   ', typeId: '' })).toBeNull();
  });

  it('every heuristic table entry resolves to a candidate for each of its keywords', () => {
    for (const entry of CANDIDATE_CARRIER_HEURISTICS) {
      for (const keyword of entry.keywords) {
        expect(matchCandidateCarrier({ name: keyword, typeId: null })).toEqual({
          platformType: entry.platformType,
          displayName: entry.displayName,
        });
      }
    }
  });

  it('is pure — repeated calls with the same input yield equal, side-effect-free results', () => {
    const input = { name: 'Paczkomat InPost', typeId: null };
    const first = matchCandidateCarrier(input);
    const second = matchCandidateCarrier(input);
    expect(first).toEqual(second);
    // Input is not mutated.
    expect(input).toEqual({ name: 'Paczkomat InPost', typeId: null });
  });
});
