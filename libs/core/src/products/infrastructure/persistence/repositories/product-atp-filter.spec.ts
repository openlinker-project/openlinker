/**
 * Product stock filter predicate (#3621, G-5)
 *
 * `out` / `low` on the product list read available to promise, so they must
 * agree with the badge. The numeric behaviour (master 40 / held 37 -> low,
 * master 2 / held 2 -> out, stale position ignored, diagnostic hold ignored) is
 * proved against real Postgres in `paginated-total-split.int-spec.ts`; this
 * spec pins the restated published-hold fragment to the canonical one so the
 * two cannot drift apart silently.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRODUCT_ATP_SUBQUERY } from './product.repository';

const CANONICAL = readFileSync(
  join(
    __dirname,
    '../../../../inventory/infrastructure/persistence/sql/published-reserved-sum.ts',
  ),
  'utf8',
);

describe('PRODUCT_ATP_SUBQUERY', () => {
  it('should count only held, published reservations like the canonical fragment', () => {
    expect(CANONICAL).toContain(`"r_pub"."status" = 'held'`);
    expect(CANONICAL).toContain(`"r_pub"."atpEffect" = 'published'`);
    expect(PRODUCT_ATP_SUBQUERY).toContain(`"r_pub"."status" = 'held'`);
    expect(PRODUCT_ATP_SUBQUERY).toContain(`"r_pub"."atpEffect" = 'published'`);
    expect(PRODUCT_ATP_SUBQUERY).toContain(`"r_pub"."inventoryItemId" = ii."id"`);
  });

  it('should ignore stale positions and clamp each variant at zero before summing', () => {
    expect(PRODUCT_ATP_SUBQUERY).toContain('ii."isStale" = false');
    expect(PRODUCT_ATP_SUBQUERY).toContain('GREATEST(0, v."available" - v."held")');
    expect(PRODUCT_ATP_SUBQUERY).toContain('GROUP BY ii."productId", ii."productVariantId"');
  });

  it('should interpolate no value', () => {
    expect(PRODUCT_ATP_SUBQUERY).not.toMatch(/\$\d|\$\{/);
  });
});
