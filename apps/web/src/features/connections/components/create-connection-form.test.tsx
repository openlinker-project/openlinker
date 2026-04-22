import type { ReactElement } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLocation } from 'react-router-dom';
import { CreateConnectionForm } from './create-connection-form';
import {
  createMockApiClient,
  findToastDescription,
  findToastTitle,
  renderWithProviders,
} from '../../../test/test-utils';

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location-pathname">{location.pathname}</div>;
}

describe('CreateConnectionForm', () => {
  it('shows validation feedback for invalid JSON configuration', async () => {
    const view = renderWithProviders(<CreateConnectionForm />);

    fireEvent.change(within(view.container).getAllByLabelText('Connection name')[0], {
      target: { value: 'Main store' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Platform type')[0], {
      target: { value: 'prestashop' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Credentials reference')[0], {
      target: { value: 'db:cred_1' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Config JSON')[0], {
      target: { value: 'not-json' },
    });
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'Create connection' })[0]);

    expect(await screen.findByText('Please correct the highlighted fields.')).toBeInTheDocument();
    expect((await screen.findAllByText('Configuration must be valid JSON')).length).toBeGreaterThan(0);
  });

  it('shows a success toast after creating a connection', async () => {
    const view = renderWithProviders(
      <>
        <CreateConnectionForm />
        <LocationProbe />
      </>,
    );

    fireEvent.change(within(view.container).getAllByLabelText('Connection name')[0], {
      target: { value: 'Main store' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Platform type')[0], {
      target: { value: 'prestashop' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Credentials reference')[0], {
      target: { value: 'db:cred_1' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Config JSON')[0], {
      target: { value: '{"baseUrl":"https://example.com"}' },
    });
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'Create connection' })[0]);

    expect(await findToastTitle('Connection created')).toBeInTheDocument();
    expect(
      await findToastDescription('Connection "Main PrestaShop Store" was created.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('location-pathname')).toHaveTextContent('/connections');
    });
  });

  it('resets the draft through the confirm dialog', async () => {
    const view = renderWithProviders(<CreateConnectionForm />);

    fireEvent.change(within(view.container).getAllByLabelText('Connection name')[0], {
      target: { value: 'Temporary draft' },
    });
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'Reset draft' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));

    expect(within(view.container).getAllByLabelText('Connection name')[0]).toHaveValue('Temporary draft');

    fireEvent.click(within(view.container).getAllByRole('button', { name: 'Reset draft' })[0]);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reset connection draft?' })).getByRole('button', {
        name: 'Reset draft',
      }),
    );

    expect(within(view.container).getAllByLabelText('Connection name')[0]).toHaveValue('');
    expect(await findToastTitle('Draft reset')).toBeInTheDocument();
  });

  it('shows a form-level API error alert', async () => {
    const apiClient = createMockApiClient({
      connections: {
        create: async () => {
          throw new Error('API create failed');
        },
        getById: createMockApiClient().connections.getById,
        list: createMockApiClient().connections.list,
        update: createMockApiClient().connections.update,
      },
    });

    const view = renderWithProviders(<CreateConnectionForm />, { apiClient });

    fireEvent.change(within(view.container).getAllByLabelText('Connection name')[0], {
      target: { value: 'Main store' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Platform type')[0], {
      target: { value: 'prestashop' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Credentials reference')[0], {
      target: { value: 'db:cred_1' },
    });
    fireEvent.change(within(view.container).getAllByLabelText('Config JSON')[0], {
      target: { value: '{"baseUrl":"https://example.com"}' },
    });
    fireEvent.click(within(view.container).getAllByRole('button', { name: 'Create connection' })[0]);

    expect(await screen.findByText('Unable to create connection')).toBeInTheDocument();
    expect(screen.getByText('API create failed')).toBeInTheDocument();
  });
});
