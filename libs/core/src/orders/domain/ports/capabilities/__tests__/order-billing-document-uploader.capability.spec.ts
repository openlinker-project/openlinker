import { isOrderBillingDocumentUploader } from '../order-billing-document-uploader.capability';

describe('isOrderBillingDocumentUploader', () => {
  it('should narrow an adapter that implements uploadBillingDocument', () => {
    const adapter = { uploadBillingDocument: jest.fn() };

    expect(isOrderBillingDocumentUploader(adapter)).toBe(true);
  });

  it('should not narrow an adapter without the method, so a platform that cannot attach one is skipped', () => {
    expect(isOrderBillingDocumentUploader({ write: jest.fn() })).toBe(false);
  });

  it('should not be satisfied by a property that is not callable', () => {
    expect(isOrderBillingDocumentUploader({ uploadBillingDocument: 'yes' })).toBe(false);
  });
});
