/**
 * Responsible Producer Service (#1531)
 *
 * Read service that returns a connection's EU GPSR responsible-producer
 * registry ("producent" / responsible person) for the offer-creation wizard.
 * Resolves the connection's `OfferManager` adapter and narrows it to the
 * `ResponsibleProducerReader` sub-capability; caching of the upstream response
 * lives in the adapter (per connection), mirroring the seller-policies and
 * category-parameters read paths.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IResponsibleProducerService}
 * @see {@link IResponsibleProducerService} for the service contract
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { isResponsibleProducerReader } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort, ResponsibleProducerEntry } from '@openlinker/core/listings';

import type { IResponsibleProducerService } from '../interfaces/responsible-producer.service.interface';

@Injectable()
export class ResponsibleProducerService implements IResponsibleProducerService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async listResponsibleProducers(connectionId: string): Promise<ResponsibleProducerEntry[]> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isResponsibleProducerReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support responsible-producer listing`
      );
    }

    return adapter.fetchResponsibleProducers();
  }
}
