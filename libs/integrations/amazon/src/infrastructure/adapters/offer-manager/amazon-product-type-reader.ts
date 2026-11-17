/**
 * Amazon Product Type Reader (#4181)
 *
 * Reads Amazon's product types (Product Type Definitions API v2020-09-01) for
 * one marketplace: the list (`searchDefinitionsProductTypes`, no keywords)
 * and one type's JSON Schema. `getDefinitionsProductType` answers with a
 * pre-signed link to the schema rather than the schema itself, so the schema
 * is downloaded with the connection's paced fetch.
 *
 * The link comes from Amazon's answer, but it is still fetched by this
 * process, so it is checked first: HTTPS, on an Amazon host, no credentials
 * in it, and the download is capped in size. Nothing of the connection
 * (token, credentials) is sent with it; a pre-signed link authorizes itself.
 *
 * @module libs/integrations/amazon/src/infrastructure/adapters/offer-manager
 */
import type { FetchLike } from '@openlinker/shared/http';

import { AmazonApiError } from '../../../domain/exceptions/amazon-api.error';
import type {
  AmazonProductTypeDefinition,
  AmazonProductTypeList,
  AmazonProductTypeSchema,
  AmazonProductTypeSummary,
} from '../../../domain/types/amazon-product-type.types';
import type { AmazonSpApiClient } from '../../http/amazon-spapi-client';

const DEFINITIONS_PATH = '/definitions/2020-09-01/productTypes';
/** Product type schemas run to a few megabytes; anything far past that is not one. */
const MAX_SCHEMA_BYTES = 20 * 1024 * 1024;
const SCHEMA_HOST_PATTERN = /(^|\.)(amazonaws\.com|amazon\.com)$/;

export class AmazonProductTypeReader {
  constructor(
    private readonly client: AmazonSpApiClient,
    private readonly fetchImpl: FetchLike,
    private readonly marketplaceId: string,
  ) {}

  async listProductTypes(): Promise<AmazonProductTypeSummary[]> {
    const response = await this.client.get<AmazonProductTypeList>(DEFINITIONS_PATH, {
      marketplaceIds: [this.marketplaceId],
    });
    return [...(response.data.productTypes ?? [])];
  }

  async getSchema(productType: string): Promise<AmazonProductTypeSchema> {
    const response = await this.client.get<AmazonProductTypeDefinition>(
      `${DEFINITIONS_PATH}/${encodeURIComponent(productType)}`,
      {
        marketplaceIds: [this.marketplaceId],
        requirements: 'LISTING',
        requirementsEnforced: 'ENFORCED',
        locale: 'DEFAULT',
      },
    );
    return this.download(response.data.schema.link.resource);
  }

  private async download(resource: string): Promise<AmazonProductTypeSchema> {
    const url = safeSchemaUrl(resource);
    const response = await this.fetchImpl(url, { method: 'GET', redirect: 'manual' });
    if (response.status < 200 || response.status >= 300) {
      throw new AmazonApiError(response.status, 'SchemaDownloadFailed', 'product type schema download failed', undefined);
    }
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_SCHEMA_BYTES) {
      throw new AmazonApiError(502, 'SchemaTooLarge', 'product type schema is larger than expected', undefined);
    }
    const text = await response.text();
    if (text.length > MAX_SCHEMA_BYTES) {
      throw new AmazonApiError(502, 'SchemaTooLarge', 'product type schema is larger than expected', undefined);
    }
    try {
      return JSON.parse(text) as AmazonProductTypeSchema;
    } catch {
      throw new AmazonApiError(502, 'SchemaUnreadable', 'product type schema is not JSON', undefined);
    }
  }
}

/** The schema link, only when it is an HTTPS Amazon URL with no embedded credentials. */
export function safeSchemaUrl(resource: string): string {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new AmazonApiError(502, 'SchemaLinkInvalid', 'product type schema link is not a URL', undefined);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || !SCHEMA_HOST_PATTERN.test(url.hostname)) {
    throw new AmazonApiError(502, 'SchemaLinkInvalid', `product type schema link is not on an Amazon host (${url.hostname})`, undefined);
  }
  return url.toString();
}
