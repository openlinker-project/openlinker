import { decideBuyerEmail } from './buyer-email-gate.domain-service';

const on = (templates: Record<string, unknown>) => ({ buyerEmails: { enabled: true, templates } });
const base = {
  templateKey: 'shipped' as const,
  buyerAddress: 'a@b.pl',
  channelKind: 'shop' as const,
};

describe('decideBuyerEmail', () => {
  it('should suppress when the connection has no buyerEmails config', () => {
    expect(decideBuyerEmail({ ...base, connectionConfig: {} })).toEqual({
      decision: 'suppressed',
      reason: 'emails-off-for-connection',
    });
  });

  it('should suppress when the connection toggle is off', () => {
    expect(
      decideBuyerEmail({
        ...base,
        connectionConfig: { buyerEmails: { enabled: false, templates: {} } },
      })
    ).toMatchObject({ reason: 'emails-off-for-connection' });
  });

  it('should suppress when the template is not enabled', () => {
    expect(
      decideBuyerEmail({ ...base, connectionConfig: on({ shipped: { enabled: false } }) })
    ).toMatchObject({
      reason: 'template-not-enabled',
    });
  });

  it('should suppress order-confirmed on a marketplace', () => {
    expect(
      decideBuyerEmail({
        ...base,
        templateKey: 'order-confirmed',
        channelKind: 'marketplace',
        connectionConfig: on({ 'order-confirmed': { enabled: true } }),
      })
    ).toMatchObject({ reason: 'template-not-allowed-on-channel' });
  });

  it('should suppress when the buyer has no address', () => {
    expect(
      decideBuyerEmail({
        ...base,
        buyerAddress: ' ',
        connectionConfig: on({ shipped: { enabled: true } }),
      })
    ).toMatchObject({ reason: 'no-buyer-address' });
  });

  it('should send with the per-template sender when everything allows it', () => {
    expect(
      decideBuyerEmail({
        ...base,
        connectionConfig: on({
          shipped: { enabled: true, fromAddress: 'shop@x.pl', replyTo: 'help@x.pl' },
        }),
      })
    ).toEqual({ decision: 'send', fromAddress: 'shop@x.pl', replyTo: 'help@x.pl' });
  });

  it('should drop a sender carrying a line break', () => {
    expect(
      decideBuyerEmail({
        ...base,
        connectionConfig: on({ shipped: { enabled: true, fromAddress: 'a@b.pl\nBcc: x@y.pl' } }),
      })
    ).toEqual({ decision: 'send' });
  });
});
