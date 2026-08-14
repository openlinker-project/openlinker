import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityLabel, shortenId } from './entity-label';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EntityLabel', () => {
  afterEach(cleanup);

  it('renders the name when provided', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Allegro sandbox" />);
    expect(screen.getByText('Allegro sandbox')).toBeInTheDocument();
  });

  it('keeps the ol_{type}_ prefix intact when shortening', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Store" />);
    expect(screen.getByText(/ol_connection_abc1…56/)).toBeInTheDocument();
  });

  it('shows the full ID verbatim when the tail is short enough', () => {
    renderWithRouter(<EntityLabel id="ol_c_123" name="Store" />);
    expect(screen.getByText('ol_c_123')).toBeInTheDocument();
  });

  it('shortens non-OL IDs with a generic strategy', () => {
    renderWithRouter(<EntityLabel id="raw-uuid-abcdef0123456789" name="Legacy" />);
    expect(screen.getByText(/raw-uuid…6789/)).toBeInTheDocument();
  });

  it('renders a link when to is provided', () => {
    renderWithRouter(
      <EntityLabel id="ol_connection_abc" name="Allegro" to="/connections/ol_connection_abc" />,
    );
    const link = screen.getByRole('link', { name: 'Allegro' });
    expect(link).toHaveAttribute('href', '/connections/ol_connection_abc');
  });

  it('falls back to "Unknown" when name is missing and not loading', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc" />);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('shows a loading placeholder when loading', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc" loading />);
    const placeholder = screen.getByText('…');
    expect(placeholder).toHaveAttribute('aria-busy', 'true');
  });

  it('hides the ID when showId={false}', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123" name="Store" showId={false} />);
    expect(screen.queryByText(/ol_conn/)).toBeNull();
  });

  it('hides the copy button when showCopy={false}', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123" name="Store" showCopy={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Store')).toBeInTheDocument();
  });

  it('exposes the full name as a title on the non-link name', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc" name="Warehouse EU - Warszawa" />);
    expect(screen.getByText('Warehouse EU - Warszawa')).toHaveAttribute(
      'title',
      'Warehouse EU - Warszawa',
    );
  });

  it('renders the copy control as an explicit type=button', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc" name="Store" />);
    const copy = screen.getByRole('button', { name: /Copy ol_connection/ });
    expect(copy).toHaveAttribute('type', 'button');
  });

  it('uses copyLabel and copiedLabel for the copy button accessible name when supplied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithRouter(
      <EntityLabel
        id="ol_order_abc123def456"
        name="6839-2911-4402"
        copyLabel="Copy order ID 6839-2911-4402"
        copiedLabel="Copied order ID 6839-2911-4402"
      />,
    );

    const copy = screen.getByRole('button', { name: 'Copy order ID 6839-2911-4402' });
    expect(screen.queryByRole('button', { name: /ol_order_abc/ })).toBeNull();

    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith('ol_order_abc123def456');
    expect(
      await screen.findByRole('button', { name: 'Copied order ID 6839-2911-4402' }),
    ).toBeInTheDocument();
  });

  it('falls back to the spelled-out id for the copy button accessible name when no label is supplied', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Store" />);

    expect(
      screen.getByRole('button', { name: 'Copy ol_connection_abc123def456' }),
    ).toBeInTheDocument();
  });

  it('mirrors the copy button accessible name into a title so a sighted user sees it too (#2091)', async () => {
    // The row's visible identity is not always the id Copy writes — an order row
    // reads `ALG-882414` and copies `ol_order_…` — and with `showId={false}` no
    // chip beside the button shows the target either. `aria-label` alone produces
    // no tooltip, so the accessible name has to be mirrored.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithRouter(
      <EntityLabel
        id="ol_order_abc123def456"
        name="6839-2911-4402"
        showId={false}
        copyLabel="Copy internal order ID for order 6839-2911-4402"
        copiedLabel="Copied internal order ID for order 6839-2911-4402"
      />,
    );

    const copy = screen.getByRole('button', {
      name: 'Copy internal order ID for order 6839-2911-4402',
    });
    expect(copy).toHaveAttribute('title', 'Copy internal order ID for order 6839-2911-4402');

    fireEvent.click(copy);

    // The title tracks the copied state alongside the accessible name — a stale
    // "Copy …" tooltip over a button reading "Copied" is its own small lie.
    expect(
      await screen.findByRole('button', {
        name: 'Copied internal order ID for order 6839-2911-4402',
      }),
    ).toHaveAttribute('title', 'Copied internal order ID for order 6839-2911-4402');
  });

  it('falls back to the spelled-out id for the copy button title when no label is supplied', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Store" />);

    expect(screen.getByRole('button', { name: /Copy ol_connection/ })).toHaveAttribute(
      'title',
      'Copy ol_connection_abc123def456',
    );
  });

  it('copies the full ID to the clipboard when the copy button is pressed', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Store" />);
    fireEvent.click(screen.getByRole('button', { name: /Copy ol_connection/ }));

    expect(writeText).toHaveBeenCalledWith('ol_connection_abc123def456');
  });

  it('fires onNavigate when the name link is clicked', () => {
    const onNavigate = vi.fn();
    renderWithRouter(
      <EntityLabel
        id="ol_order_abc"
        name="Order #1"
        to="/orders/ol_order_abc"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Order #1' }));

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('does not fire onNavigate when the copy button is clicked', () => {
    const onNavigate = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithRouter(
      <EntityLabel
        id="ol_order_abc"
        name="Order #1"
        to="/orders/ol_order_abc"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Copy ol_order/ }));

    expect(onNavigate).not.toHaveBeenCalled();
  });
});

/**
 * `shortenId` algorithm coverage, moved here from
 * `features/shipments/lib/shipment-severity.test.ts` when #2089 retired the
 * `truncateOrderId` alias. These four branches were the ONLY tests of the
 * algorithm; `OrderIdentityCell` (#2087) now depends on it on three lists, so
 * they follow the function rather than the deleted alias.
 */
describe('shortenId', () => {
  it('should keep the ol_ prefix and elide the middle of a full internal order id', () => {
    expect(shortenId('ol_order_a3f24b09c4d1486789abcdef01234567')).toBe('ol_order_a3f2…67');
  });

  it('should leave a short ol_ id untouched when its suffix is 6 characters or fewer', () => {
    expect(shortenId('ol_order_123456')).toBe('ol_order_123456');
    expect(shortenId('ol_order_1')).toBe('ol_order_1');
  });

  it('should truncate a 7-character ol_ suffix - the boundary just past the keep-whole limit', () => {
    expect(shortenId('ol_order_1234567')).toBe('ol_order_1234…67');
  });

  it('should leave a non-OL id of 14 characters or fewer untouched', () => {
    expect(shortenId('12345678901234')).toBe('12345678901234');
    expect(shortenId('ORD-42')).toBe('ORD-42');
  });

  it('should elide the middle of a non-OL id longer than 14 characters', () => {
    expect(shortenId('123456789012345')).toBe('12345678…2345');
  });
});
