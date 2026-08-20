/**
 * Offer Validation Problem Tests (#2231)
 *
 * The guarded jsonb read and the offer-vs-account split are the two rules a
 * consumer cannot re-derive, so they are pinned here rather than at each call
 * site.
 */
import {
  isOfferValidationScope,
  readValidationProblems,
  splitOfferValidationProblems,
  toOfferValidationProblem,
  type OfferValidationProblem,
} from './offer-validation-problem.types';
import type { OfferStatusSnapshotDetails } from './offer-status-snapshot.types';

describe('toOfferValidationProblem', () => {
  it('should default an unscoped adapter error to the offer', () => {
    expect(toOfferValidationProblem({ code: 'stock', message: 'Out of stock.' })).toEqual({
      code: 'stock',
      message: 'Out of stock.',
      scope: 'offer',
    });
  });

  it('should keep an adapter-declared account scope and summary', () => {
    expect(
      toOfferValidationProblem({
        code: 'shopKyc',
        summary: 'Shop verification incomplete',
        message: 'Finish verification.',
        scope: 'account',
      }),
    ).toEqual({
      code: 'shopKyc',
      summary: 'Shop verification incomplete',
      message: 'Finish verification.',
      scope: 'account',
    });
  });

  it('should omit summary entirely rather than emitting undefined', () => {
    expect('summary' in toOfferValidationProblem({ code: 'x', message: 'y' })).toBe(false);
  });
});

describe('isOfferValidationScope', () => {
  it.each([
    ['offer', true],
    ['account', true],
    ['shop', false],
    [undefined, false],
    [null, false],
    [7, false],
  ])('should classify %p as %p', (value, expected) => {
    expect(isOfferValidationScope(value)).toBe(expected);
  });
});

describe('readValidationProblems', () => {
  it('should return nothing for a snapshot written before the field existed', () => {
    expect(readValidationProblems({ validationMessages: ['Brak parametru'] })).toEqual([]);
    expect(readValidationProblems(null)).toEqual([]);
  });

  it('should read well-formed entries', () => {
    const details: OfferStatusSnapshotDetails = {
      validationMessages: ['Out of stock.'],
      validationProblems: [
        { code: 'stock', summary: 'Out of stock', message: 'Out of stock.', scope: 'offer' },
      ],
    };

    expect(readValidationProblems(details)).toEqual(details.validationProblems);
  });

  it('should drop entries the unconstrained jsonb column cannot be trusted to type', () => {
    // The column has no check constraint, and these values would otherwise
    // reach a `key` prop and the DOM.
    const details = {
      validationProblems: [
        null,
        'stock',
        { code: 7, message: 'ok' },
        { code: 'stock' },
        { code: 'stock', message: 'Out of stock.' },
      ],
    } as unknown as OfferStatusSnapshotDetails;

    expect(readValidationProblems(details)).toEqual([
      { code: 'stock', message: 'Out of stock.', scope: 'offer' },
    ]);
  });

  it('should read a non-array blob as no problems at all', () => {
    const details = { validationProblems: 'stock' } as unknown as OfferStatusSnapshotDetails;

    expect(readValidationProblems(details)).toEqual([]);
  });

  it('should read an unrecognised scope as the offer', () => {
    const details = {
      validationProblems: [{ code: 'stock', message: 'Out of stock.', scope: 'shop' }],
    } as unknown as OfferStatusSnapshotDetails;

    // Over-reporting an account problem on one row is recoverable; hiding a
    // shop-wide block behind a row nobody opens is not.
    expect(readValidationProblems(details)[0].scope).toBe('offer');
  });

  it('should drop a non-string summary rather than passing it to a render path', () => {
    const details = {
      validationProblems: [{ code: 'stock', summary: 12, message: 'Out of stock.' }],
    } as unknown as OfferStatusSnapshotDetails;

    expect(readValidationProblems(details)[0]).toEqual({
      code: 'stock',
      message: 'Out of stock.',
      scope: 'offer',
    });
  });
});

describe('splitOfferValidationProblems', () => {
  const offerProblem: OfferValidationProblem = {
    code: 'stock',
    message: 'Out of stock.',
    scope: 'offer',
  };
  const accountProblem: OfferValidationProblem = {
    code: 'shopKyc',
    message: 'Finish verification.',
    scope: 'account',
  };

  it('should partition by scope, preserving order within each half', () => {
    expect(
      splitOfferValidationProblems([accountProblem, offerProblem, accountProblem]),
    ).toEqual({
      offerProblems: [offerProblem],
      accountProblems: [accountProblem, accountProblem],
    });
  });

  it('should return two empty halves for no problems', () => {
    expect(splitOfferValidationProblems([])).toEqual({ offerProblems: [], accountProblems: [] });
  });
});
