import { acceptsCallerSuppliedWebhookSecret } from '../webhook-secret.types';

describe('acceptsCallerSuppliedWebhookSecret', () => {
  it('should accept the platforms that mint their own webhook secret', () => {
    expect(acceptsCallerSuppliedWebhookSecret('infakt')).toBe(true);
    expect(acceptsCallerSuppliedWebhookSecret('shopify')).toBe(true);
  });

  it('should refuse a platform whose secret OpenLinker rotates', () => {
    expect(acceptsCallerSuppliedWebhookSecret('prestashop')).toBe(false);
    expect(acceptsCallerSuppliedWebhookSecret('shoper')).toBe(false);
  });
});
