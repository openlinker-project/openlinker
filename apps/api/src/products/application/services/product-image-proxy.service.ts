/**
 * Serving a product's picture to a browser (#3340 follow-up)
 *
 * `products.images[]` holds the url the CATALOGUE SYNC used to reach the
 * shop. That is not the same thing as a url a browser can open, and on a
 * whole class of deployments it is not even close: anywhere the shop is
 * reachable only from the backend's own network — every Docker-compose
 * install, the bundled demo among them — the stored value is a host name the
 * browser cannot resolve at all. Measured on the demo database: 71 of 71
 * products with images carried one (`http://prestashop/img/...`,
 * `http://host.docker.internal:5056/...`). Every product picture in the
 * product list, the listings wizard and the pack bench was a silent blank.
 *
 * Two further reasons the answer is a proxy rather than "store a better url":
 *
 *   1. **Mixed content.** An https deployment loading an http shop image is
 *      blocked by the browser, with no error a user can act on.
 *   2. **The shop's address is the operator's business.** Handing the browser
 *      the internal host name publishes a piece of their topology to anyone
 *      who opens dev tools.
 *
 * ## The caller never names a url
 *
 * `index` selects from the product's OWN stored array. A route that accepted
 * a url would be a server-side request forgery primitive pointed at whatever
 * the caller liked; this one can only fetch what the operator's own catalogue
 * sync already wrote. That containment is the whole security argument, so it
 * must not be relaxed into a `?url=` parameter for convenience.
 *
 * Everything else here is a bound rather than a policy: a timeout, a byte
 * cap, http/https only, and a refusal to pass through anything the upstream
 * did not label as an image.
 *
 * @module apps/api/src/products/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

/** Long enough for a shop under load, short enough not to hold a worker. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * A product photo above this is a mis-stored asset, not a thumbnail. The cap
 * is enforced on the streamed bytes as well as on `content-length`, because a
 * chunked response declares no length at all.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** What a browser will render in an `<img>`. Anything else is refused. */
const ALLOWED_TYPE_PREFIX = 'image/';

export interface ProductImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export type ProductImageFailure =
  /** No such product, or it carries no image at that index. */
  | 'not-found'
  /** The stored value is not a fetchable http(s) url. */
  | 'unusable-url'
  /** The shop did not answer, answered an error, or answered too slowly. */
  | 'upstream-unavailable'
  /** It answered, but with something that is not an image, or is too large. */
  | 'not-an-image';

export type ProductImageResult =
  | { readonly kind: 'image'; readonly image: ProductImage }
  | { readonly kind: 'failure'; readonly reason: ProductImageFailure };

@Injectable()
export class ProductImageProxyService {
  private readonly logger = new Logger(ProductImageProxyService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly products: IProductsService
  ) {}

  async getImage(productId: string, index: number): Promise<ProductImageResult> {
    const product = await this.products.getProduct(productId);
    const url = product?.images?.[index];
    if (url === undefined || url === null || url === '') {
      return { kind: 'failure', reason: 'not-found' };
    }

    let target: URL;
    try {
      target = new URL(url);
    } catch {
      // A stored value that is not a url at all. Reported rather than thrown:
      // it is a catalogue-data problem, not a request problem.
      this.logger.warn(`product_image_unusable_url productId=${productId} index=${String(index)}`);
      return { kind: 'failure', reason: 'unusable-url' };
    }

    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      this.logger.warn(
        `product_image_unusable_url productId=${productId} protocol=${target.protocol}`
      );
      return { kind: 'failure', reason: 'unusable-url' };
    }

    return this.fetchImage(target, productId, index);
  }

  private async fetchImage(
    target: URL,
    productId: string,
    index: number
  ): Promise<ProductImageResult> {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
    }, FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(target, { signal: abort.signal, redirect: 'follow' });

      if (!response.ok) {
        this.logger.warn(
          `product_image_upstream_status productId=${productId} index=${String(index)} status=${String(response.status)}`
        );
        return { kind: 'failure', reason: 'upstream-unavailable' };
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith(ALLOWED_TYPE_PREFIX)) {
        // A shop that 200s an HTML error page is the common shape here. Passing
        // it through would put the shop's markup on our origin.
        this.logger.warn(
          `product_image_not_an_image productId=${productId} contentType=${contentType}`
        );
        return { kind: 'failure', reason: 'not-an-image' };
      }

      const declared = Number(response.headers.get('content-length') ?? Number.NaN);
      if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
        return { kind: 'failure', reason: 'not-an-image' };
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      // Re-checked after the read: a chunked response declares no length, so
      // the header test above cannot be the only bound.
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        this.logger.warn(
          `product_image_too_large productId=${productId} bytes=${String(bytes.byteLength)}`
        );
        return { kind: 'failure', reason: 'not-an-image' };
      }

      return { kind: 'image', image: { bytes, contentType: contentType.split(';')[0].trim() } };
    } catch (error) {
      // A timeout, DNS failure or refused connection. The shop being down must
      // not 500 the page that asked for a thumbnail.
      this.logger.warn(
        `product_image_upstream_unavailable productId=${productId} index=${String(index)} error=${(error as Error).message}`
      );
      return { kind: 'failure', reason: 'upstream-unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
