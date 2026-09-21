/**
 * findSalesDocumentConnectionRoleGap Tests (#3232)
 */
import { describe, expect, it } from 'vitest';
import type { Connection } from '../../connections';
import {
  describeSalesDocumentConnectionRoleGap,
  findSalesDocumentConnectionRoleGap,
} from './find-sales-document-connection-role-gap';

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

describe('findSalesDocumentConnectionRoleGap', () => {
  it('returns null when no connection is picked yet', () => {
    expect(findSalesDocumentConnectionRoleGap('', [makeConnection()])).toBeNull();
  });

  it('returns null for an unknown connection id', () => {
    expect(findSalesDocumentConnectionRoleGap('conn_missing', [makeConnection()])).toBeNull();
  });

  it('returns null when the connection already carries a role', () => {
    const connections = [
      makeConnection({ config: { salesDocument: { documentKind: 'fiscal-receipt' } } }),
    ];
    expect(findSalesDocumentConnectionRoleGap('conn_1', connections)).toBeNull();
  });

  it('returns the connection name when it has no role configured', () => {
    const connections = [makeConnection({ config: {} })];
    expect(findSalesDocumentConnectionRoleGap('conn_1', connections)).toBe('e-paragony Sandbox');
  });

  it('returns the connection name whatever its status — status is not this helper\'s concern', () => {
    // Composer/template candidate lists already filter to `active`
    // (`selectInvoicingCandidates` / `selectFiscalizationCandidates`), so a
    // picked connectionId is active by construction; this helper only ever
    // needs to answer the role question.
    const connections = [makeConnection({ status: 'disabled', config: {} })];
    expect(findSalesDocumentConnectionRoleGap('conn_1', connections)).toBe('e-paragony Sandbox');
  });
});

describe('describeSalesDocumentConnectionRoleGap', () => {
  it('names the connection and states the rule still routes', () => {
    const message = describeSalesDocumentConnectionRoleGap('e-paragony Sandbox');
    expect(message).toContain('e-paragony Sandbox');
    expect(message).toContain('still');
    expect(message).toContain('destination-warnings list');
  });
});
