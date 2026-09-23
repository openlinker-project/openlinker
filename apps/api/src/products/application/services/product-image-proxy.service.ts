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
 * ## The stored url is NOT uniformly operator-authored
 *
 * Index-not-url bounds the reachable set to what the catalogue sync wrote -
 * and the WooCommerce product mapper writes `i.src` VERBATIM from the shop's
 * own response, as the Allegro one does. So a hostile or compromised shop
 * chooses part of that set, and this service reaches it from inside the
 * backend's network. `isProductImageUrlAllowed` is the second bound that
 * follows from that: link-local and the metadata hostnames are refused, on
 * every hop, while the private ranges the feature exists to reach stay
 * allowed. Its own module docblock explains why it is not `isUrlSsrfSafe`.
 *
 * Redirects are followed BY HAND for the same reason. `redirect: 'follow'`
 * checks the first url and then goes wherever the shop points, which makes
 * the check a formality - a 302 to `169.254.169.254` would have sailed
 * through it.
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
import { isProductImageUrlAllowed } from './product-image-url-safety';

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

/**
 * How many redirects to follow before giving up.
 *
 * Followed by hand rather than by `redirect: 'follow'`, so that every hop's
 * host is re-checked - otherwise the check applies to the first url only and
 * a shop can 302 to anywhere. Three is generous for a CDN or an http-to-https
 * upgrade and short enough that a redirect loop ends as a failed thumbnail
 * rather than as a held worker.
 */
const MAX_REDIRECTS = 3;

export interface ProductImage {
  readonly bytes: Buffer;
  readonly contentType: string;
}

export type ProductImageFailure =
  /** No such product, or it carries no image at that index. */
  | 'not-found'
  /**
   * The stored value is not a fetchable http(s) url, or names a host this
   * proxy refuses to reach - see `isProductImageUrlAllowed`.
   */
  | 'unusable-url'
  /** The shop did not answer, answered an error, or answered too slowly. */
  | 'upstream-unavailable'
  /** It answered, but with something that is not an image, or is too large. */
  | 'not-an-image';

export type ProductImageResult =
  | { readonly kind: 'image'; readonly image: ProductImage }
  | { readonly kind: 'failure'; readonly reason: ProductImageFailure };

/**
 * Whether a status is one that carries a `Location` worth following.
 *
 * The set, not `>= 300 && < 400`: 304 and 305 carry no redirect target a
 * fetch should chase, and treating them as one would follow a stale header
 * or, for 305, a proxy instruction.
 */
function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

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

    // Protocol AND host, in one predicate, so the two cannot be checked in
    // two places and drift. Logged distinctly from a malformed url: a refused
    // HOST is the interesting line in an incident, and reading it as "the
    // catalogue holds a broken value" would send an operator looking at the
    // wrong thing entirely.
    if (!isProductImageUrlAllowed(target)) {
      this.logger.warn(
        `product_image_refused_host productId=${productId} index=${String(index)} ` +
          `protocol=${target.protocol} host=${target.hostname}`
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
      let current = target;
      let response = await fetch(current, { signal: abort.signal, redirect: 'manual' });

      // Every hop re-checked, never `redirect: 'follow'`: that checks the url
      // the catalogue holds and then goes wherever the shop sends it, so a
      // 302 to the metadata service would bypass the gate above entirely.
      for (let hop = 0; hop < MAX_REDIRECTS && isRedirect(response.status); hop += 1) {
        const location = response.headers.get('location');
        if (location === null || location === '') break;

        let next: URL;
        try {
          // Resolved against the CURRENT url, so a relative `Location` works
          // and an absolute one still names its own host.
          next = new URL(location, current);
        } catch {
          this.logger.warn(
            `product_image_refused_host productId=${productId} index=${String(index)} ` +
              `reason=unparseable-redirect`
          );
          return { kind: 'failure', reason: 'unusable-url' };
        }

        if (!isProductImageUrlAllowed(next)) {
          this.logger.warn(
            `product_image_refused_host productId=${productId} index=${String(index)} ` +
              `hop=${String(hop + 1)} protocol=${next.protocol} host=${next.hostname}`
          );
          return { kind: 'failure', reason: 'unusable-url' };
        }

        current = next;
        response = await fetch(current, { signal: abort.signal, redirect: 'manual' });
      }

      // Still redirecting past the cap: a loop, or a chain longer than any
      // real image needs. Reported as the shop being unreachable, which is
      // what it amounts to from here.
      if (isRedirect(response.status)) {
        this.logger.warn(
          `product_image_upstream_status productId=${productId} index=${String(index)} ` +
            `reason=too-many-redirects`
        );
        return { kind: 'failure', reason: 'upstream-unavailable' };
      }

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
