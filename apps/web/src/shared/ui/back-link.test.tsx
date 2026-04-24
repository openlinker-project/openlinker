import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { BackLink } from './back-link';

function renderWithRouter(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('BackLink', () => {
  afterEach(cleanup);

  it('renders a React Router <Link> pointing at `to`', () => {
    renderWithRouter(<BackLink to="/orders" label="Orders" />);
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link).toHaveAttribute('href', '/orders');
  });

  it('renders the glyph with aria-hidden so it is not in the accessible name', () => {
    renderWithRouter(<BackLink to="/orders" label="Orders" />);
    const glyph = screen.getByText('←');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');

    // Accessible name is the label alone — no stray glyph character.
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link).toHaveAccessibleName('Orders');
  });

  it('merges a custom className without dropping the base `back-link` class', () => {
    renderWithRouter(<BackLink to="/orders" label="Orders" className="wizard-card__back" />);
    const link = screen.getByRole('link', { name: 'Orders' });
    expect(link).toHaveClass('back-link', 'wizard-card__back');
  });

  it('renders a ReactNode label faithfully', () => {
    renderWithRouter(
      <BackLink
        to="/connections/ol_connection_abc"
        label={<span data-testid="custom-label">Allegro sandbox</span>}
      />,
    );
    expect(screen.getByTestId('custom-label')).toHaveTextContent('Allegro sandbox');
  });
});
