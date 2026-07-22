/**
 * Bulk Offer Create DTO validation tests (#1741) - focused on the nested
 * `@ValidateRecordValues` map-value validation for `perVariantOverrides` /
 * `perProductOverrides` (class-validator does not recurse into `Record<>`
 * values on its own) and the categoryId-omitted `OverridesNoCategoryDto`.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BulkOfferCreateRequestDto } from './bulk-offer-create.dto';

const baseRequest = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  connectionId: '11111111-1111-4111-8111-111111111111',
  productIds: ['ol_variant_a'],
  sharedConfig: { stock: 1, publishImmediately: false },
  ...overrides,
});

async function constraintKeysFor(request: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(BulkOfferCreateRequestDto, request);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const collect = (es: typeof errors): string[] =>
    es.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...(e.children ? collect(e.children) : []),
    ]);
  return collect(errors);
}

describe('BulkOfferCreateRequestDto map-value validation (#1741)', () => {
  it('accepts a well-formed per-variant override', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: {
            stock: 3,
            price: { amount: 10, currency: 'PLN' },
            overrides: { title: 'A title', ean: '5901234123457' },
          },
        },
      })
    );
    expect(errs).toEqual([]);
  });

  it('rejects a per-variant override with an over-long title (MaxLength 75)', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: { overrides: { title: 'x'.repeat(76) } },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('rejects a per-variant override with a non-URL image', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: { overrides: { imageUrls: ['not-a-url'] } },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('rejects a per-variant override with a non-positive price', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: { price: { amount: 0, currency: 'PLN' } },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('rejects a per-variant override with a malformed ean (digit shape)', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: { overrides: { ean: '12ab' } },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('applies the same value validation to perProductOverrides', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perProductOverrides: {
          ol_variant_a: { overrides: { title: 'y'.repeat(200) } },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('rejects an override value carrying an unknown property (forbidNonWhitelisted)', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: { stock: 1, junk: 'should-not-pass' },
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });

  it('rejects a null override value rather than treating it as an empty instance', async () => {
    const errs = await constraintKeysFor(
      baseRequest({
        perVariantOverrides: {
          ol_variant_a: null,
        },
      })
    );
    expect(errs).toContain('validateRecordValues');
  });
});
