import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HELP_LINKS } from '../lib/help-links';
import { HelpLink } from './help-link';

describe('HelpLink', () => {
  afterEach(cleanup);

  it('resolves its href from the HELP_LINKS config map, never a literal per call site', () => {
    render(<HelpLink surfaceKey="connection-rate-limit" />);
    const link = screen.getByRole('link', { name: 'Help: connection rate limiting' });
    expect(link).toHaveAttribute('href', HELP_LINKS['connection-rate-limit']);
  });

  it('always opens in a new tab with rel="noopener noreferrer"', () => {
    render(<HelpLink surfaceKey="who-decides" />);
    const link = screen.getByRole('link', { name: 'Help: who decides what' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('is labelled for screen readers via aria-label naming the surface', () => {
    render(<HelpLink surfaceKey="connection-stock-and-pricing" />);
    const link = screen.getByRole('link', { name: 'Help: stock and pricing controls' });
    expect(link).toHaveAccessibleName('Help: stock and pricing controls');
  });

  it('hides the visual glyph from the accessibility tree so it does not double up the name', () => {
    render(<HelpLink surfaceKey="sales-documents-routing" />);
    const glyph = screen.getByText('?');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });
});
