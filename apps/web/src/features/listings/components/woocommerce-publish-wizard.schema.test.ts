import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import type { WoocommercePublishWizardValidationCopy } from './listing-form.types';
import {
  createWoocommercePublishWizardSchema,
  WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS,
} from './woocommerce-publish-wizard.schema';

const copy = getMessages('listings').woocommercePublishWizard.validation;

function messagesFor(
  values: Partial<typeof WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS>,
  withCopy: WoocommercePublishWizardValidationCopy = copy,
): string[] {
  const result = createWoocommercePublishWizardSchema(withCopy).safeParse({
    ...WOOCOMMERCE_PUBLISH_SINGLE_DEFAULTS,
    ...values,
  });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe('createWoocommercePublishWizardSchema', () => {
  it('should accept the single-mode defaults when nothing was entered', () => {
    expect(messagesFor({})).toEqual([]);
  });

  it('should report the stock message from the listings copy when stock is not a whole number', () => {
    expect(messagesFor({ stock: '1.5' })).toEqual([copy.stock]);
  });

  it('should report the price message from the listings copy when the price is not positive', () => {
    expect(messagesFor({ priceAmount: '0' })).toEqual([copy.price]);
  });

  it('should use the injected copy when the schema is built with a different language', () => {
    const custom: WoocommercePublishWizardValidationCopy = {
      stock: 'Custom stock message',
      price: 'Custom price message',
    };

    expect(messagesFor({ stock: '-1', priceAmount: 'abc' }, custom)).toEqual([
      'Custom stock message',
      'Custom price message',
    ]);
  });
});
