/**
 * Credential Shape Validator
 *
 * Per-platform validation of the raw `credentials` payload submitted on
 * connection create / rotation. Enforces the minimum fields each adapter
 * requires before we persist arbitrary user-supplied JSON into the
 * credentials store.
 *
 * @module apps/api/src/integrations/application/credentials
 */
import { BadRequestException } from '@nestjs/common';

export function validateCredentialsShape(
  platformType: string,
  credentials: Record<string, unknown>,
): void {
  if (platformType === 'prestashop') {
    const key = credentials.webserviceApiKey;
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new BadRequestException(
        'PrestaShop credentials must include a non-empty `webserviceApiKey` string',
      );
    }
  }
}
