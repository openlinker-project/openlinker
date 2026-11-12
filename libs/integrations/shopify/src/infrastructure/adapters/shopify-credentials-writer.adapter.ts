/**
 * Shopify Credentials Writer
 *
 * `ShopifyCredentialsWriterPort` over the host's credentials service: replaces
 * the encrypted blob behind a `db:` credentials ref with a refreshed OAuth
 * token pair. A ref that is not DB-backed cannot be rewritten, which for an
 * OAuth install means the next refresh cannot be stored - refused loudly
 * rather than letting the rotated refresh token be lost.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 */
import type { ICredentialsService } from '@openlinker/core/integrations';

import { ShopifyConfigException } from '../../domain/exceptions/shopify-config.exception';
import type { ShopifyCredentialsWriterPort } from '../../domain/ports/shopify-credentials-writer.port';
import type { ShopifyCredentials } from '../../domain/types/shopify-credentials.types';

const DB_REF_PREFIX = 'db:';

export class ShopifyCredentialsWriterAdapter implements ShopifyCredentialsWriterPort {
  constructor(private readonly credentials: ICredentialsService) {}

  async replace(credentialsRef: string, next: ShopifyCredentials): Promise<void> {
    if (!credentialsRef.startsWith(DB_REF_PREFIX)) {
      throw new ShopifyConfigException(
        credentialsRef,
        'refreshed OAuth tokens can only be stored for database-backed credentials',
      );
    }
    await this.credentials.update(credentialsRef.slice(DB_REF_PREFIX.length), {
      credentialsJson: { ...next },
    });
  }
}
