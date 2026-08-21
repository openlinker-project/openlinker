/**
 * SalesDocumentCapabilityGuardService — Unit Tests (#2170, review finding 5)
 *
 * Pins the guard against `connection.enabledCapabilities` — what the
 * OPERATOR turned on — never `metadata.supportedCapabilities` — what the
 * adapter package could theoretically support. A connection whose adapter
 * supports `Fiscalization` but that never enabled it must still be rejected.
 *
 * @module apps/api/src/sales-documents
 */
import { BadRequestException } from '@nestjs/common';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { AdapterMetadata, IIntegrationsService } from '@openlinker/core/integrations';
import { SalesDocumentCapabilityGuardService } from './sales-document-capability-guard.service';

function buildConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    name: 'eparagony connection',
    platformType: 'eparagony',
    status: 'active',
    config: {},
    credentialsBacked: true,
    adapterKey: 'eparagony.documents.v3',
    enabledCapabilities: [],
    supportedCapabilities: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as Connection;
}

function buildMetadata(overrides: Partial<AdapterMetadata> = {}): AdapterMetadata {
  return {
    adapterKey: 'eparagony.documents.v3',
    platformType: 'eparagony',
    supportedCapabilities: ['Fiscalization'],
    ...overrides,
  } as AdapterMetadata;
}

describe('SalesDocumentCapabilityGuardService', () => {
  let integrations: jest.Mocked<Pick<IIntegrationsService, 'getAdapter'>>;
  let service: SalesDocumentCapabilityGuardService;

  beforeEach(() => {
    integrations = { getAdapter: jest.fn() };
    service = new SalesDocumentCapabilityGuardService(
      integrations as unknown as IIntegrationsService,
    );
  });

  it('should pass when the connection has the required capability ENABLED', async () => {
    integrations.getAdapter.mockResolvedValue({
      connection: buildConnection({ enabledCapabilities: ['Fiscalization'] }),
      metadata: buildMetadata(),
    });

    await expect(
      service.assertConnectionSupportsKind('conn-1', 'fiscal-receipt'),
    ).resolves.toBeUndefined();
  });

  it('should reject when the adapter SUPPORTS the capability but the operator never ENABLED it', async () => {
    integrations.getAdapter.mockResolvedValue({
      // Adapter package supports Fiscalization, but the operator's connection
      // never turned it on — this is exactly what finding 5 flags.
      connection: buildConnection({ enabledCapabilities: [] }),
      metadata: buildMetadata({ supportedCapabilities: ['Fiscalization'] }),
    });

    await expect(
      service.assertConnectionSupportsKind('conn-1', 'fiscal-receipt'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should reject when the connection lacks Invoicing for an invoice-kind rule', async () => {
    integrations.getAdapter.mockResolvedValue({
      connection: buildConnection({ enabledCapabilities: ['Fiscalization'] }),
      metadata: buildMetadata({ supportedCapabilities: ['Fiscalization'] }),
    });

    await expect(
      service.assertConnectionSupportsKind('conn-1', 'invoice'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should pass structurally for an open-world (unrecognized) document kind', async () => {
    await expect(
      service.assertConnectionSupportsKind('conn-1', 'some-future-kind'),
    ).resolves.toBeUndefined();
    expect(integrations.getAdapter).not.toHaveBeenCalled();
  });
});
