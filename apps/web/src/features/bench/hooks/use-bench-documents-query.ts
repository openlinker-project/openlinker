/**
 * The paper that belongs with this parcel (#2418, `W3b-5`, stories F1–F4)
 *
 * Two reads, and one deliberate asymmetry between them.
 *
 * The documents read is per box and is fetched only once the box is closed,
 * because that is when a packer needs it and F1 is emphatic that nothing here
 * creates a document — fetching earlier would gain nothing and would put a read
 * on the bench during the part of the job that must not be interrupted.
 *
 * The unlabelled read has no work id: it is the SAME list dispatch sees, which
 * is what stops the two disagreeing about a box on a floor. It is fetched only
 * while this bench is actually looking at an unlabelled box, so a healthy bench
 * makes no request for it at all.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchDocuments, BenchUnlabelledParcelList } from '../api/bench-parcel.types';

export function useBenchDocumentsQuery(
  workId: string | null,
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<BenchDocuments> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && workId !== null && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.documents(workId ?? ''),
    queryFn: () => apiClient.bench.getDocuments(workId ?? ''),
    enabled,
  });
}

export function useBenchUnlabelledQuery(
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<BenchUnlabelledParcelList> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.unlabelled(),
    queryFn: () => apiClient.bench.listUnlabelledParcels(),
    enabled,
  });
}
