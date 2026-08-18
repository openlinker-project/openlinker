import { describe, expect, it } from 'vitest';
import type { Connection } from '../../connections';
import { deriveSalesDocumentRows } from './derive-sales-document-rows';

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn_1',
    name: 'inFakt',
    platformType: 'infakt',
    status: 'active',
    config: {},
    credentialsBacked: true,
    enabledCapabilities: ['Invoicing'],
    supportedCapabilities: ['Invoicing'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveSalesDocumentRows', () => {
  it('should exclude a connection with neither Invoicing nor Fiscalization enabled', () => {
    const rows = deriveSalesDocumentRows([
      makeConnection({ enabledCapabilities: ['ProductMaster'] }),
    ]);

    expect(rows).toHaveLength(0);
  });

  it('should resolve capability Invoicing when a connection declares both', () => {
    const rows = deriveSalesDocumentRows([
      makeConnection({ enabledCapabilities: ['Fiscalization', 'Invoicing'] }),
    ]);

    expect(rows[0].capability).toBe('Invoicing');
  });

  it('should read documentKind null when config.salesDocument is absent', () => {
    const rows = deriveSalesDocumentRows([makeConnection()]);

    expect(rows[0].documentKind).toBeNull();
  });

  it('should read a well-known documentKind verbatim', () => {
    const rows = deriveSalesDocumentRows([
      makeConnection({ config: { salesDocument: { documentKind: 'invoice' } } }),
    ]);

    expect(rows[0].documentKind).toBe('invoice');
  });

  it('should discard an unrecognized documentKind string as null', () => {
    const rows = deriveSalesDocumentRows([
      makeConnection({ config: { salesDocument: { documentKind: 'bogus' } } }),
    ]);

    expect(rows[0].documentKind).toBeNull();
  });

  it('should read isPrimary true from either a boolean or the string "true"', () => {
    const boolRow = deriveSalesDocumentRows([
      makeConnection({ config: { invoicing: { isPrimary: true } } }),
    ])[0];
    const stringRow = deriveSalesDocumentRows([
      makeConnection({ config: { invoicing: { isPrimary: 'true' } } }),
    ])[0];

    expect(boolRow.isPrimary).toBe(true);
    expect(stringRow.isPrimary).toBe(true);
  });

  it('should default triggerModel to manual when absent', () => {
    const rows = deriveSalesDocumentRows([makeConnection()]);

    expect(rows[0].triggerModel).toBe('manual');
  });

  it('should read an explicit triggerModel verbatim', () => {
    const rows = deriveSalesDocumentRows([
      makeConnection({ config: { invoicing: { triggerModel: 'auto-on-paid' } } }),
    ]);

    expect(rows[0].triggerModel).toBe('auto-on-paid');
  });
});
