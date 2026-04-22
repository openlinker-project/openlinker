/**
 * createOfferFieldsSchema Tests
 *
 * Guards the `internalVariantId` regex against regression — the wizard's Step 1
 * validation depends on variants carrying the documented `ol_variant_*` prefix
 * (see issue #322). If this regex drifts or backend variant IDs revert to the
 * `ol_product_*` shape, the wizard silently blocks every variant pick.
 *
 * @module apps/web/src/features/listings/components
 */
import { describe, expect, it } from 'vitest';
import { createOfferFieldsSchema, CREATE_OFFER_DEFAULT_VALUES } from './create-offer-fields.schema';

const VALID_BASE = {
  ...CREATE_OFFER_DEFAULT_VALUES,
  connectionId: 'ol_connection_abc',
  title: 'Test offer',
  categoryId: '12345',
  priceAmount: '19.99',
  priceCurrency: 'PLN',
  stock: 1,
  deliveryPolicyId: 'policy-1',
};

describe('createOfferFieldsSchema — internalVariantId', () => {
  it('accepts a well-formed ol_variant_ ID', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...VALID_BASE,
      internalVariantId: 'ol_variant_3fce2df4d853f4499b955a6bb1a212bd',
    });
    expect(result.success).toBe(true);
  });

  it('rejects ol_product_ IDs (the regression that motivated #322)', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...VALID_BASE,
      internalVariantId: 'ol_product_3fce2df4d853f4499b955a6bb1a212bd',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const variantErrors = result.error.issues.filter((i) => i.path[0] === 'internalVariantId');
      expect(variantErrors).toHaveLength(1);
      expect(variantErrors[0].message).toBe('Pick a variant');
    }
  });

  it('rejects uppercase hex in the variant suffix', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...VALID_BASE,
      internalVariantId: 'ol_variant_ABCDEF',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty variant IDs with the same error message', () => {
    const result = createOfferFieldsSchema.safeParse({
      ...VALID_BASE,
      internalVariantId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const variantErrors = result.error.issues.filter((i) => i.path[0] === 'internalVariantId');
      expect(variantErrors[0].message).toBe('Pick a variant');
    }
  });
});
