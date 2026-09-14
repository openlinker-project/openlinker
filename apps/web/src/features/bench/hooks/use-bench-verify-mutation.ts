/**
 * Verify one unit into the box (#2418, `W3b-5`, stories E1/E3/E4/E5, G3)
 *
 * ## One mutation for BOTH paths, and that is decision D20
 *
 * A scan and a hand-confirm call this with the same two fields, so there is no
 * branch here, no flag on the request and nothing downstream that could tell
 * them apart. A second mutation for the manual path would be the stigma D20
 * refuses even if the wire stayed identical, because the next person to add a
 * field would add it to one of the two.
 *
 * ## It is the first sender of a gesture id, and therefore the first settler
 *
 * `settleGesture` shipped with #2416's log and had no caller. That is why the
 * log carries a bound and drops its oldest entry: without a settler, a bench tab
 * open for a shift would accumulate one entry per scan of the day, and the
 * eviction that keeps it bounded would then throw away an id that a retry still
 * needed — the retry would mint a fresh one and the server would record a second
 * unit for one physical scan, which is the exact failure G3 exists to prevent.
 *
 * A gesture is settled once the SERVER HAS ANSWERED — verified, deduplicated or
 * refused alike. All three mean the id has done its job: nothing will resend it,
 * and the packer's next physical act mints its own. A network failure settles
 * NOTHING, because that is the one case where the same id may legitimately go
 * out again.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchParcel, BenchVerificationResult } from '../api/bench-parcel.types';
import { isNewerParcelRead } from '../lib/bench-parcel-presentation';
import { settleGesture } from '../lib/scanner-gesture-log';

export interface BenchVerifyInput {
  readonly workId: string;
  readonly workLineId: string;
  /**
   * One physical act. Minted through `beginGesture` — the SAME call for a scan
   * and for a hand-confirm, so the two ids are indistinguishable in shape as
   * well as in the request that carries them.
   */
  readonly gestureId: string;
}

export function useBenchVerifyMutation(): UseMutationResult<
  BenchVerificationResult,
  Error,
  BenchVerifyInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ workId, workLineId, gestureId }: BenchVerifyInput) =>
      apiClient.bench.verifyUnit(workId, { workLineId, gestureId }),
    onSuccess: (result, variables) => {
      // The server answered. Whatever it answered, this id is spent.
      settleGesture(variables.gestureId);
      // The response already carries the parcel as it now stands, so the
      // surface re-renders from it without waiting for a poll. A refusal
      // carries it too, which is what makes the count visibly NOT move.
      //
      // Guarded on `version` (#2421, H2). A fast packer has several gestures in
      // flight and nothing orders the answers, so an unguarded write lets an
      // EARLIER answer land last and show a lower count than the server holds.
      // See `isNewerParcelRead` for why that is invisible under D18's
      // auto-close.
      queryClient.setQueryData<BenchParcel>(
        benchQueryKeys.parcel(variables.workId),
        (cached) => (isNewerParcelRead(result.parcel, cached) ? result.parcel : cached)
      );
      // The list holds this parcel's row; a box that just closed must not keep
      // sitting in the queue behind the packer.
      void queryClient.invalidateQueries({ queryKey: benchQueryKeys.work() });
      if (result.parcel.closedAt !== null) {
        void queryClient.invalidateQueries({
          queryKey: benchQueryKeys.documents(variables.workId),
        });
      }
    },
    // Deliberately no `onError` settle — see the module docblock.
  });
}
