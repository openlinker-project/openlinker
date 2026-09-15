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
import { LocaleProvider } from '../../../shared/i18n';
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

  // Pins the ordering the override depends on: `t(key, fallback)` returns the
  // CATALOG hit, so an override handed to `t()` as its fallback argument would
  // silently lose the day `invoice.regulatory.*` — the regulator-NEUTRAL key —
  // is populated. The host catalog is empty today, so only this test, which
  // populates it, can catch that regression.
  it('override outranks a POPULATED neutral catalog entry for the same status', () => {
    renderWithProviders(
      <LocaleProvider catalog={{ 'invoice.regulatory.accepted': 'Accepted by the authority' }}>
        <RegulatoryStatusBadge status="accepted" labelOverrides={{ accepted: 'KSeF: accepted' }} />
      </LocaleProvider>,
    );
    expect(screen.getByText('KSeF: accepted').closest('.status-badge')).toBeInTheDocument();
    expect(screen.queryByText('Accepted by the authority')).toBeNull();
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

  it('renders the catalog entry over the neutral fallback when no override is given', () => {
    renderWithProviders(
      <LocaleProvider catalog={{ 'invoice.regulatory.accepted': 'Accepted by the authority' }}>
        <RegulatoryStatusBadge status="accepted" />
      </LocaleProvider>,
    );
    expect(screen.getByText('Accepted by the authority')).toBeInTheDocument();
  });
});
