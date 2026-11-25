/**
 * Amazon order source - order-sync-start contract (#4265)
 *
 * Amazon declares no start choice (`orderSyncStartModes: []`): it has no head
 * cursor, no date bootstrap and no window reader, so the suite reduces to the
 * cross-check that the manifest and the adapter agree on that. The scenario is
 * never driven; it exists because the subject shape requires one.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/order-source/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';

import { amazonAdapterManifest } from '../../../../amazon-plugin';
import type { AmazonSpApiClient } from '../../../http/amazon-spapi-client';
import { AmazonOrderSourceAdapter } from '../amazon-order-source.adapter';

function buildSubject(): OrderSourceStartSubject {
  const client = { get: jest.fn(), post: jest.fn() } as unknown as AmazonSpApiClient;
  const refuse = (): never => {
    throw new Error('Amazon has no start choice; this scenario step must not be reached');
  };
  return {
    adapter: new AmazonOrderSourceAdapter('conn-amazon-1', client, {
      region: 'eu',
      environment: 'production',
      marketplaceIds: ['A1PA6795UKMFR9'],
    }),
    manifest: amazonAdapterManifest,
    scenario: {
      emptyShop: refuse,
      shopWithOrders: refuse,
      placeNewerOrder: refuse,
      breakTransport: refuse,
      fixTransport: refuse,
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'AmazonOrderSourceAdapter' });
