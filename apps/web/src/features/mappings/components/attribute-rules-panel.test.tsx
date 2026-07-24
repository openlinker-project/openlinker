/**
 * Tests for AttributeRulesPanel (#1841).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, createMockApiClient } from '../../../test/test-utils';
import { AttributeRulesPanel } from './attribute-rules-panel';
import type { AttributeRule } from '../api/mappings.types';

const CONN = 'conn-1';

function rule(partial: Partial<AttributeRule>): AttributeRule {
  return {
    id: 'r-1',
    destinationConnectionId: CONN,
    destinationParameterName: 'Marka',
    kind: 'fixed',
    priority: 0,
    sourceConnectionId: null,
    destinationCategoryId: null,
    manufacturerMatch: null,
    phraseMatch: null,
    fixedValue: 'ACME',
    sourceAttributeKey: null,
    valueRemap: null,
    placeValueSource: null,
    ...partial,
  };
}

describe('AttributeRulesPanel', () => {
  it('renders existing rules', async () => {
    const api = createMockApiClient({
      mappings: { getAttributeRules: vi.fn().mockResolvedValue([rule({})]) },
    });
    renderWithProviders(<AttributeRulesPanel connectionId={CONN} />, { apiClient: api });

    expect(await screen.findByText('Marka')).toBeInTheDocument();
    expect(screen.getByText('= "ACME"')).toBeInTheDocument();
  });

  it('shows an empty state when there are no rules', async () => {
    const api = createMockApiClient({
      mappings: { getAttributeRules: vi.fn().mockResolvedValue([]) },
    });
    renderWithProviders(<AttributeRulesPanel connectionId={CONN} />, { apiClient: api });

    expect(await screen.findByText(/No rules configured yet/i)).toBeInTheDocument();
  });

  it('validates that a destination attribute name is required', async () => {
    const upsertAttributeRule = vi.fn().mockResolvedValue(rule({}));
    const api = createMockApiClient({
      mappings: { getAttributeRules: vi.fn().mockResolvedValue([]), upsertAttributeRule },
    });
    renderWithProviders(<AttributeRulesPanel connectionId={CONN} />, { apiClient: api });

    await screen.findByText(/No rules configured yet/i);
    await userEvent.click(screen.getByRole('button', { name: /Add rule/i }));

    expect(await screen.findByText(/Destination attribute name is required/i)).toBeInTheDocument();
    expect(upsertAttributeRule).not.toHaveBeenCalled();
  });

  it('submits a fixed-value rule', async () => {
    const upsertAttributeRule = vi.fn().mockResolvedValue(rule({}));
    const api = createMockApiClient({
      mappings: { getAttributeRules: vi.fn().mockResolvedValue([]), upsertAttributeRule },
    });
    renderWithProviders(<AttributeRulesPanel connectionId={CONN} />, { apiClient: api });

    await screen.findByText(/No rules configured yet/i);
    await userEvent.type(screen.getByLabelText('Destination attribute name'), 'Marka');
    await userEvent.type(screen.getByLabelText('Fixed value'), 'ACME');
    await userEvent.click(screen.getByRole('button', { name: /Add rule/i }));

    await waitFor(() => {
      expect(upsertAttributeRule).toHaveBeenCalledWith(
        CONN,
        expect.objectContaining({
          destinationParameterName: 'Marka',
          kind: 'fixed',
          fixedValue: 'ACME',
        })
      );
    });
  });
});
