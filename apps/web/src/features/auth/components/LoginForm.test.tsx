import { fireEvent, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LoginForm } from './LoginForm';
import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';

describe('LoginForm', () => {
  it('should render username and password fields', () => {
    const view = renderWithProviders(<LoginForm />);
    const container = within(view.container);

    expect(container.getAllByLabelText('Username')[0]).toBeInTheDocument();
    expect(container.getAllByLabelText('Password')[0]).toBeInTheDocument();
    expect(container.getAllByRole('button', { name: 'Sign in' })[0]).toBeInTheDocument();
  });

  it('should show validation errors when submitting empty form', async () => {
    const view = renderWithProviders(<LoginForm />);
    const container = within(view.container);

    fireEvent.click(container.getAllByRole('button', { name: 'Sign in' })[0]);

    expect((await container.findAllByText('Username is required')).length).toBeGreaterThan(0);
    expect(container.getAllByText('Password is required').length).toBeGreaterThan(0);
  });

  it('should call login mutation on valid submission', async () => {
    const apiClient = createMockApiClient();
    const view = renderWithProviders(<LoginForm />, { apiClient });
    const container = within(view.container);

    fireEvent.change(container.getAllByLabelText('Username')[0], {
      target: { value: 'admin' },
    });
    fireEvent.change(container.getAllByLabelText('Password')[0], {
      target: { value: 'secret' },
    });
    fireEvent.click(container.getAllByRole('button', { name: 'Sign in' })[0]);

    await container.findByRole('button', { name: 'Sign in' });

    expect(apiClient.auth.login).toHaveBeenCalledWith({
      username: 'admin',
      password: 'secret',
    });
  });

  it('should display API error on failed login', async () => {
    const apiClient = createMockApiClient({
      auth: {
        login: async () => {
          throw new Error('Invalid credentials');
        },
      },
    });
    const view = renderWithProviders(<LoginForm />, { apiClient });
    const container = within(view.container);

    fireEvent.change(container.getAllByLabelText('Username')[0], {
      target: { value: 'admin' },
    });
    fireEvent.change(container.getAllByLabelText('Password')[0], {
      target: { value: 'wrong' },
    });
    fireEvent.click(container.getAllByRole('button', { name: 'Sign in' })[0]);

    expect(await container.findByText('Login failed')).toBeInTheDocument();
    expect(container.getByText('Invalid credentials')).toBeInTheDocument();
  });

  it('should show pending state while login is in progress', async () => {
    const apiClient = createMockApiClient({
      auth: {
        login: () => new Promise(() => {}),
      },
    });
    const view = renderWithProviders(<LoginForm />, { apiClient });
    const container = within(view.container);

    fireEvent.change(container.getAllByLabelText('Username')[0], {
      target: { value: 'admin' },
    });
    fireEvent.change(container.getAllByLabelText('Password')[0], {
      target: { value: 'secret' },
    });
    fireEvent.click(container.getAllByRole('button', { name: 'Sign in' })[0]);

    expect(await container.findByText('Signing in...')).toBeInTheDocument();
  });
});
