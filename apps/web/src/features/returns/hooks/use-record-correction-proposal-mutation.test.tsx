/**
 * `useRecordCorrectionProposalMutation` unit tests (#3089).
 *
 * The one behaviour worth pinning: success SEEDS the preview query's cache
 * with the response rather than invalidating it, because the record response
 * is documented as "the same computation as the GET, additionally recorded" —
 * i.e. already the answer a refetch would produce, plus `changeId`/`opened`.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRecordCorrectionProposalMutation } from './use-record-correction-proposal-mutation';
import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import { returnsQueryKeys } from '../api/returns.query-keys';
import type { ReturnCorrectionProposalResult } from '../api/returns.types';

const RETURN_ID = 'ol_return_1';

function proposalResult(
  overrides: Partial<ReturnCorrectionProposalResult> = {},
): ReturnCorrectionProposalResult {
  return { outcome: 'nothing-correctable', proposal: null, changeId: null, opened: false, ...overrides };
}

function setup() {
  const recorded = proposalResult({ changeId: 'ol_order_change_1', opened: true });
  const returns = { recordCorrectionProposal: vi.fn().mockResolvedValue(recorded) };
  const apiClient = createMockApiClient({ returns });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );

  const { result } = renderHook(() => useRecordCorrectionProposalMutation(RETURN_ID), { wrapper });
  return { returns, recorded, setDataSpy, invalidateSpy, result };
}

describe('useRecordCorrectionProposalMutation (#3089)', () => {
  it('records the proposal for the given return', async () => {
    const { returns, result } = setup();

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(returns.recordCorrectionProposal).toHaveBeenCalledWith(RETURN_ID);
  });

  it('seeds the preview cache with the response instead of invalidating it', async () => {
    const { recorded, setDataSpy, invalidateSpy, result } = setup();

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setDataSpy).toHaveBeenCalledWith(
      returnsQueryKeys.correctionProposal(RETURN_ID),
      recorded,
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
