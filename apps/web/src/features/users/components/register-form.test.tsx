import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { ApiError } from '../../../shared/api/api-error';
import { RegisterForm } from './register-form';

describe('RegisterForm', () => {
  afterEach(cleanup);

  it('should show validation errors after an empty submit', async () => {
    const mockApi = createMockApiClient({});
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect((await screen.findAllByText('Username is required')).length).toBeGreaterThan(0);
  });

  it('should show validation error for invalid email', async () => {
    const mockApi = createMockApiClient({});
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect((await screen.findAllByText('Enter a valid email address')).length).toBeGreaterThan(0);
  });

  it('should show validation error when passwords do not match', async () => {
    const mockApi = createMockApiClient({});
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different999');
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect((await screen.findAllByText('Passwords do not match')).length).toBeGreaterThan(0);
  });

  it('should show success state after successful registration', async () => {
    const mockApi = createMockApiClient({
      auth: { register: vi.fn().mockResolvedValue({ ok: true }) },
    });
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(await screen.findByText(/registration submitted/i)).toBeInTheDocument();
  });

  it('should show API error when registration fails', async () => {
    const mockApi = createMockApiClient({
      auth: { register: vi.fn().mockRejectedValue(new Error('Username already taken')) },
    });
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(await screen.findByText('Username already taken')).toBeInTheDocument();
  });

  it('should show a dedicated message when registration fails with a 409 (#1625)', async () => {
    const mockApi = createMockApiClient({
      auth: {
        register: vi.fn().mockRejectedValue(new ApiError('Email already registered', 409, null)),
      },
    });
    renderWithProviders(<RegisterForm />, { apiClient: mockApi });

    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /request access/i }));

    expect(await screen.findByText('This email is already registered.')).toBeInTheDocument();
  });

  describe('demo mode', () => {
    it('should show the demo bar when demoMode is true', () => {
      renderWithProviders(<RegisterForm demoMode />);

      expect(screen.getByText(/OpenLinker Demo/i)).toBeInTheDocument();
      expect(screen.getByText(/confirm and activate your account/i)).toBeInTheDocument();
    });

    it('should show the demo callout when demoMode is true', () => {
      renderWithProviders(<RegisterForm demoMode />);

      expect(screen.getByText(/demo mode active/i)).toBeInTheDocument();
      expect(screen.getByText(/no approval needed/i)).toBeInTheDocument();
    });

    it('should show "Start exploring →" submit button when demoMode is true', () => {
      renderWithProviders(<RegisterForm demoMode />);

      expect(screen.getByRole('button', { name: /start exploring/i })).toBeInTheDocument();
    });

    it('should show "Request access" submit button when demoMode is false', () => {
      renderWithProviders(<RegisterForm />);

      expect(screen.getByRole('button', { name: /request access/i })).toBeInTheDocument();
    });

    it('should disclose that recording applies, with no checkbox to decide (#1938)', () => {
      renderWithProviders(<RegisterForm demoMode />);

      // Recording is a condition of the demo, not a choice on this form — so the
      // notice is body copy, and there is nothing to tick.
      expect(screen.getByText(/demo sessions are recorded/i)).toBeInTheDocument();
      expect(screen.getByText(/by creating an account you accept this/i)).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /agree/i })).not.toBeInTheDocument();
    });

    it('should keep the recording detail one click away (#1938)', async () => {
      renderWithProviders(<RegisterForm demoMode />);

      const summary = screen.getByText(/what we record/i);
      expect(summary.closest('details')).not.toHaveAttribute('open');

      await userEvent.click(summary);

      expect(screen.getByText(/text you type, except passwords/i)).toBeInTheDocument();
    });

    it('should not mention recording outside demo mode', () => {
      renderWithProviders(<RegisterForm />);

      expect(screen.queryByText(/demo sessions are recorded/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/what we record/i)).not.toBeInTheDocument();
    });

    it('should submit analyticsConsent=true from a demo registration (#1938)', async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true });
      const mockApi = createMockApiClient({ auth: { register: registerFn } });
      renderWithProviders(<RegisterForm demoMode />, { apiClient: mockApi });

      await userEvent.type(screen.getByLabelText(/username/i), 'demo_user');
      await userEvent.type(screen.getByLabelText(/email/i), 'demo@test.com');
      await userEvent.type(screen.getByLabelText('Password'), 'password123');
      await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
      await userEvent.click(screen.getByRole('button', { name: /start exploring/i }));

      await screen.findByText(/check your email to confirm your account/i);
      expect(registerFn).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'demo_user', analyticsConsent: true })
      );
    });

    it('should submit analyticsConsent=false outside demo mode, where nothing records', async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true });
      const mockApi = createMockApiClient({ auth: { register: registerFn } });
      renderWithProviders(<RegisterForm />, { apiClient: mockApi });

      await userEvent.type(screen.getByLabelText(/username/i), 'alice');
      await userEvent.type(screen.getByLabelText(/email/i), 'alice@test.com');
      await userEvent.type(screen.getByLabelText('Password'), 'password123');
      await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
      await userEvent.click(screen.getByRole('button', { name: /request access/i }));

      await screen.findByText(/registration submitted/i);
      expect(registerFn).toHaveBeenCalledWith(
        expect.objectContaining({ analyticsConsent: false })
      );
    });

    it('should show demo success copy after registration in demo mode', async () => {
      const mockApi = createMockApiClient({
        auth: { register: vi.fn().mockResolvedValue({ ok: true }) },
      });
      renderWithProviders(<RegisterForm demoMode />, { apiClient: mockApi });

      await userEvent.type(screen.getByLabelText(/username/i), 'demo_user');
      await userEvent.type(screen.getByLabelText(/email/i), 'demo@test.com');
      await userEvent.type(screen.getByLabelText('Password'), 'password123');
      await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
      await userEvent.click(screen.getByRole('button', { name: /start exploring/i }));

      expect(
        await screen.findByText(/check your email to confirm your account/i)
      ).toBeInTheDocument();
    });
  });

  describe('tracking footnote', () => {
    it('should show the footnote when showTrackingFootnote is true', () => {
      renderWithProviders(<RegisterForm showTrackingFootnote />);

      expect(screen.getByText(/logged for analytics/i)).toBeInTheDocument();
    });

    it('should not show the footnote when showTrackingFootnote is false', () => {
      renderWithProviders(<RegisterForm showTrackingFootnote={false} />);

      expect(screen.queryByText(/logged for analytics/i)).not.toBeInTheDocument();
    });
  });
});
