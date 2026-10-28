import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  createAuthenticatedSessionAdapter,
  createMockApiClient,
  renderWithProviders,
} from '../../../test/test-utils';
import { SendDocumentEmail } from './send-document-email';

describe('SendDocumentEmail', () => {
  it('should send an invoice and name the sender when the operator is admin', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: 'a@b.pl', sentVia: 'openlinker' });
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.type(await screen.findByTestId('send-document-email-recipient'), 'a@b.pl');
    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('inv_1', { locale: 'pl', recipient: 'a@b.pl' });
    expect(await screen.findByTestId('send-document-email-sent-via')).toHaveTextContent('OpenLinker');
  });

  it('should send a receipt through the fiscalization route', async () => {
    const sendEmail = vi.fn().mockResolvedValue({ delivered: true, recipient: null, sentVia: 'openlinker' });
    renderWithProviders(<SendDocumentEmail kind="fiscal-receipt" documentId="fr_1" />, {
      apiClient: createMockApiClient({ fiscalization: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(sendEmail).toHaveBeenCalledWith('fr_1', { locale: 'pl' });
  });

  it('should render the server refusal verbatim', async () => {
    const sendEmail = vi.fn().mockRejectedValue(new Error('This invoice has no document to attach yet.'));
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" />, {
      apiClient: createMockApiClient({ invoicing: { sendEmail } }),
      sessionAdapter: createAuthenticatedSessionAdapter(),
    });

    await userEvent.click(await screen.findByTestId('send-document-email-button'));

    expect(await screen.findByTestId('send-document-email-error')).toHaveTextContent(
      'This invoice has no document to attach yet.',
    );
  });

  it('should render nothing for a non-admin', async () => {
    renderWithProviders(<SendDocumentEmail kind="invoice" documentId="inv_1" />, {
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
