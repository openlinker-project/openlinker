/**
 * Responsible Producer Service Tests (#1531)
 *
 * Unit tests for adapter resolution, capability gating (`ResponsibleProducerReader`),
 * and error propagation.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */

import { UnprocessableEntityException } from '@nestjs/common';

import type { OfferManagerPort, ResponsibleProducerEntry } from '@openlinker/core/listings';
import type { IIntegrationsService } from '@openlinker/core/integrations';

import { ResponsibleProducerService } from '../responsible-producer.service';

describe('ResponsibleProducerService', () => {
  let service: ResponsibleProducerService;
  let integrations: jest.Mocked<IIntegrationsService>;

  const connectionId = 'conn-abc';
  const producers: ResponsibleProducerEntry[] = [
    { id: '1', name: 'ACME Sp. z o.o.', kind: 'PRODUCER' },
    { id: '2', name: 'Importer Ltd', kind: 'PRODUCER' },
  ];

  const adapterWith = (fetchResponsibleProducers: jest.Mock | undefined): OfferManagerPort =>
    ({
      ...(fetchResponsibleProducers ? { fetchResponsibleProducers } : {}),
    } as unknown as OfferManagerPort);

  beforeEach(() => {
    integrations = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    service = new ResponsibleProducerService(integrations);
  });

  it('returns the responsible producers from the connection adapter', async () => {
    const fetchResponsibleProducers = jest.fn().mockResolvedValue(producers);
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(fetchResponsibleProducers));

    const result = await service.listResponsibleProducers(connectionId);

    expect(result).toBe(producers);
    expect(integrations.getCapabilityAdapter).toHaveBeenCalledWith(connectionId, 'OfferManager');
    expect(fetchResponsibleProducers).toHaveBeenCalledTimes(1);
  });

  it('throws UnprocessableEntityException when the adapter does not implement fetchResponsibleProducers', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue(adapterWith(undefined));

    await expect(service.listResponsibleProducers(connectionId)).rejects.toThrow(
      UnprocessableEntityException,
    );
  });

  it('propagates exceptions from getCapabilityAdapter (connection not found / disabled)', async () => {
    integrations.getCapabilityAdapter.mockRejectedValue(new Error('ConnectionNotFoundException'));

    await expect(service.listResponsibleProducers(connectionId)).rejects.toThrow(
      'ConnectionNotFoundException',
    );
  });
});
