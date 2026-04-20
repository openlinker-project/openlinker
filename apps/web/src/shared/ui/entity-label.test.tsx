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

  it('renders the copy control as an explicit type=button', () => {
    renderWithRouter(<EntityLabel id="ol_connection_abc" name="Store" />);
    const copy = screen.getByRole('button', { name: /Copy ol_connection/ });
    expect(copy).toHaveAttribute('type', 'button');
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
