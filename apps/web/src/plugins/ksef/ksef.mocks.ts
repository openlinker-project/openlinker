/**
 * KSeF plugin — test-only mock defaults (#1577)
 *
 * Provides the `invoiceNumbering` namespace default the test ApiClient folds in
 * when a test doesn't override it. The default assignment read rejects with a
 * 404 (the `useNumberingAssignmentQuery` maps that to "not set up yet"), so a
 * KSeF connection's Actions row renders its unconfigured state without a
 * per-test override. Co-located with the plugin per the `*.mocks.ts`
 * convention; never imported by production code.
 *
 * @module plugins/ksef
 */
import { vi } from 'vitest';

import type { PluginApiNamespaces } from '../../app/api/api-client';
import type { NumberingApi } from '../../features/invoicing';
import { ApiError } from '../../shared/api/api-error';

export function ksefMockApiNamespaces(): Partial<PluginApiNamespaces> {
  return {
    invoiceNumbering: {
      listSeries: vi.fn().mockResolvedValue([]),
      listUnassigned: vi.fn().mockResolvedValue([]),
      getSeries: vi.fn().mockRejectedValue(new ApiError('Not found', 404, null)),
      createSeries: vi.fn(),
      updateSeries: vi.fn(),
      getAssignment: vi.fn().mockRejectedValue(new ApiError('No assignment', 404, null)),
      setAssignment: vi.fn(),
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    } satisfies NumberingApi,
  };
}
