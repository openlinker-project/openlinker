/**
 * InvoiceUnconfirmedNotice (#3766)
 *
 * The in-doubt state as one notice. Pins the three things that make it safe
 * rather than merely tidy: the cause sentence never claims a timeout it did not
 * see, the provider's own text is shown verbatim and only when there is some,
 * and "Mark resolved" cannot be triggered by a single stray click.
 *
 * @module apps/web/src/features/invoicing/components
 */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../../test/test-utils';
import { InvoiceUnconfirmedNotice } from './invoice-unconfirmed-notice';
import type { InvoiceUnconfirmedNoticeProps } from './invoice-unconfirmed-notice';

function renderNotice(
  overrides: Partial<InvoiceUnconfirmedNoticeProps> = {},
): InvoiceUnconfirmedNoticeProps {
  const props: InvoiceUnconfirmedNoticeProps = {
    connectionName: 'e-paragony Sandbox',
    failureCode: 'transport-timeout',
    attemptedAt: '2026-10-16T09:41:00.000Z',
    providerResponse: 'POST /documents: no response after 30000 ms',
    onCheckProvider: vi.fn(),
    onMarkResolved: vi.fn(),
    ...overrides,
  };
  renderWithProviders(<InvoiceUnconfirmedNotice {...props} />);
  return props;
}

describe('InvoiceUnconfirmedNotice', () => {
  describe('rendering', () => {
    it('should render one notice with the title and both steps', () => {
      renderNotice();

      const notice = screen.getByTestId('invoice-unconfirmed');
      expect(within(notice).getByText("We can't tell if this invoice was issued")).toBeInTheDocument();
      const steps = within(notice).getAllByRole('listitem');
      expect(steps).toHaveLength(2);
      expect(steps[0]).toHaveTextContent("Look for this order's invoice in e-paragony Sandbox.");
      expect(steps[1]).toHaveTextContent('Mark it resolved once you know.');
    });

    it('should not offer Mark resolved when no handler is supplied', () => {
      renderNotice({ onMarkResolved: undefined });

      const notice = screen.getByTestId('invoice-unconfirmed');
      expect(within(notice).getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByRole('button', { name: 'Mark resolved' })).not.toBeInTheDocument();
    });

    it('should say the provider did not answer in time when the failure is a timeout', () => {
      renderNotice({ failureCode: 'transport-timeout' });

      expect(screen.getByText(/e-paragony Sandbox did not answer in time\./)).toBeInTheDocument();
    });

    it('should say the provider answered, not that it timed out, when the answer was inconclusive', () => {
      renderNotice({ failureCode: 'provider-answer-inconclusive' });

      expect(
        screen.getByText(
          /e-paragony Sandbox answered, but not in a way that says whether the invoice was created\./,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/did not answer in time/)).not.toBeInTheDocument();
    });

    it('should not claim a timeout when the failure code is something else', () => {
      renderNotice({ failureCode: null });

      expect(screen.getByText(/e-paragony Sandbox did not confirm the result\./)).toBeInTheDocument();
      expect(screen.queryByText(/did not answer in time/)).not.toBeInTheDocument();
    });

    it('should show the provider response verbatim inside a disclosure when there is one', () => {
      renderNotice();

      const response = screen.getByText('POST /documents: no response after 30000 ms');
      expect(response.closest('details')).not.toBeNull();
    });

    it('should omit the provider response disclosure when there is none', () => {
      renderNotice({ providerResponse: null });

      expect(screen.queryByText('Provider response')).not.toBeInTheDocument();
    });

    it('should state what stays paused and why', () => {
      renderNotice();

      expect(
        screen.getByText(/Retry and switching provider stay off until then, so this sale can't get two invoices\./),
      ).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call the check handler when Check provider is clicked', async () => {
      const user = userEvent.setup();
      const props = renderNotice();

      await user.click(screen.getByRole('button', { name: 'Check provider' }));

      expect(props.onCheckProvider).toHaveBeenCalledTimes(1);
    });

    it('should open a confirmation instead of resolving when Mark resolved is clicked', async () => {
      const user = userEvent.setup();
      const props = renderNotice();

      await user.click(screen.getByRole('button', { name: 'Mark resolved' }));

      expect(await screen.findByRole('dialog', { name: 'Mark this invoice as resolved?' })).toBeInTheDocument();
      expect(props.onMarkResolved).not.toHaveBeenCalled();
    });

    it('should put focus on Not yet so an accidental Enter does not confirm', async () => {
      const user = userEvent.setup();
      renderNotice();

      await user.click(screen.getByRole('button', { name: 'Mark resolved' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Not yet' })).toHaveFocus();
    });

    it('should not resolve when Not yet is clicked', async () => {
      const user = userEvent.setup();
      const props = renderNotice();

      await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Not yet' }));

      expect(props.onMarkResolved).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should resolve only when the dialog confirm is clicked', async () => {
      const user = userEvent.setup();
      const props = renderNotice();

      await user.click(screen.getByRole('button', { name: 'Mark resolved' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));

      expect(props.onMarkResolved).toHaveBeenCalledTimes(1);
    });
  });
});
