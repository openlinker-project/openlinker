import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AllegroSafetyAttachmentUploadResponse } from '../api/allegro.api';
import type { ApiError } from '../../../shared/api/api-error';

export interface UploadSafetyAttachmentInput {
  connectionId: string;
  file: File;
}

/**
 * Uploads a single Allegro safety-information attachment via the
 * BE proxy. The returned id is appended to the connection-edit form's
 * `attachments[]` array — no TanStack Query cache write because the
 * authoritative state lives in form state until the wizard saves.
 * (#449 — see plan §3.3 on state ownership.)
 */
export function useUploadSafetyAttachmentMutation(): UseMutationResult<
  AllegroSafetyAttachmentUploadResponse,
  ApiError,
  UploadSafetyAttachmentInput
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: ({ connectionId, file }) => apiClient.allegro.uploadSafetyAttachment(connectionId, file),
  });
}
