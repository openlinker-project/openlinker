import { describe, expect, it } from 'vitest';
import type { Connection } from '../../connections';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import {
  describeSalesDocumentDestinationWarning,
  describeSalesDocumentDestinationWarningTitle,
  findSalesDocumentDestinationWarnings,
} from './find-sales-document-destination-warnings';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'e-paragony Sandbox',
    platformType: 'eparagony',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: ['Fiscalization'],
    supportedCapabilities: ['Fiscalization'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRule(overrides: Partial<SalesDocumentRule> = {}): SalesDocumentRule {
  return {
    id: 'rule_1',
    country: 'PL',
    conditions: [],
    documentKind: 'fiscal-receipt',
    connectionId: 'conn_1',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    provenance: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('findSalesDocumentDestinationWarnings', () => {
  it('should report nothing when the destination has a document kind configured', () => {
    const connections = [makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } })];

    expect(findSalesDocumentDestinationWarnings([makeRule()], connections)).toEqual([]);
  });

  it('should report the connection when its documentKind is unset (issues Nothing)', () => {
    const connections = [makeConnection()];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections);

    expect(warnings).toEqual([
      { connectionId: 'conn_1', connectionName: 'e-paragony Sandbox', affectedRuleCount: 1 },
    ]);
  });

  it('should report a connection that has neither Invoicing nor Fiscalization enabled', () => {
    const connections = [makeConnection({ enabledCapabilities: ['ProductMaster'], supportedCapabilities: ['ProductMaster'] })];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections);

    expect(warnings).toEqual([
      { connectionId: 'conn_1', connectionName: 'e-paragony Sandbox', affectedRuleCount: 1 },
    ]);
  });

  it('should collapse several rules naming the same dead connection into one warning', () => {
    const connections = [makeConnection()];
    const rules = [
      makeRule({ id: 'rule_1' }),
      makeRule({ id: 'rule_2', conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }] }),
    ];

    const warnings = findSalesDocumentDestinationWarnings(rules, connections);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].affectedRuleCount).toBe(2);
  });

  it('should report one warning per distinct offending connection', () => {
    const connections = [
      makeConnection({ id: 'conn_1', name: 'e-paragony Sandbox' }),
      makeConnection({ id: 'conn_2', name: 'Ksef Demo', enabledCapabilities: ['Invoicing'], supportedCapabilities: ['Invoicing'] }),
    ];
    const rules = [
      makeRule({ id: 'rule_1', connectionId: 'conn_1' }),
      makeRule({ id: 'rule_2', connectionId: 'conn_2', documentKind: 'invoice' }),
    ];

    const warnings = findSalesDocumentDestinationWarnings(rules, connections);

    expect(warnings.map((w) => w.connectionId)).toEqual(['conn_1', 'conn_2']);
  });

  it('should fall back to the connectionId when the connection cannot be found', () => {
    const warnings = findSalesDocumentDestinationWarnings(
      [makeRule({ connectionId: 'conn_deleted' })],
      [],
    );

    expect(warnings).toEqual([
      { connectionId: 'conn_deleted', connectionName: 'conn_deleted', affectedRuleCount: 1 },
    ]);
  });
});

describe('describeSalesDocumentDestinationWarningTitle', () => {
  it('should singularize for exactly one offending destination', () => {
    expect(describeSalesDocumentDestinationWarningTitle(1)).toBe(
      'One destination is not issuing anything',
    );
  });

  it('should pluralize for more than one', () => {
    expect(describeSalesDocumentDestinationWarningTitle(2)).toBe(
      '2 destinations are not issuing anything',
    );
  });
});

describe('describeSalesDocumentDestinationWarning', () => {
  it('should name the connection and use singular phrasing for one affected rule', () => {
    const text = describeSalesDocumentDestinationWarning({
      connectionId: 'conn_1',
      connectionName: 'e-paragony Sandbox',
      affectedRuleCount: 1,
    });

    expect(text).toBe(
      'e-paragony Sandbox is set to issue Nothing under Connected providers, so the rule naming it cannot route. Give it a role, or point it elsewhere.',
    );
  });

  it('should use plural phrasing for more than one affected rule', () => {
    const text = describeSalesDocumentDestinationWarning({
      connectionId: 'conn_1',
      connectionName: 'e-paragony Sandbox',
      affectedRuleCount: 2,
    });

    expect(text).toBe(
      'e-paragony Sandbox is set to issue Nothing under Connected providers, so 2 rules naming it cannot route. Give it a role, or point them elsewhere.',
    );
  });
});
