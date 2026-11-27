/**
 * Shoper setup schema (#4265): the start date is only validated when the wizard
 * asks for it, so an answer to a hidden question cannot block the submit.
 */
import { describe, expect, it } from 'vitest';
import { shoperSetupSchema, toCreateConnectionInput } from './shoper-setup.schema';

const BASE = { name: 'Shop', baseUrl: 'shop.shoparena.pl', token: 'tok' };
const NO_DATE = { mode: 'from' as const };

describe('shoperSetupSchema order start', () => {
  it('should refuse a start date with no day when OrderSource is on, at the path the form reads', () => {
    const result = shoperSetupSchema.safeParse({
      ...BASE,
      enabledCapabilities: ['ProductMaster', 'OrderSource'],
      orderSyncStart: NO_DATE,
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('orderSyncStart.from');
  });

  it('should accept the same value when OrderSource is off, and send no start', () => {
    const parsed = shoperSetupSchema.parse({
      ...BASE,
      enabledCapabilities: ['ProductMaster'],
      orderSyncStart: NO_DATE,
    });

    expect(toCreateConnectionInput(parsed).orderSyncStart).toBeUndefined();
  });

  it('should send a chosen date and newest-first when OrderSource is on', () => {
    const parsed = shoperSetupSchema.parse({
      ...BASE,
      enabledCapabilities: ['OrderSource'],
      orderSyncStart: { mode: 'from', from: '2024-03-01', order: 'newest-first' },
    });

    expect(toCreateConnectionInput(parsed).orderSyncStart).toEqual({
      mode: 'from',
      from: '2024-03-01',
      order: 'newest-first',
    });
  });
});
