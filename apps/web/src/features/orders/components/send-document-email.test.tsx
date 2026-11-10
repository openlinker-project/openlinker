import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import type { OrderDocumentEmailEntry } from '../api/orders.types';
import { SendDocumentEmail } from './send-document-email';

function attempt(overrides: Partial<OrderDocumentEmailEntry>): OrderDocumentEmailEntry {
  return {
    id: 'e1',
    documentKind: 'invoice',
    documentId: 'inv_1',
    sentVia: 'provider',
    outcome: 'sent',
    failureReason: null,
    failureMessage: null,
    createdAt: '2026-10-29T11:04:00.000Z',
    ...overrides,
  };
}

describe('SendDocumentEmail', () => {
  it('should send an invoice and name the sender when the operator is admin', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: 'a@b.pl', sentVia: 'openlinker' });
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByTestId('send-document-email-use-buyer'));
    await userEvent.type(screen.getByTestId('send-document-email-recipient'), 'a@b.pl');
    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('inv_1', { locale: 'pl', recipient: 'a@b.pl' });
    expect(await screen.findByTestId('send-document-email-sent-via')).toHaveTextContent('OpenLinker');
  });

  it('should default to the buyer address on the order and send no recipient', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: null, sentVia: 'provider' });
    renderWithProviders(
      <SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />,
      {
        apiClient: createMockApiClient({ invoicing: { sendEmail } }),
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    const checkbox = await screen.findByTestId('send-document-email-use-buyer');
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(screen.getByText("Send to the buyer's address on the order (jan@example.com)")).toBeInTheDocument();
    const input = screen.getByTestId('send-document-email-recipient');
    expect(input).toBeDisabled();
    expect(input).toHaveValue('jan@example.com');
    expect(screen.queryByTestId('send-document-email-other-hint')).not.toBeInTheDocument();
    expect(screen.queryByText(/Leave empty/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('inv_1', { locale: 'pl' });
  });

  it('should require a valid typed address once the buyer address is unchecked', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: 'x@y.pl', sentVia: 'openlinker' });
    renderWithProviders(
      <SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />,
      {
        apiClient: createMockApiClient({ invoicing: { sendEmail } }),
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    await userEvent.click(await screen.findByTestId('send-document-email-use-buyer'));

    const input = screen.getByTestId('send-document-email-recipient');
    const button = screen.getByTestId('send-document-email-button');
    expect(input).toBeEnabled();
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(button).toBeDisabled();
    expect(screen.getByTestId('send-document-email-other-hint')).toHaveTextContent(
      'A different address is sent by OpenLinker rather than the invoicing provider.',
    );

    await userEvent.type(input, 'not-an-email');
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'x@y.pl');
    expect(button).toBeEnabled();

    await userEvent.click(button);

    expect(sendEmail).toHaveBeenCalledWith('inv_1', { locale: 'pl', recipient: 'x@y.pl' });
  });

  it('should require a typed address when the order has no buyer email', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: 'x@y.pl', sentVia: 'openlinker' });
    renderWithProviders(
      <SendDocumentEmail kind="fiscal-receipt" documentId="fr_1" internalOrderId="ord_1" buyerEmail={null} />,
      {
        apiClient: createMockApiClient({ fiscalization: { sendEmail } }),
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    const checkbox = await screen.findByTestId('send-document-email-use-buyer');
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByTestId('send-document-email-no-buyer')).toHaveTextContent('This order has no buyer email.');
    const input = screen.getByTestId('send-document-email-recipient');
    expect(input).toBeEnabled();
    expect(input).toBeRequired();
    expect(screen.getByTestId('send-document-email-button')).toBeDisabled();

    await userEvent.type(input, 'x@y.pl');
    await userEvent.click(screen.getByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('fr_1', { locale: 'pl', recipient: 'x@y.pl' });
  });

  it('should send in the language picked on the toggle', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: null, sentVia: 'provider' });
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByRole('radio', { name: 'EN' }));
    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('inv_1', { locale: 'en' });
  });

  it('should send a receipt through the fiscalization route', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: null, sentVia: 'openlinker' });
    renderWithProviders(<SendDocumentEmail kind="fiscal-receipt" documentId="fr_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ fiscalization: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('fr_1', { locale: 'pl' });
  });

  it('should render the server refusal verbatim', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('This invoice has no document to attach yet.'));
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(await screen.findByTestId('send-document-email-error')).toHaveTextContent(
      'This invoice has no document to attach yet.',
    );
  });

  it('should show the last successful send for this document when there is one', async () => {
    const listDocumentEmails = vi
      .fn()
      .mockResolvedValue([attempt({}), attempt({ id: 'e2', documentId: 'other', outcome: 'failed', createdAt: '2026-10-30T00:00:00.000Z' })]);
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ orders: { listDocumentEmails } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByTestId('send-document-email-status')).toHaveTextContent('Sent');
    expect(screen.getByTestId('send-document-email-last')).toHaveTextContent('via the invoicing provider');
    expect(screen.getByTestId('send-document-email-button')).toHaveTextContent('Send again');
  });

  it('should report a failed last attempt', async () => {
    const listDocumentEmails = vi.fn().mockResolvedValue([attempt({ outcome: 'failed', sentVia: null })]);
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({ orders: { listDocumentEmails } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    expect(await screen.findByTestId('send-document-email-status')).toHaveTextContent('Last attempt failed');
    expect(screen.queryByTestId('send-document-email-last')).not.toBeInTheDocument();
  });

  it('should explain and offer no send when the document is not ready', async () => {
    const sendEmail = vi.fn();
    renderWithProviders(
      <SendDocumentEmail
        kind="invoice"
        documentId="inv_1"
        internalOrderId="ord_1"
        buyerEmail="jan@example.com"
        notReadyReason="Available once the tax authority confirms the invoice."
      />,
      {
        apiClient: createMockApiClient({ invoicing: { sendEmail } }),
        sessionAdapter: createAuthenticatedSessionAdapter(),
      },
    );

    expect(await screen.findByTestId('send-document-email-not-ready')).toHaveTextContent(
      'Available once the tax authority confirms the invoice.',
    );
    expect(screen.getByTestId('send-document-email-button')).toBeDisabled();
    expect(screen.queryByTestId('send-document-email-recipient')).not.toBeInTheDocument();
  });

  it('should render nothing for a non-admin', async () => {
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" internalOrderId="ord_1" buyerEmail="jan@example.com" />, {
      apiClient: createMockApiClient({}),
      sessionAdapter: createAuthenticatedSessionAdapter({
        id: 'u2',
        username: 'op',
        email: 'op@example.com',
        role: 'operator',
        permissions: ['invoices:write'],
        analyticsConsent: true,
      } as never),
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('send-document-email')).not.toBeInTheDocument();
  });
});
