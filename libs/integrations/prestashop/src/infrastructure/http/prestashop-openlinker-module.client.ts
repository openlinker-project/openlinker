/**
 * PrestaShop OpenLinker Module Client
 *
 * HTTP client implementation for HMAC-signed writes to the OpenLinker
 * PrestaShop module's front-controller endpoints (#515 / PR #524). Mirrors
 * the inbound HMAC contract verified by the module's HmacRequestVerifier
 * bit-for-bit:
 *
 *   - Header X-OpenLinker-Timestamp: unix milliseconds, numeric string
 *   - Header X-OpenLinker-Signature: "sha256=<64-char hex>"
 *   - Signed payload:                 timestamp + "." + rawBody
 *   - HMAC algorithm:                 SHA-256
 *
 * Uses native `fetch` (Node 18+) to match the existing PrestashopWebservice-
 * Client transport pattern in this package. The shared webhook secret is
 * resolved via WebhookSecretProviderPort — same bytes the inbound webhook
 * receiver uses to verify signatures, just used in the outbound direction
 * here (#516 / tech-review reuse-vs-rename note).
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 * @implements {IPrestashopOpenLinkerModuleClient}
 * @see apps/prestashop-module/openlinker/classes/HmacRequestVerifier.php (PHP receiver)
 * @see apps/prestashop-module/openlinker/controllers/front/cartshipping.php (cartshipping endpoint)
 */
import { createHmac } from 'crypto';

import { Logger } from '@openlinker/shared/logging';
import { WebhookSecretProviderPort } from '@openlinker/core/integrations';

import {
  IPrestashopOpenLinkerModuleClient,
  WriteCartShippingInput,
} from './prestashop-openlinker-module.client.interface';
import { PrestashopOlModuleException } from '../../domain/exceptions/prestashop-ol-module.exception';

/**
 * Provider identifier passed to WebhookSecretProviderPort.getSecret. Matches
 * the `provider` value used by the inbound webhook receiver for the same
 * connection, so both directions resolve the same secret bytes.
 */
const PROVIDER = 'prestashop';

/**
 * Module endpoint URL relative to the PS storefront base URL. Hardcoded
 * because it's part of the wire contract — PS resolves front-controller
 * routes via `?fc=module&module=<name>&controller=<name>`.
 */
const CARTSHIPPING_PATH = '/index.php?fc=module&module=openlinker&controller=cartshipping';

export class PrestashopOpenLinkerModuleClient implements IPrestashopOpenLinkerModuleClient {
  private readonly logger = new Logger(PrestashopOpenLinkerModuleClient.name);

  /**
   * @param connectionId       OpenLinker connection id (UUID); resolves the secret + identifies logs
   * @param baseUrl            PS storefront URL with no trailing slash (e.g. `https://shop.example.com`)
   * @param secretProvider     Resolves `(provider, connectionId) → secret` — see port JSDoc for bidirectional use
   */
  constructor(
    private readonly connectionId: string,
    private readonly baseUrl: string,
    private readonly secretProvider: WebhookSecretProviderPort,
  ) {}

  async writeCartShipping(input: WriteCartShippingInput): Promise<void> {
    const body = JSON.stringify({
      id_cart: input.idCart,
      amount_tax_excl: input.amountTaxExcl,
      amount_tax_incl: input.amountTaxIncl,
      source: input.source ?? null,
    });

    const timestamp = String(Date.now());
    const secret = await this.secretProvider.getSecret(PROVIDER, this.connectionId);
    const signedPayload = timestamp + '.' + body;
    const signatureHex = createHmac('sha256', secret).update(signedPayload).digest('hex');
    const signatureHeader = 'sha256=' + signatureHex;

    const url = this.baseUrl.replace(/\/$/, '') + CARTSHIPPING_PATH;

    this.logger.debug(
      `OpenLinker module: POST cartshipping connection=${this.connectionId} ` +
        `idCart=${input.idCart} amountTaxIncl=${input.amountTaxIncl}`,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenLinker-Timestamp': timestamp,
          'X-OpenLinker-Signature': signatureHeader,
        },
        body,
      });
    } catch (err) {
      // Network-level failure (DNS, connection refused, TLS, abort).
      throw new PrestashopOlModuleException(
        this.connectionId,
        input.idCart,
        0,
        `network: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (response.status >= 200 && response.status < 300) {
      return;
    }

    const reason = await this.extractReason(response);
    this.logger.warn(
      `OpenLinker module: cartshipping write failed connection=${this.connectionId} ` +
        `idCart=${input.idCart} status=${response.status} reason=${reason ?? 'unknown'}`,
    );
    throw new PrestashopOlModuleException(
      this.connectionId,
      input.idCart,
      response.status,
      reason,
    );
  }

  /**
   * Best-effort extraction of the `error` reason string from the module's
   * JSON error body. Falls back to undefined on any parse failure — the
   * status code alone is enough information for the caller.
   */
  private async extractReason(response: Response): Promise<string | undefined> {
    try {
      const data: unknown = await response.json();
      if (
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof (data as { error: unknown }).error === 'string'
      ) {
        return (data as { error: string }).error;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
