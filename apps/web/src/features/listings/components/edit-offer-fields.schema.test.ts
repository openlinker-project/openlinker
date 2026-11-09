import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import { createEditOfferFieldsSchema } from './edit-offer-fields.schema';

const copy = getMessages('listings').editOfferDrawer.validation;

describe('createEditOfferFieldsSchema', () => {
  it('should name the title limit in the message when the title is too long', () => {
    const result = createEditOfferFieldsSchema(copy).safeParse({ title: 'x'.repeat(76) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Title must be 75 characters or fewer');
  });

  it('should reject a price with more than two decimal places when it is entered', () => {
    const result = createEditOfferFieldsSchema(copy).safeParse({ priceAmount: '9.999' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(copy.priceInvalid);
  });

  it('should accept an empty form when nothing was changed', () => {
    expect(createEditOfferFieldsSchema(copy).safeParse({}).success).toBe(true);
  });
});
