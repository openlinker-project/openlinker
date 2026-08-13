/**
 * Invoicing connection resolution — unit tests (#2047)
 */
import { describe, expect, it } from 'vitest';
import { sampleConnection } from '../../../test/test-utils';
import type { Connection } from '../../connections';
import type { InvoiceRecord } from '../api/invoicing.types';
import {
  isPrimaryInvoicingConnection,
  resolveIssuableConnection,
  resolveIssuingConnection,
  selectInvoicingCandidates,
  selectReauthInvoicingConnections,
} from './resolve-invoicing-connection';

function conn(over: Partial<Connection> = {}): Connection {
  return {
    ...sampleConnection,
    id: 'conn_a',
    status: 'active',
    enabledCapabilities: ['Invoicing'],
    supportedCapabilities: ['Invoicing'],
    config: {},
    ...over,
  };
}

function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv_1',
    connectionId: 'conn_a',
    orderId: 'ord_1',
    providerType: 'subiekt',
    documentType: 'invoice',
    status: 'issued',
    providerInvoiceId: null,
    providerInvoiceNumber: null,
    regulatoryStatus: 'not-applicable',
    clearanceReference: null,
    pdfUrl: null,
    failureMode: null,
    failureCode: null,
    failureReason: null,
    issuedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    orderSummary: null,
    ...over,
  };
}

describe('isPrimaryInvoicingConnection', () => {
  it('reads a real boolean true', () => {
    expect(isPrimaryInvoicingConnection(conn({ config: { invoicing: { isPrimary: true } } }))).toBe(
      true,
    );
  });

  it('reads the string "true" (hand-edited JSON config)', () => {
    expect(
      isPrimaryInvoicingConnection(conn({ config: { invoicing: { isPrimary: 'true' } } })),
    ).toBe(true);
  });

  it.each([
    ['missing invoicing block', {}],
    ['missing flag', { invoicing: {} }],
    ['explicit false', { invoicing: { isPrimary: false } }],
    ['non-boolean value', { invoicing: { isPrimary: 'yes' } }],
    ['non-object invoicing', { invoicing: 'nope' }],
    ['null invoicing', { invoicing: null }],
  ])('is false for %s', (_label, config) => {
    expect(isPrimaryInvoicingConnection(conn({ config }))).toBe(false);
  });
});

describe('selectInvoicingCandidates', () => {
  it('keeps only active connections with the capability ENABLED, sorted by id', () => {
    const result = selectInvoicingCandidates([
      conn({ id: 'conn_z' }),
      conn({ id: 'conn_disabled', status: 'disabled' }),
      conn({ id: 'conn_no_cap', enabledCapabilities: [] }),
      conn({ id: 'conn_a' }),
    ]);
    expect(result.map((c) => c.id)).toEqual(['conn_a', 'conn_z']);
  });
});

describe('selectReauthInvoicingConnections', () => {
  it('keeps broken connections that SUPPORT invoicing', () => {
    const result = selectReauthInvoicingConnections([
      conn({ id: 'conn_reauth', status: 'needs_reauth' }),
      conn({ id: 'conn_error', status: 'error' }),
      conn({ id: 'conn_ok' }),
      conn({ id: 'conn_other', status: 'error', supportedCapabilities: ['OrderSource'] }),
    ]);
    expect(result.map((c) => c.id)).toEqual(['conn_reauth', 'conn_error']);
  });
});

describe('resolveIssuingConnection', () => {
  it('resolves the connection named by the RECORD', () => {
    const result = resolveIssuingConnection(invoice({ connectionId: 'conn_b' }), [
      conn({ id: 'conn_a' }),
      conn({ id: 'conn_b', name: 'Bravo' }),
    ]);
    expect(result.connection?.name).toBe('Bravo');
    expect(result.isStale).toBe(false);
  });

  it('marks a disabled connection stale while still reporting it', () => {
    const result = resolveIssuingConnection(invoice(), [conn({ status: 'disabled' })]);
    expect(result.connection).not.toBeNull();
    expect(result.isStale).toBe(true);
  });

  it('marks a capability-revoked connection stale', () => {
    const result = resolveIssuingConnection(invoice(), [conn({ enabledCapabilities: [] })]);
    expect(result.isStale).toBe(true);
  });

  it('reports the id with a null connection when OL no longer knows it', () => {
    const result = resolveIssuingConnection(invoice({ connectionId: 'gone' }), []);
    expect(result.connection).toBeNull();
    expect(result.connectionId).toBe('gone');
    expect(result.isStale).toBe(true);
  });
});

describe('resolveIssuableConnection', () => {
  const a = conn({ id: 'conn_a' });
  const b = conn({ id: 'conn_b', config: { invoicing: { isPrimary: true } } });

  it('honours an explicit pick', () => {
    expect(resolveIssuableConnection([a, b], 'conn_a')?.id).toBe('conn_a');
  });

  it('falls back to the lone candidate', () => {
    expect(resolveIssuableConnection([a], null)?.id).toBe('conn_a');
  });

  it('falls back to the configured primary when several exist', () => {
    expect(resolveIssuableConnection([a, b], null)?.id).toBe('conn_b');
  });

  it('returns null when several exist, none is primary and nothing was picked', () => {
    expect(resolveIssuableConnection([a, conn({ id: 'conn_c' })], null)).toBeNull();
  });
});
