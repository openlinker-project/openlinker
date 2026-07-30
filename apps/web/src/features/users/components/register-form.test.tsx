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

    it('should render the consent checkbox pre-ticked inside a collapsed disclosure (#1938)', () => {
      renderWithProviders(<RegisterForm demoMode />);

      const checkbox = screen.getByRole('checkbox', { name: /record my demo session/i });
      expect(checkbox).toBeChecked();
      // Collapsed by default: the summary is the only visible affordance, so the
      // happy path never stops to decide anything.
      expect(screen.getByText(/privacy and session recording/i)).toBeInTheDocument();
      expect(checkbox.closest('details')).not.toHaveAttribute('open');
    });

    it('should state that recording is on in fine print under the submit button (#1938)', () => {
      renderWithProviders(<RegisterForm demoMode />);

      expect(screen.getByText(/demo accounts have session recording on/i)).toBeInTheDocument();
    });

    it('should not render the consent checkbox outside demo mode', () => {
      renderWithProviders(<RegisterForm />);

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/demo accounts have session recording on/i)).not.toBeInTheDocument();
    });

    it('should submit analyticsConsent=true without the visitor touching the checkbox', async () => {
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

    it('should block submission and explain why when consent is unticked (#1938)', async () => {
      const registerFn = vi.fn().mockResolvedValue({ ok: true });
      const mockApi = createMockApiClient({ auth: { register: registerFn } });
      renderWithProviders(<RegisterForm demoMode />, { apiClient: mockApi });

      await userEvent.click(screen.getByRole('checkbox', { name: /record my demo session/i }));

      // The message lands on unticking, not on a rejected submit.
      expect(
        await screen.findByText(/demo accounts need session recording/i)
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /start exploring/i })).toBeDisabled();
      expect(registerFn).not.toHaveBeenCalled();
    });

    it('should keep the disclosure open while consent is unticked (#1938)', async () => {
      renderWithProviders(<RegisterForm demoMode />);

      const checkbox = screen.getByRole('checkbox', { name: /record my demo session/i });
      await userEvent.click(checkbox);

      expect(checkbox.closest('details')).toHaveAttribute('open');
    });

    it('should show the consent error once, not also in the form error summary (#1938)', async () => {
      renderWithProviders(<RegisterForm demoMode />);

      await userEvent.click(screen.getByRole('checkbox', { name: /record my demo session/i }));

      expect(screen.getAllByText(/demo accounts need session recording/i)).toHaveLength(1);
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
