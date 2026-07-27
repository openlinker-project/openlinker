/**
 * KSeF plugin — test-only mock defaults
 *
 * Provides the `invoiceNumbering` namespace default the test ApiClient folds in
 * when a test doesn't override it. The default route + series reads resolve
 * empty, so a KSeF connection's Actions row renders its "not set up yet" state
 * without a per-test override. Co-located with the plugin per the `*.mocks.ts`
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
      getSeriesAudit: vi.fn().mockResolvedValue({
        seriesId: '',
        seriesName: '',
        skippedInferenceApplied: false,
        summary: {
          issuedCount: 0,
          pendingCount: 0,
          abandonedCount: 0,
          skippedCount: 0,
          gapCount: 0,
          explainedGapCount: 0,
        },
        entries: [],
      }),
      recordGapNote: vi.fn(),
      listRoutes: vi.fn().mockResolvedValue([]),
      upsertRoute: vi.fn(),
      deleteRoute: vi.fn().mockResolvedValue(undefined),
    } satisfies NumberingApi,
  };
}
