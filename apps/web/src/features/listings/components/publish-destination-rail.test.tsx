/**
 * PublishDestinationRail tests (#1828)
 *
 * Focus: the WAI-ARIA radiogroup keyboard contract — single tab stop via
 * roving tabindex, and Arrow / Home / End moving (and selecting) between
 * grouped destinations.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishDestinationRail } from './publish-destination-rail';
import type { Connection } from '../../connections';
import type { PublishDestination, PublishDestinationKind } from '../lib/publish-destinations';

function dest(id: string, name: string, kind: PublishDestinationKind): PublishDestination {
  return {
    kind,
    connection: {
      id,
      name,
      platformType: kind === 'shop' ? 'woocommerce' : 'allegro',
      status: 'active',
      config: {},
      credentialsBacked: true,
      adapterKey: 'x.v1',
      enabledCapabilities: [],
      supportedCapabilities: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as Connection,
  };
}

// Visual/nav order is marketplaces first, then shops.
const DESTS: PublishDestination[] = [
  dest('m1', 'Allegro One', 'marketplace'),
  dest('m2', 'Allegro Two', 'marketplace'),
  dest('s1', 'Shop One', 'shop'),
];

/** Controlled harness so arrow keys visibly move the selection. */
function Harness({ initial = null }: { initial?: string | null }): ReactElement {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <PublishDestinationRail
      destinations={DESTS}
      selectedConnectionId={selected}
      onSelect={setSelected}
      ariaLabel="Publish destination"
    />
  );
}

describe('PublishDestinationRail', () => {
  afterEach(cleanup);

  it('groups destinations by kind with capability-driven hints', () => {
    render(<Harness />);
    expect(screen.getByText('Marketplaces')).toBeInTheDocument();
    expect(screen.getByText('Online shops')).toBeInTheDocument();
    expect(screen.getAllByText('Offer marketplace')).toHaveLength(2);
    expect(screen.getByText('Online shop')).toBeInTheDocument();
  });

  it('is a single tab stop: first radio is focusable when nothing is selected', () => {
    render(<Harness />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('tabindex', '0');
    expect(radios[1]).toHaveAttribute('tabindex', '-1');
    expect(radios[2]).toHaveAttribute('tabindex', '-1');
  });

  it('moves the single tab stop to the selected radio', () => {
    render(<Harness initial="m2" />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAttribute('tabindex', '-1');
    expect(radios[1]).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: /Allegro Two/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('ArrowDown moves selection to the next destination (across group boundary)', () => {
    render(<Harness initial="m2" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Allegro Two/ }), { key: 'ArrowDown' });
    // m2 (index 1) -> s1 (index 2), crossing into the shop group.
    expect(screen.getByRole('radio', { name: /Shop One/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('ArrowUp wraps from the first to the last destination', () => {
    render(<Harness initial="m1" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Allegro One/ }), { key: 'ArrowUp' });
    expect(screen.getByRole('radio', { name: /Shop One/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('Home selects the first and End selects the last destination', () => {
    render(<Harness initial="m2" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: /Allegro Two/ }), { key: 'End' });
    expect(screen.getByRole('radio', { name: /Shop One/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: /Shop One/ }), { key: 'Home' });
    expect(screen.getByRole('radio', { name: /Allegro One/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('clicking a destination selects it', () => {
    const onSelect = vi.fn();
    render(
      <PublishDestinationRail
        destinations={DESTS}
        selectedConnectionId={null}
        onSelect={onSelect}
        ariaLabel="Publish destination"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Shop One/ }));
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});
