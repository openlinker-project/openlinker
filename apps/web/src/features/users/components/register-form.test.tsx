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
        register: vi
          .fn()
          .mockRejectedValue(new ApiError('Email already registered', 409, null)),
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

    it('should render a pre-checked analytics consent checkbox in demo mode (#1743)', () => {
      renderWithProviders(<RegisterForm demoMode />);

      const checkbox = screen.getByRole('checkbox', { name: /share anonymous usage analytics/i });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).toBeChecked();
    });

    it('should not render the analytics consent checkbox outside demo mode', () => {
      renderWithProviders(<RegisterForm />);

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('should submit analyticsConsent=true when the checkbox is left checked', async () => {
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
        expect.objectContaining({ username: 'demo_user', analyticsConsent: true }),
      );
    });

    it('should submit analyticsConsent=false after the user unchecks it', async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true });
      const mockApi = createMockApiClient({ auth: { register: registerFn } });
      renderWithProviders(<RegisterForm demoMode />, { apiClient: mockApi });

      await userEvent.type(screen.getByLabelText(/username/i), 'demo_user');
      await userEvent.type(screen.getByLabelText(/email/i), 'demo@test.com');
      await userEvent.type(screen.getByLabelText('Password'), 'password123');
      await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
      await userEvent.click(
        screen.getByRole('checkbox', { name: /share anonymous usage analytics/i }),
      );
      await userEvent.click(screen.getByRole('button', { name: /start exploring/i }));

      await screen.findByText(/check your email to confirm your account/i);
      expect(registerFn).toHaveBeenCalledWith(
        expect.objectContaining({ analyticsConsent: false }),
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

      expect(await screen.findByText(/check your email to confirm your account/i)).toBeInTheDocument();
    });
  });
});
