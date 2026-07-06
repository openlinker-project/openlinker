/**
 * useBulkIssueInvoicesMutation tests (#1355)
 *
 * @module apps/web/src/features/invoicing/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BulkIssueInvoicesResult } from '../api/invoicing.types';
import { useBulkIssueInvoicesMutation } from './use-bulk-issue-invoices-mutation';

describe('useBulkIssueInvoicesMutation', () => {
  it('calls bulkIssue and resolves to the aggregate per-id summary', async () => {
    const result: BulkIssueInvoicesResult = {
      issued: 1,
      skipped: 1,
      failed: 0,
      results: [
        { orderId: 'ol_order_1', outcome: 'issued', invoiceId: 'inv_1' },
        { orderId: 'ol_order_2', outcome: 'skipped', reason: 'already issued' },
      ],
    };
    const bulkIssue = vi.fn().mockResolvedValue(result);

    let capturedMutation: ReturnType<typeof useBulkIssueInvoicesMutation> | undefined;

    function Harness(): null {
      capturedMutation = useBulkIssueInvoicesMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { bulkIssue } }),
    });

    capturedMutation!.mutate({ connectionId: 'conn_1', orderIds: ['ol_order_1', 'ol_order_2'] });

    await waitFor(() => expect(capturedMutation!.isSuccess).toBe(true));

    expect(capturedMutation!.data).toEqual(result);
    expect(bulkIssue).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      orderIds: ['ol_order_1', 'ol_order_2'],
    });
  });

  it('surfaces the error when bulkIssue rejects', async () => {
    const bulkIssue = vi.fn().mockRejectedValue(new Error('provider unavailable'));

    let capturedMutation: ReturnType<typeof useBulkIssueInvoicesMutation> | undefined;

    function Harness(): null {
      capturedMutation = useBulkIssueInvoicesMutation();
      return null;
    }

    renderWithProviders(<Harness />, {
      apiClient: createMockApiClient({ invoicing: { bulkIssue } }),
    });

    capturedMutation!.mutate({ connectionId: 'conn_1', orderIds: ['ol_order_1'] });

    await waitFor(() => expect(capturedMutation!.isError).toBe(true));
    expect(capturedMutation!.error?.message).toBe('provider unavailable');
  });
});
