/**
 * Order edit form schema and request planning unit tests (#3544).
 */
import { describe, expect, it } from 'vitest';

import { parseOrderSnapshot } from '../api/order-snapshot.schema';
import {
  buildOrderEditInitialValues,
  buildOrderEditLineMeta,
  buildOrderEditSchema,
  detectChangedSections,
  planOrderEdits,
  type OrderEditFormValues,
} from './order-edit-dialog.schema';

const snapshot = parseOrderSnapshot({
  orderNumber: 'ALG-1',
  items: [
    { id: 'line_a', name: 'Mug', sku: 'MUG', quantity: 3, price: 39 },
    { id: 'line_b', name: 'Plate', sku: 'PLT', quantity: 2, price: 54 },
  ],
  totals: { subtotal: 225, tax: 0, shipping: 14.99, total: 239.99, currency: 'PLN' },
  shipping: { methodId: 'inpost_kurier', methodName: 'InPost Kurier' },
  shippingAddress: {
    firstName: 'Magdalena',
    lastName: 'Wisniewska',
    address1: 'ul. Dluga 12',
    city: 'Krakow',
    postalCode: '31-147',
    country: 'PL',
  },
});

const initial = buildOrderEditInitialValues(snapshot, null);
const lineMax = { line_a: 3, line_b: 2 };
const schema = buildOrderEditSchema(initial, lineMax);

function values(overrides: Partial<OrderEditFormValues> = {}): OrderEditFormValues {
  return { ...initial, lines: initial.lines.map((line) => ({ ...line })), ...overrides };
}

describe('buildOrderEditInitialValues', () => {
  it('should open with the order as it is now', () => {
    expect(initial.address1).toBe('ul. Dluga 12');
    expect(initial.methodId).toBe('inpost_kurier');
    expect(initial.lines).toEqual([
      { orderLineId: 'line_a', quantity: '3' },
      { orderLineId: 'line_b', quantity: '2' },
    ]);
    expect(initial.discountValue).toBe('');
  });

  it('should show the channel quantity beside a line already lowered', () => {
    const meta = buildOrderEditLineMeta(snapshot, {
      editedAt: 'x',
      address: null,
      lines: [{ orderLineId: 'line_a', channelQuantity: 5, quantity: 3 }],
      deliveryMethod: null,
      totals: null,
      discount: null,
      discountProposals: [],
      cod: null,
      history: [],
    });
    expect(meta[0]).toMatchObject({ orderLineId: 'line_a', maxQuantity: 3, channelQuantity: 5 });
    expect(meta[1]).toMatchObject({ maxQuantity: 2, channelQuantity: 2 });
  });
});

describe('detectChangedSections', () => {
  it('should report nothing for an untouched form', () => {
    expect(detectChangedSections(values(), initial).size).toBe(0);
  });

  it('should report each section the operator changed', () => {
    const changed = detectChangedSections(
      values({
        address1: 'ul. Dluga 12/4',
        methodId: 'dpd',
        lines: [
          { orderLineId: 'line_a', quantity: '2' },
          { orderLineId: 'line_b', quantity: '2' },
        ],
        discountValue: '15.00',
      }),
      initial,
    );
    expect([...changed].sort()).toEqual(['address', 'delivery', 'discount', 'lines']);
  });

  it('should treat a blank discount as untouched, and the same amount as unchanged', () => {
    const withDiscount = { ...initial, discountValue: '15.00' };
    expect(detectChangedSections({ ...withDiscount, discountValue: '' }, withDiscount).size).toBe(0);
    expect(detectChangedSections({ ...withDiscount, discountValue: '15' }, withDiscount).size).toBe(0);
    expect(detectChangedSections({ ...withDiscount, discountValue: '0' }, withDiscount).has('discount')).toBe(true);
  });
});

