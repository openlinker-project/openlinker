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

  // #3192 - the hook is gated on the ONE waiting state, so a spec asserting
  // it is asserting that state and not merely that a badge rendered.
  describe('waiting hook (#3192)', () => {
    it('names the badge while the document awaits submission', () => {
      renderWithProviders(<RegulatoryStatusBadge status="pending-submission" />);

      const badge = screen.getByTestId('sales-document-status-waiting');
      expect(badge).toHaveTextContent('Awaiting submission');
      expect(badge).toHaveClass('status-badge--warning');
    });

    it('withholds the hook from every other clearance state', () => {
      const others = ['not-applicable', 'submitted', 'cleared', 'accepted', 'rejected'] as const;
      for (const status of others) {
        cleanup();
        renderWithProviders(<RegulatoryStatusBadge status={status} />);
        expect(screen.queryByTestId('sales-document-status-waiting')).toBeNull();
      }
    });

    // A provider may brand the WORD without moving the hook: the hook names
    // the state, the label names it in that provider's own vocabulary.
    it('keeps the hook under a provider label override', () => {
      renderWithProviders(
        <RegulatoryStatusBadge
          status="pending-submission"
          labelOverrides={{ 'pending-submission': 'Awaiting the authority' }}
        />,
      );

      expect(screen.getByTestId('sales-document-status-waiting')).toHaveTextContent(
        'Awaiting the authority',
      );
    });
  });

  it('renders the neutral copy when no override is given', () => {
    renderWithProviders(<RegulatoryStatusBadge status="accepted" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });
});
