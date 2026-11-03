import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChangePasswordForm } from './ChangePasswordForm';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

function fill(container: ReturnType<typeof within>, values: [string, string, string]): void {
  fireEvent.change(container.getByLabelText('One-time password'), { target: { value: values[0] } });
  fireEvent.change(container.getByLabelText('New password'), { target: { value: values[1] } });
  fireEvent.change(container.getByLabelText('Confirm new password'), {
    target: { value: values[2] },
  });
}

describe('ChangePasswordForm', () => {
  it('should render the three fields', () => {
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />);
    const container = within(view.container);

    expect(container.getByLabelText('One-time password')).toBeInTheDocument();
    expect(container.getByLabelText('New password')).toBeInTheDocument();
    expect(container.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('should show validation errors and not call the API when the form is empty', async () => {
    const apiClient = createMockApiClient();
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />, { apiClient });
    const container = within(view.container);

    fireEvent.click(container.getByRole('button', { name: 'Set my password' }));

    expect(
      (await container.findAllByText('Enter the one-time password you were given')).length,
    ).toBeGreaterThan(0);
    expect(apiClient.auth.changePassword).not.toHaveBeenCalled();
  });

  it('should reject a confirmation that does not match', async () => {
    const apiClient = createMockApiClient();
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />, { apiClient });
    const container = within(view.container);

    fill(container, ['temp-password-1', 'brand-new-pass', 'different-pass']);
    fireEvent.click(container.getByRole('button', { name: 'Set my password' }));

    expect((await container.findAllByText('Passwords do not match')).length).toBeGreaterThan(0);
    expect(apiClient.auth.changePassword).not.toHaveBeenCalled();
  });

  it('should reject a new password equal to the one-time password', async () => {
    const apiClient = createMockApiClient();
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />, { apiClient });
    const container = within(view.container);

    fill(container, ['same-password-1', 'same-password-1', 'same-password-1']);
    fireEvent.click(container.getByRole('button', { name: 'Set my password' }));

    expect(
      (await container.findAllByText('Choose a password different from the one-time password'))
        .length,
    ).toBeGreaterThan(0);
    expect(apiClient.auth.changePassword).not.toHaveBeenCalled();
  });

  it('should send the one-time and new password on a valid submission', async () => {
    const apiClient = createMockApiClient();
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />, { apiClient });
    const container = within(view.container);

    fill(container, ['temp-password-1', 'brand-new-pass', 'brand-new-pass']);
    fireEvent.click(container.getByRole('button', { name: 'Set my password' }));

    await container.findByRole('button', { name: 'Set my password' });
    expect(apiClient.auth.changePassword).toHaveBeenCalledWith({
      currentPassword: 'temp-password-1',
      newPassword: 'brand-new-pass',
    });
  });

  it('should display the API error when the one-time password is wrong', async () => {
    const apiClient = createMockApiClient({
      auth: {
        changePassword: async () => {
          throw new Error('Current password is incorrect');
        },
      },
    });
    const view = renderWithProviders(<ChangePasswordForm nextPath="/" />, { apiClient });
    const container = within(view.container);

    fill(container, ['wrong-password', 'brand-new-pass', 'brand-new-pass']);
    fireEvent.click(container.getByRole('button', { name: 'Set my password' }));

    expect(await container.findByText('Password not changed')).toBeInTheDocument();
    expect(container.getByText('Current password is incorrect')).toBeInTheDocument();
  });
});
