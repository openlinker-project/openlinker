/**
 * useSetSourceSyncModeMutation tests (#3729)
 *
 * The write is a full-replace PATCH, so every override the hook fails to
 * re-send is deleted. These cases pin that each axis is re-sent only when the
 * source really owns it, and that a mode-only change never freezes the
 * default rule into a source.
 *
 * @module apps/web/src/features/price-changes/hooks
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ApiClientProvider } from '../../../app/api/api-client-provider';
import { createMockApiClient } from '../../../test/test-utils';
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';
import { useSetSourceSyncModeMutation } from './use-set-source-sync-mode-mutation';

const DEFAULT_RULE = { type: 'margin', percent: 22, rounding: 'endingIn99' } as const;
const OWN_RULE = { type: 'markup', percent: 15, rounding: 'none' } as const;

function view(sources: ConnectionPricingSyncView['sources']): ConnectionPricingSyncView {
  return { default: { mode: 'manual', rule: DEFAULT_RULE }, sources };
}

function source(
  id: string,
  flags: { modeOverridden: boolean; ruleOverridden: boolean },
  effective: ConnectionPricingSyncView['default']
): ConnectionPricingSyncView['sources'][number] {
  return { sourceConnectionId: id, sourceLabel: id, openEpisodeCount: 0, effective, ...flags };
}

async function run(
  current: ConnectionPricingSyncView,
  target: string
): Promise<Record<string, unknown>> {
  const get = vi.fn().mockResolvedValue(current);
  const update = vi.fn().mockResolvedValue(current);
  const apiClient = createMockApiClient({ pricingSync: { get, update } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useSetSourceSyncModeMutation(), { wrapper });
  result.current.mutate({
    destinationConnectionId: 'dest-1',
    sourceConnectionId: target,
    mode: 'automatic',
  });
  await waitFor(() => expect(update).toHaveBeenCalled());
  return (update.mock.calls[0][1] as { sourceOverrides: Record<string, unknown> }).sourceOverrides;
}

describe('useSetSourceSyncModeMutation', () => {
  it('should send only the mode when the changed source inherits the default rule', async () => {
    const overrides = await run(
      view([source('src-1', { modeOverridden: false, ruleOverridden: false }, { mode: 'manual', rule: DEFAULT_RULE })]),
      'src-1'
    );
    expect(overrides).toEqual({ 'src-1': { mode: 'automatic' } });
  });

  it('should keep a rule-only override of the changed source and add the mode', async () => {
    const overrides = await run(
      view([source('src-1', { modeOverridden: false, ruleOverridden: true }, { mode: 'manual', rule: OWN_RULE })]),
      'src-1'
    );
    expect(overrides).toEqual({ 'src-1': { mode: 'automatic', rule: OWN_RULE } });
  });

  it('should re-send other sources per axis and never invent the axis they do not own', async () => {
    const overrides = await run(
      view([
        source('src-1', { modeOverridden: false, ruleOverridden: false }, { mode: 'manual', rule: DEFAULT_RULE }),
        source('src-mode', { modeOverridden: true, ruleOverridden: false }, { mode: 'automatic', rule: DEFAULT_RULE }),
        source('src-rule', { modeOverridden: false, ruleOverridden: true }, { mode: 'manual', rule: OWN_RULE }),
        source('src-both', { modeOverridden: true, ruleOverridden: true }, { mode: 'automatic', rule: OWN_RULE }),
        source('src-none', { modeOverridden: false, ruleOverridden: false }, { mode: 'manual', rule: DEFAULT_RULE }),
      ]),
      'src-1'
    );
    expect(overrides).toEqual({
      'src-1': { mode: 'automatic' },
      'src-mode': { mode: 'automatic' },
      'src-rule': { rule: OWN_RULE },
      'src-both': { mode: 'automatic', rule: OWN_RULE },
    });
  });
});
