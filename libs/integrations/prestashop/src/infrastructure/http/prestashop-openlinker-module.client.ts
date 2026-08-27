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
import type { FetchLike } from '@openlinker/shared/http';
import type { WebhookSecretProviderPort } from '@openlinker/core/integrations';

import type {
  IPrestashopOpenLinkerModuleClient,
  WriteCartShippingInput,
  ImportOrderInput,
  ImportOrderResult,
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

/** Order-import endpoint (validateOrder path, ADR-016 / #905). Same wire-contract shape as cartshipping. */
const IMPORTORDER_PATH = '/index.php?fc=module&module=openlinker&controller=importorder';

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
    // Connection-bound outbound transport (#1810) — defaults to bare fetch
    // for callers that predate the rate-limit mechanism (tests). The sole
    // production caller (`prestashop-adapter.factory.ts`) injects one; the
    // default is a test convenience that the strengthened
    // `check-outbound-http.mjs` (#1968) now makes visible rather than silent.
    // Dropping it for Allegro parity is the follow-up.
    // eslint-disable-next-line no-restricted-globals -- test-only default; the production caller injects a transport (#1810 follow-up)
    private readonly fetchImpl: FetchLike = globalThis.fetch
  ) {}

  async writeCartShipping(input: WriteCartShippingInput): Promise<void> {
    const body = JSON.stringify({
      id_cart: input.idCart,
      amount_tax_excl: input.amountTaxExcl,
      amount_tax_incl: input.amountTaxIncl,
      source: input.source ?? null,
    });

    this.logger.debug(
      `OpenLinker module: POST cartshipping connection=${this.connectionId} ` +
        `idCart=${input.idCart} amountTaxIncl=${input.amountTaxIncl}`
    );

    const response = await this.signedPost(CARTSHIPPING_PATH, body, input.idCart);
    const envelope = await this.readEnvelope(response);
    const failure = this.failureReason(response, envelope);
    if (failure === null) {
      return;
    }

    this.logger.warn(
      `OpenLinker module: cartshipping write failed connection=${this.connectionId} ` +
        `idCart=${input.idCart} status=${response.status} reason=${failure}`
    );
    throw new PrestashopOlModuleException(this.connectionId, input.idCart, response.status, failure);
  }

  async importOrder(input: ImportOrderInput): Promise<ImportOrderResult> {
    const body = JSON.stringify({
      id_cart: input.idCart,
      id_order_state: input.idOrderState,
      amount_paid: input.amountPaid,
      payment_method: input.paymentMethod,
      order_reference: input.orderReference,
    });

    this.logger.debug(
      `OpenLinker module: POST importorder connection=${this.connectionId} ` +
        `idCart=${input.idCart} idOrderState=${input.idOrderState} amountPaid=${input.amountPaid}`
    );

    const response = await this.signedPost(IMPORTORDER_PATH, body, input.idCart);
    const envelope = await this.readEnvelope(response);
    const failure = this.failureReason(response, envelope);
    if (failure !== null) {
      this.logger.warn(
        `OpenLinker module: importorder failed connection=${this.connectionId} ` +
          `idCart=${input.idCart} status=${response.status} reason=${failure}`
      );
      throw new PrestashopOlModuleException(
        this.connectionId,
        input.idCart,
        response.status,
        failure
      );
    }

    const parsed = this.parseImportOrderResult(envelope);
    if (!parsed) {
      throw new PrestashopOlModuleException(
        this.connectionId,
        input.idCart,
        response.status,
        'malformed-import-order-response'
      );
    }
    return parsed;
  }

  /**
   * Sign and POST a JSON body to an OL module front-controller endpoint using
   * the inbound HMAC contract (`timestamp + "." + rawBody`, SHA-256). Returns
   * the raw `Response` (2xx and non-2xx alike); callers interpret the status.
   *
   * @throws PrestashopOlModuleException on a network-level failure (status 0).
   */
  private async signedPost(path: string, body: string, idCartForError: number): Promise<Response> {
    const timestamp = String(Date.now());
    const secret = await this.secretProvider.getSecret(PROVIDER, this.connectionId);
    const signatureHeader = 'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
    const url = this.baseUrl.replace(/\/$/, '') + path;

    try {
      return await this.fetchImpl(url, {
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
        idCartForError,
        0,
        `network: ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  }

  /**
   * Read the module's JSON envelope from a response body.
   *
   * The body is read as text and parsed here rather than through
   * `response.json()` so that a shop page - HTML with status 200, which is what
   * a PrestaShop front controller answers when it dies early - is a parse
   * failure we can name, not a silent success (#2601).
   *
   * @returns the decoded object, or null when the body is not one
   */
  private async readEnvelope(response: Response): Promise<Record<string, unknown> | null> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      return null;
    }

    try {
      const data: unknown = JSON.parse(text);
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        return data as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Why this response is a failure, or null when it is a success.
   *
   * Success needs all three: a 2xx status, a parsable envelope, and
   * `ok: true` in it. Status alone is not enough - the module answers 200 for
   * both a written sidecar row and a shop error page.
   */
  private failureReason(
    response: Response,
    envelope: Record<string, unknown> | null
  ): string | null {
    if (response.status < 200 || response.status >= 300) {
      const reason = envelope !== null ? envelope.error : undefined;
      return typeof reason === 'string' ? reason : `http-${response.status}`;
    }

    if (envelope === null) {
      return 'non-json-module-response';
    }

    if (envelope.ok !== true) {
      const reason = envelope.error;
      return typeof reason === 'string' ? reason : 'module-reported-failure';
    }

    return null;
  }

  /**
   * Project the `importorder` success envelope onto the result shape.
   * Returns null on any shape mismatch so the caller can fail loud.
   */
  private parseImportOrderResult(
    envelope: Record<string, unknown> | null
  ): ImportOrderResult | null {
    if (envelope === null) {
      return null;
    }

    const idOrder = Number(envelope.id_order);
    if (!Number.isFinite(idOrder) || idOrder <= 0 || typeof envelope.reference !== 'string') {
      return null;
    }

    return {
      idOrder,
      reference: envelope.reference,
      alreadyExisted: envelope.already_existed === true,
    };
  }
}
