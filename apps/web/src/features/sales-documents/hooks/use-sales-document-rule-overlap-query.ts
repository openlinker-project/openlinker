/**
 * Rule overlap check (#3190)
 *
 * Asks the backend whether the draft in the composer could match the same
 * order as a rule already saved. A QUERY rather than a mutation: the endpoint
 * persists nothing.
 *
 * It returns a STATE alongside the verdict, not a bare `UseQueryResult`, and
 * that is the whole point of the hook (#3190 review). The composer gates its
 * save on this answer, so every moment in which the answer is not yet about
 * the draft on screen has to be nameable - otherwise an absent banner reads as
 * "no conflict", which is the single answer this feature exists to make
 * impossible. Three such moments exist and all three used to render
 * identically to a clean verdict:
 *
 *  - the draft changed and the debounce has not elapsed (`settling`),
 *  - the check is in flight (`pending`),
 *  - the draft is not yet a rule the server would accept (`incomplete`).
 *
 * The shape is copied from `shared/hooks/use-paginated-total.ts`, which states
 * the same rule for the same reason ("`idle` and `unavailable` are kept apart
 * because a surface renders them differently").
 *
 * One deliberate departure from that sibling, and one deliberate NON-change,
 * both because what is at stake differs:
 *
 *  1. **`placeholderData` IS used here.** The total hook refuses it because a
 *     superseded NUMBER looks authoritative; here the superseded thing is a
 *     warning banner, and keeping it on screen through a refetch is strictly
 *     safer than letting it blink out - the save is disabled for the whole of
 *     that window anyway (`state === 'pending'`), so the stale verdict can
 *     never be acted on.
 *  2. **`gcTime` is left at its DEFAULT, deliberately.** The composer never
 *     unmounts - `SalesDocumentRulesList` renders it unconditionally and
 *     toggles Radix's `open`, not React's mount - so this hook's own query
 *     observer is never garbage-collected between opens regardless of what
 *     `gcTime` says: eviction only happens once every observer of a cache
 *     entry unsubscribes, and this one never does. So on reopen (after
 *     `reset()` returns the draft to its default), the query CAN answer
 *     `known` from the same key it answered before - but `staleTime: 0` also
 *     means that answer is immediately refetched, and the save stays gated on
 *     `connectionId` (which `reset()` also clears) regardless. A visible but
 *     momentarily-stale reassurance banner on a draft the operator has not yet
 *     touched is a smaller risk than the alternative these two settings would
 *     buy nothing against.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useDebouncedValue } from '../../../shared/hooks/use-debounced-value';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type {
  CheckSalesDocumentRuleOverlapInput,
  SalesDocumentRuleOverlapVerdict,
} from '../api/sales-document-rules.types';

/**
 * How long the draft must settle before it is sent.
 *
 * `TOTAL_DEBOUNCE_MS`'s value, for its reason: without it every character
 * typed into an amount, a currency or a country mints a cache entry and a
 * `findByCountry` read, and the conflict banner - an assertive `role="alert"` -
 * is re-announced to a screen-reader user once per keystroke.
 */
export const OVERLAP_DEBOUNCE_MS = 400;

/**
 * What the check is doing right now.
 *
 * - `known`       the verdict is about the draft on screen
 * - `settling`    the draft changed and the debounce has not elapsed
 * - `pending`     the check is in flight
 * - `incomplete`  the draft is not yet a rule the server would accept
 * - `unavailable` the check was asked for and FAILED
 *
 * Only `known` may be read as an answer. The composer keeps the save inert for
 * every other value except `unavailable`, which is deliberately not evidence
 * of a collision.
 */
export type SalesDocumentRuleOverlapState =
  | 'known'
  | 'settling'
  | 'pending'
  | 'incomplete'
  | 'unavailable';

export interface SalesDocumentRuleOverlapResult {
  /**
   * The last verdict this hook received, or `null` when it has none.
   *
   * NOT necessarily about the draft on screen - read `state` first. It is
   * surfaced during `settling` / `pending` so a standing banner does not blink
   * out mid-keystroke, never so it can be acted on.
   */
  verdict: SalesDocumentRuleOverlapVerdict | null;
  state: SalesDocumentRuleOverlapState;
}

export function useSalesDocumentRuleOverlapQuery(
  input: CheckSalesDocumentRuleOverlapInput,
  /** `true` once the dialog is open AND the draft is one the server would accept. */
  enabled: boolean
): SalesDocumentRuleOverlapResult {
  const apiClient = useApiClient();

  // The draft is debounced as its own SERIALISATION, then parsed back, rather
  // than as the object. `input` is rebuilt on every render, so debouncing the
  // object would restart the timer on every render and - because settling sets
  // state, which renders - never converge. The value is plain JSON data
  // (strings, arrays, `null`), so the round trip is exact.
  const draftKey = JSON.stringify(input);
  const settledKey = useDebouncedValue(draftKey, OVERLAP_DEBOUNCE_MS);
  const settledInput = useMemo(
    () => JSON.parse(settledKey) as CheckSalesDocumentRuleOverlapInput,
    [settledKey]
  );

  const query = useQuery({
    queryKey: salesDocumentRulesQueryKeys.overlapCheck(settledInput),
    queryFn: () => apiClient.salesDocumentRules.checkRuleOverlap(settledInput),
    enabled,
    // A conflict verdict is about rules the operator may be editing in another
    // tab, so it is re-asked whenever this hook remounts.
    staleTime: 0,
    // Keep the standing verdict across a key change. Without it `data` is
    // `undefined` for the whole refetch, every banner falls back to nothing,
    // and the composer renders as "no conflict" on the common path.
    placeholderData: (previous) => previous,
  });

  const verdict = query.data ?? null;
  return { verdict, state: resolveState({ enabled, settled: draftKey === settledKey, query }) };
}

function resolveState(args: {
  enabled: boolean;
  settled: boolean;
  query: { isFetching: boolean; isError: boolean; data: SalesDocumentRuleOverlapVerdict | undefined };
}): SalesDocumentRuleOverlapState {
  // Ordered by what the caller must NOT mistake for an answer. `incomplete`
  // outranks everything because no request was made at all; `settling` outranks
  // `pending` because during the debounce the query is not fetching and its
  // `data` is about the draft the operator has already left - the window a
  // plain `isFetching` check misses entirely.
  if (!args.enabled) return 'incomplete';
  if (!args.settled) return 'settling';
  if (args.query.isFetching) return 'pending';
  if (args.query.isError) return 'unavailable';
  return args.query.data === undefined ? 'pending' : 'known';
}