describe('schema', () => {
  it('should refuse raising a quantity', () => {
    const result = schema.safeParse(
      values({
        lines: [
          { orderLineId: 'line_a', quantity: '4' },
          { orderLineId: 'line_b', quantity: '2' },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('Can only go down: at most 3');
  });

  it('should refuse lowering every line to zero', () => {
    const result = schema.safeParse(
      values({
        lines: [
          { orderLineId: 'line_a', quantity: '0' },
          { orderLineId: 'line_b', quantity: '0' },
        ],
      }),
    );
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('at least one item');
  });

  it('should refuse a non-integer quantity and a bad discount, but only for a changed section', () => {
    expect(
      schema.safeParse(
        values({
          lines: [
            { orderLineId: 'line_a', quantity: '1.5' },
            { orderLineId: 'line_b', quantity: '2' },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(schema.safeParse(values({ discountValue: 'abc' })).success).toBe(false);
    expect(schema.safeParse(values({ discountMode: 'percent', discountValue: '120' })).success).toBe(false);
    expect(schema.safeParse(values({ discountMode: 'percent', discountValue: '10' })).success).toBe(true);
  });

  it('should require the address essentials only once the address is changed', () => {
    expect(schema.safeParse(values()).success).toBe(true);
    expect(schema.safeParse(values({ address1: '' })).success).toBe(false);
    expect(schema.safeParse(values({ country: 'Poland', address1: 'x' })).success).toBe(false);
  });

  it('should not block an unrelated edit on a record with no stored address', () => {
    const bare = buildOrderEditInitialValues(
      parseOrderSnapshot({ items: [{ id: 'l', quantity: 2, price: 1 }] }),
      null,
    );
    const bareSchema = buildOrderEditSchema(bare, { l: 2 });
    expect(
      bareSchema.safeParse({ ...bare, lines: [{ orderLineId: 'l', quantity: '1' }] }).success,
    ).toBe(true);
  });
});

describe('planOrderEdits', () => {
  it('should plan one request per changed section, lines before the discount', () => {
    const plan = planOrderEdits(
      values({
        address1: 'ul. Dluga 12/4',
        lines: [
          { orderLineId: 'line_a', quantity: '2' },
          { orderLineId: 'line_b', quantity: '2' },
        ],
        discountValue: '15.00',
      }),
      initial,
      { dryRun: true },
    );
    expect(plan.map((p) => p.section)).toEqual(['address', 'lines', 'discount']);
    expect(plan.every((p) => p.edit.body.dryRun === true)).toBe(true);
  });

  it('should send only the lowered lines and never an untouched acknowledgement', () => {
    const [planned] = planOrderEdits(
      values({
        lines: [
          { orderLineId: 'line_a', quantity: '2' },
          { orderLineId: 'line_b', quantity: '2' },
        ],
      }),
      initial,
      { dryRun: false },
    );
    expect(planned.edit).toEqual({
      kind: 'lines',
      body: { lines: [{ orderLineId: 'line_a', quantity: 2 }] },
    });
  });

  it('should send an acknowledgement only when it is ticked', () => {
    const [planned] = planOrderEdits(
      values({
        acknowledgeAcceptedWork: true,
        lines: [
          { orderLineId: 'line_a', quantity: '2' },
          { orderLineId: 'line_b', quantity: '2' },
        ],
      }),
      initial,
      { dryRun: false },
    );
    expect(planned.edit.body).toMatchObject({ acknowledgeAcceptedWork: true });
  });

  it('should send a discount as an amount string or a percent number, never both', () => {
    const [amount] = planOrderEdits(values({ discountValue: '15.00' }), initial, { dryRun: false });
    expect(amount.edit.body).toEqual({ amount: '15.00' });
    const [percent] = planOrderEdits(
      values({ discountMode: 'percent', discountValue: '10' }),
      initial,
      { dryRun: false },
    );
    expect(percent.edit.body).toEqual({ percent: 10 });
  });

  it('should acknowledge the refund ceiling only when ticked', () => {
    const [planned] = planOrderEdits(
      values({ discountValue: '15.00', acknowledgeAboveCeiling: true }),
      initial,
      { dryRun: false },
    );
    expect(planned.edit.body).toEqual({ amount: '15.00', acknowledgeAboveCeiling: true });
  });

  it('should omit the pickup point unless a code is given, and trim and upper-case the address', () => {
    const [delivery] = planOrderEdits(values({ methodId: ' dpd ' }), initial, { dryRun: false });
    expect(delivery.edit.body).toEqual({ methodId: 'dpd', methodName: 'InPost Kurier' });
    const [address] = planOrderEdits(values({ country: 'pl', city: ' Gdansk ' }), initial, {
      dryRun: false,
    });
    expect(address.edit.body).toMatchObject({ country: 'PL', city: 'Gdansk' });
  });
});
