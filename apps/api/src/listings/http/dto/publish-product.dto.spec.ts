/**
 * Publish-Product DTO validation tests (#1832) — focused on the neutral
 * `commerce` block's cross-field sale-window rules.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  BulkPublishProductRequestDto,
  PublishCommerceDto,
  PublishProductRequestDto,
} from './publish-product.dto';

async function errorsFor(commerce: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(PublishCommerceDto, commerce);
  const errors = await validate(dto, { whitelist: true });
  const collect = (es: typeof errors): string[] =>
    es.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...(e.children ? collect(e.children) : []),
    ]);
  return collect(errors);
}

describe('PublishCommerceDto (#1832)', () => {
  it('accepts an empty commerce block', async () => {
    expect(await errorsFor({})).toEqual([]);
  });

  it('accepts a sale price with a valid window', async () => {
    expect(
      await errorsFor({
        salePrice: { amount: 9.99, currency: 'PLN' },
        saleStartsAt: '2026-08-01T00:00:00Z',
        saleEndsAt: '2026-08-31T23:59:59Z',
      }),
    ).toEqual([]);
  });

  it('accepts a sale price with no window', async () => {
    expect(await errorsFor({ salePrice: { amount: 9.99, currency: 'PLN' } })).toEqual([]);
  });

  it('rejects a sale window without a sale price', async () => {
    const errs = await errorsFor({ saleStartsAt: '2026-08-01T00:00:00Z' });
    expect(errs).toContain('isDefined');
  });

  it('rejects a sale end that is not after the start', async () => {
    const errs = await errorsFor({
      salePrice: { amount: 9.99, currency: 'PLN' },
      saleStartsAt: '2026-08-31T00:00:00Z',
      saleEndsAt: '2026-08-01T00:00:00Z',
    });
    expect(errs).toContain('isAfter');
  });

  it('rejects a non-ISO sale date', async () => {
    const errs = await errorsFor({
      salePrice: { amount: 9.99, currency: 'PLN' },
      saleStartsAt: 'not-a-date',
    });
    expect(errs).toContain('isIso8601');
  });

  it('rejects an unknown tax status', async () => {
    const errs = await errorsFor({ taxStatus: 'bogus' });
    expect(errs).toContain('isIn');
  });

  it('rejects a negative dimension', async () => {
    const errs = await errorsFor({ dimensions: { length: -1 } });
    expect(errs).toContain('min');
  });
});

async function requestErrors(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(PublishProductRequestDto, payload);
  const errors = await validate(dto, { whitelist: true });
  return errors.flatMap((e) => Object.keys(e.constraints ?? {}));
}

describe('PublishProductRequestDto AI flags (#1840)', () => {
  const base = { internalVariantId: 'ol_variant_abc', status: 'published', stock: 3 };

  it('accepts generateDescription + a valid tone', async () => {
    const errs = await requestErrors({
      ...base,
      generateDescription: true,
      descriptionTone: 'detailed',
    });
    expect(errs).toHaveLength(0);
  });

  it('accepts the request with the AI flags omitted', async () => {
    const errs = await requestErrors(base);
    expect(errs).toHaveLength(0);
  });

  it('rejects a non-boolean generateDescription', async () => {
    const errs = await requestErrors({ ...base, generateDescription: 'yes' });
    expect(errs).toContain('isBoolean');
  });

  it('rejects an unknown tone', async () => {
    const errs = await requestErrors({ ...base, descriptionTone: 'snarky' });
    expect(errs).toContain('isIn');
  });
});

describe('BulkPublishProductRequestDto AI flags (#1840)', () => {
  it('accepts batch-level generateDescription + tone', async () => {
    const dto = plainToInstance(BulkPublishProductRequestDto, {
      connectionId: 'conn-1',
      items: [{ internalVariantId: 'ol_variant_abc', stock: 1 }],
      status: 'draft',
      generateDescription: true,
      descriptionTone: 'concise',
    });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.flatMap((e) => Object.keys(e.constraints ?? {}))).toHaveLength(0);
  });
});
