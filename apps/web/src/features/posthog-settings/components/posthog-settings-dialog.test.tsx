/**
 * PostHog Settings Dialog — Tests
 *
 * Covers prefill (non-secret fields only — API key stays blank even when
 * `apiKeyConfigured` is true), submit wiring (update, plus a conditional
 * credentials rotation only when a key was typed), the region-conditional
 * custom-host field, "Reset to environment", and the "Send test event"
 * action (mocking `global.fetch` against PostHog's public endpoint).
 *
 * @module apps/web/src/features/posthog-settings/components
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import type { PosthogSettingsView } from '../api/posthog-settings.types';
import { PosthogSettingsDialog } from './posthog-settings-dialog';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

afterEach(cleanup);

const usView: PosthogSettingsView = {
  enabled: true,
  region: 'us',
  customHost: null,
  autocapture: true,
  sessionRecording: true,
  productEventsEnabled: false,
  enabledEventGroups: [],
  apiKeyConfigured: true,
  wouldOverrideEnv: false,
  overriddenEnvVars: [],
  updatedAt: '2026-07-01T00:00:00.000Z',
  updatedBy: 'admin',
};

describe('PosthogSettingsDialog', () => {
  it('prefills the non-secret fields and leaves the API key blank', () => {
    renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />);

    expect(screen.getByLabelText(/enable posthog/i)).toBeChecked();
    expect(screen.getByLabelText(/api key/i)).toHaveValue('');
    expect(screen.getByText(/Configured\. Leave blank to keep it/)).toBeInTheDocument();
    expect(screen.getByLabelText(/autocapture/i)).toBeChecked();
    expect(screen.getByLabelText(/session recording/i)).toBeChecked();
  });

  it('shows the custom host field only when region is custom', () => {
    renderWithProviders(
      <PosthogSettingsDialog open view={{ ...usView, region: 'eu' }} onClose={() => undefined} />,
    );

    expect(screen.queryByLabelText(/custom host url/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/region/i), { target: { value: 'custom' } });

    expect(screen.getByLabelText(/custom host url/i)).toBeInTheDocument();
  });

  it('submits the update mutation with the current form values', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ posthogSettings: { update } });
    const onClose = vi.fn();

    renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={onClose} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({
        enabled: true,
        region: 'us',
        customHost: null,
        autocapture: true,
        sessionRecording: true,
        productEventsEnabled: false,
        enabledEventGroups: [],
      });
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('rotates the API key only when a new value was typed', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ posthogSettings: { update, setCredentials } });

    renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />, {
      apiClient,
    });

    fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'phc_new_key' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(setCredentials).toHaveBeenCalledWith({ apiKey: 'phc_new_key' });
    });
  });

  it('does not rotate the API key when the field is left blank', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const setCredentials = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ posthogSettings: { update, setCredentials } });

    renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalled();
    });
    expect(setCredentials).not.toHaveBeenCalled();
  });

  it('resets to environment when "Reset to environment" is clicked', async () => {
    const clearCredentials = vi.fn().mockResolvedValue(undefined);
    const update = vi.fn().mockResolvedValue(undefined);
    const apiClient = createMockApiClient({ posthogSettings: { clearCredentials, update } });

    renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />, {
      apiClient,
    });

    fireEvent.click(screen.getByRole('button', { name: /reset to environment/i }));

    await waitFor(() => {
      expect(clearCredentials).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
  });

  describe('send test event', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    it('shows a success result when PostHog accepts the request', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />);

      fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'phc_test_key' } });
      fireEvent.click(screen.getByRole('button', { name: /send test event/i }));

      expect(await screen.findByText('Accepted')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith(
        'https://us.i.posthog.com/flags/?v=2',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('shows a rejected result when PostHog rejects the request (region/key mismatch)', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

      renderWithProviders(<PosthogSettingsDialog open view={usView} onClose={() => undefined} />);

      fireEvent.change(screen.getByLabelText(/api key/i), { target: { value: 'phc_test_key' } });
      fireEvent.click(screen.getByRole('button', { name: /send test event/i }));

      expect(await screen.findByText(/Rejected/)).toBeInTheDocument();
    });
  });
});
