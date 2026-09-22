/**
 * Recent activity panel (#3411, mockup-parity epic #3401)
 *
 * @module apps/web/src/features/bench/components
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { BenchActivityPanel } from './bench-activity-panel';

const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: [],
  analyticsConsent: true,
} as const;

function mount(listActivity: ReturnType<typeof vi.fn>) {
  const apiClient = createMockApiClient({ bench: { listActivity } });
  return renderWithProviders(<BenchActivityPanel workId="w-1" />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
  });
}

describe('BenchActivityPanel (#3411)', () => {
  it('renders newest-first entries with the product name and instant', async () => {
    mount(
      vi.fn().mockResolvedValue([
        { workLineId: 'wl-1', name: 'Linen tea towel', kind: 'verified', at: '2026-09-04T14:36:00Z', byUserId: 'user-1' },
      ])
    );

    expect(await screen.findByText(/Linen tea towel/)).toBeInTheDocument();
    expect(screen.getByText(/verified/)).toBeInTheDocument();
  });

  it('renders an undone entry distinctly from a verified one', async () => {
    mount(
      vi.fn().mockResolvedValue([
        { workLineId: 'wl-1', name: 'Linen tea towel', kind: 'undone', at: '2026-09-04T14:37:00Z', byUserId: 'user-1' },
      ])
    );

    expect(await screen.findByText(/undone/)).toBeInTheDocument();
  });

  it('renders nothing when there is no activity yet', async () => {
    mount(vi.fn().mockResolvedValue([]));

    // Give the query a tick to settle, then assert the panel never appears.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('bench-activity-panel')).not.toBeInTheDocument();
  });

  it('renders nothing on a failed read rather than an error box beside the lines', async () => {
    mount(vi.fn().mockRejectedValue(new Error('network')));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('bench-activity-panel')).not.toBeInTheDocument();
  });
});
