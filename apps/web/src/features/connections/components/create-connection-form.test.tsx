import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CreateConnectionForm } from './create-connection-form';
import { renderWithProviders } from '../../../test/test-utils';

describe('CreateConnectionForm', () => {
  it('shows validation feedback for invalid JSON configuration', async () => {
    renderWithProviders(<CreateConnectionForm />);

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'Main store' },
    });
    fireEvent.change(screen.getByLabelText('Platform type'), {
      target: { value: 'prestashop' },
    });
    fireEvent.change(screen.getByLabelText('Credentials reference'), {
      target: { value: 'db:cred_1' },
    });
    fireEvent.change(screen.getByLabelText('Config JSON'), {
      target: { value: 'not-json' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create connection' }));

    expect(await screen.findByText('Configuration must be valid JSON')).toBeInTheDocument();
  });
});
