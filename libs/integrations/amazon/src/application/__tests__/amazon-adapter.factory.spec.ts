/**
 * AmazonAdapterFactory tests (#4185)
 *
 * The Multi-Channel Fulfillment executor orders on the marketplace FBA stock is
 * read on (#4183), so routing and fulfilment use the same FBA pool.
 *
 * @module libs/integrations/amazon/src/application/__tests__
 */
import { FULFILLMENT_EXECUTOR_CONTRACT_REQUEST } from '@openlinker/core/fulfillment/testing';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonAdapterFactory } from '../amazon-adapter.factory';
import type { AmazonResolution } from '../interfaces/amazon-adapter.factory.interface';

const DE = 'A1PA6795UKMFR9';
const PL = 'A1C3SOZRARQ6R3';

function resolution(config: Record<string, unknown>): { resolution: AmazonResolution; post: jest.Mock } {
  const post = jest.fn().mockResolvedValue({ data: { payload: { fulfillmentPreviews: [{ isFulfillable: false }] } } });
  const client = {
    post,
    get: jest.fn().mockRejectedValue(new AmazonApiError(404, 'NotFound', undefined, 'r')),
  };
  return {
    post,
    resolution: {
      connection: { id: 'conn-amz', enabledCapabilities: ['FulfillmentExecutor'] },
      config: { region: 'eu', environment: 'production', ...config },
      client,
    } as unknown as AmazonResolution,
  };
}

const identifierMapping = {
  getExternalIds: jest.fn().mockResolvedValue([{ externalId: 'MUG', connectionId: 'conn-amz' }]),
} as unknown as IdentifierMappingPort;

describe('AmazonAdapterFactory.createFulfillmentExecutor', () => {
  it('should preview Multi-Channel Fulfillment on the catalogue marketplace, not the first configured one', async () => {
    const { resolution: res, post } = resolution({ marketplaceIds: [DE, PL], catalogueMarketplaceId: PL });

    await new AmazonAdapterFactory()
      .createFulfillmentExecutor(res, identifierMapping)
      .requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);

    expect(post).toHaveBeenCalledWith(expect.stringContaining('/preview'), expect.objectContaining({ marketplaceId: PL }));
  });

  it('should fall back to the first marketplace when no catalogue marketplace is set', async () => {
    const { resolution: res, post } = resolution({ marketplaceIds: [DE, PL] });

    await new AmazonAdapterFactory()
      .createFulfillmentExecutor(res, identifierMapping)
      .requestFulfillment(FULFILLMENT_EXECUTOR_CONTRACT_REQUEST);

    expect(post).toHaveBeenCalledWith(expect.stringContaining('/preview'), expect.objectContaining({ marketplaceId: DE }));
  });
});
