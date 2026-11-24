import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderBuyerEmailsPanel } from './order-buyer-emails-panel';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { BuyerEmailDelivery } from '../api/buyer-emails.types';
import { mapBuyerEmailsToEvents } from '../lib/buyer-email-timeline-events';

const base: BuyerEmailDelivery = {
  id: 'd-1',
  connectionId: 'conn-1',
  templateKey: 'order-confirmed',
  subjectRef: 'ol_order_1',
  outcome: 'sent',
  suppressionReason: null,
  suppressionMessage: null,
  createdAt: '2026-10-29T10:00:00.000Z',
};

function renderPanel(rows: BuyerEmailDelivery[]): void {
  renderWithProviders(<OrderBuyerEmailsPanel internalOrderId="ol_order_1" />, {
    apiClient: createMockApiClient({
      buyerEmails: { listForOrder: vi.fn().mockResolvedValue(rows) },
    }),
  });
}

afterEach(cleanup);

describe('OrderBuyerEmailsPanel (#3555)', () => {
  it('should show the explicit reason of a suppressed email (order-suppressed)', async () => {
    renderPanel([
      {
        ...base,
        outcome: 'suppressed',
        suppressionReason: 'emails-off-for-connection',
        suppressionMessage: "Buyer emails are off for this order's connection.",
      },
    ]);

    const panel = await screen.findByTestId('order-buyer-emails');
    expect(panel).toHaveAttribute('data-mk-state', 'order-suppressed');
    expect(screen.getByTestId('order-buyer-email-reason')).toHaveTextContent(
      "Buyer emails are off for this order's connection.",
    );
  });

  it('should show a bounce as distinct from sent (order-bounced)', async () => {
    renderPanel([base, { ...base, id: 'd-2', templateKey: 'shipped', outcome: 'bounced' }]);

    const panel = await screen.findByTestId('order-buyer-emails');
    expect(panel).toHaveAttribute('data-mk-state', 'order-bounced');
    const rows = screen.getAllByTestId('order-buyer-email-row');
    expect(rows.map((row) => row.getAttribute('data-outcome'))).toEqual(['sent', 'bounced']);
    expect(screen.getByText('Bounced')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
  });

  it('should show a claimed but unsettled send as sending, never as sent', async () => {
    renderPanel([{ ...base, outcome: 'pending' }]);

    await screen.findByTestId('order-buyer-emails');
    expect(screen.getByTestId('order-buyer-email-row')).toHaveAttribute('data-outcome', 'pending');
    expect(screen.getByText('Sending')).toBeInTheDocument();
    expect(screen.queryByText('Sent')).toBeNull();
    expect(screen.getByTestId('order-buyer-email-pending')).toBeInTheDocument();
  });

  it('should render nothing for an order with no buyer email', async () => {
    renderPanel([]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('order-buyer-emails')).toBeNull();
  });
});

describe('mapBuyerEmailsToEvents (#3555)', () => {
  it('should carry the server reason onto the timeline and mark a bounce as an error', () => {
    const events = mapBuyerEmailsToEvents([
      { ...base, outcome: 'suppressed', suppressionMessage: 'No buyer email address is stored for this order.' },
      { ...base, id: 'd-2', outcome: 'bounced' },
      { ...base, id: 'd-3' },
    ]);

    expect(events[0]).toMatchObject({
      title: '"Order confirmed" email not sent',
      description: 'No buyer email address is stored for this order.',
    });
    expect(events[1]).toMatchObject({ title: '"Order confirmed" email bounced', tone: 'error' });
    expect(events[2]).toMatchObject({ title: '"Order confirmed" email sent to buyer', tone: 'success' });
  });
});
