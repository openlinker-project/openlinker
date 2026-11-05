import { AutomationGiftDocumentFormValues } from '@openlinker/core/automation';
import { BundleGiftDocumentFormValues } from '@openlinker/core/products';

import { GiftDocumentFormValues } from '../incoming-order.types';

describe('gift document form vocabulary', () => {
  // The three contexts each own a list because none may value-import another's
  // types file without a module cycle; they must stay one vocabulary, in one order.
  it('should be the same list for orders, bundles and gift rules', () => {
    expect([...BundleGiftDocumentFormValues]).toEqual([...GiftDocumentFormValues]);
    expect([...AutomationGiftDocumentFormValues]).toEqual([...GiftDocumentFormValues]);
  });
});
