import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';

interface UpdatePackStationLabelVariables {
  userId: string;
  /** `null` clears the label — see the DTO's own docblock for why. */
  packStationLabel: string | null;
}

/** `PATCH /users/:id/pack-station-label` (#3404) — admin only. */
export function useUpdatePackStationLabelMutation(): UseMutationResult<
  void,
  Error,
  UpdatePackStationLabelVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, packStationLabel }) =>
      apiClient.users.updatePackStationLabel(userId, { packStationLabel }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    },
  });
}
