/**
 * RegulatoryStatusBadge — tone/label + provider-override tests (#757, #3181)
 *
 * The shared badge renders regulator-neutral labels by default (#3181 —
 * `RegulatoryStatus` is shared vocabulary across every `InvoicingPort`
 * adapter, so a shared component must not assume the regulator is KSeF); a
 * per-provider surface may override individual labels via `labelOverrides`.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { RegulatoryStatusBadge } from './regulatory-status-badge';

afterEach(cleanup);

describe('RegulatoryStatusBadge', () => {
  it('renders a regulator-neutral label by default', () => {
    renderWithProviders(<RegulatoryStatusBadge status="accepted" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText(/KSeF/i)).toBeNull();
  });

  it('submitted ⇒ info tone, pulsing dot, neutral label', () => {
    renderWithProviders(<RegulatoryStatusBadge status="submitted" />);
    const badge = screen.getByText('Submitted').closest('.status-badge');
    expect(badge).toHaveClass('status-badge--info');
    expect(badge).toHaveClass('status-badge--pulse');
  });

  it('rejected ⇒ error tone, neutral label', () => {
    renderWithProviders(<RegulatoryStatusBadge status="rejected" />);
    expect(screen.getByText('Rejected').closest('.status-badge')).toHaveClass(
      'status-badge--error',
    );
  });

  it('renders a provider-supplied override label when one is given for the status', () => {
    renderWithProviders(
      <RegulatoryStatusBadge status="accepted" labelOverrides={{ accepted: 'KSeF: accepted' }} />,
    );
    expect(screen.getByText('KSeF: accepted')).toBeInTheDocument();
  });

  it('falls back to the neutral label for a status the override map omits', () => {
    renderWithProviders(
      <RegulatoryStatusBadge status="rejected" labelOverrides={{ accepted: 'KSeF: accepted' }} />,
    );
    expect(screen.getByText('Rejected')).toBeInTheDocument();
  });
});
