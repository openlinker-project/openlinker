/**
 * Fakes shared by the Mirakl master adapter specs (#4284): an OF21 / STO01
 * HTTP client over an in-memory offer list, and an identifier mapping where
 * `ol_product_<sku>` maps to `<sku>`.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { MiraklOffer } from '../../../../domain/types/mirakl-offer.types';
import type { IMiraklHttpClient } from '../../../http/mirakl-http-client.interface';
import type {
  MiraklFileUpload,
  MiraklRequestOptions,
} from '../../../http/mirakl-http-client.types';
import { MiraklMasterIdentity } from '../mirakl-master-identity';

export const CONNECTION_ID = 'conn-1';

export interface FakeMiraklOffers {
  readonly client: IMiraklHttpClient;
  readonly get: jest.Mock;
  readonly postFile: jest.Mock;
  readonly offers: MiraklOffer[];
}

export function fakeOffers(offers: MiraklOffer[]): FakeMiraklOffers {
  const get = jest.fn((path: string, options?: MiraklRequestOptions) => {
    const query = options?.queryParams ?? {};
    if (path !== '/api/offers') {
      return Promise.reject(new Error(`unexpected GET ${path}`));
    }
    if (typeof query.sku === 'string') {
      // OF21 may match more than the exact sku; return a near miss too.
      const matches = offers.filter((offer) => offer.shop_sku?.startsWith(String(query.sku)));
      return Promise.resolve({
        status: 200,
        data: { offers: matches, total_count: matches.length },
      });
    }
    const max = Number(query.max ?? 10);
    const offset = Number(query.offset ?? 0);
    return Promise.resolve({
      status: 200,
      data: { offers: offers.slice(offset, offset + max), total_count: offers.length },
    });
  });
  const postFile = jest.fn((_path: string, _file: MiraklFileUpload) =>
    Promise.resolve({ status: 201, data: { import_id: 4242 } })
  );
  return { client: { get, postFile } as unknown as IMiraklHttpClient, get, postFile, offers };
}

export function fakeIdentity(): { identity: MiraklMasterIdentity; mapping: IdentifierMappingPort } {
  const mapping = {
    getExternalIds: jest.fn((_type: string, internalId: string) =>
      Promise.resolve(
        internalId.startsWith('ol_product_')
          ? [{ connectionId: CONNECTION_ID, externalId: internalId.slice('ol_product_'.length) }]
          : []
      )
    ),
    getOrCreateInternalId: jest.fn((type: string, externalId: string) =>
      Promise.resolve(`ol_${type.toLowerCase()}_${externalId}`)
    ),
    batchGetOrCreateInternalIds: jest.fn(
      (requests: ReadonlyArray<{ externalId: string; connectionId: string }>) =>
        Promise.resolve(
          new Map(
            requests.map((request) => [
              `${request.externalId}:${request.connectionId}`,
              `ol_product_${request.externalId}`,
            ])
          )
        )
    ),
  } as unknown as IdentifierMappingPort;
  return { identity: new MiraklMasterIdentity(CONNECTION_ID, mapping), mapping };
}
