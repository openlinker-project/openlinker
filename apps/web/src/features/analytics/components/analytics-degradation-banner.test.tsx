import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { AnalyticsDegradationBanner } from './analytics-degradation-banner';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';

function makeEntry(overrides: Partial<ConnectionIngestionTrust> = {}): ConnectionIngestionTrust {
  return {
    connectionId: 'conn-1',
    connectionName: 'Allegro — main',
    platformType: 'allegro',
    connectionStatus: 'active',
    status: 'stalled',
    lastPollAt: '2026-08-03T14:02:00.000Z',
    lastOrderIngestedAt: null,
    connectionCreatedAt: '2026-01-01T00:00:00.000Z',
    earliestOrderDate: '2026-01-05T00:00:00.000Z',
    expectedIntervalMs: null,
    staleAfterMs: null,
    ...overrides,
  };
}

describe('AnalyticsDegradationBanner', () => {
  it('should render nothing when no connection is stalled or disconnected', () => {
    renderWithProviders(<AnalyticsDegradationBanner connections={[makeEntry({ status: 'fresh' })]} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render an alert for a stalled connection with a link to its sync detail', () => {
    renderWithProviders(
      <AnalyticsDegradationBanner connections={[makeEntry({ connectionId: 'conn-42' })]} />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Allegro — main has not been polled since');
    expect(screen.getByRole('link', { name: 'View sync' })).toHaveAttribute(
      'href',
      '/cursors?connectionId=conn-42'
    );
  });

  it('should render one alert per degraded connection', () => {
    renderWithProviders(
      <AnalyticsDegradationBanner
        connections={[
          makeEntry({ connectionId: 'conn-a', status: 'stalled' }),
          makeEntry({ connectionId: 'conn-b', status: 'disconnected' }),
          makeEntry({ connectionId: 'conn-c', status: 'fresh' }),
        ]}
      />
    );

    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
