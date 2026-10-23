/**
 * Sourcing-rules read hooks (#3056)
 *
 * The property worth holding: neither read fires without the ids it needs. The
 * page takes `connectionId` from a route param, so it is legitimately absent
 * for a render or two — firing anyway requests `/connections//sourcing-rules`
 * and surfaces a 404 as if the ruleset were missing.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { useSourcingRuleQuery } from './use-sourcing-rule-query';
import { useSourcingRulesQuery } from './use-sourcing-rules-query';

function renderHook<T>(useHook: () => T, sourcingRules: Record<string, unknown>): { current: T } {
  const captured = { current: undefined as T };

  function Probe(): null {
    captured.current = useHook();
    return null;
  }

  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ sourcingRules: sourcingRules as never }),
  });

  return captured as { current: T };
}

describe('useSourcingRulesQuery (#3056)', () => {
  it('should read the connection rules with the filter it was given', async () => {
    const list = vi.fn().mockResolvedValue([]);
    renderHook(() => useSourcingRulesQuery('conn_1', { includeSuperseded: true }), { list });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith('conn_1', { includeSuperseded: true });
    });
  });

  it('should not fire without a connection id', async () => {
    const list = vi.fn().mockResolvedValue([]);
    renderHook(() => useSourcingRulesQuery(undefined), { list });

    await waitFor(() => {
      expect(list).not.toHaveBeenCalled();
    });
  });

  it('should not fire for an empty connection id', async () => {
    const list = vi.fn().mockResolvedValue([]);
    renderHook(() => useSourcingRulesQuery(''), { list });

    await waitFor(() => {
      expect(list).not.toHaveBeenCalled();
    });
  });
});

describe('useSourcingRuleQuery (#3056)', () => {
  it('should read one rule when both ids are present', async () => {
    const get = vi.fn().mockResolvedValue(null);
    renderHook(() => useSourcingRuleQuery('conn_1', 'rule_1'), { get });

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('conn_1', 'rule_1');
    });
  });

  it('should not fire when either id is missing', async () => {
    const get = vi.fn().mockResolvedValue(null);
    renderHook(() => useSourcingRuleQuery('conn_1', undefined), { get });
    renderHook(() => useSourcingRuleQuery(undefined, 'rule_1'), { get });

    await waitFor(() => {
      expect(get).not.toHaveBeenCalled();
    });
  });
});
