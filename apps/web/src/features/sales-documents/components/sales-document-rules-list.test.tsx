/**
 * SalesDocumentRulesList Tests (#3178)
 *
 * Covers the one behaviour this issue adds: a list-level warning when a
 * rule names a connection that cannot be a routing candidate — set to issue
 * Nothing (`documentKind` unset, or the connection carries neither
 * `Invoicing` nor `Fiscalization`), or not `active`. Such a rule can never
 * route.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockApiClient, renderWithProviders, sampleConnection } from '../../../test/test-utils';
import { SalesDocumentRulesList } from './sales-document-rules-list';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import type { Connection } from '../../connections';

function makeRule(overrides: Partial<SalesDocumentRule> = {}): SalesDocumentRule {
  return {
    id: 'rule_1',
    country: 'PL',
    conditions: [],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn_epar',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    provenance: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    ...sampleConnection,
    id: 'conn_epar',
    name: 'e-paragony Sandbox',
    platformType: 'eparagony',
    enabledCapabilities: ['Fiscalization'],
    supportedCapabilities: ['Fiscalization'],
    config: {},
    ...overrides,
  };
}

describe('SalesDocumentRulesList', () => {
  it('should render the destination warning when a rule names a connection issuing Nothing', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([makeConnection()]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    const warning = await screen.findByTestId('rules-destination-warning');
    expect(warning).toHaveTextContent('e-paragony Sandbox');
    expect(warning).toHaveTextContent('Nothing');
  });

  it('should render the disabled remedy, not the role one, for a non-active destination', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([
          makeConnection({
            status: 'disabled',
            config: { salesDocument: { documentKind: 'fiscal-receipt' } },
          }),
        ]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    const warning = await screen.findByTestId('rules-destination-warning');
    expect(warning).toHaveTextContent('is disabled');
    expect(warning).toHaveTextContent('Enable it');
  });

  it('should not render the warning when the destination has a document kind configured', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([makeRule()]),
      },
      connections: {
        list: vi
          .fn()
          .mockResolvedValue([
            makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } }),
          ]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    await screen.findByText(/Rules have no order of priority/);
    expect(screen.queryByTestId('rules-destination-warning')).not.toBeInTheDocument();
  });

  it('should not render the warning when there are no rules', async () => {
    const apiClient = createMockApiClient({
      salesDocumentRules: {
        listRules: vi.fn().mockResolvedValue([]),
      },
      connections: {
        list: vi.fn().mockResolvedValue([makeConnection()]),
      },
    });

    renderWithProviders(<SalesDocumentRulesList country="PL" />, { apiClient });

    await screen.findByText('No rules yet for this country.');
    expect(screen.queryByTestId('rules-destination-warning')).not.toBeInTheDocument();
  });
});
