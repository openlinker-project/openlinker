import { isBuyerEmailOutcome, isRecipientRejectedError } from './buyer-email-delivery.types';

describe('isRecipientRejectedError', () => {
  it('should read an SMTP 550 at RCPT TO as a rejected recipient', () => {
    expect(isRecipientRejectedError({ responseCode: 550, command: 'RCPT TO' })).toBe(true);
  });

  it('should read a transport-reported rejected list as a rejected recipient', () => {
    expect(isRecipientRejectedError({ rejected: ['a@b.pl'] })).toBe(true);
  });

  it('should not read a connection failure as a rejected recipient', () => {
    expect(isRecipientRejectedError(new Error('connect ECONNREFUSED'))).toBe(false);
    expect(isRecipientRejectedError({ responseCode: 421, command: 'CONN' })).toBe(false);
  });
});

describe('isBuyerEmailOutcome', () => {
  it('should refuse a value outside the vocabulary', () => {
    expect(isBuyerEmailOutcome('sent')).toBe(true);
    expect(isBuyerEmailOutcome('delivered')).toBe(false);
  });
});
