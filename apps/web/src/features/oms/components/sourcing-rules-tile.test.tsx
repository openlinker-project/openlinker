/**
 * Sourcing-rules tile (#3062)
 *
 * The tile is the ONLY way into the screen (#3060 — no sidebar entry), so the
 * one thing worth asserting is that its link is the route that exists.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { SourcingRulesTile } from './sourcing-rules-tile';

describe('SourcingRulesTile (#3060)', () => {
  it('links to the route the page is registered at', () => {
    renderWithProviders(<SourcingRulesTile />, { apiClient: createMockApiClient() });

    // With no nav entry, a wrong href here makes the whole screen unreachable
    // and nothing else in the app would notice.
    expect(screen.getByRole('link', { name: 'Manage sourcing rules' })).toHaveAttribute(
      'href',
      '/settings/sourcing-rules'
    );
  });

  it('says what the screen decides, not merely that it exists', () => {
    renderWithProviders(<SourcingRulesTile />, { apiClient: createMockApiClient() });

    expect(screen.getByText(/which of your locations may fulfil an order/)).toBeInTheDocument();
  });
});
