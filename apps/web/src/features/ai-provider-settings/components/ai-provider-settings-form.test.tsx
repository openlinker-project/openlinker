/**
 * AI Provider Settings Form — Unit Tests
 *
 * Asserts: validation gates submission, the trimmed key flows to the
 * update mutation, the clear button only appears for `source=db`, and
 * the clear flow goes through the confirm dialog before calling the
 * clear mutation.
 *
 * @module apps/web/src/features/ai-provider-settings/components
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { AiProviderSettingsForm } from './ai-provider-settings-form';

// jsdom does not implement showModal/close — stub them on HTMLDialogElement
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

describe('AiProviderSettingsForm', () => {
  it('submits a valid apiKey, calls the update mutation, and clears the field on success', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ aiProviderSettings: { update } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="none" />, { apiClient });

    const input = screen.getByLabelText<HTMLInputElement>('API key');
    await user.type(input, 'sk-ant-test-key-12345');
    await user.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ apiKey: 'sk-ant-test-key-12345' });
    });
    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('trims the key before submitting (paste with surrounding whitespace)', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ aiProviderSettings: { update } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="none" />, { apiClient });

    const input = screen.getByLabelText('API key');
    await user.type(input, '   sk-ant-pasted-with-spaces   ');
    await user.click(screen.getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ apiKey: 'sk-ant-pasted-with-spaces' });
    });
  });

  it('blocks submission and shows a validation message when apiKey is too short', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ aiProviderSettings: { update } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="none" />, { apiClient });

    await user.type(screen.getByLabelText('API key'), 'short');
    await user.click(screen.getByRole('button', { name: /save key/i }));

    // Both the inline FieldError and the post-submit FormErrorSummary render the same
    // message — assert at least one match rather than uniqueness.
    const matches = await screen.findAllByText(/at least 8 characters/i);
    expect(matches.length).toBeGreaterThan(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('renders the API error in an Alert at the form top when the update fails', async () => {
    const update = vi.fn().mockRejectedValue(new Error('Active provider does not require an API key'));
    const apiClient = createMockApiClient({ aiProviderSettings: { update } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="none" />, { apiClient });

    await user.type(screen.getByLabelText('API key'), 'sk-ant-valid-shape-key');
    await user.click(screen.getByRole('button', { name: /save key/i }));

    expect(
      await screen.findByText('Active provider does not require an API key'),
    ).toBeInTheDocument();
  });

  it('does not render the clear button when source is none', () => {
    renderWithProviders(<AiProviderSettingsForm currentSource="none" />);
    expect(
      screen.queryByRole('button', { name: /clear stored key/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render the clear button when source is env', () => {
    renderWithProviders(<AiProviderSettingsForm currentSource="env" />);
    expect(
      screen.queryByRole('button', { name: /clear stored key/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the clear button when source is db and gates the clear behind a confirm dialog', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ aiProviderSettings: { clear } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="db" />, { apiClient });

    await user.click(screen.getByRole('button', { name: /clear stored key/i }));

    // ConfirmDialog opens
    expect(
      await screen.findByRole('heading', { name: /clear stored api key\?/i }),
    ).toBeInTheDocument();

    // Cancel without confirming → clear mutation is not invoked
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(clear).not.toHaveBeenCalled();
  });

  it('calls the clear mutation when the user confirms the dialog', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ aiProviderSettings: { clear } });
    const user = userEvent.setup();

    renderWithProviders(<AiProviderSettingsForm currentSource="db" />, { apiClient });

    await user.click(screen.getByRole('button', { name: /clear stored key/i }));
    await user.click(screen.getByRole('button', { name: 'Clear key' }));

    await waitFor(() => {
      expect(clear).toHaveBeenCalledTimes(1);
    });
  });
});
