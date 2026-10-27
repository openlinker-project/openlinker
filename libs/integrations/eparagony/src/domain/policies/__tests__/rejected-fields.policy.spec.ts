import { extractRejectedFields } from '../rejected-fields.policy';

describe('extractRejectedFields', () => {
  it('should return schema field paths named in a string message', () => {
    expect(
      extractRejectedFields({
        message: 'eCorrectiveInvoice.correctingLines[0].unitPrice must be a number',
      }),
    ).toEqual(['eCorrectiveInvoice.correctingLines[0].unitPrice']);
  });

  it('should read a list of validation messages', () => {
    expect(
      extractRejectedFields({
        message: ['metadata.grossSaleValue must be an integer', 'consumerName should not be empty'],
      }),
    ).toEqual(['metadata.grossSaleValue', 'consumerName']);
  });

  it('should drop words that are not schema fields, such as a buyer name', () => {
    expect(
      extractRejectedFields({ message: 'consumerName "Jan Kowalski" is invalid' }),
    ).toEqual(['consumerName']);
  });

  it('should return nothing for an unreadable body', () => {
    expect(extractRejectedFields(null)).toEqual([]);
    expect(extractRejectedFields('Jan Kowalski')).toEqual([]);
    expect(extractRejectedFields({ message: 42 })).toEqual([]);
  });
});
