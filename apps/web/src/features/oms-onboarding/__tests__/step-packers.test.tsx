/**
 * StepPackers - component spec (#3457)
 *
 * The one step that creates user accounts: the form's validation, the create
 * call, the one-time password shown once, and the 409 mapped to the right field.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../shared/api/api-error';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { StepPackers, type StepPackersProps } from '../components/step-packers';

function baseProps(overrides: Partial<StepPackersProps> = {}): StepPackersProps {
  return {
    packers: [],
    canWrite: true,
    demoReadOnly: false,
    onBack: vi.fn(),
    onContinue: vi.fn(),
    ...overrides,
  };
}

function fillPacker(name: string, login: string, email = ''): void {
  fireEvent.change(screen.getByTestId('input-p-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('input-p-login'), { target: { value: login } });
  fireEvent.change(screen.getByTestId('input-p-mail'), { target: { value: email } });
}

describe('StepPackers', () => {
  it('should offer Skip until at least one packer exists, then Continue', () => {
    const { rerender } = renderWithProviders(<StepPackers {...baseProps()} />);
    expect(screen.getByTestId('btn-continue-step-2')).toHaveTextContent(/skip/i);

    rerender(
      <StepPackers
        {...baseProps({ packers: [{ id: 'u1', username: 'anna' } as never] })}
      />,
    );
    expect(screen.getByTestId('btn-continue-step-2')).not.toHaveTextContent(/skip/i);
  });

  it('should not call the API and should explain when the name and login are empty', async () => {
    const create = vi.fn();
    const apiClient = createMockApiClient({ users: { create } });
    renderWithProviders(<StepPackers {...baseProps()} />, { apiClient });

    fireEvent.click(screen.getByTestId('btn-add-packer'));

    expect((await screen.findAllByText('Enter a name.')).length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('should reject a login containing @', async () => {
    const create = vi.fn();
    const apiClient = createMockApiClient({ users: { create } });
    renderWithProviders(<StepPackers {...baseProps()} />, { apiClient });

    fillPacker('Anna', 'anna@example.com');
    fireEvent.click(screen.getByTestId('btn-add-packer'));

    expect((await screen.findAllByText('A login cannot contain "@".')).length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('should create a packer and show the one-time password once', async () => {
    const apiClient = createMockApiClient({
      users: { create: vi.fn().mockResolvedValue({ id: 'u1', temporaryPassword: 'Tmp-pass-1234' }) },
    });
    renderWithProviders(<StepPackers {...baseProps()} />, { apiClient });

    fillPacker('Anna Kowalska', 'anna');
    fireEvent.click(screen.getByTestId('btn-add-packer'));

    const notice = await screen.findByTestId('packer-created-notice');
    expect(notice).toBeInTheDocument();
    expect(screen.getByTestId('input-tmp-pass')).toHaveValue('Tmp-pass-1234');
    expect(apiClient.users.create).toHaveBeenCalledWith({
      displayName: 'Anna Kowalska',
      username: 'anna',
      email: undefined,
      role: 'packer',
    });
  });

  it('should send the email when one is given', async () => {
    const apiClient = createMockApiClient({
      users: { create: vi.fn().mockResolvedValue({ id: 'u1', temporaryPassword: 'x' }) },
    });
    renderWithProviders(<StepPackers {...baseProps()} />, { apiClient });

    fillPacker('Anna', 'anna', 'anna@example.com');
    fireEvent.click(screen.getByTestId('btn-add-packer'));

    await waitFor(() =>
      expect(apiClient.users.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'anna@example.com' }),
      ),
    );
  });

  it('should map a username conflict onto the login field', async () => {
    const apiClient = createMockApiClient({
      users: {
        create: vi.fn().mockRejectedValue(
          new ApiError('That username is already in use.', 409, { field: 'username' }),
        ),
      },
    });
    renderWithProviders(<StepPackers {...baseProps()} />, { apiClient });

    fillPacker('Anna', 'anna');
    fireEvent.click(screen.getByTestId('btn-add-packer'));

    expect(
      (await screen.findAllByText('That login is already taken. Pick another one.')).length,
    ).toBeGreaterThan(0);
  });

  it('should disable the form controls for a non-admin', () => {
    renderWithProviders(<StepPackers {...baseProps({ canWrite: false })} />);

    expect(screen.getByTestId('btn-add-packer')).toBeDisabled();
  });
});
