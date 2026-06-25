import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
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
});
