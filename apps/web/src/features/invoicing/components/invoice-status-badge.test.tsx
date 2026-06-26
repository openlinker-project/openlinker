/**
 * InvoiceStatusBadge — tone/label tests (#757)
 *
 * Maps each display status to a StatusBadge tone + label; `pending` pulses.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { InvoiceStatusBadge } from './invoice-status-badge';

afterEach(cleanup);

describe('InvoiceStatusBadge', () => {
  it('not-issued ⇒ neutral tone, "Not issued" label', () => {
    renderWithProviders(<InvoiceStatusBadge status="not-issued" />);
    const badge = screen.getByText('Not issued');
    expect(badge).toBeInTheDocument();
    expect(badge.closest('.status-badge')).toHaveClass('status-badge--neutral');
  });

  it('pending ⇒ warning tone, pulsing dot', () => {
    renderWithProviders(<InvoiceStatusBadge status="pending" />);
    const badge = screen.getByText('Pending').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--warning');
    expect(badge).toHaveClass('status-badge--pulse');
  });

  it('issued ⇒ success tone', () => {
    renderWithProviders(<InvoiceStatusBadge status="issued" />);
    expect(screen.getByText('Issued').closest('.status-badge')).toHaveClass(
      'status-badge--success',
    );
  });

  it('failed ⇒ error tone', () => {
    renderWithProviders(<InvoiceStatusBadge status="failed" />);
    expect(screen.getByText('Failed').closest('.status-badge')).toHaveClass('status-badge--error');
  });
});
