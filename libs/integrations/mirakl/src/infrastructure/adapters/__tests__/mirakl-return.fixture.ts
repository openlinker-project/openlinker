/**
 * Mirakl return fixture (#4279)
 *
 * Shaped like Mirakl's RT11 documentation; no real Empik staging return
 * exists yet. Synthetic data only.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { MiraklReturn } from '../../../domain/types/mirakl-return.types';

export function buildMiraklReturn(overrides: Partial<MiraklReturn> = {}): MiraklReturn {
  return {
    id: 'R-1001',
    order_id: '1001-A',
    order_commercial_id: '1001',
    state: 'WAITING_ACCEPTANCE',
    date_created: '2026-11-23T10:00:00Z',
    last_updated: '2026-11-23T10:05:00Z',
    reason_code: 'RETURN_CHANGED_MIND',
    rma: 'RMA-77',
    method_code: 'RETURN_METHOD_BY_MAIL',
    return_lines: [{ order_line_id: '1001-A-1', quantity: 1, reason_code: 'RETURN_BROKEN_ITEM' }],
    ...overrides,
  };
}
