/**
 * useOmsRoutingState — unit tests (#3505).
 *
 * The derivation is asserted as a pure function across every row state, and
 * the hook once end-to-end against the mock API client so the wiring (same
 * query, `enabled` honoured) is pinned too.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { AuthorityAnswerRow, AuthorityState, AuthorityStatus } from '../api/who-decides.types';
import { deriveOmsRoutingState, useOmsRoutingState } from './use-oms-routing-state';
import type { OmsRoutingState } from './use-oms-routing-state.types';

function row(question: AuthorityAnswerRow['question'], state: AuthorityState): AuthorityAnswerRow {
  return {
    question,
    state,
    answer: { kind: 'nobody-to-route' } as AuthorityAnswerRow['answer'],
    why: { kind: 'default', code: 'a2-single-origin-nothing-to-choose' },
    source: state === 'default' ? 'default' : 'operator-config',
    inactiveClaimantConnectionIds: [],
  };
}

function status(sourcingState: AuthorityState | null): AuthorityStatus {
  return {
    rows: [
      row('availability', 'default'),
      ...(sourcingState === null ? [] : [row('sourcing', sourcingState)]),
    ],
    attention: { counted: [], routine: [], affectedOrderCount: 0 },
    presets: [],
    applied: null,
  };
}

function settled(data: AuthorityStatus | null): OmsRoutingState {
  return deriveOmsRoutingState({ isPending: false, isError: false, data });
}

describe('deriveOmsRoutingState', () => {
  it('should report off when nothing claims sourcing', () => {
    expect(settled(status('default'))).toBe('off');
  });

  it.each<AuthorityState>(['resolved', 'ambiguous', 'unavailable'])(
    'should report on when the sourcing row is %s',
    (state) => {
      expect(settled(status(state))).toBe('on');
    },
  );

  it('should report unknown while the read is pending', () => {
    expect(deriveOmsRoutingState({ isPending: true, isError: false, data: undefined })).toBe(
      'unknown',
    );
  });

  it('should report unreadable when the read failed', () => {
    expect(deriveOmsRoutingState({ isPending: false, isError: true, data: undefined })).toBe(
      'unreadable',
    );
  });

  it('should report unreadable when the response could not be parsed', () => {
    expect(settled(null)).toBe('unreadable');
  });

  it('should report unreadable when the response carries no sourcing row', () => {
    expect(settled(status(null))).toBe('unreadable');
  });
});

function renderState(
  getStatus: ReturnType<typeof vi.fn>,
  options?: { enabled?: boolean },
): { current: OmsRoutingState } {
  const captured = { current: 'unknown' as OmsRoutingState };
  function Probe(): null {
    captured.current = useOmsRoutingState(options);
    return null;
  }
  renderWithProviders(<Probe />, {
    apiClient: createMockApiClient({ fulfillmentAuthority: { getStatus } as never }),
  });
  return captured;
}

describe('useOmsRoutingState', () => {
  it('should resolve to on when the status read says sourcing is claimed', async () => {
    const getStatus = vi.fn().mockResolvedValue(status('resolved'));
    const state = renderState(getStatus);

    await waitFor(() => {
      expect(state.current).toBe('on');
    });
  });

  it('should not issue the read and stay unknown when disabled', async () => {
    const getStatus = vi.fn().mockResolvedValue(status('resolved'));
    const state = renderState(getStatus, { enabled: false });

    await waitFor(() => {
      expect(getStatus).not.toHaveBeenCalled();
    });
    expect(state.current).toBe('unknown');
  });
});
