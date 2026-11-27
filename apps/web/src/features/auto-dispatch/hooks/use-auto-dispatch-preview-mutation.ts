/**
 * Preview automatic labels against a DRAFT configuration (#2729)
 *
 * A mutation only because the draft travels in a POST body: it is a read, buys
 * nothing and writes nothing, so it invalidates nothing on success.
 *
 * @module apps/web/src/features/auto-dispatch/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type {
  AutoDispatchPreview,
  AutoDispatchPreviewRequest,
} from '../api/auto-dispatch.types';

export interface PreviewAutoDispatchInput {
  readonly connectionId: string;
  readonly draft: AutoDispatchPreviewRequest;
}

export function useAutoDispatchPreviewMutation(): UseMutationResult<
  AutoDispatchPreview | null,
  Error,
  PreviewAutoDispatchInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ connectionId, draft }) => apiClient.autoDispatch.preview(connectionId, draft),
  });
}
