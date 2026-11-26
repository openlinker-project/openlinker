/**
 * Mirakl order source - order-sync-start contract (#4265)
 *
 * Mirakl declares no start choice yet (`orderSyncStartModes: []`): the adapter
 * has no `headCursor`, `cursorForDate` or `listOrdersInWindow`, so the suite runs
 * only the declaration check, which proves the manifest and the adapter agree.
 * The scenario is never steered for that case; it exists because the subject
 * requires one.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/__tests__
 */
import { runOrderSourceStartContract } from '@openlinker/core/orders/testing';
import type { OrderSourceStartSubject } from '@openlinker/core/orders/testing';
import { buildMiraklAdapterManifest } from '../../../mirakl-plugin';
import { empikOperatorProfile } from '../../../operators/empik.profile';
import type { IMiraklHttpClient } from '../../http/mirakl-http-client.interface';
import { MiraklOrderSourceAdapter } from '../mirakl-order-source.adapter';

function buildSubject(): OrderSourceStartSubject {
  const httpClient = {
    get: () => Promise.resolve({ status: 200, data: { orders: [], total_count: 0 } }),
  } as unknown as IMiraklHttpClient;
  return {
    adapter: new MiraklOrderSourceAdapter('conn-1', httpClient, 'off'),
    manifest: buildMiraklAdapterManifest(empikOperatorProfile),
    scenario: {
      emptyShop: () => undefined,
      shopWithOrders: () => Promise.resolve({ existingIds: [] }),
      placeNewerOrder: () => Promise.resolve(''),
      breakTransport: () => undefined,
      fixTransport: () => undefined,
    },
  };
}

runOrderSourceStartContract(buildSubject, { subject: 'MiraklOrderSourceAdapter' });
