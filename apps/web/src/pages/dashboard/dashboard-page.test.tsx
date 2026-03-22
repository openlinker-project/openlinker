import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../../test/test-utils';
import { DashboardPage } from './dashboard-page';

describe('DashboardPage', () => {
  it('renders the operations overview heading', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { name: 'Operations overview' })).toBeInTheDocument();
  });
});
