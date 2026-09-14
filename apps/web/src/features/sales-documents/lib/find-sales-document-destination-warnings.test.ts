/**
 * Sales-Document Destination Warnings Tests (#3178)
 *
 * Covers the predicate both halves of the runtime candidate gate reduce to —
 * a connection that is not `active`, and one carrying no document kind (or no
 * `Invoicing`/`Fiscalization` capability at all) — plus the effective-window
 * filter and the three per-reason sentences.
 */
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../connections';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';
import {
  describeSalesDocumentDestinationWarning,
  describeSalesDocumentDestinationWarningTitle,
  findSalesDocumentDestinationWarnings,
} from './find-sales-document-destination-warnings';

const NOW = new Date('2026-06-01T00:00:00.000Z');

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
  it('should report nothing when the destination is active and has a document kind configured', () => {
    const connections = [makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } })];

    expect(findSalesDocumentDestinationWarnings([makeRule()], connections, NOW)).toEqual([]);
  });

  it('should report the connection when its documentKind is unset (issues Nothing)', () => {
    const connections = [makeConnection()];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections, NOW);

    expect(warnings).toEqual([
      {
        connectionId: 'conn_1',
        connectionName: 'e-paragony Sandbox',
        affectedRuleCount: 1,
        reason: 'issues-nothing',
      },
    ]);
  });

  it('should report a connection that has neither Invoicing nor Fiscalization enabled', () => {
    const connections = [makeConnection({ enabledCapabilities: ['ProductMaster'], supportedCapabilities: ['ProductMaster'] })];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections, NOW);

    expect(warnings).toEqual([
      {
        connectionId: 'conn_1',
        connectionName: 'e-paragony Sandbox',
        affectedRuleCount: 1,
        reason: 'issues-nothing',
      },
    ]);
  });

  it('should report a non-active connection even when it carries a document kind', () => {
    const connections = [
      makeConnection({
        status: 'disabled',
        config: { salesDocument: { documentKind: 'fiscal-receipt' } },
      }),
    ];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections, NOW);

    expect(warnings).toEqual([
      {
        connectionId: 'conn_1',
        connectionName: 'e-paragony Sandbox',
        affectedRuleCount: 1,
        reason: 'not-active',
        status: 'disabled',
      },
    ]);
  });

  it('should prefer the not-active reason when a connection fails both halves of the gate', () => {
    const connections = [makeConnection({ status: 'needs_reauth' })];

    const warnings = findSalesDocumentDestinationWarnings([makeRule()], connections, NOW);

    expect(warnings[0]).toMatchObject({ reason: 'not-active', status: 'needs_reauth' });
  });

  it('should collapse several rules naming the same dead connection into one warning', () => {
    const connections = [makeConnection()];
    const rules = [
      makeRule({ id: 'rule_1' }),
      makeRule({ id: 'rule_2', conditions: [{ field: 'orderCountry', op: 'eq', stringValue: 'PL' }] }),
    ];

    const warnings = findSalesDocumentDestinationWarnings(rules, connections, NOW);

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

    const warnings = findSalesDocumentDestinationWarnings(rules, connections, NOW);

    expect(warnings.map((w) => w.connectionId)).toEqual(['conn_1', 'conn_2']);
  });

  it('should ignore a rule whose effective window has already closed', () => {
    const warnings = findSalesDocumentDestinationWarnings(
      [makeRule({ effectiveTo: '2026-03-01T00:00:00.000Z' })],
      [makeConnection()],
      NOW,
    );

    expect(warnings).toEqual([]);
  });

  it('should still warn for a rule whose window has not opened yet', () => {
    const warnings = findSalesDocumentDestinationWarnings(
      [makeRule({ effectiveFrom: '2026-09-01T00:00:00.000Z' })],
      [makeConnection()],
      NOW,
    );

    expect(warnings).toHaveLength(1);
  });

  it('should treat an unparseable effectiveTo as still effective rather than suppressing the warning', () => {
    const warnings = findSalesDocumentDestinationWarnings(
      [makeRule({ effectiveTo: 'not-a-date' })],
      [makeConnection()],
      NOW,
    );

    expect(warnings).toHaveLength(1);
  });

  it('should report its own reason when the connection is not in the list at all', () => {
    const warnings = findSalesDocumentDestinationWarnings(
      [makeRule({ connectionId: 'conn_deleted' })],
      [],
      NOW,
    );

    expect(warnings).toEqual([
      {
        connectionId: 'conn_deleted',
        connectionName: 'conn_deleted',
        affectedRuleCount: 1,
        reason: 'unknown-connection',
      },
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
      reason: 'issues-nothing',
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
      reason: 'issues-nothing',
    });

    expect(text).toBe(
      'e-paragony Sandbox is set to issue Nothing under Connected providers, so 2 rules naming it cannot route. Give it a role, or point them elsewhere.',
    );
  });

  it('should give a non-active connection its own remedy rather than the role one', () => {
    const text = describeSalesDocumentDestinationWarning({
      connectionId: 'conn_1',
      connectionName: 'e-paragony Sandbox',
      affectedRuleCount: 1,
      reason: 'not-active',
      status: 'disabled',
    });

    expect(text).toBe(
      'e-paragony Sandbox is disabled, so the rule naming it cannot route — auto-issuance only ever considers active connections. Enable it, or point it elsewhere.',
    );
  });

  it('should carry the status-specific remedy for a connection awaiting re-authentication', () => {
    const text = describeSalesDocumentDestinationWarning({
      connectionId: 'conn_1',
      connectionName: 'e-paragony Sandbox',
      affectedRuleCount: 1,
      reason: 'not-active',
      status: 'needs_reauth',
    });

    expect(text).toContain('needs reconnecting');
    expect(text).toContain('Reconnect it');
  });

  it('should never assert a configuration for a connection it cannot see', () => {
    const text = describeSalesDocumentDestinationWarning({
      connectionId: 'conn_deleted',
      connectionName: 'conn_deleted',
      affectedRuleCount: 1,
      reason: 'unknown-connection',
    });

    expect(text).toBe(
      'conn_deleted is not in your connections list, so the rule naming it cannot route. Refresh the page — if it stays, point it at a live provider.',
    );
    expect(text).not.toContain('issue Nothing');
  });
});
