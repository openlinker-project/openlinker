/**
 * Two-stage paginated read - DTO contract (#2944)
 *
 * Two claims this pair makes are made at the TYPE level, and a type says
 * nothing about what the validation pipe does at runtime:
 *
 * 1. `?withTotal=false` is honoured, and a stray value is REFUSED rather than
 *    silently ignored. If it were ignored, a caller asking to skip the count
 *    would pay for it anyway and never know.
 * 2. Each `/count` DTO accepts exactly the filters its list DTO accepts. They
 *    are derived with `OmitType` so they cannot drift by hand - but `OmitType`
 *    has to carry INHERITED members (`withTotal` comes from a base class), and
 *    that is a runtime question about class-validator's metadata, not a
 *    compile-time one.
 *
 * `main.ts` runs the pipe with `whitelist` + `forbidNonWhitelisted`, so a
 * filter the count DTO failed to inherit would 400 a legitimate request rather
 * than fail quietly. That is the failure this spec exists to catch.
 *
 * @module apps/api/src/common/dto
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListOrdersQueryDto } from '../../orders/http/dto/list-orders-query.dto';
import { CountOrdersQueryDto } from '../../orders/http/dto/count-orders-query.dto';
import { ListCustomersQueryDto } from '../../customers/http/dto/list-customers-query.dto';
import { CountCustomersQueryDto } from '../../customers/http/dto/count-customers-query.dto';
import { ListProductsQueryDto } from '../../products/http/dto/list-products-query.dto';
import { CountProductsQueryDto } from '../../products/http/dto/count-products-query.dto';
import { ListOfferMappingsQueryDto } from '../../listings/http/dto/list-offer-mappings-query.dto';
import { CountOfferMappingsQueryDto } from '../../listings/http/dto/count-offer-mappings-query.dto';

/** Mirrors `main.ts`'s pipe: query params arrive as strings and are coerced. */
function check<T extends object>(cls: new () => T, query: Record<string, string>): string[] {
  const instance = plainToInstance(cls, query, { enableImplicitConversion: false });
  return validateSync(instance, { whitelist: true, forbidNonWhitelisted: true }).flatMap((e) =>
    Object.values(e.constraints ?? {})
  );
}

describe('PaginatedReadQueryDto - the ?withTotal opt-out (#2944)', () => {
  it.each([
    ['orders', ListOrdersQueryDto],
    ['customers', ListCustomersQueryDto],
    ['products', ListProductsQueryDto],
    ['listings', ListOfferMappingsQueryDto],
  ])('accepts withTotal=false on the %s list DTO', (_name, cls) => {
    expect(check(cls as new () => object, { withTotal: 'false' })).toEqual([]);
  });

  it.each([
    ['orders', ListOrdersQueryDto],
    ['customers', ListCustomersQueryDto],
    ['products', ListProductsQueryDto],
    ['listings', ListOfferMappingsQueryDto],
  ])('coerces withTotal to a real boolean on the %s list DTO', (_name, cls) => {
    const instance = plainToInstance(cls as new () => { withTotal?: boolean }, {
      withTotal: 'false',
    });
    // `'false'` is a truthy STRING. If the transform were missing, the handler's
    // `withTotal === false` test would never fire and the caller would silently
    // pay for the count it asked to skip.
    expect(instance.withTotal).toBe(false);
    expect(plainToInstance(cls as new () => { withTotal?: boolean }, { withTotal: 'true' })
      .withTotal).toBe(true);
  });

  it.each([
    ['orders', ListOrdersQueryDto],
    ['customers', ListCustomersQueryDto],
    ['products', ListProductsQueryDto],
    ['listings', ListOfferMappingsQueryDto],
  ])('REFUSES a stray withTotal value on the %s list DTO', (_name, cls) => {
    // Passed through unchanged for `@IsBoolean()` to reject with a 400, the
    // house idiom. Mapping it to `undefined` would make `?withTotal=maybe`
    // silently pay for the count.
    expect(check(cls as new () => object, { withTotal: 'maybe' }).join(' ')).toMatch(/boolean/i);
  });

  it('leaves withTotal absent when the caller does not send it', () => {
    const instance = plainToInstance(ListOrdersQueryDto, { limit: '20' });
    expect(instance.withTotal).toBeUndefined();
  });
});

describe('Count query DTOs are OmitType of their list DTO (#2944)', () => {
  it.each([
    ['orders', CountOrdersQueryDto],
    ['customers', CountCustomersQueryDto],
    ['products', CountProductsQueryDto],
    ['listings', CountOfferMappingsQueryDto],
  ])('drops the page arguments on %s/count', (_name, cls) => {
    // `forbidNonWhitelisted` is what makes this observable: a property the
    // count DTO does not declare is rejected, not ignored.
    const errors = check(cls as new () => object, { limit: '20', offset: '40' }).join(' ');
    expect(errors).toMatch(/limit/);
    expect(errors).toMatch(/offset/);
  });

  it.each([
    ['orders', CountOrdersQueryDto],
    ['customers', CountCustomersQueryDto],
    ['products', CountProductsQueryDto],
    ['listings', CountOfferMappingsQueryDto],
  ])('drops the withTotal opt-out on %s/count, inherited though it is', (_name, cls) => {
    // The property this most easily gets wrong: `withTotal` is declared on a
    // BASE class, so omitting it depends on `OmitType` carrying inherited
    // validation metadata. A count takes no page, so it must not accept it.
    expect(check(cls as new () => object, { withTotal: 'false' }).join(' ')).toMatch(/withTotal/);
  });

  it('keeps every one of the orders list filters, which is the point of OmitType', () => {
    // The list carries sixteen filters and the count must apply all of them. A
    // hand-copied second class is how the two drift until the total describes a
    // different set than the page.
    expect(
      check(CountOrdersQueryDto, {
        sourceConnectionId: '11111111-1111-4111-8111-111111111111',
        syncStatus: 'failed',
        customerId: 'ol_customer_1',
        createdFrom: '2026-01-01T00:00:00.000Z',
        createdTo: '2026-02-01T00:00:00.000Z',
        recordStatus: 'ready',
        health: 'needs_attention',
        dueBefore: '2026-03-01T00:00:00.000Z',
        slaState: 'overdue',
        fulfillmentState: 'dispatched',
        salesDocumentBlocked: 'true',
        cancelled: 'true',
        phase: 'cancelled',
        taxRateConflict: 'true',
        attention: 'true',
        hold: 'fraud-review',
      })
    ).toEqual([]);
  });

  it('keeps the listings lifecycle and lifecycle-counts filters', () => {
    expect(
      check(CountOfferMappingsQueryDto, {
        connectionId: '11111111-1111-4111-8111-111111111111',
        internalId: 'ol_variant_1',
        search: 'widget',
        lifecycle: 'Active',
        includeLifecycleCounts: 'true',
      })
    ).toEqual([]);
  });

  it('drops sort and dir on products/count, since ordering cannot change a count', () => {
    const errors = check(CountProductsQueryDto, { sort: 'name', dir: 'asc' }).join(' ');
    expect(errors).toMatch(/sort/);
    expect(errors).toMatch(/dir/);
  });
});
