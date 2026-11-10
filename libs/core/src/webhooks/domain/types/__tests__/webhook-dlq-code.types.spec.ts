import { readWebhookDlqCode, WebhookDlqCodeValues } from '../webhook-dlq-code.types';

describe('readWebhookDlqCode', () => {
  it.each(WebhookDlqCodeValues)('should read %s from a reason that starts with it', (code) => {
    expect(readWebhookDlqCode(`${code}: some detail`)).toBe(code);
  });

  it('should read a code with no detail after it', () => {
    expect(readWebhookDlqCode('ungated')).toBe('ungated');
  });

  it('should return null when the prefix is not a known code', () => {
    expect(readWebhookDlqCode('handler threw: timeout after 5s')).toBeNull();
  });

  it('should return null when there is no reason', () => {
    expect(readWebhookDlqCode(null)).toBeNull();
    expect(readWebhookDlqCode(undefined)).toBeNull();
  });
});
