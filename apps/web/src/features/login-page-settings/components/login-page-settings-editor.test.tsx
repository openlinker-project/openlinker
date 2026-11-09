/**
 * Login Page Settings Editor tests (#4029)
 *
 * @module features/login-page-settings/components
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { LoginPageSettingsView } from '../api/login-page-settings.types';
import { LoginPageSettingsEditor } from './login-page-settings-editor';

const field = (value: string | null, source: 'setting' | 'env' | 'default') => ({ value, source });
const defaults = {
  headline: field(null, 'default'),
  headlineAccent: field(null, 'default'),
  lead: field(null, 'default'),
  formTitle: field(null, 'default'),
  formSubtitle: field(null, 'default'),
  support: field(null, 'default'),
  registerTitle: field(null, 'default'),
  registerSubtitle: field(null, 'default'),
};

const VIEW: LoginPageSettingsView = {
  copy: {
    pl: { ...defaults, headline: field('Panel Acme', 'setting') },
    en: { ...defaults, support: field('it@acme.test', 'env') },
  },
  registration: { value: false, source: 'env' },
  maxLength: {
    headline: 60,
    headlineAccent: 60,
    lead: 280,
    formTitle: 60,
    formSubtitle: 140,
    support: 200,
    registerTitle: 60,
    registerSubtitle: 140,
  },
  updatedAt: null,
  updatedBy: null,
};

function renderEditor(): ReturnType<typeof createMockApiClient> {
  const apiClient = createMockApiClient();
  renderWithProviders(<LoginPageSettingsEditor view={VIEW} initialLocale="en" />, {
    apiClient,
  });
  return apiClient;
}

describe('LoginPageSettingsEditor', () => {
  afterEach(cleanup);

  it('should show an env value as the placeholder of an empty field', async () => {
    renderEditor();
    // The support line is a rich-text editor; its placeholder sits on the empty paragraph.
    await waitFor(() =>
      expect(document.querySelector('[data-placeholder="it@acme.test"]')).not.toBeNull()
    );
    expect(screen.getByLabelText('Headline')).toHaveValue('');
  });

  it('should save both languages, keeping the other language draft', async () => {
    const apiClient = renderEditor();
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'Acme panel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.loginPageSettings.update).toHaveBeenCalledTimes(1));
    const input = vi.mocked(apiClient.loginPageSettings.update).mock.calls[0]?.[0];
    expect(input?.en?.headline).toBe('Acme panel');
    expect(input?.pl?.headline).toBe('Panel Acme');
    expect(
      await screen.findByText('Saved. The new text is live on the login page.')
    ).toBeInTheDocument();
  });

  it('should clear only the edited language on restore defaults', async () => {
    const apiClient = renderEditor();
    fireEvent.click(screen.getByRole('radio', { name: 'Polski' }));
    expect(screen.getByLabelText('Headline')).toHaveValue('Panel Acme');
    fireEvent.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(screen.getByLabelText('Headline')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.loginPageSettings.update).toHaveBeenCalledTimes(1));
    const input = vi.mocked(apiClient.loginPageSettings.update).mock.calls[0]?.[0];
    expect(input?.pl?.headline).toBe('');
    expect(input?.en?.support).toBe('');
    expect(input).not.toHaveProperty('registrationEnabled');
  });

  it('should send the registration choice once the admin changes it', async () => {
    const apiClient = renderEditor();
    fireEvent.click(screen.getByLabelText('Show a “Request access” tab on the login page'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.loginPageSettings.update).toHaveBeenCalledTimes(1));
    expect(
      vi.mocked(apiClient.loginPageSettings.update).mock.calls[0]?.[0]?.registrationEnabled
    ).toBe(true);
  });

  it('should refuse a value over the field limit', async () => {
    const apiClient = renderEditor();
    fireEvent.change(screen.getByLabelText('Headline'), { target: { value: 'x'.repeat(61) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Use at most 60 characters.')).toBeInTheDocument();
    expect(apiClient.loginPageSettings.update).not.toHaveBeenCalled();
  });

  it('should list the request-access fields when that screen is chosen', () => {
    renderEditor();
    expect(screen.queryByRole('radiogroup', { name: 'Screen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Show a “Request access” tab on the login page'));
    fireEvent.click(screen.getByRole('radio', { name: 'Request access' }));
    expect(screen.getByLabelText('Request form title')).toBeInTheDocument();
    expect(screen.queryByLabelText('Form title')).not.toBeInTheDocument();
  });
});
