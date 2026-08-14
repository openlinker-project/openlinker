import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AnalyticsTrustHeader } from './analytics-trust-header';
import type { ConnectionIngestionTrust } from '../api/analytics-trust.types';

function makeEntry(overrides: Partial<ConnectionIngestionTrust> = {}): ConnectionIngestionTrust {
  return {
    connectionId: 'conn-1',
    connectionName: 'Allegro — main',
    platformType: 'allegro',
    connectionStatus: 'active',
    status: 'fresh',
    lastPollAt: '2026-08-14T14:32:00.000Z',
    lastOrderIngestedAt: null,
    connectionCreatedAt: '2026-01-01T00:00:00.000Z',
    expectedIntervalMs: null,
    staleAfterMs: null,
    ...overrides,
  };
}

describe('AnalyticsTrustHeader', () => {
  it('should render one row per connection without aggregation', () => {
    render(
      <AnalyticsTrustHeader
        connections={[
          makeEntry({ connectionId: 'c1', connectionName: 'Allegro — main' }),
          makeEntry({ connectionId: 'c2', connectionName: 'Sklep główny' }),
          makeEntry({ connectionId: 'c3', connectionName: 'Erli' }),
          makeEntry({ connectionId: 'c4', connectionName: 'Shop DE' }),
          makeEntry({ connectionId: 'c5', connectionName: 'Test shop' }),
        ]}
      />,
    );

    expect(screen.getByText('Allegro — main')).toBeInTheDocument();
    expect(screen.getByText('Sklep główny')).toBeInTheDocument();
    expect(screen.getByText('Erli')).toBeInTheDocument();
    expect(screen.getByText('Shop DE')).toBeInTheDocument();
    expect(screen.getByText('Test shop')).toBeInTheDocument();
  });

  it('should map each status to the correct badge tone and label', () => {
    render(
      <AnalyticsTrustHeader
        connections={[
          makeEntry({ connectionId: 'c-fresh', status: 'fresh' }),
          makeEntry({ connectionId: 'c-stalled', status: 'stalled' }),
          makeEntry({ connectionId: 'c-disconnected', status: 'disconnected' }),
          makeEntry({ connectionId: 'c-never', status: 'never-ingested' }),
        ]}
      />,
    );

    expect(screen.getByText('Fresh')).toBeInTheDocument();
    expect(screen.getByText('Stalled')).toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.getByText('Never ingested')).toBeInTheDocument();
  });

  it('should render "Never polled" when a connection has no lastPollAt', () => {
    render(<AnalyticsTrustHeader connections={[makeEntry({ lastPollAt: null })]} />);

    expect(screen.getByText('Never polled')).toBeInTheDocument();
  });

  it('should open the info popover on click', async () => {
    const user = userEvent.setup();
    render(<AnalyticsTrustHeader connections={[makeEntry()]} />);

    expect(screen.queryByText(/Connected since/i, { selector: 'span.trust-header__fact-label' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'About these dates' }));

    expect(screen.getByText(/not a claim about how/i)).toBeInTheDocument();
  });
});
