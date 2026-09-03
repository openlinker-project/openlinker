/**
 * Order Hold Request DTOs — validation spec (#2341)
 *
 * The load-bearing assertion is that `reason` is checked against the CLOSED
 * `HoldReasonValues` union: an unrecognised reason must be refused at the
 * boundary rather than reaching the domain, where nothing would map it.
 *
 * @module apps/api/src/orders/http/dto
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { HoldReasonValues } from '@openlinker/core/order-lifecycle';

import { PlaceOrderHoldRequestDto } from './place-order-hold-request.dto';
import { ReleaseOrderHoldRequestDto } from './release-order-hold-request.dto';
import { ListOrdersQueryDto } from './list-orders-query.dto';

describe('PlaceOrderHoldRequestDto', () => {
  const build = (payload: Record<string, unknown>): PlaceOrderHoldRequestDto =>
    plainToInstance(PlaceOrderHoldRequestDto, payload);

  it.each(HoldReasonValues)(
    'should accept the closed-union reason "%s"',
    async (reason) => {
      const errors = await validate(build({ reason }));

      expect(errors).toHaveLength(0);
    }
  );

  it('should reject a reason outside the closed union', async () => {
    const errors = await validate(build({ reason: 'because-i-said-so' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('reason');
  });

  it('should reject a missing reason', async () => {
    const errors = await validate(build({}));

    expect(errors.map((e) => e.property)).toContain('reason');
  });

  it('should accept an omitted note', async () => {
    const errors = await validate(build({ reason: 'operator' }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a note longer than the 2000-character cap', async () => {
    const errors = await validate(
      build({ reason: 'operator', note: 'x'.repeat(2001) })
    );

    expect(errors.map((e) => e.property)).toContain('note');
  });
});

describe('ReleaseOrderHoldRequestDto', () => {
  const build = (payload: Record<string, unknown>): ReleaseOrderHoldRequestDto =>
    plainToInstance(ReleaseOrderHoldRequestDto, payload);

  it('should accept an omitted note — the mandatory case is a domain rule, not a shape rule', async () => {
    const errors = await validate(build({}));

    expect(errors).toHaveLength(0);
  });

  it('should reject a note longer than the 2000-character cap', async () => {
    const errors = await validate(build({ note: 'x'.repeat(2001) }));

    expect(errors.map((e) => e.property)).toContain('note');
  });
});

/**
 * The `?hold=` list filter (#2342).
 *
 * Validated against the same closed union as the write body, and for the same
 * reason: an unrecognised reason must be refused at the boundary. Silently
 * dropping it would return the UNFILTERED list while the operator's select
 * renders as applied — a worse failure for a filter than a 400.
 */
describe('ListOrdersQueryDto — hold filter (#2342)', () => {
  const build = (payload: Record<string, unknown>): ListOrdersQueryDto =>
    plainToInstance(ListOrdersQueryDto, payload);

  it.each(HoldReasonValues)('should accept the closed-union reason "%s"', async (hold) => {
    const errors = await validate(build({ hold }));

    expect(errors).toHaveLength(0);
  });

  it('should reject a reason outside the closed union', async () => {
    const errors = await validate(build({ hold: 'not-a-reason' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('hold');
  });

  it('should accept an omitted filter — the axis is optional', async () => {
    const errors = await validate(build({}));

    expect(errors).toHaveLength(0);
  });
});
