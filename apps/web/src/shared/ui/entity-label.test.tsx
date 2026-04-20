import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityLabel } from './entity-label';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EntityLabel', () => {
  afterEach(cleanup);

  it('renders the name when provided', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Allegro sandbox" />);
    expect(screen.getByText('Allegro sandbox')).toBeInTheDocument();
  });

  it('shows a shortened ID when the ID is long', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc123def456" name="Store" />);
    expect(screen.getByText(/ol_conne…f456/)).toBeInTheDocument();
  });

  it('shows the ID verbatim when it is short', () => {
    renderWithRouter(<EntityLabel id="ol_c_123" name="Store" />);
    expect(screen.getByText('ol_c_123')).toBeInTheDocument();
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
});
