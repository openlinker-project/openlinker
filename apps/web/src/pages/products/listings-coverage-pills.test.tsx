import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import type { Connection } from '../../features/connections';
import { ListingsCoveragePills } from './listings-coverage-pills';

function makeConnection(overrides: Partial<Connection>): Connection {
  return {
    id: 'conn_allegro',
    name: 'My Allegro',
    platformType: 'allegro',
    status: 'active',
    config: {},
    credentialsBacked: false,
    enabledCapabilities: [],
    supportedCapabilities: ['OfferManager', 'OfferCreator'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Connection;
}

describe('ListingsCoveragePills', () => {
  afterEach(cleanup);

  it('renders one pill per provided connection, never from coverage rows alone', () => {
    // Allegro-only install: coverage carries a stray row for a connection the
    // operator does not have - it must NOT produce a pill.
    const { container } = renderWithProviders(
      <ListingsCoveragePills
        coverage={[
          { connectionId: 'conn_allegro', platformType: 'allegro', listedVariants: 2 },
          { connectionId: 'conn_ghost', platformType: 'erli', listedVariants: 1 },
        ]}
        variantCount={2}
        connections={[makeConnection({})]}
      />,
    );

    const pills = container.querySelectorAll('.coverage-pill');
    expect(pills).toHaveLength(1);
    // Sole connection of its platform: labeled by the platform display name.
    expect(screen.getByText('Allegro')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(pills[0]).toHaveClass('coverage-pill--full');
  });

  it('renders a muted 0/N pill for a connection with no coverage row', () => {
    const { container } = renderWithProviders(
      <ListingsCoveragePills coverage={[]} variantCount={3} connections={[makeConnection({})]} />,
    );

    const pill = container.querySelector('.coverage-pill');
    expect(pill).toHaveClass('coverage-pill--none');
    expect(screen.getByText('0/3')).toBeInTheDocument();
  });

  it('marks partial coverage and labels by connection name with two connections of one platform', () => {
    const { container } = renderWithProviders(
      <ListingsCoveragePills
        coverage={[{ connectionId: 'conn_a', platformType: 'allegro', listedVariants: 1 }]}
        variantCount={2}
        connections={[
          makeConnection({ id: 'conn_a', name: 'Allegro PL' }),
          makeConnection({ id: 'conn_b', name: 'Allegro CZ' }),
        ]}
      />,
    );

    const pills = container.querySelectorAll('.coverage-pill');
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveClass('coverage-pill--partial');
    expect(pills[1]).toHaveClass('coverage-pill--none');
    expect(screen.getByText('Allegro PL')).toBeInTheDocument();
    expect(screen.getByText('Allegro CZ')).toBeInTheDocument();
  });

  it('renders nothing with zero connections', () => {
    const { container } = renderWithProviders(
      <ListingsCoveragePills
        coverage={[{ connectionId: 'x', platformType: 'allegro', listedVariants: 1 }]}
        variantCount={1}
        connections={[]}
      />,
    );

    expect(container.querySelector('.coverage-pill')).toBeNull();
  });
});
