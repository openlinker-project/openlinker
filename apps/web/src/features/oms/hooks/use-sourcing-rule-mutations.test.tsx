/**
 * Sourcing-rule mutation hooks (#3056)
 *
 * One cross-consumer property, and it cannot be held by a component test: every
 * write invalidates the whole CONNECTION, never just the query that issued it.
 *
 * The ruleset's meaning is its ORDER, and almost every write moves rows the
 * mutation did not name — a create inserts at a position, a patch can move one,
 * `PUT /order` renumbers all of them. A narrower key would refresh the row that
 * was written and leave a sibling query (the other `includeSuperseded` value, a
 * detail read) rendering positions that are no longer the router's. That is an
 * operator-visible order which is not the order the router uses.
 *
 * So the fixture records the key each hook invalidates and asserts it REACHES
 * sibling keys the hook has never heard of — prefix-matching, the rule TanStack
 * Query itself applies — and that it does NOT reach another connection.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import { useCreateSourcingRuleMutation } from './use-create-sourcing-rule-mutation';
import { useUpdateSourcingRuleMutation } from './use-update-sourcing-rule-mutation';
import { useDeleteSourcingRuleMutation } from './use-delete-sourcing-rule-mutation';
import { useReorderSourcingRulesMutation } from './use-reorder-sourcing-rules-mutation';

const CONNECTION_ID = 'conn_1';
const OTHER_CONNECTION_ID = 'conn_2';

/** A sibling query under the same connection — the shape #3057's table uses. */
const LIST_KEY = sourcingRulesQueryKeys.list(CONNECTION_ID, { includeSuperseded: true });
const DETAIL_KEY = sourcingRulesQueryKeys.detail(CONNECTION_ID, 'rule_1');
const OTHER_CONNECTION_KEY = sourcingRulesQueryKeys.list(OTHER_CONNECTION_ID, {});

interface Harness<TMutation> {
  mutation: TMutation;
  invalidated: unknown[][];
}

function renderMutation<TMutation>(
  useHook: () => TMutation,
  sourcingRules: Record<string, unknown>
): Harness<TMutation> {
  const captured: { mutation?: TMutation; queryClient?: QueryClient } = {};

  function Probe(): null {
    captured.mutation = useHook();
    captured.queryClient = useQueryClient();
    return null;
  }

  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ sourcingRules: sourcingRules as never }),
  });

  const queryClient = captured.queryClient as QueryClient;
  const invalidated: unknown[][] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidated.push(filters.queryKey);
    return original(filters as never);
  }) as QueryClient['invalidateQueries'];

  return { mutation: captured.mutation as TMutation, invalidated };
}

/** Prefix match on serialised segments — the rule TanStack Query applies. */
function reaches(invalidatedKey: unknown[], target: readonly unknown[]): boolean {
  if (invalidatedKey.length > target.length) return false;
  return invalidatedKey.every(
    (segment, index) => JSON.stringify(segment) === JSON.stringify(target[index])
  );
}

async function expectConnectionWideInvalidation(invalidated: unknown[][]): Promise<void> {
  await waitFor(() => {
    expect(invalidated.some((key) => reaches(key, LIST_KEY))).toBe(true);
  });
  expect(invalidated.some((key) => reaches(key, DETAIL_KEY))).toBe(true);
  expect(invalidated.some((key) => reaches(key, OTHER_CONNECTION_KEY))).toBe(false);
}

describe('sourcing-rule mutations (#3056)', () => {
  it('should invalidate every query for the connection when a rule is created', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'rule_1' });
    const { mutation, invalidated } = renderMutation(useCreateSourcingRuleMutation, { create });

    mutation.mutate({
      connectionId: CONNECTION_ID,
      position: 1,
      kind: 'filter',
      name: 'country-served',
      afterAction: 'continue',
    });

    await expectConnectionWideInvalidation(invalidated);
    expect(create).toHaveBeenCalledWith(CONNECTION_ID, {
      position: 1,
      kind: 'filter',
      name: 'country-served',
      afterAction: 'continue',
    });
  });

  it('should invalidate every query for the connection when a rule is patched', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'rule_1' });
    const { mutation, invalidated } = renderMutation(useUpdateSourcingRuleMutation, { update });

    // Retiring a rule IS this mutation with a past effectiveTo — there is no
    // separate retire method, so a second body shape cannot drift into being.
    mutation.mutate({
      connectionId: CONNECTION_ID,
      ruleId: 'rule_1',
      effectiveTo: '2026-01-01T00:00:00.000Z',
    });

    await expectConnectionWideInvalidation(invalidated);
    expect(update).toHaveBeenCalledWith(CONNECTION_ID, 'rule_1', {
      effectiveTo: '2026-01-01T00:00:00.000Z',
    });
  });

  it('should invalidate every query for the connection when a rule is deleted', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { mutation, invalidated } = renderMutation(useDeleteSourcingRuleMutation, { remove });

    mutation.mutate({ connectionId: CONNECTION_ID, ruleId: 'rule_1' });

    await expectConnectionWideInvalidation(invalidated);
  });

  it('should send the caller id list verbatim, never one rebuilt from the cache', async () => {
    const reorder = vi.fn().mockResolvedValue([]);
    const { mutation, invalidated } = renderMutation(useReorderSourcingRulesMutation, { reorder });

    mutation.mutate({ connectionId: CONNECTION_ID, ruleIds: ['rule_2', 'rule_1'] });

    await expectConnectionWideInvalidation(invalidated);
    // The endpoint is exhaustive: a list assembled here from a possibly-stale
    // query would manufacture the very mismatch the server exists to refuse.
    expect(reorder).toHaveBeenCalledWith(CONNECTION_ID, { ruleIds: ['rule_2', 'rule_1'] });
  });

  it('should refresh itself after a reorder conflict, so no row keeps a stale position', async () => {
    const reorder = vi
      .fn()
      .mockRejectedValue(new ApiError('mismatch', 409, { missingRuleIds: ['rule_3'] }));
    const { mutation, invalidated } = renderMutation(useReorderSourcingRulesMutation, { reorder });

    mutation.mutate({ connectionId: CONNECTION_ID, ruleIds: ['rule_2', 'rule_1'] });

    await expectConnectionWideInvalidation(invalidated);
  });

  it('should leave the cache alone for a reorder failure that says nothing about staleness', async () => {
    const reorder = vi.fn().mockRejectedValue(new ApiError('boom', 500, {}));
    const { mutation, invalidated } = renderMutation(useReorderSourcingRulesMutation, { reorder });

    mutation.mutate({ connectionId: CONNECTION_ID, ruleIds: ['rule_1'] });

    await waitFor(() => {
      expect(reorder).toHaveBeenCalledTimes(1);
    });
    expect(invalidated).toHaveLength(0);
  });
});
