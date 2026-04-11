import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils';
import { ConnectionConfigPanel } from './ConnectionConfigPanel';

describe('ConnectionConfigPanel', () => {
  afterEach(cleanup);

  it('renders config JSON when config has keys', () => {
    const config = { baseUrl: 'https://example.com', apiKey: 'test' };
    renderWithProviders(<ConnectionConfigPanel config={config} />);

    expect(screen.getByText(/Connection config/)).toBeInTheDocument();
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    expect(screen.getByText('2 keys')).toBeInTheDocument();
  });

  it('shows empty message when config is empty', () => {
    renderWithProviders(<ConnectionConfigPanel config={{}} />);

    expect(screen.getByText('No configuration values set.')).toBeInTheDocument();
    expect(screen.getByText('0 keys')).toBeInTheDocument();
  });
});
