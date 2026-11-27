/**
 * Refused number inheritance rule - unit tests (#3960)
 *
 * Pins WHICH refusals let the next attempt take over the refused document
 * number. Only a refusal the adapter declared BEFORE contacting the provider
 * qualifies; every other one leaves an audited gap, because a number the
 * provider saw may be recorded there and reusing it risks a duplicate number.
 *
 * @module libs/core/src/invoicing/domain/types
 */
import {
  canInheritRefusedDocumentNumber,
  NUMBER_NEVER_SENT_FAILURE_CODES,
} from './refused-number-inheritance.types';
import { InvoiceFailureCodeValues, type InvoiceFailureCode } from './invoicing.types';

describe('canInheritRefusedDocumentNumber (#3960)', () => {
  it.each(['connection-setup-incomplete', 'acknowledgement-required'] as const)(
    'should inherit when a refusal was declared before the provider was contacted (%s)',
    (failureCode) => {
      expect(
        canInheritRefusedDocumentNumber({ status: 'failed', failureMode: 'rejected', failureCode }),
      ).toBe(true);
    },
  );

  it.each(
    InvoiceFailureCodeValues.filter(
      (code: InvoiceFailureCode) => !NUMBER_NEVER_SENT_FAILURE_CODES.includes(code),
    ),
  )('should NOT inherit a rejected refusal coded %s, since the provider may have seen the number', (failureCode) => {
    expect(
      canInheritRefusedDocumentNumber({ status: 'failed', failureMode: 'rejected', failureCode }),
    ).toBe(false);
  });

  it('should NOT inherit a rejected refusal with no failure code', () => {
    expect(
      canInheritRefusedDocumentNumber({
        status: 'failed',
        failureMode: 'rejected',
        failureCode: null,
      }),
    ).toBe(false);
  });

  it('should NOT inherit from an in-doubt failure, even with a pre-contact code', () => {
    expect(
      canInheritRefusedDocumentNumber({
        status: 'failed',
        failureMode: 'in-doubt',
        failureCode: 'connection-setup-incomplete',
      }),
    ).toBe(false);
  });

  it.each(['pending', 'issuing', 'issued'] as const)(
    'should NOT inherit from a %s record',
    (status) => {
      expect(
        canInheritRefusedDocumentNumber({
          status,
          failureMode: 'rejected',
          failureCode: 'connection-setup-incomplete',
        }),
      ).toBe(false);
    },
  );
});
