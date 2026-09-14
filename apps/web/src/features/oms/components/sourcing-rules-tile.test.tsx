/**
 * Sourcing-rules tile (#3062)
 *
 * The tile is the ONLY way into the screen (#3060 — no sidebar entry), so the
 * one thing worth asserting is that its link is the route that exists.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMockApiClient, renderWithProviders } from '../../../test/test-utils';
import { SOURCING_RULES_TILE_COPY } from '../lib/sourcing-rule.copy';
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

  it('renders a description that explains the screen rather than restating its name', () => {
    renderWithProviders(<SourcingRulesTile />, { apiClient: createMockApiClient() });

    // Two halves, neither of which is the sentence itself: the tile really
    // renders the copy constant (a mis-wired tile renders nothing), and that
    // constant is an explanation rather than the title again. Asserting the
    // literal would go red on any copy edit, improvement included.
    expect(screen.getByText(SOURCING_RULES_TILE_COPY.description)).toBeInTheDocument();
    expect(SOURCING_RULES_TILE_COPY.description.trim()).not.toBe(SOURCING_RULES_TILE_COPY.title);
    expect(SOURCING_RULES_TILE_COPY.description.trim().length).toBeGreaterThan(
      SOURCING_RULES_TILE_COPY.title.length
    );
  });
});
