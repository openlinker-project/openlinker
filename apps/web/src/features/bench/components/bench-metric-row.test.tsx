/**
 * Bench metric row (#3413, mockup-parity epic #3401)
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
import { BenchMetricRow } from './bench-metric-row';

const PACKER = {
  id: 'user_packer',
  username: 'Marta Kowalczyk',
  email: null,
  role: 'packer',
  permissions: [],
  analyticsConsent: true,
} as const;

function mount(getMetrics: ReturnType<typeof vi.fn>) {
  const apiClient = createMockApiClient({ bench: { getMetrics } });
  return renderWithProviders(<BenchMetricRow />, {
    apiClient,
    sessionAdapter: createAuthenticatedSessionAdapter({ ...PACKER, permissions: [] }),
  });
}

describe('BenchMetricRow (#3413)', () => {
  it('renders nothing while the read is pending or has failed', async () => {
    mount(vi.fn().mockRejectedValue(new Error('network')));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('bench-metric-row')).not.toBeInTheDocument();
  });

  it('renders both cards with a positive trend', async () => {
    mount(
      vi.fn().mockResolvedValue({ packedToday: 12, packedYesterday: 9, toPackAllBenches: 34 })
    );

    expect(await screen.findByTestId('bench-metric-row')).toBeInTheDocument();
    expect(screen.getByText('Packed today')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('+3 vs yesterday')).toBeInTheDocument();
    expect(screen.getByText('To pack — all benches')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
  });

  it('renders a negative trend with a plain hyphen, never a unicode minus', async () => {
    mount(
      vi.fn().mockResolvedValue({ packedToday: 4, packedYesterday: 10, toPackAllBenches: 34 })
    );

    expect(await screen.findByText('-6 vs yesterday')).toBeInTheDocument();
  });

  it('renders the flat-trend phrasing when today equals yesterday', async () => {
    mount(
      vi.fn().mockResolvedValue({ packedToday: 7, packedYesterday: 7, toPackAllBenches: 34 })
    );

    expect(await screen.findByText('same as yesterday')).toBeInTheDocument();
  });
});
